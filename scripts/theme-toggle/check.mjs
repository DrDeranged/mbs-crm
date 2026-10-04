// Exercises the real toggle/provider without a browser, live accounts or API writes.
import { build } from "../../artifacts/api-server/node_modules/esbuild/lib/main.js";
import { JSDOM } from "../../artifacts/mbs-crm/node_modules/jsdom/lib/api.js";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = resolve(import.meta.dirname, "../../artifacts/mbs-crm");
const dom = new JSDOM('<div id="test-root"></div>', { url: "https://fixture.example" });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"]) {
  globalThis[key] = key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fixtureUser = "fixture-a";
const listeners = new Set();
const media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
window.matchMedia = () => media;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const bundled = await build({
  stdin: {
    resolveDir: app, loader: "tsx",
    contents: `
      import React, {act} from "react";
      import {createRoot} from "react-dom/client";
      import {AppearanceProvider} from "./src/components/appearance-provider";
      import {ThemeToggle} from "./src/components/theme-toggle";
      import {TooltipProvider} from "./src/components/ui/tooltip";
      import {useToast} from "./src/hooks/use-toast";
      const root=createRoot(document.getElementById("test-root"));
      function Feedback(){ const {toasts}=useToast(); return <div id="feedback">{toasts.map(t=>t.title+" "+t.description).join(" ")}</div>; }
      export {act};
      export async function render(){await act(async()=>root.render(<AppearanceProvider><TooltipProvider><ThemeToggle/><Feedback/></TooltipProvider></AppearanceProvider>));}
      export async function remount(){await act(async()=>root.render(null));await render();}
      export async function close(){await act(async()=>root.unmount());}
    `,
  },
  bundle: true, platform: "node", format: "cjs", write: false, jsx: "automatic",
  alias: { "@": resolve(app, "src") },
  plugins: [{
    name: "synthetic-identity",
    setup(plugin) {
      plugin.onResolve({ filter: /^@clerk\/react$/ }, () => ({ path: "identity", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: "export function useUser(){return {isLoaded:true,isSignedIn:!!globalThis.fixtureUser,user:globalThis.fixtureUser?{id:globalThis.fixtureUser}:null}}",
      }));
    },
  }],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(resolve(app, "package.json")), module, module.exports);
const { act, render, remount, close } = module.exports;
const button = () => document.querySelector('[data-testid="header-theme-toggle"]');
const click = async () => act(async () => button().click());
const mode = () => document.documentElement.dataset.appearance;
try {
  await render();
  assert.equal(mode(), "light");
  assert.equal(button().getAttribute("aria-label"), "Switch to dark mode");
  assert.equal(button().tagName, "BUTTON");
  assert.equal(button().getAttribute("type"), "button");
  assert.equal(button().tabIndex, 0);
  await click();
  assert.equal(mode(), "dark");
  assert.equal(button().getAttribute("aria-label"), "Switch to light mode");
  assert.equal(window.localStorage.getItem("mbs-web-appearance:fixture-a"), "dark");
  await remount();
  assert.equal(mode(), "dark");
  globalThis.fixtureUser = "fixture-b";
  await render();
  assert.equal(mode(), "light");
  assert.equal(window.localStorage.getItem("mbs-web-appearance:fixture-a"), "dark");
  window.localStorage.setItem("mbs-web-appearance:fixture-b", "dark");
  await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key: "mbs-web-appearance:fixture-b", newValue: "dark" })));
  assert.equal(mode(), "dark");
  window.localStorage.setItem("mbs-web-appearance:fixture-b", "system");
  await remount();
  assert.equal(mode(), "light");
  await act(async () => { media.matches = true; for (const fn of listeners) fn(); });
  assert.equal(mode(), "dark");
  await click();
  assert.equal(mode(), "light");
  assert.equal(window.localStorage.getItem("mbs-web-appearance:fixture-b"), "light");
  Object.defineProperty(window.Storage.prototype, "setItem", { configurable: true, value() { throw new Error("Fixture storage blocked"); } });
  await click();
  assert.equal(mode(), "dark");
  assert.match(document.querySelector('[role="status"]').textContent, /blocked saving/);
  assert.match(document.getElementById("feedback").textContent, /Theme changed for this session.*blocked saving/);
  const shell = readFileSync(resolve(app, "src/components/app-shell.tsx"), "utf8");
  assert.match(shell, /\)\}\s*<ThemeToggle \/>\s*<BrandLogo/);
  assert.equal(shell.split("<ThemeToggle />").length - 1, 1);
  assert.ok(shell.indexOf("<ThemeToggle />") < shell.indexOf("{/* Mobile top bar */}"));
  const settings = readFileSync(resolve(app, "src/pages/settings.tsx"), "utf8");
  assert.match(settings, /\{!isDesktop && <Card data-appearance-control>/);
  console.log("PASS: real theme toggle/provider, labels, persistence, account isolation, cross-tab updates, System mode, storage errors and desktop/mobile placement.");
} finally {
  await close();
  dom.window.close();
}
// Bundled React/Radix scheduling can retain Node handles after DOM teardown.
// All assertions and cleanup above have completed; failures throw before here.
process.exit(0);