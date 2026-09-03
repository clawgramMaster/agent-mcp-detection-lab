import { type Detector, result } from "../../lib/detector";

/**
 * Popup opener/referrer integrity (target=_blank navigation).
 *
 * Clicking a real, same-origin `target="_blank" rel="opener"` link leaves
 * `window.opener` set on the new tab and populates `document.referrer`.
 * Automation stacks
 * that spawn a "new tab" via the DevTools Protocol (`Target.createTarget`)
 * rather than a genuine anchor navigation frequently produce a tab with no
 * opener and an empty referrer — it never really "came from" this page the
 * way a click would.
 *
 * The popup reports its own diagnostics back over a same-origin
 * BroadcastChannel, a channel that works independently of window.opener, so
 * a MISSING report after a trusted click is itself the tell: the tab never
 * became a real same-origin browsing context tied back to this page.
 */
export const popupOpenerIntegrity: Detector = {
  test: "popupOpenerIntegrity",
  label: "Popup opener/referrer integrity",
  category: "interaction",
  run: (ctx) => {
    const p = ctx.popupCheck;
    if (!p || p.clickedAt === 0) {
      return result("popupOpenerIntegrity", "inconclusive", 0, { note: "not attempted" }, undefined, "interaction");
    }

    const ev: Record<string, unknown> = { trustedClick: p.trustedClick };

    if (!p.completed) {
      // Clicked, but the popup never reported back at all. BroadcastChannel
      // doesn't need window.opener to work, so silence means the tab never
      // came up as a genuine same-origin context tied to this click.
      if (!p.trustedClick) {
        return result(
          "popupOpenerIntegrity",
          "inconclusive",
          0,
          { note: "untrusted click, no report" },
          undefined,
          "interaction",
        );
      }
      ev.noReport = true;
      return result("popupOpenerIntegrity", "warn", 40, ev, undefined, "interaction");
    }

    let score = 0;
    if (p.openerPresent === false) {
      ev.openerMissing = true;
      score += 40;
    }
    if (p.referrerNonEmpty === false) {
      // weak on its own: privacy modes / extensions legitimately strip referrers
      ev.referrerMissing = true;
      score += 15;
    } else if (p.referrerOriginMatches === false) {
      ev.referrerOriginMismatch = true;
      score += 30;
    }
    if (!p.trustedClick) {
      ev.untrustedClick = true;
      score += 60;
    }

    score = Math.min(100, score);
    const rating = score >= 60 && !p.trustedClick ? "fail" : score >= 25 ? "warn" : "pass";
    return result("popupOpenerIntegrity", rating, score, ev, undefined, "interaction");
  },
};
