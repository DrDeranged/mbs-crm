import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import express, { type IRouter } from "express";

// The composed router imports flyer-templates, whose normal app startup path
// seeds defaults. A route-audit test must never turn an import into a DB write.
process.env.DISABLE_FLYER_TEMPLATE_SEED = "true";
process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

type RegisteredRoute = { method: string; path: string };

function walkRouter(router: IRouter): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  const visit = (stack: Array<any>) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          for (const [method, enabled] of Object.entries(layer.route.methods)) {
            if (enabled) found.push({ method: method.toUpperCase(), path: String(path) });
          }
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        visit(layer.handle.stack);
      }
    }
  };
  visit((router as any).stack);
  return found;
}

function concretePath(path: string): string {
  return path
    .replace(/:[A-Za-z0-9_]+/g, "1")
    .replace(/\*[A-Za-z0-9_]+/g, "test");
}

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

function mockedClerkAuth(userId: string | null) {
  return (req: any, _res: express.Response, next: express.NextFunction) => {
    const auth = () => ({
      userId,
      tokenType: "session_token",
    });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    req.auth = auth;
    next();
  };
}

test("the real API router has a gate before every private mutation", async () => {
  const {
    default: apiRouter,
    bootCriticalRouter,
    mutationAuthenticationGuard,
    PUBLIC_MUTATION_PATHS,
  } = await import("../routes/index");

  const rootStack = (apiRouter as any).stack as Array<any>;
  assert.equal(
    rootStack[0]?.handle,
    mutationAuthenticationGuard,
    "the root router must install the shared mutation gate before child routers",
  );

  const registrations = walkRouter(apiRouter);
  const allRegistrations = [...walkRouter(bootCriticalRouter), ...registrations];
  assert.equal(allRegistrations.length, 236, "update this audited count when registering a route");
  const matrix = await readFile(new URL("../../../../docs/AUTH_MATRIX.md", import.meta.url), "utf8");
  const documentedRoutes = [...matrix.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|/gm)]
    .map(([, method, path]) => `${method} ${path}`)
    .sort();
  const runtimeRoutes = allRegistrations
    .map(({ method, path }) => `${method} /api${path}`)
    .sort();
  assert.deepEqual(
    documentedRoutes,
    runtimeRoutes,
    "the authorization matrix must match the real composed-router route map",
  );
  const mutations = registrations.filter(({ method }) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(method));
  const privateMutations = mutations.filter(({ path }) => !PUBLIC_MUTATION_PATHS.has(path));
  assert(privateMutations.length > 0);

  // This is an HTTP walk of the actual, fully composed router and its actual
  // production gate. The branded Clerk context mirrors clerkMiddleware's
  // request contract; no test-only guard is mounted before the router.
  const app = express();
  app.use(express.json());
  app.use(mockedClerkAuth(null));
  app.use("/api", apiRouter);
  const server = await listen(app);
  try {
    for (const route of privateMutations) {
      const response = await fetch(`${server.url}/api${concretePath(route.path)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(
        response.status,
        401,
        `${route.method} ${route.path} bypassed the mutation authentication gate`,
      );
    }
  } finally {
    await server.close();
  }
});

test("the production mutation gate accepts a Clerk-authenticated request", async () => {
  const { mutationAuthenticationGuard } = await import("../routes/index");
  let reachedHandler = false;
  const app = express();
  app.use(mockedClerkAuth("clerk-test-user"));
  app.post("/private-probe", mutationAuthenticationGuard, (_req, res) => {
    reachedHandler = true;
    res.status(204).send();
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/private-probe`, { method: "POST" });
    assert.equal(response.status, 204);
    assert.equal(reachedHandler, true);
  } finally {
    await server.close();
  }
});

test("creator-owned resources reject other reps", async () => {
  const { canAccessCreatorOwnedRecord } = await import("./authHelpers");
  const ownRep = { id: 17, role: "rep" } as any;
  const otherRep = { id: 18, role: "rep" } as any;
  const manager = { id: 19, role: "manager" } as any;
  assert.equal(canAccessCreatorOwnedRecord(ownRep, 17), true);
  assert.equal(canAccessCreatorOwnedRecord(otherRep, 17), false);
  assert.equal(canAccessCreatorOwnedRecord(ownRep, null), false);
  assert.equal(canAccessCreatorOwnedRecord(manager, 17), true);
});

test("a rep cannot self-assign a lead", async () => {
  const { createAssignLeadHandler } = await import("../routes/leads");
  const rep = {
    id: 17,
    clerkId: "rep-clerk-id",
    email: "rep@example.com",
    name: "Rep",
    role: "rep",
    isActive: true,
    slug: null,
    mobileNumber: null,
    createdAt: new Date(),
  } as any;
  const app = express();
  app.use(express.json());
  app.put("/api/leads/:id/assign", createAssignLeadHandler({
    authenticate: async () => rep,
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/leads/99/assign`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repId: rep.id }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Forbidden: managers and admins only",
    });
  } finally {
    await server.close();
  }
});

test("unsigned SendGrid webhooks are rejected in every environment", async () => {
  const savedKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  const { default: sendGridRouter } = await import("../routes/sendgrid");
  const app = express();
  app.use(express.json({ verify: (req, _res, body) => { (req as any).rawBody = body; } }));
  app.use("/api", sendGridRouter);
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/sendgrid/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ event: "delivered" }]),
    });
    assert.equal(response.status, 401);
  } finally {
    if (savedKey === undefined) delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    else process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = savedKey;
    await server.close();
  }
});

test("unsigned Twilio callbacks are rejected before side effects", async () => {
  const { default: twilioRouter } = await import("../routes/twilio");
  const app = express();
  app.use(express.json());
  app.use("/api", twilioRouter);
  const server = await listen(app);
  try {
    for (const path of [
      "/twilio/voice",
      "/twilio/voice/inbound",
      "/twilio/voice/status",
      "/twilio/voice/recording",
      "/twilio/sms/inbound",
      "/twilio/sms/status",
    ]) {
      const response = await fetch(`${server.url}/api${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 403, `${path} accepted an unsigned callback`);
    }
  } finally {
    await server.close();
  }
});