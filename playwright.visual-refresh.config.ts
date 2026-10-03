import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /web-visual-refresh\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.VISUAL_JOURNEY_REPORT_FILE ?? "reports/web-visual-refresh/journeys/playwright-results.json" }],
  ],
  outputDir: "reports/web-visual-refresh/journeys/test-output",
  use: {
    baseURL: "http://127.0.0.1:4340",
    browserName: "chromium",
    headless: true,
    trace: "off",
    video: "off",
    serviceWorkers: "block",
    launchOptions: { executablePath: "/repl/tools/bin/chromium" },
  },
});