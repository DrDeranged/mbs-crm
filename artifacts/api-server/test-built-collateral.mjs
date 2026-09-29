import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  getBrandLogoPng,
  getBrandLogoReversePng,
  renderCollateral,
} from "./dist/lib/collateralBuildProbe.mjs";

// Run from the workspace root, just like the published API. These are the
// bundled module exports, not the TypeScript source loaded by unit tests.
assert.equal(process.cwd(), fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, ""));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
for (const bytes of [getBrandLogoPng(), getBrandLogoReversePng()]) {
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), "packaged brand logo must be readable");
}
const rep = {
  name: "Preview Fixture",
  title: "Advisor",
  phone: "555-0100",
  email: "preview@example.test",
  slug: "preview-fixture",
};
const html = await renderCollateral({
  kind: "html", source: "<h1>Hello {{rep.name}}</h1>", rep, format: "pdf",
});
const bundledPng = await readFile(new URL("./dist/assets/campaigns/working-capital.png", import.meta.url));
const sourcePdf = await PDFDocument.create();
sourcePdf.addPage([612, 792]).drawText("Uploaded PDF fixture", { x: 50, y: 600 });
for (const [label, source, sourceFormat] of [
  ["bundled flyer", bundledPng, "png"],
  ["stored PNG", bundledPng, "png"],
  ["stored PDF", Buffer.from(await sourcePdf.save()), "pdf"],
]) {
  const output = await renderCollateral({
    kind: "image_overlay", source, sourceFormat, rep, format: "pdf",
  });
  const parsed = await PDFDocument.load(output);
  assert.equal(parsed.getPageCount(), 1, `${label} should render one personalized page`);
  assert.ok(output.length > source.length / 4, `${label} should retain artwork and rep band`);
}
assert.equal((await PDFDocument.load(html)).getPageCount(), 1);