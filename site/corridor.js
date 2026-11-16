import {
  band, heatmapGrid, slotRange, slotRange24, escapeHtml, istWeekday, routeLabel, tripMinutes,
  ageLabel, istDateLong, freshness, readingOf, BANDS, BAND_LABEL, BAND_RANGE,
} from "./lib.js";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const PEAKS = {
  morning: { name: "Morning", from: "07:00", to: "11:00", tag: "AM PEAK" },
  evening: { name: "Evening", from: "16:30", to: "21:00", tag: "PM PEAK" },
};
const MIN_READINGS = "at least 3 readings from 3 different weeks";

const hasIndex = (c) => Boolean(c) && c.status === "ok" && c.median_index != null && Number.isFinite(Number(c.median_index));
const cap = (s) => `${String(s ?? "")[0]?.toUpperCase() ?? ""}${String(s ?? "").slice(1)}`;

/* ---- corridors ---- */

export function corridorSlug(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "corridor";
}

const FORWARD = new Set(["northbound", "eastbound"]);

/** Routes grouped by corridor, corridors A to Z, northbound/eastbound route first. */
export function corridorsOf(latest) {
  const groups = new Map();
  for (const r of latest.routes ?? []) {
    const name = r.corridor || r.name || r.route_id || "Route";
    const slug = corridorSlug(name);
    if (!groups.has(slug)) groups.set(slug, { slug, name, routes: [] });
    groups.get(slug).routes.push(r);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.routes.sort((a, b) => Number(FORWARD.has(b.direction)) - Number(FORWARD.has(a.direction))
      || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** "Silk Board – Marathahalli" -> "Silk Board ⇔ Marathahalli" when both directions exist. */
export function corridorTitle(corridor) {
  return corridor.routes.length > 1 ? corridor.name.replace(/\s+[–—-]\s+/, " ⇔ ") : corridor.name;
}

function worstPain(corridor) {
  return Math.max(-1, ...corridor.routes.map((r) => readingOf(r)?.pain ?? -1));
}

/** The corridor for `?corridor=` or `?route=`; with neither, the worst one right now. null when unknown. */
export function pickCorridor(corridors, { corridor = null, route = null } = {}) {
  if (corridor) return corridors.find((c) => c.slug === corridor) ?? null;
  if (route) return corridors.find((c) => c.routes.some((r) => r.route_id === route)) ?? null;
  return [...corridors].sort((a, b) => worstPain(b) - worstPain(a))[0] ?? null;
}

export function directionName(direction) {
  return cap(direction) || "Route";
}

function directionTag(direction) {
  const d = String(direction ?? "").toUpperCase();
  if (!d) return "";
  return FORWARD.has(direction) ? `${d} →` : `← ${d}`;
}

/** One direction's live numbers. */
export function directionCardHtml(route) {
  const tag = escapeHtml(directionTag(route.direction));
  const head = `<p class="eyebrow muted">${tag}</p>`;
  const r = readingOf(route);
  if (!r) {
    return `<article class="dir-card card">${head}<p class="muted">No reading right now.</p></article>`;
  }
  const b = band(r.pain);
  return `<article class="dir-card card band-${b}">${head}`
    + `<span class="dir-num">${Math.round(r.pain)}</span>`
    + `<span class="dir-band">${BAND_LABEL[b]}</span>`
    + `<p class="dir-lost">+${Math.round(r.lost)} min lost</p>`
    + `<p class="dir-times">${Math.round(r.live / 60)} / ${Math.round(r.free / 60)} min</p>`
    + `<p class="caption">live / free-flow</p></article>`;
}

/* ---- heatmap ---- */

/** One heatmap cell, placed explicitly in the grid. Ok cells carry their number. */
export function cellHtml(cell, weekday, slot, col) {
  const when = `${WEEKDAY_SHORT[weekday]} ${slotRange(slot)}`;
  const pos = `grid-column:${col};grid-row:${3 + weekday}`;
  const data = `data-d="${weekday}" data-s="${escapeHtml(slot)}"`;
  if (!hasIndex(cell)) {
    return `<button type="button" class="hm-cell hm-insufficient" ${data} style="${pos}" aria-label="${escapeHtml(when)}: still collecting"></button>`;
  }
  const v = Math.round(Number(cell.median_index));
  const b = band(v);
  const n = cell.n != null ? `, ${cell.n} readings` : "";
  return `<button type="button" class="hm-cell hm-${b}" ${data} style="${pos}" aria-pressed="false"`
    + ` aria-label="${escapeHtml(`${when}: ${v}, ${BAND_LABEL[b]}${n}`)}">${v}</button>`;
}

/** Number of time slots in a heatmap (grid columns). */
export function slotCount(heatmap) {
  return heatmapGrid(heatmap.cells ?? []).slots.length;
}

function peakSpan(slots, peak) {
  const idx = slots.map((s, i) => (s >= peak.from && s < peak.to ? i : -1)).filter((i) => i >= 0);
  return idx.length ? { start: idx[0], count: idx.length } : null;
}

/** Weekdays down, half-hour slots across; peak windows outlined. Missing cells render as still collecting. */
export function heatmapHtml(heatmap) {
  const { slots, rows } = heatmapGrid(heatmap.cells ?? []);
  if (!slots.length) return "";
  const out = [];
  for (const peak of Object.values(PEAKS)) {
    const span = peakSpan(slots, peak);
    if (!span) continue;
    const col = `grid-column:${2 + span.start} / span ${span.count}`;
    out.push(`<div class="hm-peak" style="${col};grid-row:2 / span 8" aria-hidden="true"></div>`);
    out.push(`<span class="hm-peak-label" style="${col};grid-row:1" aria-hidden="true">${peak.tag}</span>`);
  }
  slots.forEach((slot, i) => {
    if (i % 3 === 0) {
      out.push(`<span class="hm-time" style="grid-column:${2 + i} / span ${Math.min(3, slots.length - i)};grid-row:2">${escapeHtml(slot)}</span>`);
    }
  });
  WEEKDAY_SHORT.forEach((d, wd) => out.push(`<span class="hm-day" style="grid-column:1;grid-row:${3 + wd}">${d}</span>`));
  rows.forEach((row, wd) => {
    slots.forEach((slot, i) => out.push(cellHtml(row.find((c) => c.slot === slot), wd, slot, 2 + i)));
  });
  return out.join("");
}

/** True when there are no cells with a reading. */
export function allInsufficient(heatmap) {
  return !(heatmap.cells ?? []).some(hasIndex);
}

/** The highest-index cell, or null when nothing has a reading. */
export function worstCell(heatmap) {
  let best = null;
  for (const c of heatmap.cells ?? []) {
    if (hasIndex(c) && (best === null || Number(c.median_index) > Number(best.median_index))) best = c;
  }
  return best;
}

/** Text of the dark detail panel for one cell. */
export function detailHtml(weekday, slot, cell) {
  const head = `<p>${WEEKDAY_SHORT[weekday]} · ${escapeHtml(slotRange24(slot))} IST</p>`;
  if (!hasIndex(cell)) {
    return `${head}<p>Not enough data yet${cell?.n != null ? ` / n = ${cell.n}` : ""}</p>`;
  }
  const v = Math.round(Number(cell.median_index));
  return `${head}<p>${v} · ${BAND_LABEL[band(v)]}${cell.n != null ? ` / n = ${cell.n}` : ""}</p>`;
}

export function legendHtml() {
  return BANDS.map((b) => `<li class="tone-${b}">${BAND_RANGE[b]} ${BAND_LABEL[b]}</li>`).join("")
    + `<li><span class="hatch-key"></span>Not enough data</li>`;
}

/* ---- best time to leave ---- */

/** Best and worst slot for one weekday and peak, with estimated trip times. */
export function departureModel({ departures, heatmap, route, weekday, peak }) {
  const day = (departures.weekdays ?? []).find((d) => d.weekday === weekday);
  const picked = day?.[peak];
  const valid = (x) => Boolean(x) && hasIndex({ status: "ok", median_index: x.median_index });
  if (!valid(picked?.best)) return { state: "collecting" };
  const make = (x) => {
    const v = Math.round(Number(x.median_index));
    const cell = (heatmap.cells ?? []).find((c) => c.weekday === weekday && c.slot === x.slot);
    return { range: slotRange24(x.slot), index: v, band: band(v), n: cell?.n ?? null, trip: tripMinutes(v, route?.free_flow_s) };
  };
  const best = make(picked.best);
  if (!valid(picked.worst)) return { state: "single", best };
  const worst = make(picked.worst);
  const saved = best.trip != null && worst.trip != null ? Math.max(0, worst.trip - best.trip) : null;
  return { state: "ok", best, worst, saved };
}

function slotBlock(label, s) {
  const trip = s.trip != null ? `≈ ${s.trip} min typical trip · IST` : "IST";
  return `<div class="slot band-${s.band}"><p class="eyebrow muted">${label}</p>`
    + `<span class="slot-range">${s.range}</span>`
    + `<p class="slot-idx tone-${s.band}">${s.index} · ${BAND_LABEL[s.band]}</p>`
    + `<p class="slot-trip">${trip}</p></div>`;
}

export function departureHtml(model, peakKey) {
  const peak = PEAKS[peakKey];
  if (model.state === "collecting") {
    return `<p class="muted">Still collecting. A slot is ranked once it has ${MIN_READINGS}.</p>`;
  }
  if (model.state === "single") {
    return `<div class="slots">${slotBlock("Best slot", model.best)}</div>`
      + `<p class="muted">No clearly worse slot to compare it with yet.</p>`;
  }
  const { best, worst, saved } = model;
  const headline = saved == null ? ""
    : saved > 0 ? `<p class="saved">${saved} ${saved === 1 ? "minute" : "minutes"} back in your day.</p>`
      : `<p class="saved">Little difference between these slots.</p>`;
  const counts = best.n != null && worst.n != null ? ` Based on ${best.n} readings in the best slot and ${worst.n} in the worst;` : "";
  return `<div class="slots">${slotBlock("Best slot", best)}${slotBlock("Worst slot", worst)}</div>${headline}`
    + `<p class="muted">Compared with the worst ${peak.name.toLowerCase()} slot.${counts} this is a pattern, not a guarantee. Trip times are estimated from the Pain Index and free-flow time.</p>`;
}

/* ---- page ---- */

function selectHtml(id, label, options, selected) {
  const opts = options.map(([value, text]) =>
    `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? " selected" : ""}>${escapeHtml(text)}</option>`).join("");
  return `<label class="select-wrap"><span class="sr-only">${escapeHtml(label)}</span><select id="${id}">${opts}</select></label>`;
}

async function main() {
  const $ = (id) => document.getElementById(id);
  try {
    const { loadJson, showError } = await import("./data.js").catch((err) => {
      throw new Error(`Could not start the page: ${err.message}`);
    });
    try {
      const params = new URLSearchParams(location.search);
      const latest = await loadJson("latest.json");
      const corridors = corridorsOf(latest);
      if (!corridors.length) throw new Error("No routes to show yet. Check back after the first collection.");
      const corridor = pickCorridor(corridors, { corridor: params.get("corridor"), route: params.get("route") });
      if (!corridor) throw new Error("Unknown corridor or route. Pick one from the Live now page.");

      const files = await Promise.all(corridor.routes.map(async (route) => {
        const id = encodeURIComponent(route.route_id);
        const [heatmap, departures] = await Promise.all([loadJson(`heatmap/${id}.json`), loadJson(`departures/${id}.json`)]);
        return { route, heatmap, departures };
      }));
      const byId = new Map(files.map((f) => [f.route.route_id, f]));
      const now = Date.now();
      const observed = latest.observed_at_utc ?? null;
      const state = freshness(observed, now);

      // header
      document.title = `${corridorTitle(corridor)} · ORR Pain Index`;
      $("corridor-title").textContent = corridorTitle(corridor);
      $("lede").textContent = corridor.routes.length > 1
        ? "Two directions. One very different commute." : "One direction measured so far.";
      $("today").textContent = observed ? `${istDateLong(observed)} · All times IST` : "All times IST";
      const chip = $("chip");
      chip.textContent = state === "fresh" ? `Updated ${ageLabel(observed, now)}`
        : state === "stale" ? `Stale, last updated ${ageLabel(observed, now) || "a while ago"}`
          : state === "overnight" ? "Overnight · back at 5:30 am" : "Waiting for first data";
      chip.className = `chip chip-${state === "fresh" ? "fresh" : state === "stale" ? "stale" : "idle"}`;
      $("switch").innerHTML = selectHtml("corridor-select", "Switch corridor",
        corridors.map((c) => [c.slug, corridorTitle(c)]), corridor.slug);
      $("corridor-select").addEventListener("change", (e) => {
        const next = new URLSearchParams(location.search);
        next.delete("route");
        next.set("corridor", e.target.value);
        location.search = next.toString();
      });

      $("cards").innerHTML = corridor.routes.map(directionCardHtml).join("");
      $("legend").innerHTML = legendHtml();

      // heatmap
      const dirOptions = corridor.routes.map((r) => [r.route_id, directionName(r.direction)]);
      const startRoute = corridor.routes.find((r) => r.route_id === params.get("route")) ?? corridor.routes[0];
      let hmId = startRoute.route_id;
      let pinned = null;

      const showDetail = (d, s) => {
        const cell = (byId.get(hmId).heatmap.cells ?? []).find((c) => c.weekday === d && c.slot === s);
        $("hm-detail").innerHTML = detailHtml(d, s, cell);
      };
      const renderHeatmap = () => {
        const { heatmap } = byId.get(hmId);
        const grid = $("heatmap");
        grid.style.setProperty("--cols", String(slotCount(heatmap)));
        grid.innerHTML = heatmapHtml(heatmap);
        $("hm-notice").hidden = !allInsufficient(heatmap);
        const worst = worstCell(heatmap);
        pinned = worst ? { d: worst.weekday, s: worst.slot } : null;
        if (pinned) {
          grid.querySelector(`[data-d="${pinned.d}"][data-s="${pinned.s}"]`)?.setAttribute("aria-pressed", "true");
          showDetail(pinned.d, pinned.s);
        } else {
          $("hm-detail").innerHTML = `<p>No readings yet</p><p>Cells fill in as slots collect data</p>`;
        }
      };
      $("hm-route").innerHTML = selectHtml("hm-route-select", "Direction for the heatmap", dirOptions, hmId);
      $("hm-route-select").addEventListener("change", (e) => { hmId = e.target.value; renderHeatmap(); });
      const cellOf = (e) => e.target.closest?.(".hm-cell");
      const grid = $("heatmap");
      const hover = (e) => { const c = cellOf(e); if (c) showDetail(Number(c.dataset.d), c.dataset.s); };
      grid.addEventListener("mouseover", hover);
      grid.addEventListener("focusin", hover);
      grid.addEventListener("mouseleave", () => { if (pinned) showDetail(pinned.d, pinned.s); });
      grid.addEventListener("click", (e) => {
        const c = cellOf(e);
        if (!c || c.classList.contains("hm-insufficient")) return;
        grid.querySelectorAll('.hm-cell[aria-pressed="true"]').forEach((x) => x.setAttribute("aria-pressed", "false"));
        c.setAttribute("aria-pressed", "true");
        pinned = { d: Number(c.dataset.d), s: c.dataset.s };
        showDetail(pinned.d, pinned.s);
      });
      renderHeatmap();

      // best time to leave
      let dep = { route: startRoute.route_id, weekday: istWeekday(now), peak: "evening" };
      const renderDeparture = () => {
        const f = byId.get(dep.route);
        const peak = PEAKS[dep.peak];
        $("dep-title").textContent = `Buy back some of your ${peak.name.toLowerCase()}.`;
        $("dep-sub").textContent = `Comparing departure slots within ${peak.from}–${peak.to}`;
        $("dep-body").innerHTML = departureHtml(
          departureModel({ departures: f.departures, heatmap: f.heatmap, route: f.route, weekday: dep.weekday, peak: dep.peak }), dep.peak);
      };
      $("dep-controls").innerHTML =
        selectHtml("dep-route", "Direction", dirOptions, dep.route)
        + selectHtml("dep-day", "Weekday", WEEKDAYS.map((n, i) => [i, n]), dep.weekday)
        + selectHtml("dep-peak", "Time of day", Object.entries(PEAKS).map(([k, p]) => [k, p.name]), dep.peak);
      $("dep-route").addEventListener("change", (e) => { dep.route = e.target.value; renderDeparture(); });
      $("dep-day").addEventListener("change", (e) => { dep.weekday = Number(e.target.value); renderDeparture(); });
      $("dep-peak").addEventListener("change", (e) => { dep.peak = e.target.value; renderDeparture(); });
      renderDeparture();

      // closing insight: the worst half-hour on record for this corridor
      let top = null;
      for (const f of files) {
        const c = worstCell(f.heatmap);
        if (c && (!top || Number(c.median_index) > Number(top.cell.median_index))) top = { cell: c, route: f.route };
      }
      if (top) {
        const v = Math.round(Number(top.cell.median_index));
        $("insight-text").textContent = `${directionName(top.route.direction)}, ${WEEKDAY_SHORT[top.cell.weekday]} ${slotRange24(top.cell.slot)} IST: ${v} · ${BAND_LABEL[band(v)]}.`;
        $("insight").hidden = false;
      }
      $("content").hidden = false;
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
