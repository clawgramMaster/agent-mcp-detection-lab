import { type Detector, result } from "../../lib/detector";

/**
 * Hover dropdown menu selection (open-on-hover, not open-on-click).
 *
 * The menu reveals itself purely on `mouseenter` — no click needed to open —
 * and dismisses itself when the pointer leaves both the trigger and the menu
 * for good, exactly like a desktop nav dropdown. Picking an option this way
 * requires a real cursor to physically dwell on the trigger long enough for
 * the browser to fire `mouseenter`, then travel down into the menu and land
 * on an option: real perception + motor time. A script that "opens" it with
 * a bare synthetic `mouseenter` and clicks an option in the same tick has
 * near-zero dwell between open and select.
 */
export const hoverMenuSelection: Detector = {
  test: "hoverMenuSelection",
  label: "Hover-menu selection timing",
  category: "interaction",
  run: (ctx) => {
    const h = ctx.hoverMenu;
    if (!h || !h.completed) {
      return result("hoverMenuSelection", "inconclusive", 0, { note: "not attempted" }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = {
      expectedOption: h.expectedOption,
      selectedOption: h.selectedOption,
      hoverTrusted: h.hoverTrusted,
    };
    let score = 0;

    if (h.hoverTrusted === false) {
      ev.untrustedHover = true;
      score += 65;
    }
    if (!h.trusted) {
      ev.untrusted = true;
      score += 65;
    }
    if (h.openedAt === 0) {
      // selected without the menu ever having been opened via a real hover —
      // only reachable by driving the DOM directly (e.g. dispatching a click
      // on the hidden option node without ever hovering the trigger).
      ev.selectedWithoutHover = true;
      score += 60;
    } else {
      const dwell = h.selectedAt - h.openedAt;
      ev.dwellMs = Math.round(dwell);
      if (dwell < 80)
        score += 65; // faster than perception + travel into the menu
      else if (dwell < 150) score += 30;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("hoverMenuSelection", rating, score, ev, undefined, "interaction");
  },
};
