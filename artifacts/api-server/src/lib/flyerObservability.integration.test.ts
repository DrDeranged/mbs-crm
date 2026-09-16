import assert from "node:assert/strict";
import test from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { createFlyerPdfRenderer, FlyerRenderTimeoutError } from "./flyerPdfRenderer";
import { createHttp5xxRecorder, type Http5xxRecord } from "./httpErrorObservation";

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("an Express flyer request returns 503 and records one correlatable 5xx event", async () => {
  const logs: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const persisted: Http5xxRecord[] = [];
  const recorder = createHttp5xxRecorder({
    logger: { error: (bindings, message) => logs.push({ bindings, message }) },
    persist: async (record) => { persisted.push(record); },
  });
  const renderFlyer = createFlyerPdfRenderer(
    async () => await new Promise<Buffer>(() => {}),
    { timeoutMs: 5 },
  );
  const app = express();
  app.get("/api/flyers/generate", async (_req, res, next) => {
    try {
      await renderFlyer("<html />");
      res.json({ unexpected: true });
    } catch (error) {
      next(error);
    }
  });
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof FlyerRenderTimeoutError ? error.status : 500;
    const requestId = "fixture-request-id";
    res.status(status);
    recorder.record({
      requestId,
      method: req.method,
      path: req.path,
      userId: "fixture-user-id",
      status,
      error,
    });
    res.json({ error: "Flyer PDF generation timed out", requestId });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/flyers/generate`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Flyer PDF generation timed out",
      requestId: "fixture-request-id",
    });
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(persisted.length, 1);
  assert.deepEqual(
    {
      requestId: persisted[0]?.requestId,
      method: persisted[0]?.method,
      path: persisted[0]?.path,
      userId: persisted[0]?.userId,
      status: persisted[0]?.status,
    },
    {
      requestId: "fixture-request-id",
      method: "GET",
      path: "/api/flyers/generate",
      userId: "fixture-user-id",
      status: 503,
    },
  );
  assert.match(persisted[0]?.stack ?? "", /Flyer PDF generation timed out/);
  assert.equal(logs[0]?.bindings.requestId, persisted[0]?.requestId);
  assert.equal(logs[0]?.bindings.userId, persisted[0]?.userId);
});