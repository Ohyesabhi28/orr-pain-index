// Pure helpers: no DOM, no fetch, so Node can import them for tests.

const IST_OFFSET_MIN = 330;
const STALE_AFTER_MS = 45 * 60 * 1000;
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
  const minutes = istMinutesOfDay(nowMs);
  if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) return "overnight";
  const old = nowMs - Date.parse(observedAtIso) > STALE_AFTER_MS;
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
