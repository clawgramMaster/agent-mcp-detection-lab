import { type Detector, result } from "../../lib/detector";

/**
 * Shift-key consistency — physically impossible keystroke (KILLER signal).
 * deviceandbrowserinfo: typeAtCharacter / typeAtWithModifier.
 *
 * On a US keyboard, characters like `@` (Shift+2), uppercase A–Z, and the
 * symbols ~!@#$%^&*()_+{}|:"<>? can ONLY be produced with the Shift modifier
 * held. If a keydown reports such a character but `shiftKey === false`, that is
 * physically impossible for a human hand → definitive bot.
 *
 * Unlike statistical trajectory/timing checks this has no gray zone: it encodes
 * a hard physical impossibility.
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
    // only consider keys where we actually captured the shift flag
    const typed = ctx.keys.filter((k) => k.shift !== undefined && k.key.length === 1);
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
    const impossible = shiftedChars.filter((k) => k.shift === false);
    const ev = {
      shiftRequiringChars: shiftedChars.length,
      impossible: impossible.length,
      examples: impossible.slice(0, 6).map((k) => k.key),
    };
    if (impossible.length >= 1) {
      // hard impossibility → max confidence
      return result("shiftKeyConsistency", "fail", 100, ev, undefined, "interaction");
    }
    return result("shiftKeyConsistency", "pass", 0, ev, undefined, "interaction");
  },
};
