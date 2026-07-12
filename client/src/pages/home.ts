import { aggregate, type Rating, type TestResult } from "../../../shared/types";
import { interactionDetectors, staticDetectors } from "../detectors";
import { currentRunner, submitResults } from "../lib/api";
import {
  type DetectorCtx,
  type KeySample,
  type MouseSample,
  runDetectors,
} from "../lib/detector";
import { el, resultRow, verdictLabel } from "../lib/ui";

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
    const done = interactionResults.length > 0 ? "" : " (행동 검사 전 — 아래 폼을 채워보세요)";
    verdictText.textContent = `${verdictLabel(verdict)} · bot score ${botScore}/100${done}`;
    return verdict;
  }

  root.append(
    el(
      "div",
      { class: "home-hero" },
      el("h1", {}, "이 브라우저는 봇인가?"),
      el(
        "p",
        { class: "muted lead" },
        "페이지에 들어오는 순간 자동으로 지문·CDP·자동화 흔적을 검사하고, 아래 로그인 폼에서 마우스·키보드 행동을 분석합니다. 사람이 직접 열면 초록, 자동화 봇(Playwright·Selenium·agent-browser 등)이 열면 빨강.",
      ),
    ),
    banner,
  );

  // ---------- Section 1: static (auto) ----------
  const staticList = el("div", { class: "result-list" });
  const staticStatus = el("div", { class: "status" }, "페이지 진입 검사 실행 중…");
  root.append(
    section("① 자동 검사", "페이지를 여는 것만으로 실행 — 클릭 불필요", staticStatus, staticList),
  );

  const emptyCtx: DetectorCtx = {
    mouse: [], keys: [], scrolls: [], clicks: [], focusEvents: [], formShownAt: 0, submittedAt: 0, pasted: false,
  };

  runDetectors(staticDetectors, emptyCtx, (r) => staticList.append(resultRow(r))).then(async (results) => {
    staticResults = results;
    const failed = results.filter((r) => r.rating === "fail").length;
    staticStatus.textContent = failed
      ? `자동 검사 완료 — ${failed}개 항목에서 봇 흔적 발견`
      : "자동 검사 완료 — 정적 흔적 없음";
    refreshVerdict();
    try {
      await submitResults("static", results);
    } catch {
      /* offline ok */
    }
  });

  // ---------- Section 2: interaction (login form) ----------
  const ctx: DetectorCtx = {
    mouse: [], keys: [], scrolls: [], clicks: [], focusEvents: [], formShownAt: Date.now(), submittedAt: 0, pasted: false,
  };
  const onMove = (e: MouseEvent) => {
    ctx.mouse.push({
      x: e.clientX, y: e.clientY, t: performance.now(), movementX: e.movementX, movementY: e.movementY, isTrusted: e.isTrusted,
    } as MouseSample);
    if (ctx.mouse.length > 2000) ctx.mouse.shift();
  };
  const onScroll = () => ctx.scrolls.push({ t: performance.now(), isTrusted: true });
  const onClick = (e: MouseEvent) =>
    ctx.clicks.push({
      x: e.clientX, y: e.clientY, t: performance.now(), movementX: e.movementX, movementY: e.movementY, isTrusted: e.isTrusted,
    } as MouseSample);
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("click", onClick, { passive: true });

  const form = el("form", { class: "login-form", autocomplete: "off" }) as HTMLFormElement;
  const user = el("input", { type: "text", name: "username", placeholder: "아무 값이나 입력", class: "field" }) as HTMLInputElement;
  const pass = el("input", { type: "password", name: "password", placeholder: "아무 값이나 입력", class: "field" }) as HTMLInputElement;
  const onKey = (e: KeyboardEvent) => ctx.keys.push({ key: e.key, t: performance.now(), isTrusted: e.isTrusted } as KeySample);
  const onPaste = () => { ctx.pasted = true; };
  const onFocus = (e: FocusEvent) => ctx.focusEvents.push({ t: performance.now(), isTrusted: e.isTrusted });
  for (const f of [user, pass]) {
    f.addEventListener("keydown", onKey);
    f.addEventListener("paste", onPaste);
    f.addEventListener("focus", onFocus);
  }
  const submit = el("button", { type: "submit", class: "btn-primary" }, "로그인 (행동 검사 실행)") as HTMLButtonElement;
  form.append(el("label", {}, "아이디", user), el("label", {}, "비밀번호", pass), submit);

  const interList = el("div", { class: "result-list" });
  const interStatus = el("div", { class: "status" }, "마우스를 움직이고 위 칸에 타이핑한 뒤 로그인을 누르세요.");
  root.append(
    section("② 행동 검사", "실제 로그인처럼 마우스·타이핑 → 사람다운 행동인지 판정", form, interStatus, interList),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctx.submittedAt = Date.now();
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("click", onClick);
    submit.disabled = true;
    interList.innerHTML = "";
    interStatus.textContent = "행동 분석 중…";
    const results = await runDetectors(interactionDetectors, ctx, (r) => interList.append(resultRow(r)));
    interactionResults = results;
    const v: Rating = refreshVerdict();
    interStatus.textContent =
      v === "fail" ? "행동 검사 완료 — 봇으로 판정됨" : v === "warn" ? "행동 검사 완료 — 의심스러움" : "행동 검사 완료 — 사람으로 판정됨";
    try {
      await submitResults("interaction", results);
    } catch {
      /* offline ok */
    }
  });

  // footer link to comparison report
  root.append(
    el(
      "p",
      { class: "muted disclaimer" },
      "러너별(agent-browser vs patchright) 비교는 ",
      el("a", { href: "/report", "data-link": "" }, "Report"),
      " 페이지에서. 탐지 원리는 공개 연구(FPScanner·Rebrowser·CreepJS·BotD·BeCAPTCHA-Mouse) 자체 구현.",
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
