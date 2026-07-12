import { type Detector, result } from "../../lib/detector";

/**
 * JS-engine ↔ UA coherence (FingerprintJS BotD).
 *
 * The user-agent claims a browser family, but the underlying JS engine leaks its
 * real identity through invariants the UA can't change:
 *   - navigator.productSub: "20030107" on Blink/WebKit (Chrome/Safari/Opera),
 *     "20100101" on Gecko (Firefox);
 *   - navigator.vendor: "Google Inc." (Chrome/Opera), "Apple Computer, Inc."
 *     (Safari), "" (Firefox);
 *   - eval.toString().length: 33 on V8 (Chrome), 37 on SpiderMonkey/JSC.
 * A UA that says "Chrome" while the engine says Gecko/JSC is a spoofed automation
 * environment. Only fires on clear contradictions to avoid false positives.
 */
export const engineCoherence: Detector = {
  test: "engineCoherence",
  label: "JS engine / UA coherence",
  category: "static",
  run: () => {
    const ua = navigator.userAgent;
    const productSub = navigator.productSub;
    const vendor = navigator.vendor;
    let evalLength = -1;
    try {
      // biome-ignore lint/security/noGlobalEval: reading eval.toString() length only, not executing
      evalLength = eval.toString().length;
    } catch {
      /* */
    }
    const ev: Record<string, unknown> = { productSub, vendor, evalLength };
    let score = 0;

    const claimsChrome = /Chrome\/\d+/.test(ua) && !/Edg\/|OPR\//.test(ua);
    const claimsFirefox = /Firefox\/\d+/.test(ua);
    const claimsSafari = /Version\/\d+.*Safari/.test(ua) && !/Chrome\//.test(ua);

    // Chrome/Blink invariants
    if (claimsChrome) {
      if (productSub && productSub !== "20030107") {
        ev.productSubMismatch = true;
        score += 45;
      }
      if (vendor && vendor !== "Google Inc.") {
        ev.vendorMismatch = true;
        score += 40;
      }
      if (evalLength !== -1 && evalLength !== 33) {
        ev.evalLengthMismatch = true; // V8 must be 33
        score += 45;
      }
    }
    // Firefox/Gecko invariants
    if (claimsFirefox) {
      if (productSub && productSub !== "20100101") {
        ev.productSubMismatch = true;
        score += 45;
      }
      if (vendor && vendor !== "") {
        ev.vendorMismatch = true;
        score += 30;
      }
      if (evalLength !== -1 && evalLength === 33) {
        ev.geckoWithV8 = true; // claims Firefox but runs V8
        score += 50;
      }
    }
    // Safari/JSC invariants
    if (claimsSafari) {
      if (vendor && vendor !== "Apple Computer, Inc.") {
        ev.vendorMismatch = true;
        score += 35;
      }
      if (evalLength !== -1 && evalLength === 33) {
        ev.safariWithV8 = true;
        score += 40;
      }
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("engineCoherence", rating, score, ev, undefined, "static");
  },
};
