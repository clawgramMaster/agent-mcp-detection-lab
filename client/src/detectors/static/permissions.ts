import { type Detector, result } from "../../lib/detector";

/**
 * Permissions inconsistency — a known headless tell (BotD):
 * Notification.permission === "denied" while permissions.query({name:'notifications'})
 * reports "prompt" is contradictory and appears in headless Chrome.
 */
export const permissionsMismatch: Detector = {
  test: "permissionsMismatch",
  label: "Permissions API inconsistency",
  category: "static",
  run: async () => {
    try {
      const notifPerm = (window as any).Notification?.permission;
      const q = await (navigator as any).permissions?.query({ name: "notifications" });
      const queried = q?.state;
      const ev = { notifPerm, queried };
      if (notifPerm === "denied" && queried === "prompt") {
        return result("permissionsMismatch", "fail", 70, ev, undefined, "static");
      }
      if (!notifPerm || !queried) {
        return result("permissionsMismatch", "warn", 20, ev, undefined, "static");
      }
      return result("permissionsMismatch", "pass", 0, ev, undefined, "static");
    } catch (e) {
      return result("permissionsMismatch", "warn", 15, { error: String(e) }, undefined, "static");
    }
  },
};
