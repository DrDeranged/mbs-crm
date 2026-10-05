import { createHash, timingSafeEqual } from "node:crypto";
import { REPLY_DOMAIN } from "./campaignAttribution";

export function authenticateInboundParse(authorization: string | undefined, secret: string | undefined) {
  if (!secret || !authorization || authorization.length > 2048 || !authorization.startsWith("Basic ")) return false;
  const actual = createHash("sha256").update(Buffer.from(authorization.slice(6), "base64")).digest();
  const expected = createHash("sha256").update(`mbs-parse:${secret}`).digest();
  return timingSafeEqual(actual, expected);
}
export function parseMailHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":"); if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    result[name] = result[name] ? `${result[name]}, ${line.slice(colon + 1).trim()}` : line.slice(colon + 1).trim();
  }
  return result;
}
export function automatedReply(headers: Record<string, string>, from: string) {
  return Boolean(headers["x-mbs-forwarded-reply"]) ||
    Boolean(headers["auto-submitted"] && headers["auto-submitted"].toLowerCase() !== "no") ||
    /^(bulk|junk|list)$/i.test(headers.precedence ?? "") ||
    Boolean(headers["x-autoreply"] || headers["x-autorespond"]) ||
    /^(mailer-daemon|postmaster|no-?reply)@/i.test(from) || from.toLowerCase().endsWith(`@${REPLY_DOMAIN}`);
}
export function safeMailbox(value: string): string | null {
  const candidate = value.match(/<([^<>]+)>/)?.[1] ?? value.trim();
  return /^[^\s@<>,;:\r\n]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(candidate) ? candidate.toLowerCase() : null;
}
export function replyAddressToken(envelope: string): string | null {
  try {
    const value = JSON.parse(envelope);
    if (!Array.isArray(value.to) || value.to.length !== 1 || typeof value.to[0] !== "string") return null;
    return new RegExp(`^r-([a-f0-9]{48})@${REPLY_DOMAIN.replaceAll(".", "\\.")}$`, "i").exec(value.to[0])?.[1].toLowerCase() ?? null;
  } catch { return null; }
}
export function replyDedupeKey(sendId: number, headers: Record<string, string>, from: string, subject: string, body: string, attachmentDigests: string[]) {
  const identity = headers["message-id"] || JSON.stringify({ from, subject, body, date: headers.date ?? null, attachmentDigests });
  return createHash("sha256").update(`${sendId}\0${identity}`).digest("hex");
}
export function safeReplyText(text: string, html: string) {
  // Store/render text only. Never run merchant-supplied HTML, remote images,
  // event handlers or javascript links in the CRM or forwarded envelope.
  return (text || html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .replace(/\0/g, "").slice(0, 100_000);
}
