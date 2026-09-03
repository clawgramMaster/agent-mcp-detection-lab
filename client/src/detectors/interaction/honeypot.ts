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
 * Clicking the hidden button is decisive. Filling the hidden field is not:
 * password managers and browser autofill can populate visually hidden inputs.
 */
export const honeypot: Detector = {
  test: "honeypot",
  label: "Hidden honeypot trap",
  category: "interaction",
  run: (ctx) => {
    if (ctx.honeypotTriggered) {
      const reasons = ctx.honeypotReasons ?? [];
      const hiddenControlClicked = reasons.some((reason) => reason.includes("clicked hidden honeypot button"));
      if (!hiddenControlClicked) {
        return result(
          "honeypot",
          "warn",
          35,
          { triggered: true, reasons, note: "hidden field may have been populated by autofill" },
          undefined,
          "interaction",
        );
      }
      return result(
        "honeypot",
        "fail",
        100,
        { triggered: true, reasons, note: "clicked a control outside the visual and accessibility surfaces" },
        undefined,
        "interaction",
      );
    }
    // a one-sided trap: not tripping it is not positive proof of humanity → inconclusive
    return result("honeypot", "inconclusive", 0, { triggered: false }, undefined, "interaction");
  },
};
