import { type Detector, result } from "../../lib/detector";

/**
 * Audio fingerprint (CreepJS / FingerprintJS).
 * Renders a short waveform through an OfflineAudioContext and hashes the
 * output. Real devices produce a stable, device-specific value; many headless
 * / virtualized environments either fail, produce all-zero buffers, or throw.
 */
export const audioFingerprint: Detector = {
  test: "audioFingerprint",
  label: "Audio stack fingerprint",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      try {
        const Ctx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        if (!Ctx) {
          resolve(result("audioFingerprint", "warn", 30, { noOfflineAudioContext: true }, undefined, "static"));
          return;
        }
        const ctx = new Ctx(1, 44100, 44100);
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 10000;
        const comp = ctx.createDynamicsCompressor();
        osc.connect(comp);
        comp.connect(ctx.destination);
        osc.start(0);
        ctx.startRendering();

        const timeout = setTimeout(() => {
          resolve(result("audioFingerprint", "warn", 25, { renderTimeout: true }, undefined, "static"));
        }, 800);

        ctx.oncomplete = (e: any) => {
          clearTimeout(timeout);
          const buf = e.renderedBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 4500; i < 5000; i++) sum += Math.abs(buf[i]);
          const hash = sum.toString();
          const silent = sum === 0;
          if (silent) {
            resolve(result("audioFingerprint", "warn", 40, { silentBuffer: true }, undefined, "static"));
          } else {
            resolve(result("audioFingerprint", "pass", 0, { hash, sum: +sum.toFixed(6) }, undefined, "static"));
          }
        };
      } catch (e) {
        resolve(result("audioFingerprint", "warn", 35, { error: String(e) }, undefined, "static"));
      }
    }),
};
