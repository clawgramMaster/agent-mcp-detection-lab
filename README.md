# AgentMcpLab

Self-hosted lab that detects browser-automation agents (agent-browser, patchright,
Playwright, Puppeteer, Selenium, headless Chrome) via **fingerprint**, **CDP**, and
**behavioral** signals — and compares runners side by side.

Detection principles are re-implemented from public research
(FPScanner, Rebrowser, CreepJS, FingerprintJS BotD, BeCAPTCHA-Mouse, CDP Input spec).
**No third-party service code is copied.**

## Stack

| Layer     | Choice                               |
|-----------|--------------------------------------|
| Frontend  | Vite + TypeScript (vanilla)          |
| Backend   | Hono on Cloudflare Pages Functions   |
| Storage   | Cloudflare D1 (SQLite)               |
| Realtime  | SSE (poll-based fan-out)             |
| Deploy    | Cloudflare Pages (`wrangler`)        |
| Bench     | Node MCP runner (`bench/`)           |

## Pages

- **`/static`** — page-load probes: `webdriver`, CDP `Runtime.enable` leak, injection
  stack artifacts, console timing, headless signals, WebGL software renderer,
  prototype tampering, iframe/worker consistency, permissions mismatch, fingerprint.
- **`/interaction`** — login form probes: `isTrusted`, `shiftKeyConsistency`
  (physically-impossible keystroke — the killer signal), `exactCenterClick`
  (pixel-perfect centroid), CDP synthetic mouse leak, mouse-trajectory entropy,
  click-teleport, keystroke cadence & dwell, paste/value-injection, superhuman submit.

See **[`docs/behavioral-detection.md`](docs/behavioral-detection.md)** for the
physical-constraint behavioral tells (exact-center click, mouse teleport, sparse
trajectory, metronome typing, shifted-char-without-Shift) — discovered by breaking
deviceandbrowserinfo.com with agent-browser, with evasion notes and measurements.
- **`/report`** — per-test pass/warn/fail, raw JSON, `agent-browser` vs `patchright` diff,
  live SSE feed.

## Unified result schema

```json
{ "test": "cdpMouseLeak", "rating": "pass", "score": 0, "evidence": {}, "timestamp": 0 }
```

Sessions wrap results with `runner`, `botScore` (0–100), `verdict`, and Cloudflare
`request.cf` network fingerprint.

## Develop

```bash
npm install

# 1) create D1 + apply schema (once)
npx wrangler d1 create agentmcplab          # paste database_id into wrangler.toml
npm run db:init                             # local D1

# 2) run functions + static together (Pages dev on :8788)
npm run build && npm run preview            # http://127.0.0.1:8788

# OR fast frontend iteration (Vite :5173, proxies /api -> :8788)
npm run dev
```

## Deploy (Cloudflare Pages)

```bash
npx wrangler login
npx wrangler d1 create agentmcplab          # once; set database_id in wrangler.toml
npm run db:init:remote
npm run deploy
```

Connect the repo in the Cloudflare dashboard for git-push auto-deploys
(build command `npm run build`, output `client/dist`, functions auto-detected).

## Bench (runner comparison)

```bash
LAB_URL=http://127.0.0.1:8788 npm run bench
```

`bench/runner.ts` ships a `NullDriver` baseline that exercises the compare pipeline.
Swap in real `agent-browser` / `patchright` MCP drivers where marked `TODO` to have
them navigate the live pages under `?runner=<name>`; the client detectors POST results
automatically and `/report` shows the diff.

## Notes

- All bot-detection logic runs **client-side** (it must observe the automated browser's
  own globals/events), so hosting choice doesn't affect detection accuracy.
- `request.cf` gives TLS/HTTP2 network hints for free; **JA3/JA4** needs Cloudflare
  Bot Management (paid) and is surfaced when available.
