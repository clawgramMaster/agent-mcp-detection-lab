import assert from "node:assert/strict";
import { test } from "node:test";
import { clickTeleport } from "../client/src/detectors/interaction/clickTeleport";
import { detachedNodeClick } from "../client/src/detectors/interaction/detachedNodeClick";
import { exactCenterClick } from "../client/src/detectors/interaction/exactCenterClick";
import { honeypot } from "../client/src/detectors/interaction/honeypot";
import { hoverMenuSelection } from "../client/src/detectors/interaction/hoverMenuSelection";
import { iframeControlledInput } from "../client/src/detectors/interaction/iframeControlledInput";
import { keypadChallenge } from "../client/src/detectors/interaction/keypadChallenge";
import { mouseEntropy } from "../client/src/detectors/interaction/mouse";
import { nativeSelect } from "../client/src/detectors/interaction/nativeSelect";
import { popupOpenerIntegrity } from "../client/src/detectors/interaction/popupOpenerIntegrity";
import { shiftKeyConsistency } from "../client/src/detectors/interaction/shiftKeyConsistency";
import { sliderDrag } from "../client/src/detectors/interaction/sliderDrag";
import { shadowDomIntegrity } from "../client/src/detectors/static/shadowDom";
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

test("secure keypad: coordinate-replay across a reshuffle → fail", () => {
  const ctx = mkCtx({
    keypad: {
      pin: [4, 8, 1, 5],
      wrongClicks: 0,
      completed: true,
      correct: true,
      shuffles: 3,
      clicks: [
        {
          digit: 4,
          expectedDigit: 4,
          t: 0,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          targetGap: 0,
          isTrusted: true,
        },
        // layout reshuffled (targetGap > 20) but the click landed on the exact
        // same screen point as the previous click — coordinates were replayed.
        {
          digit: 8,
          expectedDigit: 8,
          t: 30,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          targetGap: 120,
          isTrusted: true,
        },
        {
          digit: 1,
          expectedDigit: 1,
          t: 60,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          targetGap: 120,
          isTrusted: true,
        },
        {
          digit: 5,
          expectedDigit: 5,
          t: 90,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          targetGap: 120,
          isTrusted: true,
        },
      ],
    },
  });
  const r = keypadChallenge.run(ctx) as { rating: string; evidence: Record<string, unknown> };
  assert.equal(r.rating, "fail");
  assert.equal(r.evidence.replayedPoint, 3);
});

test("secure keypad: centered clicks on distinct screen points are not coordinate replay", () => {
  const ctx = mkCtx({
    keypad: {
      pin: [4, 8],
      wrongClicks: 0,
      completed: true,
      correct: true,
      shuffles: 1,
      clicks: [
        {
          digit: 4,
          expectedDigit: 4,
          t: 0,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 12,
          pathLenSincePrev: 140,
          targetGap: 0,
          isTrusted: true,
        },
        {
          digit: 8,
          expectedDigit: 8,
          t: 620,
          x: 230,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 18,
          pathLenSincePrev: 160,
          targetGap: 130,
          isTrusted: true,
        },
      ],
    },
  });
  const r = keypadChallenge.run(ctx) as { rating: string; evidence: Record<string, unknown> };
  assert.notEqual(r.rating, "fail");
  assert.equal(r.evidence.replayedPoint, undefined);
});

test("secure keypad: human-like PIN entry with real cursor motion → pass", () => {
  const ctx = mkCtx({
    keypad: {
      pin: [4, 8],
      wrongClicks: 0,
      completed: true,
      correct: true,
      shuffles: 1,
      clicks: [
        {
          digit: 4,
          expectedDigit: 4,
          t: 0,
          x: 100,
          y: 100,
          dxCenter: 3,
          dyCenter: -2,
          movesSincePrev: 12,
          pathLenSincePrev: 140,
          targetGap: 0,
          isTrusted: true,
        },
        {
          digit: 8,
          expectedDigit: 8,
          t: 620,
          x: 230,
          y: 100,
          dxCenter: -4,
          dyCenter: 5,
          movesSincePrev: 18,
          pathLenSincePrev: 160,
          targetGap: 130,
          isTrusted: true,
        },
      ],
    },
  });
  const r = keypadChallenge.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("secure keypad: untrusted (synthetic) click → fail", () => {
  const ctx = mkCtx({
    keypad: {
      pin: [4],
      wrongClicks: 0,
      completed: true,
      correct: true,
      shuffles: 0,
      clicks: [
        {
          digit: 4,
          expectedDigit: 4,
          t: 0,
          x: 100,
          y: 100,
          dxCenter: 0,
          dyCenter: 0,
          movesSincePrev: 0,
          pathLenSincePrev: 0,
          targetGap: 0,
          isTrusted: false,
        },
      ],
    },
  });
  const r = keypadChallenge.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("secure keypad: not attempted → inconclusive", () => {
  const r = keypadChallenge.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("shadow-DOM integrity: real browser closed-root invariants hold → pass", () => {
  const r = shadowDomIntegrity.run(mkCtx()) as { rating: string };
  assert.notEqual(r.rating, "fail");
});

test("detached-node click: click landing on the node AFTER it was removed → fail", () => {
  const ctx = mkCtx({
    detachedClick: {
      swappedAt: 100,
      originalClickedAt: 250, // after swappedAt — physically impossible for a real pointer
      originalClickedAfterSwap: true,
      originalTrusted: true,
      replacementClickedAt: 0,
      replacementTrusted: false,
      completed: true,
    },
  });
  const r = detachedNodeClick.run(ctx) as { rating: string; score: number };
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 95);
});

test("detached-node click: real click on the live replacement → pass", () => {
  const ctx = mkCtx({
    detachedClick: {
      swappedAt: 100,
      originalClickedAt: 0,
      originalClickedAfterSwap: false,
      originalTrusted: false,
      replacementClickedAt: 400,
      replacementTrusted: true,
      completed: true,
    },
  });
  const r = detachedNodeClick.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("detached-node click: untrusted synthetic click on the replacement → fail", () => {
  const ctx = mkCtx({
    detachedClick: {
      swappedAt: 100,
      originalClickedAt: 0,
      originalClickedAfterSwap: false,
      originalTrusted: false,
      replacementClickedAt: 400,
      replacementTrusted: false,
      completed: true,
    },
  });
  const r = detachedNodeClick.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("detached-node click: not attempted → inconclusive", () => {
  const r = detachedNodeClick.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("popup opener integrity: missing window.opener after a trusted click → fail", () => {
  const ctx = mkCtx({
    popupCheck: {
      challengeId: "c1",
      clickedAt: 100,
      trustedClick: true,
      completed: true,
      reportedAt: 200,
      openerPresent: false,
      referrerNonEmpty: true,
      referrerOriginMatches: true,
    },
  });
  const r = popupOpenerIntegrity.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("popup opener integrity: trusted click, no report ever arrives → fail", () => {
  const ctx = mkCtx({
    popupCheck: {
      challengeId: "c1",
      clickedAt: 100,
      trustedClick: true,
      completed: false,
      reportedAt: 0,
      openerPresent: null,
      referrerNonEmpty: null,
      referrerOriginMatches: null,
    },
  });
  const r = popupOpenerIntegrity.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("popup opener integrity: real opener + referrer present → pass", () => {
  const ctx = mkCtx({
    popupCheck: {
      challengeId: "c1",
      clickedAt: 100,
      trustedClick: true,
      completed: true,
      reportedAt: 150,
      openerPresent: true,
      referrerNonEmpty: true,
      referrerOriginMatches: true,
    },
  });
  const r = popupOpenerIntegrity.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("popup opener integrity: never clicked → inconclusive", () => {
  const r = popupOpenerIntegrity.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("hover-menu: selected with zero dwell (no real hover) → fail", () => {
  const ctx = mkCtx({
    hoverMenu: {
      options: ["Card", "Bank transfer", "Kakao Pay"],
      openedAt: 0,
      selectedOption: "Card",
      selectedAt: 100,
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("hover-menu: superhuman dwell between open and pick → fail", () => {
  const ctx = mkCtx({
    hoverMenu: {
      options: ["Card", "Bank transfer", "Kakao Pay"],
      openedAt: 100,
      selectedOption: "Card",
      selectedAt: 130, // 30ms — faster than perception + travel into the menu
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("hover-menu: real hover dwell then a trusted pick → pass", () => {
  const ctx = mkCtx({
    hoverMenu: {
      options: ["Card", "Bank transfer", "Kakao Pay"],
      openedAt: 100,
      selectedOption: "Kakao Pay",
      selectedAt: 650,
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("hover-menu: not attempted → inconclusive", () => {
  const r = hoverMenuSelection.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
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

test("idle user (no interaction) → every behavioral detector inconclusive → verdict incomplete", () => {
  const idle = mkCtx();
  const results = [honeypot, sliderDrag, keypadChallenge, mouseEntropy, clickTeleport, exactCenterClick]
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
        trustedClickEvents: 1,
        untrustedClickEvents: 0,
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
        trustedClickEvents: 0,
        untrustedClickEvents: 0,
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
        trustedClickEvents: 1,
        untrustedClickEvents: 0,
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

test("nested iframe task fails when the final click is synthetic", () => {
  const r = iframeControlledInput.run(
    mkCtx({
      iframeInput: {
        eventCount: 5,
        trustedInputEvents: 1,
        untrustedInputEvents: 0,
        trustedClickEvents: 0,
        untrustedClickEvents: 1,
        eventSamples: [
          { event: "keydown", key: "1", t: 100, trusted: true },
          { event: "input", key: "", t: 130, trusted: true },
          { event: "keyup", key: "1", t: 170, trusted: true },
          { event: "click", key: "", t: 300, trusted: false },
        ],
        expectedValue: "010-1234-5678",
        controlledValue: "010-1234-5678",
        complete: true,
        blurred: true,
        firstEventAt: 100,
        completedAt: 300,
      },
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 90);
});

test("native select passes only when input and change are trusted", () => {
  const pass = nativeSelect.run(
    mkCtx({
      nativeSelect: {
        expectedValue: "wire",
        value: "wire",
        inputTrusted: true,
        changeTrusted: true,
        eventCount: 2,
        complete: true,
      },
    }),
  ) as { rating: string };
  assert.equal(pass.rating, "pass");

  const fail = nativeSelect.run(
    mkCtx({
      nativeSelect: {
        expectedValue: "wire",
        value: "wire",
        inputTrusted: false,
        changeTrusted: false,
        eventCount: 2,
        complete: true,
      },
    }),
  ) as { rating: string };
  assert.equal(fail.rating, "fail");
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
