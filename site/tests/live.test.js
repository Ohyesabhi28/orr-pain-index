import test from "node:test";
import assert from "node:assert/strict";
import { noticeText, updatedText, routeHtml, listHtml, viewModel, escapeHtml } from "../live.js";

const ok = { route_id: "a", name: "ORR <East>", corridor: "ORR", direction: "eastbound",
  status: "ok", live_s: 1920, free_flow_s: 1200, distance_m: 9000, pain_index: 62, minutes_lost: 12 };
const missing = { route_id: "b", name: "Hosur Rd", corridor: "Hosur", direction: "northbound",
  status: "missing", live_s: null, free_flow_s: null, distance_m: null, pain_index: null, minutes_lost: null };

test("notices", () => {
  assert.equal(noticeText("fresh", "2026-11-16T03:07:00Z"), null);
  assert.equal(noticeText("stale", "2026-11-16T03:07:00Z"), "Data is stale. Last update 8:37 am.");
  assert.equal(noticeText("overnight", null), "Collection resumes at 5:30am.");
  assert.equal(noticeText("empty", null), "Still collecting. First data arrives soon.");
});
test("updated header", () => {
  assert.equal(updatedText("2026-11-16T03:07:00Z"), "Updated 8:37 am");
  assert.equal(updatedText(null), "");
});
test("ok route shows band word, number, minutes", () => {
  const html = routeHtml(ok);
  assert.match(html, /band-high/);
  assert.match(html, />62</);
  assert.match(html, />High</);
  assert.match(html, /12 min lost/);
  assert.match(html, /32 min now vs 20 min free-flow/);
});
test("names are escaped", () => assert.match(routeHtml(ok), /ORR &lt;East&gt;/));
test("missing route shows no reading and no numbers", () => {
  const html = routeHtml(missing);
  assert.match(html, /no reading/);
  assert.doesNotMatch(html, /min lost|index-num/);
});
test("list keeps order", () => {
  const html = listHtml([ok, missing]);
  assert.ok(html.indexOf("ORR") < html.indexOf("Hosur"));
});
test("viewModel empty hides list and shows notice", () => {
  const vm = viewModel({ observed_at_utc: null, routes: [missing] }, Date.parse("2026-11-16T06:00:00Z"));
  assert.equal(vm.state, "empty");
  assert.equal(vm.listHtml, "");
  assert.match(vm.notice, /Still collecting/);
});
test("viewModel fresh has list and no notice", () => {
  const vm = viewModel({ observed_at_utc: "2026-11-16T04:00:00Z", routes: [ok] }, Date.parse("2026-11-16T04:10:00Z"));
  assert.equal(vm.state, "fresh");
  assert.equal(vm.notice, null);
  assert.match(vm.listHtml, /band-high/);
});
test("escapeHtml", () => assert.equal(escapeHtml(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;"));

test("route links to its corridor page, id encoded", () => {
  assert.match(routeHtml({ ...ok, route_id: "a b&c" }), /href="corridor\.html\?route=a%20b%26c"/);
});
test("numeric fields are coerced: strings with markup never reach the HTML", () => {
  const html = routeHtml({ ...ok, pain_index: "62", minutes_lost: "<img src=x>", live_s: 1920, free_flow_s: 1200 });
  assert.match(html, /no reading/);
  assert.doesNotMatch(html, /<img/);
});
test("a non-finite or null field means no reading", () => {
  for (const f of ["pain_index", "minutes_lost", "live_s", "free_flow_s"]) {
    assert.match(routeHtml({ ...ok, [f]: null }), /no reading/, `${f} null`);
    assert.match(routeHtml({ ...ok, [f]: "abc" }), /no reading/, `${f} abc`);
    assert.match(routeHtml({ ...ok, [f]: Infinity }), /no reading/, `${f} Infinity`);
  }
});
test("minutes lost shows at most one decimal", () => {
  assert.match(routeHtml({ ...ok, minutes_lost: 12.3456 }), /12\.3 min lost/);
  assert.match(routeHtml({ ...ok, minutes_lost: "30.0" }), />30 min lost</);
});
