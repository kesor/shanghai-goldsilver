import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { SHANGHAI_OFFSET_MS } from "./consts.js";

function floorToIntervalShanghai(ms, intervalMs) {
  // align buckets to Shanghai wall-clock boundaries
  return (
    Math.floor((ms + SHANGHAI_OFFSET_MS) / intervalMs) * intervalMs -
    SHANGHAI_OFFSET_MS
  );
}

export function createOHLC(data, intervalMin = 5) {
  if (!data?.length) return [];

  const nowMs = Date.now(); // absolute instant now
  const nowShanghaiMs = nowMs + SHANGHAI_OFFSET_MS;
  const intervalMs = intervalMin * 60_000;

  const rows = data
    .map((d) => {
      const t = new Date(d.timestamp);
      const price = +d.price_cny;
      const rate = +d.usd_cny_rate;
      return { t, price, rate };
    })
    .filter((d) => !Number.isNaN(d.t.getTime()) && Number.isFinite(d.price))
    .filter((d) => d.t.getTime() + SHANGHAI_OFFSET_MS <= nowShanghaiMs)
    .sort((a, b) => a.t - b.t);
  const grouped = d3.group(rows, (d) =>
    floorToIntervalShanghai(d.t.getTime(), intervalMs),
  );

  return Array.from(grouped, ([bucketMs, values]) => {
    return {
      date: new Date(bucketMs),

      open: values[0].price,
      close: values[values.length - 1].price,
      high: d3.max(values, (v) => v.price),
      low: d3.min(values, (v) => v.price),

      fx_close: values[values.length - 1].rate, // useful for right labels
    };
  }).sort((a, b) => a.date - b.date);
}
