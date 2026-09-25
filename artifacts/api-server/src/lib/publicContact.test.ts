import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getStarterEmailTemplates, injectTracking, renderTemplate } from "../routes/email";
import { MISSED_CALL_TEXT } from "./voicemail";

const forbidden = /555-0000|mybusinesssolutions\.com|support@/i;
const phone = "(908) 860-8507";
const email = "funding@my-business-solutions.com";
const phoneHref = "tel:+19088608507";

test("public application, status, chooser, and unsubscribe page markup has no placeholder contacts", () => {
  const pages = [
    resolve(import.meta.dirname, "../../../mbs-crm/src/pages/apply.tsx"),
    resolve(import.meta.dirname, "../../../mbs-crm/src/pages/application-status.tsx"),
    resolve(import.meta.dirname, "../../../mbs-crm/src/pages/rep-chooser.tsx"),
  ];
  for (const page of pages) {
    const markup = readFileSync(page, "utf8");
    assert.doesNotMatch(markup, forbidden, page);
    assert.ok(markup.includes(phone) && markup.includes(email) && markup.includes(phoneHref), page);
  }

  const unsubscribeRoute = readFileSync(resolve(import.meta.dirname, "../routes/email.ts"), "utf8");
  const unsubscribeMarkup = unsubscribeRoute.split('// --- Unsubscribe (no auth, but HMAC-signed token required) ---')[1]
    ?.split("// --- Send single email ---")[0];
  assert.ok(unsubscribeMarkup);
  assert.doesNotMatch(unsubscribeMarkup, forbidden);
  assert.ok(unsubscribeMarkup.includes(phone) && unsubscribeMarkup.includes(email) && unsubscribeMarkup.includes(phoneHref));

  const confirmationRoute = readFileSync(resolve(import.meta.dirname, "../routes/applications.ts"), "utf8");
  assert.doesNotMatch(confirmationRoute, forbidden);
  assert.ok(confirmationRoute.includes(phone) && confirmationRoute.includes(email) && confirmationRoute.includes(phoneHref));
});

test("rendered applicant-facing emails and voicemail follow-up SMS never contain placeholder contacts", () => {
  const names = ["Application Received", "Initial Follow-Up", "Document Request", "Status Update"];
  const templates = getStarterEmailTemplates().filter((template) => names.includes(template.name));
  assert.deepEqual(templates.map((template) => template.name), names);
  for (const template of templates) {
    const rendered = renderTemplate(template.bodyHtml, {
      lead_first_name: "Jane",
      lead_company: "Example Business",
      rep_name: "Advisor",
      rep_email: "advisor@my-business-solutions.com",
    });
    assert.doesNotMatch(`${renderTemplate(template.subject, {})} ${rendered}`, forbidden, template.name);
    assert.ok(rendered.includes(phone) && rendered.includes(email) && rendered.includes(phoneHref), template.name);
  }
  for (const template of getStarterEmailTemplates()) {
    const html = injectTracking(
      renderTemplate(template.bodyHtml, { lead_first_name: "Jane", lead_company: "Example Business", rep_name: "Advisor", rep_email: "advisor@my-business-solutions.com" }),
      1,
      "https://example.test",
      "jane@example.test",
    );
    assert.doesNotMatch(html, forbidden, template.name);
    assert.ok(html.includes(phone) && html.includes(email), template.name);
  }
  // Previously saved templates are normalized when rendered, without changing recipient-owned fields.
  const legacy = renderTemplate(
    '<a href="tel:+18005550000">800-555-0000</a> <a href="mailto:support@mybusinesssolutions.com">support@mybusinesssolutions.com</a>',
    {},
  );
  assert.doesNotMatch(legacy, forbidden);
  assert.ok(legacy.includes(phone) && legacy.includes(email) && legacy.includes(phoneHref));
  assert.doesNotMatch(MISSED_CALL_TEXT, forbidden);
  assert.ok(MISSED_CALL_TEXT.includes(phone) && MISSED_CALL_TEXT.includes(email));
});