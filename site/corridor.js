import { band, heatmapGrid, slotRange, slotLabel, escapeHtml, BAND_LABEL } from "./lib.js";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COLLECTING = "still collecting";

const hasIndex = (c) => c && c.status === "ok" && Number.isFinite(Number(c.median_index)) && c.median_index != null;

/** One heatmap cell. Ok cells carry their number; insufficient cells say "still collecting" in text. */
export function cellHtml(cell, weekday, slot) {
  const when = `${WEEKDAY_SHORT[weekday]} ${slotRange(slot)}`;
  if (!hasIndex(cell)) {
    return `<div class="hm-cell hm-insufficient" title="${escapeHtml(when)}: ${COLLECTING}">`
      + `<span class="sr-only">${escapeHtml(when)}: ${COLLECTING}</span></div>`;
  }
  const v = Math.round(Number(cell.median_index));
  const b = band(v);
  return `<div class="hm-cell hm-${b}" title="${escapeHtml(when)}: ${v}, ${BAND_LABEL[b]}">`
    + `<span class="sr-only">${escapeHtml(when)}: ${BAND_LABEL[b]}, </span>${v}</div>`;
}

/** Time runs down, weekdays across (fits a phone). Missing cells render as still collecting. */
export function heatmapHtml(heatmap) {
  const { slots, rows } = heatmapGrid(heatmap.cells ?? []);
  const head = `<div class="hm-corner"></div>`
    + WEEKDAY_SHORT.map((d) => `<div class="hm-day">${d}</div>`).join("");
  const lines = slots.map((slot) => {
    const cells = rows.map((row, wd) => cellHtml(row.find((c) => c.slot === slot), wd, slot)).join("");
    return `<div class="hm-time">${escapeHtml(slotLabel(slot))}</div>${cells}`;
  });
  return head + lines.join("");
}

/** True when there are no cells with a reading. */
export function allInsufficient(heatmap) {
  return !(heatmap.cells ?? []).some(hasIndex);
}

function pickHtml(label, pick) {
  if (!pick || !hasIndex({ status: "ok", median_index: pick.median_index })) return null;
  const v = Math.round(Number(pick.median_index));
  return `<span class="dep-${label.toLowerCase()}">${label}</span> ${escapeHtml(slotRange(pick.slot))}`
    + ` <span class="dep-idx">(${v}, ${BAND_LABEL[band(v)]})</span>`;
}

function peakHtml(peak) {
  const best = pickHtml("Best", peak?.best);
  const worst = pickHtml("Worst", peak?.worst);
  if (!best || !worst) return `<span class="dep-none">${COLLECTING}</span>`;
  return `${best}<br>${worst}`;
}

/** Best and worst departure window per weekday, morning and evening. */
export function departuresHtml(departures) {
  const byDay = new Map((departures.weekdays ?? []).map((d) => [d.weekday, d]));
  const rows = WEEKDAYS.map((name, wd) => {
    const d = byDay.get(wd);
    return `<tr><th scope="row">${name}</th><td>${peakHtml(d?.morning)}</td><td>${peakHtml(d?.evening)}</td></tr>`;
  });
  return `<table class="dep-table"><caption class="sr-only">Best and worst departure windows</caption>`
    + `<thead><tr><th scope="col">Day</th><th scope="col">Morning (7-11 am)</th><th scope="col">Evening (4:30-9 pm)</th></tr></thead>`
    + `<tbody>${rows.join("")}</tbody></table>`;
}

/** Everything the page shows, as plain data. */
export function viewModel(heatmap, departures) {
  const empty = allInsufficient(heatmap);
  return {
    title: heatmap.name ?? "",
    notice: empty ? "Still collecting. This route needs at least 3 readings from 3 different weeks per time slot." : null,
    heatmapHtml: heatmapHtml(heatmap),
    departuresHtml: departuresHtml(departures),
  };
}

/** Route ids come from latest.json; anything else is "unknown". Returns the route or null. */
export function findRoute(latest, id) {
  if (!id) return null;
  return (latest.routes ?? []).find((r) => r.route_id === id) ?? null;
}

async function main() {
  try {
    const { loadJson, showError } = await import("./data.js").catch((err) => {
      throw new Error(`Could not start the page: ${err.message}`);
    });
    try {
      const id = new URLSearchParams(location.search).get("route");
      if (!id) throw new Error("No route selected. Pick a route from the Live now page.");
      const route = findRoute(await loadJson("latest.json"), id);
      if (!route) throw new Error(`Unknown route "${id}". Pick a route from the Live now page.`);
      const [heatmap, departures] = await Promise.all([
        loadJson(`heatmap/${encodeURIComponent(id)}.json`),
        loadJson(`departures/${encodeURIComponent(id)}.json`),
      ]);
      const vm = viewModel(heatmap, departures);
      document.title = `${vm.title} · ORR Pain Index`;
      document.getElementById("route-name").textContent = vm.title;
      document.getElementById("route-where").textContent = [route.corridor, route.direction].filter(Boolean).join(" · ");
      const notice = document.getElementById("notice");
      notice.textContent = vm.notice ?? "";
      notice.hidden = vm.notice === null;
      document.getElementById("heatmap").innerHTML = vm.heatmapHtml;
      document.getElementById("departures").innerHTML = vm.departuresHtml;
      document.getElementById("content").hidden = false;
    } catch (err) {
      showError(err.message);
    }
  } catch (err) {
    const notice = document.getElementById("notice");
    if (notice) {
      notice.textContent = err.message;
      notice.hidden = false;
    }
  }
}

if (typeof document !== "undefined") main();
