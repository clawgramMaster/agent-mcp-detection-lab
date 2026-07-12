import { el } from "../lib/ui";

export function renderHome(root: HTMLElement) {
  root.innerHTML = "";
  root.append(
    el(
      "div",
      { class: "hero" },
      el("h1", {}, "AgentMcpLab"),
      el(
        "p",
        { class: "lead" },
        "A self-hosted lab that detects browser-automation agents — webdriver, CDP, headless & behavioral signals — and compares runners side by side.",
      ),
      el(
        "div",
        { class: "cards" },
        card(
          "/static",
          "Static probes",
          "Fingerprint, CDP leaks, automation-framework globals, headless, client-hints & prototype-tampering signals.",
        ),
        card(
          "/interaction",
          "Interaction probes",
          "Mouse trajectory, keystroke cadence, isTrusted & superhuman-submit checks.",
        ),
        card("/report", "Report", "Per-test pass/warn/fail, raw JSON, and agent-browser vs patchright diff."),
      ),
      el(
        "p",
        { class: "muted disclaimer" },
        "Detection principles are re-implemented from public research (FPScanner, Rebrowser, CreepJS, BotD, BeCAPTCHA-Mouse). No third-party service code is copied.",
      ),
    ),
  );
}

function card(href: string, title: string, desc: string): HTMLElement {
  const a = el(
    "a",
    { href, class: "nav-card", "data-link": "" },
    el("h3", {}, title),
    el("p", { class: "muted" }, desc),
  );
  return a;
}
