import { buildXScale } from "./chart_scales.js";
import { cnyTickToUsdOzt } from "./chart_drawing.js";
import { OZT } from "./consts.js";

export class TitleRenderer {
  constructor(chart) {
    this.chart = chart;
  }

  setTitle(container, text) {
    // Title is now drawn on canvas, so clear any HTML title
    const existingTitle = container.querySelector('h2');
    if (existingTitle) {
      existingTitle.remove();
    }
  }

  drawTitleOnCanvas(ctx, width, visible, fxCnyPerUsd, plot) {
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Main title with larger font
    ctx.font = 'bold 16px Arial';
    const titleText = this.buildTitle(visible, fxCnyPerUsd);
    ctx.fillText(titleText, plot.left, 10);
    
    // Recent candle details on second line - all white
    if (visible.length > 0) {
      ctx.font = '14px Arial';
      const recent = visible[visible.length - 1];
      const sessionStart = this.findSessionStart(visible, recent);
      const sessionStartPrice = sessionStart ? sessionStart.open : recent.open;
      const change = recent.close - sessionStartPrice;
      const changePercent = sessionStartPrice !== 0 ? (change / sessionStartPrice * 100) : 0;
      
      const digits = this.chart.config.unit === "CNY/g" ? 2 : 0;
      const usdDigits = this.chart.config.metal === "gold" ? 0 : 2;
      const usdPrice = cnyTickToUsdOzt(recent.close, fxCnyPerUsd, this.chart.config.unit);
      
      const recentStats = [
        `Latest: ${recent.date.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'})} SH | ${recent.date.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})} Local`,
        `O:¥${recent.open.toFixed(digits)}`,
        `H:¥${recent.high.toFixed(digits)}`,
        `L:¥${recent.low.toFixed(digits)}`,
        `C:¥${recent.close.toFixed(digits)}`,
        Number.isFinite(usdPrice) ? `$${usdPrice.toFixed(usdDigits)}/ozt` : '',
        `Session: ${change >= 0 ? '+' : ''}¥${change.toFixed(digits)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
      ].filter(part => part).join(' | ');
      
      ctx.fillText(recentStats, plot.left, 32);
    }
    
    ctx.restore();
  }

  findSessionStart(visible, currentCandle) {
    // Find the start of the current session by looking for the largest time gap before current candle
    let maxGap = 0;
    let sessionStartIdx = 0;
    
    for (let i = 1; i < visible.length; i++) {
      const gap = visible[i].date.getTime() - visible[i-1].date.getTime();
      if (gap > maxGap && visible[i].date <= currentCandle.date) {
        maxGap = gap;
        sessionStartIdx = i;
      }
    }
    
    // If gap is significant (>2 hours), use it as session boundary
    return maxGap > 2 * 60 * 60 * 1000 ? visible[sessionStartIdx] : visible[0];
  }

  buildTitle(visible, fxCnyPerUsd) {
    // Build comprehensive chart title with session details
    const base = this.chart.config.title ?? "";
    
    if (!visible?.length) {
      // Show session dates even without data
      const [d0, d1] = this.getCurrentSessionDates();
      const nightDate = d0.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
      const dayDate = d1.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
      return `${base} | Night ${nightDate} + Day ${dayDate} | No Data`;
    }

    const parts = [base];
    
    // FX rate and OZT conversion
    const fxStr = Number.isFinite(fxCnyPerUsd) && fxCnyPerUsd > 0 ? fxCnyPerUsd.toFixed(4) : "n/a";
    parts.push(`USDCNY ${fxStr} | 1ozt = ${OZT.toFixed(3)}g`);
    
    // Session stats in chronological order
    const sessionStats = this.getSessionStats(visible, fxCnyPerUsd);
    const [firstSession, secondSession] = this.orderSessionsByTime(sessionStats);
    
    if (firstSession.count > 0) {
      const cnyDecimals = this.chart.config.metal === "silver" ? 0 : 2;
      const usdDecimals = this.chart.config.metal === "silver" ? 2 : 2;
      parts.push(`${firstSession.name} ${firstSession.date}: [Lo ¥${firstSession.low.cny.toFixed(cnyDecimals)} $${firstSession.low.usd.toFixed(usdDecimals)}] [Hi ¥${firstSession.high.cny.toFixed(cnyDecimals)} $${firstSession.high.usd.toFixed(usdDecimals)}]`);
    }
    if (secondSession.count > 0) {
      const cnyDecimals = this.chart.config.metal === "silver" ? 0 : 2;
      const usdDecimals = this.chart.config.metal === "silver" ? 2 : 2;
      parts.push(`${secondSession.name} ${secondSession.date}: [Lo ¥${secondSession.low.cny.toFixed(cnyDecimals)} $${secondSession.low.usd.toFixed(usdDecimals)}] [Hi ¥${secondSession.high.cny.toFixed(cnyDecimals)} $${secondSession.high.usd.toFixed(usdDecimals)}]`);
    }

    return parts.join(" | ");
  }

  getSessionStats(visible, fxCnyPerUsd) {
    // Calculate highs/lows for each session with USD conversion
    if (!visible.length) return { first: {name: "N/A", count: 0}, second: {name: "N/A", count: 0} };
    
    // Find the actual session boundary by looking for the largest time gap
    let maxGap = 0;
    let splitIdx = Math.floor(visible.length / 2); // fallback
    
    for (let i = 1; i < visible.length; i++) {
      const gap = visible[i].date.getTime() - visible[i-1].date.getTime();
      if (gap > maxGap) {
        maxGap = gap;
        splitIdx = i;
      }
    }
    
    const firstSession = { 
      name: "Session1",
      date: visible[0]?.date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) || "N/A",
      high: { cny: -Infinity, usd: -Infinity }, 
      low: { cny: Infinity, usd: Infinity }, 
      count: 0,
      startTime: 0
    };
    const secondSession = { 
      name: "Session2",
      date: visible[splitIdx]?.date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) || "N/A",
      high: { cny: -Infinity, usd: -Infinity }, 
      low: { cny: Infinity, usd: Infinity }, 
      count: 0,
      startTime: 1
    };
    
    // Determine session names based on time of day
    const [domainStart] = buildXScale(800, this.chart.config.margin, this.chart.config.window, this.chart.sessionOffset).domain();
    const firstHour = domainStart.getHours();
    
    if (firstHour >= 6 && firstHour < 18) {
      // Day session comes first
      secondSession.name = "Day";
      firstSession.name = "Night";
    } else {
      // Night session comes first
      secondSession.name = "Night";
      firstSession.name = "Day";
    }
    
    // First session = before the gap
    for (let i = 0; i < splitIdx; i++) {
      const d = visible[i];
      if (Number.isFinite(d.high) && Number.isFinite(d.low)) {
        firstSession.high.cny = Math.max(firstSession.high.cny, d.high);
        firstSession.low.cny = Math.min(firstSession.low.cny, d.low);
        const highUsd = cnyTickToUsdOzt(d.high, fxCnyPerUsd, this.chart.config.unit);
        const lowUsd = cnyTickToUsdOzt(d.low, fxCnyPerUsd, this.chart.config.unit);
        if (Number.isFinite(highUsd)) firstSession.high.usd = Math.max(firstSession.high.usd, highUsd);
        if (Number.isFinite(lowUsd)) firstSession.low.usd = Math.min(firstSession.low.usd, lowUsd);
        firstSession.count++;
      }
    }
    
    // Second session = after the gap
    for (let i = splitIdx; i < visible.length; i++) {
      const d = visible[i];
      if (Number.isFinite(d.high) && Number.isFinite(d.low)) {
        secondSession.high.cny = Math.max(secondSession.high.cny, d.high);
        secondSession.low.cny = Math.min(secondSession.low.cny, d.low);
        const highUsd = cnyTickToUsdOzt(d.high, fxCnyPerUsd, this.chart.config.unit);
        const lowUsd = cnyTickToUsdOzt(d.low, fxCnyPerUsd, this.chart.config.unit);
        if (Number.isFinite(highUsd)) secondSession.high.usd = Math.max(secondSession.high.usd, highUsd);
        if (Number.isFinite(lowUsd)) secondSession.low.usd = Math.min(secondSession.low.usd, lowUsd);
        secondSession.count++;
      }
    }
    
    return { first: firstSession, second: secondSession };
  }

  orderSessionsByTime(sessionStats) {
    // Return sessions in chart order (first = left, second = right)
    return [sessionStats.first, sessionStats.second];
  }

  getCurrentSessionDates() {
    // Get current session date range from X scale
    const [d0, d1] = buildXScale(800, this.chart.config.margin, this.chart.config.window, this.chart.sessionOffset).domain();
    return [d0, d1];
  }
}
