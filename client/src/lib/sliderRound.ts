/**
 * One judged slider round, shared by every slider task (the rotation puzzle and the
 * human-verification widget), so the pass rule can only be defined once:
 *
 *   move the handle → any movement cancels the countdown → after `stopMs` without movement a
 *   `holdMs` countdown starts → when it ends the round is judged: aligned = pass, otherwise the
 *   round fails and a fresh one is dealt (immediately, or after `failDelayMs` while the input is
 *   locked so a nudge cannot start a countdown that would outlive the reroll).
 *
 * DOM-free on purpose: the caller supplies what "aligned" means and how to draw each state, and a
 * clock can be injected for tests.
 */
export interface Clock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const defaultClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

export interface RoundConfig {
  /** No movement for this long counts as "the handle stopped". */
  stopMs: number;
  /** How long the handle must then stay still before the round is judged. */
  holdMs: number;
  /** The round was already passed; nothing more is scheduled. */
  isDone(): boolean;
  /** Is the handle in the winning position right now? */
  isAligned(): boolean;
  /** The still period ended and the hold countdown begins (draw it). */
  onCountdownStart(): void;
  /** Movement (or a reroll) aborted a pending or running countdown (draw the idle state). */
  onCancel(): void;
  onPass(): void;
  /** The countdown ended off target; show the failure. `reroll` follows after `failDelayMs`. */
  onFail(): void;
  /** Deal the next round: new picture, target and start position, telemetry reset. */
  onReroll(): void;
  /** Wait this long (input locked) between the failure message and the reroll. Default 0. */
  failDelayMs?: number;
}

export interface RoundJudge {
  /** Call after every handle movement. Ignored while locked or once the round is passed. */
  moved(): void;
  /** True while the failure message shows; pointer handlers should ignore input then. */
  readonly locked: boolean;
  /** Drop pending timers and deal the next round now. */
  reroll(): void;
  /** Drop pending timers without dealing a new round (e.g. the round expired). */
  cancel(): void;
}

export function createRoundJudge(config: RoundConfig, clock: Clock = defaultClock): RoundJudge {
  let stopTimer = 0;
  let holdTimer = 0;
  let rerollTimer = 0;
  let locked = false;

  const clearTimers = () => {
    clock.clearTimeout(stopTimer);
    clock.clearTimeout(holdTimer);
    clock.clearTimeout(rerollTimer);
    stopTimer = 0;
    holdTimer = 0;
    rerollTimer = 0;
  };

  const reroll = () => {
    clearTimers();
    locked = false;
    if (config.isDone()) return;
    config.onReroll();
  };

  const judge = () => {
    holdTimer = 0;
    if (config.isDone()) return;
    if (config.isAligned()) {
      config.onPass();
      return;
    }
    config.onFail();
    const delay = config.failDelayMs ?? 0;
    if (delay > 0) {
      locked = true;
      rerollTimer = clock.setTimeout(reroll, delay);
    } else {
      reroll();
    }
  };

  const startCountdown = () => {
    stopTimer = 0;
    config.onCountdownStart();
    holdTimer = clock.setTimeout(judge, config.holdMs);
  };

  return {
    moved() {
      if (locked || config.isDone()) return;
      // moving resets the countdown; it (re)starts only once the handle has been still for stopMs
      clock.clearTimeout(stopTimer);
      clock.clearTimeout(holdTimer);
      holdTimer = 0;
      config.onCancel();
      stopTimer = clock.setTimeout(startCountdown, config.stopMs);
    },
    get locked() {
      return locked;
    },
    reroll,
    cancel() {
      clearTimers();
      locked = false;
    },
  };
}
