import { type Detector, result } from "../../lib/detector";

export const nativeSelect: Detector = {
  test: "nativeSelect",
  label: "Native select trusted input",
  category: "interaction",
  run: (ctx) => {
    const state = ctx.nativeSelect;
    if (!state || state.eventCount === 0) {
      return result("nativeSelect", "inconclusive", 0, { attempted: false }, undefined, "interaction");
    }
    const evidence = {
      expectedValue: state.expectedValue,
      value: state.value,
      inputTrusted: state.inputTrusted,
      changeTrusted: state.changeTrusted,
      events: state.eventCount,
      complete: state.complete,
    };
    if (state.inputTrusted === false || state.changeTrusted === false) {
      return result("nativeSelect", "fail", 90, evidence, undefined, "interaction");
    }
    if (state.complete && state.inputTrusted === true && state.changeTrusted === true) {
      return result("nativeSelect", "pass", 0, evidence, undefined, "interaction");
    }
    return result("nativeSelect", "warn", 35, evidence, undefined, "interaction");
  },
};
