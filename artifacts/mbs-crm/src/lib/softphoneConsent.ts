export type SmsConsentFields = {
  smsConsent?: boolean | null;
  smsConsentAt?: unknown;
  smsConsentIp?: unknown;
};

/** Texting is available only when the latest application has a complete consent record. */
export function hasRecordedSmsConsent(application: SmsConsentFields | null | undefined): boolean {
  return application?.smsConsent === true
    && Boolean(application.smsConsentAt)
    && Boolean(application.smsConsentIp);
}