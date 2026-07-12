import { type Detector, result } from "../../lib/detector";

/**
 * CDP Runtime.enable leak (Rebrowser technique).
 * When a controller calls Runtime.enable, the DevTools protocol serializes
 * every thrown Error's `stack` getter. We throw an Error and access .stack
 * inside a getter to see if it is being read out-of-band.
 */
export const cdpRuntimeLeak: Detector = {
  test: "cdpRuntimeLeak",
  label: "CDP Runtime.enable leak",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      let leaked = false;
      const e = new Error("cdp-probe");
      Object.defineProperty(e, "stack", {
        configurable: true,
        get() {
          // If Runtime.enable is active, the agent reads .stack during console output.
          leaked = true;
          return "";
        },
      });
      // Emitting to console triggers Runtime.consoleAPICalled serialization under CDP.
      console.debug(e);
      setTimeout(() => {
        resolve(
          leaked
            ? result("cdpRuntimeLeak", "fail", 90, { leaked: true, method: "stack-getter" }, undefined, "static")
            : result("cdpRuntimeLeak", "pass", 0, { leaked: false }, undefined, "static"),
        );
      }, 60);
    }),
};

/**
 * Injection stack-trace artifacts.
 * Automation-injected scripts surface a puppeteer/playwright evaluation-script
 * sourceURL in stack traces. Only definitive markers are used — generic "VM" /
 * "<anonymous>" frames appear in normal eval and would false-positive.
 */
export const cdpStackTrace: Detector = {
  test: "cdpStackTrace",
  label: "Injection stack-trace artifacts",
  category: "static",
  run: () => {
    const stack = new Error().stack || "";
    const markers = ["__puppeteer_evaluation_script__", "__playwright_evaluation_script__", "evalmachine"];
    const hit = markers.filter((m) => stack.includes(m));
    if (hit.length) return result("cdpStackTrace", "fail", 80, { hit }, undefined, "static");
    return result("cdpStackTrace", "pass", 0, {}, undefined, "static");
  },
};
