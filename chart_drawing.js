import { fmtTickShanghai } from "./axis_fmt.js";
import { OZT } from "./consts.js";

export function drawGrid(ctx, plot, y) {
  // Draw horizontal grid lines
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "#999";

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.w, plot.h);
  ctx.clip();

  for (const t of y.ticks(8)) {
    const yy = y(t);
    ctx.beginPath();
    ctx.moveTo(plot.left, yy);
    ctx.lineTo(plot.right, yy);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawAxes(ctx, plot, x, y, fxCnyPerUsd, unit, metal) {
  // Draw X and Y axes with tick labels
  ctx.lineWidth = 1;
  ctx.strokeStyle = "white";
  ctx.fillStyle = "white";
  ctx.font = "12px Arial";

  // X axis
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.bottom);
  ctx.lineTo(plot.right, plot.bottom);
  ctx.stroke();

  const xt = x.ticks(Math.max(2, Math.floor(plot.w / 120)));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xt) {
    const xx = x(t);
    ctx.beginPath();
    ctx.moveTo(xx, plot.bottom);
    ctx.lineTo(xx, plot.bottom + 5);
    ctx.stroke();
    ctx.fillText(fmtTickShanghai(t), xx, plot.bottom + 7);
  }

  const yt = y.ticks(8);

  // Left Y axis (CNY)
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.top);
  ctx.lineTo(plot.left, plot.bottom);
  ctx.stroke();

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const cnyDigits = unit === "CNY/g" ? 2 : 0;

  for (const t of yt) {
    const yy = y(t);
    ctx.beginPath();
    ctx.moveTo(plot.left - 5, yy);
    ctx.lineTo(plot.left, yy);
    ctx.stroke();
    ctx.fillText(`¥${t.toFixed(cnyDigits)}`, plot.left - 8, yy);
  }

  // Right Y axis (USD/ozt), same y-scale
  ctx.beginPath();
  ctx.moveTo(plot.right, plot.top);
  ctx.lineTo(plot.right, plot.bottom);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const fxOk = Number.isFinite(fxCnyPerUsd) && fxCnyPerUsd > 0;
  const usdDigits = metal === "gold" ? 0 : 2;

  for (const t of yt) {
    const yy = y(t);
    ctx.beginPath();
    ctx.moveTo(plot.right, yy);
    ctx.lineTo(plot.right + 5, yy);
    ctx.stroke();

    const usd = fxOk ? cnyTickToUsdOzt(t, fxCnyPerUsd, unit) : NaN;
    const label = Number.isFinite(usd) ? `$${usd.toFixed(usdDigits)}` : "—";
    ctx.fillText(label, plot.right + 8, yy);
  }
}

export function drawCandles(ctx, plot, x, y, ohlc) {
  // Draw candlestick chart with dynamic width calculation
  let w = 3;
  if (ohlc.length >= 2) {
    let minDx = Infinity;
    for (let i = 1; i < ohlc.length; i++) {
      const dx = x(ohlc[i].date) - x(ohlc[i - 1].date);
      if (dx > 0 && dx < minDx) minDx = dx;
    }
    if (Number.isFinite(minDx)) w = Math.max(1, minDx * 0.7);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.w, plot.h);
  ctx.clip();

  for (const d of ohlc) {
    const xx = x(d.date);

    // wick
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xx, y(d.high));
    ctx.lineTo(xx, y(d.low));
    ctx.stroke();

    // body
    const up = d.close >= d.open;
    ctx.fillStyle = up ? "#00ff00" : "#ff0000";
    const y0 = y(Math.max(d.open, d.close));
    const h = Math.max(1, Math.abs(y(d.open) - y(d.close)));
    ctx.fillRect(xx - w / 2, y0, w, h);
  }

  ctx.restore();
}

export function cnyTickToUsdOzt(cnyTick, fxCnyPerUsd, unit) {
  // Convert CNY price to USD per troy ounce
  if (!Number.isFinite(cnyTick) || !Number.isFinite(fxCnyPerUsd) || fxCnyPerUsd <= 0)
    return NaN;

  const cnyPerGram = unit === "CNY/kg" ? cnyTick / 1000.0 : cnyTick;
  return (cnyPerGram * OZT) / fxCnyPerUsd;
}
