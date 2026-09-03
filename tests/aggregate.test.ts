import assert from "node:assert/strict";
import { test } from "node:test";
import { type TestResult, aggregate } from "../shared/types";

let clock = 0;
function r(testName: string, rating: TestResult["rating"], score: number): TestResult {
  return { test: testName, rating, score, evidence: {}, timestamp: clock++ };
}

test("empty input → incomplete, not a green pass", () => {
  const a = aggregate([]);
  assert.equal(a.verdict, "incomplete");
  assert.equal(a.contributing, 0);
  assert.equal(a.botScore, 0);
});

test("all-inconclusive → incomplete", () => {
  const a = aggregate([r("mouseEntropy", "inconclusive", 0), r("typingCadence", "inconclusive", 0)]);
  assert.equal(a.verdict, "incomplete");
  assert.equal(a.contributing, 0);
});

test("inconclusive results never contribute", () => {
  const withInc = aggregate([r("webglVendor", "pass", 0), r("clientHints", "inconclusive", 100)]);
  assert.equal(withInc.botScore, 0);
  assert.equal(withInc.verdict, "pass");
});

test("unknown detector has weight 0 (ignored)", () => {
  const a = aggregate([r("totallyUnknownDetector", "fail", 100)]);
  // unknown → weight 0 → not counted → nothing measured
  assert.equal(a.contributing, 0);
  assert.equal(a.verdict, "incomplete");
});

test("informational detectors (weight 0) never move the score", () => {
  const a = aggregate([
    r("webglVendor", "pass", 0), // measured, contributes presence
    r("domRect", "fail", 100),
    r("localeTimezone", "fail", 100),
    r("batteryApi", "fail", 100),
    r("speechVoices", "fail", 100),
  ]);
  assert.equal(a.botScore, 0);
});

test("a hard-rule fail floors the score at ≥95 (decisive)", () => {
  const a = aggregate([r("webdriver", "fail", 100)]);
  assert.ok(a.botScore >= 95, `expected ≥95, got ${a.botScore}`);
  assert.equal(a.verdict, "fail");
});

test("Runtime.addBinding leak contributes strongly without becoming a hard-rule floor", () => {
  const a = aggregate([r("runtimeBindingLeak", "fail", 85)]);
  assert.equal(a.botScore, 77);
  assert.equal(a.verdict, "fail");
});

test("console serialization timing remains informational", () => {
  const a = aggregate([r("cdpConsoleTiming", "warn", 25)]);
  assert.equal(a.botScore, 0);
  assert.equal(a.contributing, 0);
});

test("honeypot alone is decisive", () => {
  const a = aggregate([r("honeypot", "fail", 100)]);
  assert.ok(a.botScore >= 95);
  assert.equal(a.verdict, "fail");
});

test("correlated mouse signals are de-duplicated (grouped max, not multiplied)", () => {
  // five correlated mouse detectors each at 100 must NOT stack to ~100 as if independent
  const grouped = aggregate([
    r("mouseEntropy", "fail", 100),
    r("mouseKinematics", "fail", 100),
    r("clickTeleport", "fail", 100),
    r("cdpMouseLeak", "fail", 100),
    r("exactCenterClick", "fail", 100),
  ]);
  // group "mouse-motion" max p is cdpMouseLeak's 0.4.
  assert.equal(grouped.botScore, 40);
});

test("browser-rs stealth residues are de-duplicated instead of stacking", () => {
  const grouped = aggregate([
    r("browserRsStealthResidue", "fail", 100),
    r("browserRsSpeechShim", "fail", 95),
    r("chromeShimFidelity", "fail", 100),
  ]);
  assert.equal(grouped.botScore, 75);
});

test("independent groups combine via noisy-OR", () => {
  // one mouse group (0.3) + one keystroke group (0.3) → 1-(0.7*0.7)=0.51
  const a = aggregate([r("mouseEntropy", "fail", 100), r("typingCadence", "fail", 100)]);
  assert.equal(a.botScore, 51);
});

test("a single weak environment heuristic stays below the warning threshold", () => {
  const a = aggregate([r("canvasRender", "fail", 100)]);
  assert.equal(a.botScore, 20);
  assert.equal(a.verdict, "pass");
});

test("atomic credential insertion without paste cannot fail by itself", () => {
  const a = aggregate([r("clipboardShortcutMismatch", "warn", 40)]);
  assert.equal(a.botScore, 14);
  assert.equal(a.verdict, "pass");
});

test("normal credential paste contributes no bot score", () => {
  const a = aggregate([r("pasteVsType", "pass", 0)]);
  assert.equal(a.botScore, 0);
  assert.equal(a.contributing, 0);
  assert.equal(a.verdict, "incomplete");
});

test("correlated autofill and privacy-popup signals do not falsely fail a human", () => {
  const a = aggregate([
    r("honeypot", "warn", 35),
    r("clipboardShortcutMismatch", "warn", 40),
    r("superhumanSubmit", "warn", 40),
    r("popupOpenerIntegrity", "warn", 40),
  ]);
  assert.equal(a.botScore, 43);
  assert.equal(a.verdict, "warn");
});

test("clean human passive run stays pass", () => {
  const a = aggregate([
    r("webdriver", "pass", 0),
    r("automationGlobals", "pass", 0),
    r("clientHints", "pass", 0),
    r("webglVendor", "pass", 0),
    r("httpHeaders", "pass", 0),
  ]);
  assert.equal(a.verdict, "pass");
  assert.equal(a.botScore, 0);
  assert.ok(a.contributing > 0);
});
