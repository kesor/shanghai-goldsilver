import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { fmtTickShanghai } from "./axis_fmt.js";
import { drawShanghaiSessions } from "./sessions.js";
import { HOUR_MS, DAY_MS, OZT } from "./consts.js";
import { shanghaiMidnightUtcMs, shanghaiTimeUtcMs } from "./time_shanghai.js";

export class CandleChart {
  constructor(containerId, opts = {}) {
    this.containerId = containerId;

    this.title = opts.title ?? "";
    this.metal = opts.metal ?? "gold"; // "gold" | "silver"
    this.unit = opts.unit ?? "CNY/g"; // "CNY/g" | "CNY/kg"

    this.margin = opts.margin ?? { top: 20, right: 120, bottom: 30, left: 90 };

    this.fills = opts.fills ?? {
      night: "rgba(25, 25, 112, 0.35)",
      day: "rgba(139, 69, 19, 0.35)",
    };

    this.window = opts.window ?? {
      sessions: 2,
      day: { start: [9, 0], end: [15, 30], padLeftH: 1, padRightH: 1 }, // 08:00..16:30
      night: { start: [20, 0], end: [2, 30], padLeftH: 1, padRightH: 1 }, // 19:00..03:30
    };

    // title stats
    this.titleOpts = opts.titleOpts ?? {
      showFx: true,
      showHiLo: true,
      showLast: true,
      cnyDigits: this.unit === "CNY/g" ? 2 : 0,
      usdDigits: this.metal === "gold" ? 0 : 2,
    };

    // rendering
    this.yPadPct = opts.yPadPct ?? 0.03; // 3%
    this.yPadMin = opts.yPadMin ?? 1;

    this.canvas = null;
    this.ctx = null;
  }

  setTitle(title) {
    // Set chart title and return this for chaining
    this.title = title;
    return this;
  }

  render(ohlc) {
    // Render candlestick chart with given OHLC data
    const container = document.getElementById(this.containerId);
    if (!container) return this;

    // always clear/repaint container
    container.innerHTML = "";

    if (!ohlc?.length) {
      this.#setTitle(container, this.title);
      return this;
    }

    const width = container.clientWidth;
    const height = container.clientHeight - 40;

    const m = this.margin;
    const plot = {
      left: m.left,
      top: m.top,
      w: width - m.left - m.right,
      h: height - m.top - m.bottom,
      right: width - m.right,
      bottom: height - m.bottom,
    };

    // windowed x
    const x = this.#buildX(width);

    // visible data only (keeps gap data if it exists, does not create artificial gap fill)
    const [d0, d1] = x.domain();
    const domMin = d0.getTime();
    const domMax = d1.getTime();

    const visible = ohlc.filter((d) => {
      const t = d.date.getTime();
      return t >= domMin && t <= domMax;
    });

    // title uses the window, but stats use visible data if present
    const fx = visible.length ? visible[visible.length - 1].fx_close : NaN;
    this.#setTitle(container, this.#buildTitle(visible, fx));

    // still render axes/sessions even if no points in the window
    const y = this.#buildY(visible, plot);

    this.#ensureCanvas(container, width, height);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    // sessions shading across full x-domain
    this.#clipPlot(plot);
    drawShanghaiSessions(ctx, x, plot, this.fills);
    this.#unclip();

    this.#drawGrid(ctx, plot, y);
    this.#drawAxes(ctx, plot, x, y, fx);

    if (visible.length) this.#drawCandles(ctx, plot, x, y, visible);

    return this;
  }

  // ------------------------
  // title
  // ------------------------

  #setTitle(container, text) {
    // Create and append title element to container
    const h2 = document.createElement("h2");
    h2.style.color = "white";
    h2.style.margin = "0 0 10px 0";
    h2.textContent = text ?? "";
    container.appendChild(h2);
  }

  #buildTitle(visible, fxCnyPerUsd) {
    // Build chart title with price stats and FX rate
    const base = this.title ?? "";

    if (!visible?.length) return base;

    const t = this.titleOpts;
    const parts = [base];

    const hi = d3.max(visible, (d) => d.high);
    const lo = d3.min(visible, (d) => d.low);
    const last = visible[visible.length - 1];

    if (t.showFx) {
      const fxStr =
        Number.isFinite(fxCnyPerUsd) && fxCnyPerUsd > 0
          ? fxCnyPerUsd.toFixed(4)
          : "n/a";
      parts.push(`FX ${fxStr}`);
    }

    if (t.showHiLo) {
      const cnyDigits = t.cnyDigits ?? 0;
      const usdDigits = t.usdDigits ?? 2;

      const hiUsd = this.#cnyTickToUsdOzt(hi, fxCnyPerUsd);
      const loUsd = this.#cnyTickToUsdOzt(lo, fxCnyPerUsd);

      const hiUsdStr = Number.isFinite(hiUsd)
        ? `$${hiUsd.toFixed(usdDigits)}`
        : "—";
      const loUsdStr = Number.isFinite(loUsd)
        ? `$${loUsd.toFixed(usdDigits)}`
        : "—";

      parts.push(`Hi ¥${hi.toFixed(cnyDigits)} (${hiUsdStr})`);
      parts.push(`Lo ¥${lo.toFixed(cnyDigits)} (${loUsdStr})`);
    }

    if (t.showLast) {
      const lastStr = fmtTickShanghai(last.date);
      parts.push(`Last ${lastStr}`);
    }

    return parts.join(" | ");
  }

  // ------------------------
  // scales
  // ------------------------

  #buildX(width) {
    // Build X scale for time axis with session windowing
    const m = this.margin;
    const W = this.window;

    const nowUtc = Date.now();
    const day0 = shanghaiMidnightUtcMs(nowUtc);

    const mk = (baseDay0, startHM, endHM) => {
      const [sh, sm] = startHM;
      const [eh, em] = endHM;

      const start = shanghaiTimeUtcMs(baseDay0, sh, sm);

      let endBase = baseDay0;
      if (eh < sh || (eh === sh && em < sm)) endBase = baseDay0 + DAY_MS;
      const end = shanghaiTimeUtcMs(endBase, eh, em);

      return [start, end];
    };

    const candidates = [];
    for (const d0 of [day0 - DAY_MS, day0, day0 + DAY_MS]) {
      {
        const [s, e] = mk(d0, W.day.start, W.day.end);
        candidates.push({
          name: "day",
          start: s - W.day.padLeftH * HOUR_MS,
          end: e + W.day.padRightH * HOUR_MS,
          coreStart: s,
        });
      }
      {
        const [s, e] = mk(d0, W.night.start, W.night.end);
        candidates.push({
          name: "night",
          start: s - W.night.padLeftH * HOUR_MS,
          end: e + W.night.padRightH * HOUR_MS,
          coreStart: s,
        });
      }
    }

    candidates.sort((a, b) => a.coreStart - b.coreStart);

    const started = candidates.filter((s) => s.coreStart <= nowUtc);
    const picked = started.slice(-W.sessions);
    const sessions = picked.length ? picked : candidates.slice(-W.sessions);

    const domMin = Math.min(...sessions.map((s) => s.start));
    const domMax = Math.max(...sessions.map((s) => s.end));

    return d3
      .scaleTime()
      .domain([new Date(domMin), new Date(domMax)])
      .range([m.left, width - m.right]);
  }

  #buildY(visible, plot) {
    // Build Y scale for price axis with padding
    // if empty, pick a dummy domain to keep axes stable
    let yMin = 0;
    let yMax = 1;

    if (visible?.length) {
      yMin = d3.min(visible, (d) => d.low);
      yMax = d3.max(visible, (d) => d.high);
    }

    const span = Math.max(1e-9, yMax - yMin);
    const pad = Math.max(this.yPadMin, span * this.yPadPct);

    return d3
      .scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .nice()
      .range([plot.bottom, plot.top]);
  }

  // ------------------------
  // canvas + clip
  // ------------------------

  #ensureCanvas(container, width, height) {
    // Create or reuse canvas element and set up 2D context
    const existing = container.querySelector("canvas");
    if (existing) {
      this.canvas = existing;
    } else {
      this.canvas = document.createElement("canvas");
      container.appendChild(this.canvas);
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.background = "#000";

    this.ctx = this.canvas.getContext("2d");
  }

  #clipPlot(plot) {
    // Set clipping region to plot area
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.w, plot.h);
    ctx.clip();
  }

  #unclip() {
    // Restore canvas context (remove clipping)
    this.ctx.restore();
  }

  // ------------------------
  // draw: grid / axes / candles
  // ------------------------

  #drawGrid(ctx, plot, y) {
    // Draw horizontal grid lines
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "#333";

    this.#clipPlot(plot);
    for (const t of y.ticks(8)) {
      const yy = y(t);
      ctx.beginPath();
      ctx.moveTo(plot.left, yy);
      ctx.lineTo(plot.right, yy);
      ctx.stroke();
    }
    this.#unclip();
  }

  #drawAxes(ctx, plot, x, y, fxCnyPerUsd) {
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

    const cnyDigits = this.unit === "CNY/g" ? 2 : 0;

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
    const usdDigits = this.metal === "gold" ? 0 : 2;

    for (const t of yt) {
      const yy = y(t);
      ctx.beginPath();
      ctx.moveTo(plot.right, yy);
      ctx.lineTo(plot.right + 5, yy);
      ctx.stroke();

      const usd = fxOk ? this.#cnyTickToUsdOzt(t, fxCnyPerUsd) : NaN;
      const label = Number.isFinite(usd) ? `$${usd.toFixed(usdDigits)}` : "—";
      ctx.fillText(label, plot.right + 8, yy);
    }
  }

  #drawCandles(ctx, plot, x, y, ohlc) {
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

    this.#clipPlot(plot);

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

    this.#unclip();
  }

  // ------------------------
  // conversions
  // ------------------------

  #cnyTickToUsdOzt(cnyTick, fxCnyPerUsd) {
    // Convert CNY price to USD per troy ounce
    if (
      !Number.isFinite(cnyTick) ||
      !Number.isFinite(fxCnyPerUsd) ||
      fxCnyPerUsd <= 0
    )
      return NaN;

    // normalize to CNY/gram
    const cnyPerGram = this.unit === "CNY/kg" ? cnyTick / 1000.0 : cnyTick;

    // USD/ozt = (CNY/g * g/ozt) / (CNY/USD)
    return (cnyPerGram * OZT) / fxCnyPerUsd;
  }
}
