import type { Rating, TestResult } from "../../../shared/types";

export type { TestResult, Rating };

/** A single detector unit. `run` returns a TestResult (may be async). */
export interface Detector {
  test: string;
  label: string;
  category: "static" | "interaction";
  run: (ctx: DetectorCtx) => Promise<TestResult> | TestResult;
}

/** Shared context passed to interaction detectors (behavioral buffers). */
export interface DetectorCtx {
  mouse: MouseSample[];
  keys: KeySample[];
  keyups: KeySample[];
  scrolls: EventSample[];
  wheels: WheelSample[];
  clicks: MouseSample[];
  focusEvents: EventSample[];
  formShownAt: number;
  submittedAt: number;
  pasted: boolean;
  /** honeypot: agent touched a control/field invisible to real humans */
  honeypotTriggered?: boolean;
  honeypotReasons?: string[];
  /** slider-drag task telemetry */
  slider?: SliderState;
  /** virtual security-keypad task telemetry (click-to-enter PIN, no keyboard) */
  keypad?: KeypadState;
  /** masked controlled input inside the nested certificate iframe task */
  iframeInput?: IframeInputState;
  /** native select changed through browser-generated keyboard input */
  nativeSelect?: NativeSelectState;
  /** click behavior across a DOM-churn node swap */
  detachedClick?: DetachedClickState;
  /** window.opener / referrer integrity of a target=_blank popup */
  popupCheck?: PopupCheckState;
  /** hover-to-reveal dropdown menu selection telemetry */
  hoverMenu?: HoverMenuState;
}

/**
 * Hover dropdown menu: a trigger reveals a small option list purely on
 * `mouseenter` (no click needed to open) and dismisses itself when the
 * pointer leaves both the trigger and the menu for something unrelated to
 * either — the classic desktop nav-menu hover pattern. Selecting an option
 * this way requires a REAL cursor to (1) dwell on the trigger long enough to
 * open it, then (2) travel into the menu and land on an option — a script
 * that opens the menu with a bare synthetic `mouseenter` and immediately
 * fires a click has no such dwell/travel time at all.
 */
export interface HoverMenuState {
  options: string[];
  /** performance.now() when the menu became visible via a real mouseenter, 0 = never opened */
  openedAt: number;
  selectedOption: string | null;
  selectedAt: number;
  trusted: boolean;
  completed: boolean;
}

/**
 * DOM-churn click task: a button is swapped for an equivalent replacement node
 * partway through the task. A real pointer can only ever hit whatever is
 * currently rendered; a script holding a stale JS reference to the original
 * element and calling `.click()` on it directly can "hit" a node that is no
 * longer in the document at all — something no physical cursor can do.
 */
export interface DetachedClickState {
  /** performance.now() when the original node was detached and replaced, 0 = not yet */
  swappedAt: number;
  originalClickedAt: number;
  /** true only if the click on the original arrived AFTER it was detached */
  originalClickedAfterSwap: boolean;
  originalTrusted: boolean;
  replacementClickedAt: number;
  replacementTrusted: boolean;
  completed: boolean;
}

/**
 * Popup opener/referrer integrity task: clicking a same-origin
 * `target="_blank" rel="opener"` link should leave `window.opener` set and
 * `document.referrer` populated in the new tab. Automation stacks that spawn
 * tabs via the DevTools Protocol (`Target.createTarget`) instead of a real
 * anchor navigation frequently lose that linkage. The popup reports its own
 * diagnostics back over a same-origin BroadcastChannel — a channel that works
 * regardless of whether `window.opener` survived, so a MISSING report after a
 * trusted click is itself informative (the tab never became a real
 * same-origin browsing context at all).
 */
export interface PopupCheckState {
  challengeId: string;
  clickedAt: number;
  trustedClick: boolean;
  completed: boolean;
  reportedAt: number;
  openerPresent: boolean | null;
  referrerNonEmpty: boolean | null;
  referrerOriginMatches: boolean | null;
}

export interface IframeInputState {
  eventCount: number;
  trustedInputEvents: number;
  untrustedInputEvents: number;
  trustedClickEvents: number;
  untrustedClickEvents: number;
  eventSamples: IframeInputEventSample[];
  expectedValue: string;
  controlledValue: string;
  complete: boolean;
  blurred: boolean;
  firstEventAt: number;
  completedAt: number;
}

export interface NativeSelectState {
  expectedValue: string;
  value: string;
  inputTrusted: boolean | null;
  changeTrusted: boolean | null;
  eventCount: number;
  complete: boolean;
}

export interface IframeInputEventSample {
  event: string;
  key: string;
  t: number;
  trusted: boolean;
}

export interface SliderState {
  target: number;
  value: number;
  /** value samples recorded during dragging */
  samples: { v: number; t: number; trusted: boolean }[];
  startedAt: number;
  releasedAt: number;
  completed: boolean;
}

/**
 * Virtual security keypad (like a bank / certificate-auth "secure keypad" that
 * accepts PIN entry only via on-screen clicks, never the physical keyboard, to
 * defeat keyloggers). The digit layout is randomized and RE-SHUFFLED after every
 * click, so a script cannot cache absolute screen coordinates across taps — it
 * must re-locate each digit's new position, same as a human reading the pad.
 */
export interface KeypadState {
  /** target PIN, e.g. [4, 8, 1, 5] */
  pin: number[];
  clicks: KeypadClick[];
  completed: boolean;
  /** true only if every digit was correct with no wrong taps */
  correct: boolean;
  wrongClicks: number;
  /** incremented every time the layout is reshuffled (after each accepted click) */
  shuffles: number;
}

export interface KeypadClick {
  digit: number;
  expectedDigit: number;
  t: number;
  /** absolute viewport coordinates of the click */
  x: number;
  y: number;
  /** click offset from the button's exact pixel center */
  dxCenter: number;
  dyCenter: number;
  /** mousemove samples observed since the previous keypad click */
  movesSincePrev: number;
  /** cursor path length (px) travelled since the previous keypad click */
  pathLenSincePrev: number;
  /** straight-line distance (px) between previous and current button centers
   *  (the layout reshuffles each click, so this is never a static offset) */
  targetGap: number;
  isTrusted: boolean;
}

export interface EventSample {
  t: number;
  isTrusted: boolean;
}

export interface WheelSample {
  t: number;
  deltaY: number;
  isTrusted: boolean;
}

export interface MouseSample {
  x: number;
  y: number;
  t: number;
  movementX: number;
  movementY: number;
  isTrusted: boolean;
  /** click only: offset from the clicked element's geometric center (px) */
  centerDx?: number;
  centerDy?: number;
  /** click only: clicked element size (px) */
  elW?: number;
  elH?: number;
}
export interface KeySample {
  key: string;
  t: number;
  isTrusted: boolean;
  /** whether the Shift modifier was held during this key event */
  shift?: boolean;
  /** CapsLock state — an uppercase letter with caps on needs no Shift */
  caps?: boolean;
  /** AltGraph (right Alt) — produces symbols without Shift on non-US layouts */
  altGraph?: boolean;
}

/** Helper to build a TestResult with sensible defaults. */
export function result(
  test: string,
  rating: Rating,
  score: number,
  evidence: Record<string, unknown> = {},
  label?: string,
  category: "static" | "interaction" = "static",
): TestResult {
  return { test, label, category, rating, score, evidence, timestamp: Date.now() };
}

/** Run a list of detectors, emitting each result as it completes. */
export async function runDetectors(
  detectors: Detector[],
  ctx: DetectorCtx,
  onResult: (r: TestResult) => void,
): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const d of detectors) {
    let r: TestResult;
    try {
      r = await d.run(ctx);
      r.label = r.label ?? d.label;
      r.category = r.category ?? d.category;
    } catch (e) {
      // an exception means we couldn't measure — inconclusive, never a penalty
      r = result(d.test, "inconclusive", 0, { error: String(e) }, d.label, d.category);
    }
    out.push(r);
    onResult(r);
    // small yield so the UI can paint between tests
    await new Promise((res) => setTimeout(res, 40));
  }
  return out;
}
