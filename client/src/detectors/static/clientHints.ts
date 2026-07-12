import { type Detector, result } from "../../lib/detector";

/**
 * Client Hints (UA-CH) inconsistency (deviceandbrowserinfo).
 * The high-entropy userAgentData platform must agree with the classic UA string
 * and navigator.platform. Automation that spoofs one surface but not the other
 * produces contradictions (e.g. UA says Windows, platform says Linux).
 */
export const clientHints: Detector = {
  test: "clientHints",
  label: "Client Hints (UA-CH) consistency",
  category: "static",
  run: async () => {
    const ua = navigator.userAgent;
    const legacyPlatform = navigator.platform || "";
    const uaData = (navigator as any).userAgentData;
    const ev: Record<string, unknown> = { ua, legacyPlatform };
    let score = 0;

    // Infer OS family from the classic UA string.
    const uaOS = /Windows/i.test(ua)
      ? "Windows"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : /iPhone|iPad|iOS/i.test(ua)
              ? "iOS"
              : "unknown";
    ev.uaOS = uaOS;

    // Chromium exposes userAgentData; its absence on a Chrome-claiming UA is odd.
    const claimsChromium = /Chrome\/\d+/i.test(ua) && !/Edg\/|OPR\//i.test(ua);
    if (claimsChromium && !uaData) {
      ev.missingUAData = true;
      score += 40;
    }

    if (uaData) {
      try {
        const high = await uaData.getHighEntropyValues(["platform", "platformVersion", "architecture", "model"]);
        ev.chPlatform = high.platform;
        ev.chArch = high.architecture;
        // Compare CH platform with UA-derived OS.
        const map: Record<string, string> = { Windows: "Windows", macOS: "macOS", Linux: "Linux", Android: "Android" };
        if (uaOS !== "unknown" && map[uaOS] && high.platform && high.platform !== map[uaOS]) {
          ev.platformMismatch = { uaOS, chPlatform: high.platform };
          score += 60;
        }
      } catch (e) {
        ev.chError = String(e);
      }
    }

    // Legacy platform vs UA OS (Win32/MacIntel/Linux x86_64 ...).
    const legOS = /Win/i.test(legacyPlatform)
      ? "Windows"
      : /Mac/i.test(legacyPlatform)
        ? "macOS"
        : /Linux|X11/i.test(legacyPlatform)
          ? "Linux"
          : /Android/i.test(legacyPlatform)
            ? "Android"
            : "unknown";
    if (uaOS !== "unknown" && legOS !== "unknown" && uaOS !== legOS) {
      ev.legacyMismatch = { uaOS, legOS };
      score += 50;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("clientHints", rating, score, ev, undefined, "static");
  },
};
