# Behavioral Bot Detection — Physical-Constraint Signals

> **Top insight:** The frontier of bot detection is **not** the fingerprint
> (`navigator.*`, CDP, headless tells) — it is **behavioral**, and those tells are
> surprisingly **physical**. You can defeat every high-tech CDP/WebDriver/Playwright
> fingerprint check and still get flagged the moment your automation violates a
> constraint of the human hand: *you cannot click a pixel-perfect center, your mouse
> cannot teleport, and you cannot type `@` without holding Shift.*

These findings were obtained empirically by driving **agent-browser** (our Rust MCP
browser) against **deviceandbrowserinfo.com**'s behavioral test
(`/are_you_a_bot_interactions`), hooking `fetch`/`XHR` to capture the interaction
payload POSTed to `/fingerprint_bot_test` and the returned verdict JSON, then
measuring exactly which features flip `isBot`. Source: **github.com/maestrojeong/agent-browser-mcp** (commit `2ec4e25`).

The static surface (CDP, WebDriver, Playwright globals, headless fingerprint) was
already fully passed via be-a-real-browser + isolated-world `evaluate` + no
`Runtime.enable`. Everything below is what remained — and what catches Playwright /
Puppeteer / patchright too, because CDP input synthesis has no physicality.

---

## 1. Exact-center click

`hasClickedEmailFieldExactCenter` · `…PasswordFieldExactCenter` · `…SubmitExactCenter`

- **Principle:** a naive bot computes an element's pixel centroid (`left+w/2, top+h/2`)
  and clicks it. A human *never* hits the exact center.
- **Where the bot slips:** clicking the geometric center of every target.
- **Evasion:** click an **off-center** point inside the element's content box — an
  offset of **12–40 % of the half-dimension**, with a random sign, per axis.
- **Measured:** all three exact-center flags `true` → after fix, all `false`.

## 2. Mouse teleport (pointer continuity)

- **Principle:** if each click generates a fresh start coordinate, the pointer
  "teleports" from the previous click position to the next. A real mouse position is
  **continuous** — the next move starts where the last one ended.
- **Where the bot slips:** per-click independent coordinates → position jumps.
- **Evasion:** track the **last pointer position as state**; begin each move from that
  exact point (only the very first move may originate from a natural rest position).
- **Measured:** `click1` end `[111,110]` equalled `click2` start `[111,110]` (jump 0)
  only after the fix; before, discrete jumps between clicks.

## 3. Sparse / uniform mouse trajectory

- **Principle:** moving 100 px in 7 big jumps (13–19 px deltas) is robotic. A human
  mouse samples at **60–120 Hz** producing dozens of **small deltas (1–4 px)**, with
  curvature and acceleration/deceleration.
- **Where the bot slips:** few, evenly-sized, straight-line steps.
- **Evasion:** move along a **cubic Bézier** path with **distance-proportional dense
  steps** (~1 step / 3.5 px, 16–160 steps), **ease-in-out** velocity, and per-step
  jitter.
- **Measured:** 7 steps / 16 px peak delta → 158 steps / 11 px peak delta.

## 4. Metronome typing (inter-key timing std-dev)

- **Principle:** if the standard deviation of inter-key intervals is too low
  (e.g. 33 ms), it is a machine. Humans type in **bursts and pauses** → high variance
  (100 ms+).
- **Where the bot slips:** constant delay between keystrokes.
- **Evasion:** make inter-key intervals **bimodal** — fast bursts (~12 %), long
  "thinking" pauses (~18 %), the rest normal; also randomize key **hold** time.
- **Measured:** std-dev 33 ms → 107 ms (mean ~225 ms).

## 5. ⚠️ KILLER — physically impossible keystroke: shifted char without modifier

`typeAtCharacter` · `typeAtWithModifier`

- **Principle:** the page listens for keydown. When it sees `@` it sets
  `typeAtCharacter = true`; it then checks `event.shiftKey`. On a US keyboard `@` is
  **Shift+2** — producing `@` **without** Shift held is *impossible for a human hand*,
  so it is a definitive bot signal.
- **Source evidence (`device_info.min.js`):**
  `"@" === e.key && (u.typeAtCharacter = !0, e.shiftKey ? … : …)`
- **Where the bot slips:** synthesizing the character event directly, never asserting
  the Shift modifier.
- **Evasion:** for any character that requires Shift — uppercase `A–Z` and the symbols
  `` ~!@#$%^&*()_+{}|:"<>? `` — emit a real **Shift keyDown**, set `modifiers = 8`
  (Shift) on the character event, then a **Shift keyUp**.
- **Measured:** `typeAtWithModifier` `false` → `true`. **This single fix flipped the
  final `isBot` from `true` to `false`.**

---

## Result

Applying all five: on the deviceandbrowserinfo behavioral test, `isBot = false` and
`suspiciousClientSideBehavior = false` (reproduced). Static CDP/WebDriver/Playwright/
headless fingerprints were already passing. Playwright, Puppeteer and patchright
generally still fail on signals **1–5** because CDP-synthesized input carries none of
the physicality of a human hand.

## How AgentMcpLab tests these

| Signal | Detector in this lab |
|---|---|
| 1. Exact-center click | `exactCenterClick` |
| 2. Mouse teleport | `clickTeleport` (approach-movement) + `mouseEntropy` |
| 3. Sparse/uniform trajectory | `mouseEntropy` (speed std, curviness) |
| 4. Metronome typing | `typingCadence` (cv) + `keyboardDynamics` (dwell) |
| 5. Shifted char w/o modifier | `shiftKeyConsistency` |

Signals 1 and 5 are the highest-value additions: they are cheap, deterministic, and —
unlike statistical trajectory checks — have **no false-positive gray zone**, because
they encode a hard physical impossibility.
