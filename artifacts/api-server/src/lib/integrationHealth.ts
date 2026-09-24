import twilio from "twilio";
import { getTelephonySettings, listOwnedTwilioNumbers } from "./telephonySettings";

export type TwilioFailureReason =
  | "missing:TWILIO_ACCOUNT_SID"
  | "missing:TWILIO_AUTH_TOKEN"
  | "missing:TWILIO_API_KEY"
  | "missing:TWILIO_API_SECRET"
  | "missing:TWILIO_TWIML_APP_SID"
  | "invalid:TWILIO_TWIML_APP_SID";

const TWIML_APP_SID_PATTERN = /^AP[0-9a-fA-F]{32}$/;

export function getTwilioFailureReason(env = process.env): TwilioFailureReason | null {
  if (!env["TWILIO_ACCOUNT_SID"]) return "missing:TWILIO_ACCOUNT_SID";
  if (!env["TWILIO_AUTH_TOKEN"]) return "missing:TWILIO_AUTH_TOKEN";
  if (!env["TWILIO_API_KEY"]) return "missing:TWILIO_API_KEY";
  if (!env["TWILIO_API_SECRET"]) return "missing:TWILIO_API_SECRET";
  if (!env["TWILIO_TWIML_APP_SID"]) return "missing:TWILIO_TWIML_APP_SID";
  if (!TWIML_APP_SID_PATTERN.test(env["TWILIO_TWIML_APP_SID"]!)) {
    return "invalid:TWILIO_TWIML_APP_SID";
  }
  return null;
}

export function mintVoiceToken(identity: string, env = process.env): string {
  const reason = getTwilioFailureReason(env);
  if (reason) throw new Error(reason);
  const token = new twilio.jwt.AccessToken(
    env["TWILIO_ACCOUNT_SID"]!,
    env["TWILIO_API_KEY"]!,
    env["TWILIO_API_SECRET"]!,
    { identity },
  );
  token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({
    outgoingApplicationSid: env["TWILIO_TWIML_APP_SID"]!,
    incomingAllow: true,
  }));
  return token.toJwt();
}

function safeVoiceFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("missing:") || message.startsWith("invalid:")) return message;
  if (/timed out|timeout/i.test(message)) return "timeout";
  return "token_mint_failed";
}

export function createIntegrationHealthProbe({
  env = () => process.env,
  mint = () => mintVoiceToken("health_check", env()),
  now = Date.now,
  timeoutMs = 3_000,
  cacheMs = 10 * 60 * 1_000,
}: {
  env?: () => NodeJS.ProcessEnv;
  mint?: () => string | Promise<string>;
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
} = {}) {
  let cached: { until: number; value: object } | undefined;
  let inFlight: Promise<object> | undefined;

  async function inspect() {
    const values = env();
    const twimlPresent = !!values["TWILIO_TWIML_APP_SID"];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    let voiceToken: string;
    try {
      await Promise.race([Promise.resolve().then(mint), timeout]);
      voiceToken = "ok";
    } catch (error) {
      voiceToken = `fail:${safeVoiceFailure(error)}`;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return {
      twilio: {
        accountSid: !!values["TWILIO_ACCOUNT_SID"],
        authToken: !!values["TWILIO_AUTH_TOKEN"],
        apiKey: !!values["TWILIO_API_KEY"],
        apiSecret: !!values["TWILIO_API_SECRET"],
        twimlAppSid: twimlPresent,
        phoneNumber: !!values["TWILIO_PHONE_NUMBER"],
        twimlAppSidFormat: twimlPresent && TWIML_APP_SID_PATTERN.test(values["TWILIO_TWIML_APP_SID"]!)
          ? "valid" : "invalid",
        voiceToken,
      },
      sendgrid: {
        apiKey: !!values["SENDGRID_API_KEY"],
        fromEmail: !!values["SENDGRID_FROM_EMAIL"],
        fromName: !!values["SENDGRID_FROM_NAME"],
        webhookKey: !!values["SENDGRID_WEBHOOK_VERIFICATION_KEY"],
        openTracking: true,
        clickTracking: true,
        providerOpenTracking: false,
        providerClickTracking: false,
      },
    };
  }

  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.value);
    if (!inFlight) {
      inFlight = inspect().then((value) => {
        cached = { value, until: now() + cacheMs };
        return value;
      }).finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
}

export const getIntegrationHealth = createIntegrationHealthProbe();

type TelephonyNumberHealth = {
  phoneNumber: string;
  sid: string;
  owned: boolean;
  configuredRoles: { voice: boolean; sms: boolean };
  messagingServiceMembership: "member" | "not_member" | "unknown";
};
type TelephonyHealthResult = {
  status: "ok" | "degraded" | "unknown";
  messagingServiceSidConfigured: boolean;
  numbers: TelephonyNumberHealth[];
  error?: string;
};

const REQUIRED_TELEPHONY_NUMBERS = ["+19088608507", "+19084987548"] as const;

export function buildTelephonyNumberHealth(
  owned: Array<{ sid: string; phoneNumber: string; friendlyName: string }>,
  settings: { voiceCallerId: string; smsSenderNumber: string },
): TelephonyNumberHealth[] {
  const ownedByPhone = new Map(owned.map((number) => [number.phoneNumber, number]));
  return REQUIRED_TELEPHONY_NUMBERS.map((phoneNumber) => {
    const number = ownedByPhone.get(phoneNumber);
    return {
    phoneNumber,
    sid: number?.sid ?? "",
    owned: Boolean(number),
    configuredRoles: {
      voice: phoneNumber === settings.voiceCallerId,
      sms: phoneNumber === settings.smsSenderNumber,
    },
    messagingServiceMembership: "unknown",
  };
  });
}

/**
 * Read-only provider inspection for the deep health endpoint. This intentionally
 * reports presence and relationship state only; no Twilio response or credential
 * is returned to callers.
 */
export async function getTwilioTelephonyHealth(
  env = process.env,
  timeoutMs = 5_000,
): Promise<TelephonyHealthResult> {
  const accountSid = env["TWILIO_ACCOUNT_SID"];
  const authToken = env["TWILIO_AUTH_TOKEN"];
  const apiKey = env["TWILIO_API_KEY"];
  const apiSecret = env["TWILIO_API_SECRET"];
  const serviceSid = env["TWILIO_MESSAGING_SERVICE_SID"];
  if (!accountSid || !(authToken || (apiKey && apiSecret))) {
    return {
      status: "unknown",
      messagingServiceSidConfigured: Boolean(serviceSid),
      numbers: buildTelephonyNumberHealth([], { voiceCallerId: "", smsSenderNumber: "" }),
      error: "Twilio credentials are not configured",
    };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inspection: Promise<TelephonyHealthResult> = (async () => {
   try {
    const settings = await getTelephonySettings();
    const owned = await listOwnedTwilioNumbers();
    // Include every account-owned number, including numbers not selected in
    // settings, so secondary lines are visible in health diagnostics.
    const numbers = buildTelephonyNumberHealth(owned, settings);
    const client = apiKey && apiSecret
      ? twilio(apiKey, apiSecret, { accountSid })
      : twilio(accountSid, authToken);
    const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const memberships = new Map<string, Set<string>>();
    const services = serviceSid
      ? [{ sid: serviceSid }]
      : await withTimeout(client.messaging.v1.services.list({ limit: 20 }));
    // A bounded list cannot prove non-membership when it reaches its limit.
    let membershipInspectionFailed = !serviceSid && services.length >= 20;
    for (const service of services) {
      try {
        const members = await withTimeout(client.messaging.v1.services(service.sid).phoneNumbers.list({ limit: 100 }));
        if (members.length >= 100) membershipInspectionFailed = true;
        for (const member of members) {
          const phone = (member as unknown as { phoneNumber?: string; phone_number?: string }).phoneNumber
            ?? (member as unknown as { phone_number?: string }).phone_number;
          if (phone) {
            const set = memberships.get(phone) ?? new Set<string>();
            set.add(service.sid);
            memberships.set(phone, set);
          }
        }
      } catch {
        // An individual service may be inaccessible; preserve unknown state.
        membershipInspectionFailed = true;
      }
    }
    for (const number of numbers) {
      const member = memberships.get(number.phoneNumber);
      number.messagingServiceMembership = member
        ? (serviceSid ? (member.has(serviceSid) ? "member" : "not_member") : "member")
        : (membershipInspectionFailed ? "unknown" : "not_member");
    }
    const requiredNumbersReady = numbers.every((number) =>
      number.owned && number.messagingServiceMembership === "member"
      && (!number.configuredRoles.voice || number.owned)
      && (!number.configuredRoles.sms || number.owned),
    );
    const selectedRolesReady = numbers.some((number) => number.configuredRoles.voice && number.owned && number.messagingServiceMembership === "member")
      && numbers.some((number) => number.configuredRoles.sms && number.owned && number.messagingServiceMembership === "member");
    const status = numbers.some((number) => number.messagingServiceMembership === "unknown")
      ? "unknown" : requiredNumbersReady && selectedRolesReady ? "ok" : "degraded";
    return { status, messagingServiceSidConfigured: Boolean(serviceSid), numbers };
   } catch (error) {
    return {
      status: "unknown",
      messagingServiceSidConfigured: Boolean(serviceSid),
      numbers: buildTelephonyNumberHealth([], { voiceCallerId: "", smsSenderNumber: "" }),
      error: error instanceof Error && error.message === "timeout" ? "Twilio inspection timed out" : "Twilio inspection failed",
    };
   }
  })();
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    return await Promise.race([inspection, timeout]);
  } catch (error) {
    return {
      status: "unknown",
      messagingServiceSidConfigured: Boolean(serviceSid),
      numbers: REQUIRED_TELEPHONY_NUMBERS.map((phoneNumber) => ({
        phoneNumber, sid: "", owned: false,
        configuredRoles: { voice: false, sms: false },
        messagingServiceMembership: "unknown" as const,
      })),
      error: error instanceof Error && error.message === "timeout" ? "Twilio inspection timed out" : "Twilio inspection failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}