import { type Detector, result } from "../../lib/detector";

/**
 * Scroll dynamics.
 * Real scrolling is driven by a physical input (wheel / trackpad / arrow keys)
 * and — on a trackpad — shows momentum (decaying wheel deltas). Automation that
 * scripts scrolling either:
 *   - dispatches synthetic wheel events (isTrusted === false),
 *   - fires wheel events with a constant deltaY (no momentum), or
 *   - moves the page with window.scrollTo() so a scroll happens with no wheel
 *     and no scroll-key input at all.
 *
 * Conservative: "scroll without input" is only a weak add (a human can drag the
 * scrollbar), while synthetic/constant wheels are strong.
 */
const SCROLL_KEYS = new Set(["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " ", "Spacebar"]);

export const scrollDynamics: Detector = {
  test: "scrollDynamics",
  label: "Scroll dynamics",
  category: "interaction",
  run: (ctx) => {
    const s = ctx.scrolls;
    const w = ctx.wheels;
    if (s.length === 0 && w.length === 0) {
      // no scrolling at all — not penalized here (many users never scroll)
      return result("scrollDynamics", "pass", 0, { scrolls: 0, wheels: 0 }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = { scrolls: s.length, wheels: w.length };
    let score = 0;

    const untrustedWheel = w.filter((x) => !x.isTrusted).length;
    if (untrustedWheel > 0) {
      ev.untrustedWheel = untrustedWheel;
      score += 60;
    }

    if (w.length >= 4) {
      const deltas = w.map((x) => Math.abs(x.deltaY));
      const uniq = new Set(deltas).size;
      if (uniq === 1) {
        ev.constantWheelDelta = true;
        score += 30;
      }
    }

    // page scrolled but no wheel and no scroll-key → likely window.scrollTo()
    const scrollKeyCount = ctx.keys.filter((k) => SCROLL_KEYS.has(k.key)).length;
    if (s.length > 0 && w.length === 0 && scrollKeyCount === 0) {
      ev.scrollWithoutInput = true;
      score += 20; // weak: a human can drag the scrollbar
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("scrollDynamics", rating, score, ev, undefined, "interaction");
  },
};
