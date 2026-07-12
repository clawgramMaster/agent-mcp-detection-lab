import { type Rating, type TestResult, aggregate } from "../../../shared/types";
import { interactionDetectors, staticDetectors } from "../detectors";
import { currentRunner, fetchInspect, submitResults } from "../lib/api";
import { type DetectorCtx, type KeySample, type MouseSample, runDetectors } from "../lib/detector";
import { el, resultRow, scoreLabel } from "../lib/ui";

export function renderHome(root: HTMLElement) {
  root.innerHTML = "";

  let staticResults: TestResult[] = [];
  let interactionResults: TestResult[] = [];

  // ---------- top verdict banner ----------
  const verdictNum = el("div", { class: "verdict-num" }, "…");
  const verdictText = el("div", { class: "verdict-text muted" }, "Running checks…");
  const banner = el("div", { class: "verdict-banner meter-warn" }, verdictNum, el("div", {}, verdictText));

  function refreshVerdict() {
    const all = [...staticResults, ...interactionResults];
    const { botScore, verdict } = aggregate(all);
    verdictNum.textContent = String(botScore);
    banner.className = `verdict-banner meter-${verdict}`;
    const done = interactionResults.length > 0 ? "" : " · behavioral test pending — fill the form below";
    verdictText.innerHTML = "";
    verdictText.append(
      el("span", { class: "verdict-tag" }, scoreLabel(botScore)),
      ` · bot score ${botScore}/100${done}`,
    );
    return verdict;
  }

  root.append(
    el(
      "div",
      { class: "home-hero" },
      el("h1", {}, "Is this browser a bot?"),
      el(
        "p",
        { class: "muted lead" },
        "The moment you land, we scan for fingerprint, CDP and automation traces — then the login form below analyzes your mouse and keyboard behavior. A real human turns it green; an automation agent (Playwright, Selenium, agent-browser, …) turns it red.",
      ),
    ),
    banner,
  );

  // ---------- Section 1: static (auto) ----------
  const staticList = el("div", { class: "result-list" });
  const staticStatus = el("div", { class: "status" }, "Running page-load checks…");
  root.append(section("① Passive checks", "Run just by opening the page — no clicks needed", staticStatus, staticList));

  const emptyCtx: DetectorCtx = {
    mouse: [],
    keys: [],
    keyups: [],
    scrolls: [],
    wheels: [],
    clicks: [],
    focusEvents: [],
    formShownAt: 0,
    submittedAt: 0,
    pasted: false,
  };

  runDetectors(staticDetectors, emptyCtx, (r) => staticList.append(resultRow(r))).then(async (results) => {
    // merge server-side header/TLS inspection (signals JS can't see)
    const serverResults = await fetchInspect();
    for (const r of serverResults) staticList.append(resultRow(r));
    staticResults = [...results, ...serverResults];
    const failed = staticResults.filter((r) => r.rating === "fail").length;
    staticStatus.textContent = failed
      ? `Passive checks done — ${failed} test(s) flagged automation traces`
      : "Passive checks done — no static traces found";
    refreshVerdict();
    try {
      await submitResults("static", staticResults);
    } catch {
      /* offline ok */
    }
  });

  // ---------- Section 2: interaction (login form) ----------
  const ctx: DetectorCtx = {
    mouse: [],
    keys: [],
    keyups: [],
    scrolls: [],
    wheels: [],
    clicks: [],
    focusEvents: [],
    formShownAt: Date.now(),
    submittedAt: 0,
    pasted: false,
  };
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
  const onWheel = (e: WheelEvent) =>
    ctx.wheels.push({ t: performance.now(), deltaY: e.deltaY, isTrusted: e.isTrusted });
  const onClick = (e: MouseEvent) => {
    const s: MouseSample = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      movementX: e.movementX,
      movementY: e.movementY,
      isTrusted: e.isTrusted,
    };
    const tgt = e.target as Element | null;
    if (tgt && typeof tgt.getBoundingClientRect === "function") {
      const r = tgt.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        s.centerDx = e.clientX - (r.left + r.width / 2);
        s.centerDy = e.clientY - (r.top + r.height / 2);
        s.elW = r.width;
        s.elH = r.height;
      }
    }
    ctx.clicks.push(s);
  };
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("click", onClick, { passive: true });

  const form = el("form", { class: "login-form", autocomplete: "off" }) as HTMLFormElement;
  const user = el("input", {
    type: "text",
    name: "username",
    placeholder: "type anything",
    class: "field",
  }) as HTMLInputElement;
  const pass = el("input", {
    type: "password",
    name: "password",
    placeholder: "type anything",
    class: "field",
  }) as HTMLInputElement;
  const onKey = (e: KeyboardEvent) =>
    ctx.keys.push({ key: e.key, t: performance.now(), isTrusted: e.isTrusted, shift: e.shiftKey } as KeySample);
  const onKeyUp = (e: KeyboardEvent) =>
    ctx.keyups.push({ key: e.key, t: performance.now(), isTrusted: e.isTrusted, shift: e.shiftKey } as KeySample);
  const onPaste = () => {
    ctx.pasted = true;
  };
  const onFocus = (e: FocusEvent) => ctx.focusEvents.push({ t: performance.now(), isTrusted: e.isTrusted });
  for (const f of [user, pass]) {
    f.addEventListener("keydown", onKey);
    f.addEventListener("keyup", onKeyUp);
    f.addEventListener("paste", onPaste);
    f.addEventListener("focus", onFocus);
  }
  const submit = el(
    "button",
    { type: "submit", class: "btn-primary" },
    "Sign in (run behavioral test)",
  ) as HTMLButtonElement;
  form.append(el("label", {}, "Username", user), el("label", {}, "Password", pass), submit);

  const interList = el("div", { class: "result-list" });
  const interStatus = el(
    "div",
    { class: "status" },
    "Move your mouse, type in the fields above, then sign in. The hardest signal to fake — stealth bots pass every static check but can't reproduce human motion.",
  );
  root.append(
    section(
      "② Behavioral checks (the decisive one)",
      "Mouse trajectory, keystroke rhythm & event trust — like a real login",
      form,
      interStatus,
      interList,
    ),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctx.submittedAt = Date.now();
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("click", onClick);
    submit.disabled = true;
    interList.innerHTML = "";
    interStatus.textContent = "Analyzing behavior…";
    const results = await runDetectors(interactionDetectors, ctx, (r) => interList.append(resultRow(r)));
    interactionResults = results;
    const v: Rating = refreshVerdict();
    interStatus.textContent =
      v === "fail"
        ? "Behavioral test done — classified as BOT"
        : v === "warn"
          ? "Behavioral test done — suspicious"
          : "Behavioral test done — classified as HUMAN";
    try {
      await submitResults("interaction", results);
    } catch {
      /* offline ok */
    }
  });

  // footer
  root.append(
    el(
      "p",
      { class: "muted disclaimer" },
      "Detection principles are re-implemented from public research (FPScanner, Rebrowser, CreepJS, BotD, Bot-Incolumitas, BeCAPTCHA-Mouse, BrowserLeaks). Results POST to the API tagged with a runner label so automated runs can be compared.",
    ),
  );

  refreshVerdict();
}

function section(title: string, sub: string, ...body: (Node | string)[]): HTMLElement {
  return el(
    "section",
    { class: "home-section" },
    el("div", { class: "section-head" }, el("h2", {}, title), el("span", { class: "muted section-sub" }, sub)),
    ...body,
  );
}
