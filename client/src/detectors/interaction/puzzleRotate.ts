import { type Detector, result } from "../../lib/detector";

/**
 * Bar-to-rotate puzzle (slider-captcha style, pointer-path variant).
 *
 * A circular piece is cut out of a random picture; sliding the bar under it
 * (or scrolling over the picture) turns the circle and the user must hold it
 * upright for a short dwell. Every bar/wheel input is recorded with pointer
 * x/y. A human drags with vertical drift, variable speed, overshoots and
 * corrects, and takes seconds. Scripted runs tend to be: untrusted synthetic
 * events, one or two huge jumps, finished near-instantly, a perfectly regular
 * cadence, constant speed, a perfectly linear x(t) ramp with zero vertical
 * drift, or a monotone sweep that never overshoots/corrects. Detection only —
 * probabilistic tells.
 */
export const puzzleRotate: Detector = {
  test: "puzzleRotate",
  label: "Scroll-rotate puzzle wheel path",
  category: "interaction",
  run: (ctx) => {
    const s = ctx.puzzleRotate;
    if (!s || s.samples.length === 0) {
      return result(
        "puzzleRotate",
        "inconclusive",
        0,
        { note: "rotation puzzle not attempted" },
        undefined,
        "interaction",
      );
    }
    if (!s.completed) {
      return result(
        "puzzleRotate",
        "inconclusive",
        0,
        { note: "rotation puzzle incomplete" },
        undefined,
        "interaction",
      );
    }

    const n = s.samples.length;
    const totalMs = s.completedAt - s.startedAt;
    const ev: Record<string, unknown> = {
      inputEvents: n,
      barEvents: s.samples.filter((x) => x.src === "bar").length,
      totalMs,
      holdMs: s.holdMs,
      image: s.image,
      attempts: s.attempts,
    };
    let score = 0;

    const untrusted = s.samples.filter((x) => !x.trusted).length;
    if (untrusted > 0) {
      ev.untrusted = untrusted;
      score += 50;
    }
    if (n <= 2) {
      ev.jumped = true;
      score += 40;
    }
    // the dwell alone is ~holdMs, so anything barely over it means no real search
    if (totalMs > 0 && totalMs < s.holdMs + 600) {
      ev.superhuman = true;
      score += 30;
    }

    if (n >= 6) {
      // regular cadence: consecutive inter-event gaps nearly identical
      const gaps: number[] = [];
      for (let i = 1; i < n; i++) gaps.push(s.samples[i].t - s.samples[i - 1].t);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const std = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
      const cv = mean > 0 ? std / mean : 0;
      ev.gapCv = +cv.toFixed(2);
      if (cv < 0.1) {
        ev.regularCadence = true;
        score += 25;
      }

      // vertical drift: a hand dragging the bar never keeps y perfectly constant
      const bar = s.samples.filter((x) => x.src === "bar");
      if (bar.length >= 6) {
        const ys = bar.map((p) => p.y);
        const yRange = Math.max(...ys) - Math.min(...ys);
        ev.yRange = +yRange.toFixed(1);
        if (yRange < 0.5) {
          ev.flatPath = true;
          score += 25;
        }
        // constant speed along the bar (handle px per ms)
        const speeds: number[] = [];
        for (let i = 1; i < bar.length; i++) {
          const dt = bar[i].t - bar[i - 1].t;
          if (dt > 0) speeds.push(Math.abs(bar[i].x - bar[i - 1].x) / dt);
        }
        if (speeds.length >= 5) {
          const m = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - m) ** 2, 0) / speeds.length);
          const sv = m > 0 ? sd / m : 0;
          ev.speedCv = +sv.toFixed(2);
          if (sv < 0.15) {
            ev.constantSpeed = true;
            score += 20;
          }
        }
        // perfectly linear x(t): Pearson r² of pointer x against time ≈ 1 means a ramp
        const mt = bar.reduce((a, p) => a + p.t, 0) / bar.length;
        const mx = bar.reduce((a, p) => a + p.x, 0) / bar.length;
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (const p of bar) {
          sxy += (p.t - mt) * (p.x - mx);
          sxx += (p.t - mt) ** 2;
          syy += (p.x - mx) ** 2;
        }
        if (sxx > 0 && syy > 0) {
          const r2 = (sxy * sxy) / (sxx * syy);
          ev.linearR2 = +r2.toFixed(4);
          if (r2 > 0.9995) {
            ev.perfectlyLinear = true;
            score += 25;
          }
        }
      }

      // fine adjustment: humans overshoot and correct (delta sign reversals)
      let reversals = 0;
      for (let i = 1; i < n; i++) {
        if (Math.sign(s.samples[i].dy) !== 0 && Math.sign(s.samples[i].dy) === -Math.sign(s.samples[i - 1].dy))
          reversals++;
      }
      ev.reversals = reversals;
      if (reversals === 0) {
        ev.noCorrection = true;
        score += 10;
      }
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("puzzleRotate", rating, score, ev, undefined, "interaction");
  },
};
