import { type Detector, result } from "../../lib/detector";

/**
 * Electron / Node-in-page detection (FPScanner distinctive props, BotD).
 *
 * A normal web page has no Node.js surface. Automation wrappers built on Electron
 * (and some scraping frameworks / node-integration webviews) leak `process`,
 * `require`, `module`, `global`, or `process.versions.electron` into the page.
 * Their presence on a public web page is a hard automation tell.
 */
export const electronDetection: Detector = {
  test: "electronDetection",
  label: "Electron / Node surface",
  category: "static",
  run: () => {
    const w = window as unknown as Record<string, unknown>;
    const hits: string[] = [];

    for (const k of ["process", "require", "module", "global", "__nwjs", "nw"]) {
      try {
        if (typeof w[k] !== "undefined") hits.push(k);
      } catch {
        /* */
      }
    }

    // process.versions.electron / .node is the definitive marker.
    let electronVersion: string | undefined;
    try {
      const proc = w.process as { versions?: { electron?: string; node?: string }; type?: string } | undefined;
      if (proc?.versions?.electron) {
        electronVersion = proc.versions.electron;
        hits.push("process.versions.electron");
      }
      if (proc?.versions?.node && !proc?.versions?.electron) hits.push("process.versions.node");
    } catch {
      /* */
    }

    // Chrome UA that also exposes userAgentData listing Electron is another tell.
    const uaData = (navigator as unknown as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
    if (uaData?.brands?.some((b) => /electron/i.test(b.brand))) hits.push("uaData:Electron");
    if (/Electron\//i.test(navigator.userAgent)) hits.push("ua:Electron");

    if (hits.length) {
      return result(
        "electronDetection",
        "fail",
        Math.min(100, 75 + hits.length * 8),
        { hits, electronVersion },
        undefined,
        "static",
      );
    }
    return result("electronDetection", "pass", 0, { hits: [] }, undefined, "static");
  },
};
