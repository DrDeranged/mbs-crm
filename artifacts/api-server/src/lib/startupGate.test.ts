import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import test from "node:test";
import { createStartupGate } from "./startupGate";

async function withGate(
  run: (baseUrl: string, gate: ReturnType<typeof createStartupGate>) => Promise<void>,
): Promise<void> {
  const gate = createStartupGate();
  const server = createServer(gate.handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`, gate);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test("startup gate keeps deployment liveness healthy while booting", async () => {
  await withGate(async (baseUrl) => {
    for (const path of ["/api", "/api/healthz"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok", phase: "booting" });
    }
  });
});

test("startup gate rejects business traffic until the application is ready", async () => {
  await withGate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/leads`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.deepEqual(await response.json(), {
      error: "API initialization in progress",
      phase: "booting",
    });
  });
});

test("startup gate hands the same listener to the application once ready", async () => {
  await withGate(async (baseUrl, gate) => {
    const listener: RequestListener = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    gate.activate(listener);

    const response = await fetch(`${baseUrl}/api/leads`);
    assert.equal(response.status, 204);
    assert.equal(gate.getPhase(), "ready");
  });
});

test("failed initialization stays observable and does not admit business traffic", async () => {
  await withGate(async (baseUrl, gate) => {
    gate.fail();

    const liveness = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(liveness.status, 503);
    assert.deepEqual(await liveness.json(), {
      error: "API initialization failed",
      phase: "failed",
    });

    const deepHealth = await fetch(`${baseUrl}/api/health/deep`);
    assert.equal(deepHealth.status, 503);
    assert.equal(deepHealth.headers.get("retry-after"), "5");
    assert.deepEqual(await deepHealth.json(), {
      status: "degraded",
      phase: "failed",
      initialization: "failed",
    });

    const business = await fetch(`${baseUrl}/api/leads`);
    assert.equal(business.status, 503);
  });
});