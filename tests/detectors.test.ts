import assert from "node:assert/strict";
import { test } from "node:test";
import type { DetectorCtx, KeySample, MouseSample } from "../client/src/lib/detector";
import { aggregate } from "../shared/types";
import { clickTeleport } from "../client/src/detectors/interaction/clickTeleport";
import { delayedButton } from "../client/src/detectors/interaction/delayedButton";
import { exactCenterClick } from "../client/src/detectors/interaction/exactCenterClick";
import { gridChallenge } from "../client/src/detectors/interaction/gridChallenge";
import { honeypot } from "../client/src/detectors/interaction/honeypot";
import { mouseEntropy } from "../client/src/detectors/interaction/mouse";
import { shiftKeyConsistency } from "../client/src/detectors/interaction/shiftKeyConsistency";
import { sliderDrag } from "../client/src/detectors/interaction/sliderDrag";

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

test("delayed button clicked before it turned green → fail (now observable)", () => {
  const ctx = mkCtx({ delayed: { enabledAt: 0, clickedAt: 500, clickedBeforeEnable: true, trusted: true } });
  const r = delayedButton.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("delayed button clicked ~human reaction after enable → pass", () => {
  const ctx = mkCtx({ delayed: { enabledAt: 1000, clickedAt: 1450, clickedBeforeEnable: false, trusted: true } });
  const r = delayedButton.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("slider set directly (1 sample, untrusted) → fail; skipped → inconclusive", () => {
  const jumped = sliderDrag.run(
    mkCtx({ slider: { target: 70, value: 70, samples: [{ v: 70, t: 0, trusted: false }], startedAt: 0, releasedAt: 5, completed: true } }),
  ) as { rating: string };
  assert.equal(jumped.rating, "fail");
  const skipped = sliderDrag.run(mkCtx()) as { rating: string };
  assert.equal(skipped.rating, "inconclusive");
});

test("grid: teleport between far tiles → fail", () => {
  const ctx = mkCtx({
    grid: {
      targetOrder: [0, 1, 2],
      shownAt: 0,
      wrongClicks: 0,
      completed: true,
      correct: true,
      clicks: [
        { tile: 0, t: 0, dxCenter: 0, dyCenter: 0, movesSincePrev: 0, pathLenSincePrev: 0, tileGap: 0, isTrusted: true },
        { tile: 1, t: 30, dxCenter: 0, dyCenter: 0, movesSincePrev: 0, pathLenSincePrev: 0, tileGap: 200, isTrusted: true },
        { tile: 2, t: 60, dxCenter: 0, dyCenter: 0, movesSincePrev: 0, pathLenSincePrev: 0, tileGap: 200, isTrusted: true },
      ],
    },
  });
  const r = gridChallenge.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("idle user (no interaction) → every behavioral detector inconclusive → verdict incomplete", () => {
  const idle = mkCtx();
  const results = [honeypot, gridChallenge, sliderDrag, delayedButton, mouseEntropy, clickTeleport, exactCenterClick]
    .map((d) => d.run(idle))
    .filter((r): r is Exclude<typeof r, Promise<unknown>> => !(r instanceof Promise));
  for (const r of results) assert.equal(r.rating, "inconclusive", `${r.test} should be inconclusive`);
  assert.equal(aggregate(results).verdict, "incomplete");
});
