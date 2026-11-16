import { freshness, band, istClock } from "./lib.js";

const BAND_LABEL = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe" };

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Notice text for a freshness state, or null when there is nothing to say. */
export function noticeText(state, observedAtIso) {
  if (state === "stale") return `Data is stale. Last update ${istClock(observedAtIso)}.`;
  if (state === "overnight") return "Collection resumes at 5:30am.";
  if (state === "empty") return "Still collecting. First data arrives soon.";
  return null;
}

/** Header line, or "" when there is no observation. */
export function updatedText(observedAtIso) {
  return observedAtIso ? `Updated ${istClock(observedAtIso)}` : "";
}

const mins = (seconds) => Math.round(seconds / 60);

/** One route as an HTML string. Band is shown as a word as well as a colour. */
export function routeHtml(route) {
  const name = escapeHtml(route.name);
  const where = escapeHtml([route.corridor, route.direction].filter(Boolean).join(" · "));
  const head = `<div class="route-name">${name}</div><div class="route-dir">${where}</div>`;
  if (route.status !== "ok" || route.pain_index == null) {
    return `<li class="route route-missing">${head}<div class="route-nodata">no reading</div></li>`;
  }
  const b = band(route.pain_index);
  return `<li class="route band-${b}">${head}`
    + `<div class="route-index"><span class="index-num">${route.pain_index}</span>`
    + `<span class="index-band">${BAND_LABEL[b]}</span></div>`
    + `<div class="route-lost">${route.minutes_lost} min lost</div>`
    + `<div class="route-times">${mins(route.live_s)} min now vs ${mins(route.free_flow_s)} min free-flow</div>`
    + `</li>`;
}

export function listHtml(routes) {
  return routes.map(routeHtml).join("");
}

/** Everything the page shows, as plain data. */
export function viewModel(latest, nowMs) {
  const observed = latest.observed_at_utc ?? null;
  const state = freshness(observed, nowMs);
  return {
    state,
    updated: updatedText(observed),
    notice: noticeText(state, observed),
    listHtml: state === "empty" ? "" : listHtml(latest.routes ?? []),
  };
}

async function main() {
  const { loadJson, showError } = await import("./data.js");
  try {
    const file = new URLSearchParams(location.search).get("latest") || "latest.json"; // ?latest=latest-empty.json for fixture checks
    const latest = await loadJson(file);
    const vm = viewModel(latest, Date.now());
    document.getElementById("updated").textContent = vm.updated;
    const notice = document.getElementById("notice");
    notice.textContent = vm.notice ?? "";
    notice.hidden = vm.notice === null;
    document.getElementById("routes").innerHTML = vm.listHtml;
  } catch (err) {
    showError(err.message);
  }
}

if (typeof document !== "undefined") main();
