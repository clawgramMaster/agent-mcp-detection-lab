/**
 * AgentMcpLab — MCP bench runner (skeleton).
 *
 * Goal: drive the live lab site with two automation backends
 *   - agent-browser  (MCP)
 *   - patchright     (MCP, patched Playwright)
 * visit /static and /interaction, let the client-side detectors run and POST
 * their results (tagged with ?runner=<name>), then fetch /api/compare and print
 * a diff so you can see which detectors caught which backend.
 *
 * The actual MCP client wiring depends on how you expose agent-browser /
 * mcp-patchright locally. This file defines the contract + a driver interface
 * and a working "human/plain-fetch" baseline runner so the pipeline is testable
 * end-to-end today. Swap in real MCP drivers where marked TODO.
 */

const BASE = process.env.LAB_URL ?? "http://127.0.0.1:8788";

interface Driver {
  name: string;
  /** open a URL, wait for the page's detectors to POST results, then close */
  visit(url: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Baseline driver: not a browser — just proves the compare endpoint works by
 * POSTing an empty static result set. Real drivers below replace this.
 */
class NullDriver implements Driver {
  constructor(public name: string) {}
  async visit(url: string) {
    // A real browser driver would navigate and let client JS POST results.
    // Here we synthesize a minimal "no-signals" submission for plumbing tests.
    const page = url.includes("interaction") ? "interaction" : "static";
    await fetch(`${BASE}/api/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runner: this.name,
        page,
        results: [
          {
            test: "webdriver",
            rating: "pass",
            score: 0,
            evidence: { note: "null-driver baseline" },
            timestamp: Date.now(),
          },
        ],
      }),
    });
  }
  async close() {}
}

/**
 * TODO: implement using your MCP client.
 *
 * class AgentBrowserDriver implements Driver {
 *   name = "agent-browser";
 *   async visit(url) {
 *     await mcp.call("browser_navigate", { url: `${url}?runner=agent-browser` });
 *     // wait for the page to finish + POST (poll /api/sessions or fixed delay)
 *     await sleep(4000);
 *   }
 *   async close() { await mcp.call("browser_close", {}); }
 * }
 *
 * class PatchrightDriver implements Driver { name = "patchright"; ... }
 */

async function runSuite(driver: Driver) {
  console.log(`\n▶ ${driver.name}`);
  for (const path of ["/static", "/interaction"]) {
    const url = `${BASE}${path}?runner=${encodeURIComponent(driver.name)}`;
    console.log(`  visiting ${path} …`);
    await driver.visit(url);
  }
  await driver.close();
}

async function compare(a: string, b: string, page = "static") {
  const res = await fetch(`${BASE}/api/compare?a=${a}&b=${b}&page=${page}`);
  const data = (await res.json()) as any;
  console.log(`\n=== diff (${page}): ${a} vs ${b} ===`);
  console.log(`${a}: botScore ${data.a?.botScore ?? "—"}  |  ${b}: botScore ${data.b?.botScore ?? "—"}`);
  for (const [test, d] of Object.entries<any>(data.diff)) {
    const mark = d.changed ? "⚠︎ " : "  ";
    console.log(`${mark}${test.padEnd(26)} ${String(d.a ?? "—").padEnd(6)} ${String(d.b ?? "—")}`);
  }
}

async function main() {
  const drivers: Driver[] = [
    new NullDriver("agent-browser"),
    new NullDriver("patchright"),
    // Replace NullDriver with AgentBrowserDriver / PatchrightDriver when wired.
  ];
  for (const d of drivers) await runSuite(d);
  await compare("agent-browser", "patchright", "static");
  await compare("agent-browser", "patchright", "interaction");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
