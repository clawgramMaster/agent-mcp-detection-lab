import type { Session } from "../../../shared/types";
import { fetchCompare, fetchSessions } from "../lib/api";
import { el, ratingBadge, verdictLabel } from "../lib/ui";

export function renderReport(root: HTMLElement) {
  root.innerHTML = "";
  const controls = el("div", { class: "report-controls" });
  const aInput = el("input", { class: "field", value: "agent-browser" }) as HTMLInputElement;
  const bInput = el("input", { class: "field", value: "patchright" }) as HTMLInputElement;
  const pageSel = el("select", { class: "field" }) as HTMLSelectElement;
  pageSel.append(new Option("static", "static"), new Option("interaction", "interaction"));
  const runBtn = el("button", { class: "btn-primary" }, "Compare") as HTMLButtonElement;
  const liveBtn = el("button", { class: "btn-ghost" }, "◉ Live") as HTMLButtonElement;

  controls.append(
    el("label", {}, "Runner A", aInput),
    el("label", {}, "Runner B", bInput),
    el("label", {}, "Page", pageSel),
    runBtn,
    liveBtn,
  );

  const diffHost = el("div", { class: "diff-host" });
  const sessionsHost = el("div", { class: "sessions-host" });

  root.append(
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Report"),
      el("p", { class: "muted" }, "Per-test pass/warn/fail, raw JSON, and agent-browser vs patchright diff."),
    ),
    controls,
    diffHost,
    el("h2", {}, "Recent sessions"),
    sessionsHost,
  );

  async function loadCompare() {
    diffHost.innerHTML = "Loading…";
    const cmp = await fetchCompare(aInput.value.trim(), bInput.value.trim(), pageSel.value);
    diffHost.innerHTML = "";
    diffHost.append(renderDiffTable(cmp.a, cmp.b, cmp.diff, aInput.value.trim(), bInput.value.trim()));
  }

  async function loadSessions() {
    const sessions = await fetchSessions({ page: pageSel.value, limit: 30 });
    sessionsHost.innerHTML = "";
    if (!sessions.length) {
      sessionsHost.append(el("p", { class: "muted" }, "No sessions yet. Run /static or /interaction."));
      return;
    }
    sessions.forEach((s) => sessionsHost.append(sessionCard(s)));
  }

  runBtn.addEventListener("click", () => {
    loadCompare();
    loadSessions();
  });
  pageSel.addEventListener("change", () => {
    loadCompare();
    loadSessions();
  });

  // SSE live feed
  let es: EventSource | null = null;
  liveBtn.addEventListener("click", () => {
    if (es) {
      es.close();
      es = null;
      liveBtn.classList.remove("live-on");
      liveBtn.textContent = "◉ Live";
      return;
    }
    es = new EventSource(`/api/stream?page=${pageSel.value}`);
    liveBtn.classList.add("live-on");
    liveBtn.textContent = "● Live";
    es.addEventListener("session", (ev) => {
      const s: Session = JSON.parse((ev as MessageEvent).data);
      sessionsHost.prepend(sessionCard(s, true));
      loadCompare();
    });
    es.onerror = () => {
      /* keep retrying; browser auto-reconnects */
    };
  });

  loadCompare();
  loadSessions();
}

function renderDiffTable(
  a: Session | null,
  b: Session | null,
  diff: Record<string, { a?: string; b?: string; changed: boolean }>,
  aName: string,
  bName: string,
) {
  const wrap = el("div", { class: "diff-table" });
  wrap.append(
    el(
      "div",
      { class: "diff-summary" },
      summaryChip(aName, a),
      el("span", { class: "vs" }, "vs"),
      summaryChip(bName, b),
    ),
  );
  const table = el("table", { class: "tbl" });
  const thead = el(
    "thead",
    {},
    el("tr", {}, el("th", {}, "Test"), el("th", {}, aName), el("th", {}, bName), el("th", {}, "Δ")),
  );
  const tbody = el("tbody");
  Object.entries(diff)
    .sort()
    .forEach(([test, d]) => {
      const tr = el(
        "tr",
        d.changed ? { class: "changed" } : {},
        el("td", {}, test),
        el("td", {}, d.a ? ratingBadge(d.a as any) : el("span", { class: "muted" }, "—")),
        el("td", {}, d.b ? ratingBadge(d.b as any) : el("span", { class: "muted" }, "—")),
        el("td", {}, d.changed ? "⚠︎" : ""),
      );
      tbody.append(tr);
    });
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function summaryChip(name: string, s: Session | null): HTMLElement {
  if (!s) return el("div", { class: "chip chip-empty" }, `${name}: no data`);
  return el(
    "div",
    { class: `chip chip-${s.verdict}` },
    el("strong", {}, name),
    ` · botScore ${s.botScore} · ${verdictLabel(s.verdict)}`,
  );
}

function sessionCard(s: Session, isNew = false): HTMLElement {
  const card = el("div", { class: `session-card${isNew ? " session-new" : ""}` });
  const head = el(
    "div",
    { class: "session-head" },
    el("span", { class: "session-runner" }, s.runner),
    ratingBadge(s.verdict),
    el("span", { class: "session-score" }, `botScore ${s.botScore}`),
    el("span", { class: "muted session-time" }, new Date(s.createdAt).toLocaleTimeString()),
  );
  const fails =
    s.results
      .filter((r) => r.rating !== "pass")
      .map((r) => `${r.test}(${r.rating})`)
      .join(", ") || "all pass";
  const net = s.network?.tlsVersion ? ` · ${s.network.tlsVersion}/${s.network.httpProtocol}` : "";
  card.append(head, el("div", { class: "session-body muted" }, fails + net));
  const raw = el("pre", { class: "result-evidence" }, JSON.stringify(s, null, 2));
  const t = el("button", { class: "evidence-toggle" }, "raw JSON");
  t.addEventListener("click", () => raw.classList.toggle("open"));
  head.append(t);
  card.append(raw);
  return card;
}
