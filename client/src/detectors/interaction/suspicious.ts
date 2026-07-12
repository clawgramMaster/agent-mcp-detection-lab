import { type Detector, result } from "../../lib/detector";

/**
 * suspiciousClientSideBehavior — weak-signal combination (deviceandbrowserinfo).
 *
 * This is the meta-detector that catches automation which passes every
 * CDP / WebDriver / Playwright check: even a "clean" browser driven by a script
 * produces an unnatural *combination* of behavioral signals — little or no mouse
 * travel, no scrolling, robotic or superhuman typing, instant submit, and a
 * narrow set of interaction event types. No single signal is damning; together
 * they are.
 */
export const suspiciousClientSideBehavior: Detector = {
  test: "suspiciousClientSideBehavior",
  label: "Suspicious client-side behavior (combined)",
  category: "interaction",
  run: (ctx) => {
    const reasons: string[] = [];
    let score = 0;

    // --- 1. mouse travel & shape ---
    const m = ctx.mouse;
    if (m.length < 10) {
      reasons.push("almost no mouse movement");
      score += 25;
    }
    let pathLen = 0;
    let straightness = 1;
    if (m.length >= 2) {
      for (let i = 1; i < m.length; i++) pathLen += Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y);
      const net = Math.hypot(m[m.length - 1].x - m[0].x, m[m.length - 1].y - m[0].y);
      straightness = pathLen > 0 ? net / pathLen : 1; // →1 means a straight line (synthetic)
      if (m.length >= 6 && straightness > 0.9) {
        reasons.push("mouse path is a straight line");
        score += 20;
      }
      if (pathLen < 50 && m.length > 0) {
        reasons.push("negligible mouse travel");
        score += 15;
      }
    }

    // --- 2. scrolling ---
    if (ctx.scrolls.length === 0) {
      reasons.push("no scrolling at all");
      score += 8;
    }

    // --- 3. typing cadence ---
    const k = ctx.keys;
    if (k.length >= 3) {
      const gaps: number[] = [];
      for (let i = 1; i < k.length; i++) gaps.push(k[i].t - k[i - 1].t);
      const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
      const std = Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length);
      const cv = mean > 0 ? std / mean : 0;
      if (cv < 0.12) {
        reasons.push("robotic typing rhythm");
        score += 22;
      }
      if (gaps.filter((g) => g < 15).length > gaps.length * 0.5) {
        reasons.push("superhuman typing speed");
        score += 18;
      }
    } else if (k.length === 0 && (ctx.pasted || ctx.submittedAt)) {
      reasons.push("form filled without typing");
      score += 25;
    }

    // --- 4. submit timing ---
    if (ctx.submittedAt && ctx.formShownAt) {
      const dt = ctx.submittedAt - ctx.formShownAt;
      if (dt < 1200) {
        reasons.push("superhuman submit speed");
        score += 22;
      }
    }

    // --- 5. untrusted events anywhere ---
    const untrusted = [...ctx.mouse, ...ctx.keys, ...ctx.clicks, ...ctx.scrolls, ...ctx.focusEvents].filter(
      (e) => !e.isTrusted,
    ).length;
    if (untrusted > 0) {
      reasons.push(`${untrusted} synthetic (isTrusted=false) events`);
      score += 40;
    }

    // --- 6. interaction breadth (how many distinct event types were used) ---
    const breadth = [
      m.length > 0,
      k.length > 0,
      ctx.scrolls.length > 0,
      ctx.clicks.length > 0,
      ctx.focusEvents.length > 0,
    ].filter(Boolean).length;
    if (breadth <= 1) {
      reasons.push("only one interaction type observed");
      score += 15;
    }

    score = Math.min(100, score);
    const rating = score >= 50 ? "fail" : score >= 25 ? "warn" : "pass";
    return result(
      "suspiciousClientSideBehavior",
      rating,
      score,
      {
        reasons,
        mouseSamples: m.length,
        mousePathLen: Math.round(pathLen),
        straightness: +straightness.toFixed(2),
        scrolls: ctx.scrolls.length,
        clicks: ctx.clicks.length,
        keys: k.length,
        untrustedEvents: untrusted,
        interactionBreadth: breadth,
      },
      undefined,
      "interaction",
    );
  },
};
