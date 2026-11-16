// Pure helpers: no DOM, no fetch, so Node can import them for tests.

const IST_OFFSET_MIN = 330;
const STALE_AFTER_MS = 45 * 60 * 1000;
const DEAD_AFTER_MS = 8 * 60 * 60 * 1000; // normal overnight gap is ~6 h (23:22 to 05:37 IST)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OPEN_MIN = 5 * 60 + 30; // 05:30 IST
const CLOSE_MIN = 23 * 60 + 30; // 23:30 IST
const WARMUP_END_MIN = 6 * 60 + 15; // 06:15 IST

function istMinutesOfDay(ms) {
  const shifted = new Date(ms + IST_OFFSET_MIN * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "fresh" | "stale" | "overnight" | "empty" */
export function freshness(observedAtIso, nowMs) {
  if (observedAtIso == null) return "empty";
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) return "stale"; // unparseable: never claim "fresh"
  if (nowMs - observedMs > DEAD_AFTER_MS) return "stale"; // a dead collector is stale even overnight
  const minutes = istMinutesOfDay(nowMs);
  if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) return "overnight";
  const old = nowMs - observedMs > STALE_AFTER_MS;
  if (old && minutes < WARMUP_END_MIN) return "overnight";
  return old ? "stale" : "fresh";
}

/** "low" | "moderate" | "high" | "severe" */
export function band(index) {
  if (index < 25) return "low";
  if (index < 50) return "moderate";
  if (index < 75) return "high";
  return "severe";
}

/** IST wall clock like "8:37 am". */
export function istClock(iso) {
  const minutes = istMinutesOfDay(Date.parse(iso));
  const h24 = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

function istDayNumber(ms) {
  return Math.floor((ms + IST_OFFSET_MIN * 60 * 1000) / 86400000);
}

/** IST calendar date like "11 Nov". */
export function istDateLabel(iso) {
  const shifted = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60 * 1000);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
}

/** True when the ISO instant falls on the same IST calendar day as `nowMs`. */
export function isIstToday(iso, nowMs) {
  return istDayNumber(Date.parse(iso)) === istDayNumber(nowMs);
}

/**
 * Arrange heatmap cells into 7 rows (Monday first) of cells in slot order.
 * `slots` is the sorted list of distinct slot labels found in the cells.
 */
export function heatmapGrid(cells) {
  const slots = [...new Set(cells.map((c) => c.slot))].sort();
  const rows = Array.from({ length: 7 }, () => []);
  for (const c of cells) {
    if (Number.isInteger(c.weekday) && c.weekday >= 0 && c.weekday < 7) rows[c.weekday].push(c);
  }
  for (const row of rows) row.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  return { slots, rows };
}

function clock12(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: `${h12}:${String(m % 60).padStart(2, "0")}`, mer: h24 < 12 ? "am" : "pm" };
}

/** A 30-minute slot start like "08:30" as "8:30–9:00 am" (meridiem shown on both ends when it changes). */
export function slotRange(slot) {
  const [h, m] = slot.split(":").map(Number);
  const start = clock12(h * 60 + m);
  const end = clock12(h * 60 + m + 30);
  return start.mer === end.mer
    ? `${start.text}–${end.text} ${end.mer}`
    : `${start.text} ${start.mer}–${end.text} ${end.mer}`;
}

/** A slot start like "08:30" as "8:30 am". */
export function slotLabel(slot) {
  const [h, m] = slot.split(":").map(Number);
  const c = clock12(h * 60 + m);
  return `${c.text} ${c.mer}`;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const BANDS = ["low", "moderate", "high", "severe"];
export const BAND_LABEL = { low: "Smooth", moderate: "Slow", high: "Heavy", severe: "Gridlock" };
export const BAND_RANGE = { low: "0–24", moderate: "25–49", high: "50–74", severe: "75–100" };

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_UPPER = MONTHS.map((m) => m.toUpperCase());

/** Number(...) with null/blank/non-numeric treated as NaN (Number(null) would be 0). */
export function finiteOrNaN(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  return Number(v);
}

/** A route's numbers, or null when it has no usable reading. */
export function readingOf(route) {
  const pain = finiteOrNaN(route.pain_index);
  const lost = finiteOrNaN(route.minutes_lost);
  const live = finiteOrNaN(route.live_s);
  const free = finiteOrNaN(route.free_flow_s);
  if (route.status !== "ok" || ![pain, lost, live, free].every(Number.isFinite)) return null;
  return { pain, lost, live, free };
}

/** Age of an observation as "6 min ago", "9 h ago". "" when the date cannot be read. */
export function ageLabel(iso, nowMs) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor(Math.max(0, nowMs - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** IST calendar date like "MON, 16 NOV 2026". */
export function istDateLong(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + IST_OFFSET_MIN * 60 * 1000);
  return `${WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7].toUpperCase()}, ${d.getUTCDate()} ${MONTHS_UPPER[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Weekday of an instant in IST, Monday = 0 (matches the analysis files). */
export function istWeekday(ms) {
  return (new Date(ms + IST_OFFSET_MIN * 60 * 1000).getUTCDay() + 6) % 7;
}

/** "Silk Board to Marathahalli" -> "Silk Board → Marathahalli". Other names are left alone. */
export function routeLabel(name) {
  return String(name ?? "").replace(/\s+to\s+/, " → ");
}

/** A slot start like "18:00" as "18:00–18:30". */
export function slotRange24(slot) {
  const [h, m] = String(slot).split(":").map(Number);
  const end = h * 60 + m + 30;
  const hh = String(Math.floor(end / 60) % 24).padStart(2, "0");
  return `${slot}–${hh}:${String(end % 60).padStart(2, "0")}`;
}

/**
 * Estimated trip time in minutes for a Pain Index, from the route's free-flow time.
 * Inverts index = (ratio - 1) / (CEILING - 1) * 100 with CEILING = 3.
 */
export function tripMinutes(index, freeFlowS) {
  const i = Number(index), f = Number(freeFlowS);
  if (index == null || freeFlowS == null || !Number.isFinite(i) || !Number.isFinite(f) || f <= 0) return null;
  return Math.round((f / 60) * (1 + i / 50));
}
