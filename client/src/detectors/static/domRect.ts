import { type Detector, result } from "../../lib/detector";

/**
 * DOMRect fingerprint & coherence (CreepJS).
 *
 * getBoundingClientRect / getClientRects return sub-pixel float geometry that
 * varies by engine, OS, font stack and sub-pixel rendering. It is a strong
 * fingerprint surface, and two tells expose a broken/spoofed environment:
 *   - a transformed element whose rect is perfectly integer (no sub-pixel) — real
 *     Blink/Gecko produce fractional values under rotate/scale transforms;
 *   - NaN / all-zero rects where a laid-out element must have size.
 * Kept weak (some zoom levels legitimately snap to integers).
 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const domRect: Detector = {
  test: "domRect",
  label: "DOMRect geometry fingerprint",
  category: "static",
  run: () => {
    try {
      const host = document.createElement("div");
      host.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;width:100px;height:30px;transform:rotate(12.3deg) scale(1.7);font:16px serif;";
      host.textContent = "AgentMcpLab 0123";
      document.body.appendChild(host);

      const r = host.getBoundingClientRect();
      const rects = host.getClientRects();
      const vals = [r.x, r.y, r.width, r.height, r.top, r.left, r.right, r.bottom];
      host.remove();

      const ev: Record<string, unknown> = {
        rectHash: hash(vals.map((v) => v.toFixed(5)).join(",")),
        width: +r.width.toFixed(3),
        height: +r.height.toFixed(3),
        clientRects: rects.length,
      };
      let score = 0;

      // Laid-out element with a transform must have a non-zero, valid box.
      if (vals.some((v) => Number.isNaN(v)) || r.width === 0 || r.height === 0 || rects.length === 0) {
        ev.degenerateRect = true;
        score += 45;
      }
      // Under a rotate+scale transform, real engines yield sub-pixel floats.
      const allInteger = vals.every((v) => Number.isInteger(v));
      if (allInteger && score === 0) {
        ev.suspiciousIntegerRect = true;
        score += 25;
      }

      score = Math.min(100, score);
      const rating = score >= 45 ? "warn" : "pass";
      return result("domRect", rating, score, ev, undefined, "static");
    } catch (e) {
      return result("domRect", "warn", 10, { error: String(e) }, undefined, "static");
    }
  },
};
