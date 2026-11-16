import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  heatmapHtml, allInsufficient, cellHtml, slotCount, worstCell, detailHtml, legendHtml,
  corridorSlug, corridorsOf, corridorTitle, pickCorridor, directionCardHtml, directionName,
  departureModel, departureHtml, PEAKS,
} from "../corridor.js";

const fx = (p) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8"));
const good = fx("heatmap/orr-silk-board-hebbal.json");
const empty = fx("heatmap/mysore-road.json");
const latest = fx("latest.json");
const route = latest.routes.find((r) => r.route_id === "orr-silk-board-hebbal");

test("fixtures have the real shape: 252 cells, null index when insufficient", () => {
  for (const h of [good, empty]) assert.equal(h.cells.length, 252);
  assert.ok(empty.cells.every((c) => c.status === "insufficient" && c.median_index === null));
  assert.ok(good.cells.every((c) => (c.status === "ok") === (c.median_index !== null)));
});

test("heatmap renders 252 placed cells; ok cells carry number, band word and sample count", () => {
  const html = heatmapHtml(good);
  assert.equal(html.match(/class="hm-cell/g).length, 252);
  assert.equal(slotCount(good), 36);
  assert.match(html, /hm-severe/);
  assert.match(html, /aria-label="Mon 9:00–9:30 am: 90, Gridlock, 12 readings"/);
  assert.match(html, /hm-insufficient/);
  assert.match(html, /grid-column:2;grid-row:3/, "Monday 05:30 is the first cell");
});

test("peak windows are outlined and labelled", () => {
  const html = heatmapHtml(good);
  assert.match(html, /AM PEAK/);
  assert.match(html, /PM PEAK/);
  // 07:00 is the 4th slot (index 3) and runs to 10:30, 8 slots; 16:30 is index 22 and runs to 20:30, 9 slots
  assert.match(html, /class="hm-peak" style="grid-column:5 \/ span 8/);
  assert.match(html, /class="hm-peak" style="grid-column:24 \/ span 9/);
});

test("time labels never run past the last grid column", () => {
  const html = heatmapHtml(good);
  for (const m of html.matchAll(/class="hm-time" style="grid-column:(\d+) \/ span (\d+)/g)) {
    assert.ok(Number(m[1]) + Number(m[2]) - 1 <= 37, `label at ${m[1]} spans ${m[2]}`);
  }
});

test("insufficient cell is hatched, labelled still collecting, and shows no number", () => {
  const html = cellHtml({ status: "insufficient", median_index: null }, 2, "08:30", 6);
  assert.match(html, /hm-insufficient/);
  assert.match(html, /aria-label="Wed 8:30–9:00 am: still collecting"/);
  assert.doesNotMatch(html, /hm-(low|moderate|high|severe)/);
  assert.doesNotMatch(html, />\d+</);
});

test("an entirely insufficient route is flagged", () => {
  assert.equal(allInsufficient(empty), true);
  assert.equal(allInsufficient(good), false);
  assert.doesNotMatch(heatmapHtml(empty), /hm-(low|moderate|high|severe)/);
  assert.equal(worstCell(empty), null);
});

test("a heatmap with missing cells still renders a full grid", () => {
  const html = heatmapHtml({ cells: good.cells.slice(0, 40) });
  assert.match(html, /hm-insufficient/);
  assert.equal(heatmapHtml({ cells: [] }), "");
});

test("worstCell and the detail panel", () => {
  const worst = worstCell(good);
  assert.equal(Math.round(worst.median_index), 90);
  assert.match(detailHtml(0, "09:00", worst), /Mon · 09:00–09:30 IST/);
  assert.match(detailHtml(0, "09:00", worst), /90 · Gridlock \/ n = 12/);
  assert.match(detailHtml(2, "08:30", { status: "insufficient", median_index: null, n: 2 }), /Not enough data yet \/ n = 2/);
  assert.match(detailHtml(2, "08:30", undefined), /Not enough data yet/);
});

test("legend lists the four bands and the hatched key", () => {
  const html = legendHtml();
  for (const w of ["0–24 Smooth", "25–49 Slow", "50–74 Heavy", "75–100 Gridlock", "Not enough data"]) assert.match(html, new RegExp(w));
});

test("corridors group both directions and are named for a URL", () => {
  assert.equal(corridorSlug("Silk Board – Marathahalli"), "silk-board-marathahalli");
  assert.equal(corridorSlug(""), "corridor");
  const list = corridorsOf({ routes: [
    { route_id: "w", name: "B to A", corridor: "A – B", direction: "westbound" },
    { route_id: "e", name: "A to B", corridor: "A – B", direction: "eastbound" },
    { route_id: "x", name: "Solo", corridor: "Z" },
  ] });
  assert.deepEqual(list.map((c) => c.slug), ["a-b", "z"]);
  assert.deepEqual(list[0].routes.map((r) => r.route_id), ["e", "w"], "eastbound first");
  assert.equal(corridorTitle(list[0]), "A ⇔ B");
  assert.equal(corridorTitle(list[1]), "Z");
});

test("pickCorridor: by corridor, by route, worst by default, null when unknown", () => {
  const list = corridorsOf(latest);
  assert.equal(pickCorridor(list, { corridor: "orr" }).slug, "orr");
  assert.equal(pickCorridor(list, { route: "mysore-road" }).routes[0].route_id, "mysore-road");
  assert.equal(pickCorridor(list, {}).slug, "orr", "worst corridor right now");
  assert.equal(pickCorridor(list, { corridor: "nope" }), null);
  assert.equal(pickCorridor(list, { route: "nope" }), null);
  assert.equal(pickCorridor([], {}), null);
});

test("direction card shows number, band word, minutes and times; no reading says so", () => {
  const html = directionCardHtml({ ...route, pain_index: 88, minutes_lost: 35, live_s: 3300, free_flow_s: 1200, direction: "northbound" });
  assert.match(html, /NORTHBOUND →/);
  assert.match(html, />88</);
  assert.match(html, />Gridlock</);
  assert.match(html, /\+35 min lost/);
  assert.match(html, /55 \/ 20 min/);
  assert.match(directionCardHtml({ ...route, direction: "southbound", status: "missing", pain_index: null }), /← SOUTHBOUND[\s\S]*No reading/);
  assert.equal(directionName("northbound"), "Northbound");
});

const dep = fx("departures/orr-silk-board-hebbal.json");

test("departure model picks best and worst and estimates the minutes saved", () => {
  const m = departureModel({ departures: dep, heatmap: good, route, weekday: 0, peak: "evening" });
  assert.equal(m.state, "ok");
  assert.equal(m.best.range, "16:30–17:00");
  assert.equal(m.worst.range, "18:30–19:00");
  assert.equal(m.best.index, 31);
  // free-flow 1500 s = 25 min: 25 * (1 + 31/50) = 40.5, 25 * (1 + 90/50) = 70
  assert.deepEqual([m.best.trip, m.worst.trip, m.saved], [41, 70, 29]);
  assert.equal(m.best.n, 12);
});

test("departure card text", () => {
  const m = departureModel({ departures: dep, heatmap: good, route, weekday: 0, peak: "evening" });
  const html = departureHtml(m, "evening");
  assert.match(html, /16:30–17:00/);
  assert.match(html, /29 minutes back in your day\./);
  assert.match(html, /Based on 12 readings in the best slot and 12 in the worst/);
  assert.match(html, /a pattern, not a guarantee/);
});

test("departure card without data says still collecting", () => {
  const m = departureModel({ departures: fx("departures/mysore-road.json"), heatmap: empty, route, weekday: 0, peak: "morning" });
  assert.equal(m.state, "collecting");
  assert.match(departureHtml(m, "morning"), /Still collecting/);
  assert.equal(departureModel({ departures: { weekdays: [] }, heatmap: empty, route, weekday: 3, peak: "evening" }).state, "collecting");
});

test("a best slot with no different worst slot is shown alone", () => {
  const departures = { weekdays: [{ weekday: 0, morning: { best: { slot: "07:00", median_index: 30 }, worst: null }, evening: null }] };
  const m = departureModel({ departures, heatmap: good, route, weekday: 0, peak: "morning" });
  assert.equal(m.state, "single");
  const html = departureHtml(m, "morning");
  assert.match(html, /07:00–07:30/);
  assert.match(html, /No clearly worse slot/);
});

test("no free-flow time means no trip estimate and no minutes-saved line", () => {
  const m = departureModel({ departures: dep, heatmap: good, route: { ...route, free_flow_s: null }, weekday: 0, peak: "evening" });
  assert.equal(m.saved, null);
  assert.doesNotMatch(departureHtml(m, "evening"), /back in your day|typical trip/);
});

test("a one-minute saving is singular, none is said plainly", () => {
  const base = departureModel({ departures: dep, heatmap: good, route, weekday: 0, peak: "evening" });
  assert.match(departureHtml({ ...base, saved: 1 }, "evening"), /1 minute back/);
  assert.match(departureHtml({ ...base, saved: 0 }, "evening"), /Little difference/);
});

test("peak windows match the methodology page", () => {
  assert.deepEqual([PEAKS.morning.from, PEAKS.morning.to, PEAKS.evening.from, PEAKS.evening.to], ["07:00", "11:00", "16:30", "21:00"]);
});

test("every fixture route has heatmap and departures files", () => {
  for (const r of latest.routes) {
    assert.equal(fx(`heatmap/${r.route_id}.json`).route_id, r.route_id);
    assert.equal(fx(`departures/${r.route_id}.json`).route_id, r.route_id);
  }
});
