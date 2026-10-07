import { defineConfig } from "@playwright/test";
import base from "./playwright.visual-refresh.config";

export default defineConfig({
  ...base,
  testMatch: /deals-pipeline-fix\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/deals-pipeline-fix/playwright-results.json" }],
  ],
  outputDir: "reports/deals-pipeline-fix/test-output",
  use: { ...base.use, viewport: { width: 1440, height: 900 } },
});
