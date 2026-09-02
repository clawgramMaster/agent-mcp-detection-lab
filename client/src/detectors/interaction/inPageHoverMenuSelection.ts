import { type Detector, result } from "../../lib/detector";

/** Scores the direct, in-page closed-shadow hover menu independently of the iframe challenge. */
export const inPageHoverMenuSelection: Detector = {
  test: "inPageHoverMenuSelection",
  label: "In-page hover-menu selection timing",
  category: "interaction",
  run: (ctx) => {
    const h = ctx.inPageHoverMenu;
    if (!h || !h.completed) {
      return result(
        "inPageHoverMenuSelection",
        "inconclusive",
        0,
        { note: "not attempted" },
        undefined,
        "interaction",
      );
    }

    const evidence: Record<string, unknown> = {
      expectedOption: h.expectedOption,
      selectedOption: h.selectedOption,
      mouseSamples: h.mouseSamples,
      pathLength: Math.round(h.pathLength),
      targetGap: Math.round(h.targetGap),
    };
    let score = 0;

    if (!h.trusted) {
      evidence.untrustedClick = true;
      score += 65;
    }
    if (h.openedAt === 0) {
      evidence.selectedWithoutTrustedHover = true;
      score += 60;
    } else {
      const dwell = h.selectedAt - h.openedAt;
      evidence.dwellMs = Math.round(dwell);
      if (dwell < 80) score += 65;
      else if (dwell < 150) score += 30;

      if (h.targetGap > 20 && (h.mouseSamples === 0 || h.pathLength < h.targetGap * 0.4)) {
        evidence.cursorTeleport = true;
        score += 60;
      }
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("inPageHoverMenuSelection", rating, score, evidence, undefined, "interaction");
  },
};
