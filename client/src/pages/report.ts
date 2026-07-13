import type { Session } from "../../../shared/types";
import { fetchSessions } from "../lib/api";
import { el } from "../lib/ui";

/**
 * Report / compare view — the lab's raison d'être: see how different automation
 * runners score against the same detectors. Read-only; data comes from
 * GET /api/sessions (most recent runs, tagged by ?runner=).
 */
export function renderReport(root: HTMLElement) {
  root.innerHTML = "";
  root.append(
    el(
      "div",
      { class: "home-hero" },
      el("h1", {}, "Runner comparison"),
      el(
        "p",
        { class: "muted lead" },
        "Recent runs, tagged by runner. Drive the lab with ?runner=<name> (e.g. ?runner=patchright) so each automation backend records a labelled session here.",
      ),
    ),
  );

  const status = el("div", { class: "status" }, "Loading recent runs…");
  const listWrap = el("div", { class: "report-wrap" });
  root.append(status, listWrap);

  fetchSessions({ limit: 100 })
    .then((sessions) => {
      if (!Array.isArray(sessions) || sessions.length === 0) {
        status.textContent = "No runs recorded yet. Complete the challenge on the Lab page, or drive it with ?runner=.";
        return;
      }
      status.textContent = `${sessions.length} recent run(s).`;
      listWrap.append(summaryByRunner(sessions), recentTable(sessions));
    })
    .catch(() => {
      status.textContent = "Could not load runs (is the API deployed?).";
    });
}

/** Latest botScore per runner+page — the headline comparison. */
function summaryByRunner(sessions: Session[]): HTMLElement {
  const latest = new Map<string, Session>(); // key runner|page → newest session
  for (const s of sessions) {
    const k = `${s.runner}|${s.page}`;
    const prev = latest.get(k);
    if (!prev || s.createdAt > prev.createdAt) latest.set(k, s);
  }
  const rows = [...latest.values()].sort((a, b) => a.runner.localeCompare(b.runner) || a.page.localeCompare(b.page));

  const table = el("table", { class: "report-table" });
  table.append(
    el(
      "thead",
      {},
      el("tr", {}, el("th", {}, "runner"), el("th", {}, "page"), el("th", {}, "botScore"), el("th", {}, "verdict")),
    ),
  );
  const tbody = el("tbody", {});
  for (const s of rows) {
    tbody.append(
      el(
        "tr",
        {},
        el("td", {}, s.runner),
        el("td", {}, s.page),
        el("td", { class: "num" }, String(s.botScore)),
        el("td", {}, el("span", { class: `pill pill-${s.verdict}` }, s.verdict)),
      ),
    );
  }
  table.append(tbody);
  return el("section", { class: "home-section" }, el("h2", {}, "Latest score per runner"), table);
}

/** Raw recent runs feed. */
function recentTable(sessions: Session[]): HTMLElement {
  const table = el("table", { class: "report-table" });
  table.append(
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", {}, "when"),
        el("th", {}, "runner"),
        el("th", {}, "page"),
        el("th", {}, "botScore"),
        el("th", {}, "verdict"),
      ),
    ),
  );
  const tbody = el("tbody", {});
  for (const s of sessions.slice(0, 50)) {
    tbody.append(
      el(
        "tr",
        {},
        el("td", { class: "muted" }, new Date(s.createdAt).toLocaleString()),
        el("td", {}, s.runner),
        el("td", {}, s.page),
        el("td", { class: "num" }, String(s.botScore)),
        el("td", {}, el("span", { class: `pill pill-${s.verdict}` }, s.verdict)),
      ),
    );
  }
  table.append(tbody);
  return el("section", { class: "home-section" }, el("h2", {}, "Recent runs"), table);
}
