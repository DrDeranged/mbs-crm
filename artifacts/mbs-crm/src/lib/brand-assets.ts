export type BrandLogoVariant = "light" | "reverse";

export const BRAND_LOGO_PATHS: Record<BrandLogoVariant, string> = {
  light: "brand/mbs-logo-green-slash.png",
  reverse: "brand/mbs-logo-green-slash-reverse.png",
};

export function brandLogoSrc(variant: BrandLogoVariant, baseUrl = "/"): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${BRAND_LOGO_PATHS[variant]}`;
}