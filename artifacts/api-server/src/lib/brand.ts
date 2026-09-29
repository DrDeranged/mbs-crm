import { readPackagedAsset } from "./packagedAsset";

export const BRAND_LOGO_PATH = "/api/brand/logo.png";
export const BRAND_LOGO_REVERSE_PATH = "/api/brand/logo-reverse.png";
/** The externally hosted mark used in every outbound email. */
export const EMAIL_BRAND_LOGO_URL = "https://app.my-business-solutions.com/brand/mbs-logo-green-slash.png";

export const CANONICAL_APP_ORIGIN = "https://app.my-business-solutions.com";

export function getBrandLogoPng(): Buffer {
  return readPackagedAsset("mbs-logo-green-slash.png");
}

export function getBrandLogoReversePng(): Buffer {
  return readPackagedAsset("mbs-logo-green-slash-reverse.png");
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Public application URL must use http or https");
  }
  if (process.env["NODE_ENV"] === "production" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use https in production");
  }
  return parsed.origin;
}

export function getPublicBaseUrl(): string {
  const configuredUrl = process.env["PUBLIC_APP_URL"] || process.env["API_BASE_URL"];
  if (configuredUrl) return normalizeBaseUrl(configuredUrl);
  const deploymentDomain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (deploymentDomain) return normalizeBaseUrl(deploymentDomain.startsWith("http") ? deploymentDomain : `https://${deploymentDomain}`);
  if (process.env["REPLIT_DEV_DOMAIN"]) return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  return "http://localhost:80";
}

export function getBrandLogoUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl ?? getPublicBaseUrl())}${BRAND_LOGO_PATH}`;
}

export function getBrandLogoReverseUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl ?? getPublicBaseUrl())}${BRAND_LOGO_REVERSE_PATH}`;
}

export function createBrandEmailHeader(logoUrl: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-mbs-brand-header="true" style="margin:0 0 24px;border-collapse:collapse;background:#ffffff;border-bottom:1px solid #e2e8f0;">
  <tr><td style="padding:20px 24px;text-align:left;">
    <img src="${logoUrl}" alt="My Business Solutions logo" width="116" height="51" style="display:block;width:116px;height:51px;border:0;outline:none;text-decoration:none;" />
  </td></tr>
</table>`;
}

export function ensureBrandEmailHeader(bodyHtml: string, baseUrl?: string): string {
  // Email clients must be able to fetch this without relying on the API host.
  // Keep baseUrl in the signature for callers, but intentionally do not use it.
  const header = createBrandEmailHeader(EMAIL_BRAND_LOGO_URL);
  if (bodyHtml.includes("__MBS_BRAND_EMAIL_HEADER__")) return bodyHtml.replaceAll("__MBS_BRAND_EMAIL_HEADER__", header);
  return bodyHtml.includes('data-mbs-brand-header="true"') ? bodyHtml : `${header}${bodyHtml}`;
}

export function ensureFlyerBranding(html: string, baseUrl?: string): string {
  if (html.includes('data-mbs-flyer-logo="true"')) return html;
  const logo = `<div class="logo" data-mbs-flyer-logo="true" style="display:inline-block;background:#fff;border-radius:8px;padding:8px 10px;line-height:0;"><img src="${getBrandLogoUrl(baseUrl)}" alt="My Business Solutions logo" style="display:block;width:116px;height:auto;max-height:56px;" /></div>`;
  return html.replace(/<div class="logo">[\s\S]*?<\/div>/i, logo);
}

/** Rewrite legacy application hosts but never rewrite unrelated external destinations. */
export function normalizeEmailAppUrls(content: string): string {
  const origin = getEmailAppOrigin();
  const rewrite = (raw: string): string => {
    try {
      const url = new URL(raw.replace(/&amp;/g, "&"));
      if (url.hostname.toLowerCase().endsWith(".replit.app") && url.protocol === "https:") {
        if (url.username || url.password || url.port) throw new Error("Untrusted legacy application URL");
        return `${origin}${url.pathname}${url.search}${url.hash}`.replace(/&/g, raw.includes("&amp;") ? "&amp;" : "&");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Untrusted legacy application URL") throw error;
    }
    return raw;
  };
  // Also handle URL-encoded destinations that may already exist in old templates.
  let result = content.replace(/https?:\/\/[^\s<>"']+/gi, rewrite);
  result = result.replace(/https?%3A%2F%2F(?:[a-z0-9.-]|%[0-9a-f]{2})+/gi, (raw) => {
    try { return encodeURIComponent(rewrite(decodeURIComponent(raw))); } catch { return raw; }
  });
  if (/replit\.app/i.test(result) || /replit%2eapp/i.test(result)) {
    throw new Error("Outbound email contains an untrusted deployment URL");
  }
  return result;
}

export function getEmailOriginHealth(): { configured: boolean; valid: boolean; reason: string | null } {
  try {
    const origin = getEmailAppOrigin();
    return { configured: !!process.env["PUBLIC_APP_URL"]?.trim(), valid: true, reason: null };
  } catch {
    return { configured: !!process.env["PUBLIC_APP_URL"]?.trim(), valid: false, reason: "invalid_public_app_url" };
  }
}

/** Email destinations never inherit a deployment or request host. */
export function getEmailAppOrigin(): string {
  const configured = process.env["PUBLIC_APP_URL"]?.trim();
  if (!configured) {
    if (process.env["NODE_ENV"] === "production") throw new Error("PUBLIC_APP_URL is required for outbound email");
    return "http://localhost:80";
  }
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("PUBLIC_APP_URL is invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.port ||
      (process.env["NODE_ENV"] === "production" && url.origin !== CANONICAL_APP_ORIGIN)) {
    throw new Error("PUBLIC_APP_URL must be the canonical HTTPS application origin in production");
  }
  return url.origin;
}
