import { type Detector, result } from "../../lib/detector";

/**
 * Virtual security keypad (click-to-enter PIN, no keyboard) — mirrors real
 * anti-keylogging "secure keypad" widgets used by banks / certificate-auth SDKs.
 * The digit layout renders inside a closed shadow root (see `shadowDomIntegrity`)
 * and is RE-SHUFFLED after every accepted click, so a script cannot cache
 * absolute screen coordinates across taps — it has to re-locate each digit's new
 * position, exactly like a human reading the pad.
 *
 * Because the layout moves, this catches automation two ways at once:
 *   - the usual motion/physics tell (teleport / dead-center / timing math on
 *     button-to-button transitions), and
 *   - a keypad-specific tell: clicking the SAME absolute point twice in a row
 *     for two different digits is only possible if the click ignored the
 *     re-shuffled layout entirely (coordinate replay from a cached map).
 */
export const keypadChallenge: Detector = {
  test: "secureKeypad",
  label: "Secure keypad click physics",
  category: "interaction",
  run: (ctx) => {
    const k = ctx.keypad;
    if (!k || k.clicks.length === 0) {
      return result("secureKeypad", "inconclusive", 0, { note: "challenge not attempted" }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = {
      clicks: k.clicks.length,
      completed: k.completed,
      correct: k.correct,
      shuffles: k.shuffles,
    };
    let score = 0;

    // 1) synthetic (untrusted) clicks
    const untrusted = k.clicks.filter((c) => !c.isTrusted).length;
    if (untrusted > 0) {
      ev.untrusted = untrusted;
      score += 60;
    }

    // 2) teleport transitions between re-shuffled button positions, and
    //    coordinate-replay: an identical click point reused for a button that
    //    just moved is only explainable by ignoring the (re-rendered) layout.
    const transitions = k.clicks.slice(1);
    let teleports = 0;
    let deadCenter = 0;
    let replayedPoint = 0;
    for (let i = 0; i < transitions.length; i++) {
      const c = transitions[i];
      const prev = k.clicks[i]; // previous click (before this transition)
      if (c.targetGap > 40 && (c.movesSincePrev === 0 || c.pathLenSincePrev < c.targetGap * 0.4)) teleports++;
      // click landed within 2px of the PREVIOUS click's screen point, even though
      // the button it needed to hit moved by more than a hair (layout reshuffled).
      if (c.targetGap > 20 && Math.abs(c.x - prev.x) < 2 && Math.abs(c.y - prev.y) < 2) replayedPoint++;
    }
    for (const c of k.clicks) {
      if (Math.abs(c.dxCenter) < 1.5 && Math.abs(c.dyCenter) < 1.5) deadCenter++;
    }
    if (transitions.length > 0) {
      const teleRatio = teleports / transitions.length;
      ev.teleports = teleports;
      ev.teleportRatio = +teleRatio.toFixed(2);
      if (teleRatio >= 0.5) score += 55;
      else if (teleports > 0) score += 25;
    }
    if (replayedPoint > 0) {
      ev.replayedPoint = replayedPoint;
      score += 50; // clicked as if the (re-shuffled) layout never changed
    }
    if (deadCenter >= 1) {
      ev.deadCenterHits = deadCenter;
      score += Math.min(50, 30 + deadCenter * 10);
    }

    // 3) inter-click timing: superhuman or robotically uniform
    if (k.clicks.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < k.clicks.length; i++) gaps.push(k.clicks[i].t - k.clicks[i - 1].t);
      const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
      const std = Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length);
      const cv = mean > 0 ? std / mean : 0;
      ev.meanClickGapMs = Math.round(mean);
      ev.clickGapCv = +cv.toFixed(2);
      if (mean < 120) score += 40; // faster than perception+motor per digit
      if (gaps.length >= 2 && cv < 0.1) score += 25; // metronome timing
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("secureKeypad", rating, score, ev, undefined, "interaction");
  },
};
