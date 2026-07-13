import { type Detector, type MouseSample, result } from "../../lib/detector";

/**
 * Mouse movement entropy (BeCAPTCHA-Mouse inspired).
 * Human paths are jittery with variable velocity and curvature. Synthetic
 * CDP-driven paths are straight, evenly-spaced, or absent.
 */
export const mouseEntropy: Detector = {
  test: "mouseEntropy",
  label: "Mouse trajectory entropy",
  category: "interaction",
  run: (ctx) => {
    const m = ctx.mouse;
    if (m.length < 8) {
      // can't measure trajectory without movement — NOT a bot signal on its own
      // (keyboard-only humans have no mouse samples).
      return result(
        "mouseEntropy",
        "inconclusive",
        0,
        { samples: m.length, reason: "not enough mouse movement to measure" },
        undefined,
        "interaction",
      );
    }

    // velocity + turning-angle variance
    const speeds: number[] = [];
    const angles: number[] = [];
    for (let i = 1; i < m.length; i++) {
      const dx = m[i].x - m[i - 1].x;
      const dy = m[i].y - m[i - 1].y;
      const dt = Math.max(1, m[i].t - m[i - 1].t);
      speeds.push(Math.hypot(dx, dy) / dt);
      angles.push(Math.atan2(dy, dx));
    }
    const std = (a: number[]) => {
      const mean = a.reduce((s, x) => s + x, 0) / a.length;
      return Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
    };
    const speedStd = std(speeds);
    let angleChanges = 0;
    for (let i = 1; i < angles.length; i++) if (Math.abs(angles[i] - angles[i - 1]) > 0.05) angleChanges++;
    const curviness = angleChanges / angles.length;

    const ev = { samples: m.length, speedStd: +speedStd.toFixed(4), curviness: +curviness.toFixed(3) };
    let score = 0;
    if (speedStd < 0.02) score += 50; // near-constant velocity → synthetic
    if (curviness < 0.1) score += 40; // near-straight line → synthetic
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("mouseEntropy", rating, score, ev, undefined, "interaction");
  },
};

/**
 * CDP mouse leak — Input.dispatchMouseEvent produces movementX/Y === 0 and
 * integer coordinates, unlike real hardware pointer deltas (CDP Input spec).
 */
export const cdpMouseLeak: Detector = {
  test: "cdpMouseLeak",
  label: "CDP synthetic mouse leak",
  category: "interaction",
  run: (ctx) => {
    const m = ctx.mouse;
    if (m.length < 5) {
      return result("cdpMouseLeak", "inconclusive", 0, { samples: m.length }, undefined, "interaction");
    }
    const zeroMovement = m.filter((s) => s.movementX === 0 && s.movementY === 0).length;
    const zeroRatio = zeroMovement / m.length;
    const allInteger = m.every((s: MouseSample) => Number.isInteger(s.x) && Number.isInteger(s.y));
    const untrusted = m.filter((s) => !s.isTrusted).length;

    const ev = { samples: m.length, zeroMovementRatio: +zeroRatio.toFixed(2), allIntegerCoords: allInteger, untrusted };
    let score = 0;
    if (zeroRatio > 0.6) score += 60; // movement deltas never populated
    if (untrusted > 0) score += 60; // isTrusted=false → scripted
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("cdpMouseLeak", rating, score, ev, undefined, "interaction");
  },
};
