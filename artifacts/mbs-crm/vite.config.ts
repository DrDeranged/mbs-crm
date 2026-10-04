import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { randomUUID } from "node:crypto";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// One identifier per generated HTML shell; it changes even when the entry
// script hash happens to stay the same (for example, after a worker-only fix).
const buildId = randomUUID();

export default defineConfig(async ({ command }) => ({
  base: basePath,
  // A build/verification process must not invalidate the live server's
  // optimized dependencies. Vite otherwise reports missing files as 504
  // "Outdated Optimize Dep", which rejects lazy page imports.
  cacheDir: path.resolve(import.meta.dirname, "node_modules", command === "serve" ? ".vite-dev" : ".vite-build"),
  optimizeDeps: {
    include: ["recharts", "date-fns"],
  },
  plugins: [
    {
      name: "mbs-build-id",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          return html.replace(
            "</head>",
            `    <meta name="mbs-build-id" content="${buildId}" />\n  </head>`,
          );
        },
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));
