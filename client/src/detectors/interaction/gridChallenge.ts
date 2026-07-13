import { type Detector, result } from "../../lib/detector";

/**
 * Multi-step grid challenge (Bot Incolumitas / BeCAPTCHA-Mouse).
 *
 * The page asks for tiles to be clicked in a given order. Completing the task is
 * trivial for both humans and agents — the tell is HOW. Between two tiles a human
 * physically moves the cursor (a curved path, many mousemove samples, variable
 * timing) and never lands on the exact pixel center. An agent that drives the
 * page programmatically teleports click-to-click: no movement between tiles,
 * dead-center hits, and super-uniform or superhuman inter-click timing.
 *
 * This looks at the click *transitions*, so it catches automation whose
 * individual events are otherwise trusted (CDP-dispatched) — the motion between
 * targets is the physical constraint a script can't cheaply fake.
 */
export const gridChallenge: Detector = {
  test: "gridChallenge",
  label: "Grid challenge motion",
  category: "interaction",
  run: (ctx) => {
    const g = ctx.grid;
    if (!g || g.clicks.length === 0) {
      return result("gridChallenge", "inconclusive", 0, { note: "challenge not attempted" }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = {
      clicks: g.clicks.length,
      completed: g.completed,
      correct: g.correct,
    };
    let score = 0;

    // 1) synthetic (untrusted) clicks
    const untrusted = g.clicks.filter((c) => !c.isTrusted).length;
    if (untrusted > 0) {
      ev.untrusted = untrusted;
      score += 60;
    }

    // 2) teleport transitions: for a tile-to-tile move of real distance, a human
    //    generates mousemoves and path length. Zero movement across a gap = jump.
    const transitions = g.clicks.slice(1);
    let teleports = 0;
    let deadCenter = 0;
    for (const c of transitions) {
      if (c.tileGap > 40 && (c.movesSincePrev === 0 || c.pathLenSincePrev < c.tileGap * 0.4)) teleports++;
    }
    for (const c of g.clicks) {
      if (Math.abs(c.dxCenter) < 1.5 && Math.abs(c.dyCenter) < 1.5) deadCenter++;
    }
    if (transitions.length > 0) {
      const teleRatio = teleports / transitions.length;
      ev.teleports = teleports;
      ev.teleportRatio = +teleRatio.toFixed(2);
      if (teleRatio >= 0.5) score += 55;
      else if (teleports > 0) score += 25;
    }
    if (deadCenter >= 1) {
      ev.deadCenterHits = deadCenter;
      score += Math.min(50, 30 + deadCenter * 10);
    }

    // 3) inter-click timing: superhuman or robotically uniform
    if (g.clicks.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < g.clicks.length; i++) gaps.push(g.clicks[i].t - g.clicks[i - 1].t);
      const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
      const std = Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length);
      const cv = mean > 0 ? std / mean : 0;
      ev.meanClickGapMs = Math.round(mean);
      ev.clickGapCv = +cv.toFixed(2);
      if (mean < 120) score += 40; // faster than perception+motor per step
      if (gaps.length >= 2 && cv < 0.1) score += 25; // metronome timing
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("gridChallenge", rating, score, ev, undefined, "interaction");
  },
};
