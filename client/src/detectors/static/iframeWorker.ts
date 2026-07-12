import { type Detector, result } from "../../lib/detector";

/**
 * iframe / worker consistency — stealth patches applied to the main window
 * often DON'T propagate into a fresh same-origin iframe or a Worker, so the
 * values disagree (FPScanner / CreepJS).
 */
export const iframeWorkerConsistency: Detector = {
  test: "iframeWorkerConsistency",
  label: "iframe / worker value consistency",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      const ev: Record<string, unknown> = {};
      let score = 0;

      // 1) iframe navigator.webdriver / userAgent vs main window
      try {
        const f = document.createElement("iframe");
        f.style.display = "none";
        f.srcdoc = "<!doctype html><title>x</title>";
        document.body.appendChild(f);
        const iwin = f.contentWindow as any;
        if (iwin) {
          const iwd = iwin.navigator.webdriver;
          const mwd = (navigator as any).webdriver;
          if (iwd !== mwd) {
            ev.webdriverMismatch = { main: mwd, iframe: iwd };
            score += 60;
          }
          if (iwin.navigator.userAgent !== navigator.userAgent) {
            ev.uaMismatch = true;
            score += 40;
          }
          if (iwin.navigator.hardwareConcurrency !== navigator.hardwareConcurrency) {
            ev.coresMismatch = true;
            score += 20;
          }
        }
        f.remove();
      } catch (e) {
        ev.iframeError = String(e);
      }

      // 2) Worker userAgent consistency
      try {
        const code = "self.onmessage=()=>postMessage({ua:navigator.userAgent,hc:navigator.hardwareConcurrency})";
        const blob = new Blob([code], { type: "application/javascript" });
        const w = new Worker(URL.createObjectURL(blob));
        const timer = setTimeout(() => finish(), 300);
        w.onmessage = (m) => {
          clearTimeout(timer);
          if (m.data.ua !== navigator.userAgent) {
            ev.workerUaMismatch = true;
            score += 40;
          }
          if (m.data.hc !== navigator.hardwareConcurrency) {
            ev.workerCoresMismatch = true;
            score += 15;
          }
          finish();
        };
        w.postMessage("go");
        function finish() {
          w.terminate();
          score = Math.min(100, score);
          resolve(
            result(
              "iframeWorkerConsistency",
              score >= 60 ? "fail" : score >= 20 ? "warn" : "pass",
              score,
              ev,
              undefined,
              "static",
            ),
          );
        }
      } catch (e) {
        ev.workerError = String(e);
        score = Math.min(100, score);
        resolve(
          result(
            "iframeWorkerConsistency",
            score >= 60 ? "fail" : score >= 20 ? "warn" : "pass",
            score,
            ev,
            undefined,
            "static",
          ),
        );
      }
    }),
};
