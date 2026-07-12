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
 */
// Names are matched against automation-specific tokens only (avoid flagging a
// site's own `dataBinding` etc).
const BINDING_NAME_RE = /^(__playwright|__pw|__pptr|__puppeteer|puppeteerLeak|playwright)/i;
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

      // 1) name looks like an automation binding
      const nameHit = BINDING_NAME_RE.test(name);

      // 2) a non-native function on window whose body reveals a binding wrapper
      let srcHit = false;
      try {
        const src = fnToString.call(val);
        if (!/\{\s*\[native code\]\s*\}/.test(src) && WRAPPER_SRC_RE.test(src)) srcHit = true;
      } catch {
        /* */
      }

      if (nameHit || srcHit) hits.push(name);
    }

    // Playwright also stashes bindings under these exact keys.
    for (const k of ["__playwright__binding__", "__pwInitScripts", "__playwright_binding_call"]) {
      if (k in window && !hits.includes(k)) hits.push(k);
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
