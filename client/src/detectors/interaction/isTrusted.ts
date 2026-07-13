import { type Detector, result } from "../../lib/detector";

/**
 * isTrusted aggregate (Device & Browser Info).
 * Genuine user-generated events carry isTrusted === true. Any scripted /
 * dispatchEvent-driven interaction yields isTrusted === false.
 */
export const isTrusted: Detector = {
  test: "isTrusted",
  label: "Event isTrusted flag",
  category: "interaction",
  run: (ctx) => {
    const all = [...ctx.mouse, ...ctx.keys, ...ctx.clicks];
    if (all.length === 0) {
      return result("isTrusted", "inconclusive", 0, { events: 0 }, undefined, "interaction");
    }
    const untrusted = all.filter((e) => !e.isTrusted).length;
    const ratio = untrusted / all.length;
    const ev = { events: all.length, untrusted, ratio: +ratio.toFixed(2) };
    if (untrusted > 0) {
      return result("isTrusted", "fail", Math.min(100, 60 + ratio * 40), ev, undefined, "interaction");
    }
    return result("isTrusted", "pass", 0, ev, undefined, "interaction");
  },
};

/**
 * Superhuman submit — time between the form becoming visible and submission.
 * Humans need seconds; bots submit in tens of milliseconds.
 */
export const superhumanSubmit: Detector = {
  test: "superhumanSubmit",
  label: "Superhuman submit speed",
  category: "interaction",
  run: (ctx) => {
    if (!ctx.submittedAt || !ctx.formShownAt) {
      return result("superhumanSubmit", "inconclusive", 0, { measured: false }, undefined, "interaction");
    }
    const dt = ctx.submittedAt - ctx.formShownAt;
    const ev = { fillToSubmitMs: dt };
    if (dt < 800) return result("superhumanSubmit", "fail", 80, ev, undefined, "interaction");
    if (dt < 1800) return result("superhumanSubmit", "warn", 35, ev, undefined, "interaction");
    return result("superhumanSubmit", "pass", 0, ev, undefined, "interaction");
  },
};
