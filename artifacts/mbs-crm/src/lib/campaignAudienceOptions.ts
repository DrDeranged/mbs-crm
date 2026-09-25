const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  website: "Website",
  referral: "Referral",
  import: "Imported",
  "qr-card": "QR card",
  usfundadvisor: "US Fund Advisor",
};

export function campaignSourceOptions(
  sources: readonly { source: string; leadCount: number }[] = [],
): [string, string][] {
  const counts = new Map<string, number>();
  for (const { source, leadCount } of sources) {
    if (!source || leadCount <= 0) continue;
    counts.set(source, (counts.get(source) ?? 0) + leadCount);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([source, count]) => [source, `${SOURCE_LABELS[source] ?? source} (${count.toLocaleString()})`]);
}

export function campaignRepOptions<T extends {
  id: number;
  name?: string | null;
  email: string;
  isActive?: boolean;
  mergedInto?: number | null;
}>(users: readonly T[] = []): T[] {
  const byId = new Map<number, T>();
  for (const user of users) {
    if (!user.isActive || user.mergedInto != null || user.name?.trim().toLowerCase() === "any rep") continue;
    if (!byId.has(user.id)) byId.set(user.id, user);
  }
  return [...byId.values()].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email) || a.id - b.id);
}