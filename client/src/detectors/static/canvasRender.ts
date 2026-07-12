import { type Detector, result } from "../../lib/detector";

/**
 * Canvas 2D render integrity (CreepJS / FPScanner TRANSPARENT_PIXEL).
 *
 * A real GPU-backed browser renders text + shapes to a 2D canvas and produces a
 * stable, non-empty raster. Headless/GPU-disabled or anti-fingerprint tooling
 * shows two tells:
 *   - a blank / all-transparent canvas (nothing actually rasterized), or
 *   - toDataURL that is broken / throws / returns a trivial data URI.
 * Also emits a canvas hash as a fingerprint surface. Kept moderate — some
 * privacy browsers legitimately add canvas noise, so we only flag *empty* output.
 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const canvasRender: Detector = {
  test: "canvasRender",
  label: "Canvas 2D render integrity",
  category: "static",
  run: () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 220;
      canvas.height = 60;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return result("canvasRender", "warn", 30, { no2dContext: true }, undefined, "static");
      }
      ctx.textBaseline = "top";
      ctx.font = "16px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(2, 2, 120, 24);
      ctx.fillStyle = "#069";
      ctx.fillText("AgentMcpLab \u{1F916}", 4, 30);
      ctx.strokeStyle = "rgba(0,120,200,0.6)";
      ctx.beginPath();
      ctx.arc(180, 30, 18, 0, Math.PI * 2);
      ctx.stroke();

      // Count non-transparent pixels — a truly rendered canvas has many.
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0;
      for (let i = 3; i < img.length; i += 4) {
        if (img[i] !== 0) opaque++;
      }
      const total = img.length / 4;
      const ratio = opaque / total;

      let url = "";
      try {
        url = canvas.toDataURL();
      } catch (e) {
        return result("canvasRender", "fail", 60, { toDataURLThrew: String(e) }, undefined, "static");
      }

      const ev: Record<string, unknown> = {
        opaqueRatio: +ratio.toFixed(3),
        canvasHash: hash(url),
        dataUrlLen: url.length,
      };

      // Almost nothing drawn, or a suspiciously tiny data URL → render failed.
      if (ratio < 0.02 || url.length < 120) {
        return result("canvasRender", "fail", 60, { ...ev, blankCanvas: true }, undefined, "static");
      }
      return result("canvasRender", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("canvasRender", "warn", 10, { error: String(e) }, undefined, "static");
    }
  },
};
