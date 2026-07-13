import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanResult, sanitizeRunner } from "../shared/validate";

test("unknown detector ids are dropped", () => {
  assert.equal(cleanResult({ test: "totallyMadeUp", rating: "fail", score: 100, evidence: {} }), null);
});

test("known detector with valid shape passes", () => {
  const r = cleanResult({ test: "webdriver", rating: "fail", score: 100, evidence: { a: 1 } });
  assert.ok(r);
  assert.equal(r?.test, "webdriver");
});

test("out-of-range / non-numeric scores are rejected", () => {
  assert.equal(cleanResult({ test: "webdriver", rating: "fail", score: 999, evidence: {} }), null);
  assert.equal(cleanResult({ test: "webdriver", rating: "fail", score: -5, evidence: {} }), null);
  assert.equal(cleanResult({ test: "webdriver", rating: "fail", score: "lots", evidence: {} }), null);
});

test("invalid rating is rejected", () => {
  assert.equal(cleanResult({ test: "webdriver", rating: "definitely", score: 10, evidence: {} }), null);
});

test("oversized evidence is truncated, not stored verbatim", () => {
  const big = { blob: "x".repeat(5000) };
  const r = cleanResult({ test: "webdriver", rating: "pass", score: 0, evidence: big });
  assert.deepEqual(r?.evidence, { truncated: true });
});

test("runner is sanitized to a safe slug, else 'human'", () => {
  assert.equal(sanitizeRunner("patchright"), "patchright");
  assert.equal(sanitizeRunner("Agent-Browser"), "agent-browser");
  assert.equal(sanitizeRunner("<script>"), "human");
  assert.equal(sanitizeRunner("x".repeat(64)), "human");
  assert.equal(sanitizeRunner(42), "human");
  assert.equal(sanitizeRunner(undefined), "human");
});

test("MAX_RESULTS export is a sane cap", async () => {
  const { MAX_RESULTS } = await import("../shared/validate");
  assert.ok(MAX_RESULTS > 0 && MAX_RESULTS <= 200);
});
