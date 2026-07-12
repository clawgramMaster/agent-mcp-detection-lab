// AgentMcpLab — shared types (client + Cloudflare Functions)

export type Rating = "pass" | "warn" | "fail";

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
  verdict: Rating;
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
export const DETECTOR_WEIGHTS: Record<string, number> = {
  // decisive — a hard tell, full weight
  webdriver: 1,
  automationGlobals: 1,
  cdpRuntimeLeak: 1,
  cdpStackTrace: 1,
  isTrusted: 1,
  shiftKeyConsistency: 1,
  cdpMouseLeak: 1,
  exactCenterClick: 1,
  cspBypass: 0.9, // Rebrowser setBypassCSP — hard tell
  nativeToString: 0.9, // patched native fn = stealth automation, very hard tell
  exposeFunctionLeak: 0.9, // Puppeteer/Playwright binding on window — hard tell
  mainWorldExecution: 0.7, // Rebrowser main-world DOM-access trap (evadable)
  electronDetection: 0.9, // Node/Electron surface on a web page — hard tell
  // strong — behavioral / structural signals
  suspiciousClientSideBehavior: 0.5,
  mouseEntropy: 0.5,
  mouseKinematics: 0.5,
  scrollDynamics: 0.4,
  typingCadence: 0.5,
  keyboardDynamics: 0.5,
  pasteVsType: 0.2, // pasting a password is legit human behavior — weak signal only
  clickTeleport: 0.5,
  headlessSignals: 0.5,
  iframeWorkerConsistency: 0.5,
  superhumanSubmit: 0.5,
  clientHints: 0.5,
  engineCoherence: 0.5,
  permissionsMismatch: 0.5,
  webglVendor: 0.5,
  canvasRender: 0.4,
  domRect: 0.2,
  mediaCodecs: 0.5,
  pointerCapabilities: 0.4,
  localeTimezone: 0.3,
  httpHeaders: 0.5, // server-side header consistency
  tlsClient: 0.1, // server-side TLS fingerprint (weak without Bot Management)
  // weak / noisy — suggestive only, tiny penalty even when wrong
  screenAnomalies: 0.1,
  fonts: 0.1,
  audioFingerprint: 0.1,
  speechVoices: 0.1,
  webrtcLeak: 0.1,
  batteryApi: 0.1,
  // informational (never contributes)
  fingerprint: 0,
  webgl2Params: 0, // now emits only a params hash (verdict owned by webglVendor)
};

/**
 * Aggregate scoring shared by client + server — weighted probabilistic OR.
 *
 * Each detector contributes p = (score/100) * weight, read as an independent
 * "probability this is a bot". We combine them as the chance AT LEAST ONE is
 * right:  botScore = 100 * (1 - ∏(1 - pᵢ))
 *
 *  - a definitive tell at full weight (e.g. shiftKeyConsistency=100) → 100;
 *  - imperfect tells accumulate (weighted), so several mistakes still add up;
 *  - noisy tells are down-weighted, so one wrong speechVoices barely moves it;
 *  - saturates toward 100, never exceeds it.
 */
export function aggregate(results: TestResult[]): { botScore: number; verdict: Rating } {
  if (results.length === 0) return { botScore: 0, verdict: "pass" };
  let survive = 1; // ∏ (1 - pᵢ) = probability every detector says "human"
  for (const r of results) {
    const weight = DETECTOR_WEIGHTS[r.test] ?? 0.6; // unknown detector → moderate
    const p = (Math.min(100, Math.max(0, r.score)) / 100) * weight;
    survive *= 1 - p;
  }
  const botScore = Math.round(100 * (1 - survive));
  const verdict: Rating = botScore >= 50 ? "fail" : botScore >= 25 ? "warn" : "pass";
  return { botScore, verdict };
}
