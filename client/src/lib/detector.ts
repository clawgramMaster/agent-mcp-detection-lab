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
  /** per-step reaction latency (ms) from instruction shown → action performed */
  stepLatencies?: number[];
  /** multi-step grid challenge telemetry */
  grid?: GridState;
  /** slider-drag task telemetry */
  slider?: SliderState;
  /** "click when it turns green" delayed-button task telemetry */
  delayed?: DelayedState;
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

export interface DelayedState {
  /** when the button became enabled (turned green) */
  enabledAt: number;
  /** when it was actually clicked */
  clickedAt: number;
  clickedBeforeEnable: boolean;
  trusted: boolean;
}

export interface GridClick {
  tile: number;
  t: number;
  /** click offset from the tile's exact pixel center */
  dxCenter: number;
  dyCenter: number;
  /** mousemove samples observed since the previous grid click */
  movesSincePrev: number;
  /** cursor path length (px) travelled since the previous grid click */
  pathLenSincePrev: number;
  /** straight-line distance (px) between previous and current tile centers */
  tileGap: number;
  isTrusted: boolean;
}

export interface GridState {
  targetOrder: number[];
  shownAt: number;
  clicks: GridClick[];
  completed: boolean;
  correct: boolean;
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
