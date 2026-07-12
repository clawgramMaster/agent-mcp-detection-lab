import { type Detector, result } from "../../lib/detector";

/**
 * Mouse kinematics — acceleration & jerk (BeCAPTCHA-Mouse).
 * A human arm cannot move at constant velocity: it accelerates then
 * decelerates (bell-shaped velocity), so acceleration changes sign and jerk
 * (the derivative of acceleration) is non-trivial. Synthetic paths made of
 * evenly-spaced linear steps have ~constant velocity → acceleration ≈ 0 and
 * jerk ≈ 0. Complements mouseEntropy (which looks at speed spread & curvature).
 */
export const mouseKinematics: Detector = {
  test: "mouseKinematics",
  label: "Mouse acceleration & jerk",
  category: "interaction",
  run: (ctx) => {
    const m = ctx.mouse;
    if (m.length < 12) {
      // not enough travel to judge kinematics — stay neutral (don't penalize)
      return result(
        "mouseKinematics",
        "pass",
        0,
        { samples: m.length, note: "insufficient movement" },
        undefined,
        "interaction",
      );
    }

    const v: number[] = [];
    for (let i = 1; i < m.length; i++) {
      const dt = Math.max(1, m[i].t - m[i - 1].t);
      v.push(Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) / dt);
    }
    const a: number[] = [];
    for (let i = 1; i < v.length; i++) a.push(v[i] - v[i - 1]);
    const j: number[] = [];
    for (let i = 1; i < a.length; i++) j.push(a[i] - a[i - 1]);

    const std = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
      return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
    };
    // fraction of acceleration samples that flip sign vs the previous one
    let signFlips = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > 0 !== a[i - 1] > 0) signFlips++;
    const flipRatio = a.length > 1 ? signFlips / (a.length - 1) : 0;

    const accelStd = std(a);
    const jerkStd = std(j);
    const ev = {
      samples: m.length,
      accelStd: +accelStd.toFixed(4),
      jerkStd: +jerkStd.toFixed(4),
      accelSignFlipRatio: +flipRatio.toFixed(2),
    };

    let score = 0;
    if (accelStd < 0.008) score += 45; // essentially constant velocity → synthetic
    if (jerkStd < 0.004) score += 30; // no change in acceleration → linear interpolation
    if (flipRatio < 0.1) score += 25; // acceleration never oscillates → not a human arm
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("mouseKinematics", rating, score, ev, undefined, "interaction");
  },
};
