import { SHANGHAI_OFFSET_MS } from "./consts.js";

export function fmtTickShanghai(date) {
  const ms = date.getTime() + SHANGHAI_OFFSET_MS;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
