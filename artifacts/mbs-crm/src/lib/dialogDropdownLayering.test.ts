import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const srcRoot = path.resolve(import.meta.dirname, "..");

test("dialog dropdowns portal above dialog content", async () => {
  const [css, select, popover, searchable] = await Promise.all([
    readFile(path.join(srcRoot, "index.css"), "utf8"),
    readFile(path.join(srcRoot, "components/ui/select.tsx"), "utf8"),
    readFile(path.join(srcRoot, "components/ui/popover.tsx"), "utf8"),
    readFile(path.join(srcRoot, "components/searchable-select.tsx"), "utf8"),
  ]);

  const dialogZ = Number(css.match(/--z-dialog:\s*(\d+)/)?.[1]);
  const popoverZ = Number(css.match(/--z-popover:\s*(\d+)/)?.[1]);
  assert.ok(popoverZ > dialogZ, "portaled dropdowns must be above dialogs");
  assert.match(select, /<SelectPrimitive\.Portal>/);
  assert.match(popover, /<PopoverPrimitive\.Portal>/);
  assert.match(select, /max-h-\[280px\] overflow-y-auto/);
  assert.match(searchable, /<PopoverContent[\s\S]*z-\[var\(--z-dialog-popover\)\]/);

  // The partner dialog uses the portaled searchable picker.
  const submissions = await readFile(
    path.join(srcRoot, "components/lender-submissions-panel.tsx"),
    "utf8",
  );
  assert.match(submissions, /Log partner submission[\s\S]*<SearchableSelect/);
});