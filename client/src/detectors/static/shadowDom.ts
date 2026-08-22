import { type Detector, result } from "../../lib/detector";

/**
 * Closed shadow-root integrity.
 *
 * Real security UIs (bank / cert-auth "secure keypads", payment widgets) render
 * inside a **closed** `attachShadow({ mode: "closed" })` tree specifically so that
 * `element.shadowRoot` is `null` to any script that doesn't hold the original
 * reference returned by `attachShadow`. That is the whole point: a scraping/automation
 * layer that walks the DOM to read button labels or map click targets to values must
 * fail — it can only see the host element, not what's inside it.
 *
 * Some automation stacks patch `Element.prototype.attachShadow` (or the constructor
 * that backs it) to force `mode: "open"` regardless of what the page asked for, or to
 * stash a side-channel reference, specifically to defeat this pattern. We attach our
 * own closed root and immediately verify:
 *   1. `host.shadowRoot` is null (as spec'd) — a non-null value means attachShadow was
 *      intercepted to leak the "closed" tree.
 *   2. the returned root's `.mode` really reads `"closed"`.
 *   3. `attachShadow` itself is still native code (Rebrowser/CreepJS-style check) —
 *      a JS-reimplemented version is the mechanism such interception would use.
 *
 * This is a **hard** tell: no legitimate web page has any reason for
 * `attachShadow({mode:"closed"})` to fail these invariants.
 */
const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

export const shadowDomIntegrity: Detector = {
  test: "shadowDomIntegrity",
  label: "Closed shadow-root integrity",
  category: "static",
  run: () => {
    const ev: Record<string, unknown> = {};
    let score = 0;

    if (typeof Element === "undefined" || typeof Element.prototype.attachShadow !== "function") {
      return result("shadowDomIntegrity", "inconclusive", 0, { note: "attachShadow unsupported" }, undefined, "static");
    }

    // attachShadow itself must be native — a patched implementation is the exact
    // mechanism that would let closed-root contents leak back out.
    try {
      const src = Function.prototype.toString.call(Element.prototype.attachShadow);
      ev.attachShadowNative = NATIVE_RE.test(src);
      if (!NATIVE_RE.test(src)) score += 70;
    } catch {
      ev.attachShadowNative = false;
      score += 70;
    }

    try {
      const probe = document.createElement("div");
      const root = probe.attachShadow({ mode: "closed" });
      ev.reportedMode = root.mode;
      if (root.mode !== "closed") score += 60; // asked for closed, got something else back

      // The spec guarantees `probe.shadowRoot === null` for a closed root. Any
      // non-null value means something is exposing the closed tree.
      const leaked = probe.shadowRoot !== null;
      ev.hostShadowRootLeaked = leaked;
      if (leaked) score += 80;
    } catch (e) {
      ev.probeError = String(e);
      // attachShadow throwing on a plain div is itself abnormal.
      score += 30;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("shadowDomIntegrity", rating, score, ev, undefined, "static");
  },
};
