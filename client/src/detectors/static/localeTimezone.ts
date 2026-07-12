import { type Detector, result } from "../../lib/detector";

/**
 * Locale / timezone coherence.
 * Headless browsers and datacenter/CI environments very often run in the "UTC"
 * timezone, and their language, timezone and JS-runtime timezone offset should
 * agree. A UTC timezone (rare for real desktop users) or a mismatch between the
 * IANA timezone and the actual Date offset is a suggestive automation signal.
 * Kept weak (real users in UK/Portugal/Iceland can legitimately be UTC).
 */
export const localeTimezone: Detector = {
  test: "localeTimezone",
  label: "Locale / timezone coherence",
  category: "static",
  run: () => {
    const ev: Record<string, unknown> = {};
    let score = 0;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const lang = navigator.language || "";
      const langs = navigator.languages || [];
      ev.timeZone = tz;
      ev.language = lang;
      ev.languages = langs;

      // datacenter default
      if (tz === "UTC" || tz === "Etc/UTC" || tz === "") {
        ev.utcTimezone = true;
        score += 20;
      }
      // NOTE: empty navigator.languages is intentionally NOT scored here —
      // `headlessSignals` owns that tell (avoids double-counting under noisy-OR).
      // IANA timezone vs actual runtime offset sanity: resolve the offset the
      // timezone should have and compare with Date's real offset.
      try {
        const now = new Date();
        const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit" }).format(now);
        const utcHour = now.getUTCHours();
        const localHour = Number.parseInt(local, 10) % 24;
        // derive tz offset in hours (rough), compare to getTimezoneOffset
        let tzOffset = localHour - utcHour;
        if (tzOffset > 12) tzOffset -= 24;
        if (tzOffset < -12) tzOffset += 24;
        const realOffset = -now.getTimezoneOffset() / 60;
        ev.tzOffsetFromIana = tzOffset;
        ev.realOffset = realOffset;
        if (Math.abs(tzOffset - realOffset) >= 2) {
          ev.offsetMismatch = true;
          score += 40;
        }
      } catch {
        /* offset check best-effort */
      }
    } catch (e) {
      return result("localeTimezone", "warn", 10, { error: String(e) }, undefined, "static");
    }
    score = Math.min(100, score);
    const rating = score >= 50 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("localeTimezone", rating, score, ev, undefined, "static");
  },
};
