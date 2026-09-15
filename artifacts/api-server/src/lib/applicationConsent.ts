import {
  CONSENT_CHECKBOX_LABEL,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  CONSENT_TITLE,
} from "./consentText";

/** Fields that are assigned by the server when an application is persisted. */
export function getServerOwnedApplicationConsent() {
  return { consentTextVersion: CONSENT_TEXT_VERSION } as const;
}

/** Public disclosure payload sourced directly from the immutable legal artifact. */
export function getPublicApplicationConsentText() {
  return {
    title: CONSENT_TITLE,
    text: CONSENT_TEXT,
    version: CONSENT_TEXT_VERSION,
    checkboxLabel: CONSENT_CHECKBOX_LABEL,
  } as const;
}