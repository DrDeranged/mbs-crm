import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

test("25 options render in a 300px scrollable list; searching Max shows only Maxim", async () => {
  const srcRoot = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    resolve: { alias: { "@": srcRoot } },
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { Command } = await server.ssrLoadModule("/src/components/ui/command.tsx");
    const { SearchableSelectOptionList } = await server.ssrLoadModule("/src/components/searchable-select.tsx");
    const options = [
      ...Array.from({ length: 24 }, (_, index) => ({
        value: String(index + 1), label: `Partner ${index + 1}`,
      })),
      { value: "maxim", label: "Maxim" },
    ];
    const render = (query: string) => renderToStaticMarkup(
      createElement(Command, { shouldFilter: false },
        createElement(SearchableSelectOptionList, {
          options, query, value: "", onSelect: () => {},
        })),
    );
    const all = render("");
    assert.equal((all.match(/cmdk-item=/g) ?? []).length, 25);
    assert.match(all, /max-h-\[300px\] overflow-y-auto/);
    assert.match(all, /data-testid="searchable-select-list"/);
    assert.match(all, /role="listbox"/);

    const filtered = render("Max");
    assert.equal((filtered.match(/cmdk-item=/g) ?? []).length, 1);
    assert.match(filtered, />Maxim</);
    assert.doesNotMatch(filtered, />Partner 1</);
  } finally {
    await server.close();
  }
});