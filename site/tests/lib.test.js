import test from "node:test";
import assert from "node:assert/strict";
import { freshness, band, istClock } from "../lib.js";

test("fresh within 45 minutes", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:44:00Z")), "fresh"));
test("exactly 45 minutes is still fresh", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:45:00Z")), "fresh"));
test("stale after 45 minutes in collection hours", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:46:00Z")), "stale"));
test("overnight at 1am IST", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-15T19:30:00Z")), "overnight"));
test("last night's data at 5:40am IST is not stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:10:00Z")), "overnight"));
test("last night's data at 6:20am IST is stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:50:00Z")), "stale"));
test("fresh data at 5:40am IST is fresh", () =>
  assert.equal(freshness("2026-11-16T00:05:00Z", Date.parse("2026-11-16T00:10:00Z")), "fresh"));
test("after 23:30 IST is overnight even with recent data", () =>
  assert.equal(freshness("2026-11-16T17:55:00Z", Date.parse("2026-11-16T18:05:00Z")), "overnight"));
test("no observation yet", () => assert.equal(freshness(null, Date.now()), "empty"));
test("bands", () => assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map(band),
  ["low", "low", "moderate", "moderate", "high", "high", "severe", "severe"]));
test("istClock formats morning, afternoon, midnight and noon", () => {
  assert.equal(istClock("2026-11-16T03:07:00Z"), "8:37 am");
  assert.equal(istClock("2026-11-16T09:30:00Z"), "3:00 pm");
  assert.equal(istClock("2026-11-15T18:30:00Z"), "12:00 am");
  assert.equal(istClock("2026-11-16T06:35:00Z"), "12:05 pm");
});

import { heatmapGrid, slotRange, slotLabel } from "../lib.js";

function allCells() {
  const cells = [];
  for (let wd = 0; wd < 7; wd++) {
    for (let i = 0; i < 36; i++) {
      const m = 330 + i * 30;
      const slot = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      cells.push({ weekday: wd, slot, median_index: i, status: "ok" });
    }
  }
  return cells;
}
test("unparseable timestamp is stale, not fresh", () =>
  assert.equal(freshness("not-a-date", Date.parse("2026-11-16T04:00:00Z")), "stale"));
test("heatmapGrid orders 252 shuffled cells into 7 rows of 36", () => {
  const cells = allCells();
  let seed = 7;
  cells.sort(() => ((seed = (seed * 16807) % 2147483647) % 3) - 1);
  const { slots, rows } = heatmapGrid(cells);
  assert.equal(slots.length, 36);
  assert.equal(slots[0], "05:30");
  assert.equal(slots[35], "23:00");
  assert.equal(rows.length, 7);
  rows.forEach((row, wd) => {
    assert.equal(row.length, 36);
    row.forEach((c, i) => {
      assert.equal(c.weekday, wd);
      assert.equal(c.slot, slots[i]);
    });
  });
});
test("heatmapGrid of no cells is empty rows", () => {
  const { slots, rows } = heatmapGrid([]);
  assert.deepEqual(slots, []);
  assert.equal(rows.length, 7);
});
test("slotRange", () => {
  assert.equal(slotRange("08:30"), "8:30–9:00 am");
  assert.equal(slotRange("11:30"), "11:30 am–12:00 pm");
  assert.equal(slotRange("12:00"), "12:00–12:30 pm");
  assert.equal(slotRange("16:30"), "4:30–5:00 pm");
  assert.equal(slotRange("23:00"), "11:00–11:30 pm");
  assert.equal(slotRange("23:30"), "11:30 pm–12:00 am");
});
test("slotLabel", () => {
  assert.equal(slotLabel("08:30"), "8:30 am");
  assert.equal(slotLabel("12:00"), "12:00 pm");
  assert.equal(slotLabel("23:00"), "11:00 pm");
});
