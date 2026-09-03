import { type Detector, result } from "../../lib/detector";

const SCREEN_PROPERTIES = ["width", "height", "availWidth", "availHeight"] as const;
const BROWSER_RS_RUNTIME_KEYS = [
  "id",
  "connect",
  "sendMessage",
  "onMessage",
  "onConnect",
  "OnInstalledReason",
  "OnRestartRequiredReason",
  "PlatformArch",
  "PlatformNaclArch",
  "PlatformOs",
  "RequestUpdateCheckStatus",
] as const;

export interface BrowserRsPropertyShape {
  source?: string;
  configurable?: boolean;
  enumerable?: boolean;
  writable?: boolean;
}

export interface BrowserRsResidueSurface {
  screen: Record<string, BrowserRsPropertyShape | undefined>;
  permissionsQuery?: BrowserRsPropertyShape;
  runtimeKeys: string[];
  platformArchKeys: string[];
  platformNaclArchKeys: string[];
}

function exactKeys(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Exported for deterministic unit tests without browser globals. */
export function evaluateBrowserRsStealthResidue(surface: BrowserRsResidueSurface | null) {
  if (!surface) {
    return result(
      "browserRsStealthResidue",
      "inconclusive",
      0,
      { reason: "browser surfaces could not be inspected" },
      undefined,
      "static",
    );
  }

  const screenMatches = SCREEN_PROPERTIES.every((property) => {
    const descriptor = surface.screen[property];
    return descriptor?.source === "() => v" && descriptor.enumerable === false && descriptor.configurable === true;
  });
  const permissionsMatches =
    surface.permissionsQuery?.source === "function query() { [native code] }" &&
    surface.permissionsQuery.writable === true &&
    surface.permissionsQuery.enumerable === true &&
    surface.permissionsQuery.configurable === true;
  const runtimeMatches =
    exactKeys(surface.runtimeKeys, BROWSER_RS_RUNTIME_KEYS) &&
    !surface.platformArchKeys.includes("RISCV64") &&
    surface.platformNaclArchKeys.includes("PNACL");

  const signatures = [
    ...(screenMatches ? ["screen-own-arrow-getters"] : []),
    ...(permissionsMatches ? ["permissions-own-query"] : []),
    ...(runtimeMatches ? ["legacy-runtime-keyset"] : []),
  ];
  const evidence = {
    signatures,
    screenMatches,
    permissionsMatches,
    runtimeMatches,
    runtimeKeys: surface.runtimeKeys,
  };

  if (signatures.length === 3) {
    return result("browserRsStealthResidue", "fail", 100, evidence, undefined, "static");
  }
  if (signatures.length === 2) {
    return result("browserRsStealthResidue", "fail", 85, evidence, undefined, "static");
  }
  if (signatures.length === 1) {
    return result("browserRsStealthResidue", "warn", 35, evidence, undefined, "static");
  }
  return result("browserRsStealthResidue", "pass", 0, evidence, undefined, "static");
}

function propertyShape(owner: object, property: PropertyKey): BrowserRsPropertyShape | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  if (!descriptor) return undefined;
  const fn = descriptor.get ?? (typeof descriptor.value === "function" ? descriptor.value : undefined);
  return {
    source: fn ? Function.prototype.toString.call(fn) : undefined,
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    writable: "writable" in descriptor ? descriptor.writable : undefined,
  };
}

/**
 * browser-rs v0.2.2 stealth-script attribution.
 *
 * The detector requires multiple exact implementation residues instead of
 * treating a generic patched API as proof of one automation framework.
 */
export const browserRsStealthResidue: Detector = {
  test: "browserRsStealthResidue",
  label: "browser-rs stealth residue",
  category: "static",
  run: () => {
    try {
      const chrome = (window as Window & { chrome?: { runtime?: Record<string, unknown> } }).chrome;
      const runtime = chrome?.runtime;
      const platformArch = runtime?.PlatformArch;
      const platformNaclArch = runtime?.PlatformNaclArch;
      return evaluateBrowserRsStealthResidue({
        screen: Object.fromEntries(SCREEN_PROPERTIES.map((property) => [property, propertyShape(screen, property)])),
        permissionsQuery: navigator.permissions ? propertyShape(navigator.permissions, "query") : undefined,
        runtimeKeys: runtime ? Object.keys(runtime) : [],
        platformArchKeys: platformArch && typeof platformArch === "object" ? Object.keys(platformArch as object) : [],
        platformNaclArchKeys:
          platformNaclArch && typeof platformNaclArch === "object" ? Object.keys(platformNaclArch as object) : [],
      });
    } catch {
      return evaluateBrowserRsStealthResidue(null);
    }
  },
};
