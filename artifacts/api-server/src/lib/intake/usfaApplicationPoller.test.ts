import assert from "node:assert/strict";
import test from "node:test";
import { decodeGmailBase64, extractUsfaEmailIdentity, extractUsfaPdf } from "./usfaApplicationPoller";

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