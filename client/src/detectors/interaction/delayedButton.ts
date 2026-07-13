import { type Detector, result } from "../../lib/detector";

/**
 * Delayed-button task ("click Continue when it turns green").
 *
 * The button starts disabled/grey and only enables (turns green) after a short
 * delay. A human must perceive the visual change and then react — perception +
 * motor time gives a floor around 250–400ms. An agent reveals itself two ways:
 *   - it clicks BEFORE the button is enabled (it acted on the DOM, not the pixels),
 *   - or it reacts in superhuman time (<150ms) once the state flips.
 */
export const delayedButton: Detector = {
  test: "delayedButton",
  label: "React-to-visual-change timing",
  category: "interaction",
  run: (ctx) => {
    const d = ctx.delayed;
    if (!d || d.clickedAt === 0) {
      return result("delayedButton", "inconclusive", 0, { note: "not clicked" }, undefined, "interaction");
    }
    const ev: Record<string, unknown> = {
      clickedBeforeEnable: d.clickedBeforeEnable,
      trusted: d.trusted,
    };
    let score = 0;

    if (d.clickedBeforeEnable) {
      ev.actedOnDomNotPixels = true;
      score += 85; // clicked a control that was not yet visually available
    } else {
      const reaction = d.clickedAt - d.enabledAt;
      ev.reactionMs = Math.round(reaction);
      if (reaction < 150)
        score += 70; // faster than human perception+motor
      else if (reaction < 280) score += 30;
    }
    if (!d.trusted) {
      ev.untrusted = true;
      score += 50;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("delayedButton", rating, score, ev, undefined, "interaction");
  },
};
