import { LogConfig, log } from "../utils/logging";

export interface PlanStep {
  step: string;
  required: boolean;
  dependencies?: string[];
}

export interface ExecutionPlan {
  steps: PlanStep[];
  projectContext?: string;
  createdAt: Date;
  userGoal: string;
}

export async function create_plan(
  planSteps: PlanStep[],
  projectContext?: string,
  userGoal?: string
): Promise<ExecutionPlan> {
  log(
    { enabled: true, logSteps: true } as LogConfig,
    "planning",
    "Creating execution plan",
    {
      stepCount: planSteps.length,
      requiredSteps: planSteps.filter((s) => s.required).length,
      hasProjectContext: !!projectContext,
      hasUserGoal: !!userGoal,
    }
  );

  const plan: ExecutionPlan = {
    steps: planSteps,
    projectContext,
    createdAt: new Date(),
    userGoal: userGoal || "Unknown goal",
  };

  // Validate plan structure
  const stepIds = planSteps.map((_, index) => `step_${index}`);
  const invalidDeps: string[] = [];

  planSteps.forEach((step, index) => {
    if (step.dependencies) {
      step.dependencies.forEach((dep) => {
        if (!stepIds.includes(dep)) {
          invalidDeps.push(dep);
        }
      });
    }
  });

  if (invalidDeps.length > 0) {
    log(
      { enabled: true, logSteps: true } as LogConfig,
      "planning",
      "Warning: Invalid dependencies found",
      { invalidDependencies: invalidDeps }
    );
  }

  return plan;
}

export function validatePlanExecution(
  plan: ExecutionPlan,
  completedSteps: string[]
): {
  nextSteps: PlanStep[];
  blockedSteps: PlanStep[];
  completedRequired: number;
  totalRequired: number;
} {
  const completedSet = new Set(completedSteps);
  const nextSteps: PlanStep[] = [];
  const blockedSteps: PlanStep[] = [];

  plan.steps.forEach((step, index) => {
    const stepId = `step_${index}`;

    if (completedSet.has(stepId)) {
      return; // Already completed
    }

    // Check if dependencies are met
    const dependenciesMet =
      !step.dependencies ||
      step.dependencies.every((dep) => completedSet.has(dep));

    if (dependenciesMet) {
      nextSteps.push(step);
    } else {
      blockedSteps.push(step);
    }
  });

  const completedRequired = plan.steps
    .filter((_, index) => completedSet.has(`step_${index}`))
    .filter((step) => step.required).length;

  const totalRequired = plan.steps.filter((step) => step.required).length;

  return {
    nextSteps,
    blockedSteps,
    completedRequired,
    totalRequired,
  };
}
