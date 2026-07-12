import { type Detector, result } from "../../lib/detector";

/**
 * Click teleport (Bot-Incolumitas / Device&BrowserInfo).
 * A human click is preceded by mouse movement approaching the target. Scripted
 * clicks (element.click(), CDP dispatch without a move) appear with no nearby
 * preceding mousemove — the pointer "teleports" onto the element.
 */
export const clickTeleport: Detector = {
  test: "clickTeleport",
  label: "Click without approach movement",
  category: "interaction",
  run: (ctx) => {
    if (ctx.clicks.length === 0) {
      return result("clickTeleport", "warn", 20, { clicks: 0, note: "submitted via Enter?" }, undefined, "interaction");
    }
    let teleports = 0;
    for (const c of ctx.clicks) {
      // a legit click has a mousemove within 250ms and 50px right before it
      const near = ctx.mouse.some((m) => m.t <= c.t && c.t - m.t <= 250 && Math.hypot(m.x - c.x, m.y - c.y) <= 50);
      if (!near) teleports++;
    }
    const untrusted = ctx.clicks.filter((c) => !c.isTrusted).length;
    const ratio = teleports / ctx.clicks.length;
    const ev = { clicks: ctx.clicks.length, teleports, untrusted, ratio: +ratio.toFixed(2) };
    let score = 0;
    if (untrusted > 0) score += 60;
    if (ratio >= 0.5) score += 50;
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("clickTeleport", rating, score, ev, undefined, "interaction");
  },
};
