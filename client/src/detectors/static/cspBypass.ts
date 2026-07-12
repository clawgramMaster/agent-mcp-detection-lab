import { type Detector, result } from "../../lib/detector";

/**
 * CSP bypass (Rebrowser bypassCsp).
 * Puppeteer/Playwright often call page.setBypassCSP(true), which disables
 * Content-Security-Policy enforcement for the whole page (and its subframes)
 * via CDP. We probe it with an isolated iframe whose own CSP is
 * `script-src 'none'`: a normal browser BLOCKS the inline script, so no message
 * arrives; if CSP is bypassed the inline script runs and postMessages us.
 *
 * Isolated in a srcdoc iframe so it can't affect the main app.
 */
export const cspBypass: Detector = {
  test: "cspBypass",
  label: "CSP bypass (setBypassCSP)",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      let bypassed = false;
      const token = `csp-${Math.random().toString(36).slice(2)}`;
      const onMsg = (e: MessageEvent) => {
        if (e.data === token) bypassed = true;
      };
      window.addEventListener("message", onMsg);

      let iframe: HTMLIFrameElement | null = null;
      const finish = () => {
        window.removeEventListener("message", onMsg);
        try {
          iframe?.remove();
        } catch {
          /* */
        }
        resolve(
          bypassed
            ? result("cspBypass", "fail", 85, { bypassed: true, method: "iframe script-src none" }, undefined, "static")
            : result("cspBypass", "pass", 0, { bypassed: false }, undefined, "static"),
        );
      };

      try {
        iframe = document.createElement("iframe");
        iframe.style.display = "none";
        // Inline script should be blocked by the iframe's own CSP on a real browser.
        iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><script>parent.postMessage(${JSON.stringify(token)},'*')<\/script>`;
        document.body.appendChild(iframe);
        // Give the inline script a chance to run if CSP is bypassed.
        setTimeout(finish, 250);
      } catch (e) {
        window.removeEventListener("message", onMsg);
        resolve(result("cspBypass", "warn", 10, { error: String(e) }, undefined, "static"));
      }
    }),
};
