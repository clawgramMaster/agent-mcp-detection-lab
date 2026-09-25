import assert from "node:assert/strict";
import { test } from "node:test";
import { type Clock, createRoundJudge } from "../client/src/lib/sliderRound";

/** Deterministic clock: timers only run when the test advances time. */
class FakeClock implements Clock {
  private now = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.now = due[1].at;
      this.timers.delete(due[0]);
      due[1].fn();
    }
    this.now = target;
  }
  get pending(): number {
    return this.timers.size;
  }
}

function harness(opts: { failDelayMs?: number; aligned?: () => boolean } = {}) {
  const clock = new FakeClock();
  const log: string[] = [];
  let done = false;
  let aligned = opts.aligned ?? (() => true);
  const judge = createRoundJudge(
    {
      stopMs: 120,
      holdMs: 1500,
      isDone: () => done,
      isAligned: () => aligned(),
      onCountdownStart: () => log.push("countdown"),
      onCancel: () => log.push("cancel"),
      onPass: () => {
        done = true;
        log.push("pass");
      },
      onFail: () => log.push("fail"),
      onReroll: () => log.push("reroll"),
      failDelayMs: opts.failDelayMs,
    },
    clock,
  );
  return {
    clock,
    log,
    judge,
    setAligned: (fn: () => boolean) => {
      aligned = fn;
    },
  };
}

test("countdown starts only after the handle has been still for stopMs, and passes after holdMs", () => {
  const h = harness();
  h.judge.moved();
  h.clock.advance(119);
  assert.deepEqual(h.log, ["cancel"]); // still inside the stop window
  h.clock.advance(1);
  assert.deepEqual(h.log, ["cancel", "countdown"]);
  h.clock.advance(1499);
  assert.ok(!h.log.includes("pass")); // not judged before the hold ends
  h.clock.advance(1);
  assert.deepEqual(h.log, ["cancel", "countdown", "pass"]);
});

test("moving during the countdown resets it; only the restarted countdown is judged", () => {
  const h = harness();
  h.judge.moved();
  h.clock.advance(120 + 800); // countdown running, 800 ms in
  h.judge.moved(); // resets: the old hold timer must never fire
  h.clock.advance(120);
  h.clock.advance(1499);
  assert.equal(h.log.filter((l) => l === "pass").length, 0);
  h.clock.advance(1);
  assert.equal(h.log.filter((l) => l === "pass").length, 1);
  assert.equal(h.log.filter((l) => l === "countdown").length, 2);
});

test("alignment is read when the countdown ends, not when the handle last moved", () => {
  let inGap = false;
  const h = harness({ aligned: () => inGap });
  h.judge.moved();
  h.clock.advance(120);
  inGap = true; // e.g. the piece drifted into place while the countdown ran
  h.clock.advance(1500);
  assert.ok(h.log.includes("pass"));
});

test("a failed round with no delay rerolls immediately and stays unlocked", () => {
  const h = harness({ aligned: () => false });
  h.judge.moved();
  h.clock.advance(120 + 1500);
  assert.deepEqual(h.log, ["cancel", "countdown", "fail", "reroll"]);
  assert.equal(h.judge.locked, false);
});

test("with a fail delay the input is locked until the reroll, and a nudge starts no phantom countdown", () => {
  const h = harness({ aligned: () => false, failDelayMs: 900 });
  h.judge.moved();
  h.clock.advance(120 + 1500);
  assert.deepEqual(h.log, ["cancel", "countdown", "fail"]);
  assert.equal(h.judge.locked, true);

  // the regression from code review: nudging inside the failure message window
  h.judge.moved();
  h.clock.advance(899);
  assert.equal(h.log.filter((l) => l === "reroll").length, 0);
  h.clock.advance(1);
  assert.equal(h.log.filter((l) => l === "reroll").length, 1);
  assert.equal(h.judge.locked, false);

  // nothing left running: no second countdown, failure or reroll appears on its own
  h.clock.advance(10_000);
  assert.equal(h.log.filter((l) => l === "countdown").length, 1);
  assert.equal(h.log.filter((l) => l === "fail").length, 1);
  assert.equal(h.log.filter((l) => l === "reroll").length, 1);
  assert.equal(h.clock.pending, 0);
});

test("reroll drops pending timers", () => {
  const h = harness({ aligned: () => false });
  h.judge.moved();
  h.judge.reroll();
  h.clock.advance(10_000);
  assert.deepEqual(h.log, ["cancel", "reroll"]);
  assert.equal(h.clock.pending, 0);
});

test("once passed, movement is ignored and no reroll follows", () => {
  const h = harness();
  h.judge.moved();
  h.clock.advance(120 + 1500);
  assert.ok(h.log.includes("pass"));
  const before = h.log.length;
  h.judge.moved();
  h.judge.reroll();
  h.clock.advance(10_000);
  assert.equal(h.log.length, before);
  assert.equal(h.clock.pending, 0);
});
