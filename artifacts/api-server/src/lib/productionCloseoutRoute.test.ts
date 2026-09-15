import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { Request, Response } from "express";
import { createAdminProductionCloseoutRouter } from "../routes/adminProductionCloseout";
import type { MaintenanceRouteUser } from "../routes/lenders";
import type { LenderSeedOperationResult } from "../lib/productionMaintenance";

type SeedResult = LenderSeedOperationResult;

const lenderResult: SeedResult = {
  created: 0,
  updated: 0,
  unchanged: 11,
  createdNames: [],
  updatedNames: [],
  unchangedNames: [
    "Dexly Finance",
    "Thoro Corp",
    "Navitas Credit Corp",
    "Keystone Equipment Finance Corp (KEF)",
    "Channel Partners Capital",
    "TimePayment Corp",
    "PEAC Solutions",
    "Luminar Capital",
    "Alliance Funding Group (AFG)",
    "AMUR Equipment Finance",
    "Y.E.S. Leasing",
  ],
  missingUpdateNames: [],
  existingLenderUpdates: [],
  updatedExistingNames: [],
  unchangedExistingNames: ["Alliance Funding Group (AFG)", "AMUR Equipment Finance", "Y.E.S. Leasing"],
  missingExistingNames: [],
  lenders: [],
};

const adminUser: MaintenanceRouteUser = { id: 42, role: "admin" };
const repUser: MaintenanceRouteUser = { id: 43, role: "rep" };

async function post(router: ReturnType<typeof createAdminProductionCloseoutRouter>, path: string) {
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

test("production closeout route requires an authenticated admin", async () => {
  const unauthorized = await post(createAdminProductionCloseoutRouter({
    requireUser: async (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    },
    runProductionCloseout: async () => {
      throw new Error("must not run");
    },
  }), "/admin/production-closeout");
  assert.equal(unauthorized.status, 401);

  const forbidden = await post(createAdminProductionCloseoutRouter({
    requireUser: injectedAuth(repUser),
    runProductionCloseout: async () => {
      throw new Error("must not run");
    },
  }), "/admin/production-closeout");
  assert.equal(forbidden.status, 403);
});

test("production closeout route returns the same shared lender operation result", async () => {
  let capturedLenderResult: unknown;
  const response = await post(createAdminProductionCloseoutRouter({
    requireUser: injectedAuth(adminUser),
    seedNewLenders: async () => lenderResult,
    runProductionCloseout: async (operations) => {
      capturedLenderResult = await operations.lenders();
      return {
        status: "succeeded",
        overallStatus: "succeeded",
        results: [{ operation: "lenders", status: "succeeded", details: capturedLenderResult }],
      };
    },
  }), "/admin/production-closeout");

  assert.equal(response.status, 200);
  assert.deepEqual(capturedLenderResult, lenderResult);
  const result = (response.body.results as Array<Record<string, unknown>>)[0];
  assert.deepEqual(result.details, lenderResult);
});

test("production closeout route preserves operation failure results and handles unexpected 500s", async () => {
  const failed = await post(createAdminProductionCloseoutRouter({
    requireUser: injectedAuth(adminUser),
    runProductionCloseout: async () => ({
      status: "failed",
      overallStatus: "failed",
      results: [{
        operation: "lenders",
        status: "failed",
        details: { error: "packet target missing", missingUpdateNames: ["AMUR Equipment Finance"] },
      }],
    }),
  }), "/admin/production-closeout");
  assert.equal(failed.status, 200);
  assert.deepEqual((failed.body.results as Array<Record<string, unknown>>)[0], {
    operation: "lenders",
    status: "failed",
    details: { error: "packet target missing", missingUpdateNames: ["AMUR Equipment Finance"] },
  });

  const unexpected = await post(createAdminProductionCloseoutRouter({
    requireUser: injectedAuth(adminUser),
    runProductionCloseout: async () => {
      throw new Error("closeout unavailable");
    },
  }), "/admin/production-closeout");
  assert.equal(unexpected.status, 500);
  assert.deepEqual(unexpected.body, { error: "Unable to run production closeout" });
});