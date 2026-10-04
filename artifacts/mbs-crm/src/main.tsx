import * as Sentry from "@sentry/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrandLogo } from "./components/brand-logo";
import { isChunkLoadError, reloadOnceForChunkError } from "./lib/chunkRecovery";
import { describeRenderError } from "./lib/renderDiagnostics";
import "./index.css";

// Unsaved/public appearance is Light. The provider resolves saved account choices.
document.documentElement.classList.remove("dark");
document.documentElement.style.colorScheme = "light";

function recoverFromImportFailure(error: unknown) {
  const buildId = document.querySelector<HTMLMetaElement>('meta[name="mbs-build-id"]')?.content ?? "";
  return reloadOnceForChunkError(error, buildId, window.sessionStorage, () => window.location.reload());
}

// Vite emits this for failed route preloads before React can render its fallback.
window.addEventListener("vite:preloadError", (event) => {
  if (recoverFromImportFailure((event as Event & { payload?: unknown }).payload)) event.preventDefault();
});

function ErrorFallback({ error, componentStack }: { error: unknown; componentStack: string }) {
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
      {import.meta.env.DEV && (
        <details className="mx-auto mt-4 max-w-2xl text-left">
          <summary className="cursor-pointer text-sm">Developer diagnostics</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border p-3 text-xs">
            {describeRenderError(error, componentStack)}
          </pre>
        </details>
      )}
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
    onError={(error, componentStack) => {
      if (import.meta.env.DEV) console.error("[MBS render error]", describeRenderError(error, componentStack));
    }}
    fallback={({ error, componentStack }) => <ErrorFallback error={error} componentStack={componentStack} />}
  >
    <App />
  </Sentry.ErrorBoundary>
);
