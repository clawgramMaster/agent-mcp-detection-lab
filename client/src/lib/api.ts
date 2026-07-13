import type { Session, SubmitBody, TestResult } from "../../../shared/types";

/** Server-side header/TLS inspection (signals the browser JS can't see). */
export async function fetchInspect(): Promise<TestResult[]> {
  try {
    const res = await fetch("/api/inspect", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return (await res.json()) as TestResult[];
  } catch {
    return [];
  }
}

const RUNNER_RE = /^[a-z0-9_-]{1,32}$/;

/**
 * The runner label lets the bench harness tag its submissions (?runner=patchright).
 * It is derived ONLY from the current URL — never persisted. Persisting it (the
 * previous localStorage behavior) leaked a bench label into the next real human
 * visit and permanently poisoned the dataset.
 */
export function currentRunner(): string {
  const q = new URL(location.href).searchParams.get("runner");
  const s = (q ?? "").toLowerCase().trim();
  return RUNNER_RE.test(s) ? s : "human";
}

export async function submitResults(page: "static" | "interaction", results: TestResult[]) {
  const body: SubmitBody = { runner: currentRunner(), page, results };
  const res = await fetch("/api/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`submit failed: ${res.status}`);
  return res.json() as Promise<{ sessionId: string; botScore: number; verdict: string; network: unknown }>;
}

export async function fetchSessions(params: { runner?: string; page?: string; limit?: number } = {}) {
  const u = new URL("/api/sessions", location.origin);
  if (params.runner) u.searchParams.set("runner", params.runner);
  if (params.page) u.searchParams.set("page", params.page);
  if (params.limit) u.searchParams.set("limit", String(params.limit));
  const res = await fetch(u);
  return res.json() as Promise<Session[]>;
}

export async function fetchCompare(a: string, b: string, page = "static") {
  const u = new URL("/api/compare", location.origin);
  u.searchParams.set("a", a);
  u.searchParams.set("b", b);
  u.searchParams.set("page", page);
  const res = await fetch(u);
  return res.json() as Promise<{
    a: Session | null;
    b: Session | null;
    diff: Record<string, { a?: string; b?: string; changed: boolean }>;
    page: string;
  }>;
}
