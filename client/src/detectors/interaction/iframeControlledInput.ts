import { type Detector, result } from "../../lib/detector";

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[], average = mean(values)): number {
  if (values.length === 0) return 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export const iframeControlledInput: Detector = {
  test: "iframeControlledInput",
  label: "Nested controlled-input task",
  category: "interaction",
  run: (ctx) => {
    const state = ctx.iframeInput;
    if (!state || state.eventCount === 0) {
      return result("iframeControlledInput", "inconclusive", 0, { attempted: false }, undefined, "interaction");
    }

    const evidence = {
      events: state.eventCount,
      trustedInputEvents: state.trustedInputEvents,
      untrustedInputEvents: state.untrustedInputEvents,
      expectedValue: state.expectedValue,
      controlledValue: state.controlledValue,
      complete: state.complete,
      blurred: state.blurred,
      durationMs:
        state.firstEventAt > 0 && state.completedAt >= state.firstEventAt
          ? Math.round(state.completedAt - state.firstEventAt)
          : null,
    };

    const samples = state.eventSamples ?? [];
    const keydowns = samples.filter((sample) => sample.event === "keydown");
    const keyups = samples.filter((sample) => sample.event === "keyup");
    const inputs = samples.filter((sample) => sample.event === "input");
    const inputGaps = inputs.slice(1).map((sample, index) => sample.t - inputs[index].t);
    const inputGapMean = mean(inputGaps);
    const inputGapStd = standardDeviation(inputGaps, inputGapMean);
    const inputGapCv = inputGapMean > 0 ? inputGapStd / inputGapMean : 0;

    const pendingDowns = new Map<string, number[]>();
    const dwells: number[] = [];
    for (const sample of samples) {
      if (sample.event === "keydown") {
        const queue = pendingDowns.get(sample.key) ?? [];
        queue.push(sample.t);
        pendingDowns.set(sample.key, queue);
      } else if (sample.event === "keyup") {
        const queue = pendingDowns.get(sample.key);
        const downAt = queue?.shift();
        if (downAt !== undefined && sample.t >= downAt) dwells.push(sample.t - downAt);
      }
    }
    const dwellMean = mean(dwells);
    const dwellStd = standardDeviation(dwells, dwellMean);
    const dynamics = {
      keydowns: keydowns.length,
      keyups: keyups.length,
      pairedDwells: dwells.length,
      meanDwellMs: +dwellMean.toFixed(1),
      dwellStdMs: +dwellStd.toFixed(1),
      meanInputGapMs: +inputGapMean.toFixed(1),
      inputGapCv: +inputGapCv.toFixed(3),
    };

    if (state.untrustedInputEvents > 0 && state.trustedInputEvents === 0) {
      return result("iframeControlledInput", "fail", 90, { ...evidence, ...dynamics }, undefined, "interaction");
    }
    if (state.complete && state.blurred && state.trustedInputEvents > 0) {
      let score = 0;
      if (keydowns.length === 0 || keyups.length === 0) score += 70;
      else if (dwells.length < Math.max(3, Math.floor(keydowns.length * 0.6))) score += 35;
      if (dwells.length >= 4 && dwellMean < 5) score += 40;
      if (dwells.length >= 4 && dwellStd < 1) score += 30;
      if (inputGaps.length >= 5 && inputGapMean < 20) score += 40;
      if (inputGaps.length >= 5 && inputGapCv < 0.08) score += 35;
      if (state.completedAt > state.firstEventAt && state.completedAt - state.firstEventAt < 250) score += 35;
      if (state.untrustedInputEvents > 0) {
        score = Math.max(score, 35);
      }
      score = Math.min(100, score);
      const rating = score >= 60 ? "fail" : score >= 25 ? "warn" : "pass";
      return result("iframeControlledInput", rating, score, { ...evidence, ...dynamics }, undefined, "interaction");
    }
    return result("iframeControlledInput", "inconclusive", 0, { ...evidence, ...dynamics }, undefined, "interaction");
  },
};
