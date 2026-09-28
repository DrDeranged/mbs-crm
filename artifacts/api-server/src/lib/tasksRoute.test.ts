import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

process.env.DATABASE_URL ??= "postgresql://tasks-route.invalid/test";

const { createCreateTaskHandler, createUpdateTaskHandler } = await import("../routes/tasks");

const date = new Date("2025-01-01T00:00:00.000Z");

function user(id: number, role: string, isActive = true) {
  return {
    id,
    role,
    isActive,
    clerkId: `clerk-${id}`,
    name: `User ${id}`,
    title: null,
    email: `user-${id}@example.test`,
    slug: null,
    mobileNumber: null,
    mergedInto: null,
    createdAt: date,
    updatedAt: date,
  };
}

function makeFixture(options: {
  actor: ReturnType<typeof user>;
  leadAssignedRepId?: number | null;
  target?: ReturnType<typeof user> | null;
  taskLeadId?: number;
}) {
  const lead = { id: 41, assignedRepId: options.leadAssignedRepId ?? options.actor.id };
  let created: any = null;
  let updated: any = null;
  const existing = {
    id: 90,
    leadId: options.taskLeadId ?? lead.id,
    userId: options.actor.id,
    title: "Follow up",
    description: null,
    dueDate: null,
    isCompleted: false,
    completedAt: null,
    createdAt: date,
    updatedAt: date,
  };
  const database = {
    query: {
      leadsTable: { findFirst: async () => lead },
      usersTable: {
        findFirst: async () =>
          options.target?.isActive && !options.target.mergedInto
            ? options.target
            : null,
      },
      tasksTable: {
        findFirst: async () => existing,
      },
    },
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          created = { ...existing, ...values, id: 91, createdAt: date, completedAt: null };
          return [created];
        },
      }),
    }),
    update: () => ({
      set: (changes: any) => ({
        where: () => ({
          returning: async () => {
            updated = { ...existing, ...changes };
            return [updated];
          },
        }),
      }),
    }),
  };

  return {
    database,
    get created() { return created; },
    get updated() { return updated; },
  };
}

async function sendRequest(
  method: "POST" | "PUT" | "PATCH",
  path: string,
  body: Record<string, unknown>,
  fixture: ReturnType<typeof makeFixture>,
  actor: ReturnType<typeof user>,
) {
  const app = express();
  app.use(express.json());
  const dependencies = {
    database: fixture.database as any,
    authenticate: async () => actor as any,
    recordActivity: async () => undefined,
  };
  app.post("/leads/:id/tasks", createCreateTaskHandler(dependencies));
  const updateHandler = createUpdateTaskHandler(dependencies);
  app.put("/tasks/:taskId", updateHandler);
  app.patch("/tasks/:taskId", updateHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("rep can create a task assigned to themself on their lead", async () => {
  const actor = user(7, "rep");
  const fixture = makeFixture({ actor, target: actor });
  const response = await sendRequest("POST", "/leads/41/tasks", {
    title: "Call back",
    assignedUserId: actor.id,
  }, fixture, actor);
  const body = await response.json() as any;
  assert.equal(response.status, 201);
  assert.equal(fixture.created.userId, actor.id);
  assert.equal(body.assignedUser.id, actor.id);
});

test("rep cannot create a task assigned to another user", async () => {
  const actor = user(7, "rep");
  const fixture = makeFixture({ actor, target: user(8, "rep") });
  const response = await sendRequest("POST", "/leads/41/tasks", {
    title: "Unauthorized assignment",
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 403);
  assert.equal(fixture.created, null);
});

test("manager can create a task assigned to any active user", async () => {
  const actor = user(3, "manager");
  const fixture = makeFixture({ actor, target: user(8, "rep") });
  const response = await sendRequest("POST", "/leads/41/tasks", {
    title: "Team follow up",
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 201);
  assert.equal(fixture.created.userId, 8);
});

test("manager cannot create a task for an inactive user", async () => {
  const actor = user(3, "manager");
  const fixture = makeFixture({ actor, target: user(8, "rep", false) });
  const response = await sendRequest("POST", "/leads/41/tasks", {
    title: "Inactive assignment",
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 403);
  assert.equal(fixture.created, null);
});

test("PATCH allows a manager to reassign to an active user", async () => {
  const actor = user(3, "manager");
  const fixture = makeFixture({ actor, target: user(8, "rep") });
  const response = await sendRequest("PATCH", "/tasks/90", {
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 200);
  assert.equal(fixture.updated.userId, 8);
});

test("PATCH rejects a rep assigning a task to another user without updating it", async () => {
  const actor = user(7, "rep");
  const fixture = makeFixture({ actor, target: user(8, "rep") });
  const response = await sendRequest("PATCH", "/tasks/90", {
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 403);
  assert.equal(fixture.updated, null);
});

test("PATCH rejects assignment to an inactive user", async () => {
  const actor = user(3, "admin");
  const fixture = makeFixture({ actor, target: user(8, "rep", false) });
  const response = await sendRequest("PATCH", "/tasks/90", {
    assignedUserId: 8,
  }, fixture, actor);
  assert.equal(response.status, 403);
  assert.equal(fixture.updated, null);
});