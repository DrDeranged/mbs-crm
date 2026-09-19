import { test, expect } from "@playwright/test";

test("production smoke paths", async ({ browser, request }) => {
  expect((await request.storageState()).cookies).toEqual([]);

  const context = await browser.newContext();
  const errors: string[] = [];
  const clerkProxyRequests: string[] = [];
  context.on("page", (page) => page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  }));
  const page = await context.newPage();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/__clerk")) {
      clerkProxyRequests.push(request.url());
    }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/sign-in(?:\/|$)/);
  await expect(page.getByRole("heading", { name: /continue to mbs/i })).toBeVisible();
  await expect(page.getByLabel(/email address/i)).toBeVisible();
  expect(errors).toEqual([]);
  expect(clerkProxyRequests).toEqual([]);

  await page.goto("/apply", { waitUntil: "networkidle" });
  await expect(page.getByText(/step 1/i)).toBeVisible();
  await page.goto("/r/nate", { waitUntil: "networkidle" });
  await expect(page.getByText(/nate/i).first()).toBeVisible();
  await context.close();

  expect((await request.get("/api/healthz")).status()).toBe(200);

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toMatch(/^application\/manifest\+json\b/i);
  expect(await manifest.json()).toMatchObject({
    name: "MBS CRM",
    short_name: "MBS",
    start_url: "./?source=pwa",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0E2A47",
    theme_color: "#0E2A47",
  });
  const manifestBody = await manifest.json();
  expect(manifestBody.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "./favicon-192x192.png", sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ src: "./favicon-512x512.png", sizes: "512x512", type: "image/png" }),
  ]));
});