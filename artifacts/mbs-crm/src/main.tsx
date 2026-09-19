import { recoverFromStaleServiceWorker } from "./lib/serviceWorkerUpdate";

const recoveryReloadStarted = await recoverFromStaleServiceWorker().catch(() => false);

if (!recoveryReloadStarted) {
  await import("./renderApp");
}
