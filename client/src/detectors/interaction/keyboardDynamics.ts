import { type Detector, result } from "../../lib/detector";

/**
 * Keyboard dynamics (Bot-Incolumitas / keystroke biometrics).
 * Real typing generates paired keydown+keyup events with a measurable "dwell"
 * time (key held down) that varies key-to-key. Scripted input often:
 *   - fires keydown but no keyup (or vice-versa),
 *   - has near-zero / constant dwell,
 *   - or sets .value with no key events at all.
 */
export const keyboardDynamics: Detector = {
  test: "keyboardDynamics",
  label: "Keystroke dynamics (dwell)",
  category: "interaction",
  run: (ctx) => {
    const downs = ctx.keys;
    const ups = ctx.keyups;
    if (downs.length === 0) {
      return result(
        "keyboardDynamics",
        "inconclusive",
        0,
        { keydowns: 0, note: "no typing captured" },
        undefined,
        "interaction",
      );
    }

    let score = 0;
    const ev: Record<string, unknown> = { keydowns: downs.length, keyups: ups.length };

    // 1) keyup must accompany keydown
    if (ups.length === 0) {
      ev.noKeyups = true;
      score += 60;
    } else if (Math.abs(downs.length - ups.length) > Math.max(2, downs.length * 0.3)) {
      ev.downUpImbalance = true;
      score += 30;
    }

    // 2) dwell time = keyup - matching keydown (by key, nearest after)
    const dwells: number[] = [];
    const usedUp = new Set<number>();
    for (const d of downs) {
      let bestIdx = -1;
      let bestDt = Number.POSITIVE_INFINITY;
      for (let i = 0; i < ups.length; i++) {
        if (usedUp.has(i)) continue;
        if (ups[i].key === d.key && ups[i].t >= d.t) {
          const dt = ups[i].t - d.t;
          if (dt < bestDt) {
            bestDt = dt;
            bestIdx = i;
          }
        }
      }
      if (bestIdx >= 0) {
        usedUp.add(bestIdx);
        dwells.push(bestDt);
      }
    }
    if (dwells.length >= 3) {
      const mean = dwells.reduce((s, x) => s + x, 0) / dwells.length;
      const std = Math.sqrt(dwells.reduce((s, x) => s + (x - mean) ** 2, 0) / dwells.length);
      ev.meanDwellMs = +mean.toFixed(1);
      ev.dwellStd = +std.toFixed(2);
      if (mean < 2) {
        ev.zeroDwell = true;
        score += 40;
      } // no physical hold time
      if (std < 1 && dwells.length >= 4) {
        ev.constantDwell = true;
        score += 30;
      } // robotic
    }

    // 3) synthetic events
    const untrusted = [...downs, ...ups].filter((e) => !e.isTrusted).length;
    if (untrusted > 0) {
      ev.untrusted = untrusted;
      score += 50;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("keyboardDynamics", rating, score, ev, undefined, "interaction");
  },
};
