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

/** Aggregate scoring helper shared by client + server. */
export function aggregate(results: TestResult[]): { botScore: number; verdict: Rating } {
  if (results.length === 0) return { botScore: 0, verdict: "pass" };
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const maxPer = 100;
  const botScore = Math.min(100, Math.round((totalScore / (results.length * maxPer)) * 100 * 3)); // weighted
  const hasFail = results.some((r) => r.rating === "fail");
  const hasWarn = results.some((r) => r.rating === "warn");
  const verdict: Rating = hasFail || botScore >= 50 ? "fail" : hasWarn || botScore >= 20 ? "warn" : "pass";
  return { botScore, verdict };
}
