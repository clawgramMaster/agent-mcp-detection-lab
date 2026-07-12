import { type Detector, result } from "../../lib/detector";

/**
 * Prototype "lies" — automation frameworks patch native functions to hide
 * themselves. A patched function's toString no longer reports "[native code]"
 * or the function's name/length is inconsistent (CreepJS technique).
 */
export const prototypeLies: Detector = {
  test: "prototypeLies",
  label: "Native function tampering",
  category: "static",
  run: () => {
    const lies: string[] = [];

    const checkNative = (fn: unknown, name: string) => {
      if (typeof fn !== "function") return;
      const s = Function.prototype.toString.call(fn);
      if (!s.includes("[native code]")) lies.push(`${name}: not native (${s.slice(0, 40)})`);
    };

    // Commonly patched by stealth plugins:
    checkNative((navigator as any).permissions?.query, "permissions.query");
    checkNative(Function.prototype.toString, "Function.toString");
    checkNative((HTMLCanvasElement.prototype as any).toDataURL, "canvas.toDataURL");
    checkNative((WebGLRenderingContext.prototype as any).getParameter, "webgl.getParameter");
    checkNative((navigator as any).mediaDevices?.enumerateDevices, "enumerateDevices");
    checkNative((Notification as any)?.requestPermission, "Notification.requestPermission");

    // toString of toString itself must be native, else the whole detection is spoofed.
    try {
      const tt = Function.prototype.toString.call(Function.prototype.toString);
      if (!tt.includes("[native code]")) lies.push("toString.toString spoofed");
    } catch {
      lies.push("toString threw");
    }

    if (lies.length >= 2) return result("prototypeLies", "fail", 70, { lies }, undefined, "static");
    if (lies.length === 1) return result("prototypeLies", "warn", 35, { lies }, undefined, "static");
    return result("prototypeLies", "pass", 0, {}, undefined, "static");
  },
};
