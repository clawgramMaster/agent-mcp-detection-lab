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
 * Aggregate scoring shared by client + server — probabilistic OR (noisy-OR).
 *
 * Each detector's score is read as an independent "probability this is a bot"
 * (score/100). We combine them as the chance that AT LEAST ONE is right:
 *
 *   botScore = 100 * (1 - ∏(1 - scoreᵢ/100))
 *
 * Properties:
 *  - a single definitive tell (e.g. shiftKeyConsistency = 100) → 100 (dominates);
 *  - multiple imperfect tells ACCUMULATE (e.g. 40 + 45 → 67, three 40s → 78) —
 *    so "several things wrong" genuinely raises the score;
 *  - it saturates toward 100 and can never exceed it (no 120);
 *  - always-pass detectors (score 0) contribute nothing.
 */
export function aggregate(results: TestResult[]): { botScore: number; verdict: Rating } {
  if (results.length === 0) return { botScore: 0, verdict: "pass" };
  let survive = 1; // ∏ (1 - pᵢ) = probability every detector is "human"
  for (const r of results) {
    const p = Math.min(100, Math.max(0, r.score)) / 100;
    survive *= 1 - p;
  }
  const botScore = Math.round(100 * (1 - survive));
  const verdict: Rating = botScore >= 50 ? "fail" : botScore >= 25 ? "warn" : "pass";
  return { botScore, verdict };
}
