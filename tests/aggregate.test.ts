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
  // group "mouse-motion" max p = max(0.5,0.5,0.5,0.6,0.5)=0.6 → botScore 60
  assert.equal(grouped.botScore, 60);
});

test("independent groups combine via noisy-OR", () => {
  // one mouse group (max 0.5) + one keystroke group (max 0.5) → 1-(0.5*0.5)=0.75
  const a = aggregate([r("mouseEntropy", "fail", 100), r("typingCadence", "fail", 100)]);
  assert.equal(a.botScore, 75);
});

test("a single mid heuristic yields warn, not fail", () => {
  const a = aggregate([r("canvasRender", "fail", 100)]); // weight 0.4 → 40
  assert.equal(a.botScore, 40);
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
