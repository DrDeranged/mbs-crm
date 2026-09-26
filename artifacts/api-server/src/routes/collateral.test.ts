import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import analyticsRouter from "./analytics";
import {
  campaignAssetHandler,
  campaignAssetPaths,
  campaignSourceBytes,
  canAccessCollateralRender,
  buildSignedCampaignFlyerUrl,
  detectCollateralFlyerContentType,
  isBundledVendorFlyer,
  listCollateralTemplatesHandler,
  normalizeCollateralFlyerDisplayName,
  readLibraryFlyerAsset,
  recordCollateralEmailDelivery,
  sendCollateralEmail,
} from "./collateral";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("collateral library detects only PNG/PDF bytes and normalizes flyer display names", () => {
  const png = Buffer.alloc(24);
  PNG_SIGNATURE.copy(png);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(360, 20);
  assert.equal(detectCollateralFlyerContentType(png), "image/png");
  assert.equal(detectCollateralFlyerContentType(Buffer.from("%PDF-1.7\n%%EOF")), "application/pdf");
  assert.throws(() => detectCollateralFlyerContentType(Buffer.from("not a flyer")), /valid PNG or PDF/);
  assert.equal(normalizeCollateralFlyerDisplayName("Rahmare Equipment Flyer"), "Ray Davis Equipment Flyer");
  assert.equal(normalizeCollateralFlyerDisplayName("Equipment Flyer", "Rahmare-vendor.png"), "Equipment Flyer — Ray Davis");
  assert.equal(normalizeCollateralFlyerDisplayName("Equipment Flyer", "vendor.png"), "Equipment Flyer");
});

test("campaign flyer helper returns an absolute signed URL for a bounded short-lived immutable asset", () => {
  const url = buildSignedCampaignFlyerUrl({
    templateId: 42,
    objectPath: "/objects/collateral-library/123e4567-e89b-12d3-a456-426614174000",
    digest: "a".repeat(64),
    generation: "171234567890",
    name: "Approved Flyer",
    contentType: "application/pdf",
  }, 7 * 24 * 60 * 60);
  assert.match(url, /^https?:\/\/[^/]+\/api\/collateral\/flyers\/public\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.throws(() => buildSignedCampaignFlyerUrl({
    templateId: 42,
    objectPath: "/objects/uploads/mutable",
    digest: "a".repeat(64),
    generation: "1",
    name: "Bad",
    contentType: "image/png",
  }), /Invalid approved campaign flyer/);
  assert.throws(() => buildSignedCampaignFlyerUrl({
    templateId: 42,
    objectPath: "/objects/collateral-library/123e4567-e89b-12d3-a456-426614174000",
    digest: "a".repeat(64),
    generation: "1",
    name: "Bad",
    contentType: "image/png",
  }, 7 * 24 * 60 * 60 + 1), /Invalid approved campaign flyer/);
  assert.throws(() => buildSignedCampaignFlyerUrl({
    templateId: 42, objectPath: "mbs://campaign/equipment-financing",
    digest: "a".repeat(64), generation: "built-in",
    name: "Unregistered built-in", contentType: "image/png",
  }), /Invalid approved campaign flyer/);
});

test("four vendor flyers are bundled as pinned PNGs without replacing the original two built-ins", async () => {
  const approved = [
    ["yellow-iron", "b06fb1de80e77e9174f43c028dbc18a35df254c090130c8e09958484ee77826d", 173267],
    ["trucking", "b1484648fde8e255e352d9cd6bc772fd52b70910c195ce6658a1bb5f784b11ed", 173962],
    ["restaurants", "3478e2ee8b2e5e795ebf9feee21a93fbc3d21d54bc21f693f491961afb086632", 185410],
    ["amusement", "879215ac98cfa18a132b331a5a21d3529721c26aaf1f6e4fb682f47589851579", 173436],
  ] as const;
  for (const [vertical, digest, size] of approved) {
    const sourceKey = `mbs://campaign/vendor-equipment-${vertical}`;
    assert.equal(isBundledVendorFlyer(sourceKey), true);
    const asset = await readLibraryFlyerAsset(sourceKey);
    assert.equal(asset.contentType, "image/png");
    assert.equal(asset.size, size);
    assert.equal(asset.generation, "built-in");
    assert.equal(createHash("sha256").update(asset.bytes).digest("hex"), digest);
    assert.match(buildSignedCampaignFlyerUrl({
      templateId: 42, objectPath: sourceKey, digest,
      generation: asset.generation, name: "Bundled vendor flyer", contentType: "image/png",
    }), /\/api\/collateral\/flyers\/public\//);
    assert.throws(() => buildSignedCampaignFlyerUrl({
      templateId: 42, objectPath: sourceKey, digest,
      generation: "mutable", name: "Bad", contentType: "image/png",
    }), /Invalid approved campaign flyer/);
  }
  for (const key of ["equipment-financing", "working-capital"]) {
    assert.equal(isBundledVendorFlyer(`mbs://campaign/${key}`), false);
    assert((await campaignSourceBytes(`mbs://campaign/${key}`))?.length);
  }
});

test("campaign collateral resolves independently of the process working directory", async () => {
  const originalCwd = process.cwd();
  process.chdir("/tmp");
  try {
    for (const sourceKey of [
      "mbs://campaign/working-capital",
      "mbs://campaign/equipment-financing",
    ]) {
      const bytes = await campaignSourceBytes(sourceKey);
      assert(bytes);
      assert(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
      assert(bytes.length > 1_000_000);
    }
  } finally {
    process.chdir(originalCwd);
  }
});

test("campaign collateral supports bundled assets and unknown keys safely", async () => {
  const bundledModuleUrl = new URL("../dist/chunks/collateral-test.mjs", import.meta.url).href;
  const paths = campaignAssetPaths("mbs://campaign/working-capital", bundledModuleUrl);
  assert.equal(paths.length, 2);
  assert.match(paths[1]!, /dist\/assets\/campaigns\/working-capital\.png$/);
  assert.equal(await campaignSourceBytes("mbs://campaign/not-configured"), null);
  assert.deepEqual(campaignAssetPaths("mbs://campaign/not-configured"), []);

  const sourcePaths = campaignAssetPaths("mbs://campaign/equipment-financing");
  assert.equal((await stat(sourcePaths[0]!)).isFile(), true);
});

test("campaign preview and download endpoints return PNGs with private response headers", async () => {
  const png = Buffer.concat([PNG_SIGNATURE, Buffer.from("campaign")]);
  const app = express();
  const deps = {
    getUser: async () => ({ id: 1, role: "admin" }) as any,
    readSource: async (sourceKey: string) => sourceKey.endsWith("/missing") ? null : png,
  };
  app.get("/preview/:slug", campaignAssetHandler("inline", deps));
  app.get("/download/:slug", campaignAssetHandler("attachment", deps));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const preview = await fetch(`${origin}/preview/working-capital`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type") || "", /^image\/png/);
    assert.equal(preview.headers.get("content-disposition"), 'inline; filename="working-capital.png"');
    assert.equal(preview.headers.get("cache-control"), "private, max-age=3600");
    assert(Buffer.from(await preview.arrayBuffer()).equals(png));

    const download = await fetch(`${origin}/download/equipment-financing`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="equipment-financing.png"');
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert(Buffer.from(await download.arrayBuffer()).equals(png));

    const missing = await fetch(`${origin}/preview/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Campaign asset not found" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("reps cannot access another rep's collateral render", () => {
  assert.equal(canAccessCollateralRender({ id: 7, role: "rep" }, 7), true);
  assert.equal(canAccessCollateralRender({ id: 7, role: "rep" }, 8), false);
  assert.equal(canAccessCollateralRender({ id: 1, role: "admin" }, 8), true);
});

test("admin can request draft collateral without analytics rejecting its query", async () => {
  let includedDrafts = false;
  const app = express();
  app.use("/api", analyticsRouter);
  app.get("/api/collateral/templates", listCollateralTemplatesHandler({
    getUser: async () => ({ id: 1, role: "admin" }) as any,
    listTemplates: async (includeDrafts) => {
      includedDrafts = includeDrafts;
      return [];
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/collateral/templates?includeDrafts=true`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.equal(includedDrafts, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("collateral email sends a PDF attachment through the injected SendGrid client", async () => {
  const calls: unknown[] = [];
  const client = {
    setApiKey: (key: string) => calls.push(["key", key]),
    send: async (message: unknown) => { calls.push(message); },
  };
  const pdf = Buffer.from("%PDF-test");
  await sendCollateralEmail(client, {
    leadEmail: "lead@example.com",
    repEmail: "rep@my-business-solutions.com",
    repName: "Alex Rep",
    subject: "A resource",
    bodyHtml: "<p>Hello</p>",
    templateName: "Business Flyer",
    pdf,
  });
  assert.equal(calls.length, 2);
  const message = calls[1] as any;
  assert.equal(message.to, "lead@example.com");
  assert.deepEqual(message.replyTo, { email: "rep@my-business-solutions.com", name: "Alex Rep" });
  assert.equal(message.attachments[0].content, pdf.toString("base64"));
  assert.equal(message.attachments[0].filename, "Business Flyer.pdf");
  assert.equal(message.attachments[0].type, "application/pdf");
  assert.equal(message.attachments[0].disposition, "attachment");
});

test("collateral email delivery associates the render and logs lead activity", async () => {
  const associations: Array<[number, number]> = [];
  const activities: any[] = [];
  await recordCollateralEmailDelivery({
    associateRender: async (renderId, leadId) => { associations.push([renderId, leadId]); },
    writeActivity: async (params) => { activities.push(params); },
  }, {
    renderId: 12,
    templateId: 4,
    leadId: 88,
    userId: 7,
    recipientEmail: "lead@example.com",
  });
  assert.deepEqual(associations, [[12, 88]]);
  assert.deepEqual(activities, [{
    userId: 7,
    leadId: 88,
    action: "collateral_emailed",
    entityType: "collateral_render",
    entityId: 12,
    details: { templateId: 4, to: "lead@example.com" },
  }]);
});