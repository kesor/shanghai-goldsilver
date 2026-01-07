import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { shanghaiMidnightUtcMs, shanghaiTimeUtcMs } from "./time_shanghai.js";
import { HOUR_MS, DAY_MS } from "./consts.js";

export function buildXScale(width, margin, window, sessionOffset = 0) {
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
  for (let dayOffset = -5; dayOffset <= 2; dayOffset++) {
    const d0 = day0 + dayOffset * DAY_MS;
    {
      const [s, e] = mk(d0, window.day.start, window.day.end);
      candidates.push({
        name: "day",
        start: s - window.day.padLeftH * HOUR_MS,
        end: e + window.day.padRightH * HOUR_MS,
        coreStart: s,
      });
    }
    {
      const [s, e] = mk(d0, window.night.start, window.night.end);
      candidates.push({
        name: "night",
        start: s - window.night.padLeftH * HOUR_MS,
        end: e + window.night.padRightH * HOUR_MS,
        coreStart: s,
      });
    }
  }

  candidates.sort((a, b) => a.coreStart - b.coreStart);

  const started = candidates.filter((s) => s.coreStart <= nowUtc);
  const currentIdx = Math.max(0, started.length - window.sessions);
  const targetIdx = Math.max(0, currentIdx + sessionOffset);
  
  const sessions = candidates.slice(targetIdx, targetIdx + window.sessions);

  const domMin = Math.min(...sessions.map((s) => s.start));
  const domMax = Math.max(...sessions.map((s) => s.end));

  return d3
    .scaleTime()
    .domain([new Date(domMin), new Date(domMax)])
    .range([margin.left, width - margin.right]);
}

export function buildYScale(visible, plot, yPadPct = 0.03, yPadMin = 1) {
  let yMin = 0;
  let yMax = 1;

  if (visible?.length) {
    yMin = d3.min(visible, (d) => d.low);
    yMax = d3.max(visible, (d) => d.high);
  }

  const span = Math.max(1e-9, yMax - yMin);
  const pad = Math.max(yPadMin, span * yPadPct);

  return d3
    .scaleLinear()
    .domain([yMin - pad, yMax + pad])
    .nice()
    .range([plot.bottom, plot.top]);
}
