import assert from "node:assert/strict";
import test from "node:test";
import { decodeGmailBase64, extractUsfaEmailIdentity, extractUsfaPdf, listAllMessages, usfaDocumentFileKey } from "./usfaApplicationPoller";

const encoded = (value: string) => Buffer.from(value).toString("base64url");

test("extracts a PDF attachment and vendor identity without fetching statement links", () => {
  const message = {
    id: "gmail-1",
    payload: {
      parts: [
        { mimeType: "text/plain", body: { data: encoded("USFA ID: row-42\nCompany: Doe Street\nEmail: owner@example.com") } },
        { mimeType: "application/pdf", filename: "Lead Application.pdf", body: { data: encoded("%PDF-1.7") } },
      ],
    },
  };
  assert.deepEqual(extractUsfaEmailIdentity(message), {
    externalId: "row-42", company: "Doe Street", email: "owner@example.com",
  });
  assert.equal(extractUsfaPdf(message)?.data.toString(), "%PDF-1.7");
  assert.equal(decodeGmailBase64(encoded("safe")).toString(), "safe");
});

test("does not treat a message without a PDF as an application", () => {
  const message = { payload: { parts: [{ mimeType: "text/plain", body: { data: encoded("Email: owner@example.com") } }] } };
  assert.equal(extractUsfaPdf(message), null);
});

test("delegated Gmail worker is safely disarmed without credentials", async () => {
  const previous = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const previousSubject = process.env.GOOGLE_WORKSPACE_DELEGATION_SUBJECT;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const { runUsfaApplicationPoll } = await import("./usfaApplicationPoller");
  const result = await runUsfaApplicationPoll();
  assert.equal(result.status, "skipped");
  if (previous) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = previous;
  if (previousSubject) process.env.GOOGLE_WORKSPACE_DELEGATION_SUBJECT = previousSubject;
});

test("Gmail listing paginates every page without any write operation", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    users: {
      messages: {
        list: async (params: Record<string, unknown>) => {
          calls.push(params);
          return params.pageToken
            ? { data: { messages: [{ id: "page-2" }] } }
            : { data: { messages: [{ id: "page-1" }], nextPageToken: "next-page" } };
        },
      },
    },
  } as never;
  assert.deepEqual(await listAllMessages(client, "to:funding subject:\"Lead Application\""), [{ id: "page-1" }, { id: "page-2" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.maxResults === 100), true);
  assert.equal(calls.some((call) => "modify" in call || "trash" in call), false);
});

test("Gmail retries use one deterministic object key and source-level idempotency guard", async () => {
  assert.equal(usfaDocumentFileKey(42, "gmail-1"), "leads/42/documents/usfa-application-gmail-1.pdf");
  const source = (await import("node:fs/promises")).readFile(new URL("./usfaApplicationPoller.ts", import.meta.url), "utf8");
  assert.match(await source, /pg_advisory_xact_lock/);
  assert.match(await source, /onConflictDoNothing\(\)/);
  assert.match(await source, /status: "processing"/);
});