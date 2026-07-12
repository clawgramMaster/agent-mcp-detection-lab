import { type Detector, result } from "../../lib/detector";

/**
 * Pointer / touch capability consistency.
 * The input surface should agree with what the UA claims. A mobile UA with
 * navigator.maxTouchPoints === 0, or a "coarse pointer" device that reports no
 * touch points, is contradictory — common when automation spoofs a mobile UA
 * on a desktop headless browser.
 */
export const pointerCapabilities: Detector = {
  test: "pointerCapabilities",
  label: "Pointer / touch consistency",
  category: "static",
  run: () => {
    const mtp = navigator.maxTouchPoints || 0;
    const uaData = (navigator as any).userAgentData;
    const uaMobile: boolean | undefined = uaData?.mobile;
    const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
    const noHover = typeof matchMedia === "function" ? matchMedia("(hover: none)").matches : false;
    const uaSaysMobile = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

    const ev: Record<string, unknown> = { maxTouchPoints: mtp, uaMobile, coarse, noHover, uaSaysMobile };
    let score = 0;

    // claims mobile (UA-CH or UA string) but exposes no touch surface
    if ((uaMobile === true || uaSaysMobile) && mtp === 0) {
      ev.mobileButNoTouch = true;
      score += 50;
    }
    // coarse pointer / no-hover (touch device) but no touch points
    if ((coarse || noHover) && mtp === 0) {
      ev.coarseButNoTouch = true;
      score += 25;
    }

    score = Math.min(100, score);
    const rating = score >= 50 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("pointerCapabilities", rating, score, ev, undefined, "static");
  },
};
