export function isSlugRetirementAuthorized(user: { role?: string } | null | undefined): boolean {
  return user?.role === "admin";
}

export function requiresSlugRetirement(existingSlug: string | null, requestedSlug: string | undefined): boolean {
  return requestedSlug !== undefined && requestedSlug !== existingSlug && existingSlug !== null;
}