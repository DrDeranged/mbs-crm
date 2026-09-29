import assert from "node:assert/strict";
import test from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { EMAIL_HTML_SANITIZE_POLICY, sanitizeEmailHtml } from "./sanitizeEmailHtml.ts";

const testWindow = new JSDOM("").window;
const testPurifier = createDOMPurify(testWindow);

test("removes hostile event handlers, executable elements, and javascript URLs", () => {
  const sanitized = sanitizeEmailHtml(
    '<p onclick="alert(1)">Hello<img src=x onerror=alert(2)>' +
    '<a href="javascript:alert(3)" onmouseover="alert(4)">open</a>' +
    '<a href="java&#x73;cript:alert(5)">bad link</a>' +
    '<script>alert(6)</script><iframe src="https://evil.test"></iframe></p>',
    testPurifier,
  );

  assert.equal(sanitized, "<p>Hello<a>open</a><a>bad link</a></p>");
  assert.doesNotMatch(sanitized, /onerror|onclick|onmouseover|javascript|alert|iframe|script/i);
});

test("preserves safe email formatting and links", () => {
  const sanitized = sanitizeEmailHtml(
    '<h2>Welcome</h2><p><strong>Thank you</strong> for your <em>interest</em>.</p>' +
    '<ul><li><a href="https://example.com/start" title="Get started">Get started</a></li></ul>' +
    '<p><u>Next steps</u><br>Regards</p>',
    testPurifier,
  );

  assert.equal(
    sanitized,
    '<h2>Welcome</h2><p><strong>Thank you</strong> for your <em>interest</em>.</p>' +
    '<ul><li><a href="https://example.com/start" title="Get started">Get started</a></li></ul>' +
    '<p><u>Next steps</u><br>Regards</p>',
  );
});

test("explicitly permits only intended formatting tags, attributes, and URI schemes", () => {
  assert.deepEqual(EMAIL_HTML_SANITIZE_POLICY.ALLOWED_ATTR, ["href", "title"]);
  assert.equal(EMAIL_HTML_SANITIZE_POLICY.ALLOW_DATA_ATTR, false);
  assert.equal(EMAIL_HTML_SANITIZE_POLICY.ALLOW_ARIA_ATTR, false);
  assert.equal(EMAIL_HTML_SANITIZE_POLICY.ALLOW_UNKNOWN_PROTOCOLS, false);
  assert.deepEqual(EMAIL_HTML_SANITIZE_POLICY.ALLOWED_TAGS, [
    "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "span", "strong",
    "u", "ul",
  ]);
});

test("sanitizes malformed namespace and tag nesting before preview insertion", () => {
  const sanitized = sanitizeEmailHtml(
    '<math><mtext><table><mglyph><style><!--</style>' +
    '<img title="--><img src=x onerror=alert(1)>">' +
    '<svg><g/onload=alert(2)//<a href="javascript:alert(3)">link',
    testPurifier,
  );
  const document = new JSDOM(sanitized).window.document;

  assert.equal(document.querySelector("math, mtext, mglyph, svg, g, style, img"), null);
  assert.equal(document.querySelector("[onerror], [onload]"), null);
  assert.doesNotMatch(sanitized, /javascript:/i);
});