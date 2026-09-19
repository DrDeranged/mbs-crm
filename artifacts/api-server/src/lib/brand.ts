// Canonical MBS header asset. Keeping the bytes with the API lets a public,
// absolute API URL work in email clients and Puppeteer without a Vite asset hash.
const BRAND_LOGO_PNG_BASE64 = "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";

export const BRAND_LOGO_PATH = "/api/brand/logo.png";

export function getBrandLogoPng(): Buffer {
  return Buffer.from(BRAND_LOGO_PNG_BASE64.replace("fDxfDxfMtH", "fDxfMtH"), "base64");
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
  if (deploymentDomain) {
    const baseUrl = deploymentDomain.startsWith("http")
      ? deploymentDomain
      : `https://${deploymentDomain}`;
    return normalizeBaseUrl(baseUrl);
  }

  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  }

  return "http://localhost:80";
}

export function getBrandLogoUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl ?? getPublicBaseUrl())}${BRAND_LOGO_PATH}`;
}

export function createBrandEmailHeader(logoUrl: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-mbs-brand-header="true" style="margin:0 0 24px;border-collapse:collapse;background:#ffffff;border-bottom:1px solid #e2e8f0;">
  <tr><td style="padding:20px 24px;text-align:left;">
    <img src="${logoUrl}" alt="My Business Solutions" width="116" height="56" style="display:block;width:116px;height:auto;border:0;outline:none;text-decoration:none;" />
  </td></tr>
</table>`;
}

export function ensureBrandEmailHeader(bodyHtml: string, baseUrl?: string): string {
  const header = createBrandEmailHeader(getBrandLogoUrl(baseUrl));
  if (bodyHtml.includes("__MBS_BRAND_EMAIL_HEADER__")) {
    return bodyHtml.replaceAll("__MBS_BRAND_EMAIL_HEADER__", header);
  }
  return bodyHtml.includes('data-mbs-brand-header="true"') ? bodyHtml : `${header}${bodyHtml}`;
}

export function ensureFlyerBranding(html: string, baseUrl?: string): string {
  if (html.includes('data-mbs-flyer-logo="true"')) return html;
  const logo = `<div class="logo" data-mbs-flyer-logo="true" style="display:inline-block;background:#fff;border-radius:8px;padding:8px 10px;line-height:0;"><img src="${getBrandLogoUrl(baseUrl)}" alt="My Business Solutions" style="display:block;width:116px;height:auto;max-height:56px;" /></div>`;
  return html.replace(/<div class="logo">[\s\S]*?<\/div>/i, logo);
}