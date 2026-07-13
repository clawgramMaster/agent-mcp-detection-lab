// Pure submission-validation helpers shared by the API route and its tests.
import { DETECTOR_WEIGHTS, type TestResult } from "./types";

export const KNOWN_TESTS: ReadonlySet<string> = new Set([...Object.keys(DETECTOR_WEIGHTS), "httpHeaders", "tlsClient"]);
const VALID_RATINGS = new Set(["pass", "warn", "fail", "inconclusive"]);
export const VALID_PAGES = new Set(["static", "interaction"]);
export const MAX_RESULTS = 80;
export const MAX_EVIDENCE_BYTES = 4096;
const RUNNER_RE = /^[a-z0-9_-]{1,32}$/;

export function sanitizeRunner(v: unknown): string {
  if (typeof v !== "string") return "human";
  const s = v.toLowerCase().trim();
  return RUNNER_RE.test(s) ? s : "human";
}

/** Validate + normalize a submitted result. Returns null for anything unknown or malformed. */
export function cleanResult(r: unknown): TestResult | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (typeof o.test !== "string" || !KNOWN_TESTS.has(o.test)) return null; // unknown test → dropped
  if (typeof o.rating !== "string" || !VALID_RATINGS.has(o.rating)) return null;
  const score = Number(o.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  let evidence: Record<string, unknown> = {};
  if (o.evidence && typeof o.evidence === "object") {
    const j = JSON.stringify(o.evidence);
    evidence = j.length <= MAX_EVIDENCE_BYTES ? (o.evidence as Record<string, unknown>) : { truncated: true };
  }
  const category =
    o.category === "static" || o.category === "interaction" || o.category === "network" ? o.category : undefined;
  return {
    test: o.test,
    label: typeof o.label === "string" ? o.label.slice(0, 80) : undefined,
    category,
    rating: o.rating as TestResult["rating"],
    score,
    evidence,
    timestamp: Date.now(),
  };
}
