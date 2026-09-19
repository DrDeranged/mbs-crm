export type ServiceWorkerLike = {
  state: string;
  postMessage?: (message: unknown) => void;
  addEventListener: (type: "statechange", listener: () => void) => void;
};

/**
 * Installs the browser's deterministic "new worker is ready" transition.
 * Keeping the controller check here makes update behavior testable without
 * depending on service-worker network timing.
 */
export function watchForInstalledUpdate(
  worker: ServiceWorkerLike,
  hasController: () => boolean,
  onUpdate: (worker: ServiceWorkerLike) => void,
): void {
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && hasController()) onUpdate(worker);
  });
}

export type NotificationClient = {
  url: string;
  focus?: () => Promise<unknown> | unknown;
};

export function notificationClickAction(
  clients: NotificationClient[],
  targetUrl: string,
): { kind: "focus"; client: NotificationClient } | { kind: "open"; url: string } {
  const existing = clients.find((client) => client.url.includes(targetUrl) && client.focus);
  return existing ? { kind: "focus", client: existing } : { kind: "open", url: targetUrl };
}