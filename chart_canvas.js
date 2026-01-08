import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { fmtTickShanghai } from "./axis_fmt.js";
import { drawShanghaiSessions } from "./sessions.js";
import { createOHLC } from "./candles.js";
import { HoverIndicator } from "./hover_indicator.js";
import { buildXScale, buildYScale } from "./chart_scales.js";
import { drawGrid, drawAxes, drawCandles, cnyTickToUsdOzt } from "./chart_drawing.js";
import { HOUR_MS, DAY_MS, OZT } from "./consts.js";
import { shanghaiMidnightUtcMs, shanghaiTimeUtcMs } from "./time_shanghai.js";
import { ChartConfig } from "./chart_config.js";
import { TitleRenderer } from "./title_renderer.js";

export class CandleChart {
  constructor(containerId, opts = {}) {
    this.containerId = containerId;
    this.config = new ChartConfig(opts);
    this.titleRenderer = new TitleRenderer(this);
    
    // Session navigation
    this.sessionOffset = 0; // 0 = current sessions, -1 = previous, etc.
    this.priceStream = null; // Will be set by client

    this.canvas = null;
    this.ctx = null;
    this.hoverIndicator = null;
  }

  setTitle(title) {
    // Set chart title and return this for chaining
    this.config.setTitle(title);
    return this;
  }

  render(ohlc) {
    // Render candlestick chart with given OHLC data
    this.lastOhlc = ohlc; // Store for navigation
    
    const container = document.getElementById(this.containerId);
    if (!container) return this;

    // Don't clear container if we're just updating with hover indicator active
    const hasHoverIndicator = this.hoverIndicator && this.hoverIndicator.isActive;
    if (!hasHoverIndicator) {
      container.innerHTML = "";
    }

    const width = container.clientWidth;
    const height = container.clientHeight - 40;

    const m = this.config.margin;
    const plot = {
      left: m.left,
      top: m.top,
      w: width - m.left - m.right,
      h: height - m.top - m.bottom,
      right: width - m.right,
      bottom: height - m.bottom,
    };

    // windowed x
    const x = buildXScale(width, this.config.margin, this.config.window, this.sessionOffset);

    let visible = [];
    let fx = NaN;

    if (ohlc?.length) {
      // visible data only (keeps gap data if it exists, does not create artificial gap fill)
      const [d0, d1] = x.domain();
      const domMin = d0.getTime();
      const domMax = d1.getTime();

      visible = ohlc.filter((d) => {
        const t = d.date.getTime();
        return t >= domMin && t <= domMax;
      });

      // title uses the window, but stats use visible data if present
      fx = visible.length ? visible[visible.length - 1].fx_close : NaN;
    }

    this.titleRenderer.setTitle(container, this.titleRenderer.buildTitle(visible, fx));

    // still render axes/sessions even if no points in the window
    const y = buildYScale(visible, plot, this.config.yPadPct, this.config.yPadMin);

    this.#ensureCanvas(container, width, height);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    // Draw title and stats on canvas
    this.titleRenderer.drawTitleOnCanvas(ctx, width, visible, fx, plot);

    // sessions shading across full x-domain
    this.#clipPlot(plot);
    drawShanghaiSessions(ctx, x, plot, this.config.fills);
    this.#unclip();

    // acceptance heat (dwell by price bin)
    if (this.config.heat?.enabled && visible.length) {
      this.#drawAcceptanceHeat(ctx, plot, x, y, visible);
    }

    if (
      this.config.volBands?.enabled &&
      visible.length >= (this.config.volBands.window ?? 60) + 2
    ) {
      this.#drawVolBands(ctx, plot, x, y, visible);
    }

    if (
      this.config.rangeBox?.enabled &&
      visible.length >= (this.config.rangeBox.window ?? 120)
    ) {
      this.#drawRangeBox(ctx, plot, x, y, visible);
    }

    drawAxes(ctx, plot, x, y, fx, this.config.unit, this.config.metal);
    drawGrid(ctx, plot, y);
    if (visible.length) drawCandles(ctx, plot, x, y, visible);

    if (this.config.retHist?.enabled && visible.length >= 20) {
      this.#drawReturnHistogramInGap(ctx, plot, x, y, visible);
    }

    // Add navigation arrows (only if not already added)
    if (!hasHoverIndicator) {
      this.#addNavigationArrows(container, width, height);
    }

    // Update hover indicator base image if it exists
    if (this.hoverIndicator) {
      // Hover indicator will re-render automatically, no need to manage base images
    } else if (visible.length > 0) {
      // Enable hover indicator only after we have data to display
      this.hoverIndicator = new HoverIndicator(this);
      this.hoverIndicator.enable();
    }

    return this;
  }

  #drawReturnHistogramInGap(ctx, plot, x, y, visible) {
    const cfg = this.config.retHist;
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
    
    // If no significant gap found, use middle of time domain (session boundary)
    if (gapIdx < 0 || bestGap < 4 * 60 * 60 * 1000) { // less than 4 hours
      const [d0, d1] = x.domain();
      const midTime = new Date((d0.getTime() + d1.getTime()) / 2);
      const tL = new Date(midTime.getTime() - 2 * 60 * 60 * 1000); // 2h before mid
      const tR = new Date(midTime.getTime() + 2 * 60 * 60 * 1000); // 2h after mid
      const xL = x(tL);
      const xR = x(tR);
      
      if (Number.isFinite(xL) && Number.isFinite(xR)) {
        const gapPx = xR - xL;
        if (gapPx >= 60) {
          // Use session gap
          bestGap = 4 * 60 * 60 * 1000; // fake 4h gap
          gapIdx = 0; // dummy index
        }
      }
    }
    
    if (gapIdx < 0) return;

    let tL, tR, xL, xR;
    if (gapIdx > 0 && visible.length > gapIdx) {
      // Data gap case
      tL = visible[gapIdx - 1].date;
      tR = visible[gapIdx].date;
      xL = x(tL);
      xR = x(tR);
    } else {
      // Session gap case
      const [d0, d1] = x.domain();
      const midTime = new Date((d0.getTime() + d1.getTime()) / 2);
      tL = new Date(midTime.getTime() - 2 * 60 * 60 * 1000);
      tR = new Date(midTime.getTime() + 2 * 60 * 60 * 1000);
      xL = x(tL);
      xR = x(tR);
    }
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
      let idx = Math.floor((r - lo) / step);
      if (idx === bins) idx = bins - 1; // r == hi
      idx = Math.max(0, Math.min(bins - 1, idx));
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

    // --- x-axis scale with range padding so edge labels can be centered under edge bars ---
    const x0 = ix;
    const x1 = ix + iw;

    const fmt = (v) => {
      if (cfg.mode === "pct") {
        const p = v * 100;
        const p0 = Math.abs(p) < 1e-9 ? 0 : p;
        return `${p0.toFixed(2)}%`;
      }
      const digits = this.config.unit === "CNY/g" ? 2 : 0;
      const v0 = Math.abs(v) < 1e-9 ? 0 : v;
      return `¥${v0.toFixed(digits)}`;
    };

    // edge bin centers (data units)
    const loC = lo + 0.5 * step;
    const hiC = hi - 0.5 * step;

    const minGapPx = 12; // fontPx

    // measure label widths
    ctx.font = cfg.font ?? "12px Arial";
    const loText = fmt(loC);
    const hiText = fmt(hiC);
    const loW = ctx.measureText(loText).width;
    const hiW = ctx.measureText(hiText).width;

    // provisional scale for measuring where edge bin centers land
    let xh = d3.scaleLinear().domain([lo, hi]).range([x0, x1]);

    // how far the centered labels would stick out past the panel edges
    const loCenterPx = xh(loC);
    const hiCenterPx = xh(hiC);

    const needLeft = Math.max(0, loW / 2 + minGapPx - (loCenterPx - x0));
    const needRight = Math.max(0, hiW / 2 + minGapPx - (x1 - hiCenterPx));

    // rebuild scale with expanded range
    xh = d3
      .scaleLinear()
      .domain([lo, hi])
      .range([x0 + needLeft, x1 - needRight]);

    // edge exclusion zones for interior labels (use HALF widths, in PANEL coords)
    const leftZoneRight = x0 + loW / 2 + minGapPx;
    const rightZoneLeft = x1 - hiW / 2 - minGapPx;

    // reserve label gutter below bars
    const labelH = cfg.labelH ?? 16;
    const barTop = iy + 16; // leave room for title
    const barBottom = iy + ih - labelH; // bars stop here
    const barH = Math.max(10, barBottom - barTop);

    // zero line (only across bar area)
    const zeroX = xh(0);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(zeroX, barTop);
    ctx.lineTo(zeroX, barBottom);
    ctx.stroke();

    // labels BELOW histogram
    ctx.font = cfg.font ?? "12px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textBaseline = "top";

    const tickY = barBottom + 2;

    const snap0 = (v) => {
      const eps0 = (hi - lo) * 1e-9;
      return Math.abs(v) < eps0 ? 0 : v;
    };
    const q = (hi - lo) / 200;
    const key = (v) => Math.round(snap0(v) / q) * q;

    const want0 = lo < 0 && hi > 0;
    const must = [lo, hi, ...(want0 ? [0] : [])];

    // initial tick count guess from pixel width
    const target = Math.max(3, Math.floor(iw / 40));
    const ticks = xh.ticks(target);

    // candidates -> snap/quantize -> sort -> uniq
    const candidates = [...ticks, ...must].map(key).sort((a, b) => a - b);
    const uniq = [];
    for (const v of candidates) {
      if (!uniq.length || Math.abs(v - uniq[uniq.length - 1]) > q * 0.5)
        uniq.push(v);
    }

    // reserve space for edge labels first
    const loK = key(lo);
    const hiK = key(hi);

    ctx.textBaseline = "top";
    ctx.font = cfg.font ?? "12px Arial";

    const loBarC = key(lo + 0.5 * step);
    const hiBarC = key(hi - 0.5 * step);

    // fit interior ticks by pixel spacing, keep them out of the edge zones
    const fitted = [];
    let prevRight = leftZoneRight;

    for (const v of uniq) {
      if (v === loK || v === hiK) continue;

      const px = xh(v);
      const w = ctx.measureText(fmt(v)).width;

      const left = px - w / 2;
      const right = px + w / 2;

      if (left < leftZoneRight) continue;
      if (right > rightZoneLeft) continue;

      if (left >= prevRight + minGapPx) {
        fitted.push(v);
        prevRight = right;
      }
    }

    // --- force a label under the outlier BIN (max |return|), aligned to bar center ---
    const outlier = tail.reduce(
      (best, r) => (Math.abs(r) > Math.abs(best) ? r : best),
      0,
    );

    // compute outlier bin index (same logic as counts)
    let outIdx = Math.floor((outlier - lo) / step);
    if (outIdx === bins) outIdx = bins - 1; // outlier == hi edge
    outIdx = Math.max(0, Math.min(bins - 1, outIdx));

    // label the BIN CENTER, not the domain edge
    const outCenter = lo + (outIdx + 0.5) * step;
    const outK = key(outCenter);

    // helper: overlap test for a candidate tick value v (in data units)
    const overlaps = (vals, v) => {
      const px = xh(v);
      const txt = fmt(v);
      const w = ctx.measureText(txt).width;
      const left = px - w / 2;
      const right = px + w / 2;

      if (left < leftZoneRight || right > rightZoneLeft) return true;

      for (const u of vals) {
        const upx = xh(u);
        const utxt = fmt(u);
        const uw = ctx.measureText(utxt).width;
        const uleft = upx - uw / 2;
        const uright = upx + uw / 2;
        if (!(right + minGapPx <= uleft || left >= uright + minGapPx))
          return true;
      }
      return false;
    };

    // if it fits, add/replace into fitted
    {
      const outPx = xh(outK);
      const outTxt = fmt(outK);
      const outW = ctx.measureText(outTxt).width;
      const outLeft = outPx - outW / 2;
      const outRight = outPx + outW / 2;

      const fitsInBox = outLeft >= leftZoneRight && outRight <= rightZoneLeft;

      if (fitsInBox && outK !== loK && outK !== hiK) {
        if (!overlaps(fitted, outK)) {
          fitted.push(outK);
        } else {
          // replace nearest existing tick (by pixel distance, not value distance)
          let j = -1;
          let bestDx = Infinity;
          for (let i = 0; i < fitted.length; i++) {
            const dx = Math.abs(xh(fitted[i]) - outPx);
            if (dx < bestDx) {
              bestDx = dx;
              j = i;
            }
          }
          if (j >= 0) {
            const removed = fitted[j];
            fitted[j] = outK;

            const tmp = fitted.filter((_, i) => i !== j);
            if (overlaps(tmp, outK)) fitted[j] = removed;
          }
        }

        fitted.sort((a, b) => a - b);
      }
    }

    // draw interior ticks
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.fillStyle = "rgba(255,255,255,0.85)";

    for (const v of fitted) {
      const px = xh(v);

      ctx.beginPath();
      ctx.moveTo(px, barBottom);
      ctx.lineTo(px, barBottom + 4);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillText(fmt(v), px, tickY);
    }

    // draw endpoints once, edge-aligned
    ctx.textAlign = "center";
    ctx.fillText(loText, xh(loBarC), tickY);
    ctx.fillText(hiText, xh(hiBarC), tickY);

    // title
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Returns ${cfg.mode}`, ix, iy);

    // bars (draw by bin edges, not by index)
    ctx.fillStyle = `rgba(255,255,255,${(cfg.barAlpha ?? 0.55).toFixed(4)})`;
    for (let i = 0; i < bins; i++) {
      const c = counts[i];
      if (!c) continue;

      const binL = lo + i * step;
      const binR = lo + (i + 1) * step;

      const x0 = xh(binL);
      const x1 = xh(binR);
      const w = Math.max(1, x1 - x0 - 1);

      const h = (c / maxC) * barH;
      const y0 = barBottom - h;

      ctx.fillRect(x0 + 0.5, y0, w, h);
    }

    this.#unclip();
    ctx.restore();
  }

  #drawRangeBox(ctx, plot, x, y, visible) {
    const cfg = this.config.rangeBox;
    const win = Math.max(20, cfg.window ?? 120);
    const tail = visible.slice(-win);

    const hi = d3.max(tail, (d) => d.high);
    const lo = d3.min(tail, (d) => d.low);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;

    this.#clipPlot(plot);

    const yTop = y(hi);
    const yBot = y(lo);
    const h = Math.abs(yBot - yTop);

    ctx.fillStyle = `rgba(255,255,255,${(cfg.alpha ?? 0.12).toFixed(4)})`;
    ctx.fillRect(plot.left, Math.min(yTop, yBot), plot.w, h);

    ctx.strokeStyle = `rgba(255,255,255,${(cfg.strokeAlpha ?? 0.4).toFixed(4)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.left, Math.min(yTop, yBot), plot.w, h);

    this.#unclip();
  }

  #drawVolBands(ctx, plot, x, y, visible) {
    const cfg = this.config.volBands;
    const win = Math.max(10, cfg.window ?? 60);
    const k = Math.max(0.5, cfg.k ?? 2);

    // last win closes
    const tail = visible.slice(-win);
    const closes = tail.map((d) => d.close).filter(Number.isFinite);
    if (closes.length < 10) return;

    // deltas (same units as chart)
    const ds = [];
    for (let i = 1; i < closes.length; i++) ds.push(closes[i] - closes[i - 1]);
    if (ds.length < 5) return;

    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    const varr =
      ds.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ds.length;
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
      ctx.fillRect(
        plot.left,
        Math.min(y(hi), y(lo)),
        plot.w,
        Math.abs(y(lo) - y(hi)),
      );
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
    const digits = this.config.unit === "CNY/g" ? 2 : 0;
    ctx.fillText(
      `±${k}σ ≈ ¥${sigma.toFixed(digits)}`,
      plot.left + 6,
      plot.top + 6,
    );

    this.#unclip();
  }

  // ------------------------
  // acceptance heat
  // ------------------------

  #drawAcceptanceHeat(ctx, plot, x, y, visible) {
    const bins = Math.max(4, this.config.heat?.bins ?? 32);
    const alphaMax = Math.max(0, Math.min(1, this.config.heat?.alpha ?? 0.22));
    const gamma = Math.max(0.05, this.config.heat?.gamma ?? 0.6);

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

      const idx = Math.max(
        0,
        Math.min(bins - 1, Math.floor((price - lo) / step)),
      );

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

    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
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
  // conversions
  // ------------------------

  #addNavigationArrows(container, width, height) {
    // Add left and right navigation arrows
    const leftArrow = document.createElement('div');
    const rightArrow = document.createElement('div');
    
    const arrowStyle = `
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 40px;
      height: 40px;
      background: rgba(255,255,255,0.1);
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      color: white;
      user-select: none;
      transition: all 0.2s ease;
      pointer-events: none;
      z-index: 10;
    `;
    
    leftArrow.style.cssText = arrowStyle + 'left: 10px;';
    leftArrow.innerHTML = '‹';
    leftArrow.onmouseenter = () => {
      leftArrow.style.background = 'rgba(255,255,255,0.2)';
      leftArrow.style.borderColor = 'rgba(255,255,255,0.5)';
    };
    leftArrow.onmouseleave = () => {
      leftArrow.style.background = 'rgba(255,255,255,0.1)';
      leftArrow.style.borderColor = 'rgba(255,255,255,0.3)';
    };
    leftArrow.onclick = () => {
      this.sessionOffset--;
      this.#requestData();
    };
    
    rightArrow.style.cssText = arrowStyle + 'right: 10px;';
    rightArrow.innerHTML = '›';
    rightArrow.onmouseenter = () => {
      rightArrow.style.background = 'rgba(255,255,255,0.2)';
      rightArrow.style.borderColor = 'rgba(255,255,255,0.5)';
    };
    rightArrow.onmouseleave = () => {
      rightArrow.style.background = 'rgba(255,255,255,0.1)';
      rightArrow.style.borderColor = 'rgba(255,255,255,0.3)';
    };
    rightArrow.onclick = () => {
      this.sessionOffset = Math.min(0, this.sessionOffset + 1);
      this.#requestData();
    };
    
    container.style.position = 'relative';
    container.appendChild(leftArrow);
    container.appendChild(rightArrow);
    
    // Show arrows on hover, but don't block canvas events
    container.onmouseenter = (e) => {
      // Only show arrows if mouse is near the edges
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const nearLeftEdge = x < 60;
      const nearRightEdge = x > rect.width - 60;
      
      if (nearLeftEdge) {
        leftArrow.style.display = 'flex';
        leftArrow.style.pointerEvents = 'auto';
      }
      if (nearRightEdge && this.sessionOffset < 0) {
        rightArrow.style.display = 'flex';
        rightArrow.style.pointerEvents = 'auto';
      }
    };
    container.onmouseleave = () => {
      leftArrow.style.display = 'none';
      leftArrow.style.pointerEvents = 'none';
      rightArrow.style.display = 'none';
      rightArrow.style.pointerEvents = 'none';
    };
    
    // Add mousemove to container to handle arrow visibility
    container.onmousemove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const nearLeftEdge = x < 60;
      const nearRightEdge = x > rect.width - 60;
      
      if (nearLeftEdge) {
        leftArrow.style.display = 'flex';
        leftArrow.style.pointerEvents = 'auto';
      } else {
        leftArrow.style.display = 'none';
        leftArrow.style.pointerEvents = 'none';
      }
      
      if (nearRightEdge && this.sessionOffset < 0) {
        rightArrow.style.display = 'flex';
        rightArrow.style.pointerEvents = 'auto';
      } else {
        rightArrow.style.display = 'none';
        rightArrow.style.pointerEvents = 'none';
      }
    };
  }

  #requestData() {
    if (this.priceStream && this.priceStream.ws && this.priceStream.ws.readyState === WebSocket.OPEN) {
      // Calculate the actual time range that will be displayed
      const [domainStart, domainEnd] = buildXScale(800, this.config.margin, this.config.window, this.sessionOffset).domain();
      const startTime = domainStart.getTime();
      const endTime = domainEnd.getTime();
      
      // Convert to hours offset from now
      const nowUtc = Date.now();
      const startOffsetHours = Math.max(0, Math.ceil((nowUtc - startTime) / (60 * 60 * 1000)));
      const endOffsetHours = Math.max(0, Math.ceil((nowUtc - endTime) / (60 * 60 * 1000)));
      
      this.priceStream.ws.send(JSON.stringify({
        type: "fetch",
        start_offset_hours: startOffsetHours,
        end_offset_hours: endOffsetHours,
        metal: this.config.metal
      }));
    }
  }

  _buildXScale(width) {
    // Expose the X scale building method for hover indicator
    return buildXScale(width, this.config.margin, this.config.window, this.sessionOffset);
  }

  _cnyTickToUsdOzt(cnyTick, fxCnyPerUsd) {
    // Expose the CNY to USD conversion method for hover indicator
    return cnyTickToUsdOzt(cnyTick, fxCnyPerUsd, this.config.unit);
  }
}
