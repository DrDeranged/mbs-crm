import * as Sentry from "@sentry/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrandLogo } from "./components/brand-logo";
import { isChunkLoadError, reloadOnceForChunkError } from "./lib/chunkRecovery";
import "./index.css";

// System appearance applies before the first render, including public routes.
document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.style.colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function recoverFromImportFailure(error: unknown) {
  const buildId = document.querySelector<HTMLMetaElement>('meta[name="mbs-build-id"]')?.content ?? "";
  return reloadOnceForChunkError(error, buildId, window.sessionStorage, () => window.location.reload());
}

// Vite emits this for failed route preloads before React can render its fallback.
window.addEventListener("vite:preloadError", (event) => {
  if (recoverFromImportFailure((event as Event & { payload?: unknown }).payload)) event.preventDefault();
});

function ErrorFallback({ error }: { error: unknown }) {
  const [retrying, setRetrying] = useState(() => isChunkLoadError(error));
  useEffect(() => {
    if (retrying && !recoverFromImportFailure(error)) setRetrying(false);
  }, [error, retrying]);

  if (retrying) return <div role="status" style={{ padding: "2rem" }}>Loading the latest version…</div>;
  return (
    <div className="bg-background p-8 text-center font-sans text-foreground">
      <BrandLogo imageClassName="h-8 w-auto" />
      <h2>Something went wrong</h2>
      <p>The application encountered an unexpected error. Please refresh the page.</p>
      <button onClick={() => window.location.reload()} className="mt-4 min-h-11 cursor-pointer rounded-md border border-primary-border bg-primary px-4 py-2 text-primary-foreground">
        Refresh
      </button>
    </div>
  );
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    sendDefaultPii: false,
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={({ error }) => <ErrorFallback error={error} />}
  >
    <App />
  </Sentry.ErrorBoundary>
);
