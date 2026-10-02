import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { softphoneReadyForAction } from "./recordContact.ts";

test("Communications Call uses the real PhoneLink click handler for mobile, unavailable and ready desktop devices", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://crm.example.invalid/leads/15" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const srcRoot = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({
    configFile: false, logLevel: "silent", plugins: [react()],
    resolve: { alias: { "@": srcRoot }, dedupe: ["react", "react-dom"] },
    server: { middlewareMode: true }, appType: "custom",
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    const { PhoneLink } = await server.ssrLoadModule("/src/components/phone-link.tsx");
    const { SoftphoneContext } = await server.ssrLoadModule("/src/components/softphone-context.tsx");
    const { Router } = await server.ssrLoadModule("wouter");
    // Verify that the tab itself delegates to this tested component, rather than
    // retaining a parallel direct-dial handler that would bypass the guard.
    const source = await readFile(new URL("../pages/lead-detail/communications.tsx", import.meta.url), "utf8");
    assert.match(source, /<PhoneLink[\s\S]*?phone=\{leadPhone\}[\s\S]*?leadId=\{leadId\}/);
    assert.doesNotMatch(source, /\bdial\s*\(/);
    for (const fixture of [
      { width: 1280, ua: "Desktop", coarse: false, registered: false, state: "idle", crm: false },
      { width: 1280, ua: "Desktop", coarse: false, registered: true, state: "idle", crm: true },
      { width: 1280, ua: "Desktop", coarse: false, registered: true, state: "connected", crm: false },
      { width: 390, ua: "Desktop", coarse: false, registered: true, state: "idle", crm: false },
      { width: 1000, ua: "iPhone", coarse: false, registered: true, state: "idle", crm: false },
      { width: 1000, ua: "Desktop", coarse: true, registered: true, state: "idle", crm: false },
    ]) {
      Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: fixture.width });
      Object.defineProperty(dom.window.navigator, "userAgent", { configurable: true, value: fixture.ua });
      dom.window.matchMedia = (() => ({ matches: fixture.coarse })) as typeof dom.window.matchMedia;
      const calls: unknown[][] = [];
      let rowClicks = 0;
      await act(async () => root.render(
        createElement(Router, { hook: () => ["/leads/15", () => {}] },
          createElement(SoftphoneContext.Provider, {
            value: { softphoneAvailable: softphoneReadyForAction(fixture.registered, fixture.state), dial: (...args: unknown[]) => calls.push(args) },
          }, createElement("div", { onClick: () => rowClicks++ },
            createElement(PhoneLink, { phone: "+1 (555) 010-0200", leadId: 15, showIcon: false }, "Call"),
          )),
        ),
      ));
      assert.equal(calls.length, 0, "rendering must not dial");
      const anchor = dom.window.document.querySelector("a")!;
      assert.equal(anchor.textContent, "Call");
      assert.equal(anchor.getAttribute("href"), "tel:+15550100200");
      let preventedByComponent: boolean | undefined;
      const host = dom.window.document.getElementById("root")!;
      const suppressNativeNavigation = (event: Event) => {
        preventedByComponent = event.defaultPrevented;
        event.preventDefault(); // No real native call/navigation in this test.
      };
      host.addEventListener("click", suppressNativeNavigation);
      await act(async () => {
        anchor.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      host.removeEventListener("click", suppressNativeNavigation);
      assert.equal(preventedByComponent, fixture.crm);
      assert.equal(rowClicks, 0, "nested call must not navigate/select its parent");
      assert.deepEqual(calls, fixture.crm ? [["+1 (555) 010-0200", { autoCall: true, leadId: 15 }]] : []);
    }
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});