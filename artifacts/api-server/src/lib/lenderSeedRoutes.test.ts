import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { Request, Response } from "express";
import { createSeedNewLendersRouter, type MaintenanceRouteUser } from "../routes/lenders";
import { NEW_LENDER_SEEDS } from "./newLenderSeeds";
import type { LenderSeedOperationResult } from "./productionMaintenance";

type SeedResult = LenderSeedOperationResult;

const lenderSeedResult: SeedResult = {
  created: 0,
  updated: 0,
  unchanged: 11,
  createdNames: [],
  updatedNames: [],
  unchangedNames: [
    "Dexly Finance",
    "Thoro Corp",
    ...NEW_LENDER_SEEDS.slice(2).map((seed) => seed.name),
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ],
  missingUpdateNames: ["Missing Packet Lender"],
  existingLenderUpdates: [],
  updatedExistingNames: [],
  unchangedExistingNames: ["Alliance Funding Group (AFG)", "AMUR Equipment Finance", "Y.E.S. Leasing"],
  missingExistingNames: ["Missing Packet Lender"],
  lenders: [],
};

const adminUser: MaintenanceRouteUser = { id: 42, role: "admin" };
const repUser: MaintenanceRouteUser = { id: 43, role: "rep" };

async function post(router: ReturnType<typeof createSeedNewLendersRouter>, path: string) {
  const app = express();
  app.use(router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP address");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST" });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function injectedAuth(user: MaintenanceRouteUser | null) {
  return async (_req: Request, _res: Response) => user;
}

test("seed-new route requires an authenticated admin", async () => {
  const unauthorized = await post(createSeedNewLendersRouter({
    requireUser: async (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    },
    seedNewLenders: async () => lenderSeedResult,
  }), "/admin/lenders/seed-new");
  assert.equal(unauthorized.status, 401);

  const forbidden = await post(createSeedNewLendersRouter({
    requireUser: injectedAuth(repUser),
    seedNewLenders: async () => lenderSeedResult,
  }), "/admin/lenders/seed-new");
  assert.equal(forbidden.status, 403);
});

test("seed-new route returns the exact shared operation summary, including missing update names", async () => {
  let calls = 0;
  const response = await post(createSeedNewLendersRouter({
    requireUser: injectedAuth(adminUser),
    seedNewLenders: async () => {
      calls++;
      return lenderSeedResult;
    },
  }), "/admin/lenders/seed-new");

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(response.body, {
    created: 0,
    updated: 0,
    unchanged: 11,
    createdNames: [],
    updatedNames: [],
    unchangedNames: [
      "Dexly Finance",
      "Thoro Corp",
      ...NEW_LENDER_SEEDS.slice(2).map((seed) => seed.name),
      "Alliance Funding Group (AFG)",
      "AMUR Equipment Finance",
      "Y.E.S. Leasing",
    ],
    missingUpdateNames: ["Missing Packet Lender"],
    lenders: [],
  });
});

test("seed-new route returns 500 when the shared operation fails", async () => {
  const response = await post(createSeedNewLendersRouter({
    requireUser: injectedAuth(adminUser),
    seedNewLenders: async () => {
      throw new Error("database unavailable");
    },
  }), "/admin/lenders/seed-new");

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Unable to seed new lenders" });
});