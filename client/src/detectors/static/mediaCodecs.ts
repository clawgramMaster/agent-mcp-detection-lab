import { type Detector, result } from "../../lib/detector";

/**
 * Media codec support (FingerprintJS BotD).
 * Real Google Chrome ships proprietary codecs (H.264/AVC, AAC). Open-source
 * Chromium builds — including the "Chrome for Testing" / bundled Chromium that
 * Playwright & Puppeteer drive, and most headless containers — do NOT. So a UA
 * that claims to be *Google Chrome* while reporting no H.264/AAC is a strong
 * automation tell. Legit third-party Chromium (Brave, Linux chromium) is only
 * mildly flagged since it genuinely lacks these.
 */
export const mediaCodecs: Detector = {
  test: "mediaCodecs",
  label: "Proprietary media codecs",
  category: "static",
  run: () => {
    try {
      const v = document.createElement("video");
      const a = document.createElement("audio");
      const h264 = v.canPlayType('video/mp4; codecs="avc1.42E01E"');
      const aac = a.canPlayType('audio/mp4; codecs="mp4a.40.2"');
      const mp3 = a.canPlayType("audio/mpeg");
      const ev: Record<string, unknown> = { h264, aac, mp3 };

      const ua = navigator.userAgent;
      const claimsGoogleChrome = /Chrome\/\d+/.test(ua) && !/Chromium|Edg\/|OPR\/|Brave/i.test(ua);
      const missing = !h264 || !aac;
      ev.claimsGoogleChrome = claimsGoogleChrome;

      if (missing && claimsGoogleChrome) {
        // Real Chrome always has these → this is bundled Chromium pretending to be Chrome.
        return result("mediaCodecs", "fail", 65, { ...ev, contradiction: true }, undefined, "static");
      }
      if (missing) {
        return result("mediaCodecs", "warn", 25, ev, undefined, "static");
      }
      return result("mediaCodecs", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("mediaCodecs", "warn", 10, { error: String(e) }, undefined, "static");
    }
  },
};
