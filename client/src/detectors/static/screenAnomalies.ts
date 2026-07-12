import { type Detector, result } from "../../lib/detector";

/**
 * Screen / viewport anomalies (Headless-Detector, Bot-Incolumitas).
 * Headless browsers frequently expose contradictory geometry: zero outer
 * dimensions, screen === viewport (no browser chrome), availWidth > width,
 * fractional/1 devicePixelRatio mismatches, or the classic 800x600 default.
 */
export const screenAnomalies: Detector = {
  test: "screenAnomalies",
  label: "Screen / viewport geometry",
  category: "static",
  run: () => {
    const ev: Record<string, unknown> = {};
    let score = 0;

    const { width, height, availWidth, availHeight, colorDepth, pixelDepth } = screen;
    ev.screen = { width, height, availWidth, availHeight, colorDepth, pixelDepth };
    ev.window = {
      innerWidth: innerWidth,
      innerHeight: innerHeight,
      outerWidth: outerWidth,
      outerHeight: outerHeight,
      dpr: devicePixelRatio,
    };

    if (outerWidth === 0 || outerHeight === 0) {
      ev.zeroOuter = true;
      score += 30;
    }
    // Real windows: outer >= inner (chrome/toolbars). Equal is common headless.
    if (outerHeight !== 0 && outerHeight === innerHeight && outerWidth === innerWidth) {
      ev.noChrome = true;
      score += 15;
    }
    if (availWidth > width || availHeight > height) {
      ev.availExceedsScreen = true;
      score += 30;
    }
    if (colorDepth < 24 || pixelDepth < 24) {
      ev.lowColorDepth = true;
      score += 20;
    }
    // Automation default viewports (Rebrowser): Puppeteer 800x600, Playwright 1280x720.
    if (width === 800 && height === 600) {
      ev.default800x600 = true;
      score += 40;
    }
    if (innerWidth === 1280 && innerHeight === 720) {
      ev.playwrightViewport = true;
      score += 30;
    }
    if (width === 0 || height === 0) {
      ev.zeroScreen = true;
      score += 40;
    }
    // Non-standard devicePixelRatio (e.g. exactly 0)
    if (!devicePixelRatio || devicePixelRatio <= 0) {
      ev.badDpr = true;
      score += 20;
    }

    score = Math.min(100, score);
    const rating = score >= 50 ? "fail" : score >= 20 ? "warn" : "pass";
    return result("screenAnomalies", rating, score, ev, undefined, "static");
  },
};
