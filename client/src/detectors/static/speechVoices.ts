import { type Detector, result } from "../../lib/detector";

/**
 * Speech synthesis voices (headless tell).
 * Real desktop browsers ship a non-empty list of TTS voices. Headless Chrome
 * and many automation containers expose ZERO voices. Suggestive, not proof —
 * real browsers can also briefly report 0 (async TTS load, some Linux setups),
 * so an empty list is a "warn", not a solo "fail".
 */
export const speechVoices: Detector = {
  test: "speechVoices",
  label: "SpeechSynthesis voices",
  category: "static",
  run: () =>
    new Promise((resolve) => {
      try {
        const synth = window.speechSynthesis;
        if (!synth) {
          resolve(result("speechVoices", "warn", 40, { noSpeechSynthesis: true }, undefined, "static"));
          return;
        }
        const finish = () => {
          const voices = synth.getVoices();
          const ev = { count: voices.length, sample: voices.slice(0, 3).map((v) => `${v.name} (${v.lang})`) };
          if (voices.length === 0) {
            resolve(result("speechVoices", "warn", 40, { ...ev, empty: true }, undefined, "static"));
          } else {
            resolve(result("speechVoices", "pass", 0, ev, undefined, "static"));
          }
        };
        // voices may load async
        if (synth.getVoices().length > 0) return finish();
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          finish();
        };
        synth.addEventListener("voiceschanged", done, { once: true });
        setTimeout(done, 500);
      } catch (e) {
        resolve(result("speechVoices", "warn", 20, { error: String(e) }, undefined, "static"));
      }
    }),
};
