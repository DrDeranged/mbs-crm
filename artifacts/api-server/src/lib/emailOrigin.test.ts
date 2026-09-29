import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import healthRouter from "../routes/health";
import { buildApplicationConfirmationEmail } from "./applicationConfirmationEmail";
import { CANONICAL_APP_ORIGIN, EMAIL_BRAND_LOGO_URL, ensureBrandEmailHeader, getEmailAppOrigin, getEmailOriginHealth } from "./brand";
import { sendTrackedEmailToProvider } from "../routes/email";
import { createStartupGate } from "./startupGate";

const previous = { node: process.env.NODE_ENV, url: process.env.PUBLIC_APP_URL };
function restore() {
  if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
  if (previous.url === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = previous.url;
}

test("production origin validation and boot, root and deep health", async () => {
  process.env.NODE_ENV = "production";
  const app = express();
  app.use("/api", healthRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const value of [undefined, "not a url", "http://app.my-business-solutions.com", "https://old.replit.app"]) {
      if (value === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = value;
      assert.equal(getEmailOriginHealth().valid, false);
      assert.throws(() => getEmailAppOrigin());
      for (const path of ["/api", "/api/healthz", "/api/health/deep"]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        assert.equal(response.status, 503, path);
        assert.equal((await response.json() as { status: string }).status, "degraded");
      }
      const gate = createStartupGate();
      let status = 0;
      gate.handler({ method: "GET", url: "/api/healthz" } as any, {
        setHeader() {},
        writeHead(code: number) { status = code; },
        end() {},
      } as any);
      assert.equal(status, 503);
    }
    process.env.PUBLIC_APP_URL = CANONICAL_APP_ORIGIN;
    assert.equal(getEmailOriginHealth().valid, true);
    for (const path of ["/api", "/api/healthz"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 200);
    }
    const gate = createStartupGate();
    let status = 0;
    gate.handler({ method: "GET", url: "/api/healthz" } as any, {
      setHeader() {},
      writeHead(code: number) { status = code; },
      end() {},
    } as any);
    assert.equal(status, 200);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("provider payloads for direct, campaign/drip, image-free and application confirmation use public URLs", async () => {
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_APP_URL = CANONICAL_APP_ORIGIN;
  try {
    const legacy = "https://old-deployment.replit.app";
    const external = "https://marketing.example.org/promo";
    for (const [name, bodyHtml, bodyText, noImages] of [
      ["direct", ensureBrandEmailHeader(`<a href="${legacy}/leads/42">Lead</a>`), `Lead: ${legacy}/leads/42`, false],
      ["campaign/drip", ensureBrandEmailHeader(`<a href="${external}">Offer</a><a href="${legacy}/apply">Apply</a>`), `Offer: ${external}\nApply: ${legacy}/apply`, false],
      ["no-image", `<a href="${legacy}/apply">Apply</a>`, `Apply: ${legacy}/apply`, true],
      ["application", buildApplicationConfirmationEmail("test-tracking-number"), `Check status: ${legacy}/apply/status`, false],
    ] as const) {
      let payload: any;
      await sendTrackedEmailToProvider({
        provider: { send: async (message: any) => { payload = message; return [{}] as any; } },
        from: { email: "funding@example.test", name: "MBS" },
        toEmail: "applicant@example.test",
        subject: name,
        bodyHtml,
        bodyText,
        sendId: 42,
        baseUrl: legacy,
        minimalNoImages: noImages,
      });
      assert.doesNotMatch(payload.html + payload.text, /replit\.app|replit%2eapp/i, name);
      assert.match(payload.html, /https:\/\/app\.my-business-solutions\.com\/api\/email\/unsubscribe/);
      assert.match(payload.html, /https:\/\/app\.my-business-solutions\.com\/api\/email\/track\/click/);
      assert.match(payload.text, /https:\/\/app\.my-business-solutions\.com\/api\/email\/unsubscribe/);
      if (noImages) {
        assert.doesNotMatch(payload.html, /<img|\/api\/email\/track\/open/i);
      } else {
        assert.match(payload.html, /https:\/\/app\.my-business-solutions\.com\/api\/email\/track\/open/);
        assert.match(payload.html, new RegExp(EMAIL_BRAND_LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      const clickDestinations = [...payload.html.matchAll(/\/api\/email\/track\/click\/42\?url=([^&"]+)/g)]
        .map((match: RegExpMatchArray) => decodeURIComponent(match[1]));
      if (name === "application") assert.ok(clickDestinations.includes(`${CANONICAL_APP_ORIGIN}/apply/status`));
      if (name === "campaign/drip") assert.ok(clickDestinations.includes("https://marketing.example.org/promo"));
    }
    delete process.env.PUBLIC_APP_URL;
    await assert.rejects(sendTrackedEmailToProvider({
      provider: { send: async () => { throw new Error("should not dispatch"); } },
      from: { email: "funding@example.test", name: "MBS" }, toEmail: "a@example.test",
      subject: "blocked", bodyHtml: "<p>Blocked</p>", sendId: 9, baseUrl: "https://old.replit.app",
    }));
  } finally { restore(); }
});