import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_COMPLIANCE_ADDRESS,
  EMAIL_MERGE_TOKEN_DOCUMENTATION,
  FROM_EMAIL,
  getStarterEmailTemplates,
  containsDataImageUri,
  injectTracking,
  renderTemplate,
  sendTrackedEmailToProvider,
  validateEmailTemplate,
} from "../routes/email";

const CONSENT = "You're receiving this as a business owner who may benefit from equipment or working-capital financing.";

test("documents and strictly rejects unknown merge tokens", () => {
  assert.equal(EMAIL_MERGE_TOKEN_DOCUMENTATION.lead_first_name, "{{lead_first_name}}");
  assert.deepEqual(validateEmailTemplate(
    "Hello {{lead_first_name}}",
    "<p>{{lead_company}} {{unsubscribe_link}} {{not_a_real_token}} {{lead.first}}</p>",
  ), ["not_a_real_token", "lead.first"]);
  assert.deepEqual(validateEmailTemplate("{{rep_email}}", "{{brand_email_header}}"), []);
});

test("data:image URIs are rejected separately from merge-token validation", () => {
  assert.equal(containsDataImageUri('<img src="data:image/png;base64,AAAA">'), true);
  assert.equal(containsDataImageUri("https://example.test/logo.png"), false);
  assert.deepEqual(validateEmailTemplate("Subject", '<img src="data:image/png;base64,{{not_a_token}}">'), ["not_a_token"]);
});

test("every inline starter template uses only supported merge tokens", () => {
  const templates = getStarterEmailTemplates();
  assert.ok(templates.length > 0);
  for (const template of templates) {
    assert.deepEqual(
      validateEmailTemplate(template.subject, template.bodyHtml),
      [],
      `${template.name} contains an unsupported merge token`,
    );
  }
});

test("rendering uses Hi there fallback and omits a missing company phrase", () => {
  const rendered = renderTemplate(
    "<p>Hi {{lead_first_name}},</p><p>Options for {{lead_company}}'s business.</p>",
    { lead_first_name: "", lead_company: "", rep_name: "", rep_email: "" },
  );
  assert.match(rendered, /Hi there,/);
  assert.doesNotMatch(rendered, /Hi ,/);
  assert.doesNotMatch(rendered, /for\s+['’]?s?\b/i);
  assert.doesNotMatch(rendered, /\{\{.+\}\}/);
});

test("supported per-send footer tokens render without creating a second footer", () => {
  const rendered = renderTemplate(
    "<p>{{unsubscribe_link}}</p><p>{{mailing_address}}</p>",
    { lead_first_name: "Jane", lead_company: "Acme" },
  );
  assert.match(rendered, /__MBS_UNSUBSCRIBE_LINK__/);
  assert.match(rendered, new RegExp(EMAIL_COMPLIANCE_ADDRESS));
});

test("HTML and plain-text compliance footer is exact once and never data URI", async () => {
  const existing = `<p>Already opted out: <a href="https://crm.test/api/email/unsubscribe?id=1&email=old@example.test&token=stale">Unsubscribe</a><br>${EMAIL_COMPLIANCE_ADDRESS}</p>`;
  const html = injectTracking(existing, 7, "https://crm.test", "person@example.test");
  assert.equal((html.match(new RegExp(EMAIL_COMPLIANCE_ADDRESS, "g")) ?? []).length, 1);
  assert.equal((html.match(/Unsubscribe/g) ?? []).length, 1);
  assert.match(html, /token=[a-f0-9]{64}/i);
  assert.doesNotMatch(html, /token=stale/);
  assert.equal((html.match(new RegExp(CONSENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
  assert.doesNotMatch(html, /data:image/i);
  const freshHtml = injectTracking("<p>Message</p>", 10, "https://crm.test", "person@example.test");
  assert.equal((freshHtml.match(/\/api\/email\/unsubscribe\b/g) ?? []).length, 1);
  const addressOnly = injectTracking(`<p>${EMAIL_COMPLIANCE_ADDRESS}</p>`, 11, "https://crm.test", "person@example.test");
  assert.equal((addressOnly.match(new RegExp(EMAIL_COMPLIANCE_ADDRESS, "g")) ?? []).length, 1);
  assert.equal((addressOnly.match(/\/api\/email\/unsubscribe\b/g) ?? []).length, 1);
  const unsubscribeOnly = injectTracking('<p><a href="https://crm.test/api/email/unsubscribe">Unsubscribe</a></p>', 12, "https://crm.test", "person@example.test");
  assert.equal((unsubscribeOnly.match(new RegExp(EMAIL_COMPLIANCE_ADDRESS, "g")) ?? []).length, 1);
  assert.equal((unsubscribeOnly.match(/\/api\/email\/unsubscribe\b/g) ?? []).length, 0);
  assert.equal((unsubscribeOnly.match(/Unsubscribe/g) ?? []).length, 1);
  assert.match(unsubscribeOnly, /token=[a-f0-9]{64}/i);

  let message: any;
  await sendTrackedEmailToProvider({
    provider: { send: async (value: any) => { message = value; return [{}] as any; } },
    from: { email: FROM_EMAIL, name: "MBS" },
    toEmail: "person@example.test",
    subject: "Test",
    bodyHtml: "<p>Hello</p>",
    bodyText: `Hello\n\n${CONSENT}`,
    sendId: 8,
    baseUrl: "https://crm.test",
  });
  assert.equal((message.text.match(new RegExp(EMAIL_COMPLIANCE_ADDRESS, "g")) ?? []).length, 1);
  assert.equal((message.text.match(new RegExp(CONSENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
  assert.match(message.text, /token=[a-f0-9]{64}/i);
  assert.ok(message.html.length < 30 * 1024);
});

test("provider dispatch keeps test-send Reply-To on the admin address", async () => {
  let message: any;
  await sendTrackedEmailToProvider({
    provider: { send: async (value: any) => { message = value; return [{}] as any; } },
    from: { email: FROM_EMAIL, name: "MBS" },
    replyTo: { email: "admin@my-business-solutions.com", name: "Admin" },
    toEmail: "test@example.test",
    subject: "Delivery test",
    bodyHtml: "<p>Delivery test</p>",
    sendId: 9,
    baseUrl: "https://crm.test",
  });
  assert.deepEqual(message.replyTo, { email: "admin@my-business-solutions.com", name: "Admin" });
});