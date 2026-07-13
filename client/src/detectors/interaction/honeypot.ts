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
    // a one-sided trap: not tripping it is not positive proof of humanity → inconclusive
    return result("honeypot", "inconclusive", 0, { triggered: false }, undefined, "interaction");
  },
};
