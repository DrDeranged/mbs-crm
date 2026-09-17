import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAL_STAGE_COLUMNS,
  KANBAN_COMPACT_BREAKPOINT,
  KANBAN_COMPACT_COLUMN_MIN_WIDTH,
  KANBAN_COMPACT_GAP,
  compactKanbanAvailableWidth,
  compactKanbanFits,
  compactKanbanRequiredWidth,
  kanbanCompactPreferenceKey,
  readKanbanCompactPreference,
  dealMatchesView,
  formatGmDisplay,
  serializeDealViewStages,
  visibleDealTotals,
} from "./dealBoard.ts";

test("kanban has exactly nine supported deal-stage columns", () => {
    assert.equal(DEAL_STAGE_COLUMNS.length, 9);
    assert.deepEqual(
      DEAL_STAGE_COLUMNS.map((stage) => stage.id),
      [
        "waiting_on_app",
        "information_needed",
        "submitted",
        "approved",
        "in_funding",
        "funded",
        "hold_on",
        "declined",
        "dead",
      ],
    );
});

test("compact Kanban sizing keeps nine columns at least 120px wide", () => {
    assert.equal(DEAL_STAGE_COLUMNS.length, 9);
    assert.equal(KANBAN_COMPACT_COLUMN_MIN_WIDTH, 120);
    assert.equal(KANBAN_COMPACT_GAP, 4);
    assert.equal(compactKanbanRequiredWidth(), 9 * 120 + 8 * 4);
    assert.equal(compactKanbanFits(1440), true);
    assert.equal(compactKanbanFits(KANBAN_COMPACT_BREAKPOINT), true);
});

test("compact is the default while explicit per-user preferences still win", () => {
    const values = new Map([
      ["mbs-crm:kanban-compact:41", "true"],
      ["mbs-crm:kanban-compact:42", "false"],
    ]);
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
    };
    assert.equal(kanbanCompactPreferenceKey(41), "mbs-crm:kanban-compact:41");
    assert.equal(readKanbanCompactPreference(storage, kanbanCompactPreferenceKey(41)), true);
    assert.equal(readKanbanCompactPreference(storage, kanbanCompactPreferenceKey(42)), false);
    assert.equal(readKanbanCompactPreference(storage, "missing"), true);
});

test("compact Kanban fits the actual board area at 1280px and 1440px", () => {
    assert.equal(compactKanbanAvailableWidth(1280), 1120);
    assert.equal(compactKanbanAvailableWidth(1440), 1280);
    assert.equal(compactKanbanRequiredWidth(), 1112);
    assert.equal(compactKanbanFits(1280), true);
    assert.equal(compactKanbanFits(1440), true);
});

test("uses the exact built-in view stage predicates and serialization", () => {
    assert.equal(serializeDealViewStages("all"), undefined);
    assert.equal(serializeDealViewStages("fundedAndInFunding"),
      "funded,in_funding",
    );
    assert.equal(serializeDealViewStages("needsAction"),
      "waiting_on_app,information_needed,hold_on",
    );
    assert.equal(
      dealMatchesView({ stage: "in_funding" as any }, "fundedAndInFunding"),
      true,
    );
    assert.equal(
      dealMatchesView({ stage: "approved" as any }, "fundedAndInFunding"),
      false,
    );
});

test("formats split GM without changing the underlying amount", () => {
    assert.match(formatGmDisplay(8800, 50), /\$8\.8k · 50%/);
    assert.equal(formatGmDisplay(8800, 100), "$8.8k");
});

test("totals nullable fields after exact view filtering", () => {
    const deals = [
      { stage: "funded" as const, approxGm: 1000, actualGm: 800 },
      { stage: "in_funding" as const, approxGm: null, actualGm: 200 },
      { stage: "approved" as const, approxGm: 500, actualGm: null },
    ];
    assert.deepEqual(
      visibleDealTotals(
        deals.filter((deal) => dealMatchesView(deal, "fundedAndInFunding")),
      ),
      { approxGm: 1000, actualGm: 1000 },
    );
    assert.deepEqual(
      visibleDealTotals([
        { approxGm: 1000, actualGm: 800 },
        { approxGm: null, actualGm: 200 },
        { approxGm: 500, actualGm: null },
      ]),
      { approxGm: 1500, actualGm: 1000 },
    );
});
