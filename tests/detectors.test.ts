import assert from "node:assert/strict";
import { test } from "node:test";
import { clickTeleport } from "../client/src/detectors/interaction/clickTeleport";
import { delayedButton } from "../client/src/detectors/interaction/delayedButton";
import { exactCenterClick } from "../client/src/detectors/interaction/exactCenterClick";
import { gridChallenge } from "../client/src/detectors/interaction/gridChallenge";
import { honeypot } from "../client/src/detectors/interaction/honeypot";
import { iframeControlledInput } from "../client/src/detectors/interaction/iframeControlledInput";
import { mouseEntropy } from "../client/src/detectors/interaction/mouse";
import { shiftKeyConsistency } from "../client/src/detectors/interaction/shiftKeyConsistency";
import { sliderDrag } from "../client/src/detectors/interaction/sliderDrag";
import type { DetectorCtx, KeySample, MouseSample } from "../client/src/lib/detector";
import { normalizeIframeOrigin, parseIframeInputMessage } from "../client/src/lib/iframeChallenge";
import { aggregate } from "../shared/types";

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
    mkCtx({
      slider: {
        target: 70,
        value: 70,
        samples: [{ v: 70, t: 0, trusted: false }],
        startedAt: 0,
        releasedAt: 5,
        completed: true,
      },
    }),
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
        {
          tile: 0,
          t: 0,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          tileGap: 0,
          isTrusted: true,
        },
        {
          tile: 1,
          t: 30,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          tileGap: 200,
          isTrusted: true,
        },
        {
          tile: 2,
          t: 60,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          tileGap: 200,
          isTrusted: true,
        },
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

test("nested iframe task passes after trusted controlled input survives blur", () => {
  const r = iframeControlledInput.run(
    mkCtx({
      iframeInput: {
        eventCount: 36,
        trustedInputEvents: 11,
        untrustedInputEvents: 0,
        eventSamples: Array.from({ length: 11 }, (_, index) => {
          const t = 100 + index * 120 + (index % 3) * 25;
          const dwell = 35 + (index % 4) * 15;
          const key = String(index % 10);
          return [
            { event: "keydown", key, t, trusted: true },
            { event: "input", key: "", t: t + 20, trusted: true },
            { event: "keyup", key, t: t + dwell, trusted: true },
          ];
        }).flat(),
        expectedValue: "010-1234-5678",
        controlledValue: "010-1234-5678",
        complete: true,
        blurred: true,
        firstEventAt: 100,
        completedAt: 1700,
      },
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("nested iframe DOM injection fails when only untrusted input is observed", () => {
  const r = iframeControlledInput.run(
    mkCtx({
      iframeInput: {
        eventCount: 2,
        trustedInputEvents: 0,
        untrustedInputEvents: 1,
        eventSamples: [{ event: "input", key: "", t: 100, trusted: false }],
        expectedValue: "010-1234-5678",
        controlledValue: "",
        complete: false,
        blurred: false,
        firstEventAt: 100,
        completedAt: 0,
      },
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 90);
});

test("trusted atomic iframe insertion still fails without keyboard dynamics", () => {
  const r = iframeControlledInput.run(
    mkCtx({
      iframeInput: {
        eventCount: 3,
        trustedInputEvents: 1,
        untrustedInputEvents: 0,
        eventSamples: [
          { event: "focus", key: "", t: 100, trusted: true },
          { event: "input", key: "", t: 110, trusted: true },
          { event: "blur", key: "", t: 120, trusted: true },
        ],
        expectedValue: "010-1234-5678",
        controlledValue: "010-1234-5678",
        complete: true,
        blurred: true,
        firstEventAt: 100,
        completedAt: 120,
      },
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "fail");
  assert.ok(r.score >= 70);
});

test("iframe challenge accepts only the expected frame, origin, and nonce", () => {
  const source = {} as MessageEventSource;
  const payload = {
    source: "iframe-input-lab",
    challengeId: "challenge-1",
    event: "input",
    key: "",
    inputType: "insertText",
    isTrusted: true,
    controlledValue: "010-1234-5678",
    complete: true,
    timestamp: 100,
  };
  const expected = { challengeId: "challenge-1", origin: "https://frame.example", source };

  assert.deepEqual(parseIframeInputMessage({ data: payload, origin: expected.origin, source }, expected), payload);
  assert.equal(parseIframeInputMessage({ data: payload, origin: "https://spoof.example", source }, expected), null);
  assert.equal(
    parseIframeInputMessage({ data: payload, origin: expected.origin, source: {} as MessageEventSource }, expected),
    null,
  );
  assert.equal(
    parseIframeInputMessage({ data: { ...payload, challengeId: "stale" }, origin: expected.origin, source }, expected),
    null,
  );
});

test("iframe origin normalization rejects non-http schemes", () => {
  assert.equal(normalizeIframeOrigin("https://frame.example/path"), "https://frame.example");
  assert.equal(normalizeIframeOrigin("javascript:alert(1)"), null);
  assert.equal(normalizeIframeOrigin("not a url"), null);
});
