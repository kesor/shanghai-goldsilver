export class ChartConfig {
  constructor(opts = {}) {
    this.title = opts.title ?? "";
    this.metal = opts.metal ?? "gold"; // "gold" | "silver"
    this.unit = opts.unit ?? "CNY/g"; // "CNY/g" | "CNY/kg"
    this.margin = opts.margin ?? { top: 60, right: 120, bottom: 30, left: 90 };
    
    this.fills = opts.fills ?? {
      night: "rgba(25, 25, 112, 0.35)",
      day: "rgba(139, 69, 19, 0.35)",
    };

    this.heat = opts.heat ?? {
      enabled: true,
      bins: 32,
      alpha: 0.22,
      gamma: 0.6,
    };

    this.volBands = opts.volBands ?? {
      enabled: false,
      window: 60,
      k: 2.0,
      alpha: 0.18,
      strokeAlpha: 0.55,
      fill: true,
    };

    this.rangeBox = opts.rangeBox ?? {
      enabled: false,
      window: 120,
      alpha: 0.12,
      strokeAlpha: 0.4,
    };

    this.retHist = opts.retHist ?? {
      enabled: true,
      bins: 41,
      mode: "pct",
      window: 600,
      wMax: 0.22,
      wMinPx: 140,
      hFrac: 0.38,
      pad: 10,
      bg: "rgba(0,0,0,1.0)",
      border: "rgba(255,255,255,0.25)",
      barAlpha: 0.55,
      font: "12px Arial",
    };

    this.window = opts.window ?? {
      sessions: 2,
      day: { start: [9, 0], end: [15, 30], padLeftH: 1, padRightH: 1 },
      night: { start: [20, 0], end: [2, 30], padLeftH: 1, padRightH: 1 },
    };

    this.titleOpts = opts.titleOpts ?? {
      showFx: true,
      showHiLo: true,
      showLast: true,
      cnyDigits: this.unit === "CNY/g" ? 2 : 0,
      usdDigits: this.metal === "gold" ? 0 : 2,
    };

    this.yPadPct = opts.yPadPct ?? 0.03;
    this.yPadMin = opts.yPadMin ?? 1;
  }

  setTitle(title) {
    this.title = title;
    return this;
  }
}
