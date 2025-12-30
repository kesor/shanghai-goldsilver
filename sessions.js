import { shanghaiMidnightUtcMs } from "./time_shanghai.js";
import { MINUTE_MS, DAY_MS } from "./consts.js"

export function drawShanghaiSessions(ctx, x, plot, fills) {
  const [t0Date, t1Date] = x.domain();
  const t0 = t0Date.getTime();
  const t1 = t1Date.getTime();

  const firstDay0 = shanghaiMidnightUtcMs(t0);

  for (let day0 = firstDay0; day0 <= t1; day0 += DAY_MS) {
    // Night: 20:00 -> next day 02:30
    fillInterval(ctx, x, plot, t0, t1,
      day0 + (20 * 60) * MINUTE_MS,
      day0 + DAY_MS + (2 * 60 + 30) * MINUTE_MS,
      fills.night
    );

    // Day: 09:00 -> 15:30
    fillInterval(ctx, x, plot, t0, t1,
      day0 + (9 * 60) * MINUTE_MS,
      day0 + (15 * 60 + 30) * MINUTE_MS,
      fills.day
    );
  }
}

function fillInterval(ctx, x, plot, t0, t1, aMs, bMs, fill) {
  const A = Math.max(aMs, t0);
  const B = Math.min(bMs, t1);
  if (B <= A) return;

  const x0 = x(new Date(A));
  const x1 = x(new Date(B));

  ctx.fillStyle = fill;
  ctx.fillRect(x0, plot.top, Math.max(0, x1 - x0), plot.h);
}

