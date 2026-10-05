import assert from "node:assert/strict";
import test from "node:test";
import { clampPage, computePageSize, pageRange, remapPage } from "./leadsPageSizing.ts";

test("computePageSize floors rows and clamps", () => {
  assert.equal(computePageSize(40 + 2 + 60 * 7 + 59), 7);
  assert.equal(computePageSize(100), 1);
  assert.equal(computePageSize(0), 1);
  assert.equal(computePageSize(Number.NaN), 1);
  assert.equal(computePageSize(99999), 100);
});

test("computePageSize is stable for identical input", () => {
  assert.equal(computePageSize(500), computePageSize(500));
});

test("measured taller rows and headers reduce the page budget", () => {
  assert.equal(computePageSize(500, 100, 50), 4);
  assert.ok(computePageSize(500, 100, 50) * 100 + 52 <= 500);
});

test("remapPage keeps the first visible record", () => {
  assert.equal(remapPage(3, 20, 10), 5);
  assert.equal(remapPage(5, 10, 20), 3);
  assert.equal(remapPage(1, 20, 7), 1);
  assert.equal(remapPage(2, 0, 7), 1);
});

test("clampPage prevents invalid ranges", () => {
  assert.equal(clampPage(9, 4), 4);
  assert.equal(clampPage(0, 4), 1);
  assert.equal(clampPage(3, 0), 1);
});

test("pageRange reports accurate bounds", () => {
  assert.deepEqual(pageRange(1, 8, 0), { start: 0, end: 0 });
  assert.deepEqual(pageRange(2, 8, 11), { start: 9, end: 11 });
  assert.deepEqual(pageRange(1, 8, 100), { start: 1, end: 8 });
});
