import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  COMPANY_FOOTER,
  createRepMergeFields,
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