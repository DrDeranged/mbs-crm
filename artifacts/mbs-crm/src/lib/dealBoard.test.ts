import assert from "node:assert/strict";
import test from "node:test";
import {
  dealMatchesView,
  formatGmDisplay,
  serializeDealViewStages,
  visibleDealTotals,
} from "./dealBoard.ts";

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
