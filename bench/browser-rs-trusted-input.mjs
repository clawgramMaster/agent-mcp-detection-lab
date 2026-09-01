import { spawn } from "node:child_process";

const bin = process.env.BROWSER_RS_BIN || "browser-rs";
const labUrl = new URL(process.env.LAB_URL || "http://127.0.0.1:4173/");
labUrl.hash = "lab";
if (!labUrl.searchParams.has("iframeOrigin")) {
  const alternate = new URL(labUrl.origin);
  alternate.hostname = labUrl.hostname === "127.0.0.1" ? "localhost" : labUrl.hostname;
  if (alternate.origin !== labUrl.origin) labUrl.searchParams.set("iframeOrigin", alternate.origin);
}

const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "";
let nextId = 0;
const waiters = new Map();

child.stdout.on("data", (data) => {
  buffer += data.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = waiters.get(message.id);
    if (resolve) {
      waiters.delete(message.id);
      resolve(message);
    }
  }
});

function send(method, params) {
  const id = ++nextId;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => waiters.set(id, resolve));
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function call(name, args) {
  const response = await send("tools/call", { name, arguments: args });
  if (response.error) throw new Error(response.error.message);
  if (response.result?.isError) throw new Error(response.result.content?.[0]?.text || `${name} failed`);
  return response.result?.content?.[0]?.text || "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "trusted-input-lab", version: "0" },
  });
  notify("notifications/initialized", {});

  const listed = await send("tools/list", {});
  const tools = listed.result?.tools || [];
  const names = tools.map((tool) => tool.name);
  assert(!names.includes("browser_iframe_fill"), "browser_iframe_fill must be removed");
  assert(!names.includes("browser_console_messages"), "strict mode must hide console capture");
  const pointer = tools.find((tool) => tool.name === "browser_pointer");
  assert(
    !pointer?.inputSchema?.properties?.input_route,
    "browser_pointer must not expose the synthetic input_route option",
  );

  await call("browser_navigate", { url: labUrl.toString() });
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const snapshot = await call("browser_snapshot", { page: "p1" });
  const digits = snapshot.match(/Enter (010\d{8})/)?.[1];
  assert(digits, "nested iframe challenge digits were not visible");

  const frameSelector = "#applicationIframe >> #finCertSdkIframe >> #finCertSdkInnerIframe";
  await call("browser_iframe_type", {
    page: "p1",
    frame_selector: frameSelector,
    selector: "#phone",
    text: digits,
    clear: true,
  });
  await call("browser_iframe_click", {
    page: "p1",
    frame_selector: frameSelector,
    selector: "#blurCheck",
  });
  await call("browser_select_option", {
    page: "p1",
    selector: "#trustedSelect",
    value: "wire",
  });
  const longText = "humanized long text crosses thirty characters";
  await call("browser_evaluate", {
    page: "p1",
    expression:
      "(()=>{const e=document.querySelector('input[name=username]');e.dataset.longKeydowns='0';e.dataset.longKeyups='0';e.dataset.longInputs='0';e.dataset.longUntrusted='0';e.addEventListener('keydown',x=>{e.dataset.longKeydowns=String(Number(e.dataset.longKeydowns)+1);if(!x.isTrusted)e.dataset.longUntrusted=String(Number(e.dataset.longUntrusted)+1)});e.addEventListener('keyup',x=>{e.dataset.longKeyups=String(Number(e.dataset.longKeyups)+1);if(!x.isTrusted)e.dataset.longUntrusted=String(Number(e.dataset.longUntrusted)+1)});e.addEventListener('input',x=>{e.dataset.longInputs=String(Number(e.dataset.longInputs)+1);if(!x.isTrusted)e.dataset.longUntrusted=String(Number(e.dataset.longUntrusted)+1)});return true})()",
  });
  await call("browser_type", {
    page: "p1",
    selector: "input[name=username]",
    text: longText,
    clear: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));

  const raw = await call("browser_evaluate", {
    page: "p1",
    expression:
      "(()=>{const t=document.querySelector('input[name=username]');return{iframe:document.querySelector('.iframe-task-status')?.textContent,select:document.querySelector('#nativeSelectStatus')?.textContent,value:document.querySelector('#trustedSelect')?.value,longValue:t?.value,longKeydowns:Number(t?.dataset.longKeydowns||0),longKeyups:Number(t?.dataset.longKeyups||0),longInputs:Number(t?.dataset.longInputs||0),longUntrusted:Number(t?.dataset.longUntrusted||0)}})()",
  });
  const state = JSON.parse(raw);
  assert(/trusted clicks=1/.test(state.iframe || ""), `iframe click was not trusted: ${state.iframe}`);
  assert(
    /input trusted=true/.test(state.select || "") && /change trusted=true/.test(state.select || ""),
    `native select events were not trusted: ${state.select}`,
  );
  assert(state.value === "wire", `native select chose ${JSON.stringify(state.value)}`);
  assert(state.longValue === longText, "long text value did not match");
  assert(state.longKeydowns === 0 && state.longKeyups === 0, "long text should use paste-like atomic insertion");
  assert(state.longInputs > 0, "long text emitted no browser input event");
  assert(state.longUntrusted === 0, `long text emitted ${state.longUntrusted} untrusted key events`);

  console.log(`PASS trusted iframe click: ${state.iframe}`);
  console.log(`PASS trusted native select: ${state.select}`);
  console.log(`PASS trusted paste-like long text: ${state.longInputs} input event(s), no keydown/up loop`);
} finally {
  child.kill();
}
