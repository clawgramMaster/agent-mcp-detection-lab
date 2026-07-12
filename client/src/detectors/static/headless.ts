import { type Detector, result } from "../../lib/detector";

/** Headless / automation signals bundle (Headless-Detector, BotD). */
export const headlessSignals: Detector = {
  test: "headlessSignals",
  label: "Headless browser signals",
  category: "static",
  run: () => {
    const ua = navigator.userAgent;
    const ev: Record<string, unknown> = {};
    let score = 0;

    if (/HeadlessChrome/i.test(ua)) {
      ev.headlessUA = true;
      score += 90;
    }

    // Real Chrome exposes window.chrome; headless/automation often lacks depth.
    const chrome = (window as any).chrome;
    if (typeof chrome === "undefined") {
      ev.noWindowChrome = true;
      score += 25;
    } else if (!chrome.runtime && !chrome.loadTimes) {
      ev.shallowChrome = true;
      score += 15;
    }

    // languages must be a non-empty array on real browsers.
    if (!navigator.languages || navigator.languages.length === 0) {
      ev.noLanguages = true;
      score += 30;
    }

    // Plugins/mimeTypes are empty in many headless contexts.
    if (navigator.plugins.length === 0) {
      ev.noPlugins = true;
      score += 10;
    }

    // hardwareConcurrency / deviceMemory absurd values.
    if ((navigator as any).hardwareConcurrency === 0) {
      ev.zeroCores = true;
      score += 20;
    }

    // outerHeight/Width == 0 is typical of headless with no chrome UI.
    if (window.outerHeight === 0 || window.outerWidth === 0) {
      ev.zeroOuter = true;
      score += 20;
    }

    // userAgentData brand list should include a Chromium/Chrome brand.
    const uaData = (navigator as any).userAgentData;
    if (uaData && Array.isArray(uaData.brands)) {
      const brands = uaData.brands.map((b: any) => b.brand).join(",");
      ev.brands = brands;
      if (/HeadlessChrome/i.test(brands)) {
        ev.headlessBrand = true;
        score += 60;
      }
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 20 ? "warn" : "pass";
    return result("headlessSignals", rating, score, ev, undefined, "static");
  },
};
