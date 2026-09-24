import twilio from "twilio";
import { db, companySettingsTable } from "@workspace/db";

export const DEFAULT_TELEPHONY_NUMBER = "+19088608507";
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function resolveTelephonySettings(
  settings: { voiceCallerId?: string | null; smsSenderNumber?: string | null } | undefined,
  env = process.env,
): { voiceCallerId: string; smsSenderNumber: string } {
  const configured = env["TWILIO_PHONE_NUMBER"]?.trim();
  const fallback = configured && isValidE164(configured) ? configured : DEFAULT_TELEPHONY_NUMBER;
  return {
    voiceCallerId: settings?.voiceCallerId && isValidE164(settings.voiceCallerId)
      ? settings.voiceCallerId
      : fallback,
    smsSenderNumber: settings?.smsSenderNumber && isValidE164(settings.smsSenderNumber)
      ? settings.smsSenderNumber
      : fallback,
  };
}

export async function getTelephonySettings(): Promise<Record<string, unknown> & {
  voiceCallerId: string;
  smsSenderNumber: string;
}> {
  const [settings] = await db
    .select()
    .from(companySettingsTable)
    .limit(1);
  return {
    ...(settings ?? {}),
    ...resolveTelephonySettings(settings),
  };
}

export async function listOwnedTwilioNumbers(): Promise<Array<{
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}>> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  if (!accountSid || !authToken) {
    throw new Error("Twilio owned-number lookup unavailable");
  }
  try {
    const client = twilio(accountSid, authToken);
    const numbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
    return numbers
      .filter((number) => typeof number.phoneNumber === "string" && isValidE164(number.phoneNumber))
      .map((number) => ({
        sid: number.sid,
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName || number.phoneNumber,
      }));
  } catch {
    // Do not turn provider failure into an empty inventory: callers use an
    // empty inventory to mean that the account has no owned numbers.
    throw new Error("Twilio owned-number lookup unavailable");
  }
}