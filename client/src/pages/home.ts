import { type TestResult, type Verdict, aggregate } from "../../../shared/types";
import { interactionDetectors, staticDetectors } from "../detectors";
import { currentRunner, fetchInspect, submitResults } from "../lib/api";
import { startCdpMonitor } from "../lib/cdpMonitor";
import { TASK_GROUPS, computeCompetence } from "../lib/competence";
import { type DetectorCtx, type KeySample, type MouseSample, runDetectors } from "../lib/detector";
import { normalizeIframeOrigin, parseHoverShadowMessage, parseIframeInputMessage } from "../lib/iframeChallenge";
import { PUZZLE_SCENES } from "../lib/puzzleImages";
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
  const cNum = el("div", { class: "verdict-num" }, "—");
  const cLabel = el("div", { class: "verdict-tag" }, "how well the tasks were done");
  const cCard = el(
    "div",
    { class: "vcard" },
    cNum,
    el("div", {}, el("div", { class: "verdict-sub" }, "Task competence"), cLabel),
  );
  const banner = el("div", { class: "verdict-banner" }, sCard, bCard, cCard);

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
    // Outside a closed shadow root, clicks are retargeted to the host. Its
    // center is unrelated to the internal control; each shadow challenge
    // records its meaningful interaction in a dedicated handler.
    const tgt = e.target as Element | null;
    if (
      tgt &&
      !tgt.classList.contains("keypad-host") &&
      !tgt.classList.contains("in-page-hover-menu-host") &&
      typeof tgt.getBoundingClientRect === "function"
    ) {
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

  const randomInt = (upperBound: number) => crypto.getRandomValues(new Uint32Array(1))[0] % upperBound;

  // ---- Step 1a: slider drag to a target ----
  const sliderTarget = 60 + randomInt(25); // 60–84
  ctx.slider = { target: sliderTarget, value: 0, samples: [], startedAt: 0, releasedAt: 0, completed: false };
  const sliderStatus = el("div", { class: "status" }, `Step 1a — drag the slider to exactly ${sliderTarget}.`);
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
      ? `Step 1a done — landed on ${s.target}.`
      : `Step 1a — drag the slider to exactly ${s.target}. (now ${s.value})`;
  };
  sliderInput.addEventListener("pointerdown", onSliderStart);
  sliderInput.addEventListener("input", onSliderInput);
  sliderInput.addEventListener("pointerup", onSliderRelease);
  sliderInput.addEventListener("change", onSliderRelease);
  const sliderRow = el("div", { class: "slider-row" }, sliderInput, sliderVal);

  // ---- Step 1b: bar-rotate puzzle — a circle cut out of a random picture; slide the bar to turn it upright and hold ----
  const PZ_W = 360;
  const PZ_H = 240;
  const PZ_R = 46; // cut-out radius
  const PZ_TOL = 6; // degrees
  const PZ_HOLD_MS = 1500; // the bar must then stay still this long before the round is judged
  const PZ_STOP_MS = 120; // no movement for this long counts as "the bar stopped"
  const PZ_DEG_PER_PX = 0.25; // wheel sensitivity (moves the bar; not the bar->angle mapping)
  const PZ_TRAVEL = PZ_W - 44; // handle travel (px); handle is 44px wide
  // current round: picture, cut-out center and start angle (re-rolled after a failed hold)
  let pzScene = PUZZLE_SCENES[randomInt(PUZZLE_SCENES.length)];
  let [pzCx, pzCy] = pzScene.spots[randomInt(pzScene.spots.length)];
  let pzInitial = 0; // angle at bar position 0 (dealt per round, see pzDeal)
  let pzKnots: number[] = [0]; // hidden bar->turns warp (dealt per round)
  let pzHandleX = 0;
  let pzAttempts = 1;
  const normDeg = (d: number) => {
    const m = ((d % 360) + 360) % 360;
    return m > 180 ? m - 360 : m;
  };
  // Bar position -> rotation is deliberately NOT linear and not derivable from one snapshot.
  // Each round deals a random smooth warp u(p) (turns) through 5 segments: it speeds up, slows
  // down and can even turn back, so the same bar distance rotates the circle by different amounts
  // in different places. The warp lives only in this closure (never in the DOM). The solved
  // position p* is chosen first and the start angle derived from it, so a solution always exists.
  const pzRand = () => randomInt(1_000_000) / 1_000_000;
  const pzTurns = (p: number) => {
    const c = Math.max(0, Math.min(1, p));
    const seg = Math.min(pzKnots.length - 2, Math.floor(c * (pzKnots.length - 1)));
    const t = c * (pzKnots.length - 1) - seg;
    const smooth = t * t * (3 - 2 * t);
    return pzKnots[seg] + (pzKnots[seg + 1] - pzKnots[seg]) * smooth;
  };
  const pzAngleAt = (x: number) => normDeg(pzInitial + 360 * pzTurns(x / PZ_TRAVEL));
  const pzDeal = () => {
    for (;;) {
      const knots = [0];
      for (let i = 1; i <= 5; i++) knots.push(knots[i - 1] + (pzRand() * 2 - 1) * 0.26);
      pzKnots = knots;
      const target = 0.25 + pzRand() * 0.65; // where the solved position will sit
      const eps = 0.003;
      const degPerPx = (Math.abs(pzTurns(target + eps) - pzTurns(target - eps)) / (2 * eps)) * (360 / PZ_TRAVEL);
      pzInitial = (((-360 * pzTurns(target)) % 360) + 360) % 360;
      // playable at the solved spot (not razor-thin, not a huge flat zone) and never starts solved
      if (degPerPx >= 0.4 && degPerPx <= 1.8 && Math.abs(normDeg(pzInitial)) >= 40) return;
    }
  };
  pzDeal();
  ctx.puzzleRotate = {
    image: pzScene.file,
    initial: pzInitial,
    angle: normDeg(pzInitial),
    samples: [],
    startedAt: 0,
    completedAt: 0,
    holdMs: PZ_HOLD_MS,
    attempts: 1,
    completed: false,
  };
  const pzStatus = el(
    "div",
    { class: "status" },
    "Step 1b — slide the bar (or scroll over the picture) to turn the circle upright, then stop and hold still.",
  );
  const pzImage = document.createElement("canvas");
  pzImage.width = PZ_W * 2;
  pzImage.height = PZ_H * 2;
  pzImage.className = "pz-image";
  pzImage.style.width = `${PZ_W}px`;
  pzImage.style.height = `${PZ_H}px`;
  const pzDisc = document.createElement("canvas");
  pzDisc.width = PZ_R * 4;
  pzDisc.height = PZ_R * 4;
  pzDisc.className = "pz-disc";
  pzDisc.style.width = `${PZ_R * 2}px`;
  pzDisc.style.height = `${PZ_R * 2}px`;
  const pzProgress = el("div", { class: "pz-progress" });
  const pzFrame = el("div", { class: "pz-frame" }, pzImage, pzDisc);
  const pzHandle = el("div", { class: "pz-handle" }, "\u2194");
  const pzTrack = el(
    "div",
    { class: "pz-track" },
    el("div", { class: "pz-hint" }, "slide the bar to turn the circle"),
    pzHandle,
  );
  const pzBox = el("div", { class: "pz-box" }, pzFrame, pzTrack, el("div", { class: "pz-bar" }, pzProgress));
  // The turn is painted into the canvas itself (no CSS transform / attribute), so the current
  // angle is never readable from the DOM. `pzSrc` is an off-DOM canvas with the un-rotated crop.
  let pzSrc: HTMLCanvasElement | null = null;
  const pzApply = (deg: number) => {
    const dg = pzDisc.getContext("2d");
    if (!dg || !pzSrc) return;
    const c = PZ_R * 2; // canvas center (2x resolution)
    dg.clearRect(0, 0, pzDisc.width, pzDisc.height);
    dg.save();
    dg.translate(c, c);
    dg.rotate((deg * Math.PI) / 180);
    dg.drawImage(pzSrc, -c, -c);
    dg.restore();
    dg.lineWidth = 4;
    dg.strokeStyle = "rgba(255,255,255,0.9)";
    dg.beginPath();
    dg.arc(c, c, c - 2, 0, Math.PI * 2);
    dg.stroke();
  };
  let pzLoadToken = 0;
  // (Re)draw the round: picture with a dashed hole, plus the cut-out disc at its start angle.
  const pzRender = () => {
    const token = ++pzLoadToken;
    pzDisc.style.left = `${pzCx - PZ_R}px`;
    pzDisc.style.top = `${pzCy - PZ_R}px`;
    pzSrc = null; // nothing to show until the new picture has loaded
    pzDisc.getContext("2d")?.clearRect(0, 0, pzDisc.width, pzDisc.height);
    const img = new Image();
    img.onload = () => {
      if (token !== pzLoadToken) return; // a newer round superseded this one
      const g = pzImage.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, pzImage.width, pzImage.height);
      g.drawImage(img, 0, 0, pzImage.width, pzImage.height);
      // copy the circle out of the picture into an off-DOM canvas (un-rotated)...
      const src = document.createElement("canvas");
      src.width = PZ_R * 4;
      src.height = PZ_R * 4;
      const sg = src.getContext("2d");
      if (!sg) return;
      sg.beginPath();
      sg.arc(PZ_R * 2, PZ_R * 2, PZ_R * 2, 0, Math.PI * 2);
      sg.clip();
      sg.drawImage(pzImage, (pzCx - PZ_R) * 2, (pzCy - PZ_R) * 2, PZ_R * 4, PZ_R * 4, 0, 0, PZ_R * 4, PZ_R * 4);
      pzSrc = src;
      pzApply(ctx.puzzleRotate?.angle ?? pzInitial);
      // ...then punch a dashed hole in the picture at the same spot
      g.save();
      g.beginPath();
      g.arc(pzCx * 2, pzCy * 2, PZ_R * 2, 0, Math.PI * 2);
      g.fillStyle = "rgba(20,18,14,0.6)";
      g.fill();
      g.setLineDash([10, 8]);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.stroke();
      g.restore();
    };
    img.src = `/puzzle/${pzScene.file}`;
  };
  pzRender();
  // Judging rule: the bar starts idle. Any movement cancels the countdown; once the bar has been
  // still for PZ_STOP_MS a PZ_HOLD_MS countdown starts (progress bar fills). Moving again resets
  // it. When it finishes the circle must be upright (±PZ_TOL) to pass — otherwise a new round.
  let pzStopTimer = 0;
  let pzHoldTimer = 0;
  const pzAligned = () => Math.abs(ctx.puzzleRotate?.angle ?? 180) <= PZ_TOL;
  const pzCancelHold = () => {
    window.clearTimeout(pzStopTimer);
    window.clearTimeout(pzHoldTimer);
    pzStopTimer = 0;
    pzHoldTimer = 0;
    pzProgress.style.transition = "none";
    pzProgress.style.width = "0%";
  };
  // A failed round (countdown finished while the circle was not upright) deals a fresh one:
  // different picture, cut-out spot and start angle, bar back at the start, telemetry restarted.
  const pzReroll = () => {
    const s = ctx.puzzleRotate;
    if (!s || s.completed) return;
    const others = PUZZLE_SCENES.filter((x) => x.file !== pzScene.file);
    pzScene = others[randomInt(others.length)];
    [pzCx, pzCy] = pzScene.spots[randomInt(pzScene.spots.length)];
    pzDeal();
    pzAttempts += 1;
    pzHandleX = 0;
    pzHandle.style.left = "0px";
    pzDragging = false; // the grip is lost; the bar must be grabbed again
    s.image = pzScene.file;
    s.initial = pzInitial;
    s.angle = normDeg(pzInitial);
    s.samples = [];
    s.startedAt = 0;
    s.attempts = pzAttempts;
    pzRender();
    pzStatus.textContent =
      "Step 1b — the circle was not upright, so the picture changed. Slide the bar to turn the new circle upright, then stop.";
  };
  // The bar is the main control: handle position (0..PZ_TRAVEL px) maps linearly onto one
  // full turn (0..360°) added to the initial angle. The wheel over the picture just nudges the
  // same bar, so both inputs share one state.
  const pzSetHandle = (x: number, src: "bar" | "wheel", trusted: boolean, px: number, py: number) => {
    const s = ctx.puzzleRotate;
    if (!s || s.completed) return;
    if (s.startedAt === 0) s.startedAt = performance.now();
    const nx = Math.max(0, Math.min(PZ_TRAVEL, x));
    const dx = nx - pzHandleX;
    pzHandleX = nx;
    pzHandle.style.left = `${nx}px`;
    s.angle = pzAngleAt(nx);
    pzApply(s.angle);
    s.samples.push({ t: performance.now(), dy: dx, angle: s.angle, trusted, x: px, y: py, src });
    // moving resets the countdown; it (re)starts only once the bar has stopped
    pzCancelHold();
    pzStatus.textContent = "Step 1b — turn the circle upright, then stop the bar and hold still.";
    pzStopTimer = window.setTimeout(() => {
      pzStopTimer = 0;
      pzStatus.textContent = "Step 1b — hold still… checking in a moment.";
      void pzProgress.offsetWidth; // flush the reset so the fill animates from 0
      pzProgress.style.transition = `width ${PZ_HOLD_MS}ms linear`;
      pzProgress.style.width = "100%";
      pzHoldTimer = window.setTimeout(() => {
        pzHoldTimer = 0;
        if (s.completed) return;
        if (pzAligned()) {
          s.completed = true;
          s.completedAt = performance.now();
          pzBox.classList.add("pz-ok");
          pzStatus.textContent = "Step 1b done — the circle fits.";
        } else {
          pzCancelHold();
          pzReroll();
        }
      }, PZ_HOLD_MS);
    }, PZ_STOP_MS);
  };
  let pzDragging = false;
  let pzGrabDx = 0;
  pzHandle.addEventListener("pointerdown", (e) => {
    if (ctx.puzzleRotate?.completed) return;
    pzDragging = true;
    pzGrabDx = e.clientX - pzHandle.getBoundingClientRect().left;
    pzHandle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  pzHandle.addEventListener("pointermove", (e) => {
    if (!pzDragging) return;
    pzSetHandle(e.clientX - pzTrack.getBoundingClientRect().left - pzGrabDx, "bar", e.isTrusted, e.clientX, e.clientY);
  });
  const pzRelease = () => {
    pzDragging = false;
  };
  pzHandle.addEventListener("pointerup", pzRelease);
  pzHandle.addEventListener("pointercancel", pzRelease);
  // wheel over the picture nudges the same bar (keeps scroll-to-rotate working too)
  pzFrame.addEventListener(
    "wheel",
    (e) => {
      if (ctx.puzzleRotate?.completed) return; // let the page scroll again once solved
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? PZ_H : 1;
      const deg = e.deltaY * unit * PZ_DEG_PER_PX;
      pzSetHandle(pzHandleX + (deg / 360) * PZ_TRAVEL, "wheel", e.isTrusted, e.clientX, e.clientY);
    },
    { passive: false },
  );

  // ---- Step 1c: virtual security keypad — click-to-enter PIN, no keyboard ----
  // Mirrors real bank / cert-auth "secure keypads": clicking a masked PIN field
  // pops up a small floating panel (not an inline page section) containing a
  // CLOSED shadow-root keypad (see the `shadowDomIntegrity` passive check) so
  // the digit↔position mapping can't be read by DOM-walking automation, and the
  // layout RE-SHUFFLES after every click so on-screen coordinates can't be
  // cached across taps. The popup closes itself the moment the PIN is complete.
  const KEYPAD_PIN_LEN = 4;
  const keypadPin: number[] = Array.from({ length: KEYPAD_PIN_LEN }, () => randomInt(10));
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
    `Step 1c — click "Enter PIN" to open the popup keypad and enter ${keypadPin.join(" ")} (mouse only — no typing). The keypad layout reshuffles after every tap, so re-check digit positions before each click.`,
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
        ? "Step 1c done — continue to Step 2a."
        : "Step 1c done (with wrong taps) — continue to Step 2a.";
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
      const j = randomInt(i + 1);
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

  // ---- Step 2b: trusted typing into a nested controlled iframe ----
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
    el("div", { class: "step2-label" }, "Step 2b — Nested certificate mobile verification"),
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
      ? `Step 2b done — controlled state retained ${state.controlledValue} after blur · trusted inputs=${state.trustedInputEvents} · trusted clicks=${state.trustedClickEvents}.`
      : `Step 2b — state=${state.controlledValue || "empty"} · trusted inputs=${state.trustedInputEvents} · untrusted inputs=${state.untrustedInputEvents} · trusted clicks=${state.trustedClickEvents} · untrusted clicks=${state.untrustedClickEvents}`;
  };
  window.addEventListener("message", onIframeMessage);

  // ---- Step 2a: credentials must match a specific, freshly generated value ----
  // Mirrors the Step 2b (phone digits) / Step 5a (select value) pattern: a random
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
    `Step 2a — type this email and password exactly: ${expectedEmail} / ${expectedPassword}`,
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
      ? "Step 2a done — credentials matched."
      : `Step 2a — type this email and password exactly: ${c.expectedEmail} / ${c.expectedPassword}`;
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

  // ---- Step 3a: DOM-churn click test ----
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
  const bonusClickStatus = el("div", { class: "status" }, "Step 3a — click the button below.");
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
    bonusClickStatus.textContent = "Step 3a done — continue to Step 3b.";
  };
  bonusBtn.addEventListener("click", onBonusClick(false));
  const detachedSwapTimer = window.setTimeout(() => {
    const d = ctx.detachedClick;
    if (!d || d.completed) return; // already resolved via an early click — nothing to swap
    const replacement = el("button", { type: "button", class: "btn-secondary" }, "Click me") as HTMLButtonElement;
    replacement.addEventListener("click", onBonusClick(true));
    d.swappedAt = performance.now();
    bonusBtn.replaceWith(replacement);
    bonusBtn = replacement;
  }, 500 + randomInt(400));

  // ---- Step 3b: popup window.opener / referrer integrity ----
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
  const popupStatus = el("div", { class: "status" }, "Step 3b — open the verification tab (target=_blank).");
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
      popupStatus.textContent = `Step 3b done — opener=${p.openerPresent}, referrer=${p.referrerNonEmpty}.`;
    };
  }

  // ---- Step 4b: iframe + closed Shadow DOM hover menu ----
  // The interaction surface crosses an iframe boundary, then hides its menu
  // inside a closed shadow root. Only postMessage telemetry from the expected
  // origin, frame window, and per-run challenge is accepted back here.
  const HOVER_MENU_OPTIONS = ["Card", "Bank transfer", "Kakao Pay"];
  const iframeExpectedHoverOption = HOVER_MENU_OPTIONS[randomInt(HOVER_MENU_OPTIONS.length)];
  const hoverChallengeId = crypto.randomUUID();
  ctx.hoverMenu = {
    challengeId: hoverChallengeId,
    options: HOVER_MENU_OPTIONS,
    expectedOption: iframeExpectedHoverOption,
    openedAt: 0,
    frameOpenedAt: 0,
    openChallengeId: null,
    hoverTrusted: null,
    selectedOption: null,
    selectedAt: 0,
    frameSelectedAt: 0,
    selectChallengeId: null,
    trusted: false,
    completed: false,
  };
  const hoverMenuStatus = el(
    "div",
    { class: "iframe-task-status" },
    `Hover inside the frame and choose “${iframeExpectedHoverOption}” from the Shadow DOM menu.`,
  );
  const hoverFrameUrl = new URL("/iframe-lab/hover-shadow.html", iframeOrigin ?? location.origin);
  hoverFrameUrl.search = new URLSearchParams({
    challengeId: hoverChallengeId,
    expectedOption: iframeExpectedHoverOption,
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
    el("div", { class: "step2-label" }, "Step 4b — Iframe Shadow DOM hover menu"),
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
      h.frameOpenedAt = data.timestamp;
      h.openChallengeId = data.challengeId;
      h.hoverTrusted = data.isTrusted;
      return;
    }
    h.selectedOption = data.selectedOption;
    h.selectedAt = performance.now();
    h.frameSelectedAt = data.timestamp;
    h.selectChallengeId = data.challengeId;
    h.trusted = data.isTrusted;
    h.completed = data.selectedOption === h.expectedOption;
    hoverMenuStatus.className = h.completed ? "iframe-task-status iframe-task-pass" : "iframe-task-status";
    hoverMenuStatus.textContent = h.completed
      ? `Step 4b done — selected "${data.selectedOption}" through the iframe Shadow DOM.`
      : `"${data.selectedOption}" is not the requested option. Hover again and choose "${h.expectedOption}".`;
    if (!h.completed) {
      h.openedAt = 0;
      h.frameOpenedAt = 0;
      h.openChallengeId = null;
      h.hoverTrusted = null;
      h.frameSelectedAt = 0;
      h.selectChallengeId = null;
    }
  };
  window.addEventListener("message", onHoverFrameMessage);

  // ---- Step 4a: in-page closed Shadow DOM hover menu ----
  const inPageExpectedHoverOption = HOVER_MENU_OPTIONS[randomInt(HOVER_MENU_OPTIONS.length)];
  ctx.inPageHoverMenu = {
    options: HOVER_MENU_OPTIONS,
    expectedOption: inPageExpectedHoverOption,
    openedAt: 0,
    hoverStartX: 0,
    hoverStartY: 0,
    selectedOption: null,
    selectedAt: 0,
    mouseSamples: 0,
    pathLength: 0,
    targetGap: 0,
    trusted: false,
    completed: false,
  };
  const inPageHoverStatus = el(
    "div",
    { class: "iframe-task-status" },
    `Hover over “Payment method” and choose “${inPageExpectedHoverOption}” (opens on hover, not on click).`,
  );
  const inPageHoverHost = el("div", { class: "in-page-hover-menu-host" });
  const inPageHoverShadow = inPageHoverHost.attachShadow({ mode: "closed" });
  const inPageHoverStyle = el(
    "style",
    {},
    `
      .wrap { position: relative; display: inline-block; min-width: 210px; padding-bottom: 125px; }
      .trigger { width: 210px; padding: 11px 14px; border: 1px solid var(--line-strong, #d8d2c5); border-radius: 8px; background: var(--surface, white); color: var(--ink, #1b1915); font: 600 14px system-ui, sans-serif; text-align: left; cursor: default; }
      .trigger:focus-visible { outline: 2px solid var(--pass, #3f7d54); outline-offset: 2px; }
      .menu { display: none; position: absolute; top: 46px; left: 0; box-sizing: border-box; width: 210px; padding: 6px; border: 1px solid var(--line-strong, #d8d2c5); border-radius: 8px; background: var(--surface, white); box-shadow: 0 8px 20px rgba(27, 25, 21, .16); }
      .open .menu { display: block; }
      .item { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--ink, #1b1915); font: 13px system-ui, sans-serif; text-align: left; cursor: pointer; }
      .item:hover, .item:focus-visible { background: var(--pass-bg, #e8efe6); outline: none; }
    `,
  );
  const inPageHoverTrigger = el(
    "button",
    { type: "button", class: "trigger", "aria-haspopup": "menu", "aria-expanded": "false" },
    "Payment method ▾",
  ) as HTMLButtonElement;
  const inPageHoverList = el("div", { class: "menu", role: "menu" });
  const inPageHoverWrap = el("div", { class: "wrap" }, inPageHoverTrigger, inPageHoverList);
  let inPageHoverCloseTimer = 0;
  const cancelInPageHoverClose = () => {
    if (inPageHoverCloseTimer) window.clearTimeout(inPageHoverCloseTimer);
    inPageHoverCloseTimer = 0;
  };
  const closeInPageHoverMenu = () => {
    cancelInPageHoverClose();
    inPageHoverWrap.classList.remove("open");
    inPageHoverTrigger.setAttribute("aria-expanded", "false");
    const state = ctx.inPageHoverMenu;
    if (state && !state.completed) state.openedAt = 0;
  };
  const scheduleInPageHoverClose = () => {
    cancelInPageHoverClose();
    if (ctx.inPageHoverMenu?.completed) return;
    inPageHoverCloseTimer = window.setTimeout(closeInPageHoverMenu, 180);
  };
  inPageHoverTrigger.addEventListener("mouseenter", (event: MouseEvent) => {
    cancelInPageHoverClose();
    const state = ctx.inPageHoverMenu;
    if (!state || state.completed || !event.isTrusted) return;
    if (state.openedAt === 0) {
      state.openedAt = performance.now();
      state.hoverStartX = event.clientX;
      state.hoverStartY = event.clientY;
      state.mouseSamples = 0;
      state.pathLength = 0;
      state.targetGap = 0;
    }
    inPageHoverWrap.classList.add("open");
    inPageHoverTrigger.setAttribute("aria-expanded", "true");
  });
  inPageHoverTrigger.addEventListener("mouseleave", scheduleInPageHoverClose);
  inPageHoverTrigger.addEventListener("click", (event: MouseEvent) => event.preventDefault());
  inPageHoverList.addEventListener("mouseenter", cancelInPageHoverClose);
  inPageHoverList.addEventListener("mouseleave", scheduleInPageHoverClose);
  for (const option of HOVER_MENU_OPTIONS) {
    const item = el("button", { type: "button", class: "item", role: "menuitem" }, option);
    item.addEventListener("click", (event: MouseEvent) => {
      const state = ctx.inPageHoverMenu;
      if (!state || state.completed) return;
      state.selectedOption = option;
      state.selectedAt = performance.now();
      const trail = ctx.mouse.filter((sample) => sample.t >= state.openedAt && sample.t <= state.selectedAt);
      let previousX = state.hoverStartX;
      let previousY = state.hoverStartY;
      state.pathLength = 0;
      for (const sample of trail) {
        state.pathLength += Math.hypot(sample.x - previousX, sample.y - previousY);
        previousX = sample.x;
        previousY = sample.y;
      }
      state.mouseSamples = trail.length;
      state.targetGap = Math.hypot(event.clientX - state.hoverStartX, event.clientY - state.hoverStartY);
      state.trusted = event.isTrusted;
      state.completed = option === state.expectedOption;
      inPageHoverStatus.className = state.completed ? "iframe-task-status iframe-task-pass" : "iframe-task-status";
      inPageHoverStatus.textContent = state.completed
        ? `Step 4a done — selected "${option}" in the page Shadow DOM.`
        : `"${option}" is not the requested option. Hover again and choose "${state.expectedOption}".`;
      closeInPageHoverMenu();
      if (state.completed) {
        inPageHoverTrigger.textContent = `${option} selected`;
        inPageHoverTrigger.disabled = true;
      }
    });
    inPageHoverList.append(item);
  }
  inPageHoverShadow.append(inPageHoverStyle, inPageHoverWrap);
  const inPageHoverTask = el(
    "div",
    { class: "iframe-task" },
    el("div", { class: "step2-label" }, "Step 4a — In-page Shadow DOM hover menu"),
    inPageHoverStatus,
    inPageHoverHost,
  );

  // ---- Step 5a: native select must be changed through trusted input ----
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
    "Step 5a — choose “Wire transfer” from the native Settlement method dropdown.",
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
    nativeSelectStatus.textContent = `Step 5a — value=${state.value || "empty"} · input trusted=${String(state.inputTrusted)} · change trusted=${String(state.changeTrusted)}`;
  };
  nativeSelect.addEventListener("input", onNativeSelect);
  nativeSelect.addEventListener("change", onNativeSelect);
  const nativeSelectTask = el("label", { class: "step2-label" }, "Step 5a — Native settlement method", nativeSelect);

  // ---- Step 5b: explicit trusted copy/paste transfer ----
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
    "Step 5b — copy the token from the source field, then paste it into the destination field.",
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
      ? "Step 5b done — trusted copy and paste matched the token."
      : "Step 5b — copy the token from the source field, then paste it into the destination field.";
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

  // ---- Human-verification look-alike ("please slide to verify"): drag the bar so the piece fills the
  // gap. It has the same pass rule as the rotation puzzle (Step 1b): move the bar, stop, and a
  // PZ_HOLD_MS countdown starts; moving again resets it; when it ends the piece must sit in the gap
  // (else a new picture is dealt). No numbered step depends on it. Beside the slider is text that
  // exists only in the accessibility tree / DOM: a visually hidden "please sign in to verify" note
  // with a "Sign in to verify" button. We record whether a session touches the slider, whether it
  // solves it, and whether it follows that text (informational only).
  ctx.verifyProbe = {
    shownAt: performance.now(),
    slider: { samples: [], startedAt: 0, releasedAt: 0 },
    fallbackClicks: [],
    holdMs: PZ_HOLD_MS,
    attempts: 1,
    passed: false,
    passedAt: 0,
  };
  const VF_W = 320;
  const VF_H = 160;
  const VF_PIECE = 56;
  const VF_TOL = 4; // px between the piece and the gap
  const VF_HANDLE = 56;
  const VF_TRAVEL = VF_W - VF_HANDLE;
  let vfScene = PUZZLE_SCENES[randomInt(PUZZLE_SCENES.length)];
  let vfGapX = 110 + randomInt(VF_W - VF_PIECE - 130);
  let vfGapY = 24 + randomInt(VF_H - VF_PIECE - 48);
  let vfHandleX = 0;
  let vfLoadToken = 0;
  const vfImage = document.createElement("canvas");
  vfImage.width = VF_W * 2;
  vfImage.height = VF_H * 2;
  vfImage.className = "vf-image";
  const vfPiece = document.createElement("canvas");
  vfPiece.width = VF_PIECE * 2;
  vfPiece.height = VF_PIECE * 2;
  vfPiece.className = "vf-piece";
  // (Re)draw the round: photo with a dimmed hole, and the piece cut out of that spot.
  const vfRender = () => {
    const token = ++vfLoadToken;
    vfPiece.style.top = `${vfGapY}px`;
    vfPiece.getContext("2d")?.clearRect(0, 0, vfPiece.width, vfPiece.height);
    const photo = new Image();
    photo.onload = () => {
      if (token !== vfLoadToken) return; // a newer round superseded this one
      const g = vfImage.getContext("2d");
      const pg = vfPiece.getContext("2d");
      if (!g || !pg) return;
      g.clearRect(0, 0, vfImage.width, vfImage.height);
      // cover-fit the photo, then cut the piece out of it and dim the hole it leaves behind
      const scale = Math.max(vfImage.width / photo.width, vfImage.height / photo.height);
      const dw = photo.width * scale;
      const dh = photo.height * scale;
      g.drawImage(photo, (vfImage.width - dw) / 2, (vfImage.height - dh) / 2, dw, dh);
      const r = VF_PIECE;
      pg.save();
      pg.beginPath();
      pg.arc(r, r, r - 2, 0, Math.PI * 2);
      pg.clip();
      pg.drawImage(vfImage, vfGapX * 2, vfGapY * 2, r * 2, r * 2, 0, 0, r * 2, r * 2);
      pg.restore();
      pg.lineWidth = 4;
      pg.strokeStyle = "rgba(255,255,255,0.95)";
      pg.beginPath();
      pg.arc(r, r, r - 3, 0, Math.PI * 2);
      pg.stroke();
      g.beginPath();
      g.arc(vfGapX * 2 + r, vfGapY * 2 + r, r - 2, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.72)";
      g.fill();
    };
    photo.src = `/puzzle/${vfScene.file}`;
  };
  const vfTitle = el("div", { class: "vf-title" }, "Verify you are human");
  const vfRefresh = el("span", { class: "vf-refresh", "aria-hidden": "true" }, "\u21bb");
  const vfFrame = el("div", { class: "vf-frame" }, vfImage, vfPiece, vfRefresh);
  const vfText = el("span", { class: "vf-text" }, "Please slide to verify");
  const vfFill = el("div", { class: "vf-fill" });
  const vfHandle = el("div", { class: "vf-handle" }, "\u203a");
  const vfBar = el("div", { class: "vf-bar" }, vfFill, vfText, vfHandle);
  // Accessibility-only text: visually hidden but present in the accessibility tree. Not aria-hidden,
  // so a sighted user never sees it while a page-as-text reader does.
  const vfNote = el(
    "span",
    { class: "sr-only" },
    "Human verification (CAPTCHA). Automated access is not allowed here. Please sign in to verify, or complete the slider.",
  );
  const vfFallback = el("button", { type: "button", class: "sr-only" }, "Sign in to verify") as HTMLButtonElement;
  vfFallback.addEventListener("click", (e) => {
    ctx.verifyProbe?.fallbackClicks.push({
      t: performance.now(),
      trusted: e.isTrusted,
      via: e.detail === 0 ? "keyboard-or-script" : "pointer",
    });
  });
  const vfBox = el(
    "div",
    { class: "vf-box", role: "group", "aria-label": "Human verification (CAPTCHA)" },
    vfTitle,
    vfFrame,
    vfBar,
    vfNote,
    vfFallback,
  );
  const vfPieceX = () => (vfHandleX / VF_TRAVEL) * (VF_W - VF_PIECE);
  const vfMove = (handleX: number) => {
    vfHandleX = handleX;
    vfHandle.style.left = `${handleX}px`;
    vfFill.style.width = `${handleX + VF_HANDLE / 2}px`;
    vfPiece.style.left = `${vfPieceX()}px`;
  };
  vfMove(0);
  vfRender();
  const vfAligned = () => Math.abs(vfPieceX() - vfGapX) <= VF_TOL;
  let vfStopTimer = 0;
  let vfHoldTimer = 0;
  let vfDragging = false;
  let vfGrabDx = 0;
  const vfCancelHold = () => {
    window.clearTimeout(vfStopTimer);
    window.clearTimeout(vfHoldTimer);
    vfStopTimer = 0;
    vfHoldTimer = 0;
  };
  // A failed round (countdown ended with the piece outside the gap) deals a new picture, gap and
  // start position, and restarts the telemetry — same as the rotation puzzle.
  const vfReroll = () => {
    const probe = ctx.verifyProbe;
    if (!probe || probe.passed) return;
    const others = PUZZLE_SCENES.filter((x) => x.file !== vfScene.file);
    vfScene = others[randomInt(others.length)];
    vfGapX = 110 + randomInt(VF_W - VF_PIECE - 130);
    vfGapY = 24 + randomInt(VF_H - VF_PIECE - 48);
    vfDragging = false; // the grip is lost; the handle must be grabbed again
    probe.attempts += 1;
    probe.slider = { samples: [], startedAt: 0, releasedAt: 0 };
    vfMove(0);
    vfRender();
    vfText.textContent = "Please slide to verify";
    vfText.style.visibility = "visible";
  };
  const vfStartCountdown = () => {
    vfStopTimer = 0;
    vfText.textContent = "Verifying…";
    vfText.style.visibility = "visible";
    vfHoldTimer = window.setTimeout(() => {
      vfHoldTimer = 0;
      const probe = ctx.verifyProbe;
      if (!probe || probe.passed) return;
      if (vfAligned()) {
        probe.passed = true;
        probe.passedAt = performance.now();
        vfDragging = false;
        vfBox.classList.add("vf-ok");
        vfText.textContent = "Verification passed";
      } else {
        vfText.textContent = "Verification failed, please try again";
        window.setTimeout(vfReroll, 900);
      }
    }, PZ_HOLD_MS);
  };
  vfHandle.addEventListener("pointerdown", (e) => {
    if (ctx.verifyProbe?.passed) return;
    vfDragging = true;
    vfGrabDx = e.clientX - vfHandle.getBoundingClientRect().left;
    vfHandle.setPointerCapture(e.pointerId);
    const sl = ctx.verifyProbe?.slider;
    if (sl && sl.startedAt === 0) sl.startedAt = performance.now();
    e.preventDefault();
  });
  vfHandle.addEventListener("pointermove", (e) => {
    if (!vfDragging || ctx.verifyProbe?.passed) return;
    const x = Math.max(0, Math.min(VF_TRAVEL, e.clientX - vfBar.getBoundingClientRect().left - vfGrabDx));
    vfMove(x);
    ctx.verifyProbe?.slider.samples.push({ x: e.clientX, y: e.clientY, t: performance.now(), trusted: e.isTrusted });
    // moving resets the countdown; it (re)starts once the handle has been still for PZ_STOP_MS
    vfCancelHold();
    vfText.style.visibility = "hidden";
    vfStopTimer = window.setTimeout(vfStartCountdown, PZ_STOP_MS);
  });
  const vfRelease = () => {
    if (!vfDragging) return;
    vfDragging = false;
    const sl = ctx.verifyProbe?.slider;
    if (sl) sl.releasedAt = performance.now();
  };
  vfHandle.addEventListener("pointerup", vfRelease);
  vfHandle.addEventListener("pointercancel", vfRelease);

  const interList = el("div", { class: "result-list" });
  const interStatus = el(
    "div",
    { class: "status" },
    "Do as many tasks as you can, then press Verify — you do not have to finish them all. The bot score judges the motion, timing, trusted input and honeypot access of what you did; task competence judges how many tasks you completed correctly.",
  );
  const competenceList = el("div", { class: "competence-list" });
  const scoringHelp = el(
    "details",
    { class: "scoring-help" },
    el("summary", {}, "How scoring works"),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Bot score (0–100, lower is more human): combines the passive checks with the behavior signals of the tasks you actually did. A task you skipped adds nothing and is never held against you.",
      ),
      el(
        "li",
        {},
        "Task competence (0–100): share of the 11 tasks (grouped into 5 steps) completed correctly. Retries and mistakes we can measure (extra Step 1b rounds, wrong Step 1c taps) cost a little credit, never more than 60% of a task.",
      ),
      el(
        "li",
        {},
        "You can press Verify at any time. The two scores are independent: a fast, correct run can still read as a bot, and a human can score low on competence by skipping tasks.",
      ),
    ),
  );
  // A step is one card holding several related tasks (1a, 1b, 1c, ...). Step 1 bundles the value
  // slider, the rotation puzzle (with its look-alike widget) and the keypad.
  const taskGroup = (id: string, ...body: (Node | string)[]): HTMLElement => {
    const g = TASK_GROUPS.find((x) => x.id === id);
    if (!g) throw new Error(`unknown task group ${id}`);
    return el(
      "div",
      { class: "task-group", "data-group": id },
      el(
        "div",
        { class: "task-group-head" },
        el("h3", {}, `Step ${g.number} — ${g.title}`),
        el("span", { class: "task-group-steps" }, `${g.tasks} tasks`),
        el("span", { class: "task-group-progress", "data-progress-for": id }, "0 done"),
      ),
      ...body,
    );
  };
  root.append(
    section(
      "② Active challenge (the decisive one)",
      "Do what you can — we judge how it's done, and how well",
      scoringHelp,
      taskGroup("pointer", sliderStatus, sliderRow, pzStatus, pzBox, vfBox, keypadStatus, keypadPinRow, keypadOpenBtn),
      taskGroup("input", credentialsStatus, form, iframeTask),
      taskGroup("click", bonusClickStatus, bonusClickRow, popupStatus, popupLink),
      taskGroup("hover", inPageHoverTask, hoverMenuTask),
      taskGroup("select", nativeSelectStatus, nativeSelectTask, clipboardTask),
      submit,
      interStatus,
      interList,
      competenceList,
    ),
  );
  // the popup itself renders as an overlay above everything, independent of
  // the page's normal document flow — appended to <body>, not the section.
  document.body.append(keypadOverlay);

  // live: show CHALLENGE PROGRESS, not a score. A behavioral verdict before the
  // task is finished is confusing — the number only appears once you press Verify.
  const liveTimer = window.setInterval(() => {
    const c = computeCompetence(ctx);
    bNum.textContent = "—";
    bCard.className = "vcard";
    bLabel.textContent =
      c.completed >= c.total
        ? "all tasks done — press Verify to score"
        : `${c.completed}/${c.total} tasks (${c.stepsCompleted}/${c.stepsTotal} steps) done — press Verify any time to score`;
    for (const g of TASK_GROUPS) {
      const mine = c.tasks.filter((t) => t.group === g.id);
      const n = mine.filter((t) => t.completed).length;
      const badge = root.querySelector(`[data-progress-for="${g.id}"]`);
      if (badge) {
        badge.textContent = `${n}/${mine.length} done`;
        badge.classList.toggle("task-group-done", n === mine.length);
      }
    }
  }, 400);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Verify works at any point: unfinished tasks are simply not scored (and not held against you).
    onCredentialsInput();
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
    window.clearTimeout(inPageHoverCloseTimer);
    popupChannel?.close();
    keypadOverlay.remove();
    submit.disabled = true;
    interList.innerHTML = "";
    interStatus.textContent = "Analyzing behavior…";
    const results = await runDetectors(interactionDetectors, ctx, (r) => interList.append(resultRow(r)));
    const v: Verdict = setBehavioral(results);
    const comp = computeCompetence(ctx);
    cNum.textContent = String(comp.score);
    cCard.className = `vcard meter-${comp.score >= 70 ? "pass" : comp.score >= 40 ? "warn" : "fail"}`;
    cLabel.textContent = `${comp.score}/100 · ${comp.completed} of ${comp.total} tasks · ${comp.stepsCompleted} of ${comp.stepsTotal} steps`;
    competenceList.innerHTML = "";
    competenceList.append(el("h3", {}, "Task competence"));
    for (const g of TASK_GROUPS) {
      const mine = comp.tasks.filter((t) => t.group === g.id);
      competenceList.append(
        el(
          "div",
          { class: "competence-group" },
          el("div", { class: "competence-group-title" }, `Step ${g.number} — ${g.title}`),
          ...mine.map((t) =>
            el(
              "div",
              { class: `competence-task ${t.completed ? "competence-ok" : "competence-miss"}` },
              `${t.completed ? "✓" : "✗"} ${t.id} — ${t.label}${t.note ? ` (${t.note})` : ""}`,
            ),
          ),
        ),
      );
    }
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
