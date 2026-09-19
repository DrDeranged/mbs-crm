export type ServiceWorkerLike = {
  state: string;
  postMessage?: (message: unknown) => void;
  addEventListener: (type: "statechange", listener: () => void) => void;
};

export const SERVICE_WORKER_VERSION = "mbs-crm-sw-v3";
const RECOVERY_RELOAD_KEY = "mbs-crm-sw-recovery-reloaded";

const workerHasRecognizedVersion = (worker: ServiceWorker): boolean => {
  try {
    return new URL(worker.scriptURL).searchParams.get("v") === SERVICE_WORKER_VERSION;
  } catch {
    return false;
  }
};

/**
 * Run before importing the application. If any registration contains an old
 * or unversioned worker, remove every registration and cache, then reload once.
 */
export async function recoverFromStaleServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const hasStaleRegistration = registrations.some((registration) => {
    const workers = [registration.active, registration.waiting, registration.installing]
      .filter((worker): worker is ServiceWorker => worker !== null);
    return workers.length === 0 ||
      workers.some((worker) => !workerHasRecognizedVersion(worker));
  });

  if (!hasStaleRegistration) return false;

  await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  if ("caches" in globalThis) {
    const cacheNames = await caches.keys();
    await Promise.allSettled(cacheNames.map((name) => caches.delete(name)));
  }

  if (sessionStorage.getItem(RECOVERY_RELOAD_KEY) !== "1") {
    sessionStorage.setItem(RECOVERY_RELOAD_KEY, "1");
    window.location.reload();
    return true;
  }

  return false;
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