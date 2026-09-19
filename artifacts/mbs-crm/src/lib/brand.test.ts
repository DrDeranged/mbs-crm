import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { brandLogoSrc, type BrandLogoVariant } from "./brand-assets.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("brand takeover uses canonical marks and no removed wordmark", () => {
  const component = read("components/brand-logo.tsx");
  const assets = read("lib/brand-assets.ts");
  assert.match(assets, /mbs-logo-green-slash\.png/);
  assert.match(assets, /mbs-logo-green-slash-reverse\.png/);
  assert.match(component, /My Business Solutions logo/);
  const removedWordmark = ["MBS", "Logo", "Header", "Logo.png"].join("-");
  assert.ok(!component.includes(removedWordmark));
  assert.doesNotMatch(component, /alt=["'][^"']*MBS[^"']*["']/);
});

test("every branded surface renders the correct light or reverse image src", () => {
  const surfaces: Record<string, BrandLogoVariant> = {
    sidebar: "reverse",
    signIn: "reverse",
    pendingApproval: "reverse",
    topHeader: "light",
    repChooser: "light",
    publicApplicationHeader: "reverse",
    publicApplicationSuccess: "light",
    applicationStatus: "reverse",
    unsubscribe: "light",
    notFound: "light",
    error: "light",
    loading: "light",
  };
  for (const [surface, variant] of Object.entries(surfaces)) {
    const src = brandLogoSrc(variant, "/mbs-crm/");
    const html = renderToStaticMarkup(createElement("img", {
      src,
      alt: "My Business Solutions logo",
      "data-surface": surface,
    }));
    assert.match(html, new RegExp(`src="/mbs-crm/brand/mbs-logo-green-slash${variant === "reverse" ? "-reverse" : ""}\\.png"`));
  }
});

test("listed pages select the expected variant and preserve requested sizing", () => {
  const shell = read("components/app-shell.tsx");
  const app = read("App.tsx");
  const apply = read("pages/apply.tsx");
  const status = read("pages/application-status.tsx");
  const chooser = read("pages/rep-chooser.tsx");
  const notFound = read("pages/not-found.tsx");
  const renderApp = read("renderApp.tsx");
  assert.match(shell, /variant="reverse"[^>]+className="w-\[120px\]"[^>]+imageClassName="h-auto w-\[120px\]"/);
  assert.match(shell, /<BrandLogo className="h-7" imageClassName="h-7 w-auto"/);
  assert.match(app, /variant="reverse"[^>]+className="mx-auto[^"]*w-\[160px\]"/);
  assert.match(app, /variant="reverse"[^>]+className="w-\[160px\]/);
  assert.match(app, /<BrandLogo \/>/);
  assert.match(apply, /variant="reverse" imageClassName="h-7 w-auto"/);
  assert.match(apply, /<BrandLogo className="mx-auto" imageClassName="h-7 w-auto" \/>/);
  assert.match(status, /variant="reverse" imageClassName="h-7 w-auto"/);
  assert.match(chooser, /<BrandLogo className="mx-auto" imageClassName="h-10 w-auto" \/>/);
  assert.match(notFound, /<BrandLogo className="mb-6" imageClassName="h-8 w-auto" \/>/);
  assert.match(renderApp, /<BrandLogo imageClassName="h-8 w-auto" \/>/);
});

test("favicon and PWA metadata point at the canonical icon set", () => {
  const html = readFileSync(path.join(root, "..", "index.html"), "utf8");
  const manifest = readFileSync(path.join(root, "..", "public", "manifest.webmanifest"), "utf8");
  assert.match(html, /<title>MBS CRM<\/title>/);
  assert.match(html, /favicon-16x16\.png/);
  assert.match(html, /favicon-32x32\.png/);
  assert.match(html, /favicon-180x180\.png/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /favicon\.svg|favicon\.ico|apple-touch-icon\.png/);
  assert.match(manifest, /favicon-192x192\.png/);
  assert.match(manifest, /favicon-512x512\.png/);
});