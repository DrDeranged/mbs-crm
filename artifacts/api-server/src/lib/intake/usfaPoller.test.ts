import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { USFA_HEADERS } from "./usfa";
import { createUsfaStatementTasks, validateUsfaHeaders, runUsfaSheetPoll, testUsfaSheetConnection } from "./usfaPoller";
import { claimUsfaInvite } from "../../routes/usfaPrefill";

test("USFA poller requires every exact vendor header", () => {
  assert.equal(validateUsfaHeaders([...USFA_HEADERS]), true);
  assert.equal(validateUsfaHeaders([...USFA_HEADERS].slice(0, -1)), false);
  assert.equal(validateUsfaHeaders(["Id", "COMPANY", "id"]), false);
});

test("USFA poller is safely disarmed when service-account secret is absent", async () => {
  const prior = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    const result = await runUsfaSheetPoll();
    assert.equal(result.status, "skipped");
    assert.match(result.reason ?? "", /GOOGLE_SERVICE_ACCOUNT_JSON/);
  } finally {
    if (prior === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prior;
  }
});

test("USFA connection test reads only the configured header row and counts returned columns", async () => {
  let calls = 0;
  const result = await testUsfaSheetConnection(" sheet-id ", "O'Brien", {
    rawCredentials: JSON.stringify({ client_email: "service@example.com", private_key: "private-material" }),
    readHeader: async (credentials, id, range) => {
      calls++;
      assert.equal(credentials.client_email, "service@example.com");
      assert.equal(id, "sheet-id");
      assert.equal(range, "'O''Brien'!1:1");
      return ["Id", "Name", "Email", ""];
    },
  });
  assert.deepEqual(result, { ok: true, columnCount: 4 });
  assert.equal(calls, 1);
});

test("USFA connection test fails safely for missing configuration and sanitizes provider auth errors", async () => {
  assert.deepEqual(await testUsfaSheetConnection(null, "Sheet1", { rawCredentials: "" }),
    { ok: false, error: "Save a Sheet ID before testing the connection." });
  assert.deepEqual(await testUsfaSheetConnection("sheet-id", "Sheet1", { rawCredentials: "" }),
    { ok: false, error: "Google service account is absent." });
  assert.deepEqual(await testUsfaSheetConnection("sheet-id", "Sheet1", { rawCredentials: "not JSON" }),
    { ok: false, error: "Google service account credentials are invalid." });
  const denied = await testUsfaSheetConnection("sheet-id", "Sheet1", {
    rawCredentials: JSON.stringify({ client_email: "service@example.com", private_key: "private-material" }),
    readHeader: async () => { throw { response: { status: 403 }, message: "private-material must not appear" }; },
  });
  assert.equal(denied.ok, false);
  assert.match(denied.ok ? "" : denied.error, /authentication or access was denied/);
  assert.doesNotMatch(JSON.stringify(denied), /private-material/);
});

type FakeTaskTransaction = {
  inserts: Array<Record<string, unknown>>;
  select: () => { from: () => { where: () => Promise<Array<{ id: number }>> } };
  insert: () => { values: (value: Record<string, unknown>) => Promise<void> };
};

function fakeTaskTransaction(adminIds: number[]): FakeTaskTransaction {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    select() {
      return {
        from() {
          return {
            where: async () => adminIds.map((id) => ({ id })),
          };
        },
      };
    },
    insert() {
      return { values: async (value: Record<string, unknown>) => void inserts.push(value) };
    },
  };
}

test("USFA statement tasks target the assigned rep, every admin, or an explicit admin queue", async () => {
  const plan = {
    title: "Download bank statements from USFA dashboard and upload as Bank statement" as const,
    statementCount: 2,
  };
  const assigned = fakeTaskTransaction([8, 9]);
  assert.equal(await createUsfaStatementTasks(assigned, 41, 7, plan), 1);
  assert.deepEqual(assigned.inserts.map((row) => row.userId), [7]);

  const admins = fakeTaskTransaction([8, 9]);
  assert.equal(await createUsfaStatementTasks(admins, 42, null, plan), 2);
  assert.deepEqual(admins.inserts.map((row) => row.userId), [8, 9]);

  const queue = fakeTaskTransaction([]);
  assert.equal(await createUsfaStatementTasks(queue, 43, null, plan), 1);
  assert.equal(queue.inserts[0]?.userId, null);
});

test("USFA ingestion commits before global admin notification and persists duplicate intake history", async () => {
  const source = await readFile(new URL("./usfaPoller.ts", import.meta.url), "utf8");
  const transactionEnd = source.indexOf("\n  const notification = outcome.notification;");
  const transactionStart = source.indexOf("const outcome: {");
  const notificationCall = source.indexOf('notifyAllAdmins("application_received"', transactionEnd);
  assert.ok(transactionStart >= 0 && transactionEnd > transactionStart);
  assert.ok(notificationCall > transactionEnd);
  const duplicateBranch = source.slice(source.indexOf("externalLead"), transactionEnd);
  assert.match(duplicateBranch, /usfaIntakePrefillTable/);
  assert.match(duplicateBranch, /leadsTable\.externalId/);
  assert.match(duplicateBranch, /encryptedPayload: encrypt/);
  assert.match(duplicateBranch, /activityLogTable/);
  assert.match(duplicateBranch, /createUsfaStatementTasks/);
  assert.match(duplicateBranch, /status: "dup"/);
});

test("USFA invite claim is conditional: exactly one winner and replay is rejected", async () => {
  let unused = true;
  const database = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            if (!unused) return [];
            unused = false;
            return [{ id: 12 }];
          },
        }),
      }),
    }),
  } as never;
  assert.equal(await claimUsfaInvite(database, "opaque-token", "rep-one", 41), true);
  assert.equal(await claimUsfaInvite(database, "opaque-token", "rep-one", 41), false);
});

test("USFA error receipts are retried while successful receipts remain idempotent", async () => {
  const source = await readFile(new URL("./usfaPoller.ts", import.meta.url), "utf8");
  assert.match(source, /prior && prior\.status !== "error"/);
  assert.match(source, /prior\?\.status === "error"/);
  assert.match(source, /tx\.delete\(usfaIntakeLogTable\)/);
});