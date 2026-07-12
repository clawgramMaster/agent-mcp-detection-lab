import { type Detector, result } from "../../lib/detector";

/**
 * WebRTC / ICE candidate probe (BrowserLeaks).
 * A real browser gathers host ICE candidates (local IPs, usually mDNS
 * `.local` on modern Chrome). Automation that disables WebRTC or runs in a
 * stripped container yields no candidates or no RTCPeerConnection at all —
 * a mismatch versus a Chrome-claiming UA.
 */
export const webrtcLeak: Detector = {
  test: "webrtcLeak",
  label: "WebRTC ICE candidates",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      const RTC = (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
      if (!RTC) {
        // No WebRTC on a Chrome-claiming UA is suspicious.
        const claimsChrome = /Chrome\/\d+/i.test(navigator.userAgent);
        resolve(
          result(
            "webrtcLeak",
            claimsChrome ? "warn" : "pass",
            claimsChrome ? 35 : 0,
            { noRTCPeerConnection: true },
            undefined,
            "static",
          ),
        );
        return;
      }
      const candidates: string[] = [];
      let settled = false;
      const done = (extra: Record<string, unknown> = {}) => {
        if (settled) return;
        settled = true;
        try {
          pc.close();
        } catch {
          /* */
        }
        const hasHost = candidates.some((c) => /typ host/.test(c));
        const ev = { candidateCount: candidates.length, hasHost, samples: candidates.slice(0, 3), ...extra };
        if (candidates.length === 0) {
          resolve(result("webrtcLeak", "warn", 30, { ...ev, noCandidates: true }, undefined, "static"));
        } else {
          resolve(result("webrtcLeak", "pass", 0, ev, undefined, "static"));
        }
      };
      let pc: RTCPeerConnection;
      try {
        pc = new RTC({ iceServers: [] });
        pc.createDataChannel("probe");
        pc.onicecandidate = (e) => {
          if (e.candidate) candidates.push(e.candidate.candidate);
          else done(); // null candidate = gathering complete
        };
        pc.createOffer()
          .then((o) => pc.setLocalDescription(o))
          .catch((err) => done({ offerError: String(err) }));
        setTimeout(() => done({ timeout: true }), 900);
      } catch (e) {
        resolve(result("webrtcLeak", "warn", 25, { error: String(e) }, undefined, "static"));
      }
    }),
};
