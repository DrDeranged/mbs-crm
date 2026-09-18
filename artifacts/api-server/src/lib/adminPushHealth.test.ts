import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { createAdminPushHealthRouter } from "../routes/adminPushHealth";

test("post-Clerk push health enforces anonymous, representative, and admin roles", async () => {
  const app = express();
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
          then: (resolve: (value: unknown[]) => unknown) => resolve([]),
        }),
      }),
    }),
  };
  let identity: { id: number; role: string } | undefined;
  app.use(createAdminPushHealthRouter({
    db: database,
    authenticate: async (_req, res) => {
      if (!identity) {
        res.status(401).json({ error: "Unauthorized" });
        return undefined;
      }
      return identity as any;
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/admin/push/health`;
  try {
    assert.equal((await fetch(url)).status, 401);
    identity = { id: 1, role: "rep" };
    assert.equal((await fetch(url)).status, 403);
    identity = { id: 2, role: "admin" };
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});