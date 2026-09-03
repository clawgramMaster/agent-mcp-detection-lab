import { type Detector, result } from "../../lib/detector";

const BROWSER_RS_VOICES = [
  ["Samantha", "en-US", true, true],
  ["Alex", "en-US", true, false],
  ["Daniel", "en-GB", true, false],
  ["Karen", "en-AU", true, false],
  ["Moira", "en-IE", true, false],
  ["Rishi", "en-IN", true, false],
  ["Google US English", "en-US", false, false],
  ["Google UK English Male", "en-GB", false, false],
] as const;

export interface SpeechVoiceShape {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  plainObject: boolean;
}

/** Exported for deterministic unit tests without browser globals. */
export function evaluateBrowserRsSpeechShim(voices: SpeechVoiceShape[], ownGetVoices: boolean) {
  const exactVoices =
    voices.length === BROWSER_RS_VOICES.length &&
    voices.every((voice, index) => {
      const expected = BROWSER_RS_VOICES[index];
      return (
        voice.name === expected[0] &&
        voice.lang === expected[1] &&
        voice.localService === expected[2] &&
        voice.default === expected[3] &&
        voice.plainObject
      );
    });
  const evidence = { count: voices.length, ownGetVoices, exactVoices };
  if (ownGetVoices && exactVoices) {
    return result("browserRsSpeechShim", "fail", 95, evidence, undefined, "static");
  }
  return result("browserRsSpeechShim", "pass", 0, evidence, undefined, "static");
}

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

/** Exact fixed voice list installed by browser-rs when the native list is empty. */
export const browserRsSpeechShim: Detector = {
  test: "browserRsSpeechShim",
  label: "browser-rs speech shim",
  category: "static",
  run: () => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) {
        return result(
          "browserRsSpeechShim",
          "inconclusive",
          0,
          { reason: "speechSynthesis unavailable" },
          undefined,
          "static",
        );
      }
      const voices = synth.getVoices().map((voice) => ({
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        default: voice.default,
        plainObject: Object.getPrototypeOf(voice) === Object.prototype,
      }));
      return evaluateBrowserRsSpeechShim(voices, Object.prototype.hasOwnProperty.call(synth, "getVoices"));
    } catch (error) {
      return result(
        "browserRsSpeechShim",
        "inconclusive",
        0,
        { reason: "speech surface could not be inspected", error: String(error) },
        undefined,
        "static",
      );
    }
  },
};
