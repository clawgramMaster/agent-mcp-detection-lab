import { type Detector, result } from "../../lib/detector";

/**
 * exposeFunction / exposeBinding leak (Rebrowser).
 *
 * Puppeteer's `page.exposeFunction()` and Playwright's `page.exposeBinding()`
 * install a callback on `window` so page JS can call back into Node. The
 * installed function is NOT a real native binding — it stringifies to a JS
 * wrapper that references the framework's delivery internals
 * (deliverResult / deliverError / __playwright__binding__ / bindingName …).
 * A genuine browser has no such wrappers on window.
 *
 * SCOPE: this detector only inspects the *source* of window functions for binding
 * wrappers. Window property *names* that look like automation (__playwright,
 * __pwInitScripts, selenium, cdc_ …) are owned by `automationGlobals` — scanning
 * names here too would double-count the same evidence under the weighted noisy-OR.
 */
// Body markers that appear ONLY in framework binding wrappers — deliberately not
// generic Promise/callback patterns, which legit page code also contains.
const WRAPPER_SRC_RE = /deliverResult|deliverError|__playwright__binding__|__puppeteer_|bindingName|_playwrightBinding/;

export const exposeFunctionLeak: Detector = {
  test: "exposeFunctionLeak",
  label: "exposeFunction / binding leak",
  category: "static",
  run: () => {
    const fnToString = Function.prototype.toString;
    const hits: string[] = [];
    let props: string[] = [];
    try {
      props = Object.getOwnPropertyNames(window);
    } catch {
      /* */
    }

    for (const name of props) {
      let val: unknown;
      try {
        val = (window as unknown as Record<string, unknown>)[name];
      } catch {
        continue; // access throwing on a window prop is itself odd, but skip
      }
      if (typeof val !== "function") continue;

      // A non-native function on window whose body reveals a binding wrapper.
      try {
        const src = fnToString.call(val);
        if (!/\{\s*\[native code\]\s*\}/.test(src) && WRAPPER_SRC_RE.test(src)) hits.push(name);
      } catch {
        /* */
      }
    }

    if (hits.length) {
      return result(
        "exposeFunctionLeak",
        "fail",
        Math.min(100, 70 + hits.length * 10),
        { bindings: hits },
        undefined,
        "static",
      );
    }
    return result("exposeFunctionLeak", "pass", 0, { bindings: [] }, undefined, "static");
  },
};
