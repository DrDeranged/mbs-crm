import { USFA_STATEMENT_SLOTS, type UsfaStatementLink } from "./usfa";

function safeUsfaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "usfundadvisor.ai" ||
        url.username || url.password || url.port || url.href.length > 4096) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Newest receipt wins for a slot, but older and unlabeled links stay accessible. */
export function collectUsfaStatementLinks(receipts: Array<{ metadata: unknown }>) {
  const labeled = new Map<UsfaStatementLink["slot"], string>();
  const unlabeled: string[] = [];
  for (const receipt of receipts) {
    const metadata = receipt.metadata && typeof receipt.metadata === "object"
      ? receipt.metadata as Record<string, unknown> : {};
    const bySlot = Array.isArray(metadata.statementLinksBySlot)
      ? metadata.statementLinksBySlot as UsfaStatementLink[] : [];
    for (const entry of bySlot) {
      if (!entry || !USFA_STATEMENT_SLOTS.includes(entry.slot)) continue;
      const url = safeUsfaUrl(entry.url);
      if (url && !labeled.has(entry.slot)) labeled.set(entry.slot, url);
    }
    const legacy = Array.isArray(metadata.statementLinks) ? metadata.statementLinks : [];
    for (const value of legacy) {
      const url = safeUsfaUrl(value);
      if (url && !unlabeled.includes(url)) unlabeled.push(url);
    }
  }
  const labeledLinks = USFA_STATEMENT_SLOTS.flatMap((slot) =>
    labeled.has(slot) ? [{ slot, url: labeled.get(slot)! }] : []);
  const labeledUrls = new Set(labeled.values());
  // Older receipts have URLs but no reliable A–D labels. Keep them accessible
  // without guessing which slot was filled in the original Sheet row.
  const links = [...labeledLinks, ...unlabeled.filter((url) => !labeledUrls.has(url))
    .map((url) => ({ url }))];
  return { links, storedLinkCount: links.length };
}