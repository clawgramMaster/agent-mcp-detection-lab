import "./style.css";
import { currentRunner } from "./lib/api";
import { el } from "./lib/ui";
import { renderHome } from "./pages/home";
import { renderInteraction } from "./pages/interactionPage";
import { renderReport } from "./pages/reportPage";
import { renderStatic } from "./pages/staticPage";

const routes: Record<string, (root: HTMLElement) => void> = {
  "/": renderHome,
  "/static": renderStatic,
  "/interaction": renderInteraction,
  "/report": renderReport,
};

function mountShell(): { view: HTMLElement } {
  const app = document.getElementById("app")!;
  app.innerHTML = "";
  const nav = el(
    "nav",
    { class: "topnav" },
    link("/", "AgentMcpLab", "brand"),
    el(
      "div",
      { class: "nav-links" },
      link("/static", "Static"),
      link("/interaction", "Interaction"),
      link("/report", "Report"),
    ),
    el("span", { class: "runner-tag" }, `runner: ${currentRunner()}`),
  );
  const view = el("main", { class: "view" });
  app.append(nav, view);
  return { view };
}

function link(href: string, label: string, cls = ""): HTMLElement {
  const a = el("a", { href, class: `navlink ${cls}`.trim(), "data-link": "" }, label);
  return a;
}

function render() {
  const path = location.pathname;
  const { view } = mountShell();
  const r = routes[path] || routes["/"];
  document.querySelectorAll(".navlink").forEach((a) => {
    a.classList.toggle("active", (a as HTMLAnchorElement).pathname === path);
  });
  r(view);
}

// SPA navigation
document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest("a[data-link]") as HTMLAnchorElement | null;
  if (!target) return;
  if (target.origin !== location.origin) return;
  e.preventDefault();
  if (target.pathname !== location.pathname) {
    history.pushState({}, "", target.pathname);
    render();
  }
});
window.addEventListener("popstate", render);

render();
