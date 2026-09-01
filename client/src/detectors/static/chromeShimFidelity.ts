import { type Detector, result } from "../../lib/detector";

const RUNTIME_ENUMS = [
  "OnInstalledReason",
  "OnRestartRequiredReason",
  "PlatformArch",
  "PlatformNaclArch",
  "PlatformOs",
  "RequestUpdateCheckStatus",
] as const;

const LOAD_TIMES_FIELDS: Record<string, "number" | "string" | "boolean"> = {
  requestTime: "number",
  startLoadTime: "number",
  commitLoadTime: "number",
  finishDocumentLoadTime: "number",
  finishLoadTime: "number",
  firstPaintTime: "number",
  firstPaintAfterLoadTime: "number",
  navigationType: "string",
  wasFetchedViaSpdy: "boolean",
  wasNpnNegotiated: "boolean",
  npnNegotiatedProtocol: "string",
  wasAlternateProtocolAvailable: "boolean",
  connectionInfo: "string",
};

const CSI_FIELDS: Record<string, "number"> = {
  startE: "number",
  onloadT: "number",
  pageT: "number",
  tran: "number",
};

type ChromeLike = {
  runtime?: Record<string, unknown>;
  loadTimes?: () => unknown;
  csi?: () => unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inspectReturnedShape(
  owner: ChromeLike,
  name: "loadTimes" | "csi",
  expected: Record<string, string>,
  maxScore: number,
): { score: number; evidence: Record<string, unknown> } {
  const fn = owner[name];
  if (typeof fn !== "function") return { score: 0, evidence: {} };

  try {
    const value = fn.call(owner);
    if (!isObject(value)) return { score: maxScore, evidence: { returned: typeof value } };

    const actualFields = Object.keys(value);
    const expectedFields = Object.keys(expected);
    const missingFields = expectedFields.filter((field) => !(field in value));
    const wrongTypes = expectedFields.filter((field) => {
      const actualType: string = typeof value[field];
      return field in value && actualType !== expected[field];
    });
    const fieldCountDelta = Math.abs(actualFields.length - expectedFields.length);
    const anomalyCount = Math.max(missingFields.length + wrongTypes.length, fieldCountDelta);
    const score = Math.round(maxScore * Math.min(1, anomalyCount / expectedFields.length));

    return {
      score,
      evidence: {
        fieldCount: actualFields.length,
        expectedFieldCount: expectedFields.length,
        ...(missingFields.length ? { missingFields } : {}),
        ...(wrongTypes.length ? { wrongTypes } : {}),
      },
    };
  } catch {
    return { score: maxScore, evidence: { threw: true } };
  }
}

/** Exported for unit tests without requiring browser globals. */
export function evaluateChromeShimFidelity(chrome: unknown) {
  if (!isObject(chrome)) {
    return result("chromeShimFidelity", "inconclusive", 0, { reason: "window.chrome absent" }, undefined, "static");
  }

  const owner = chrome as ChromeLike;
  const ev: Record<string, unknown> = {};
  let score = 0;
  let measured = false;

  if (isObject(owner.runtime)) {
    measured = true;
    const missingRuntimeEnums = RUNTIME_ENUMS.filter((name) => !isObject(owner.runtime?.[name]));
    score += Math.round(60 * (missingRuntimeEnums.length / RUNTIME_ENUMS.length));
    ev.runtime = { missingEnums: missingRuntimeEnums, expectedEnumCount: RUNTIME_ENUMS.length };
  }

  for (const [name, expected, maxScore] of [
    ["loadTimes", LOAD_TIMES_FIELDS, 40],
    ["csi", CSI_FIELDS, 30],
  ] as const) {
    if (typeof owner[name] !== "function") continue;
    measured = true;
    const inspected = inspectReturnedShape(owner, name, expected, maxScore);
    score += inspected.score;
    ev[name] = inspected.evidence;
  }

  if (!measured) {
    return result(
      "chromeShimFidelity",
      "inconclusive",
      0,
      { reason: "no Chrome surfaces to inspect" },
      undefined,
      "static",
    );
  }

  score = Math.min(100, score);
  const rating = score >= 60 ? "fail" : score >= 20 ? "warn" : "pass";
  return result("chromeShimFidelity", rating, score, ev, undefined, "static");
}

/**
 * Chrome shim structural fidelity. Thin automation shims often reproduce the
 * callable surface but omit runtime enums or return incomplete legacy timing
 * objects that native Chrome exposes with stable shapes.
 */
export const chromeShimFidelity: Detector = {
  test: "chromeShimFidelity",
  label: "Chrome shim fidelity",
  category: "static",
  run: () => evaluateChromeShimFidelity((window as Window & { chrome?: unknown }).chrome),
};
