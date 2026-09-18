import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /smoke\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4310",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    },
  },
  webServer: {
    command: "pnpm --filter @workspace/scripts exec tsx ./src/smoke-server.ts",
    url: "http://127.0.0.1:4310/",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});