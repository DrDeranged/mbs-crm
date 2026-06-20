import { logger } from "./logger";

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!pushToken.startsWith("ExponentPushToken[") && !pushToken.startsWith("ExpoPushToken[")) {
    logger.warn({ pushToken }, "Invalid Expo push token format — skipping");
    return;
  }

  const message: PushMessage = {
    to: pushToken,
    sound: "default",
    title,
    body,
    data: data ?? {},
    priority: "high",
  };

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const result = (await res.json()) as { data?: ExpoPushTicket };
    const ticket = result.data;

    if (ticket?.status === "error") {
      logger.error({ pushToken, ticket }, "Expo push notification error");
    } else {
      logger.info({ pushToken, ticketId: ticket?.id }, "Push notification sent");
    }
  } catch (err) {
    logger.error({ err, pushToken }, "Failed to send push notification");
  }
}

export async function sendPushNotifications(
  pushTokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await Promise.allSettled(
    pushTokens.map((token) => sendPushNotification(token, title, body, data)),
  );
}
