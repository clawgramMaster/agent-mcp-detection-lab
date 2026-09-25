import type { DetectorCtx } from "./detector";

/**
 * Task competence: how well the challenge tasks were actually performed. This is separate from
 * the bot score. Scoring rules:
 *  - every task is worth the same;
 *  - a task counts only when it is completed correctly (unfinished or unattempted = 0);
 *  - a completed task can lose a little credit for retries or mistakes when we can measure them
 *    (Step 2: extra rounds, Step 3: wrong taps), never below 40 % of its value.
 * Tasks nobody attempted are neutral for the bot score but count as not done here.
 */
export interface TaskGroup {
  id: string;
  title: string;
  steps: string;
}

/** Contiguous steps grouped into cards, in page order (step numbers are unchanged). */
export const TASK_GROUPS: TaskGroup[] = [
  { id: "pointer", title: "Pointer tasks", steps: "Steps 1–3" },
  { id: "input", title: "Form & frame input", steps: "Steps 4–5" },
  { id: "click", title: "Clicks & tabs", steps: "Steps 6–7" },
  { id: "hover", title: "Hover menus", steps: "Steps 8–9" },
  { id: "select", title: "Select & clipboard", steps: "Steps 10–11" },
];

export interface CompetenceTask {
  step: number;
  group: string;
  label: string;
  completed: boolean;
  /** 0..1 credit when completed (1 = clean, lower = retries/mistakes); 0 when not completed */
  credit: number;
  note?: string;
}

export interface Competence {
  /** 0..100 */
  score: number;
  completed: number;
  total: number;
  tasks: CompetenceTask[];
}

const MIN_CREDIT = 0.4;
const clampCredit = (n: number) => Math.max(MIN_CREDIT, Math.min(1, n));

export function computeCompetence(ctx: DetectorCtx): Competence {
  const done = (
    step: number,
    group: string,
    label: string,
    completed: boolean | undefined,
    quality = 1,
    note?: string,
  ): CompetenceTask => ({
    step,
    group,
    label,
    completed: !!completed,
    credit: completed ? clampCredit(quality) : 0,
    ...(completed && note ? { note } : {}),
  });

  const attempts = ctx.puzzleRotate?.attempts ?? 1;
  const wrong = ctx.keypad?.wrongClicks ?? 0;
  const tasks: CompetenceTask[] = [
    done(1, "pointer", "Value slider", ctx.slider?.completed),
    done(
      2,
      "pointer",
      "Rotate the circle upright",
      ctx.puzzleRotate?.completed,
      1 - 0.2 * (attempts - 1),
      attempts > 1 ? `${attempts} rounds needed` : undefined,
    ),
    done(
      3,
      "pointer",
      "Keypad PIN",
      ctx.keypad?.completed,
      1 - 0.15 * wrong,
      wrong > 0 ? `${wrong} wrong tap${wrong > 1 ? "s" : ""}` : undefined,
    ),
    done(4, "input", "Credentials", ctx.credentials?.complete),
    done(5, "input", "Nested certificate iframe", ctx.iframeInput?.complete && ctx.iframeInput.blurred),
    done(6, "click", "DOM-churn click", ctx.detachedClick?.completed),
    done(7, "click", "Verification tab", ctx.popupCheck?.completed),
    done(8, "hover", "In-page hover menu", ctx.inPageHoverMenu?.completed),
    done(9, "hover", "Iframe hover menu", ctx.hoverMenu?.completed),
    done(10, "select", "Native select", ctx.nativeSelect?.complete),
    done(11, "select", "Copy & paste token", ctx.clipboardTransfer?.completed),
  ];
  const completed = tasks.filter((t) => t.completed).length;
  const credit = tasks.reduce((sum, t) => sum + t.credit, 0);
  return { score: Math.round((100 * credit) / tasks.length), completed, total: tasks.length, tasks };
}
