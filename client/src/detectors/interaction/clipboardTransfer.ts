import { type Detector, result } from "../../lib/detector";

export const clipboardTransfer: Detector = {
  test: "clipboardTransfer",
  label: "Trusted clipboard transfer",
  category: "interaction",
  run: (ctx) => {
    const state = ctx.clipboardTransfer;
    if (!state || (state.copyEvents === 0 && state.pasteEvents === 0 && state.value === "")) {
      return result("clipboardTransfer", "inconclusive", 0, { attempted: false }, undefined, "interaction");
    }

    const evidence = {
      copyEvents: state.copyEvents,
      pasteEvents: state.pasteEvents,
      copyTrusted: state.copyTrusted,
      pasteTrusted: state.pasteTrusted,
      pasteInputEvents: state.pasteInputEvents,
      pasteInputTrusted: state.pasteInputTrusted,
      pasteInputType: state.pasteInputType,
      pastedTextMatches: state.pastedText === state.expectedText,
      valueMatches: state.value === state.expectedText,
      directInputEvents: state.directInputEvents,
      completed: state.completed,
    };
    if (state.copyTrusted === false || state.pasteTrusted === false || state.pasteInputTrusted === false) {
      return result("clipboardTransfer", "fail", 90, evidence, undefined, "interaction");
    }
    if (
      state.value === state.expectedText &&
      (state.pasteEvents === 0 || state.pasteInputEvents === 0 || state.pasteInputType !== "insertFromPaste")
    ) {
      return result("clipboardTransfer", "fail", 90, evidence, undefined, "interaction");
    }
    if (state.completed) return result("clipboardTransfer", "pass", 0, evidence, undefined, "interaction");
    return result("clipboardTransfer", "warn", 35, evidence, undefined, "interaction");
  },
};
