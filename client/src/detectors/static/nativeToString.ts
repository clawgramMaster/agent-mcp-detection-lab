import { type Detector, result } from "../../lib/detector";

/**
 * Native function integrity (Rebrowser / CreepJS / FPScanner).
 *
 * The single most reliable tell against "stealth" automation
 * (puppeteer-extra-stealth, patchright, playwright patches): to hide
 * navigator.webdriver, plugins, permissions, WebGL vendor etc. these tools
 * REDEFINE native browser functions/getters with JavaScript. A genuine native
 * function stringifies to "function x() { [native code] }"; a patched one leaks
 * its JS body, an anonymous name, or a Proxy. We probe a set of functions that
 * MUST be native in every real browser and flag any that isn't.
 */
const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

export const nativeToString: Detector = {
  test: "nativeToString",
  label: "Native function integrity",
  category: "static",
  run: () => {
    const ev: Record<string, unknown> = {};
    const tampered: string[] = [];
    let score = 0;

    // Grab a pristine reference to Function.prototype.toString itself.
    const fnToString = Function.prototype.toString;

    // toString must itself be native — if patched, everything below is unreliable
    // AND that patching is itself the tell.
    try {
      if (!NATIVE_RE.test(fnToString.call(fnToString))) {
        tampered.push("Function.prototype.toString");
        score += 60;
      }
    } catch {
      tampered.push("Function.prototype.toString(threw)");
      score += 60;
    }

    // Functions/getters that are native in every real browser.
    const targets: [string, unknown][] = [
      ["navigator.permissions.query", navigator.permissions?.query],
      ["HTMLCanvasElement.toDataURL", HTMLCanvasElement.prototype.toDataURL],
      ["navigator.mediaDevices.enumerateDevices", navigator.mediaDevices?.enumerateDevices],
      ["navigator.plugins.item", navigator.plugins?.item],
      ["Object.getOwnPropertyDescriptor", Object.getOwnPropertyDescriptor],
      [
        "WebGLRenderingContext.getParameter",
        (window as { WebGLRenderingContext?: { prototype: { getParameter: unknown } } }).WebGLRenderingContext
          ?.prototype?.getParameter,
      ],
    ];

    for (const [name, fn] of targets) {
      if (typeof fn !== "function") continue; // API absent → not this detector's job
      try {
        const src = fnToString.call(fn);
        if (!NATIVE_RE.test(src)) {
          tampered.push(name);
          score += 40;
        }
      } catch {
        // toString throwing on a function is itself abnormal (Proxy trap).
        tampered.push(`${name}(threw)`);
        score += 40;
      }
    }

    // navigator.webdriver getter: if defined, its accessor must be native.
    try {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "webdriver");
      if (desc?.get) {
        const src = fnToString.call(desc.get);
        ev.webdriverGetterNative = NATIVE_RE.test(src);
        if (!NATIVE_RE.test(src)) {
          tampered.push("Navigator.webdriver getter");
          score += 50;
        }
      }
    } catch {
      /* best effort */
    }

    if (tampered.length) ev.tampered = tampered;
    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("nativeToString", rating, score, ev, undefined, "static");
  },
};
