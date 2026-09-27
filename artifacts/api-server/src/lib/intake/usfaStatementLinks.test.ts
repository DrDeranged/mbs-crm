import assert from "node:assert/strict";
import test from "node:test";
import { collectUsfaStatementLinks } from "./usfaStatementLinks";

test("reapplications retain every safe link and legacy URLs do not receive guessed slot labels", () => {
  const result = collectUsfaStatementLinks([
    { metadata: {
      statementLinksBySlot: [{ slot: "B", url: "https://usfundadvisor.ai/new-b" }],
      statementLinks: ["https://usfundadvisor.ai/new-b"],
    } },
    { metadata: {
      statementLinksBySlot: [
        { slot: "A", url: "https://usfundadvisor.ai/old-a" },
        { slot: "B", url: "https://usfundadvisor.ai/old-b" },
      ],
      statementLinks: ["https://usfundadvisor.ai/old-a", "https://usfundadvisor.ai/old-b"],
    } },
    { metadata: { statementLinks: [
      "https://usfundadvisor.ai/legacy-unknown-slot",
      "https://usfundadvisor.ai.evil.example/steal",
      "javascript:alert(1)",
    ] } },
  ]);
  assert.deepEqual(result, {
    links: [
      { slot: "A", url: "https://usfundadvisor.ai/old-a" },
      { slot: "B", url: "https://usfundadvisor.ai/new-b" },
      { url: "https://usfundadvisor.ai/old-b" },
      { url: "https://usfundadvisor.ai/legacy-unknown-slot" },
    ],
    storedLinkCount: 4,
  });
});