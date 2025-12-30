export class PriceStream {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map(); // key -> callback
  }

  on(key, handler) {
    this.handlers.set(key, handler);
    return this;
  }

  off(key) {
    this.handlers.delete(key);
    return this;
  }

  connect() {
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

      for (const [key, handler] of this.handlers) {
        const data = payload[key];
        if (data && data.length) {
          handler(data);
        }
      }
    };

    return this;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    return this;
  }
}
