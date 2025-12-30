import { PriceStream } from "./price_stream.js";
import { createOHLC } from "./candles.js";
import { CandleChart } from "./chart_canvas.js";

const goldChart = new CandleChart("gold-chart", {
  unit: "CNY/g",
  metal: "gold",
}).setTitle("Au(T+D)");
const silverChart = new CandleChart("silver-chart", {
  unit: "CNY/kg",
  metal: "silver",
}).setTitle("Ag(T+D)");

new PriceStream("ws://localhost:8001")
  .on("gold", (data) => goldChart.render(createOHLC(data)))
  .on("silver", (data) => silverChart.render(createOHLC(data)))
  .connect();
