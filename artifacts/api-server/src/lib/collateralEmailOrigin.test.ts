import assert from "node:assert/strict";
import test from "node:test";
import { sendCollateralEmail } from "../routes/collateral";
import { CANONICAL_APP_ORIGIN, EMAIL_BRAND_LOGO_URL } from "./brand";

test("collateral provider payload rewrites legacy CRM URLs, not unrelated destinations", async () => {
  const previous = { node: process.env.NODE_ENV, url: process.env.PUBLIC_APP_URL };
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_APP_URL = CANONICAL_APP_ORIGIN;
  let payload: any;
  const client = {
    setApiKey() {},
    send: async (message: any) => { payload = message; return {}; },
  };
  const input = {
    leadEmail: "applicant@example.test",
    repEmail: "rep@example.test",
    repName: "Rep",
    subject: "Financing",
    bodyHtml: '<a href="https://old.replit.app/apply/status">Application status</a><a href="https://marketing.example.org/promo">Offer</a><img src="https://old.replit.app/api/brand/logo.png">',
    templateName: "Offer",
    pdf: Buffer.from("test PDF"),
  };
  try {
    await sendCollateralEmail(client, input);
    assert.doesNotMatch(payload.html, /replit\.app/i);
    assert.match(payload.html, /https:\/\/app\.my-business-solutions\.com\/apply\/status/);
    assert.match(payload.html, /https:\/\/marketing\.example\.org\/promo/);
    assert.ok(payload.html.includes(EMAIL_BRAND_LOGO_URL));
    assert.equal(payload.attachments[0].filename, "Offer.pdf");
    delete process.env.PUBLIC_APP_URL;
    payload = null;
    await assert.rejects(sendCollateralEmail(client, input), /PUBLIC_APP_URL/);
    assert.equal(payload, null);
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
    if (previous.url === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = previous.url;
  }
});