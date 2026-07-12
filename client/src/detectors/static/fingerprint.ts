import { type Detector, result } from "../../lib/detector";

/** Cheap 32-bit hash for fingerprint surfaces. */
function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Browser fingerprint surfaces (FingerprintJS-style, informational).
 * This is a stable identity signal rather than a bot verdict — rating is
 * always "pass" but the evidence feeds cross-runner comparison in /report.
 */
export const fingerprint: Detector = {
  test: "fingerprint",
  label: "Browser fingerprint",
  category: "static",
  run: () => {
    const ev: Record<string, unknown> = {};

    // Canvas
    try {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 60;
      const ctx = c.getContext("2d")!;
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(2, 2, 120, 30);
      ctx.fillStyle = "#069";
      ctx.fillText("AgentMcpLab \u{1F916}", 4, 4);
      ctx.fillStyle = "rgba(102,204,0,0.7)";
      ctx.fillText("AgentMcpLab \u{1F916}", 6, 6);
      ev.canvasHash = hash(c.toDataURL());
    } catch (e) {
      ev.canvasError = String(e);
    }

    // WebGL params hash
    try {
      const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null;
      if (gl) {
        const params = [
          gl.getParameter(gl.MAX_TEXTURE_SIZE),
          gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
          gl.getSupportedExtensions()?.join(","),
        ];
        ev.webglHash = hash(params.join("|"));
      }
    } catch (e) {
      ev.webglError = String(e);
    }

    // Audio fingerprint (offline oscillator sum)
    // (kept lightweight & synchronous-ish; skipped if unavailable)
    ev.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ev.languages = navigator.languages;
    ev.platform = navigator.platform;
    ev.cores = navigator.hardwareConcurrency;
    ev.deviceMemory = (navigator as any).deviceMemory;
    ev.screen = { w: screen.width, h: screen.height, d: screen.colorDepth, dpr: devicePixelRatio };
    ev.touch = navigator.maxTouchPoints;

    const composite = hash(JSON.stringify(ev));
    ev.compositeHash = composite;

    return result("fingerprint", "pass", 0, ev, undefined, "static");
  },
};
