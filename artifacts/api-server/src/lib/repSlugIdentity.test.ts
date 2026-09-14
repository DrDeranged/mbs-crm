import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { reservedSlugForEmail, getUserDisplayName } from "./authHelpers.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { createRepQrRouter, getRepPublicUrl, getRepQrPng, getRepQrSvg } from "../routes/repPublic.ts";

test("Ray reserved email mapping is exact and old Rahmare mapping is gone", () => {
  assert.equal(reservedSlugForEmail("rahmaredavis@gmail.com"), "ray");
  assert.equal(reservedSlugForEmail("ray@my-business-solutions.com"), "ray");
  assert.equal(reservedSlugForEmail("rahmare@my-business-solutions.com"), undefined);
});

test("Ray greeting fallback uses the canonical display name", () => {
  assert.equal(getUserDisplayName({ email: "rahmaredavis@gmail.com", name: null, slug: "ray" }), "Ray Davis");
  assert.equal(getUserDisplayName({ email: "ray@my-business-solutions.com", name: null, slug: "ray" }), "Ray Davis");
});

test("QR generators receive canonical web payloads through injected spies", async () => {
  const calls: Array<{ kind: string; payload: string; options: Record<string, unknown> }> = [];
  const qr = {
    toBuffer: async (payload: string, options: Record<string, unknown>) => {
      calls.push({ kind: "png", payload, options });
      return Buffer.from("png");
    },
    toString: async (payload: string, options: Record<string, unknown>) => {
      calls.push({ kind: "svg", payload, options });
      return "<svg />";
    },
  };
  const resolve = async () => ({
    user: { name: "Ray Davis", email: "ray@my-business-solutions.com", mobileNumber: null, slug: "ray" },
    replacementSlug: null,
  });

  assert.deepEqual(await getRepQrPng("retired-ray", { resolve, qr }), Buffer.from("png"));
  assert.equal(await getRepQrSvg("retired-ray", { resolve, qr }), "<svg />");
  assert.deepEqual(calls.map((call) => [call.kind, call.payload]), [
    ["png", getRepPublicUrl("ray")],
    ["svg", getRepPublicUrl("ray")],
  ]);
  assert.equal(calls[0]?.options.type, "png");
  assert.equal(calls[1]?.options.type, "svg");
});

test("injected QR router serves the expected binary content types", async () => {
  const app = express();
  const qr = {
    toBuffer: async () => Buffer.from("png"),
    toString: async () => "<svg />",
  };
  const resolve = async () => ({
    user: { name: "Ray Davis", email: "ray@my-business-solutions.com", mobileNumber: null, slug: "ray" },
    replacementSlug: null,
  });
  app.use(createRepQrRouter({ resolve, qr }));
  const server = createServer(app);
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const png = await fetch(`http://127.0.0.1:${address.port}/public/reps/rahmare/qr.png`);
    const svg = await fetch(`http://127.0.0.1:${address.port}/public/reps/rahmare/qr.svg`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type")?.split(";")[0], "image/png");
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get("content-type")?.split(";")[0], "image/svg+xml");
  } finally {
    await new Promise<void>((resolveServer, reject) => server.close((error) => error ? reject(error) : resolveServer()));
  }
});