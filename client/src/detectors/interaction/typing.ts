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
        "inconclusive",
        0,
        { keys: k.length, reason: "too few keystrokes to measure cadence" },
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
      // Copy/paste is a normal human workflow, especially for credentials.
      return result("pasteVsType", "pass", 0, { pasted: true }, undefined, "interaction");
    }
    // No keystrokes at all → nothing to judge (a human can submit without typing).
    if (ctx.keys.length === 0) {
      return result("pasteVsType", "inconclusive", 0, { pasted: false, keystrokes: 0 }, undefined, "interaction");
    }
    return result("pasteVsType", "pass", 0, { pasted: false, keystrokes: ctx.keys.length }, undefined, "interaction");
  },
};

/**
 * Clipboard shortcut mismatch -- a physical paste emits a ClipboardEvent before
 * the value changes. A large atomic value jump after only a shortcut-sized set
 * of key events, without that paste event, indicates direct text insertion
 * dressed up with trusted Ctrl/Cmd+V key events.
 */
export const clipboardShortcutMismatch: Detector = {
  test: "clipboardShortcutMismatch",
  label: "Clipboard shortcut / value-change consistency",
  category: "interaction",
  run: (ctx) => {
    const ev = {
      pasted: ctx.pasted,
      maxValueJump: ctx.maxValueJump,
      keystrokes: ctx.keys.length,
    };
    if (ctx.pasted) return result("clipboardShortcutMismatch", "pass", 0, ev, undefined, "interaction");
    if (ctx.maxValueJump < 8) {
      const rating = ctx.maxValueJump === 0 ? "inconclusive" : "pass";
      return result("clipboardShortcutMismatch", rating, 0, ev, undefined, "interaction");
    }
    if (ctx.keys.length <= 4) {
      // Autofill, password managers, IME commits and accessibility software can
      // also produce an atomic value change without a paste event. Keep this as
      // supporting evidence; it cannot condemn a visitor by itself.
      return result("clipboardShortcutMismatch", "warn", 40, ev, undefined, "interaction");
    }
    return result("clipboardShortcutMismatch", "pass", 0, ev, undefined, "interaction");
  },
};
