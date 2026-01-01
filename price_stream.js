export class PriceStream {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map(); // key -> callback
    this.cache = new Map(); // offset_hours -> data
    this.currentData = null;
  }

  on(key, handler) {
    // Register event handler for given key
    this.handlers.set(key, handler);
    return this;
  }

  off(key) {
    // Remove event handler for given key
    this.handlers.delete(key);
    return this;
  }

  connect() {
    // Connect to WebSocket server and set up event handlers
    if (this.ws) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("ws connected");
    };

    this.ws.onclose = () => {
      console.log("ws disconnected");
      this.ws = null;
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    this.ws.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        console.error("Invalid JSON payload", e);
        return;
      }

      // Check if this is a fetch response or live data
      if (payload._offset !== undefined) {
        this.cache.set(payload._offset, payload);
        this._triggerHandlers(payload);
      } else {
        this.currentData = payload;
        this._triggerHandlers(payload);
      }
    };

    return this;
  }

  _triggerHandlers(payload) {
    for (const [key, handler] of this.handlers) {
      const data = payload[key];
      if (data && data.length) {
        handler(data);
      }
    }
  }

  fetchOffset(offsetHours) {
    // Check cache first
    if (this.cache.has(offsetHours)) {
      this._triggerHandlers(this.cache.get(offsetHours));
      return;
    }

    // Merge current data with historical fetch
    if (offsetHours === 0 && this.currentData) {
      this._triggerHandlers(this.currentData);
      return;
    }

    // Request historical data
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "fetch",
        offset_hours: offsetHours
      }));
    }
  }

  _triggerHandlersForChart(payload, chartMetal, chartOffset) {
    for (const [key, handler] of this.handlers) {
      const data = payload[key];
      if (data && data.length && key === chartMetal) {
        handler(data);
      }
    }
  }

  close() {
    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    return this;
  }
}
