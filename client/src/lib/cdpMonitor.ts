import type { TestResult } from "../../../shared/types";
import { automationGlobals } from "../detectors/static/automationGlobals";
import { exposeFunctionLeak } from "../detectors/static/exposeFunctionLeak";
import { webdriver } from "../detectors/static/webdriver";
import { type DetectorCtx, result } from "./detector";

/**
 * Temporal CDP monitor.
 *
 * A one-shot page-load scan misses the whole class of automation that only
 * enables CDP domains WHEN it acts: an MCP / Puppeteer / Playwright agent calls
 * `evaluate`, `console_messages`, `network_requests`, `snapshot`, `screenshot`
 * AFTER landing, and only then does Runtime.enable / Console.enable light up.
 *
 * This monitor runs continuously and re-emits three signals into their EXISTING
 * test ids (so the weighted noisy-OR still counts each once, worst-ever):
 *   - cdpRuntimeLeak    — console-arg serialization via an Error.stack getter
 *                         trap; fires the moment Runtime/Console.enable turns on;
 *   - automationGlobals — late-injected framework globals;
 *   - exposeFunctionLeak — bindings installed mid-session via exposeFunction.
 *
 * For a human (who never drives CDP) every tick stays green forever; for an agent
 * the Passive score flips red the instant it touches the page programmatically.
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
};

const RESCAN = [webdriver, automationGlobals, exposeFunctionLeak];

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
        : result("cdpRuntimeLeak", "pass", 0, { leaked: false, live: true }, "CDP Runtime.enable leak", "static"),
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
