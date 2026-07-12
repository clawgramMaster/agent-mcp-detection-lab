import { type Detector, result } from "../../lib/detector";

/** navigator.webdriver — the classic automation flag (FPScanner). */
export const webdriver: Detector = {
  test: "webdriver",
  label: "navigator.webdriver flag",
  category: "static",
  run: () => {
    const flag = (navigator as any).webdriver;
    // Also check the property descriptor: real Chrome defines it on the prototype.
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "webdriver");
    const spoofedOnInstance = Object.prototype.hasOwnProperty.call(navigator, "webdriver");
    if (flag === true) {
      return result("webdriver", "fail", 100, { webdriver: true }, undefined, "static");
    }
    if (spoofedOnInstance) {
      // webdriver deleted/redefined on the instance → tampering signal
      return result("webdriver", "warn", 40, { spoofedOnInstance: true, hasProtoDesc: !!desc }, undefined, "static");
    }
    return result("webdriver", "pass", 0, { webdriver: flag ?? false }, undefined, "static");
  },
};
