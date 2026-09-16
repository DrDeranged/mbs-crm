import twilio from "twilio";

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