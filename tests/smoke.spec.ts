import { test, expect } from "@playwright/test";

test("production smoke paths", async ({ browser, request }) => {
  expect((await request.storageState()).cookies).toEqual([]);
  const clerk = await request.get("/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js");
  expect(clerk.status()).toBe(200);
  expect(clerk.headers()["content-type"]).toMatch(/javascript/i);

  const context = await browser.newContext();
  const errors: string[] = [];
  context.on("page", (page) => page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  }));
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/sign-in(?:\/|$)/);
  await expect(page.getByRole("heading", { name: /continue to mbs/i })).toBeVisible();
  await expect(page.getByLabel(/email address/i)).toBeVisible();
  expect(errors).toEqual([]);

  await page.goto("/apply", { waitUntil: "networkidle" });
  await expect(page.getByText(/step 1/i)).toBeVisible();
  await page.goto("/r/nate", { waitUntil: "networkidle" });
  await expect(page.getByText(/nate/i).first()).toBeVisible();
  await context.close();

  expect((await request.get("/api/healthz")).status()).toBe(200);
});