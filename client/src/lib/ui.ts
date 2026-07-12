import type { Rating, TestResult } from "../../../shared/types";

export function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function ratingBadge(r: Rating): HTMLElement {
  const label = r === "pass" ? "PASS" : r === "warn" ? "WARN" : "FAIL";
  return el("span", { class: `badge badge-${r}` }, label);
}

export function verdictLabel(r: Rating): string {
  return r === "pass" ? "🟢 Likely human" : r === "warn" ? "🟡 Suspicious" : "🔴 Likely bot";
}

/** A single test result row for the live list. */
export function resultRow(r: TestResult): HTMLElement {
  const row = el("div", { class: "result-row", "data-test": r.test });
  const head = el(
    "div",
    { class: "result-head" },
    el("span", { class: "result-name" }, r.label || r.test),
    ratingBadge(r.rating),
    el("span", { class: "result-score" }, `score ${r.score}`),
  );
  const ev = el("pre", { class: "result-evidence" }, JSON.stringify(r.evidence, null, 2));
  const toggle = el("button", { class: "evidence-toggle" }, "evidence");
  toggle.addEventListener("click", () => ev.classList.toggle("open"));
  head.append(toggle);
  row.append(head, ev);
  return row;
}

export function scoreMeter(botScore: number, verdict: Rating): HTMLElement {
  const wrap = el("div", { class: `meter meter-${verdict}` });
  wrap.append(
    el("div", { class: "meter-num" }, `${botScore}`),
    el("div", { class: "meter-label" }, `bot score / 100 — ${verdictLabel(verdict)}`),
  );
  return wrap;
}
