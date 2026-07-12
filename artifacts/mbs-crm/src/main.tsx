import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    sendDefaultPii: false,
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      <div style={{ padding: "2rem", fontFamily: "sans-serif", textAlign: "center" }}>
        <h2>Something went wrong</h2>
        <p>The application encountered an unexpected error. Please refresh the page.</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
          Refresh
        </button>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>
);
