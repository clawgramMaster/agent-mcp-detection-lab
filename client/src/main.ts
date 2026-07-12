import "./style.css";
import { currentRunner } from "./lib/api";
import { el } from "./lib/ui";
import { renderHome } from "./pages/home";

function mount() {
  const app = document.getElementById("app")!;
  app.innerHTML = "";
  const nav = el(
    "nav",
    { class: "topnav" },
    el("span", { class: "brand" }, "AgentMcpLab"),
    el("span", { class: "runner-tag" }, `runner: ${currentRunner()}`),
  );
  const view = el("main", { class: "view" });
  app.append(nav, view);
  renderHome(view);
}

mount();
