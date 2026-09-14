export type SignatureInputMode = "draw" | "type";

export type SignatureReadiness = {
  ready: boolean;
  error: string | null;
};

const DRAWN_SIGNATURE_ERROR = "Unable to serialize drawn signature. Please clear the signature and draw it again.";

/** Serializes the live signature canvas without relying on a trimmed-canvas clone. */
export function serializeDrawnSignature(canvas: { toDataURL: (type: string) => string } | null): string {
  if (!canvas) throw new Error(DRAWN_SIGNATURE_ERROR);
  try {
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl) throw new Error(DRAWN_SIGNATURE_ERROR);
    return dataUrl;
  } catch {
    throw new Error(DRAWN_SIGNATURE_ERROR);
  }
}

/** Pure readiness/error rules used by the review-and-sign step. */
export function getSignatureReadiness(
  mode: SignatureInputMode,
  typedName: string,
  hasDrawnSignature: boolean,
): SignatureReadiness {
  if (mode === "type") {
    return typedName.trim().length >= 2
      ? { ready: true, error: null }
      : { ready: false, error: "Typed signature must be at least 2 characters." };
  }
  return hasDrawnSignature
    ? { ready: true, error: null }
    : { ready: false, error: "Drawn signature is required." };
}