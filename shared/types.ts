// AgentMcpLab — shared types (client + Cloudflare Functions)

/**
 * A detector verdict.
 *  - pass / warn / fail: an actual measurement was made.
 *  - inconclusive: the signal could not be measured (not enough interaction, API
 *    blocked/absent, exception, not-applicable). MUST NOT contribute to the score.
 */
export type Rating = "pass" | "warn" | "fail" | "inconclusive";

/** Overall verdict for a page — adds "incomplete" when nothing could be scored. */
export type Verdict = "pass" | "warn" | "fail" | "incomplete";

/** Unified result for a single detection test. */
export interface TestResult {
  /** stable test id, e.g. "cdpMouseLeak" */
  test: string;
  /** human-friendly label */
  label?: string;
  /** which page/category produced it */
  category?: "static" | "interaction" | "network";
  rating: Rating;
  /** 0 = clean/human, higher = more bot-like */
  score: number;
  /** arbitrary supporting data */
  evidence: Record<string, unknown>;
  /** epoch ms */
  timestamp: number;
}

/**
 * Detector role in scoring:
 *  - "hard": a deterministic, near-zero-false-positive rule (webdriver flag,
 *    framework global, honeypot, Node surface). A hard fail is decisive.
 *  - "heuristic": a probabilistic tell that contributes weighted evidence.
 *  - "info": informational fingerprint surface — never contributes to the score.
 */
export type DetectorKind = "hard" | "heuristic" | "info";

/** A full run wrapping many TestResults. */
export interface Session {
  sessionId: string;
  /** who produced it: "human", "agent-browser", "patchright", ... */
  runner: string;
  userAgent: string;
  page: "static" | "interaction";
  results: TestResult[];
  /** 0..100, higher = more likely a bot */
  botScore: number;
  verdict: Verdict;
  /** cloudflare request.cf-derived network fingerprint (server-filled) */
  network?: NetworkFingerprint;
  createdAt: number;
}

export interface NetworkFingerprint {
  tlsVersion?: string;
  tlsCipher?: string;
  httpProtocol?: string;
  clientTcpRtt?: number;
  tlsClientHelloLength?: number;
  ja3Hash?: string; // only with Bot Management (paid)
  country?: string;
  asOrganization?: string;
}

/** POST /api/results body */
export interface SubmitBody {
  runner: string;
  page: "static" | "interaction";
  results: TestResult[];
}

/**
 * Per-detector reliability weight (0..1). A detector's raw score is multiplied
 * by this before it contributes to the total, so noisy / rare tells (speech
 * voices, fonts, WebRTC, audio) can never penalize much even when they fire,
 * while definitive tells (webdriver, automation globals, CDP, isTrusted, the
 * shift-char killer, exact-center click) carry full weight.
 *
 * Tune here — this is the single place that decides "how much each check matters".
 */
/**
 * Hard decisive rules: deterministic, near-zero false positive. A hard `fail`
 * floors the bot score high regardless of the heuristic total. These are the
 * only signals allowed to condemn a browser on their own.
 */
export const HARD_RULES: ReadonlySet<string> = new Set([
  "webdriver",
  "automationGlobals",
  "isTrusted",
  "honeypot",
  "exposeFunctionLeak",
  "electronDetection",
  "cspBypass",
  "cdpRuntimeLeak",
]);

/**
 * Evidence groups: correlated detectors that largely measure the SAME underlying
 * fact (e.g. "there was no real mouse motion"). Within a group we take the single
 * strongest signal (max) instead of multiplying them as independent probabilities,
 * so one physical reality can't be counted five times under noisy-OR.
 */
export const EVIDENCE_GROUPS: Record<string, string> = {
  // mouse-motion family
  mouseEntropy: "mouse-motion",
  mouseKinematics: "mouse-motion",
  clickTeleport: "mouse-motion",
  cdpMouseLeak: "mouse-motion",
  exactCenterClick: "mouse-motion",
  // keystroke family
  typingCadence: "keystroke",
  keyboardDynamics: "keystroke",
  // UA / engine consistency family
  clientHints: "ua-consistency",
  engineCoherence: "ua-consistency",
  headlessSignals: "ua-consistency",
};

export const DETECTOR_WEIGHTS: Record<string, number> = {
  // --- hard decisive rules (see HARD_RULES) — full weight, floor the score ---
  webdriver: 1,
  automationGlobals: 1,
  isTrusted: 1,
  honeypot: 1,
  exposeFunctionLeak: 1,
  electronDetection: 1,
  cspBypass: 0.9,
  cdpRuntimeLeak: 1,
  // --- strong heuristics ---
  cdpStackTrace: 0.9, // injected-script sourceURL markers
  nativeToString: 0.8, // patched native fn (rare benign extensions exist → not "hard")
  cdpMouseLeak: 0.6,
  delayedButton: 0.7, // clicked before enabled / superhuman reaction
  gridChallenge: 0.6, // teleport / dead-center / superhuman ordered clicks
  sliderDrag: 0.6, // drag kinematics: jump / linear ramp / superhuman
  mediaCodecs: 0.5,
  headlessSignals: 0.5,
  clientHints: 0.5,
  engineCoherence: 0.5,
  permissionsMismatch: 0.5,
  webglVendor: 0.5,
  iframeWorkerConsistency: 0.5,
  mouseEntropy: 0.5,
  mouseKinematics: 0.5,
  clickTeleport: 0.5,
  typingCadence: 0.5,
  keyboardDynamics: 0.5,
  httpHeaders: 0.5,
  // --- moderate / weak heuristics ---
  shiftKeyConsistency: 0.5, // demoted from decisive: CapsLock/AltGr/layout FPs (see detector)
  exactCenterClick: 0.5, // needs repeated dead-center hits to fire (see detector)
  scrollDynamics: 0.4,
  canvasRender: 0.4,
  pointerCapabilities: 0.4,
  reactionLatency: 0.4,
  superhumanSubmit: 0.4,
  mainWorldExecution: 0.4, // trap; evadable, kept low pending real-runner validation
  pasteVsType: 0.2, // pasting a password is legit human behavior
  tlsClient: 0.1, // weak without Bot Management
  // --- informational only (never contribute to the score) ---
  suspiciousClientSideBehavior: 0, // duplicate meta-detector — superseded by grouped signals
  fingerprint: 0,
  webgl2Params: 0,
  domRect: 0,
  localeTimezone: 0,
  screenAnomalies: 0,
  fonts: 0,
  audioFingerprint: 0,
  speechVoices: 0,
  webrtcLeak: 0,
  batteryApi: 0,
};

export interface AggregateResult {
  botScore: number;
  verdict: Verdict;
  /** how many results actually contributed (rating measured & weight > 0) */
  contributing: number;
}

/**
 * Aggregate scoring shared by client + server.
 *
 * Rules:
 *  1. `inconclusive` results and unknown / zero-weight detectors never contribute.
 *  2. Correlated detectors (EVIDENCE_GROUPS) are collapsed to their strongest
 *     single signal (max), so one physical fact isn't counted many times.
 *  3. Independent groups combine as weighted noisy-OR:
 *        botScore = 100 · (1 − ∏(1 − pg)),  pg = max over the group.
 *  4. A hard-rule `fail` (HARD_RULES) floors the score at 95 — decisive.
 *  5. If nothing could be measured, verdict is "incomplete" (not a green pass).
 */
export function aggregate(results: TestResult[]): AggregateResult {
  const groups = new Map<string, number>(); // group key → strongest p in that group
  let hardFail = false;
  let contributing = 0;

  for (const r of results) {
    if (r.rating === "inconclusive") continue;
    const weight = DETECTOR_WEIGHTS[r.test] ?? 0; // unknown detector → 0 (ignored)
    if (weight <= 0) continue;
    const score = Math.min(100, Math.max(0, r.score));
    if (score <= 0 && r.rating === "pass") {
      // a measured "human" result still counts as evidence-of-presence but adds 0 p
    }
    contributing++;
    if (HARD_RULES.has(r.test) && r.rating === "fail" && score >= 60) hardFail = true;
    const p = (score / 100) * weight;
    const key = EVIDENCE_GROUPS[r.test] ?? r.test; // ungrouped → its own singleton group
    const prev = groups.get(key) ?? 0;
    if (p > prev) groups.set(key, p);
  }

  if (contributing === 0) return { botScore: 0, verdict: "incomplete", contributing: 0 };

  let survive = 1;
  for (const p of groups.values()) survive *= 1 - p;
  let botScore = Math.round(100 * (1 - survive));
  if (hardFail) botScore = Math.max(botScore, 95);

  const verdict: Verdict = botScore >= 50 ? "fail" : botScore >= 25 ? "warn" : "pass";
  return { botScore, verdict, contributing };
}
