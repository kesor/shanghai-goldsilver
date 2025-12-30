import { SHANGHAI_OFFSET_MS, OZT_GRAMS } from "./consts.js";

// metal: "gold" | "silver"
// unit:  "CNY/g" | "CNY/kg"
export function buildChartTitle({ title, metal, unit, ohlc, windowStartUtcMs, windowEndUtcMs }) {
  if (!ohlc?.length) return title;

  // only consider candles in the visible window
  const vis = ohlc.filter(d => {
    const ms = d.date.getTime();
    return ms >= windowStartUtcMs && ms <= windowEndUtcMs;
  });
  if (!vis.length) return title;

  const high = Math.max(...vis.map(d => d.high));
  const low = Math.min(...vis.map(d => d.low));
  const last = vis[vis.length - 1];

  // fx comes from the last candle’s stored close rate
  const fx = Number.isFinite(last.fx_close) ? last.fx_close : NaN;

  const usdHigh = cnyToUsdOzt(high, fx, unit, metal);
  const usdLow = cnyToUsdOzt(low, fx, unit, metal);

  const lastSh = fmtShanghai(last.date.getTime());

  const fxStr = Number.isFinite(fx) ? fx.toFixed(4) : "n/a";
  const cnyFmt = unit === "CNY/g" ? 2 : 0;
  const usdFmt = metal === "gold" ? 0 : 2;

  return `${title} | FX ${fxStr} | Hi ¥${high.toFixed(cnyFmt)} ($${usdHigh.toFixed(usdFmt)}) | Lo ¥${low.toFixed(cnyFmt)} ($${usdLow.toFixed(usdFmt)}) | Last ${lastSh}`;
}

function cnyToUsdOzt(cny, fx, unit, metal) {
  if (!Number.isFinite(cny) || !Number.isFinite(fx) || fx <= 0) return NaN;

  // normalize CNY -> CNY/gram
  // silver arrives as CNY/kg, gold as CNY/g (per your collector)
  const cnyPerGram = unit === "CNY/kg" ? (cny / 1000.0) : cny;

  // USD/ozt = (CNY/g * g/ozt) / (CNY/USD)
  return (cnyPerGram * OZT_GRAMS) / fx;
}

function fmtShanghai(msUtc) {
  const d = new Date(msUtc + SHANGHAI_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

