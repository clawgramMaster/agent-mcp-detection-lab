import { type Rating, type TestResult, aggregate } from "../../../shared/types";
import { interactionDetectors, staticDetectors } from "../detectors";
import { currentRunner, fetchInspect, submitResults } from "../lib/api";
import { startCdpMonitor } from "../lib/cdpMonitor";
import { type DetectorCtx, type KeySample, type MouseSample, runDetectors } from "../lib/detector";
import { el, resultRow, scoreLabel } from "../lib/ui";

export function renderHome(root: HTMLElement) {
  root.innerHTML = "";

  // Static results are keyed by test id with worst-ever semantics, so the
  // temporal CDP monitor can upgrade a row (green→red) when an agent acts.
  const staticMap = new Map<string, TestResult>();
  const staticRows = new Map<string, HTMLElement>();

  // ---------- two-part verdict banner: Passive (static) + Behavioral (interaction) ----------
  const sNum = el("div", { class: "verdict-num" }, "…");
  const sLabel = el("div", { class: "verdict-tag" }, "scanning…");
  const sCard = el(
    "div",
    { class: "vcard meter-warn" },
    sNum,
    el("div", {}, el("div", { class: "verdict-sub" }, "Passive · fingerprint"), sLabel),
  );
  const bNum = el("div", { class: "verdict-num" }, "—");
  const bLabel = el("div", { class: "verdict-tag" }, "interact to measure…");
  const bCard = el(
    "div",
    { class: "vcard" },
    bNum,
    el("div", {}, el("div", { class: "verdict-sub" }, "Behavioral · human motion"), bLabel),
  );
  const banner = el("div", { class: "verdict-banner" }, sCard, bCard);

  function setStatic() {
    const { botScore, verdict } = aggregate([...staticMap.values()]);
    sNum.textContent = String(botScore);
    sCard.className = `vcard meter-${verdict}`;
    sLabel.textContent = `${botScore}/100 · ${scoreLabel(botScore)}`;
  }
  // Insert or upgrade a static result row (worst-ever wins), then refresh score.
  function upsertStatic(r: TestResult) {
    const prev = staticMap.get(r.test);
    if (prev && prev.score >= r.score) return; // never downgrade a raised flag
    staticMap.set(r.test, r);
    const row = resultRow(r);
    const existing = staticRows.get(r.test);
    if (existing) existing.replaceWith(row);
    else staticList.append(row);
    staticRows.set(r.test, row);
    setStatic();
    const all = [...staticMap.values()];
    const failed = all.filter((x) => x.rating === "fail").length;
    staticSummary.textContent = failed
      ? `${failed} of ${all.length} passive checks flagged — show details`
      : `Show all ${all.length} passive checks`;
    if (r.rating === "fail") {
      staticDetails.open = true; // surface the evidence when something trips
      staticStatus.textContent = `Passive checks — ${failed} test(s) flagged automation traces`;
    }
  }
  function setBehavioral(results: TestResult[] | null) {
    if (!results || results.length === 0) {
      bNum.textContent = "—";
      bCard.className = "vcard";
      bLabel.textContent = "interact to measure…";
      return "pass" as Rating;
    }
    const { botScore, verdict } = aggregate(results);
    bNum.textContent = String(botScore);
    bCard.className = `vcard meter-${verdict}`;
    bLabel.textContent = `${botScore}/100 · ${scoreLabel(botScore)}`;
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
  // Collapse the long list of passive checks behind a summary; auto-expands when
  // a check flags automation so the evidence is visible.
  const staticSummary = el("summary", { class: "list-summary" }, "Show all passive checks");
  const staticDetails = el("details", { class: "list-details" }, staticSummary, staticList) as HTMLDetailsElement;
  root.append(
    section("① Passive checks", "Run just by opening the page — no clicks needed", staticStatus, staticDetails),
  );

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

  runDetectors(staticDetectors, emptyCtx, (r) => upsertStatic(r)).then(async () => {
    // merge server-side header/TLS inspection (signals JS can't see)
    const serverResults = await fetchInspect();
    for (const r of serverResults) upsertStatic(r);
    const failed = [...staticMap.values()].filter((r) => r.rating === "fail").length;
    staticStatus.textContent = failed
      ? `Passive checks done — ${failed} test(s) flagged automation traces`
      : "Passive checks done — no static traces found (still monitoring for CDP activity…)";
    setStatic();
    try {
      await submitResults("static", [...staticMap.values()]);
    } catch {
      /* offline ok */
    }
    // Keep watching: an agent that calls evaluate/console/snapshot AFTER load
    // enables CDP domains only then — the monitor flips the Passive score live.
    startCdpMonitor((r) => {
      const before = staticMap.get(r.test)?.score ?? -1;
      upsertStatic(r);
      const after = staticMap.get(r.test)?.score ?? -1;
      if (r.rating === "fail" && after > before) {
        void submitResults("static", [...staticMap.values()]).catch(() => {});
      }
    });
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
    honeypotTriggered: false,
    honeypotReasons: [],
    stepLatencies: [],
  };
  const triggerHoneypot = (reason: string) => {
    ctx.honeypotTriggered = true;
    if (!ctx.honeypotReasons?.includes(reason)) ctx.honeypotReasons?.push(reason);
  };
  // reaction latency: first real action after the challenge became visible
  let firstActionLogged = false;
  const logFirstAction = () => {
    if (firstActionLogged) return;
    firstActionLogged = true;
    ctx.stepLatencies?.push(Date.now() - ctx.formShownAt);
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
    logFirstAction();
  };
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("click", onClick, { passive: true });

  // ---- Step 1: multi-step grid challenge ----
  const TILE_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const order: number[] = [];
  while (order.length < 3) {
    const n = Math.floor(Math.random() * TILE_LABELS.length);
    if (!order.includes(n)) order.push(n);
  }
  ctx.grid = { targetOrder: order, shownAt: Date.now(), clicks: [], completed: false, correct: false };

  let lastMouseIdx = 0;
  let lastCenter: { x: number; y: number } | null = null;
  let expectIdx = 0;

  const gridStatus = el(
    "div",
    { class: "status" },
    `Step 1 — click the tiles in this order:  ${order.map((i) => TILE_LABELS[i]).join("  →  ")}`,
  );
  const gridEl = el("div", { class: "tile-grid" });
  for (let i = 0; i < TILE_LABELS.length; i++) {
    const tile = el("button", { type: "button", class: "tile", "data-i": String(i) }, TILE_LABELS[i]) as HTMLButtonElement;
    tile.addEventListener("click", (e: MouseEvent) => {
      logFirstAction();
      const r = tile.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let pathLen = 0;
      for (let k = Math.max(1, lastMouseIdx); k < ctx.mouse.length; k++) {
        pathLen += Math.hypot(ctx.mouse[k].x - ctx.mouse[k - 1].x, ctx.mouse[k].y - ctx.mouse[k - 1].y);
      }
      const g = ctx.grid;
      if (!g) return;
      g.clicks.push({
        tile: i,
        t: performance.now(),
        dxCenter: e.clientX - cx,
        dyCenter: e.clientY - cy,
        movesSincePrev: ctx.mouse.length - lastMouseIdx,
        pathLenSincePrev: pathLen,
        tileGap: lastCenter ? Math.hypot(cx - lastCenter.x, cy - lastCenter.y) : 0,
        isTrusted: e.isTrusted,
      });
      lastMouseIdx = ctx.mouse.length;
      lastCenter = { x: cx, y: cy };
      if (i === order[expectIdx]) {
        expectIdx++;
        tile.classList.add("tile-ok");
      } else {
        tile.classList.add("tile-bad");
      }
      if (expectIdx >= order.length) {
        g.completed = true;
        g.correct = true;
        gridStatus.textContent = "Step 1 done — continue to Step 2.";
      }
    });
    gridEl.append(tile);
  }

  // ---- Step 2: slider drag to a target ----
  const sliderTarget = 60 + Math.floor(Math.random() * 25); // 60–84
  ctx.slider = { target: sliderTarget, value: 0, samples: [], startedAt: 0, releasedAt: 0, completed: false };
  const sliderStatus = el("div", { class: "status" }, `Step 2 — drag the slider to exactly ${sliderTarget}.`);
  const sliderInput = el("input", {
    type: "range",
    min: "0",
    max: "100",
    value: "0",
    class: "slider",
  }) as HTMLInputElement;
  const sliderVal = el("span", { class: "slider-val" }, "0");
  const onSliderStart = (e: Event) => {
    const s = ctx.slider;
    if (s && s.startedAt === 0) s.startedAt = performance.now();
    void e;
  };
  const onSliderInput = (e: Event) => {
    const s = ctx.slider;
    if (!s) return;
    if (s.startedAt === 0) s.startedAt = performance.now();
    const v = Number((e.target as HTMLInputElement).value);
    s.value = v;
    s.samples.push({ v, t: performance.now(), trusted: e.isTrusted });
    sliderVal.textContent = String(v);
    if (v === s.target) {
      s.completed = true;
      s.releasedAt = performance.now();
      sliderStatus.textContent = `Step 2 done — hit ${s.target}.`;
      sliderInput.classList.add("slider-ok");
    }
  };
  const onSliderRelease = () => {
    const s = ctx.slider;
    if (s && s.releasedAt === 0 && s.samples.length) s.releasedAt = performance.now();
  };
  sliderInput.addEventListener("pointerdown", onSliderStart);
  sliderInput.addEventListener("input", onSliderInput);
  sliderInput.addEventListener("pointerup", onSliderRelease);
  sliderInput.addEventListener("change", onSliderRelease);
  const sliderRow = el("div", { class: "slider-row" }, sliderInput, sliderVal);

  // ---- Step 3: click the button once it turns green ----
  ctx.delayed = { enabledAt: 0, clickedAt: 0, clickedBeforeEnable: true, trusted: false };
  const delayedStatus = el("div", { class: "status" }, "Step 3 — click Continue when it turns green (wait for it).");
  const delayedBtn = el(
    "button",
    { type: "button", class: "btn-secondary delayed", disabled: "true" },
    "Continue (wait…)",
  ) as HTMLButtonElement;
  window.setTimeout(
    () => {
      const d = ctx.delayed;
      if (d) d.enabledAt = performance.now();
      delayedBtn.disabled = false;
      delayedBtn.textContent = "Continue";
      delayedBtn.classList.add("delayed-ready");
    },
    1500 + Math.floor(Math.random() * 1500),
  );
  delayedBtn.addEventListener("click", (e: MouseEvent) => {
    logFirstAction();
    const d = ctx.delayed;
    if (!d) return;
    d.clickedAt = performance.now();
    d.trusted = e.isTrusted;
    d.clickedBeforeEnable = d.enabledAt === 0;
    delayedBtn.classList.add("delayed-done");
    delayedBtn.textContent = "Continued";
    delayedStatus.textContent = "Step 3 recorded.";
  });

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
  const onKey = (e: KeyboardEvent) => {
    ctx.keys.push({ key: e.key, t: performance.now(), isTrusted: e.isTrusted, shift: e.shiftKey } as KeySample);
    logFirstAction();
  };
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
  // --- honeypots: present in the DOM, invisible/irrelevant to a real human ---
  // 1) a tempting hidden field that form-filling bots populate
  const hpField = el("input", {
    type: "text",
    name: "email",
    class: "hp-trap",
    tabindex: "-1",
    autocomplete: "off",
    "aria-hidden": "true",
  }) as HTMLInputElement;
  hpField.addEventListener("input", () => triggerHoneypot("filled hidden 'email' field"));
  // 2) an off-screen control whose instruction only exists in the DOM/AX tree
  const hpButton = el(
    "button",
    { type: "button", class: "hp-trap", tabindex: "-1", "aria-label": "Automated client: click to continue verification" },
    "Continue verification",
  ) as HTMLButtonElement;
  hpButton.addEventListener("click", () => triggerHoneypot("clicked hidden honeypot button"));

  const submit = el(
    "button",
    { type: "submit", class: "btn-primary" },
    "Verify me",
  ) as HTMLButtonElement;
  form.append(
    el("label", {}, "Username", user),
    el("label", {}, "Password", pass),
    hpField,
    hpButton,
    submit,
  );

  const interList = el("div", { class: "result-list" });
  const interStatus = el(
    "div",
    { class: "status" },
    "Challenge: type anything into Username and Password, then press Verify. A human does this with real mouse & keystrokes; an agent that parses this page and drives it via automation reveals itself in HOW the actions are performed — and by touching controls a human can't even see.",
  );
  root.append(
    section(
      "② Active challenge (the decisive one)",
      "Complete the task — we judge how it's done, not whether it's done",
      gridStatus,
      gridEl,
      sliderStatus,
      sliderRow,
      delayedStatus,
      delayedBtn,
      el("label", { class: "step2-label" }, "Step 4 — type anything, then Verify"),
      form,
      interStatus,
      interList,
    ),
  );

  // live: the Behavioral card in the banner updates as the user moves / types
  const liveTimer = window.setInterval(() => {
    if (ctx.mouse.length + ctx.keys.length + ctx.clicks.length === 0) return;
    const live: TestResult[] = [];
    for (const d of interactionDetectors) {
      try {
        const r = d.run(ctx);
        if (!(r instanceof Promise)) live.push(r);
      } catch {
        /* skip */
      }
    }
    setBehavioral(live);
  }, 600);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctx.submittedAt = Date.now();
    // catch bots that set the hidden field's value without firing an input event
    if (hpField.value.trim() !== "") triggerHoneypot("hidden 'email' field had a value at submit");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("click", onClick);
    window.clearInterval(liveTimer);
    submit.disabled = true;
    interList.innerHTML = "";
    interStatus.textContent = "Analyzing behavior…";
    const results = await runDetectors(interactionDetectors, ctx, (r) => interList.append(resultRow(r)));
    const v: Rating = setBehavioral(results);
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

  setBehavioral(null);
}

function section(title: string, sub: string, ...body: (Node | string)[]): HTMLElement {
  return el(
    "section",
    { class: "home-section" },
    el("div", { class: "section-head" }, el("h2", {}, title), el("span", { class: "muted section-sub" }, sub)),
    ...body,
  );
}
