import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("../index.css");

test("dense contact tables use breakpoint-scoped readable widths, not global card nowrap", () => {
  assert.match(css, /@media \(min-width: 768px\) \{\s*\.leads-data-table \{ min-width: 1440px; \}\s*\.deals-data-table \{ min-width: 1200px; \}/);
  assert.match(css, /table \[data-contact-link="email"\] \{ white-space: nowrap;/);
  assert.match(css, /table \[data-contact-link="email"\] > span \{ word-break: normal; overflow-wrap: normal;/);
});

test("email sizing hooks preserve the existing composer and mobile/card wrapping", () => {
  const link = source("../components/phone-link.tsx");
  assert.match(link, /data-contact-link="email"/);
  assert.match(link, /<span className="break-all">\{email\}<\/span>/);
  assert.match(link, /openEmailComposer\(leadId\)/);
  assert.match(link, /href=\{target.href\}/);
});

test("both record lists opt into table scrolling with a readable email header", () => {
  const leads = source("../pages/leads.tsx");
  const deals = source("../pages/deals.tsx");
  assert.match(leads, /overflow-x-auto">\s*<Table className="leads-data-table">/);
  assert.match(leads, /<TableHead className="min-w-60">Email<\/TableHead>/);
  assert.match(deals, /<Table className="deals-data-table">/);
  assert.match(deals, /<TableHead className="md:min-w-72">Deal \/ Contact<\/TableHead>/);
  assert.match(source("../components/ui/table.tsx"), /relative w-full overflow-auto/);
});