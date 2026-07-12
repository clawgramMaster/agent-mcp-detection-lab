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
 * CDP sourceURL / stack shape probe.
 * Automation-injected scripts often surface unexpected frames or a
 * "__puppeteer_evaluation_script__" / eval sourceURL in stack traces.
 */
export const cdpStackTrace: Detector = {
  test: "cdpStackTrace",
  label: "Injection stack-trace artifacts",
  category: "static",
  run: () => {
    const stack = new Error().stack || "";
    const markers = [
      "__puppeteer_evaluation_script__",
      "__playwright_evaluation_script__",
      "VM", // eval'd VM scripts frequently indicate remote evaluate()
      "evalmachine",
      "<anonymous>:1",
    ];
    const hit = markers.filter((m) => stack.includes(m));
    // Presence of eval/anonymous injection markers is suspicious but noisy → warn.
    if (hit.some((h) => h.includes("puppeteer") || h.includes("playwright") || h === "evalmachine")) {
      return result("cdpStackTrace", "fail", 80, { hit }, undefined, "static");
    }
    if (hit.length) {
      return result("cdpStackTrace", "warn", 25, { hit }, undefined, "static");
    }
    return result("cdpStackTrace", "pass", 0, {}, undefined, "static");
  },
};

/**
 * console.debug timing probe — under an attached debugger/CDP session the
 * serialization of a large object into the protocol is measurably slower.
 */
export const cdpConsoleTiming: Detector = {
  test: "cdpConsoleTiming",
  label: "console serialization timing",
  category: "static",
  run: () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 500; i++) big[`k${i}`] = i;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) console.debug(big);
    const dt = performance.now() - t0;
    // Heuristic threshold; heavy serialization to a CDP client is slower.
    if (dt > 25) return result("cdpConsoleTiming", "warn", 30, { ms: +dt.toFixed(2) }, undefined, "static");
    return result("cdpConsoleTiming", "pass", 0, { ms: +dt.toFixed(2) }, undefined, "static");
  },
};
