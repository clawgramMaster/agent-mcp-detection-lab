import { type Detector, result } from "../../lib/detector";

/**
 * Shift-key consistency — physically impossible keystroke (KILLER signal).
 * deviceandbrowserinfo: typeAtCharacter / typeAtWithModifier.
 *
 * A character like `@` or uppercase `A` normally needs a modifier. If it arrives
 * with `shiftKey === false` it *looks* impossible — but three legitimate cases
 * must be excluded first or a real human is falsely flagged:
 *   - CapsLock ON makes uppercase letters need no Shift;
 *   - AltGraph (right Alt) produces symbols without Shift on non-US layouts;
 *   - dead keys / IME composition can emit characters with no live modifier.
 * We therefore only count a keystroke as impossible when shift, CapsLock AND
 * AltGraph are all absent, and — since layout still can't be fully known from JS
 * — treat it as a strong heuristic (weight 0.5), not a standalone 100 verdict.
 */
const SHIFT_SYMBOLS = new Set('~!@#$%^&*()_+{}|:"<>?'.split(""));

function requiresShift(key: string): boolean {
  if (key.length !== 1) return false; // ignore "Enter", "Shift", "Tab", ...
  if (key >= "A" && key <= "Z") return true; // uppercase letters
  return SHIFT_SYMBOLS.has(key);
}

export const shiftKeyConsistency: Detector = {
  test: "shiftKeyConsistency",
  label: "Impossible keystroke (shift-char w/o Shift)",
  category: "interaction",
  run: (ctx) => {
    // need keys with a captured shift flag to judge anything
    const typed = ctx.keys.filter((k) => k.shift !== undefined && k.key.length === 1);
    if (typed.length === 0) {
      return result("shiftKeyConsistency", "inconclusive", 0, { note: "no typing captured" }, undefined, "interaction");
    }
    const shiftedChars = typed.filter((k) => requiresShift(k.key));
    if (shiftedChars.length === 0) {
      return result(
        "shiftKeyConsistency",
        "pass",
        0,
        { note: "no shift-requiring characters typed", typedChars: typed.length },
        undefined,
        "interaction",
      );
    }
    // impossible only if NO modifier that could legitimately produce it was active
    const impossible = shiftedChars.filter((k) => {
      if (k.shift !== false) return false; // Shift was held → fine
      if (k.altGraph === true) return false; // AltGr composition (non-US layouts)
      if (k.key >= "A" && k.key <= "Z" && k.caps === true) return false; // CapsLock uppercase
      return true;
    });
    const ev = {
      shiftRequiringChars: shiftedChars.length,
      impossible: impossible.length,
      examples: impossible.slice(0, 6).map((k) => k.key),
    };
    if (impossible.length >= 1) {
      // strong but not decisive — layout can't be fully known from JS
      return result("shiftKeyConsistency", "fail", 90, ev, undefined, "interaction");
    }
    return result("shiftKeyConsistency", "pass", 0, ev, undefined, "interaction");
  },
};
