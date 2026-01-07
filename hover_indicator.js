export class HoverIndicator {
  constructor(chart) {
    this.chart = chart;
    this.tooltip = null;
    this.crosshair = { x: null, y: null };
    this.currentCandle = null;
    this.isActive = false;
    this.baseImageData = null;
    this.throttleTimeout = null;
    this.lastUpdateTime = 0;
  }

  enable() {
    if (this.isActive) return;
    this.isActive = true;
    
    const canvas = this.chart.canvas;
    if (!canvas) {
      console.warn('HoverIndicator: No canvas found');
      return;
    }

    // Store base image once when enabling
    setTimeout(() => {
      this.storeBaseImage();
    }, 50);

    // Use arrow functions to preserve 'this' context
    this.mouseMoveHandler = (event) => this.handleMouseMove(event);
    this.mouseLeaveHandler = (event) => this.handleMouseLeave(event);
    this.mouseEnterHandler = (event) => this.handleMouseEnter(event);
    
    canvas.addEventListener('mousemove', this.mouseMoveHandler);
    canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    canvas.addEventListener('mouseenter', this.mouseEnterHandler);
    
    // Also listen on document for mouse leave detection
    this.documentMouseMoveHandler = (event) => this.handleDocumentMouseMove(event);
    document.addEventListener('mousemove', this.documentMouseMoveHandler);
    
    this.createTooltip();
  }

  disable() {
    if (!this.isActive) return;
    this.isActive = false;
    
    const canvas = this.chart.canvas;
    if (canvas) {
      canvas.removeEventListener('mousemove', this.mouseMoveHandler);
      canvas.removeEventListener('mouseleave', this.mouseLeaveHandler);
      canvas.removeEventListener('mouseenter', this.mouseEnterHandler);
    }
    
    document.removeEventListener('mousemove', this.documentMouseMoveHandler);
    
    this.hideTooltip();
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

  handleMouseMove(event) {
    const rect = this.chart.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    this.crosshair.x = x;
    this.crosshair.y = y;
    
    const candle = this.findCandleAtX(x);
    
    // Always restore base image first to clear previous crosshair
    this.restoreBaseImage();
    
    if (candle) {
      this.currentCandle = candle;
      this.showTooltip(event.clientX, event.clientY, candle);
      this.drawCrosshair();
    } else {
      this.hideTooltip();
      this.currentCandle = null;
    }
  }

  handleMouseEnter(event) {
    // Refresh base image when re-entering canvas
    this.updateBaseImage();
    this.storeBaseImage();
  }

  handleDocumentMouseMove(event) {
    // Check if mouse is still over canvas
    const canvas = this.chart.canvas;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // If mouse is outside canvas bounds, clean up
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      if (this.currentCandle || this.crosshair.x !== null) {
        this.handleMouseLeave();
      }
    }
  }

  handleMouseLeave() {
    this.hideTooltip();
    this.currentCandle = null;
    this.crosshair.x = null;
    this.crosshair.y = null;
    // Restore clean canvas state
    this.restoreBaseImage();
  }

  storeBaseImage() {
    const ctx = this.chart.ctx;
    const canvas = this.chart.canvas;
    if (!ctx || !canvas) return;
    
    try {
      this.baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.warn('Could not store canvas image data:', e);
    }
  }

  restoreBaseImage() {
    const ctx = this.chart.ctx;
    if (!ctx || !this.baseImageData) {
      // If no base image, try to store it now
      if (!this.baseImageData) {
        this.storeBaseImage();
      }
      return;
    }
    
    try {
      ctx.putImageData(this.baseImageData, 0, 0);
    } catch (e) {
      console.warn('Could not restore canvas image data:', e);
      // Try to re-store base image
      this.baseImageData = null;
      this.storeBaseImage();
    }
  }

  // Call this when chart is re-rendered to update stored image
  updateBaseImage() {
    this.baseImageData = null;
  }

  findCandleAtX(mouseX) {
    const ohlc = this.chart.lastOhlc;
    if (!ohlc || !ohlc.length) return null;
    
    // Rebuild the X scale to match chart's current scale
    const canvas = this.chart.canvas;
    if (!canvas) return null;
    
    const width = canvas.width / (window.devicePixelRatio || 1);
    const x = this.chart._buildXScale(width);
    
    let closest = null;
    let minDistance = Infinity;
    
    // Reduced tolerance and early exit for better performance
    for (const candle of ohlc) {
      const candleX = x(candle.date);
      const distance = Math.abs(candleX - mouseX);
      
      if (distance < 10) { // Reduced from 20px to 10px
        if (distance < minDistance) {
          minDistance = distance;
          closest = candle;
        }
      }
    }
    
    return closest;
  }

  showTooltip(clientX, clientY, candle) {
    if (!this.tooltip) return;
    
    const change = candle.close - candle.open;
    const changePercent = candle.open !== 0 ? (change / candle.open * 100) : 0;
    const changeColor = change >= 0 ? '#00ff00' : '#ff0000';
    
    const digits = this.chart.unit === "CNY/g" ? 2 : 0;
    
    this.tooltip.innerHTML = `
      <div style="margin-bottom: 4px; font-weight: bold;">
        ${candle.date.toLocaleString('en-US', {
          month: 'short', day: 'numeric', 
          hour: '2-digit', minute: '2-digit'
        })}
      </div>
      <div>O: ¥${candle.open.toFixed(digits)}</div>
      <div>H: ¥${candle.high.toFixed(digits)}</div>
      <div>L: ¥${candle.low.toFixed(digits)}</div>
      <div>C: ¥${candle.close.toFixed(digits)}</div>
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

  drawCrosshair() {
    if (!this.currentCandle || !this.crosshair.x || !this.crosshair.y) return;
    
    const ctx = this.chart.ctx;
    const canvas = this.chart.canvas;
    if (!ctx || !canvas) return;
    
    // Back to simple overlay drawing
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const margin = this.chart.margin;
    
    // Draw both lines in one path for efficiency
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
