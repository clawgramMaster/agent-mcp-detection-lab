import { type Detector, result } from "../../lib/detector";

/**
 * DOM-churn click test (detached-node click).
 *
 * A button is silently swapped for a look-alike replacement node partway
 * through the task. Whatever is currently painted on screen is the ONLY thing
 * a real pointer can hit — once the original node is removed from the
 * document it renders nothing and receives no hit-testing, full stop. The
 * only way to "click" it afterwards is to hold a stale JS/WebDriver element
 * handle and invoke `.click()` (or dispatch a synthetic event) on it directly.
 * That is exactly the pattern legacy Selenium/Playwright element-handle
 * automation uses: resolve an element once, then act on the handle later
 * without re-querying the live DOM.
 *
 * A click that lands on the replacement is judged normally (trusted vs not);
 * a click that lands on the ORIGINAL after the swap is a physical
 * impossibility and floors the score.
 */
export const detachedNodeClick: Detector = {
  test: "detachedNodeClick",
  label: "DOM-churn click physics",
  category: "interaction",
  run: (ctx) => {
    const d = ctx.detachedClick;
    if (!d || !d.completed) {
      return result("detachedNodeClick", "inconclusive", 0, { note: "not attempted" }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = {
      swapped: d.swappedAt > 0,
      originalClickedAt: d.originalClickedAt || undefined,
      replacementClickedAt: d.replacementClickedAt || undefined,
    };

    if (d.originalClickedAfterSwap) {
      ev.clickedDetachedNode = true;
      ev.originalTrusted = d.originalTrusted;
      return result("detachedNodeClick", "fail", 95, ev, undefined, "interaction");
    }

    // A legitimate early click on the (still-attached) original, or a click
    // on the replacement after the swap — both are physically normal paths.
    const trusted = d.replacementClickedAt > 0 ? d.replacementTrusted : d.originalTrusted;
    let score = 0;
    if (!trusted) {
      ev.untrusted = true;
      score = 65;
    }
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("detachedNodeClick", rating, score, ev, undefined, "interaction");
  },
};
