export type ServiceWorkerLike = {
  state: string;
  postMessage?: (message: unknown) => void;
  addEventListener: (type: "statechange", listener: () => void) => void;
};

export const SERVICE_WORKER_VERSION = "mbs-crm-sw-v2";

const workerHasRecognizedVersion = (worker: ServiceWorker | null): boolean =>
  !worker || worker.scriptURL.includes(SERVICE_WORKER_VERSION);

/**
 * Remove workers from older builds before the app mounts. A session marker
 * prevents an old controller from causing an infinite reload loop.
 */
export async function removeStaleServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  let removedControlledWorker = false;
  await Promise.all(registrations.map(async (registration) => {
    const workers = [registration.active, registration.waiting, registration.installing];
    const hasUnknownWorker = workers.some((worker) => !workerHasRecognizedVersion(worker));
    if (!hasUnknownWorker) return;
    if (registration.active && navigator.serviceWorker.controller &&
        navigator.serviceWorker.controller.scriptURL === registration.active.scriptURL) {
      removedControlledWorker = true;
    }
    await registration.unregister();
  }));
  if (removedControlledWorker && sessionStorage.getItem("mbs-crm-sw-reloaded") !== "1") {
    sessionStorage.setItem("mbs-crm-sw-reloaded", "1");
    window.location.reload();
  }
}

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