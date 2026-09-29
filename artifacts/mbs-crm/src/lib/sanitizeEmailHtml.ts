import DOMPurify, { type Config, type DOMPurify as DOMPurifyInstance } from "dompurify";

export const EMAIL_HTML_SANITIZE_POLICY: Config = {
  ALLOWED_TAGS: [
    "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "span", "strong",
    "u", "ul",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?:|mailto:|tel:)|[/?#]|(?:[^:/?#]+(?:[/?#]|$)))/i,
};

export function sanitizeEmailHtml(
  html: string,
  purifier: Pick<DOMPurifyInstance, "sanitize"> = DOMPurify,
): string {
  return purifier.sanitize(html, EMAIL_HTML_SANITIZE_POLICY);
}