import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, rgb } from "pdf-lib";
import {
  COMPANY_FOOTER,
  createRepMergeFields,
  defaultQrEncoder,
  mergeCollateralFields,
  preferredRepEmail,
  renderImageOverlayPdf,
  renderImageOverlayPng,
} from "./collateralPersonalization";

test("collateral merge fields prefer corporate email and omit absent optional values", async () => {
  const rep = { name: "Alex Rep", email: "alex@example.com", emails: ["alex@my-business-solutions.com"], slug: "alex" };
  assert.equal(preferredRepEmail(rep), "alex@my-business-solutions.com");
  const fields = await createRepMergeFields(rep);
  const html = mergeCollateralFields("{{rep.name}} {{rep.title}} {{rep.email}} {{companyFooter}}", fields);
  assert.match(html, /Alex Rep/);
  assert.match(html, /alex@my-business-solutions\.com/);
  assert.ok(!html.includes("—"));
  assert.ok(html.includes(COMPANY_FOOTER));
  assert.match(fields.rep.qrPng, /^data:image\/png;base64,/);
});

test("collateral merge fields omit optional title and phone lines", async () => {
  const fields = await createRepMergeFields({
    name: "Taylor Rep",
    email: "taylor@my-business-solutions.com",
    slug: "taylor",
  });
  const html = mergeCollateralFields(
    "{{rep.name}}\n{{rep.title}}\n{{rep.phone}}\n{{rep.email}}\n{{rep.qrPng}}",
    fields,
  );
  assert.match(html, /Taylor Rep/);
  assert.match(html, /taylor@my-business-solutions\.com/);
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /undefined|null/);
  assert.equal(fields.rep.title, "");
  assert.equal(fields.rep.phone, "");
});

test("QR encoder receives the exact rep URL and required brand-safe options", async () => {
  const calls: Array<{ value: string; options: unknown }> = [];
  const encoder = async (value: string, options: Parameters<typeof defaultQrEncoder>[1]) => {
    calls.push({ value, options });
    return defaultQrEncoder(value, options);
  };
  const fields = await createRepMergeFields({ name: "Alex", slug: "alex-123" }, encoder);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.value, "https://app.my-business-solutions.com/r/alex-123");
  assert.deepEqual(calls[0]?.options, {
    errorCorrectionLevel: "H",
    margin: 4,
    color: { dark: "#0B2948", light: "#FFFFFF" },
  });
  const png = Buffer.from(fields.rep.qrPng.split(",")[1] ?? "", "base64");
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(png.length > 100, "QR encoder returned an empty PNG");
});

test("PDF image overlay emits Letter output and explicitly rejects raster output without sharp", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawRectangle({ x: 0, y: 200, width: 612, height: 592 });
  const output = await renderImageOverlayPdf(Buffer.from(await source.save()), "pdf", {
    name: "Alex Rep", title: "Advisor", phone: "555-0100", email: "alex@my-business-solutions.com", slug: "alex",
  });
  const rendered = await PDFDocument.load(output);
  assert.equal(rendered.getPageCount(), 1);
  assert.deepEqual(rendered.getPage(0).getSize(), { width: 612, height: 792 });
  await assert.rejects(() => renderImageOverlayPng(), /sharp is not installed/);
});

test("image overlay does not mutate source bytes and retains artwork content above rep band", async () => {
  const sourceDocument = await PDFDocument.create();
  const sourcePage = sourceDocument.addPage([612, 792]);
  sourcePage.drawRectangle({ x: 0, y: 200, width: 612, height: 592, color: rgb(0.1, 0.2, 0.3) });
  sourcePage.drawText("ORIGINAL ARTWORK", { x: 40, y: 700 });
  const sourceBytes = Buffer.from(await sourceDocument.save());
  const before = Buffer.from(sourceBytes);
  const reloadedSource = await PDFDocument.load(sourceBytes);
  const sourceContents = reloadedSource.getPage(0).node.normalizedEntries().Contents as any;
  const sourceStreams = sourceContents.asArray().map((reference: any) =>
    Buffer.from((reloadedSource.context.lookup(reference) as any).getContents()));
  const output = await renderImageOverlayPdf(sourceBytes, "pdf", {
    name: "Alex Rep", title: "Advisor", phone: "555-0100",
    email: "alex@my-business-solutions.com", slug: "alex",
  });
  assert.deepEqual(sourceBytes, before);
  const rendered = await PDFDocument.load(output);
  const page = rendered.getPage(0);
  assert.deepEqual(page.getSize(), { width: 612, height: 792 });
  // The imported artwork stream remains on the page; the rep band is appended
  // afterward and starts at y=0, so content at y>=79.2 is untouched.
  const contents = page.node.normalizedEntries().Contents;
  assert.ok(contents, "expected page content streams");
  const streams = (contents as any).asArray().map((reference: any) =>
    Buffer.from((page.node.context.lookup(reference) as any).getContents()));
  assert.ok(streams.length >= 2, "expected original and rep-band content streams");
  for (const originalStream of sourceStreams) {
    assert.ok(
      streams.some((renderedStream: Buffer) => renderedStream.equals(originalStream)),
      "the imported artwork stream must remain byte-identical",
    );
  }
});