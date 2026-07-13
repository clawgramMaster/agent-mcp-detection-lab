import { type Detector, result } from "../../lib/detector";

/**
 * Slider-drag task (BeCAPTCHA-Mouse kinematics).
 *
 * "Drag the handle to N." A human drags with a continuous, noisy motion: dozens
 * of intermediate values, variable velocity, a little overshoot and micro-
 * correction near the target. An agent either sets the value directly (0–1
 * intermediate samples — a jump), drags in a perfectly linear ramp, or completes
 * it in superhuman time. The transition profile is the physical tell.
 */
export const sliderDrag: Detector = {
  test: "sliderDrag",
  label: "Slider drag kinematics",
  category: "interaction",
  run: (ctx) => {
    const s = ctx.slider;
    if (!s || s.samples.length === 0) {
      return result("sliderDrag", "inconclusive", 0, { note: "slider not attempted" }, undefined, "interaction");
    }
    if (!s.completed && s.value !== s.target) {
      return result(
        "sliderDrag",
        "inconclusive",
        0,
        { note: "slider incomplete", value: s.value },
        undefined,
        "interaction",
      );
    }

    const n = s.samples.length;
    const dragMs = s.releasedAt && s.startedAt ? s.releasedAt - s.startedAt : 0;
    const ev: Record<string, unknown> = { samples: n, dragMs, target: s.target, value: s.value };
    let score = 0;

    // 1) synthetic value change with (almost) no drag path → set directly
    if (n <= 2) {
      ev.jumped = true;
      score += 60;
    }

    // 2) untrusted samples
    const untrusted = s.samples.filter((x) => !x.trusted).length;
    if (untrusted > 0) {
      ev.untrusted = untrusted;
      score += 50;
    }

    if (n >= 4) {
      // 3) velocity variance — humans are noisy, linear ramps are robotic
      const steps: number[] = [];
      for (let i = 1; i < n; i++) steps.push(Math.abs(s.samples[i].v - s.samples[i - 1].v));
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      const std = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);
      const cv = mean > 0 ? std / mean : 0;
      ev.stepCv = +cv.toFixed(2);
      if (cv < 0.12) {
        ev.linearRamp = true;
        score += 25;
      }

      // 4) overshoot: did the value ever pass the target and come back? humans do
      const vals = s.samples.map((x) => x.v);
      const maxV = Math.max(...vals);
      const minV = Math.min(...vals);
      const overshot = s.target > vals[0] ? maxV > s.target : minV < s.target;
      ev.overshoot = overshot;
      // no micro-correction on a many-sample drag is slightly bot-like
      if (!overshot && n >= 10 && cv < 0.2) score += 10;
    }

    // 5) superhuman drag speed
    if (dragMs > 0 && dragMs < 120) {
      ev.superhuman = true;
      score += 30;
    }

    score = Math.min(100, score);
    const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
    return result("sliderDrag", rating, score, ev, undefined, "interaction");
  },
};
