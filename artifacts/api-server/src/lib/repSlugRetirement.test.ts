import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { createPublicRepResolverRouter, retireRepSlug } from "../routes/repPublic.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { isSlugRetirementAuthorized, requiresSlugRetirement } from "./repSlugPolicy.ts";
import express from "express";
import { createServer } from "node:http";

type FakeState = {
  user: { id: number; slug: string | null; name: string | null };
  activeTarget?: boolean;
  retiredTarget?: boolean;
  retired: Array<{ slug: string; replacementSlug: string; userId: number }>;
  historyWrites: number;
  failUpdate?: boolean;
};

function fakeDatabase(state: FakeState) {
  return {
    transaction: async (callback: (tx: any) => Promise<any>) => {
      const snapshot = {
        user: { ...state.user },
        retired: state.retired.map((row) => ({ ...row })),
        historyWrites: state.historyWrites,
      };
      let selectCount = 0;
      const tx = {
        select: () => {
          const selection = selectCount++;
          return {
            from: () => ({
              where: () => ({
                for: async () => {
                  if (selection === 0) return [state.user];
                  if (selection === 1) return state.activeTarget ? [{ id: 99 }] : [];
                  return state.retiredTarget ? [{ slug: "new-target" }] : [];
                },
              }),
            }),
          };
        },
        insert: () => ({
          values: async (row: { slug: string; replacementSlug: string; userId: number }) => {
            state.retired.push(row);
          },
        }),
        update: () => ({
          set: (values: { slug?: string; name?: string | null }) => ({
            where: () => ({
              returning: async () => {
                if (state.failUpdate) return [];
                if (values.slug !== undefined) state.user.slug = values.slug;
                if (values.name !== undefined) state.user.name = values.name;
                return [state.user];
              },
            }),
          }),
        }),
      };
      try {
        return await callback(tx);
      } catch (error) {
        state.user = snapshot.user;
        state.retired = snapshot.retired;
        state.historyWrites = snapshot.historyWrites;
        throw error;
      }
    },
  };
}

test("retirement auth is admin-only and generic PUT requires retirement for an existing slug", () => {
  assert.equal(isSlugRetirementAuthorized({ role: "admin" }), true);
  assert.equal(isSlugRetirementAuthorized({ role: "manager" }), false);
  assert.equal(isSlugRetirementAuthorized(null), false);
  assert.equal(requiresSlugRetirement("old", "new"), true);
  assert.equal(requiresSlugRetirement("old", "old"), false);
  assert.equal(requiresSlugRetirement(null, "new"), false);
});

test("retirement is idempotent and permanently reserves the prior slug", async () => {
  const state: FakeState = {
    user: { id: 1, slug: "old", name: null },
    retired: [],
    historyWrites: 0,
  };
  const database = fakeDatabase(state);
  await retireRepSlug({ userId: 1, newSlug: "new", displayName: "New Name" }, database);
  assert.deepEqual(state.retired, [{ slug: "old", replacementSlug: "new", userId: 1 }]);
  assert.equal(state.user.slug, "new");
  assert.equal(state.user.name, "New Name");
  await retireRepSlug({ userId: 1, newSlug: "new", displayName: "New Name" }, database);
  assert.equal(state.retired.length, 1);
  assert.equal(state.historyWrites, 0);
});

test("retirement rejects active and retired targets", async () => {
  for (const key of ["activeTarget", "retiredTarget"] as const) {
    const state: FakeState = {
      user: { id: 1, slug: "old", name: null },
      retired: [],
      historyWrites: 0,
      [key]: true,
    };
    await assert.rejects(
      retireRepSlug({ userId: 1, newSlug: "new-target" }, fakeDatabase(state)),
      (error: any) => error?.status === 409,
    );
    assert.equal(state.retired.length, 0);
    assert.equal(state.user.slug, "old");
  }
});

test("failed update rolls back reservation and never writes history", async () => {
  const state: FakeState = {
    user: { id: 1, slug: "old", name: null },
    retired: [],
    historyWrites: 0,
    failUpdate: true,
  };
  await assert.rejects(retireRepSlug({ userId: 1, newSlug: "new" }, fakeDatabase(state)));
  assert.equal(state.retired.length, 0);
  assert.equal(state.user.slug, "old");
  assert.equal(state.historyWrites, 0);
});

test("retired public resolver responds with a canonical 301", async () => {
  const app = express();
  app.use(createPublicRepResolverRouter({
    resolve: async () => ({
      user: { name: "Ray Davis", email: "ray@my-business-solutions.com", mobileNumber: null, slug: "ray" },
      replacementSlug: "ray",
    }),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/public/reps/old`, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.match(response.headers.get("location") ?? "", /\/api\/public\/reps\/ray$/);
    assert.equal((await response.json() as { slug: string }).slug, "ray");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});