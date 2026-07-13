import assert from "node:assert/strict";
import { test } from "node:test";
import type { DetectorCtx, KeySample, MouseSample } from "../client/src/lib/detector";
import { clickTeleport } from "../client/src/detectors/interaction/clickTeleport";
import { exactCenterClick } from "../client/src/detectors/interaction/exactCenterClick";
import { mouseEntropy } from "../client/src/detectors/interaction/mouse";
import { shiftKeyConsistency } from "../client/src/detectors/interaction/shiftKeyConsistency";

function mkCtx(p: Partial<DetectorCtx> = {}): DetectorCtx {
  return {
    mouse: [],
    keys: [],
    keyups: [],
    scrolls: [],
    wheels: [],
    clicks: [],
    focusEvents: [],
    formShownAt: 0,
    submittedAt: 0,
    pasted: false,
    ...p,
  };
}
const key = (k: string, over: Partial<KeySample> = {}): KeySample => ({
  key: k,
  t: 0,
  isTrusted: true,
  shift: false,
  caps: false,
  altGraph: false,
  ...over,
});

test("CapsLock uppercase (shift=false, caps=true) is NOT flagged impossible", () => {
  const ctx = mkCtx({ keys: ["H", "E", "L", "L", "O"].map((c) => key(c, { caps: true })) });
  const r = shiftKeyConsistency.run(ctx) as { rating: string };
  assert.notEqual(r.rating, "fail");
});

test("AltGr symbol (shift=false, altGraph=true) is NOT flagged impossible", () => {
  const ctx = mkCtx({ keys: [key("@", { altGraph: true }), key("e"), key("u")] });
  const r = shiftKeyConsistency.run(ctx) as { rating: string };
  assert.notEqual(r.rating, "fail");
});

test("genuinely impossible '@' with no modifier still fails", () => {
  const ctx = mkCtx({ keys: [key("@"), key("a"), key("b")] });
  const r = shiftKeyConsistency.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("uppercase with shift held is fine", () => {
  const ctx = mkCtx({ keys: ["A", "B"].map((c) => key(c, { shift: true })) });
  const r = shiftKeyConsistency.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("no typing → shiftKeyConsistency inconclusive", () => {
  const r = shiftKeyConsistency.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("keyboard-only user: no mouse samples → mouseEntropy inconclusive (not fail)", () => {
  const r = mouseEntropy.run(mkCtx({ mouse: [] })) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("no clicks → clickTeleport inconclusive", () => {
  const r = clickTeleport.run(mkCtx({ clicks: [] })) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("a single dead-center click is NOT a standalone fail (needs repeats)", () => {
  const centerHit: MouseSample = {
    x: 100,
    y: 100,
    t: 0,
    movementX: 1,
    movementY: 1,
    isTrusted: true,
    centerDx: 0,
    centerDy: 0,
    elW: 120,
    elH: 40,
  };
  const r = exactCenterClick.run(mkCtx({ clicks: [centerHit] })) as { rating: string };
  assert.notEqual(r.rating, "fail");
});
