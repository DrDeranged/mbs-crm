import { sendPushNotification } from "./pushNotifications";

export async function createNotification(opts: {
  pushToken: string | null | undefined;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!opts.pushToken) return;
  await sendPushNotification(opts.pushToken, opts.title, opts.body, opts.data).catch(() => {});
}
