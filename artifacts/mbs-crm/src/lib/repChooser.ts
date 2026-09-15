export type RepChooserData = {
  name: string | null;
  phone: string | null;
  slug?: string | null;
};

export const RAY_IDENTITY_REQUEST = {
  newSlug: "ray",
  displayName: "Ray Davis",
} as const;

export function canonicalRepSlug(rep: RepChooserData, requestedSlug: string): string {
  return rep.slug || requestedSlug;
}

export function repChooserSubtext(rep: RepChooserData): string | null {
  const firstName = rep.name?.trim().split(/\s+/)[0];
  return firstName ? `${firstName} will personally handle your application.` : null;
}

export function repChooserApplyHref(
  rep: RepChooserData,
  requestedSlug: string,
  basePath: string,
): string {
  const base = basePath.replace(/\/$/, "");
  return `${base}/apply?rep=${encodeURIComponent(canonicalRepSlug(rep, requestedSlug))}`;
}

export function repChooserAttribution(
  rep: RepChooserData,
  requestedSlug: string,
): string {
  return rep.name ? canonicalRepSlug(rep, requestedSlug) : "";
}