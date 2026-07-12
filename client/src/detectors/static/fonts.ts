import { type Detector, result } from "../../lib/detector";

/**
 * Font enumeration (CreepJS).
 * Measures text width for a set of probe fonts against fallback baselines.
 * A real OS exposes a rich, platform-consistent font set; headless/minimal
 * containers detect very few fonts. Also an entropy source for fingerprinting.
 */
const BASE_FONTS = ["monospace", "sans-serif", "serif"];
const PROBE_FONTS = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Impact",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Menlo",
  "Monaco",
  "Roboto",
  "Ubuntu",
  "Noto Sans",
  "Apple Color Emoji",
  "MS Gothic",
];

export const fonts: Detector = {
  test: "fonts",
  label: "Installed fonts",
  category: "static",
  run: () => {
    try {
      const text = "mmmmmmmmmmlli";
      const size = "72px";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return result("fonts", "warn", 20, { noCanvas2d: true }, undefined, "static");

      const measure = (font: string) => {
        ctx.font = `${size} ${font}`;
        return ctx.measureText(text).width;
      };
      const baseline: Record<string, number> = {};
      for (const b of BASE_FONTS) baseline[b] = measure(b);

      const detected: string[] = [];
      for (const f of PROBE_FONTS) {
        let found = false;
        for (const b of BASE_FONTS) {
          if (measure(`'${f}',${b}`) !== baseline[b]) {
            found = true;
            break;
          }
        }
        if (found) detected.push(f);
      }

      const ev = { detectedCount: detected.length, detected };
      // Very few detected fonts is a headless/container signal.
      if (detected.length <= 2) return result("fonts", "warn", 45, { ...ev, tooFew: true }, undefined, "static");
      return result("fonts", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("fonts", "warn", 20, { error: String(e) }, undefined, "static");
    }
  },
};
