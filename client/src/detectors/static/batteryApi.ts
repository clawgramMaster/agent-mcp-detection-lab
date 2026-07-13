import { type Detector, result } from "../../lib/detector";

/**
 * Battery Status API coherence (FPScanner CHR_BATTERY).
 *
 * Desktop Chrome/Chromium exposes navigator.getBattery(). Its absence on a
 * Chrome-claiming UA is a headless/automation tell, and impossible values
 * (charging=false + level=1 + no discharge time, or level outside 0..1) reveal
 * a spoofed environment. Weak signal — Firefox/Safari legitimately lack it, so
 * we only fire when the UA claims Chromium.
 */
export const batteryApi: Detector = {
  test: "batteryApi",
  label: "Battery Status API coherence",
  category: "static",
  run: async () => {
    const ua = navigator.userAgent;
    const claimsChromium = /Chrome\/\d+/.test(ua) && !/Edg\/|OPR\//.test(ua);
    const getBattery = (navigator as unknown as { getBattery?: () => Promise<unknown> }).getBattery;

    if (typeof getBattery !== "function") {
      // Only suspicious when the UA claims desktop Chromium (which always has it).
      const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
      if (claimsChromium && !mobile) {
        return result("batteryApi", "warn", 30, { missingOnChrome: true }, undefined, "static");
      }
      return result("batteryApi", "pass", 0, { present: false }, undefined, "static");
    }

    try {
      const b = (await getBattery.call(navigator)) as {
        charging: boolean;
        level: number;
        chargingTime: number;
        dischargingTime: number;
      };
      const ev: Record<string, unknown> = {
        charging: b.charging,
        level: b.level,
        chargingTime: b.chargingTime,
        dischargingTime: b.dischargingTime,
      };
      let score = 0;
      if (typeof b.level !== "number" || b.level < 0 || b.level > 1) {
        ev.badLevel = true;
        score += 40;
      }
      // Headless default: charging true, level 1, both times Infinity/0.
      if (
        b.charging === true &&
        b.level === 1 &&
        b.chargingTime === 0 &&
        b.dischargingTime === Number.POSITIVE_INFINITY
      ) {
        ev.defaultFullCharged = true;
        score += 15; // very common on real plugged-in desktops too → weak
      }
      score = Math.min(100, score);
      const rating = score >= 40 ? "warn" : "pass";
      return result("batteryApi", rating, score, ev, undefined, "static");
    } catch (e) {
      return result("batteryApi", "warn", 10, { error: String(e) }, undefined, "static");
    }
  },
};
