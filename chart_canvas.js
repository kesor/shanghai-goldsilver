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

    // acceptance heat (dwell by price bin)
    this.heat = opts.heat ?? {
      enabled: true,
      bins: 32,          // horizontal bands
      alpha: 0.22,       // max opacity
      gamma: 0.6,        // <1 boosts weak zones
    };

    this.volBands = opts.volBands ?? {
      enabled: false,
      window: 60,          // candles
      k: 2.0,              // ±kσ
      alpha: 0.18,
      strokeAlpha: 0.55,
      fill: true,
    };

    this.rangeBox = opts.rangeBox ?? {
      enabled: false,
      window: 120,        // candles
      alpha: 0.12,
      strokeAlpha: 0.40,
    };

    this.retHist = opts.retHist ?? {
      enabled: true,
      bins: 41,
      mode: "pct",          // "pct" | "delta"
      window: 600,          // last N returns
      wMax: 0.22,           // max panel width as fraction of plot.w
      wMinPx: 140,
      hFrac: 0.38,          // panel height as fraction of plot.h
      pad: 10,
      bg: "rgba(0,0,0,1.0)",
      border: "rgba(255,255,255,0.25)",
      barAlpha: 0.55,
      font: "12px Arial",
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

    // acceptance heat (dwell by price bin)
    if (this.heat?.enabled && visible.length) {
      this.#drawAcceptanceHeat(ctx, plot, x, y, visible);
    }

    this.#drawGrid(ctx, plot, y);
    this.#drawAxes(ctx, plot, x, y, fx);

    if (visible.length) this.#drawCandles(ctx, plot, x, y, visible);

    if (this.volBands?.enabled && visible.length >= (this.volBands.window ?? 60) + 2) {
      this.#drawVolBands(ctx, plot, x, y, visible);
    }

    if (this.rangeBox?.enabled && visible.length >= (this.rangeBox.window ?? 120)) {
      this.#drawRangeBox(ctx, plot, x, y, visible);
    }

    if (this.retHist?.enabled && visible.length >= 20) {
      this.#drawReturnHistogramInGap(ctx, plot, x, y, visible);
    }

    return this;
  }

  #drawReturnHistogramInGap(ctx, plot, x, y, visible) {
    const cfg = this.retHist;
    const bins = Math.max(9, cfg.bins ?? 41);
    const win = Math.max(30, cfg.window ?? 600);

    // returns from visible candles
    const rs = [];
    for (let i = 1; i < visible.length; i++) {
      const p0 = visible[i - 1].close;
      const p1 = visible[i].close;
      if (!Number.isFinite(p0) || !Number.isFinite(p1)) continue;
      if (cfg.mode === "pct") {
        if (p0 <= 0) continue;
        rs.push((p1 - p0) / p0);
      } else {
        rs.push(p1 - p0); // Δ¥ in chart units
      }
    }
    if (rs.length < 20) return;

    const tail = rs.slice(-win);

    // find largest time gap between consecutive candles
    let gapIdx = -1;
    let bestGap = 0;
    for (let i = 1; i < visible.length; i++) {
      const dt = visible[i].date.getTime() - visible[i - 1].date.getTime();
      if (Number.isFinite(dt) && dt > bestGap) {
        bestGap = dt;
        gapIdx = i;
      }
    }
    if (gapIdx < 0) return;

    const tL = visible[gapIdx - 1].date;
    const tR = visible[gapIdx].date;
    const xL = x(tL);
    const xR = x(tR);
    if (!Number.isFinite(xL) || !Number.isFinite(xR)) return;

    // require meaningful gap on screen
    const gapPx = xR - xL;
    if (gapPx < 60) return;

    // panel size inside gap
    const pad = cfg.pad ?? 10;
    const wCap = plot.w * (cfg.wMax ?? 0.22);
    const wMin = cfg.wMinPx ?? 140;
    const panelW = Math.max(wMin, Math.min(wCap, gapPx - 2 * pad));
    if (panelW > gapPx - 4) return;

    const panelH = Math.max(80, plot.h * (cfg.hFrac ?? 0.38));

    const ox = xL + (gapPx - panelW) / 2;
    const oy = plot.top + (plot.h - panelH) / 2;

    // histogram domain, symmetric around 0 by default
    let lo = Math.min(...tail);
    let hi = Math.max(...tail);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return;

    const maxAbs = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -maxAbs;
    hi = +maxAbs;

    const step = (hi - lo) / bins;
    if (!(step > 0)) return;

    const counts = new Array(bins).fill(0);
    for (const r of tail) {
      const idx = Math.max(0, Math.min(bins - 1, Math.floor((r - lo) / step)));
      counts[idx] += 1;
    }
    const maxC = Math.max(...counts);
    if (!(maxC > 0)) return;

    // draw panel
    ctx.save();
    this.#clipPlot(plot);

    ctx.globalCompositeOperation = "source-over";

    ctx.fillStyle = cfg.bg ?? "rgba(0,0,0,1.0)";
    ctx.strokeStyle = cfg.border ?? "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ox, oy, panelW, panelH, 8);
    else ctx.rect(ox, oy, panelW, panelH);
    ctx.fill();
    ctx.stroke();

    // inner area
    const ix = ox + pad;
    const iy = oy + pad;
    const iw = panelW - 2 * pad;
    const ih = panelH - 2 * pad;

    // reserve label gutter below bars
    const labelH = cfg.labelH ?? 16;
    const barTop = iy + 16;                 // leave room for title
    const barBottom = iy + ih - labelH;     // bars stop here
    const barH = Math.max(10, barBottom - barTop);

    // bars
    const barW = iw / bins;
    ctx.fillStyle = `rgba(255,255,255,${(cfg.barAlpha ?? 0.55).toFixed(4)})`;
    for (let i = 0; i < bins; i++) {
      const c = counts[i];
      if (!c) continue;
      const h = (c / maxC) * barH;
      const x0 = ix + i * barW;
      const y0 = barBottom - h;
      ctx.fillRect(x0 + 0.5, y0, Math.max(1, barW - 1), h);
    }

    // zero line (only across bar area)
    const zeroX = ix + ((0 - lo) / (hi - lo)) * iw;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(zeroX, barTop);
    ctx.lineTo(zeroX, barBottom);
    ctx.stroke();

    // labels BELOW histogram
    ctx.font = cfg.font ?? "12px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textBaseline = "top";

    const fmt = (v) => {
      if (cfg.mode === "pct") return `${(v * 100).toFixed(2)}%`;
      const digits = this.unit === "CNY/g" ? 2 : 0;
      return `¥${v.toFixed(digits)}`;
    };

    ctx.textAlign = "left";
    ctx.fillText(fmt(lo), ix, barBottom + 2);
    ctx.textAlign = "center";
    ctx.fillText(fmt(0), ix + iw / 2, barBottom + 2);
    ctx.textAlign = "right";
    ctx.fillText(fmt(hi), ix + iw, barBottom + 2);

    // title
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Returns (${cfg.mode})`, ix, iy);

    this.#unclip();
    ctx.restore();
  }


  #drawRangeBox(ctx, plot, x, y, visible) {
    const cfg = this.rangeBox;
    const win = Math.max(20, cfg.window ?? 120);
    const tail = visible.slice(-win);

    const hi = d3.max(tail, d => d.high);
    const lo = d3.min(tail, d => d.low);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;

    this.#clipPlot(plot);

    const yTop = y(hi);
    const yBot = y(lo);
    const h = Math.abs(yBot - yTop);

    ctx.fillStyle = `rgba(255,255,255,${(cfg.alpha ?? 0.12).toFixed(4)})`;
    ctx.fillRect(plot.left, Math.min(yTop, yBot), plot.w, h);

    ctx.strokeStyle = `rgba(255,255,255,${(cfg.strokeAlpha ?? 0.40).toFixed(4)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.left, Math.min(yTop, yBot), plot.w, h);

    this.#unclip();
  }


  #drawVolBands(ctx, plot, x, y, visible) {
    const cfg = this.volBands;
    const win = Math.max(10, cfg.window ?? 60);
    const k = Math.max(0.5, cfg.k ?? 2);

    // last win closes
    const tail = visible.slice(-win);
    const closes = tail.map(d => d.close).filter(Number.isFinite);
    if (closes.length < 10) return;

    // deltas (same units as chart)
    const ds = [];
    for (let i = 1; i < closes.length; i++) ds.push(closes[i] - closes[i - 1]);
    if (ds.length < 5) return;

    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    const varr = ds.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ds.length;
    const sigma = Math.sqrt(varr);
    if (!Number.isFinite(sigma) || sigma <= 0) return;

    const last = tail[tail.length - 1];
    const mid = last.close;
    const hi = mid + k * sigma;
    const lo = mid - k * sigma;

    this.#clipPlot(plot);

    // band
    if (cfg.fill !== false) {
      ctx.fillStyle = `rgba(255,255,255,${(cfg.alpha ?? 0.18).toFixed(4)})`;
      ctx.fillRect(plot.left, Math.min(y(hi), y(lo)), plot.w, Math.abs(y(lo) - y(hi)));
    }

    // lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,255,255,${(cfg.strokeAlpha ?? 0.55).toFixed(4)})`;

    ctx.beginPath();
    ctx.moveTo(plot.left, y(hi));
    ctx.lineTo(plot.right, y(hi));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(plot.left, y(lo));
    ctx.lineTo(plot.right, y(lo));
    ctx.stroke();

    // label
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const digits = this.unit === "CNY/g" ? 2 : 0;
    ctx.fillText(`±${k}σ ≈ ¥${sigma.toFixed(digits)}`, plot.left + 6, plot.top + 6);

    this.#unclip();
  }



  // ------------------------
  // acceptance heat
  // ------------------------

  #drawAcceptanceHeat(ctx, plot, x, y, visible) {
    const bins = Math.max(4, this.heat?.bins ?? 32);
    const alphaMax = Math.max(0, Math.min(1, this.heat?.alpha ?? 0.22));
    const gamma = Math.max(0.05, this.heat?.gamma ?? 0.6);

    const [y0, y1] = y.domain(); // note: may be [min, max] or [max, min] depending on scale usage
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    const span = Math.max(1e-12, hi - lo);
    const step = span / bins;

    const dwell = new Array(bins).fill(0);

    // dwell weight per candle:
    // - use actual minutes if we can infer next timestamp
    // - else 1 per candle
    for (let i = 0; i < visible.length; i++) {
      const d = visible[i];
      const price = d.close;
      if (!Number.isFinite(price)) continue;

      const idx = Math.max(0, Math.min(bins - 1, Math.floor((price - lo) / step)));

      let w = 1;
      if (i + 1 < visible.length) {
        const dt = visible[i + 1].date.getTime() - d.date.getTime();
        if (Number.isFinite(dt) && dt > 0) w = Math.min(60, dt / 60_000); // cap to avoid weird gaps dominating
      }
      dwell[idx] += w;
    }

    const max = Math.max(...dwell);
    if (!(max > 0)) return;

    this.#clipPlot(plot);

    // draw as horizontal bands across plot width
    // use white with varying alpha, no hue opinion baked in
    for (let i = 0; i < bins; i++) {
      const v = dwell[i] / max;
      if (v <= 0) continue;

      const a = alphaMax * Math.pow(v, gamma);

      const pLo = lo + i * step;
      const pHi = lo + (i + 1) * step;

      const yTop = y(pHi);
      const yBot = y(pLo);

      const h = Math.abs(yBot - yTop);
      if (h <= 0.5) continue;

      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(4)})`;
      ctx.fillRect(plot.left, Math.min(yTop, yBot), plot.w, h);
    }

    this.#unclip();
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

    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.background = "#000";

    this.ctx = this.canvas.getContext("2d");
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
