import { type Detector, result } from "../../lib/detector";

export interface ConsoleTimingSample {
  primitiveMs: number;
  objectMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Exported for deterministic unit tests without browser globals. */
export function evaluateConsoleTiming(samples: ConsoleTimingSample[]) {
  const valid = samples.filter(
    ({ primitiveMs, objectMs }) =>
      Number.isFinite(primitiveMs) && Number.isFinite(objectMs) && primitiveMs > 0 && objectMs > 0,
  );
  if (valid.length < 5) {
    return result(
      "cdpConsoleTiming",
      "inconclusive",
      0,
      { validSamples: valid.length, reason: "timer resolution or scheduling noise" },
      undefined,
      "static",
    );
  }

  const primitiveMedianMs = median(valid.map((sample) => sample.primitiveMs));
  const objectMedianMs = median(valid.map((sample) => sample.objectMs));
  const ratio = objectMedianMs / primitiveMedianMs;
  const evidence = {
    samples: valid.length,
    primitiveMedianMs: +primitiveMedianMs.toFixed(3),
    objectMedianMs: +objectMedianMs.toFixed(3),
    objectToPrimitiveRatio: +ratio.toFixed(3),
  };

  // Runtime.enable previews object arguments but does little work for primitives.
  // Keep this contextual: a human with DevTools open activates the same path.
  if (objectMedianMs >= 1 && ratio >= 2) {
    return result("cdpConsoleTiming", "warn", 25, evidence, undefined, "static");
  }
  return result("cdpConsoleTiming", "pass", 0, evidence, undefined, "static");
}

function collectConsoleTiming(rounds = 7, iterations = 240): ConsoleTimingSample[] {
  const samples: ConsoleTimingSample[] = [];
  const emit = console.groupEnd as (...data: unknown[]) => void;
  const measure = (value: unknown) => {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index++) emit.call(console, value);
    return performance.now() - startedAt;
  };

  // groupEnd accepts extra JS arguments and the CDP backend still serializes
  // them, without filling a human's console with thousands of visible rows.
  for (let round = 0; round < rounds; round++) {
    const objectValue = { marker: "cdp-timing", values: [1, 2, 3] };
    if (round % 2 === 0) {
      samples.push({ primitiveMs: measure(1), objectMs: measure(objectValue) });
    } else {
      const objectMs = measure(objectValue);
      samples.push({ primitiveMs: measure(1), objectMs });
    }
  }
  return samples;
}

/**
 * Runtime.enable console-preview timing side channel.
 * Object arguments require a CDP preview while primitive arguments do not. The
 * within-round ratio calibrates out most CPU-speed differences, but scheduling
 * and a human-opened DevTools window remain confounders, so this never fails.
 */
export const cdpConsoleTiming: Detector = {
  test: "cdpConsoleTiming",
  label: "CDP console serialization timing",
  category: "static",
  run: () => {
    if (document.visibilityState !== "visible") {
      return result("cdpConsoleTiming", "inconclusive", 0, { reason: "page is not visible" }, undefined, "static");
    }
    try {
      return evaluateConsoleTiming(collectConsoleTiming());
    } catch (error) {
      return result(
        "cdpConsoleTiming",
        "inconclusive",
        0,
        { reason: "timing probe failed", error: String(error) },
        undefined,
        "static",
      );
    }
  },
};
