import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import test from "node:test";
import { createServer } from "node:http";
import { UsfaWebhookPayload, verifyUsfaWebhookSignature } from "./usfaIntake";
import usfaIntakeRouter from "./usfaIntake";

test("USFA webhook signature is HMAC-SHA256 over the exact raw body", () => {
  const body = Buffer.from('{"id":"row-1","revenue":15000}');
  const secret = "test-secret";
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyUsfaWebhookSignature(body, digest, secret), true);
  assert.equal(verifyUsfaWebhookSignature(body, `sha256=${digest}`, secret), true);
  assert.equal(verifyUsfaWebhookSignature(Buffer.from(`${body}\n`), digest, secret), false);
  assert.equal(verifyUsfaWebhookSignature(body, digest.slice(0, -1), secret), false);
});

test("USFA webhook rejects an invalid signature through the real Express route", async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, body) => { (req as typeof req & { rawBody?: Buffer }).rawBody = body; } }));
  app.use(usfaIntakeRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/intake/usfa`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-usfa-signature": "bad" },
    body: JSON.stringify({ id: "row-1", revenue: 15000 }),
  });
  assert.equal(response.status, 401);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("USFA webhook schema requires id and a monthly numeric revenue", () => {
  assert.equal(UsfaWebhookPayload.safeParse({ id: "row-1", revenue: 15000 }).success, true);
  const invalid = UsfaWebhookPayload.safeParse({ id: "row-1", revenue: "$15,000" });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.ok(invalid.error.issues.some((issue) => issue.path.join(".") === "revenue"));
  const unknown = UsfaWebhookPayload.safeParse({ id: "row-1", revenue: 15000, unexpected: true });
  assert.equal(unknown.success, false);
});