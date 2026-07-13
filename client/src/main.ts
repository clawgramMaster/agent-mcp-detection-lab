import "./style.css";
import { currentRunner } from "./lib/api";
import { el } from "./lib/ui";
import { renderHome } from "./pages/home";
import { renderReport } from "./pages/report";

function navLink(hash: string, label: string, current: string): HTMLElement {
  return el("a", { href: hash, class: `nav-link${current === hash ? " nav-link-active" : ""}` }, label);
}

function mount() {
  const app = document.getElementById("app");
  if (!app) return;
  const route = location.hash === "#report" ? "#report" : "#lab";

  app.innerHTML = "";
  const nav = el(
    "nav",
    { class: "topnav" },
    el("span", { class: "brand" }, "AgentMcpLab"),
    el("span", { class: "nav-links" }, navLink("#lab", "Lab", route), navLink("#report", "Report", route)),
    el("span", { class: "runner-tag" }, `runner: ${currentRunner()}`),
  );
  const view = el("main", { class: "view" });
  app.append(nav, view);

  if (route === "#report") renderReport(view);
  else renderHome(view);
}

window.addEventListener("hashchange", mount);
mount();
