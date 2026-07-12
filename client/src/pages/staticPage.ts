import { aggregate } from "../../../shared/types";
import { staticDetectors } from "../detectors";
import { currentRunner, submitResults } from "../lib/api";
import { type DetectorCtx, runDetectors } from "../lib/detector";
import { el, resultRow, scoreMeter } from "../lib/ui";

export function renderStatic(root: HTMLElement) {
  root.innerHTML = "";
  const list = el("div", { class: "result-list" });
  const meterHost = el("div", { class: "meter-host" });
  const status = el("div", { class: "status" }, "Running static probes…");

  root.append(
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Static probes"),
      el("p", { class: "muted" }, `Page-load fingerprint, CDP & headless signals. Runner: ${currentRunner()}`),
    ),
    meterHost,
    status,
    list,
  );

  const ctx: DetectorCtx = {
    mouse: [],
    keys: [],
    keyups: [],
    scrolls: [],
    clicks: [],
    focusEvents: [],
    formShownAt: 0,
    submittedAt: 0,
    pasted: false,
  };

  runDetectors(staticDetectors, ctx, (r) => {
    list.append(resultRow(r));
  }).then(async (results) => {
    const { botScore, verdict } = aggregate(results);
    meterHost.append(scoreMeter(botScore, verdict));
    status.textContent = "Submitting…";
    try {
      const res = await submitResults("static", results);
      status.innerHTML = `Stored ✓ session <code>${res.sessionId.slice(0, 8)}</code> · server botScore ${res.botScore}`;
    } catch (e) {
      status.textContent = `Stored locally only (API unavailable): ${String(e)}`;
    }
  });
}
