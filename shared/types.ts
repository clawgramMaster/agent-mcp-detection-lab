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
 * Aggregate scoring shared by client + server.
 *
 * Design: bot detection is "any strong tell is enough" — a single definitive
 * signal (e.g. shiftKeyConsistency=100) must dominate, and it must NOT be
 * diluted by the many always-pass fingerprint/informational detectors. So the
 * score is the strongest single signal plus a small bump per *additional*
 * flagged signal (corroboration), rather than a mean.
 *
 *   botScore = min(100, maxScore + 6 * (flagged - 1))
 *   flagged  = detectors scoring >= 25
 *
 * This keeps the number and the verdict consistent (one hard fail -> ~100 and
 * "fail") while avoiding false "fail" from a couple of weak warns stacking.
 */
export function aggregate(results: TestResult[]): { botScore: number; verdict: Rating } {
  if (results.length === 0) return { botScore: 0, verdict: "pass" };
  const maxScore = results.reduce((m, r) => Math.max(m, r.score), 0);
  const flagged = results.filter((r) => r.score >= 25).length;
  const botScore = Math.min(100, Math.round(maxScore + 6 * Math.max(0, flagged - 1)));
  const verdict: Rating = botScore >= 50 ? "fail" : botScore >= 25 ? "warn" : "pass";
  return { botScore, verdict };
}
