export class HoverIndicator {
  constructor(chart) {
    this.chart = chart;
    this.tooltip = null;
    this.crosshair = { x: null, y: null };
    this.currentCandle = null;
    this.isActive = false;
  }

  enable() {
    if (this.isActive) return;
    this.isActive = true;
    
    const canvas = this.chart.canvas;
    if (!canvas) return;

    this.mouseMoveHandler = (event) => this.handleMouseMove(event);
    this.mouseLeaveHandler = (event) => this.handleMouseLeave(event);
    
    canvas.addEventListener('mousemove', this.mouseMoveHandler);
    canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    
    this.createTooltip();
  }

  disable() {
    if (!this.isActive) return;
    this.isActive = false;
    
    const canvas = this.chart.canvas;
    if (canvas) {
      canvas.removeEventListener('mousemove', this.mouseMoveHandler);
      canvas.removeEventListener('mouseleave', this.mouseLeaveHandler);
    }
    
    this.hideTooltip();
  }

  handleMouseMove(event) {
    const rect = this.chart.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    this.crosshair.x = x;
    this.crosshair.y = y;
    
    const candle = this.findCandleAtX(x);
    
    // Re-render chart with crosshair overlay
    this.chart.render(this.chart.lastOhlc);
    
    if (candle) {
      this.currentCandle = candle;
      this.showTooltip(event.clientX, event.clientY, candle);
      this.drawCrosshair();
    } else {
      this.hideTooltip();
      this.currentCandle = null;
    }
  }

  handleMouseLeave() {
    this.hideTooltip();
    this.currentCandle = null;
    this.crosshair.x = null;
    this.crosshair.y = null;
    // Re-render chart without crosshair
    this.chart.render(this.chart.lastOhlc);
  }

  createTooltip() {
    if (this.tooltip) return;
    
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: absolute;
      background: rgba(0,0,0,0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      display: none;
      border: 1px solid rgba(255,255,255,0.2);
    `;
    document.body.appendChild(this.tooltip);
  }

  showTooltip(clientX, clientY, candle) {
    if (!this.tooltip) return;
    
    const change = candle.close - candle.open;
    const changePercent = candle.open !== 0 ? (change / candle.open * 100) : 0;
    const changeColor = change >= 0 ? '#00ff00' : '#ff0000';
    
    const digits = this.chart.unit === "CNY/g" ? 2 : 0;
    const usdDigits = this.chart.metal === "gold" ? 0 : 2;
    
    // Convert OHLC to USD using the chart's conversion method
    const fxRate = candle.fx_close;
    const openUsd = this.chart._cnyTickToUsdOzt ? this.chart._cnyTickToUsdOzt(candle.open, fxRate) : null;
    const highUsd = this.chart._cnyTickToUsdOzt ? this.chart._cnyTickToUsdOzt(candle.high, fxRate) : null;
    const lowUsd = this.chart._cnyTickToUsdOzt ? this.chart._cnyTickToUsdOzt(candle.low, fxRate) : null;
    const closeUsd = this.chart._cnyTickToUsdOzt ? this.chart._cnyTickToUsdOzt(candle.close, fxRate) : null;
    
    this.tooltip.innerHTML = `
      <div style="margin-bottom: 4px; font-weight: bold;">
        ${candle.date.toLocaleString('en-US', {
          month: 'short', day: 'numeric', 
          hour: '2-digit', minute: '2-digit',
          timeZone: 'Asia/Shanghai'
        })} SH
      </div>
      <div style="margin-bottom: 4px; font-size: 11px; color: #ccc;">
        ${candle.date.toLocaleString('en-US', {
          month: 'short', day: 'numeric', 
          hour: '2-digit', minute: '2-digit'
        })} Local
      </div>
      <div>O: ¥${candle.open.toFixed(digits)}${Number.isFinite(openUsd) ? ` / $${openUsd.toFixed(usdDigits)}` : ''}</div>
      <div>H: ¥${candle.high.toFixed(digits)}${Number.isFinite(highUsd) ? ` / $${highUsd.toFixed(usdDigits)}` : ''}</div>
      <div>L: ¥${candle.low.toFixed(digits)}${Number.isFinite(lowUsd) ? ` / $${lowUsd.toFixed(usdDigits)}` : ''}</div>
      <div>C: ¥${candle.close.toFixed(digits)}${Number.isFinite(closeUsd) ? ` / $${closeUsd.toFixed(usdDigits)}` : ''}</div>
      <div style="color: ${changeColor}; margin-top: 4px;">
        ${change >= 0 ? '+' : ''}¥${change.toFixed(digits)} 
        (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)
      </div>
    `;
    
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${clientX + 10}px`;
    this.tooltip.style.top = `${clientY - 10}px`;
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }

  findCandleAtX(mouseX) {
    const ohlc = this.chart.lastOhlc;
    if (!ohlc || !ohlc.length) return null;
    
    const canvas = this.chart.canvas;
    if (!canvas) return null;
    
    const width = canvas.width / (window.devicePixelRatio || 1);
    const x = this.chart._buildXScale(width);
    
    let closest = null;
    let minDistance = Infinity;
    
    for (const candle of ohlc) {
      const candleX = x(candle.date);
      const distance = Math.abs(candleX - mouseX);
      
      if (distance < 10) {
        if (distance < minDistance) {
          minDistance = distance;
          closest = candle;
        }
      }
    }
    
    return closest;
  }

  drawCrosshair() {
    if (!this.currentCandle || !this.crosshair.x || !this.crosshair.y) return;
    
    const ctx = this.chart.ctx;
    const canvas = this.chart.canvas;
    if (!ctx || !canvas) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const margin = this.chart.margin;
    
    ctx.beginPath();
    ctx.moveTo(this.crosshair.x, margin.top);
    ctx.lineTo(this.crosshair.x, height - margin.bottom);
    ctx.moveTo(margin.left, this.crosshair.y);
    ctx.lineTo(width - margin.right, this.crosshair.y);
    ctx.stroke();
    
    ctx.restore();
  }

  destroy() {
    this.disable();
    if (this.tooltip) {
      document.body.removeChild(this.tooltip);
      this.tooltip = null;
    }
  }
}
