import { MINUTE_MS, DAY_MS, SHANGHAI_OFFSET_MS } from "./consts.js";

export function shanghaiMidnightUtcMs(msUtc) {
  // Get Shanghai midnight in UTC milliseconds for given UTC time
  const sh = msUtc + SHANGHAI_OFFSET_MS;
  const day = Math.floor(sh / DAY_MS);
  return day * DAY_MS - SHANGHAI_OFFSET_MS;
}

export function shanghaiHM(msUtc) {
  // Get Shanghai time hours and minutes from UTC milliseconds
  const d = new Date(msUtc + SHANGHAI_OFFSET_MS);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

export function shanghaiTimeUtcMs(day0UtcMs, hh, mm) {
  // Convert Shanghai time (hours, minutes) to UTC milliseconds
  return day0UtcMs + (hh * 60 + mm) * MINUTE_MS;
}
