import type { TestResult } from "../../../shared/types";
import { automationGlobals } from "../detectors/static/automationGlobals";
import { exposeFunctionLeak } from "../detectors/static/exposeFunctionLeak";
import { runtimeBindingLeak } from "../detectors/static/runtimeBindingLeak";
import { webdriver } from "../detectors/static/webdriver";
import { type DetectorCtx, result } from "./detector";

/**
 * Temporal CDP monitor.
 *
 * A one-shot page-load scan misses automation that installs framework globals
 * or Runtime bindings only when it acts. Re-scan the cheap deterministic
 * surfaces so those late traces are still observed.
 *
 * This monitor runs continuously and re-emits four signals into their EXISTING
 * test ids (so the weighted noisy-OR still counts each once, worst-ever):
 *   - cdpRuntimeLeak    — legacy console-arg Error.stack getter trap; positive
 *                         hits remain useful, while current V8 misses are inconclusive;
 *   - automationGlobals — late-injected framework globals;
 *   - exposeFunctionLeak — bindings installed mid-session via exposeFunction;
 *   - runtimeBindingLeak — anonymous native globals installed via
 *                          Runtime.addBinding by Runtime.enable-avoidance modes.
 *
 * Clean sessions remain non-failing; observable late artifacts upgrade their
 * existing result row without counting the same evidence twice.
 */
const EMPTY_CTX: DetectorCtx = {
  mouse: [],
  keys: [],
  keyups: [],
  scrolls: [],
  wheels: [],
  clicks: [],
  focusEvents: [],
  formShownAt: 0,
  submittedAt: 0,
  pasted: false,
  maxValueJump: 0,
};

const RESCAN = [webdriver, automationGlobals, exposeFunctionLeak, runtimeBindingLeak];

export interface CdpMonitorHandle {
  stop: () => void;
}

export function startCdpMonitor(emit: (r: TestResult) => void, intervalMs = 700): CdpMonitorHandle {
  let everSerialized = false;

  // Build a fresh Error whose `.stack` getter flips the flag when read. Under an
  // active CDP Runtime/Console domain, console.* serializes its arguments (which
  // reads .stack) out-of-band — something no normal browser does on its own.
  const arm = (): Error => {
    const e = new Error("cdp-probe");
    Object.defineProperty(e, "stack", {
      configurable: true,
      get() {
        everSerialized = true;
        return "";
      },
    });
    return e;
  };

  const tick = () => {
    try {
      console.debug(arm());
    } catch {
      /* */
    }
    emit(
      everSerialized
        ? result(
            "cdpRuntimeLeak",
            "fail",
            95,
            { leaked: true, live: true, note: "Runtime/Console.enable observed after page load" },
            "CDP Runtime.enable leak",
            "static",
          )
        : result(
            "cdpRuntimeLeak",
            "inconclusive",
            0,
            { leaked: false, live: true, reason: "Error preview getters are guarded by current V8" },
            "CDP Runtime.enable leak",
            "static",
          ),
    );

    // Re-scan cheap synchronous surfaces for late injection.
    for (const d of RESCAN) {
      try {
        const r = d.run(EMPTY_CTX);
        if (!(r instanceof Promise)) {
          r.label = d.label; // preserve the friendly name on live-upgraded rows
          emit(r);
        }
      } catch {
        /* */
      }
    }
  };

  const id = window.setInterval(tick, intervalMs);
  tick();
  return { stop: () => window.clearInterval(id) };
}
