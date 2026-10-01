import type { Config, DOMPurify as DOMPurifyInstance } from "dompurify";

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

let domPurifyPromise: Promise<Pick<DOMPurifyInstance, "sanitize">> | undefined;

function loadDOMPurify(): Promise<Pick<DOMPurifyInstance, "sanitize">> {
  if (!domPurifyPromise) {
    domPurifyPromise = import("dompurify")
      .then(({ default: purifier }) => purifier)
      .catch((error: unknown) => {
        domPurifyPromise = undefined;
        throw error;
      });
  }
  return domPurifyPromise;
}

export async function sanitizeEmailHtml(
  html: string,
  purifier?: Pick<DOMPurifyInstance, "sanitize">,
): Promise<string> {
  if (!html) return "";
  const activePurifier = purifier ?? await loadDOMPurify();
  return activePurifier.sanitize(html, EMAIL_HTML_SANITIZE_POLICY);
}