import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

export type GreetingKind = "business" | "after-hours";

function signingKey(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is required for greeting uploads");
  return key;
}

export function createGreetingUploadGrant(path: string, kind: GreetingKind, userId: number): string {
  const payload = Buffer.from(JSON.stringify({ path, kind, userId, expires: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", signingKey()).update(payload).digest("base64url")}`;
}

export function verifyGreetingUploadGrant(token: string, path: string, kind: GreetingKind, userId: number): boolean {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  let provided: Buffer;
  try { provided = Buffer.from(signature, "base64url"); } catch { return false; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.path === path && data.kind === kind && data.userId === userId
      && Number.isFinite(data.expires) && Date.now() <= data.expires;
  } catch { return false; }
}

export function isValidGreetingMp3(bytes: Buffer, contentType: string): boolean {
  return contentType === "audio/mpeg"
    && bytes.length > 3 && bytes.length <= 2 * 1024 * 1024
    && (bytes.subarray(0, 3).toString("ascii") === "ID3"
      || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0));
}

export async function resolveGreetingAudioUrl(path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await new ObjectStorageService().getTelephonyGreetingPlaybackURL(path);
  } catch (error) {
    logger.warn({ err: error }, "Greeting audio unavailable; using text-to-speech");
    return undefined;
  }
}