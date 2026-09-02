import { type Detector, result } from "../../lib/detector";

export interface RuntimeBindingCandidate {
  property: string;
  source: string;
  functionName: string;
  functionLength: number;
  configurable: boolean;
  enumerable: boolean;
  writable: boolean;
}

const RANDOM_BINDING_NAME = /^[a-z0-9]{10,20}$/;
const NATIVE_ANONYMOUS_FUNCTION = "function () { [native code] }";

/** Exported for deterministic unit tests without browser globals. */
export function evaluateRuntimeBindingCandidates(candidates: RuntimeBindingCandidate[] | null) {
  if (!candidates) {
    return result(
      "runtimeBindingLeak",
      "inconclusive",
      0,
      { reason: "window properties could not be inspected" },
      undefined,
      "static",
    );
  }
  const bindings = candidates
    .filter(
      (candidate) =>
        RANDOM_BINDING_NAME.test(candidate.property) &&
        candidate.source === NATIVE_ANONYMOUS_FUNCTION &&
        candidate.functionName === "" &&
        candidate.functionLength === 0 &&
        candidate.configurable &&
        candidate.enumerable &&
        candidate.writable,
    )
    .map((candidate) => candidate.property);

  if (bindings.length) {
    return result(
      "runtimeBindingLeak",
      "fail",
      85,
      { bindings, signature: "anonymous mutable native global" },
      undefined,
      "static",
    );
  }
  return result("runtimeBindingLeak", "pass", 0, { bindings: [] }, undefined, "static");
}

/**
 * Runtime.addBinding leak.
 *
 * Rebrowser's default Runtime.enable avoidance obtains execution-context ids by
 * installing a randomly named Runtime.addBinding callback. Chromium exposes the
 * callback as an anonymous native function on every global with a mutable,
 * enumerable own-property descriptor. Ordinary native window functions are
 * named and non-enumerable; ordinary application globals stringify as JS.
 */
export const runtimeBindingLeak: Detector = {
  test: "runtimeBindingLeak",
  label: "CDP Runtime.addBinding leak",
  category: "static",
  run: () => {
    const candidates: RuntimeBindingCandidate[] = [];
    try {
      const fnToString = Function.prototype.toString;
      for (const property of Object.getOwnPropertyNames(window)) {
        if (!RANDOM_BINDING_NAME.test(property)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(window, property);
        const value = descriptor?.value;
        if (!descriptor || typeof value !== "function") continue;

        candidates.push({
          property,
          source: fnToString.call(value),
          functionName: value.name,
          functionLength: value.length,
          configurable: descriptor.configurable ?? false,
          enumerable: descriptor.enumerable ?? false,
          writable: descriptor.writable ?? false,
        });
      }
    } catch {
      return evaluateRuntimeBindingCandidates(null);
    }
    return evaluateRuntimeBindingCandidates(candidates);
  },
};
