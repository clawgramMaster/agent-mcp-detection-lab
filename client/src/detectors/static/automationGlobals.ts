import { type Detector, result } from "../../lib/detector";

/**
 * Automation framework globals (Rebrowser / deviceandbrowserinfo).
 * Playwright, Selenium, Puppeteer, PhantomJS, Nightmare, Sequentum and friends
 * leave detectable properties on window / document / documentElement.
 */
const WINDOW_MARKERS: string[] = [
  // Playwright
  "__playwright",
  "__pw_manual",
  "__PW_inspect",
  "__playwright_target__",
  "__pwInitScripts",
  // Puppeteer
  "__puppeteer",
  "__PUPPETEER__",
  // Selenium / WebDriver
  "_Selenium_IDE_Recorder",
  "__selenium_evaluate",
  "__webdriver_evaluate",
  "__driver_evaluate",
  "__webdriver_script_function",
  "__webdriver_script_func",
  "__webdriver_script_fn",
  "__fxdriver_evaluate",
  "__driver_unwrapped",
  "__webdriver_unwrapped",
  "__selenium_unwrapped",
  "__fxdriver_unwrapped",
  "webdriver",
  "domAutomation",
  "domAutomationController",
  // Headless / scraping tools
  "callPhantom",
  "_phantom",
  "phantom",
  "__nightmare",
  "nightmare",
  "Sequentum",
  "SequentumInputData",
  "awesomium",
  "fmget_targets",
  "geb",
  "watinExpressionResult",
  "spawn",
  "emit",
];

const DOC_MARKERS: string[] = [
  "$cdc_asdjflasutopfhvcZLmcfl_", // ChromeDriver
  "$chrome_asyncScriptInfo",
  "__$webdriverAsyncExecutor",
  "__webdriver_script_fn",
  "__selenium_unwrapped",
  "__webdriver_evaluate",
  "__driver_evaluate",
  "__fxdriver_evaluate",
];

const ATTR_MARKERS: string[] = ["webdriver", "selenium", "driver"];

export const automationGlobals: Detector = {
  test: "automationGlobals",
  label: "Automation framework globals",
  category: "static",
  run: () => {
    const hits: string[] = [];

    for (const k of WINDOW_MARKERS) {
      try {
        if (k in window && (window as any)[k] !== undefined && (window as any)[k] !== false) hits.push(`window.${k}`);
      } catch {
        /* access can throw on some proxies → itself suspicious, ignore */
      }
    }
    for (const k of DOC_MARKERS) {
      try {
        if (k in document || (document as any)[k] !== undefined) hits.push(`document.${k}`);
      } catch {
        /* */
      }
    }
    for (const a of ATTR_MARKERS) {
      try {
        if (document.documentElement.getAttribute(a) !== null) hits.push(`html[${a}]`);
      } catch {
        /* */
      }
    }
    // Scan window keys for playwright/puppeteer/selenium substrings we may have missed.
    try {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (/^(_+)?(playwright|puppeteer|selenium|cdc_|driver_|webdriver)/i.test(k) && !hits.includes(`window.${k}`)) {
          hits.push(`window.${k}`);
        }
      }
    } catch {
      /* */
    }

    // navigator.webdriver is handled by its own detector; only count strong globals here.
    const strong = hits.filter((h) => h !== "window.webdriver");
    if (strong.length >= 1) {
      return result(
        "automationGlobals",
        "fail",
        Math.min(100, 70 + strong.length * 10),
        { hits: strong },
        undefined,
        "static",
      );
    }
    return result("automationGlobals", "pass", 0, { hits }, undefined, "static");
  },
};
