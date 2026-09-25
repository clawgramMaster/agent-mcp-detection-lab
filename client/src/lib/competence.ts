import type { DetectorCtx } from "./detector";

/**
 * Task competence: how well the challenge tasks were actually performed. This is separate from
 * the bot score. Scoring rules:
 *  - every task is worth the same (11 tasks, grouped into 5 steps);
 *  - a task counts only when it is completed correctly (unfinished or unattempted = 0);
 *  - a completed task can lose a little credit for retries or mistakes when we can measure them
 *    (Step 1b: extra rounds, Step 1c: wrong taps), never below 40 % of its value.
 * Tasks nobody attempted are neutral for the bot score but count as not done here.
 */
export interface TaskGroup {
  id: string;
  /** step number shown on the page; its tasks are 1a, 1b, ... */
  number: number;
  title: string;
  /** how many tasks the step holds */
  tasks: number;
}

/** A step is one card that can hold several related tasks (1a, 1b, ...), in page order. */
export const TASK_GROUPS: TaskGroup[] = [
  { id: "pointer", number: 1, title: "Pointer tasks", tasks: 3 },
  { id: "input", number: 2, title: "Form & frame input", tasks: 2 },
  { id: "click", number: 3, title: "Clicks & tabs", tasks: 2 },
  { id: "hover", number: 4, title: "Hover menus", tasks: 2 },
  { id: "select", number: 5, title: "Select & clipboard", tasks: 2 },
];

export interface CompetenceTask {
  /** task id: step number + letter, e.g. "1b" */
  id: string;
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
  /** steps (groups) whose tasks are all completed */
  stepsCompleted: number;
  stepsTotal: number;
  tasks: CompetenceTask[];
}

const MIN_CREDIT = 0.4;
const clampCredit = (n: number) => Math.max(MIN_CREDIT, Math.min(1, n));

export function computeCompetence(ctx: DetectorCtx): Competence {
  const done = (
    id: string,
    group: string,
    label: string,
    completed: boolean | undefined,
    quality = 1,
    note?: string,
  ): CompetenceTask => ({
    id,
    group,
    label,
    completed: !!completed,
    credit: completed ? clampCredit(quality) : 0,
    ...(completed && note ? { note } : {}),
  });

  const attempts = ctx.puzzleRotate?.attempts ?? 1;
  const wrong = ctx.keypad?.wrongClicks ?? 0;
  const tasks: CompetenceTask[] = [
    done("1a", "pointer", "Value slider", ctx.slider?.completed),
    done(
      "1b",
      "pointer",
      "Rotate the circle upright",
      ctx.puzzleRotate?.completed,
      1 - 0.2 * (attempts - 1),
      attempts > 1 ? `${attempts} rounds needed` : undefined,
    ),
    done(
      "1c",
      "pointer",
      "Keypad PIN",
      ctx.keypad?.completed,
      1 - 0.15 * wrong,
      wrong > 0 ? `${wrong} wrong tap${wrong > 1 ? "s" : ""}` : undefined,
    ),
    done("2a", "input", "Credentials", ctx.credentials?.complete),
    done("2b", "input", "Nested certificate iframe", ctx.iframeInput?.complete && ctx.iframeInput.blurred),
    done("3a", "click", "DOM-churn click", ctx.detachedClick?.completed),
    done("3b", "click", "Verification tab", ctx.popupCheck?.completed),
    done("4a", "hover", "In-page hover menu", ctx.inPageHoverMenu?.completed),
    done("4b", "hover", "Iframe hover menu", ctx.hoverMenu?.completed),
    done("5a", "select", "Native select", ctx.nativeSelect?.complete),
    done("5b", "select", "Copy & paste token", ctx.clipboardTransfer?.completed),
  ];
  const completed = tasks.filter((t) => t.completed).length;
  const credit = tasks.reduce((sum, t) => sum + t.credit, 0);
  const stepsCompleted = TASK_GROUPS.filter((g) => {
    const mine = tasks.filter((t) => t.group === g.id);
    return mine.length > 0 && mine.every((t) => t.completed);
  }).length;
  return {
    score: Math.round((100 * credit) / tasks.length),
    completed,
    total: tasks.length,
    stepsCompleted,
    stepsTotal: TASK_GROUPS.length,
    tasks,
  };
}
