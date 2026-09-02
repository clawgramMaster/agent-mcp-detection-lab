import { type TestResult, type Verdict, aggregate } from "../../../shared/types";
import { interactionDetectors, staticDetectors } from "../detectors";
import { currentRunner, fetchInspect, submitResults } from "../lib/api";
import { startCdpMonitor } from "../lib/cdpMonitor";
import { type DetectorCtx, type KeySample, type MouseSample, runDetectors } from "../lib/detector";
import { normalizeIframeOrigin, parseHoverShadowMessage, parseIframeInputMessage } from "../lib/iframeChallenge";
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
  const bLabel = el("div", { class: "verdict-tag" }, "complete the challenge, then Verify");
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
  function setBehavioral(results: TestResult[] | null): Verdict {
    if (!results || results.length === 0) {
      bNum.textContent = "—";
      bCard.className = "vcard";
      bLabel.textContent = "complete the challenge, then Verify";
      return "incomplete";
    }
    const { botScore, verdict, contributing } = aggregate(results);
    if (verdict === "incomplete" || contributing === 0) {
      bNum.textContent = "—";
      bCard.className = "vcard";
      bLabel.textContent = "not enough interaction to judge";
      return "incomplete";
    }
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
    maxValueJump: 0,
  };

  // Start the temporal CDP monitor IMMEDIATELY — not after the sequential scan —
  // so CDP domains an agent enables during page load are caught right away. It
  // upserts into the same test ids (worst-ever), so it composes with the scan.
  startCdpMonitor((r) => {
    const before = staticMap.get(r.test)?.score ?? -1;
    upsertStatic(r);
    const after = staticMap.get(r.test)?.score ?? -1;
    if (r.rating === "fail" && after > before) {
      void submitResults("static", [...staticMap.values()]).catch(() => {});
    }
  });

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
    maxValueJump: 0,
    honeypotTriggered: false,
    honeypotReasons: [],
    iframeInput: {
      eventCount: 0,
      trustedInputEvents: 0,
      untrustedInputEvents: 0,
      trustedClickEvents: 0,
      untrustedClickEvents: 0,
      eventSamples: [],
      expectedValue: "",
      controlledValue: "",
      complete: false,
      blurred: false,
      firstEventAt: 0,
      completedAt: 0,
    },
  };
  const triggerHoneypot = (reason: string) => {
    ctx.honeypotTriggered = true;
    if (!ctx.honeypotReasons?.includes(reason)) ctx.honeypotReasons?.push(reason);
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
  const onScroll = (e: Event) => ctx.scrolls.push({ t: performance.now(), isTrusted: e.isTrusted });
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
    // Outside a closed shadow root, keypad clicks are retargeted to the host.
    // Its center is unrelated to the internal digit; keypad telemetry records
    // the real button offset in its own handler below.
    const tgt = e.target as Element | null;
    if (tgt && !tgt.classList.contains("keypad-host") && typeof tgt.getBoundingClientRect === "function") {
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

  // ---- Step 1: slider drag to a target ----
  const sliderTarget = 60 + Math.floor(Math.random() * 25); // 60–84
  ctx.slider = { target: sliderTarget, value: 0, samples: [], startedAt: 0, releasedAt: 0, completed: false };
  const sliderStatus = el("div", { class: "status" }, `Step 1 — drag the slider to exactly ${sliderTarget}.`);
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
    // NOTE: do not mark completed here — the handle merely passing OVER the target
    // mid-drag is not "done". Completion is decided on release (final value).
    sliderInput.classList.toggle("slider-ok", v === s.target);
  };
  const onSliderRelease = () => {
    const s = ctx.slider;
    if (!s || !s.samples.length) return;
    s.releasedAt = performance.now();
    // completed only if the FINAL resting value equals the target
    s.completed = s.value === s.target;
    sliderStatus.textContent = s.completed
      ? `Step 1 done — landed on ${s.target}.`
      : `Step 1 — drag the slider to exactly ${s.target}. (now ${s.value})`;
  };
  sliderInput.addEventListener("pointerdown", onSliderStart);
  sliderInput.addEventListener("input", onSliderInput);
  sliderInput.addEventListener("pointerup", onSliderRelease);
  sliderInput.addEventListener("change", onSliderRelease);
  const sliderRow = el("div", { class: "slider-row" }, sliderInput, sliderVal);

  // ---- Step 2: virtual security keypad — click-to-enter PIN, no keyboard ----
  // Mirrors real bank / cert-auth "secure keypads": clicking a masked PIN field
  // pops up a small floating panel (not an inline page section) containing a
  // CLOSED shadow-root keypad (see the `shadowDomIntegrity` passive check) so
  // the digit↔position mapping can't be read by DOM-walking automation, and the
  // layout RE-SHUFFLES after every click so on-screen coordinates can't be
  // cached across taps. The popup closes itself the moment the PIN is complete.
  const KEYPAD_PIN_LEN = 4;
  const keypadPin: number[] = Array.from({ length: KEYPAD_PIN_LEN }, () => Math.floor(Math.random() * 10));
  ctx.keypad = {
    pin: keypadPin,
    clicks: [],
    completed: false,
    correct: false,
    wrongClicks: 0,
    shuffles: 0,
  };
  let keypadExpectIdx = 0;
  let keypadLastMouseIdx = 0;
  let keypadLastCenter: { x: number; y: number } | null = null;

  const keypadStatus = el(
    "div",
    { class: "status" },
    `Step 2 — click "Enter PIN" to open the popup keypad and enter ${keypadPin.join(" ")} (mouse only — no typing). The keypad layout reshuffles after every tap, so re-check digit positions before each click.`,
  );
  const pinDots: HTMLElement[] = [];
  const keypadPinRow = el("div", { class: "keypad-pin" });
  for (let i = 0; i < KEYPAD_PIN_LEN; i++) {
    const dot = el("span", { class: "keypad-pin-dot" });
    pinDots.push(dot);
    keypadPinRow.append(dot);
  }
  const keypadOpenBtn = el("button", { type: "button", class: "btn-secondary" }, "Enter PIN") as HTMLButtonElement;

  // The popup itself: a small floating panel, not part of the page flow.
  const keypadHost = el("div", { class: "keypad-host" });
  // `attachShadow({ mode: "closed" })` returns the only reference to this tree —
  // `keypadHost.shadowRoot` reads back `null` to any OTHER script from here on.
  const keypadShadow = keypadHost.attachShadow({ mode: "closed" });
  const keypadStyle = document.createElement("style");
  // page CSS does not pierce a shadow boundary, so the keypad ships its own tiny
  // stylesheet — real secure-keypad widgets do the same.
  keypadStyle.textContent = `
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-family: "JetBrains Mono", monospace; }
    button { aspect-ratio: 1 / 1; border: 1px solid #d9d3c7; border-radius: 10px; background: #fbf9f4; color: #1b1915; font: 600 20px/1 inherit; cursor: pointer; }
    button:hover:not(:disabled) { border-color: #1b1915; }
    button:disabled { visibility: hidden; cursor: default; }
  `;
  const keypadGrid = document.createElement("div");
  keypadGrid.className = "grid";
  keypadShadow.append(keypadStyle, keypadGrid);

  const keypadCloseBtn = el("button", { type: "button", class: "keypad-popup-close" }, "×") as HTMLButtonElement;
  const keypadPopup = el(
    "div",
    { class: "keypad-popup" },
    el("div", { class: "keypad-popup-head" }, el("span", {}, "Secure keypad"), keypadCloseBtn),
    keypadHost,
  );
  const keypadOverlay = el("div", { class: "keypad-popup-overlay" }, keypadPopup) as HTMLDivElement;
  let keypadCloseTimer = 0;
  const closeKeypadPopup = () => keypadOverlay.classList.remove("keypad-popup-open");
  const openKeypadPopup = () => {
    if (ctx.keypad?.completed) return;
    keypadOverlay.classList.add("keypad-popup-open");
  };
  keypadCloseBtn.addEventListener("click", closeKeypadPopup);
  keypadOverlay.addEventListener("click", (e) => {
    if (e.target === keypadOverlay) closeKeypadPopup(); // click on the backdrop, not the panel
  });
  keypadOpenBtn.addEventListener("click", openKeypadPopup);

  const onKeypadDigitClick = (e: MouseEvent, digit: number, btn: HTMLButtonElement) => {
    const k = ctx.keypad;
    if (!k || k.completed) return;
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let pathLen = 0;
    for (let i = Math.max(1, keypadLastMouseIdx); i < ctx.mouse.length; i++) {
      pathLen += Math.hypot(ctx.mouse[i].x - ctx.mouse[i - 1].x, ctx.mouse[i].y - ctx.mouse[i - 1].y);
    }
    const expectedDigit = k.pin[keypadExpectIdx] ?? -1;
    k.clicks.push({
      digit,
      expectedDigit,
      t: performance.now(),
      x: e.clientX,
      y: e.clientY,
      dxCenter: e.clientX - cx,
      dyCenter: e.clientY - cy,
      movesSincePrev: ctx.mouse.length - keypadLastMouseIdx,
      pathLenSincePrev: pathLen,
      targetGap: keypadLastCenter ? Math.hypot(cx - keypadLastCenter.x, cy - keypadLastCenter.y) : 0,
      isTrusted: e.isTrusted,
    });
    keypadLastMouseIdx = ctx.mouse.length;
    keypadLastCenter = { x: cx, y: cy };
    if (digit === expectedDigit) {
      pinDots[keypadExpectIdx]?.classList.add("keypad-pin-filled");
      keypadExpectIdx++;
    } else {
      k.wrongClicks++;
    }
    if (keypadExpectIdx >= k.pin.length) {
      k.completed = true;
      k.correct = k.wrongClicks === 0;
      keypadOpenBtn.disabled = true;
      keypadOpenBtn.textContent = "PIN entered";
      keypadStatus.textContent = k.correct
        ? "Step 2 done — continue to Step 3."
        : "Step 2 done (with wrong taps) — continue to Step 3.";
      keypadCloseTimer = window.setTimeout(closeKeypadPopup, 350); // real secure-keypad popups auto-dismiss on completion
    } else {
      k.shuffles++;
      renderKeypadLayout(); // re-shuffle positions after every click
    }
  };

  function renderKeypadLayout() {
    keypadGrid.innerHTML = "";
    const cells: (number | null)[] = [...Array.from({ length: 10 }, (_, i) => i), null, null];
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (const digit of cells) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (digit === null) {
        btn.disabled = true;
        btn.tabIndex = -1;
        keypadGrid.append(btn);
        continue;
      }
      btn.textContent = String(digit);
      btn.addEventListener("click", (e: MouseEvent) => onKeypadDigitClick(e, digit, btn));
      keypadGrid.append(btn);
    }
  }
  renderKeypadLayout();

  // ---- Step 4: trusted typing into a nested controlled iframe ----
  const phoneSuffix = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, "0");
  const expectedPhoneDigits = `010${phoneSuffix}`;
  const expectedPhoneValue = `${expectedPhoneDigits.slice(0, 3)}-${expectedPhoneDigits.slice(3, 7)}-${expectedPhoneDigits.slice(7)}`;
  if (ctx.iframeInput) ctx.iframeInput.expectedValue = expectedPhoneValue;
  const requestedIframeOrigin = new URLSearchParams(location.search).get("iframeOrigin")?.replace(/\/$/, "");
  const defaultIframeOrigin = location.hostname === "lab.otium.team" ? "https://agent-mcp-lab.pages.dev" : undefined;
  const iframeOrigin = normalizeIframeOrigin(requestedIframeOrigin || defaultIframeOrigin);
  const iframeMessageOrigin = iframeOrigin ?? location.origin;
  const iframeChallengeId = crypto.randomUUID();
  const iframeParams = new URLSearchParams({
    challengeId: iframeChallengeId,
    expectedDigits: expectedPhoneDigits,
    parentOrigin: location.origin,
  });
  if (iframeOrigin) iframeParams.set("innerOrigin", iframeOrigin);
  const iframeSrc = `/iframe-lab/application.html?${iframeParams}`;
  const iframeStatus = el(
    "div",
    { class: "iframe-task-status" },
    `Enter ${expectedPhoneDigits} in the nested Mobile number field, then click Blur and verify state.`,
  );
  const certificateFrame = el("iframe", {
    id: "applicationIframe",
    class: "iframe-task-host",
    src: iframeSrc,
    title: "Nested certificate mobile-number challenge",
  }) as HTMLIFrameElement;
  const iframeTask = el(
    "div",
    { class: "iframe-task" },
    el("div", { class: "step2-label" }, "Step 4 — Nested certificate mobile verification"),
    iframeStatus,
    certificateFrame,
  );

  const nestedInputWindow = (): Window | null => {
    const applicationDocument = certificateFrame.contentDocument;
    const sdkFrame = applicationDocument?.querySelector<HTMLIFrameElement>("#finCertSdkIframe");
    const sdkDocument = sdkFrame?.contentDocument;
    return sdkDocument?.querySelector<HTMLIFrameElement>("#finCertSdkInnerIframe")?.contentWindow ?? null;
  };
  const onIframeMessage = (message: MessageEvent) => {
    const data = parseIframeInputMessage(message, {
      challengeId: iframeChallengeId,
      origin: iframeMessageOrigin,
      source: nestedInputWindow(),
    });
    if (!data) return;
    const state = ctx.iframeInput;
    if (!state) return;
    const now = performance.now();
    state.eventCount += 1;
    state.eventSamples.push({
      event: data.event,
      key: data.key,
      t: data.timestamp,
      trusted: data.isTrusted,
    });
    if (state.eventSamples.length > 120) state.eventSamples.splice(0, state.eventSamples.length - 120);
    if (state.firstEventAt === 0) state.firstEventAt = now;
    if (data.event === "input") {
      if (data.isTrusted) state.trustedInputEvents += 1;
      else state.untrustedInputEvents += 1;
    }
    if (data.event === "click") {
      if (data.isTrusted) state.trustedClickEvents += 1;
      else state.untrustedClickEvents += 1;
    }
    if (typeof data.controlledValue === "string") state.controlledValue = data.controlledValue;
    state.complete = data.complete === true;
    if (data.event === "blur") state.blurred = true;
    if (state.complete && state.blurred && state.completedAt === 0) state.completedAt = now;

    const done = state.complete && state.blurred;
    iframeStatus.className = `iframe-task-status${done ? " iframe-task-pass" : ""}`;
    iframeStatus.textContent = done
      ? `Step 4 done — controlled state retained ${state.controlledValue} after blur · trusted inputs=${state.trustedInputEvents} · trusted clicks=${state.trustedClickEvents}.`
      : `Step 4 — state=${state.controlledValue || "empty"} · trusted inputs=${state.trustedInputEvents} · untrusted inputs=${state.untrustedInputEvents} · trusted clicks=${state.trustedClickEvents} · untrusted clicks=${state.untrustedClickEvents}`;
  };
  window.addEventListener("message", onIframeMessage);

  // ---- Step 3: credentials must match a specific, freshly generated value ----
  // Mirrors the Step 4 (phone digits) / Step 8 (select value) pattern: a random
  // target is generated and shown on screen, and only typing it EXACTLY counts —
  // "type anything" would let a bot autofill/paste a fixed string and pass.
  const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const randomChars = (len: number, alphabet: string) => {
    const bytes = crypto.getRandomValues(new Uint32Array(len));
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  const expectedEmail = `agent.${crypto.randomUUID().slice(0, 8)}@otium-lab.test`;
  const expectedPassword = randomChars(11, PASSWORD_CHARS);
  ctx.credentials = {
    expectedEmail,
    expectedPassword,
    complete: false,
  };
  const credentialsStatus = el(
    "div",
    { class: "status" },
    `Step 3 — type this email and password exactly: ${expectedEmail} / ${expectedPassword}`,
  );

  const form = el("form", { id: "behavior-form", class: "login-form", autocomplete: "off" }) as HTMLFormElement;
  const user = el("input", {
    type: "text",
    name: "username",
    placeholder: "type the email shown above",
    class: "field",
  }) as HTMLInputElement;
  const pass = el("input", {
    type: "password",
    name: "password",
    placeholder: "type the password shown above",
    class: "field",
  }) as HTMLInputElement;
  const keySample = (e: KeyboardEvent): KeySample => ({
    key: e.key,
    t: performance.now(),
    isTrusted: e.isTrusted,
    shift: e.shiftKey,
    caps: e.getModifierState?.("CapsLock"),
    altGraph: e.getModifierState?.("AltGraph"),
  });
  const onKey = (e: KeyboardEvent) => {
    ctx.keys.push(keySample(e));
  };
  const onKeyUp = (e: KeyboardEvent) => ctx.keyups.push(keySample(e));
  const onPaste = () => {
    ctx.pasted = true;
  };
  const onFocus = (e: FocusEvent) => ctx.focusEvents.push({ t: performance.now(), isTrusted: e.isTrusted });
  const previousValues = new WeakMap<HTMLInputElement, string>();
  const onInput = (e: Event) => {
    const field = e.currentTarget as HTMLInputElement;
    const previousValue = previousValues.get(field) ?? "";
    ctx.maxValueJump = Math.max(ctx.maxValueJump, Math.abs(field.value.length - previousValue.length));
    previousValues.set(field, field.value);
  };
  for (const f of [user, pass]) {
    previousValues.set(f, f.value);
    f.addEventListener("keydown", onKey);
    f.addEventListener("keyup", onKeyUp);
    f.addEventListener("paste", onPaste);
    f.addEventListener("input", onInput);
    f.addEventListener("focus", onFocus);
  }
  const onCredentialsInput = () => {
    const c = ctx.credentials;
    if (!c) return false;
    c.complete = user.value === c.expectedEmail && pass.value === c.expectedPassword;
    credentialsStatus.className = c.complete ? "status iframe-task-pass" : "status";
    credentialsStatus.textContent = c.complete
      ? "Step 3 done — credentials matched."
      : `Step 3 — type this email and password exactly: ${c.expectedEmail} / ${c.expectedPassword}`;
    return c.complete;
  };
  user.addEventListener("input", onCredentialsInput);
  pass.addEventListener("input", onCredentialsInput);
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
  // 2) an off-screen control a DOM-scraping bot may click. It is aria-hidden and
  //    out of tab order so assistive tech NEVER announces or reaches it — a real
  //    screen-reader user cannot trip it, while a DOM-driven agent still can.
  const hpButton = el(
    "button",
    { type: "button", class: "hp-trap", tabindex: "-1", "aria-hidden": "true" },
    "Continue verification",
  ) as HTMLButtonElement;
  hpButton.addEventListener("click", () => triggerHoneypot("clicked hidden honeypot button"));

  const submit = el(
    "button",
    { type: "submit", form: "behavior-form", class: "btn-primary" },
    "Verify me",
  ) as HTMLButtonElement;
  form.append(el("label", {}, "Username", user), el("label", {}, "Password", pass), hpField, hpButton);

  // ---- Step 5: DOM-churn click test ----
  // The button is silently replaced by a look-alike node partway through. A
  // real pointer can only ever hit what's currently on screen; a script
  // holding a stale element handle and calling .click() on it can "hit" a
  // node that's no longer in the document at all.
  ctx.detachedClick = {
    swappedAt: 0,
    originalClickedAt: 0,
    originalClickedAfterSwap: false,
    originalTrusted: false,
    replacementClickedAt: 0,
    replacementTrusted: false,
    completed: false,
  };
  const bonusClickStatus = el("div", { class: "status" }, "Step 5 — click the button below.");
  let bonusBtn = el("button", { type: "button", class: "btn-secondary" }, "Click me") as HTMLButtonElement;
  const bonusClickRow = el("div", { class: "bonus-row" }, bonusBtn);
  const onBonusClick = (isReplacement: boolean) => (e: MouseEvent) => {
    const d = ctx.detachedClick;
    if (!d || d.completed) return;
    const now = performance.now();
    if (isReplacement) {
      d.replacementClickedAt = now;
      d.replacementTrusted = e.isTrusted;
    } else {
      d.originalClickedAt = now;
      d.originalTrusted = e.isTrusted;
      d.originalClickedAfterSwap = d.swappedAt > 0 && now >= d.swappedAt;
    }
    d.completed = true;
    bonusClickStatus.textContent = "Step 5 done — continue to Step 6.";
  };
  bonusBtn.addEventListener("click", onBonusClick(false));
  const detachedSwapTimer = window.setTimeout(
    () => {
      const d = ctx.detachedClick;
      if (!d || d.completed) return; // already resolved via an early click — nothing to swap
      const replacement = el("button", { type: "button", class: "btn-secondary" }, "Click me") as HTMLButtonElement;
      replacement.addEventListener("click", onBonusClick(true));
      d.swappedAt = performance.now();
      bonusBtn.replaceWith(replacement);
      bonusBtn = replacement;
    },
    500 + Math.floor(Math.random() * 400),
  );

  // ---- Step 6: popup window.opener / referrer integrity ----
  const popupChallengeId = crypto.randomUUID();
  ctx.popupCheck = {
    challengeId: popupChallengeId,
    clickedAt: 0,
    trustedClick: false,
    completed: false,
    reportedAt: 0,
    openerPresent: null,
    referrerNonEmpty: null,
    referrerOriginMatches: null,
  };
  const popupStatus = el("div", { class: "status" }, "Step 6 — open the verification tab (target=_blank).");
  const popupParams = new URLSearchParams({ challengeId: popupChallengeId });
  const popupLink = el(
    "a",
    { href: `/popup-lab.html?${popupParams}`, target: "_blank", rel: "opener", class: "btn-secondary" },
    "Open verification tab",
  ) as HTMLAnchorElement;
  popupLink.addEventListener("click", (e: MouseEvent) => {
    const p = ctx.popupCheck;
    if (!p) return;
    if (p.completed) {
      e.preventDefault();
      return;
    }
    p.clickedAt = Date.now();
    p.trustedClick = e.isTrusted;
  });
  let popupChannel: BroadcastChannel | null = null;
  if ("BroadcastChannel" in window) {
    popupChannel = new BroadcastChannel(`amcplab-popup-${popupChallengeId}`);
    popupChannel.onmessage = (msg: MessageEvent) => {
      const data = msg.data as Record<string, unknown> | undefined;
      if (!data || data.source !== "popup-lab" || data.challengeId !== popupChallengeId) return;
      const p = ctx.popupCheck;
      if (!p || p.clickedAt === 0 || p.completed) return;
      p.completed = true;
      p.reportedAt = Date.now();
      p.openerPresent = !!data.openerPresent;
      const referrer = typeof data.referrer === "string" ? data.referrer : "";
      p.referrerNonEmpty = referrer.length > 0;
      try {
        p.referrerOriginMatches = new URL(referrer).origin === location.origin;
      } catch {
        p.referrerOriginMatches = false;
      }
      popupStatus.textContent = `Step 6 done — opener=${p.openerPresent}, referrer=${p.referrerNonEmpty}.`;
    };
  }

  // ---- Step 7: iframe + closed Shadow DOM hover menu ----
  // The interaction surface crosses an iframe boundary, then hides its menu
  // inside a closed shadow root. Only postMessage telemetry from the expected
  // origin, frame window, and per-run challenge is accepted back here.
  const HOVER_MENU_OPTIONS = ["Card", "Bank transfer", "Kakao Pay"];
  const expectedHoverOption =
    HOVER_MENU_OPTIONS[crypto.getRandomValues(new Uint32Array(1))[0] % HOVER_MENU_OPTIONS.length];
  const hoverChallengeId = crypto.randomUUID();
  ctx.hoverMenu = {
    options: HOVER_MENU_OPTIONS,
    expectedOption: expectedHoverOption,
    openedAt: 0,
    hoverTrusted: null,
    selectedOption: null,
    selectedAt: 0,
    trusted: false,
    completed: false,
  };
  const hoverMenuStatus = el(
    "div",
    { class: "iframe-task-status" },
    `Hover inside the frame and choose “${expectedHoverOption}” from the Shadow DOM menu.`,
  );
  const hoverFrameUrl = new URL("/iframe-lab/hover-shadow.html", iframeOrigin ?? location.origin);
  hoverFrameUrl.search = new URLSearchParams({
    challengeId: hoverChallengeId,
    expectedOption: expectedHoverOption,
    parentOrigin: location.origin,
  }).toString();
  const hoverFrame = el("iframe", {
    class: "iframe-task-host hover-shadow-frame",
    src: hoverFrameUrl.toString(),
    title: "Shadow DOM payment-method hover challenge",
  }) as HTMLIFrameElement;
  const hoverMenuTask = el(
    "div",
    { class: "iframe-task" },
    el("div", { class: "step2-label" }, "Step 7 — Iframe Shadow DOM hover menu"),
    hoverMenuStatus,
    hoverFrame,
  );
  const onHoverFrameMessage = (message: MessageEvent) => {
    const data = parseHoverShadowMessage(message, {
      challengeId: hoverChallengeId,
      origin: hoverFrameUrl.origin,
      source: hoverFrame.contentWindow,
      options: HOVER_MENU_OPTIONS,
    });
    if (!data) return;
    const h = ctx.hoverMenu;
    if (!h || h.completed) return;
    if (data.event === "open") {
      h.openedAt = performance.now();
      h.hoverTrusted = data.isTrusted;
      return;
    }
    h.selectedOption = data.selectedOption;
    h.selectedAt = performance.now();
    h.trusted = data.isTrusted;
    h.completed = data.selectedOption === h.expectedOption;
    hoverMenuStatus.className = h.completed ? "iframe-task-status iframe-task-pass" : "iframe-task-status";
    hoverMenuStatus.textContent = h.completed
      ? `Step 7 done — selected "${data.selectedOption}" through the iframe Shadow DOM.`
      : `"${data.selectedOption}" is not the requested option. Hover again and choose "${h.expectedOption}".`;
    if (!h.completed) {
      h.openedAt = 0;
      h.hoverTrusted = null;
    }
  };
  window.addEventListener("message", onHoverFrameMessage);

  // ---- Step 8: native select must be changed through trusted input ----
  const expectedSelectValue = "wire";
  ctx.nativeSelect = {
    expectedValue: expectedSelectValue,
    value: "",
    inputTrusted: null,
    changeTrusted: null,
    eventCount: 0,
    complete: false,
  };
  const nativeSelectStatus = el(
    "div",
    { class: "status", id: "nativeSelectStatus" },
    "Step 8 — choose “Wire transfer” from the native Settlement method dropdown.",
  );
  const nativeSelect = el("select", {
    id: "trustedSelect",
    name: "settlementMethod",
    class: "field",
  }) as HTMLSelectElement;
  for (const [value, label, disabled] of [
    ["", "Choose a settlement method", true],
    ["card", "Corporate card", false],
    ["wire", "Wire transfer", false],
    ["escrow", "Escrow", false],
  ] as const) {
    const option = el("option", { value }, label) as HTMLOptionElement;
    option.disabled = disabled;
    nativeSelect.append(option);
  }
  const onNativeSelect = (event: Event) => {
    const state = ctx.nativeSelect;
    if (!state) return;
    state.eventCount += 1;
    state.value = nativeSelect.value;
    if (event.type === "input") state.inputTrusted = event.isTrusted;
    if (event.type === "change") state.changeTrusted = event.isTrusted;
    state.complete = state.value === state.expectedValue;
    nativeSelectStatus.className = state.complete ? "status iframe-task-pass" : "status";
    nativeSelectStatus.textContent = `Step 8 — value=${state.value || "empty"} · input trusted=${String(state.inputTrusted)} · change trusted=${String(state.changeTrusted)}`;
  };
  nativeSelect.addEventListener("input", onNativeSelect);
  nativeSelect.addEventListener("change", onNativeSelect);
  const nativeSelectTask = el("label", { class: "step2-label" }, "Step 8 — Native settlement method", nativeSelect);

  // ---- Step 9: explicit trusted copy/paste transfer ----
  const clipboardToken = `CLIP-${randomChars(12, PASSWORD_CHARS)}`;
  ctx.clipboardTransfer = {
    expectedText: clipboardToken,
    copied: false,
    copyTrusted: null,
    pasteTrusted: null,
    pastedText: "",
    value: "",
    copyEvents: 0,
    pasteEvents: 0,
    pasteInputEvents: 0,
    pasteInputTrusted: null,
    pasteInputType: "",
    directInputEvents: 0,
    completed: false,
  };
  const clipboardStatus = el(
    "div",
    { class: "status" },
    "Step 9 — copy the token from the source field, then paste it into the destination field.",
  );
  const clipboardSource = el("input", {
    type: "text",
    class: "field clipboard-source",
    value: clipboardToken,
    readonly: "",
    "aria-label": "Clipboard source token",
  }) as HTMLInputElement;
  clipboardSource.value = clipboardToken;
  clipboardSource.readOnly = true;
  const clipboardDestination = el("input", {
    type: "text",
    class: "field",
    placeholder: "paste the copied token here",
    autocomplete: "off",
    "aria-label": "Clipboard destination",
  }) as HTMLInputElement;
  const updateClipboardState = () => {
    const state = ctx.clipboardTransfer;
    if (!state) return false;
    state.value = clipboardDestination.value;
    state.completed =
      state.copied &&
      state.copyTrusted === true &&
      state.pasteTrusted === true &&
      state.pasteInputEvents > 0 &&
      state.pasteInputTrusted === true &&
      state.pasteInputType === "insertFromPaste" &&
      state.pastedText === state.expectedText &&
      state.value === state.expectedText;
    clipboardStatus.className = state.completed ? "status iframe-task-pass" : "status";
    clipboardStatus.textContent = state.completed
      ? "Step 9 done — trusted copy and paste matched the token."
      : "Step 9 — copy the token from the source field, then paste it into the destination field.";
    return state.completed;
  };
  clipboardSource.addEventListener("focus", () => clipboardSource.select());
  clipboardSource.addEventListener("copy", (event: ClipboardEvent) => {
    const state = ctx.clipboardTransfer;
    if (!state) return;
    state.copyEvents += 1;
    state.copyTrusted = (state.copyTrusted ?? true) && event.isTrusted;
    state.copied = clipboardSource.selectionStart === 0 && clipboardSource.selectionEnd === clipboardToken.length;
    updateClipboardState();
  });
  clipboardDestination.addEventListener("paste", (event: ClipboardEvent) => {
    const state = ctx.clipboardTransfer;
    if (!state) return;
    state.pasteEvents += 1;
    state.pasteTrusted = (state.pasteTrusted ?? true) && event.isTrusted;
    state.pastedText = event.clipboardData?.getData("text/plain") ?? "";
  });
  clipboardDestination.addEventListener("input", (event: Event) => {
    const state = ctx.clipboardTransfer;
    if (!state) return;
    if (event instanceof InputEvent && event.inputType === "insertFromPaste") {
      state.pasteInputEvents += 1;
      state.pasteInputTrusted = (state.pasteInputTrusted ?? true) && event.isTrusted;
      state.pasteInputType = event.inputType;
    } else {
      state.directInputEvents += 1;
    }
    updateClipboardState();
  });
  const clipboardTask = el(
    "div",
    { class: "clipboard-task" },
    clipboardStatus,
    el("label", { class: "step2-label" }, "Source token", clipboardSource),
    el("label", { class: "step2-label" }, "Paste destination", clipboardDestination),
  );

  const interList = el("div", { class: "result-list" });
  const interStatus = el(
    "div",
    { class: "status" },
    "Challenge: complete all nine steps, then press Verify. We score motion, timing, trusted keyboard and clipboard delivery, controlled iframe state, and invisible honeypot access.",
  );
  root.append(
    section(
      "② Active challenge (the decisive one)",
      "Complete the task — we judge how it's done, not whether it's done",
      sliderStatus,
      sliderRow,
      keypadStatus,
      keypadPinRow,
      keypadOpenBtn,
      credentialsStatus,
      form,
      iframeTask,
      bonusClickStatus,
      bonusClickRow,
      popupStatus,
      popupLink,
      hoverMenuTask,
      nativeSelectStatus,
      nativeSelectTask,
      clipboardTask,
      submit,
      interStatus,
      interList,
    ),
  );
  // the popup itself renders as an overlay above everything, independent of
  // the page's normal document flow — appended to <body>, not the section.
  document.body.append(keypadOverlay);

  // live: show CHALLENGE PROGRESS, not a score. A behavioral verdict before the
  // task is finished is confusing — the number only appears once you press Verify.
  const REQUIRED_STEPS = 9;
  const liveTimer = window.setInterval(() => {
    const done =
      (ctx.slider?.completed ? 1 : 0) +
      (ctx.keypad?.completed ? 1 : 0) +
      (ctx.credentials?.complete ? 1 : 0) +
      (ctx.iframeInput?.complete && ctx.iframeInput.blurred ? 1 : 0) +
      (ctx.detachedClick?.completed ? 1 : 0) +
      (ctx.popupCheck?.completed ? 1 : 0) +
      (ctx.hoverMenu?.completed ? 1 : 0) +
      (ctx.nativeSelect?.complete ? 1 : 0) +
      (ctx.clipboardTransfer?.completed ? 1 : 0);
    bNum.textContent = "—";
    bCard.className = "vcard";
    bLabel.textContent =
      done >= REQUIRED_STEPS
        ? "all steps done — press Verify to score"
        : `complete the challenge · ${done}/${REQUIRED_STEPS} steps`;
  }, 400);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onCredentialsInput()) {
      credentialsStatus.textContent = `Step 3 incomplete — enter ${expectedEmail} / ${expectedPassword} exactly before verifying.`;
      return;
    }
    updateClipboardState();
    ctx.submittedAt = Date.now();
    // catch bots that set the hidden field's value without firing an input event
    if (hpField.value.trim() !== "") triggerHoneypot("hidden 'email' field had a value at submit");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("click", onClick);
    window.removeEventListener("message", onIframeMessage);
    window.removeEventListener("message", onHoverFrameMessage);
    window.clearInterval(liveTimer);
    window.clearTimeout(keypadCloseTimer);
    window.clearTimeout(detachedSwapTimer);
    popupChannel?.close();
    keypadOverlay.remove();
    submit.disabled = true;
    interList.innerHTML = "";
    interStatus.textContent = "Analyzing behavior…";
    const results = await runDetectors(interactionDetectors, ctx, (r) => interList.append(resultRow(r)));
    const v: Verdict = setBehavioral(results);
    interStatus.textContent =
      v === "fail"
        ? "Behavioral test done — classified as BOT"
        : v === "warn"
          ? "Behavioral test done — suspicious"
          : v === "incomplete"
            ? "Not enough interaction to judge — complete the challenge steps"
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
