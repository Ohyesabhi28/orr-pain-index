import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { heatmapHtml, departuresHtml, viewModel, allInsufficient, findRoute, cellHtml } from "../corridor.js";

const fx = (p) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8"));
const good = fx("heatmap/orr-silk-board-hebbal.json");
const empty = fx("heatmap/mysore-road.json");

test("fixtures have the real shape: 252 cells, null index when insufficient", () => {
  for (const h of [good, empty]) assert.equal(h.cells.length, 252);
  assert.ok(empty.cells.every((c) => c.status === "insufficient" && c.median_index === null));
  assert.ok(good.cells.every((c) => (c.status === "ok") === (c.median_index !== null)));
});
test("heatmap renders 252 cells, each ok cell with its number and band word", () => {
  const html = heatmapHtml(good);
  assert.equal(html.match(/class="hm-cell/g).length, 252);
  assert.match(html, /hm-severe/);
  assert.match(html, /title="Mon 9:00–9:30 am: 90, Severe"/);
  assert.match(html, /hm-insufficient/);
});
test("insufficient cell is hatched, labelled still collecting, and shows no number", () => {
  const html = cellHtml({ status: "insufficient", median_index: null }, 2, "08:30");
  assert.match(html, /hm-insufficient/);
  assert.match(html, /title="Wed 8:30–9:00 am: still collecting"/);
  assert.doesNotMatch(html, /hm-(low|moderate|high|severe)/);
});
test("an entirely insufficient route is flagged and shows a notice", () => {
  assert.equal(allInsufficient(empty), true);
  assert.equal(allInsufficient(good), false);
  const vm = viewModel(empty, fx("departures/mysore-road.json"));
  assert.match(vm.notice, /Still collecting/);
  assert.doesNotMatch(vm.heatmapHtml, /hm-(low|moderate|high|severe)/);
  assert.equal(viewModel(good, fx("departures/orr-silk-board-hebbal.json")).notice, null);
});
test("a heatmap with missing cells still renders a full grid", () => {
  const html = heatmapHtml({ cells: good.cells.slice(0, 40) });
  assert.match(html, /hm-insufficient/);
});
test("departures show best/worst windows with slotRange", () => {
  const html = departuresHtml(fx("departures/orr-silk-board-hebbal.json"));
  assert.match(html, /Monday/);
  assert.match(html, /Worst<\/span> 9:00–9:30 am/);
  assert.match(html, /Best<\/span> 7:00–7:30 am/);
  assert.doesNotMatch(html, /still collecting/);
});
test("null picks show still collecting", () => {
  const html = departuresHtml(fx("departures/mysore-road.json"));
  assert.equal(html.match(/still collecting/g).length, 14);
  const partial = departuresHtml({ weekdays: [{ weekday: 0, morning: null, evening: { best: null, worst: null } }] });
  assert.equal(partial.match(/still collecting/g).length, 14);
});
test("findRoute only accepts ids from latest.json", () => {
  const latest = fx("latest.json");
  assert.equal(findRoute(latest, "mysore-road").route_id, "mysore-road");
  assert.equal(findRoute(latest, "nope"), null);
  assert.equal(findRoute(latest, ""), null);
  assert.equal(findRoute(latest, null), null);
});
test("every fixture route has heatmap and departures files", () => {
  for (const r of fx("latest.json").routes) {
    assert.equal(fx(`heatmap/${r.route_id}.json`).route_id, r.route_id);
    assert.equal(fx(`departures/${r.route_id}.json`).route_id, r.route_id);
  }
});

test("departures: best with null worst says no different slot yet", () => {
  const html = departuresHtml({ weekdays: [{ weekday: 0,
    morning: { best: { slot: "07:00", median_index: 30 }, worst: null },
    evening: { best: null, worst: null } }] });
  assert.match(html, /no different slot yet/);
  assert.match(html, /Best/);
  assert.match(html, /still collecting/);
});
