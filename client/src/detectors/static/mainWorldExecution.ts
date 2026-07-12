import { type Detector, result } from "../../lib/detector";

/**
 * Main-world execution booby-trap (Rebrowser).
 *
 * Vanilla Puppeteer / Playwright evaluate their scripts and serialize the DOM in
 * the page's MAIN world (Rebrowser & patchright move this to an ISOLATED world to
 * hide). We plant a hidden element and trap reads of its `id` / `outerHTML` /
 * text — properties a human and normal page code never touch, but a main-world
 * automation reading or snapshotting the DOM will. If the trap fires within the
 * observation window, something is scanning the DOM from the main world.
 *
 * No false positives on humans: nothing in the page reads this element.
 */
export const mainWorldExecution: Detector = {
  test: "mainWorldExecution",
  label: "Main-world DOM access trap",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      let accessed: string | null = null;
      const token = `mwe-${Math.random().toString(36).slice(2)}`;
      const div = document.createElement("div");
      div.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;";

      const trap = (prop: string) => ({
        configurable: true,
        get() {
          if (!accessed) accessed = prop;
          return prop === "id" ? token : "";
        },
      });
      try {
        Object.defineProperty(div, "id", trap("id"));
        Object.defineProperty(div, "outerHTML", trap("outerHTML"));
        Object.defineProperty(div, "innerText", trap("innerText"));
        Object.defineProperty(div, "textContent", trap("textContent"));
      } catch {
        /* if traps can't be set, bail out clean */
      }
      document.body.appendChild(div);

      window.setTimeout(() => {
        try {
          div.remove();
        } catch {
          /* */
        }
        resolve(
          accessed
            ? result("mainWorldExecution", "fail", 75, { trapped: accessed }, undefined, "static")
            : result("mainWorldExecution", "pass", 0, { trapped: false }, undefined, "static"),
        );
      }, 800);
    }),
};
