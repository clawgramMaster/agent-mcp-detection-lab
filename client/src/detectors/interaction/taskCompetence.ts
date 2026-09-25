import { computeCompetence } from "../../lib/competence";
import { type Detector, result } from "../../lib/detector";

/**
 * Task competence (informational, weight 0): how many of the challenge tasks were completed
 * correctly, with a small deduction for measurable retries/mistakes. It rides along with the
 * other interaction results so it is stored and reported, but it never moves the bot score.
 */
export const taskCompetence: Detector = {
  test: "taskCompetence",
  label: "Task competence",
  category: "interaction",
  run: (ctx) => {
    const c = computeCompetence(ctx);
    const evidence = {
      competence: c.score,
      completed: c.completed,
      total: c.total,
      stepsCompleted: c.stepsCompleted,
      stepsTotal: c.stepsTotal,
      tasks: c.tasks.map((t) => ({ id: t.id, done: t.completed, credit: +t.credit.toFixed(2) })),
    };
    if (c.completed === 0) return result("taskCompetence", "inconclusive", 0, evidence, undefined, "interaction");
    return result("taskCompetence", "pass", 0, evidence, undefined, "interaction");
  },
};
