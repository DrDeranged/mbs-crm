import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRequire } from "node:module";

// The generated client uses extensionless TS imports. Enable the existing
// workspace TS resolver for this hook test, not for the entire web test suite.
const { register } = createRequire(new URL("../../../../scripts/package.json", import.meta.url))("tsx/esm/api");
register();
const { getGetMeQueryKey, getListUsersQueryKey } = await import("@workspace/api-client-react");
const { useManagerDirectory } = await import("../hooks/use-manager-directory.ts");

test("directory access waits for identity; reps cannot expose cached users or manually refetch", async () => {
  for (const role of [undefined, "rep", "manager", "admin"]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const params = { role: "rep" as const, isActive: true };
    if (role) client.setQueryData(getGetMeQueryKey(), { id: 3, role });
    const users = [{ id: 7, role: "rep", name: "Synthetic representative" }];
    client.setQueryData(getListUsersQueryKey(params), users);
    let captured: ReturnType<typeof useManagerDirectory> | undefined;
    function Probe() {
      captured = useManagerDirectory(params);
      return null;
    }
    renderToString(React.createElement(QueryClientProvider, { client },
      React.createElement(Probe)));
    assert.ok(captured);
    const allowed = role === "manager" || role === "admin";
    assert.equal(captured.canReadDirectory, allowed);
    assert.equal(client.getQueryCache().find({ queryKey: getListUsersQueryKey(params) })?.options.enabled, allowed);
    assert.deepEqual(captured.data, allowed ? users : undefined);
    if (!allowed) {
      let requests = 0;
      const original = globalThis.fetch;
      globalThis.fetch = async () => { requests++; throw new Error("Forbidden directory request"); };
      try {
        const refreshed = await captured.refetch();
        assert.equal(requests, 0);
        assert.equal(refreshed.data, undefined);
      }
      finally { globalThis.fetch = original; }
    }
    client.clear();
  }
});
