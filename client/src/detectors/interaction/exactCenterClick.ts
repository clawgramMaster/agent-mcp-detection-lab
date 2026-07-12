import { type Detector, result } from "../../lib/detector";

/**
 * Exact-center click (deviceandbrowserinfo: hasClicked*ExactCenter).
 *
 * A naive bot clicks an element's pixel centroid (left+w/2, top+h/2). A human
 * NEVER lands on the exact center. Landing within ~1px of center on a element
 * large enough that hitting dead-center by chance is implausible → bot.
 *
 * This is a hard, deterministic tell with no false-positive gray zone: it
 * encodes "you computed a centroid", which humans don't do.
 */
export const exactCenterClick: Detector = {
  test: "exactCenterClick",
  label: "Pixel-perfect center click",
  category: "interaction",
  run: (ctx) => {
    const measured = ctx.clicks.filter((c) => c.centerDx !== undefined && c.centerDy !== undefined);
    if (measured.length === 0) {
      return result("exactCenterClick", "warn", 15, { measuredClicks: 0 }, undefined, "interaction");
    }
    let exact = 0;
    const hits: Array<{ dx: number; dy: number; w?: number; h?: number }> = [];
    for (const c of measured) {
      const dx = Math.abs(c.centerDx as number);
      const dy = Math.abs(c.centerDy as number);
      // element must be big enough that a chance dead-center hit is implausible
      const bigEnough = (c.elW ?? 0) >= 24 && (c.elH ?? 0) >= 16;
      if (bigEnough && dx < 1 && dy < 1) {
        exact++;
        hits.push({ dx: +dx.toFixed(2), dy: +dy.toFixed(2), w: c.elW, h: c.elH });
      }
    }
    const ev = { measuredClicks: measured.length, exactCenter: exact, hits };
    if (exact >= 1) {
      return result("exactCenterClick", "fail", Math.min(100, 70 + exact * 15), ev, undefined, "interaction");
    }
    return result("exactCenterClick", "pass", 0, ev, undefined, "interaction");
  },
};
