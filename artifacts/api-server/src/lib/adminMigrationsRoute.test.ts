import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request, type Response } from "express";
import { createAdminMigrationsRouter } from "../routes/adminMigrations";

async function getStatus() {
  const app = express();
  app.use(createAdminMigrationsRouter({
    requireUser: async (_req: Request, _res: Response) => ({ role: "rep" } as never),
    getMigrationStatus: async () => {
      throw new Error("must not read status for a rep");
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/migrations/status`);
    return response.status;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test("migration status endpoint is forbidden for reps", async () => {
  assert.equal(await getStatus(), 403);
});