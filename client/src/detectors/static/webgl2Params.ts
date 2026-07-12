import { type Detector, result } from "../../lib/detector";

/**
 * WebGL2 deep parameters (CreepJS / BrowserLeaks).
 * Modern Chrome/Firefox ship WebGL2. Headless or GPU-disabled automation often
 * either lacks a WebGL2 context or falls back to a software renderer
 * (SwiftShader / llvmpipe / Mesa). Also emits a params+extensions hash as a
 * stable fingerprint surface.
 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const webgl2Params: Detector = {
  test: "webgl2Params",
  label: "WebGL2 parameters",
  category: "static",
  run: () => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      const claimsModernChrome = /Chrome\/\d+/.test(navigator.userAgent);
      if (!gl) {
        // No WebGL2 on a modern Chrome UA is unusual (headless/--disable-gpu).
        return result(
          "webgl2Params",
          claimsModernChrome ? "warn" : "pass",
          claimsModernChrome ? 30 : 0,
          { noWebGL2: true },
          undefined,
          "static",
        );
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const params = [
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_DRAW_BUFFERS),
        gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS),
        gl.getSupportedExtensions()?.join(","),
      ];
      const ev: Record<string, unknown> = { vendor, renderer, paramsHash: hash(params.join("|")) };

      const soft = /SwiftShader|llvmpipe|software|Mesa OffScreen|Google Inc\. \(Google\)/i;
      if (soft.test(String(vendor)) || soft.test(String(renderer))) {
        return result("webgl2Params", "fail", 65, { ...ev, software: true }, undefined, "static");
      }
      return result("webgl2Params", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("webgl2Params", "warn", 10, { error: String(e) }, undefined, "static");
    }
  },
};
