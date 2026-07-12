import { type Detector, result } from "../../lib/detector";

/**
 * Typing cadence (Bot Incolumitas).
 * Human inter-key intervals are noisy (50–300ms, high variance). Scripted
 * typing is either too uniform (fixed delay) or impossibly fast (<15ms).
 */
export const typingCadence: Detector = {
  test: "typingCadence",
  label: "Keystroke cadence",
  category: "interaction",
  run: (ctx) => {
    const k = ctx.keys;
    if (k.length < 4) {
      return result(
        "typingCadence",
        "warn",
        30,
        { keys: k.length, reason: "too few keystrokes" },
        undefined,
        "interaction",
      );
    }
    const gaps: number[] = [];
    for (let i = 1; i < k.length; i++) gaps.push(k[i].t - k[i - 1].t);
    const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    const variance = gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? std / mean : 0; // coefficient of variation
    const tooFast = gaps.filter((g) => g < 15).length;
    const untrusted = k.filter((s) => !s.isTrusted).length;

    const ev = {
      keys: k.length,
      meanGapMs: +mean.toFixed(1),
      cv: +cv.toFixed(3),
      subeq15msKeys: tooFast,
      untrusted,
    };
    let score = 0;
    if (untrusted > 0) score += 70; // synthetic key events
    if (cv < 0.1) score += 50; // robotic uniformity
    if (tooFast > k.length * 0.5) score += 40; // superhuman speed
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("typingCadence", rating, score, ev, undefined, "interaction");
  },
};

/** Paste detection — bots frequently set .value or paste instead of typing. */
export const pasteVsType: Detector = {
  test: "pasteVsType",
  label: "Paste / value-injection",
  category: "interaction",
  run: (ctx) => {
    if (ctx.pasted) {
      return result("pasteVsType", "warn", 40, { pasted: true }, undefined, "interaction");
    }
    // No keystrokes at all — could be a value-injection bot, but a human can
    // also submit an empty form by clicking, so treat as suspicious, not proof.
    if (ctx.keys.length === 0) {
      return result("pasteVsType", "warn", 40, { pasted: false, keystrokes: 0 }, undefined, "interaction");
    }
    return result("pasteVsType", "pass", 0, { pasted: false, keystrokes: ctx.keys.length }, undefined, "interaction");
  },
};
