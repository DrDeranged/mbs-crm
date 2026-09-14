import { parseElementorPayload, type ElementorCaptureData } from "./elementorPayload";

export type ElementorCaptureResult =
  | { ok: true; data: ElementorCaptureData }
  | { ok: false; status: 400; body: { error: string } };

/**
 * Keep HTTP validation behavior separate from the Express route so malformed
 * webhook shapes can be tested without a database, multer, or endpoint call.
 */
export function parseElementorCaptureRequest(raw: unknown): ElementorCaptureResult {
  const parsed = parseElementorPayload(raw);
  return parsed.ok
    ? parsed
    : { ok: false, status: 400, body: { error: parsed.error } };
}