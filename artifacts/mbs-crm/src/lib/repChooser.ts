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

export function repChooserAttribution(
  rep: RepChooserData,
  requestedSlug: string,
): string {
  return rep.name ? canonicalRepSlug(rep, requestedSlug) : "";
}