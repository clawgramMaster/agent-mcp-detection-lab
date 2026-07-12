import { type Detector, result } from "../../lib/detector";

/** WebGL vendor/renderer — software renderers (SwiftShader/llvmpipe) signal headless (FPScanner). */
export const webglVendor: Detector = {
  test: "webglVendor",
  label: "WebGL renderer (software?)",
  category: "static",
  run: () => {
    try {
      const canvas = document.createElement("canvas");
      const gl = (canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      if (!gl) return result("webglVendor", "warn", 40, { noWebGL: true }, undefined, "static");
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const ev = { vendor, renderer };
      const soft = /SwiftShader|llvmpipe|software|Google Inc\. \(Google\)|Mesa OffScreen/i;
      if (soft.test(String(vendor)) || soft.test(String(renderer))) {
        return result("webglVendor", "fail", 70, { ...ev, software: true }, undefined, "static");
      }
      return result("webglVendor", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("webglVendor", "warn", 20, { error: String(e) }, undefined, "static");
    }
  },
};
