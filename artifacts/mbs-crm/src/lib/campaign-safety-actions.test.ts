import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

test("recovery success still refreshes and navigates after its dropdown unmounts", async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
  let finish!: (value: { id: number }) => void;
  let navigated = 0;
  const observer = new MutationObserver(client, {
    mutationFn: () => new Promise<{ id: number }>(resolve => { finish = resolve; }),
    onSuccess: draft => { navigated = draft.id; },
  });
  const unsubscribe = observer.subscribe(() => {});
  const result = observer.mutate(undefined);
  await new Promise(resolve => setTimeout(resolve, 0));
  unsubscribe();
  finish({ id: 42 });
  await result;
  assert.equal(navigated, 42);
  client.clear();
  const source = await readFile(new URL("../components/campaign-safety-actions.tsx", import.meta.url), "utf8");
  assert.match(source, /useCreateRemainingCampaign\(\{\s*mutation:\s*\{/);
  assert.match(source, /const create = \(\) => mutation\.mutate\(\{ id: campaign\.id \}\);/);
});
