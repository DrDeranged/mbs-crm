import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

/** Parse and validate the ENCRYPTION_KEY env var as a 32-byte Buffer from 64 hex chars. */
function getKey(): Buffer {
  const raw = process.env["ENCRYPTION_KEY"] ?? "";
  if (!raw) throw new Error("ENCRYPTION_KEY env var is not set");
  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      "ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)"
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a colon-delimited string: `iv:authTag:ciphertext` (all hex).
 * Throws if ENCRYPTION_KEY is absent or malformed — callers must not swallow this error.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a colon-delimited `iv:authTag:ciphertext` string produced by `encrypt`.
 * Returns the original plaintext.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, authTagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !dataHex) throw new Error("Invalid ciphertext format");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Returns a masked SSN string: ***-**-1234 */
export function maskSsn(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  return `***-**-${digits.slice(-4)}`;
}
