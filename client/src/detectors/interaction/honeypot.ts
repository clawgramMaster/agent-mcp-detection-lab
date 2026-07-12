import { type Detector, result } from "../../lib/detector";

/**
 * Honeypot — active-challenge trap (Bot Incolumitas / classic form honeypots).
 *
 * The page plants controls that are present in the DOM but invisible / off-limits
 * to a real human: a hidden "email"/"website" field, an off-screen "continue"
 * button, and a link whose only instruction lives in the accessibility tree.
 * A human never touches them. An agent that parses the page and acts on every
 * actionable element — exactly the behavior we want to catch — trips the wire.
 *
 * Zero false-positive by construction: nothing a sighted human does can trigger
 * it, so this is a decisive (weight 1.0) tell.
 */
export const honeypot: Detector = {
  test: "honeypot",
  label: "Hidden honeypot trap",
  category: "interaction",
  run: (ctx) => {
    if (ctx.honeypotTriggered) {
      return result(
        "honeypot",
        "fail",
        100,
        { triggered: true, reasons: ctx.honeypotReasons ?? [], note: "activated a control invisible to humans" },
        undefined,
        "interaction",
      );
    }
    return result("honeypot", "pass", 0, { triggered: false }, undefined, "interaction");
  },
};

/**
 * Superhuman reaction — how fast an instruction is acted on.
 * A human needs perception + motor time (~250ms floor, typically 400ms+) between
 * an instruction appearing and completing it. An agent that has already parsed
 * the DOM acts in near-zero time. Fires only on clearly inhuman latencies.
 */
export const reactionLatency: Detector = {
  test: "reactionLatency",
  label: "Instruction reaction time",
  category: "interaction",
  run: (ctx) => {
    const lat = ctx.stepLatencies ?? [];
    if (lat.length === 0) {
      return result("reactionLatency", "pass", 0, { steps: 0 }, undefined, "interaction");
    }
    const min = Math.min(...lat);
    const median = [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)];
    const ev = { steps: lat.length, minMs: Math.round(min), medianMs: Math.round(median) };
    let score = 0;
    // Below human perceptual+motor floor → machine.
    if (min < 120) score += 70;
    else if (min < 250) score += 30;
    if (median < 250) score += 20;
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("reactionLatency", rating, score, ev, undefined, "interaction");
  },
};
