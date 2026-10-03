import { defineConfig } from "@playwright/test";
import base from "./playwright.visual-refresh.config";
export default defineConfig({
  ...base,
  testMatch: /(?:web-visual-refresh|desktop-workspace)\.spec\.ts/,
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/desktop-workspace-release/journeys/playwright-results.json" }],
  ],
  outputDir: "reports/desktop-workspace-release/journeys/test-output",
  use: { ...base.use, viewport: { width: 1440, height: 900 } },
});