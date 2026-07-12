import { aggregate } from "../../../shared/types";
import { interactionDetectors } from "../detectors";
import { currentRunner, submitResults } from "../lib/api";
import { type DetectorCtx, type KeySample, type MouseSample, runDetectors } from "../lib/detector";
import { el, resultRow, scoreMeter } from "../lib/ui";

export function renderInteraction(root: HTMLElement) {
  root.innerHTML = "";

  const ctx: DetectorCtx = {
    mouse: [],
    keys: [],
    scrolls: [],
    clicks: [],
    focusEvents: [],
    formShownAt: Date.now(),
    submittedAt: 0,
    pasted: false,
  };

  // --- capture behavioral signals ---
  const onMove = (e: MouseEvent) => {
    ctx.mouse.push({
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      movementX: e.movementX,
      movementY: e.movementY,
      isTrusted: e.isTrusted,
    } as MouseSample);
    if (ctx.mouse.length > 2000) ctx.mouse.shift();
  };
  const onScroll = () => ctx.scrolls.push({ t: performance.now(), isTrusted: true });
  const onClick = (e: MouseEvent) =>
    ctx.clicks.push({
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      movementX: e.movementX,
      movementY: e.movementY,
      isTrusted: e.isTrusted,
    } as MouseSample);
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("click", onClick, { passive: true });

  const form = el("form", { class: "login-form", autocomplete: "off" }) as HTMLFormElement;
  const user = el("input", {
    type: "text",
    name: "username",
    placeholder: "username",
    class: "field",
  }) as HTMLInputElement;
  const pass = el("input", {
    type: "password",
    name: "password",
    placeholder: "password",
    class: "field",
  }) as HTMLInputElement;

  const onKey = (e: KeyboardEvent) => {
    ctx.keys.push({ key: e.key, t: performance.now(), isTrusted: e.isTrusted } as KeySample);
  };
  const onPaste = () => {
    ctx.pasted = true;
  };
  const onFocus = (e: FocusEvent) => ctx.focusEvents.push({ t: performance.now(), isTrusted: e.isTrusted });
  [user, pass].forEach((f) => {
    f.addEventListener("keydown", onKey);
    f.addEventListener("paste", onPaste);
    f.addEventListener("focus", onFocus);
  });

  const submit = el("button", { type: "submit", class: "btn-primary" }, "Sign in") as HTMLButtonElement;
  form.append(el("label", {}, "Username", user), el("label", {}, "Password", pass), submit);

  const list = el("div", { class: "result-list" });
  const meterHost = el("div", { class: "meter-host" });
  const status = el(
    "div",
    { class: "status" },
    "Move your mouse and type to generate a behavioral profile, then sign in.",
  );

  root.append(
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Interaction probes"),
      el("p", { class: "muted" }, `Mouse, keystroke & isTrusted analysis. Runner: ${currentRunner()}`),
    ),
    form,
    meterHost,
    status,
    list,
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctx.submittedAt = Date.now();
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("click", onClick);
    submit.disabled = true;
    list.innerHTML = "";
    status.textContent = "Analyzing behavior…";

    const results = await runDetectors(interactionDetectors, ctx, (r) => list.append(resultRow(r)));
    const { botScore, verdict } = aggregate(results);
    meterHost.innerHTML = "";
    meterHost.append(scoreMeter(botScore, verdict));
    try {
      const res = await submitResults("interaction", results);
      status.innerHTML = `Stored ✓ session <code>${res.sessionId.slice(0, 8)}</code> · server botScore ${res.botScore}`;
    } catch (err) {
      status.textContent = `Stored locally only (API unavailable): ${String(err)}`;
    }
  });
}
