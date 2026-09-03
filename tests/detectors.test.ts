import assert from "node:assert/strict";
import { test } from "node:test";
import { clickTeleport } from "../client/src/detectors/interaction/clickTeleport";
import { clipboardTransfer } from "../client/src/detectors/interaction/clipboardTransfer";
import { detachedNodeClick } from "../client/src/detectors/interaction/detachedNodeClick";
import { exactCenterClick } from "../client/src/detectors/interaction/exactCenterClick";
import { honeypot } from "../client/src/detectors/interaction/honeypot";
import { hoverMenuSelection } from "../client/src/detectors/interaction/hoverMenuSelection";
import { inPageHoverMenuSelection } from "../client/src/detectors/interaction/inPageHoverMenuSelection";
import { iframeControlledInput } from "../client/src/detectors/interaction/iframeControlledInput";
import { keypadChallenge } from "../client/src/detectors/interaction/keypadChallenge";
import { mouseEntropy } from "../client/src/detectors/interaction/mouse";
import { nativeSelect } from "../client/src/detectors/interaction/nativeSelect";
import { popupOpenerIntegrity } from "../client/src/detectors/interaction/popupOpenerIntegrity";
import { shiftKeyConsistency } from "../client/src/detectors/interaction/shiftKeyConsistency";
import { sliderDrag } from "../client/src/detectors/interaction/sliderDrag";
import { clipboardShortcutMismatch, pasteVsType } from "../client/src/detectors/interaction/typing";
import {
  evaluateBrowserRsStealthResidue,
  type BrowserRsResidueSurface,
} from "../client/src/detectors/static/browserRsStealthResidue";
import { evaluateChromeShimFidelity } from "../client/src/detectors/static/chromeShimFidelity";
import { evaluateConsoleTiming } from "../client/src/detectors/static/cdpConsoleTiming";
import {
  evaluateRuntimeBindingCandidates,
  type RuntimeBindingCandidate,
} from "../client/src/detectors/static/runtimeBindingLeak";
import { shadowDomIntegrity } from "../client/src/detectors/static/shadowDom";
import { evaluateBrowserRsSpeechShim } from "../client/src/detectors/static/speechVoices";
import type { DetectorCtx, KeySample, MouseSample } from "../client/src/lib/detector";
import {
  normalizeIframeOrigin,
  parseHoverShadowMessage,
  parseIframeInputMessage,
} from "../client/src/lib/iframeChallenge";
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
    maxValueJump: 0,
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

test("large value jump without paste is only supporting evidence", () => {
  const r = clipboardShortcutMismatch.run(mkCtx({ keys: [key("Control"), key("v")], maxValueJump: 42 })) as {
    rating: string;
    score: number;
  };
  assert.equal(r.rating, "warn");
  assert.equal(r.score, 40);
});

test("real paste event is treated as a normal human workflow", () => {
  const ctx = mkCtx({ keys: [key("Control"), key("v")], pasted: true, maxValueJump: 42 });
  const mismatch = clipboardShortcutMismatch.run(ctx) as { rating: string; score: number };
  const paste = pasteVsType.run(ctx) as { rating: string; score: number };
  assert.equal(mismatch.rating, "pass");
  assert.equal(mismatch.score, 0);
  assert.equal(paste.rating, "pass");
  assert.equal(paste.score, 0);
});

test("ordinary per-character typing does not trigger clipboard mismatch", () => {
  const r = clipboardShortcutMismatch.run(
    mkCtx({ keys: "ordinary typing".split("").map((char) => key(char)), maxValueJump: 1 }),
  ) as { rating: string };
  assert.equal(r.rating, "pass");
});

const runtimeEnums = {
  ContextType: {
    TAB: "TAB",
    POPUP: "POPUP",
    BACKGROUND: "BACKGROUND",
    OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT",
    SIDE_PANEL: "SIDE_PANEL",
    DEVELOPER_TOOLS: "DEVELOPER_TOOLS",
  },
  OnInstalledReason: {
    INSTALL: "install",
    UPDATE: "update",
    CHROME_UPDATE: "chrome_update",
    SHARED_MODULE_UPDATE: "shared_module_update",
  },
  OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
  PlatformArch: {
    ARM: "arm",
    ARM64: "arm64",
    X86_32: "x86-32",
    X86_64: "x86-64",
    MIPS: "mips",
    MIPS64: "mips64",
    RISCV64: "riscv64",
  },
  PlatformNaclArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64", MIPS: "mips", MIPS64: "mips64" },
  PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" },
  RequestUpdateCheckStatus: {
    THROTTLED: "throttled",
    NO_UPDATE: "no_update",
    UPDATE_AVAILABLE: "update_available",
  },
};

const browserRsResidueSurface = (over: Partial<BrowserRsResidueSurface> = {}): BrowserRsResidueSurface => ({
  screen: Object.fromEntries(
    ["width", "height", "availWidth", "availHeight"].map((name) => [
      name,
      { source: "() => v", enumerable: false, configurable: true },
    ]),
  ),
  permissionsQuery: {
    source: "function query() { [native code] }",
    writable: true,
    enumerable: true,
    configurable: true,
  },
  runtimeKeys: [
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
  ],
  platformArchKeys: ["ARM", "ARM64", "MIPS", "MIPS64", "X86_32", "X86_64"],
  platformNaclArchKeys: ["ARM", "MIPS", "MIPS64", "PNACL", "X86_32", "X86_64"],
  ...over,
});

const loadTimesShape = {
  requestTime: 1,
  startLoadTime: 1,
  commitLoadTime: 1,
  finishDocumentLoadTime: 1,
  finishLoadTime: 1,
  firstPaintTime: 1,
  firstPaintAfterLoadTime: 0,
  navigationType: "Other",
  wasFetchedViaSpdy: false,
  wasNpnNegotiated: true,
  npnNegotiatedProtocol: "h2",
  wasAlternateProtocolAvailable: false,
  connectionInfo: "h2",
};

const runtimeBinding = (over: Partial<RuntimeBindingCandidate> = {}): RuntimeBindingCandidate => ({
  property: "qjvpkxmsdlat",
  source: "function () { [native code] }",
  functionName: "",
  functionLength: 0,
  configurable: true,
  enumerable: true,
  writable: true,
  ...over,
});

test("anonymous mutable native global with a Rebrowser random name fails Runtime binding detection", () => {
  const r = evaluateRuntimeBindingCandidates([runtimeBinding()]);
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 85);
});

test("ordinary named native and application globals pass Runtime binding detection", () => {
  const r = evaluateRuntimeBindingCandidates([
    runtimeBinding({ property: "open", functionName: "open", enumerable: false }),
    runtimeBinding({ property: "applicationState", source: "function applicationState() {}" }),
  ]);
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("near-miss Runtime binding descriptors do not false-positive", () => {
  const r = evaluateRuntimeBindingCandidates([runtimeBinding({ enumerable: false })]);
  assert.equal(r.rating, "pass");
});

test("unavailable window property scan is inconclusive for Runtime binding detection", () => {
  const r = evaluateRuntimeBindingCandidates(null);
  assert.equal(r.rating, "inconclusive");
  assert.equal(r.score, 0);
});

test("large object-to-primitive console cost is a low-confidence CDP warning", () => {
  const r = evaluateConsoleTiming(Array.from({ length: 7 }, () => ({ primitiveMs: 0.8, objectMs: 2.4 })));
  assert.equal(r.rating, "warn");
  assert.equal(r.score, 25);
});

test("similar object and primitive console costs pass CDP timing", () => {
  const r = evaluateConsoleTiming(Array.from({ length: 7 }, () => ({ primitiveMs: 0.7, objectMs: 0.8 })));
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("coarse or invalid console timing is inconclusive", () => {
  const r = evaluateConsoleTiming([
    { primitiveMs: 0, objectMs: 0 },
    { primitiveMs: Number.NaN, objectMs: 2 },
    { primitiveMs: 0.8, objectMs: 2.4 },
  ]);
  assert.equal(r.rating, "inconclusive");
  assert.equal(r.score, 0);
});

test("sparse chrome.runtime shim missing native enum objects fails fidelity", () => {
  const r = evaluateChromeShimFidelity({
    runtime: { connect() {}, sendMessage() {}, onMessage: {}, onConnect: {}, id: undefined },
    loadTimes: () => loadTimesShape,
    csi: () => ({ startE: 1, onloadT: 2, pageT: 3, tran: 15 }),
  });
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 100);
});

test("complete Chrome runtime and timing shapes pass fidelity", () => {
  const r = evaluateChromeShimFidelity({
    runtime: runtimeEnums,
    loadTimes: () => loadTimesShape,
    csi: () => ({ startE: 1, onloadT: 2, pageT: 3, tran: 15 }),
  });
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("browser-rs legacy runtime enum set fails strict Chrome fidelity", () => {
  const r = evaluateChromeShimFidelity({
    runtime: {
      ...runtimeEnums,
      ContextType: undefined,
      PlatformArch: { ...runtimeEnums.PlatformArch, RISCV64: undefined },
      PlatformNaclArch: { ...runtimeEnums.PlatformNaclArch, PNACL: "pnacl" },
    },
  });
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 60);
});

test("exact browser-rs Screen, Permissions and runtime residues fail attribution", () => {
  const r = evaluateBrowserRsStealthResidue(browserRsResidueSurface());
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 100);
  assert.equal((r.evidence.signatures as string[]).length, 3);
});

test("stock Chrome prototype-owned surfaces pass browser-rs attribution", () => {
  const r = evaluateBrowserRsStealthResidue(
    browserRsResidueSurface({
      screen: {},
      permissionsQuery: undefined,
      runtimeKeys: [],
      platformArchKeys: [],
      platformNaclArchKeys: [],
    }),
  );
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("one browser-rs-like residue warns but does not attribute alone", () => {
  const r = evaluateBrowserRsStealthResidue(
    browserRsResidueSurface({
      permissionsQuery: undefined,
      runtimeKeys: [],
      platformArchKeys: [],
      platformNaclArchKeys: [],
    }),
  );
  assert.equal(r.rating, "warn");
  assert.equal(r.score, 35);
});

test("exact browser-rs fixed plain-object voice list fails speech shim detection", () => {
  const voices = [
    ["Samantha", "en-US", true, true],
    ["Alex", "en-US", true, false],
    ["Daniel", "en-GB", true, false],
    ["Karen", "en-AU", true, false],
    ["Moira", "en-IE", true, false],
    ["Rishi", "en-IN", true, false],
    ["Google US English", "en-US", false, false],
    ["Google UK English Male", "en-GB", false, false],
  ].map(([name, lang, localService, isDefault]) => ({
    name: String(name),
    lang: String(lang),
    localService: Boolean(localService),
    default: Boolean(isDefault),
    plainObject: true,
  }));
  const r = evaluateBrowserRsSpeechShim(voices, true);
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 95);
});

test("native voice objects do not trigger browser-rs speech attribution", () => {
  const r = evaluateBrowserRsSpeechShim(
    [{ name: "Samantha", lang: "en-US", localService: true, default: true, plainObject: false }],
    false,
  );
  assert.equal(r.rating, "pass");
  assert.equal(r.score, 0);
});

test("malformed Chrome timing return shapes score proportionally", () => {
  const r = evaluateChromeShimFidelity({
    runtime: runtimeEnums,
    loadTimes: () => ({ requestTime: 1, navigationType: 3 }),
    csi: () => ({ startE: 1 }),
  });
  assert.equal(r.rating, "fail");
  assert.ok(r.score >= 60 && r.score < 100);
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

test("popup opener integrity: privacy-stripped opener after a trusted click only warns", () => {
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
  assert.equal(r.rating, "warn");
});

test("popup opener integrity: popup blocker after a trusted click only warns", () => {
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
  assert.equal(r.rating, "warn");
});

test("hidden-field autofill warns without becoming a decisive honeypot hit", () => {
  const r = honeypot.run(
    mkCtx({
      honeypotTriggered: true,
      honeypotReasons: ["filled hidden 'email' field", "hidden 'email' field had a value at submit"],
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "warn");
  assert.equal(r.score, 35);
});

test("clicking the hidden inaccessible control remains a decisive honeypot hit", () => {
  const r = honeypot.run(
    mkCtx({
      honeypotTriggered: true,
      honeypotReasons: ["clicked hidden honeypot button"],
    }),
  ) as { rating: string; score: number };
  assert.equal(r.rating, "fail");
  assert.equal(r.score, 100);
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
      challengeId: "hover-1",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Card",
      openedAt: 0,
      frameOpenedAt: 0,
      openChallengeId: null,
      hoverTrusted: null,
      selectedOption: "Card",
      selectedAt: 100,
      frameSelectedAt: 100,
      selectChallengeId: "hover-1",
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
      challengeId: "hover-1",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Card",
      openedAt: 100,
      frameOpenedAt: 100,
      openChallengeId: "hover-1",
      hoverTrusted: true,
      selectedOption: "Card",
      selectedAt: 130, // 30ms — faster than perception + travel into the menu
      frameSelectedAt: 130,
      selectChallengeId: "hover-1",
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
      challengeId: "hover-1",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Kakao Pay",
      openedAt: 100,
      frameOpenedAt: 100,
      openChallengeId: "hover-1",
      hoverTrusted: true,
      selectedOption: "Kakao Pay",
      selectedAt: 650,
      frameSelectedAt: 650,
      selectChallengeId: "hover-1",
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("hover-menu: synthetic iframe hover fails even with human-like dwell", () => {
  const ctx = mkCtx({
    hoverMenu: {
      challengeId: "hover-1",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Bank transfer",
      openedAt: 100,
      frameOpenedAt: 100,
      openChallengeId: "hover-1",
      hoverTrusted: false,
      selectedOption: "Bank transfer",
      selectedAt: 650,
      frameSelectedAt: 650,
      selectChallengeId: "hover-1",
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("hover-menu: forged child dwell disagrees with parent receipt timing → fail", () => {
  const ctx = mkCtx({
    hoverMenu: {
      challengeId: "hover-1",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Card",
      openedAt: 100,
      frameOpenedAt: 100,
      openChallengeId: "hover-1",
      hoverTrusted: true,
      selectedOption: "Card",
      selectedAt: 110,
      frameSelectedAt: 650,
      selectChallengeId: "hover-1",
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("hover-menu: replayed generation and non-increasing child timestamps → fail", () => {
  const ctx = mkCtx({
    hoverMenu: {
      challengeId: "hover-current",
      options: ["Card", "Bank transfer", "Kakao Pay"],
      expectedOption: "Card",
      openedAt: 100,
      frameOpenedAt: 500,
      openChallengeId: "hover-stale",
      hoverTrusted: true,
      selectedOption: "Card",
      selectedAt: 650,
      frameSelectedAt: 500,
      selectChallengeId: "hover-stale",
      trusted: true,
      completed: true,
    },
  });
  const r = hoverMenuSelection.run(ctx) as { evidence: Record<string, unknown>; rating: string };

  assert.equal(r.rating, "fail");
  assert.equal(r.evidence.challengeGenerationMismatch, true);
  assert.equal(r.evidence.nonMonotonicFrameTimestamps, true);
});

test("hover-menu: not attempted → inconclusive", () => {
  const r = hoverMenuSelection.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("in-page hover-menu: selected without trusted hover → fail", () => {
  const r = inPageHoverMenuSelection.run(
    mkCtx({
      inPageHoverMenu: {
        options: ["Card", "Bank transfer", "Kakao Pay"],
        expectedOption: "Card",
        openedAt: 0,
        hoverStartX: 0,
        hoverStartY: 0,
        selectedOption: "Card",
        selectedAt: 100,
        mouseSamples: 0,
        pathLength: 0,
        targetGap: 0,
        trusted: true,
        completed: true,
      },
    }),
  ) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("in-page hover-menu: zero dwell → fail", () => {
  const r = inPageHoverMenuSelection.run(
    mkCtx({
      inPageHoverMenu: {
        options: ["Card", "Bank transfer", "Kakao Pay"],
        expectedOption: "Bank transfer",
        openedAt: 100,
        hoverStartX: 100,
        hoverStartY: 100,
        selectedOption: "Bank transfer",
        selectedAt: 100,
        mouseSamples: 0,
        pathLength: 0,
        targetGap: 60,
        trusted: true,
        completed: true,
      },
    }),
  ) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("in-page hover-menu: trusted hover dwell and click → pass", () => {
  const r = inPageHoverMenuSelection.run(
    mkCtx({
      inPageHoverMenu: {
        options: ["Card", "Bank transfer", "Kakao Pay"],
        expectedOption: "Kakao Pay",
        openedAt: 100,
        hoverStartX: 100,
        hoverStartY: 100,
        selectedOption: "Kakao Pay",
        selectedAt: 650,
        mouseSamples: 8,
        pathLength: 92,
        targetGap: 68,
        trusted: true,
        completed: true,
      },
    }),
  ) as { rating: string };
  assert.equal(r.rating, "pass");
});

test("in-page hover-menu: synthetic click with human-like dwell → fail", () => {
  const r = inPageHoverMenuSelection.run(
    mkCtx({
      inPageHoverMenu: {
        options: ["Card", "Bank transfer", "Kakao Pay"],
        expectedOption: "Card",
        openedAt: 100,
        hoverStartX: 100,
        hoverStartY: 100,
        selectedOption: "Card",
        selectedAt: 650,
        mouseSamples: 0,
        pathLength: 0,
        targetGap: 68,
        trusted: false,
        completed: true,
      },
    }),
  ) as { rating: string };
  assert.equal(r.rating, "fail");
});

test("in-page hover-menu: correct dwell with a cursor teleport scores worse than a normal trail", () => {
  const base = {
    options: ["Card", "Bank transfer", "Kakao Pay"],
    expectedOption: "Card",
    openedAt: 100,
    hoverStartX: 100,
    hoverStartY: 100,
    selectedOption: "Card",
    selectedAt: 650,
    trusted: true,
    completed: true,
  };
  const normal = inPageHoverMenuSelection.run(
    mkCtx({ inPageHoverMenu: { ...base, mouseSamples: 9, pathLength: 88, targetGap: 64 } }),
  ) as { rating: string; score: number };
  const teleport = inPageHoverMenuSelection.run(
    mkCtx({ inPageHoverMenu: { ...base, mouseSamples: 0, pathLength: 0, targetGap: 64 } }),
  ) as { rating: string; score: number };

  assert.equal(normal.rating, "pass");
  assert.equal(teleport.rating, "fail");
  assert.ok(teleport.score > normal.score);
});

test("in-page hover-menu: not attempted → inconclusive", () => {
  const r = inPageHoverMenuSelection.run(mkCtx()) as { rating: string };
  assert.equal(r.rating, "inconclusive");
});

test("clipboard transfer passes only for trusted copy/paste with matching text", () => {
  const base = {
    expectedText: "CLIP-abc123",
    copied: true,
    copyTrusted: true,
    pasteTrusted: true,
    pastedText: "CLIP-abc123",
    value: "CLIP-abc123",
    copyEvents: 1,
    pasteEvents: 1,
    pasteInputEvents: 1,
    pasteInputTrusted: true,
    pasteInputType: "insertFromPaste",
    directInputEvents: 0,
    completed: true,
  };
  const pass = clipboardTransfer.run(mkCtx({ clipboardTransfer: base })) as { rating: string };
  assert.equal(pass.rating, "pass");

  const synthetic = clipboardTransfer.run(mkCtx({ clipboardTransfer: { ...base, pasteTrusted: false } })) as {
    rating: string;
  };
  assert.equal(synthetic.rating, "fail");

  const injected = clipboardTransfer.run(
    mkCtx({
      clipboardTransfer: {
        ...base,
        copied: false,
        pasteEvents: 0,
        pasteInputEvents: 0,
        pasteInputTrusted: null,
        pasteInputType: "",
        completed: false,
      },
    }),
  ) as { rating: string };
  assert.equal(injected.rating, "fail");

  const assignedAfterPaste = clipboardTransfer.run(
    mkCtx({
      clipboardTransfer: {
        ...base,
        pasteInputEvents: 0,
        pasteInputTrusted: null,
        pasteInputType: "",
        completed: false,
      },
    }),
  ) as { rating: string };
  assert.equal(assignedAfterPaste.rating, "fail");
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

test("trusted atomic iframe insertion only warns without keyboard dynamics", () => {
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
  assert.equal(r.rating, "warn");
  assert.equal(r.score, 35);
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

test("hover Shadow DOM challenge accepts only the expected frame, origin, nonce, and option", () => {
  const source = {} as MessageEventSource;
  const payload = {
    source: "hover-shadow-lab",
    challengeId: "hover-1",
    event: "select",
    selectedOption: "Bank transfer",
    isTrusted: true,
    timestamp: 250,
  } as const;
  const expected = {
    challengeId: "hover-1",
    origin: "https://frame.example",
    source,
    options: ["Card", "Bank transfer", "Kakao Pay"],
  };

  assert.deepEqual(parseHoverShadowMessage({ data: payload, origin: expected.origin, source }, expected), payload);
  assert.equal(parseHoverShadowMessage({ data: payload, origin: "https://spoof.example", source }, expected), null);
  assert.equal(
    parseHoverShadowMessage({ data: payload, origin: expected.origin, source: {} as MessageEventSource }, expected),
    null,
  );
  assert.equal(
    parseHoverShadowMessage({ data: { ...payload, challengeId: "stale" }, origin: expected.origin, source }, expected),
    null,
  );
  assert.equal(
    parseHoverShadowMessage(
      { data: { ...payload, selectedOption: "Crypto" }, origin: expected.origin, source },
      expected,
    ),
    null,
  );
});
