import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays, companyDate, companyDayWindow, taskDateState } from "./companyCalendar";

for (const [season, date, offset] of [
  ["summer", "2026-07-15", "-04:00"],
  ["winter", "2026-01-15", "-05:00"],
] as const) {
  for (const hour of [19, 23]) {
    test(`${season}: ${hour === 19 ? "7 PM" : "11 PM"} ET never makes today's task overdue`, () => {
      const now = new Date(`${date}T${hour}:00:00${offset}`);
      assert.equal(companyDate(now), date);
      assert.deepEqual(taskDateState(date, false, now), { dueToday: true, overdue: false });
      assert.deepEqual(taskDateState(addCalendarDays(date, -1), false, now), { dueToday: false, overdue: true });
      assert.deepEqual(taskDateState(addCalendarDays(date, 1), false, now), { dueToday: false, overdue: false });
      assert.deepEqual(taskDateState(date, true, now), { dueToday: false, overdue: false });
      assert.deepEqual(taskDateState(null, false, now), { dueToday: false, overdue: false });
    });
  }
}

test("task becomes overdue only at company-local midnight", () => {
  assert.equal(taskDateState("2026-07-15", false, new Date("2026-07-16T03:59:59.999Z")).overdue, false);
  assert.equal(taskDateState("2026-07-15", false, new Date("2026-07-16T04:00:00Z")).overdue, true);
});

for (const [date, start, end, hours] of [
  ["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", 23],
  ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 25],
] as const) {
  test(`DST ${date}: NY call window is ${hours} hours`, () => {
    const window = companyDayWindow(new Date(`${date}T17:00:00Z`));
    assert.equal(window.start.toISOString(), start);
    assert.equal(window.end.toISOString(), end);
    assert.equal((window.end.getTime() - window.start.getTime()) / 3_600_000, hours);
    assert.equal(addCalendarDays(date, 7), date === "2026-03-08" ? "2026-03-15" : "2026-11-08");
  });
}
