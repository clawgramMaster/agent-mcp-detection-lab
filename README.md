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

## The app (single page + report)

One page, two independent scores, plus a report view (hash-routed):

- **`#lab`** — the detector page.
  - **Passive score** — runs the moment you land: `webdriver`, CDP `Runtime.enable`
    leak, injection stack artifacts, native-fn integrity, exposeFunction bindings,
    Electron/Node surface, headless signals, UA↔engine coherence, permissions,
    WebGL software renderer, iframe/worker consistency, media codecs, server-side
    HTTP-header & TLS checks. A **temporal CDP monitor** keeps watching, so a runner
    that enables CDP *after* load (calling evaluate/console/snapshot) flips the score
    live. Informational fingerprint surfaces (canvas, audio, fonts, battery, …) are
    shown but do not affect the verdict.
  - **Behavioral score** — an *active challenge* the agent must perform, judged on
    HOW it acts: a **grid** (ordered tile clicks → motion between targets), a
    **slider** drag (kinematics), a **"click when it turns green"** button
    (reaction to a visual change), free typing (`isTrusted`, keystroke dwell/cadence,
    `shiftKeyConsistency`), a three-level certificate iframe with a masked
    controlled phone input and trusted iframe click, a native select
    challenge, and hidden **honeypots** (controls invisible to a real human).
    Nothing done yet ⇒ verdict is **incomplete**, never a false "bot".
- **`#report`** — recent runs and the latest score per `runner`, read from
  `GET /api/sessions`. Drive the lab with `?runner=<name>` to record labelled runs.
  Add `?iframeOrigin=https://alternate-host` before `#lab` to load the
  challenge's innermost fixture from a second deployment hostname and exercise
  the OOPIF route.

See **[`docs/behavioral-detection.md`](docs/behavioral-detection.md)** for the
physical-constraint tells (exact-center click, mouse teleport, sparse trajectory,
metronome typing, shifted-char-without-Shift) with evasion notes and measurements.

### Iframe capability probe

The certificate task mirrors the browser-rs iframe fixes instead of testing only
whether an agent can find an `<iframe>`:

| browser-rs line | Capability exercised by the fixture |
|---|---|
| v0.1.17 | Enter a cross-origin frame without violating the Same-Origin Policy |
| v0.1.18 | Resolve a three-level nested frame chain by the selected iframe nodes |
| v0.1.19 | Route commands through the innermost OOPIF target session |
| v0.1.23 | Deliver trusted keyboard input that updates masked controlled state |
| v0.2.0 | Deliver a trusted pointer click across nested/OOPIF coordinates |

The frame chain is
`#applicationIframe >> #finCertSdkIframe >> #finCertSdkInnerIframe`.
`browser_iframe_type` enters the random digits shown for that run, then
`browser_iframe_click` must click `#blurCheck` with `isTrusted === true` to
retain the masked number and complete Step 4. The detector measures inner-frame
key dwell, input cadence, and click trust rather than accepting state changes
alone. Reports are accepted only from the expected innermost frame, origin, and
per-run nonce, so a top-page `postMessage` cannot spoof completion.

## Unified result schema

```json
{ "test": "cdpMouseLeak", "rating": "pass|warn|fail|inconclusive", "score": 0, "evidence": {}, "timestamp": 0 }
```

`inconclusive` means the signal couldn't be measured (no interaction, blocked API,
exception) and **never contributes to the score**. Sessions wrap results with a
sanitized `runner`, `botScore` (0–100), `verdict` (`pass|warn|fail|incomplete`), and
the Cloudflare `request.cf` network fingerprint.

## Scoring model (`shared/types.ts`)

`aggregate()` is a **weighted noisy-OR with dedup**:

1. `inconclusive` and unknown / zero-weight detectors are ignored.
2. Correlated detectors (`EVIDENCE_GROUPS`, e.g. all mouse-motion signals) collapse
   to their single strongest signal — one physical fact isn't counted five times.
3. Independent groups combine: `botScore = 100·(1 − ∏(1 − p_group))`.
4. A **hard rule** (`HARD_RULES`: webdriver, framework globals, honeypot, Node/Electron,
   binding leak, CSP bypass, live CDP leak) that fails floors the score at 95.

Regression-tested — see `npm test` (`tests/aggregate.test.ts`, `detectors.test.ts`,
`validate.test.ts`): keyboard-only humans, CapsLock/AltGr, single centroid click,
idle submit and oversized/unknown API payloads all behave correctly.

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

The targeted browser-rs v0.2 regression runner asserts that synthetic pointer
and iframe-fill surfaces are absent, then proves nested/OOPIF
`browser_iframe_click`, native `browser_select_option`, and paste-like
long-text `browser_type` input events are trusted.
Run it against a local lab with:

    BROWSER_RS_BIN=~/browser-rs-mcp/target/release/browser-rs LAB_URL=http://127.0.0.1:4173 npm run test:browser-rs-trusted

`bench/runner.ts` ships a `NullDriver` baseline that exercises the submit/compare
pipeline. Swap in real `agent-browser` / `patchright` MCP drivers where marked `TODO`
to have them navigate the live page under `?runner=<name>`; the client detectors POST
results automatically and the **`#report`** view (and `GET /api/compare`) shows the diff.

The server sanitizes `runner` and drops unknown/oversized results, and only accepts
same-origin submissions — so labelled bench runs and real visits stay clean.

## Notes

- All bot-detection logic runs **client-side** (it must observe the automated browser's
  own globals/events), so hosting choice doesn't affect detection accuracy.
- `request.cf` gives TLS/HTTP2 network hints for free; **JA3/JA4** needs Cloudflare
  Bot Management (paid) and is surfaced when available.
