import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { type NetworkFingerprint, type Session, type SubmitBody, aggregate } from "../../shared/types";

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "agentmcplab", ts: Date.now() }));

/** Extract Cloudflare-provided network fingerprint from request.cf */
function readNetwork(req: Request): NetworkFingerprint {
  const cf = (req as any).cf ?? {};
  const bm = cf.botManagement ?? {};
  return {
    tlsVersion: cf.tlsVersion,
    tlsCipher: cf.tlsCipher,
    httpProtocol: cf.httpProtocol,
    clientTcpRtt: cf.clientTcpRtt,
    tlsClientHelloLength: cf.tlsClientHelloLength ? Number(cf.tlsClientHelloLength) : undefined,
    ja3Hash: bm.ja3Hash, // requires Bot Management (paid)
    country: cf.country,
    asOrganization: cf.asOrganization,
  };
}

/** POST /api/results — store a completed session */
app.post("/results", async (c) => {
  const body = await c.req.json<SubmitBody>();
  if (!body?.results || !Array.isArray(body.results)) {
    return c.json({ error: "results[] required" }, 400);
  }
  const { botScore, verdict } = aggregate(body.results);
  const sessionId = crypto.randomUUID();
  const network = readNetwork(c.req.raw);
  const session: Session = {
    sessionId,
    runner: body.runner || "unknown",
    userAgent: c.req.header("user-agent") || "",
    page: body.page,
    results: body.results,
    botScore,
    verdict,
    network,
    createdAt: Date.now(),
  };

  await c.env.DB.prepare(
    `INSERT INTO sessions (session_id, runner, page, user_agent, bot_score, verdict, network, results, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      session.sessionId,
      session.runner,
      session.page,
      session.userAgent,
      session.botScore,
      session.verdict,
      JSON.stringify(session.network),
      JSON.stringify(session.results),
      session.createdAt,
    )
    .run();

  return c.json({ sessionId, botScore, verdict, network });
});

function rowToSession(row: any): Session {
  return {
    sessionId: row.session_id,
    runner: row.runner,
    page: row.page,
    userAgent: row.user_agent,
    botScore: row.bot_score,
    verdict: row.verdict,
    network: row.network ? JSON.parse(row.network) : undefined,
    results: JSON.parse(row.results),
    createdAt: row.created_at,
  };
}

/** GET /api/sessions?runner=&page=&limit= */
app.get("/sessions", async (c) => {
  const runner = c.req.query("runner");
  const page = c.req.query("page");
  const limit = Math.min(200, Number(c.req.query("limit") || 50));
  let sql = "SELECT * FROM sessions";
  const where: string[] = [];
  const args: unknown[] = [];
  if (runner) {
    where.push("runner = ?");
    args.push(runner);
  }
  if (page) {
    where.push("page = ?");
    args.push(page);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);
  const { results } = await c.env.DB.prepare(sql)
    .bind(...args)
    .all();
  return c.json((results as any[]).map(rowToSession));
});

/** GET /api/sessions/:id */
app.get("/sessions/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM sessions WHERE session_id = ?").bind(c.req.param("id")).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(rowToSession(row));
});

/** GET /api/compare?a=agent-browser&b=patchright — latest session per runner + diff */
app.get("/compare", async (c) => {
  const a = c.req.query("a") || "agent-browser";
  const b = c.req.query("b") || "patchright";
  const pageFilter = c.req.query("page") || "static";

  async function latest(runner: string) {
    const row = await c.env.DB.prepare(
      "SELECT * FROM sessions WHERE runner = ? AND page = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(runner, pageFilter)
      .first();
    return row ? rowToSession(row) : null;
  }
  const [sa, sb] = await Promise.all([latest(a), latest(b)]);

  const diff: Record<string, { a?: string; b?: string; changed: boolean }> = {};
  const tests = new Set<string>();
  sa?.results.forEach((r) => tests.add(r.test));
  sb?.results.forEach((r) => tests.add(r.test));
  for (const t of tests) {
    const ra = sa?.results.find((r) => r.test === t)?.rating;
    const rb = sb?.results.find((r) => r.test === t)?.rating;
    diff[t] = { a: ra, b: rb, changed: ra !== rb };
  }
  return c.json({ a: sa, b: sb, diff, page: pageFilter });
});

/**
 * GET /api/stream?page= — SSE feed of newly stored sessions (poll-based fan-out).
 * D1 has no pub/sub; we poll every 2s and push deltas. Good enough for the lab.
 */
app.get("/stream", (c) => {
  const page = c.req.query("page");
  return streamSSE(c, async (stream) => {
    let since = Date.now();
    let alive = true;
    stream.onAbort(() => {
      alive = false;
    });
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ since }) });
    while (alive) {
      const args: unknown[] = [since];
      let sql = "SELECT * FROM sessions WHERE created_at > ?";
      if (page) {
        sql += " AND page = ?";
        args.push(page);
      }
      sql += " ORDER BY created_at ASC LIMIT 20";
      const { results } = await c.env.DB.prepare(sql)
        .bind(...args)
        .all();
      for (const row of results as any[]) {
        const s = rowToSession(row);
        since = Math.max(since, s.createdAt);
        await stream.writeSSE({ event: "session", data: JSON.stringify(s) });
      }
      await stream.sleep(2000);
    }
  });
});

export const onRequest = handle(app);
