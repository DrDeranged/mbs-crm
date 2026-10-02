export function contactName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

export function entityLabel(
  companyName: string | null | undefined,
  personName: string | null | undefined,
  fallback: string,
): string {
  const company = companyName?.trim() ?? "";
  const contact = personName?.trim() ?? "";
  if (company && contact) return `${company} — ${contact}`;
  return company || contact || fallback;
}