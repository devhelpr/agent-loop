import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { create_plan, analyze_project } from "../tools";
import { MessageArray } from "../types/handlers";

export async function handleCreatePlan(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "create_plan") return;

  log(logConfig, "tool-call", "Executing create_plan", {
    stepCount: decision.tool_input.plan_steps?.length || 0,
    hasProjectContext: !!decision.tool_input.project_context,
  });

  let out;
  try {
    // Extract user goal from transcript
    const userGoal = transcript.find((msg) => msg.role === "user")?.content;

    out = await create_plan(
      decision.tool_input.plan_steps || [],
      decision.tool_input.project_context,
      userGoal
    );
  } catch (error) {
    log(logConfig, "tool-error", "create_plan failed", {
      error: String(error),
      planSteps: decision.tool_input.plan_steps,
    });

    // Return a default plan when creation fails
    out = {
      steps: [],
      projectContext: "Unknown project context",
      createdAt: new Date(),
      userGoal: "Unknown goal",
    };
  }

  log(logConfig, "tool-result", "create_plan completed", {
    stepCount: out.steps.length,
    requiredSteps: out.steps.filter((s) => s.required).length,
    hasProjectContext: !!out.projectContext,
  });

  // Add plan results to transcript
  transcript.push({
    role: "assistant",
    content: `create_plan:${JSON.stringify({
      stepCount: out.steps.length,
      requiredSteps: out.steps.filter((s) => s.required).length,
      projectContext: out.projectContext,
      userGoal: out.userGoal,
      createdAt: out.createdAt.toISOString(),
    })}`,
  });

  // Add a formatted plan summary for the model to understand
  const planSummary = `
EXECUTION PLAN CREATED:
- User Goal: ${out.userGoal}
- Project Context: ${out.projectContext || "Not specified"}
- Total Steps: ${out.steps.length}
- Required Steps: ${out.steps.filter((s) => s.required).length}
- Optional Steps: ${out.steps.filter((s) => !s.required).length}

PLAN STEPS:
${out.steps
  .map(
    (step, index) =>
      `${index + 1}. ${step.step} ${
        step.required ? "(REQUIRED)" : "(OPTIONAL)"
      }${
        step.dependencies
          ? ` [Depends on: ${step.dependencies.join(", ")}]`
          : ""
      }`
  )
  .join("\n")}

IMPORTANT GUIDANCE:
- Focus on completing REQUIRED steps first
- Optional steps can be skipped if they don't align with the user's goal
- Always consider dependencies when executing steps
- Reference this plan when making decisions about next actions
- If the user's goal is already achieved, consider final_answer instead of unnecessary steps
`;

  transcript.push({
    role: "assistant",
    content: `plan_summary:${planSummary}`,
  });
}

export async function handleAnalyzeProject(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "analyze_project") return;

  log(logConfig, "tool-call", "Executing analyze_project", {
    scanDirectories: decision.tool_input.scan_directories,
  });

  let out;
  try {
    out = await analyze_project(decision.tool_input.scan_directories);
  } catch (error) {
    log(logConfig, "tool-error", "analyze_project failed", {
      error: String(error),
      scanDirectories: decision.tool_input.scan_directories,
    });

    // Return a default analysis when analysis fails
    out = {
      language: "unknown",
      projectType: "unknown",
      buildTools: [],
      hasTypeScript: false,
      hasReact: false,
      hasVue: false,
      hasAngular: false,
      mainFiles: [],
      configFiles: [],
      dependencies: {},
      devDependencies: {},
    };
  }

  log(logConfig, "tool-result", "analyze_project completed", {
    language: out.language,
    projectType: out.projectType,
    buildToolsCount: out.buildTools.length,
    mainFilesCount: out.mainFiles.length,
    configFilesCount: out.configFiles.length,
    hasTypeScript: out.hasTypeScript,
    hasReact: out.hasReact,
  });

  // Add analysis results to transcript
  transcript.push({
    role: "assistant",
    content: `analyze_project:${JSON.stringify({
      language: out.language,
      projectType: out.projectType,
      buildTools: out.buildTools,
      testFramework: out.testFramework,
      packageManager: out.packageManager,
      hasTypeScript: out.hasTypeScript,
      hasReact: out.hasReact,
      hasVue: out.hasVue,
      hasAngular: out.hasAngular,
      mainFilesCount: out.mainFiles.length,
      configFilesCount: out.configFiles.length,
      dependenciesCount: Object.keys(out.dependencies).length,
      devDependenciesCount: Object.keys(out.devDependencies).length,
    })}`,
  });

  // Add a formatted analysis summary for the model to understand
  const analysisSummary = `
PROJECT ANALYSIS COMPLETE:
- Primary Language: ${out.language}
- Project Type: ${out.projectType}
- Package Manager: ${out.packageManager || "Unknown"}
- Test Framework: ${out.testFramework || "None detected"}

TECHNOLOGY STACK:
- TypeScript: ${out.hasTypeScript ? "Yes" : "No"}
- React: ${out.hasReact ? "Yes" : "No"}
- Vue: ${out.hasVue ? "Yes" : "No"}
- Angular: ${out.hasAngular ? "Yes" : "No"}

BUILD TOOLS: ${
    out.buildTools.length > 0 ? out.buildTools.join(", ") : "None detected"
  }

PROJECT STRUCTURE:
- Main Files: ${out.mainFiles.length} files
- Config Files: ${out.configFiles.length} files
- Dependencies: ${Object.keys(out.dependencies).length} packages
- Dev Dependencies: ${Object.keys(out.devDependencies).length} packages

IMPORTANT GUIDANCE:
- Use this project context when making decisions about file operations
- Consider the detected language and frameworks when writing code
- Reference build tools when suggesting commands to run
- Take into account the project structure when planning file changes
- Use appropriate file extensions and patterns for the detected project type
`;

  transcript.push({
    role: "assistant",
    content: `analysis_summary:${analysisSummary}`,
  });
}
