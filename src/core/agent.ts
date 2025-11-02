import { LogConfig, log, logError } from "../utils/logging";
import { DecisionSchema, Decision } from "../types/decision";
import { z } from "zod";
import {
  handleReadFiles,
  handleSearchRepo,
  handleWritePatch,
  handleRunCmd,
  handleEvaluateWork,
  handleCreatePlan,
  handleAnalyzeProject,
} from "../handlers";
import {
  makeAICallWithSchema,
  getTokenStats,
  resetTokenStats,
  displayTokenSummary,
} from "../ai/api-calls";
import { prompt } from "../ai/prompts";
import { AIProvider } from "../ai/ai-client";
import { withSpan } from "../utils/observability";

// Validation function to ensure decision structure is correct
function validateDecision(parsed: any): Decision | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  // Check if it's a valid action
  const validActions = [
    "read_files",
    "search_repo",
    "write_patch",
    "run_cmd",
    "evaluate_work",
    "create_plan",
    "analyze_project",
    "final_answer",
  ];

  if (!parsed.action || !validActions.includes(parsed.action)) {
    return null;
  }

  // Basic structure validation
  if (parsed.action !== "final_answer" && !parsed.tool_input) {
    return null;
  }

  return parsed as Decision;
}

export type MessageArray = Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

export async function runCodingAgent(
  userGoal: string,
  opts?: {
    maxSteps?: number;
    testCommand?: { cmd: string; args?: string[] };
    hardCaps?: { maxWrites?: number; maxCmds?: number };
    logging?: LogConfig;
    aiProvider?: AIProvider;
    aiModel?: string;
  }
) {
  // Reset token statistics for this run
  resetTokenStats();

  const maxSteps = opts?.maxSteps ?? 20;
  const testCmd = opts?.testCommand ?? {
    cmd: "npm",
    args: ["test", "--silent"],
  };
  const caps = { maxWrites: 10, maxCmds: 20, ...(opts?.hardCaps ?? {}) };
  const logConfig: LogConfig = {
    enabled: true,
    logSteps: true,
    logToolCalls: true,
    logToolResults: true,
    logDecisions: true,
    logTranscript: false,
    logErrors: true, // Enable error logging by default
    logPromptContext: true, // Enable prompt/context logging by default
    fileLogging: {
      enabled: true,
      filePath: process.env.AGENT_LOG_FILE || "agent-log.txt",
    },
    ...opts?.logging,
  };
  let writes = 0,
    cmds = 0;

  log(logConfig, "step", `Starting coding agent with goal: ${userGoal}`, {
    maxSteps,
    caps,
  });

  const system = `
${prompt}
Safety caps:
- At most ${caps.maxWrites} write_patch calls and ${caps.maxCmds} run_cmd calls.

When ready to speak to the user, choose final_answer.
`;

  const transcript: MessageArray = [
    { role: "system", content: system },
    { role: "user", content: userGoal },
  ];

  // Planning phase: Analyze project and create plan for complex tasks
  log(logConfig, "step", "=== Planning Phase ===");

  // Always analyze the project first
  const analyzeDecision: Decision = {
    action: "analyze_project",
    tool_input: { scan_directories: ["."] },
    rationale: "Analyzing project structure before starting work",
  };

  await handleAnalyzeProject(analyzeDecision, transcript, logConfig);

  // For complex tasks, create a structured plan
  const isComplexTask =
    userGoal.length > 100 ||
    userGoal.toLowerCase().includes("implement") ||
    userGoal.toLowerCase().includes("create") ||
    userGoal.toLowerCase().includes("build") ||
    (userGoal.toLowerCase().includes("add") &&
      userGoal.toLowerCase().includes("feature"));

  if (isComplexTask) {
    log(logConfig, "step", "Complex task detected, creating execution plan");

    const planDecision: Decision = {
      action: "create_plan",
      tool_input: {
        plan_steps: [
          {
            step: "Analyze existing codebase and understand requirements",
            required: true,
            dependencies: [],
          },
          {
            step: "Implement core functionality as requested",
            required: true,
            dependencies: [
              "Analyze existing codebase and understand requirements",
            ],
          },
          {
            step: "Test and validate the implementation",
            required: true,
            dependencies: ["Implement core functionality as requested"],
          },
          {
            step: "Add error handling and edge cases",
            required: false,
            dependencies: ["Implement core functionality as requested"],
          },
          {
            step: "Optimize and refactor if needed",
            required: false,
            dependencies: ["Test and validate the implementation"],
          },
        ],
        project_context: "Project analysis will provide context",
      },
      rationale: "Creating structured plan for complex task execution",
    };

    await handleCreatePlan(planDecision, transcript, logConfig);
  }

  for (let step = 1; step <= maxSteps; step++) {
    log(logConfig, "step", `=== Step ${step}/${maxSteps} ===`, {
      writes,
      cmds,
    });
    log(logConfig, "transcript", "Current transcript length", {
      messageCount: transcript.length,
    });

    let decisionResp: Awaited<ReturnType<typeof makeAICallWithSchema>>;

    try {
      decisionResp = await withSpan("ai.call", () =>
        makeAICallWithSchema(transcript, DecisionSchema, logConfig, {
          maxRetries: 3,
          timeoutMs: 120000, // 2 minutes
          truncateTranscript: true,
          provider: opts?.aiProvider,
          model: opts?.aiModel,
        })
      );
    } catch (error) {
      logError(logConfig, "AI API call failed after all retries", error);

      // Get token statistics even on error
      const tokenStats = getTokenStats();

      // Display token summary even on error
      displayTokenSummary(tokenStats);

      return {
        steps: step,
        message: `AI API call failed at step ${step}: ${error}`,
        tokenUsage: tokenStats,
      };
    }

    const rawContent = decisionResp.choices[0].message.content || "{}";
    let decision: Decision;

    // Check if response is too large (might indicate an issue)
    if (rawContent.length > 50000) {
      log(
        logConfig,
        "decision",
        "Response is very large, might indicate parsing issues",
        {
          contentLength: rawContent.length,
          preview: rawContent.substring(0, 200) + "...",
        }
      );
    }

    try {
      const parsed = JSON.parse(rawContent);
      log(logConfig, "decision", "LLM response parsed successfully", {
        rawContentLength: rawContent.length,
        hasAction: !!parsed.action,
        hasProperties: !!parsed.properties,
      });

      // Handle case where the decision is nested under properties
      if (parsed.properties?.action) {
        log(
          logConfig,
          "decision",
          "Decision found in properties, extracting..."
        );
        const extractedDecision = {
          action: parsed.properties.action,
          tool_input: parsed.properties.tool_input || {},
          rationale: parsed.properties.rationale,
        };

        const validatedDecision = validateDecision(extractedDecision);
        if (validatedDecision) {
          decision = validatedDecision;
        } else {
          log(
            logConfig,
            "decision",
            "Extracted decision failed validation, defaulting to final_answer",
            { extractedDecision }
          );
          decision = {
            action: "final_answer",
            rationale: "Invalid decision structure in properties",
          } as Decision;
        }
      } else {
        const validatedDecision = validateDecision(parsed);
        if (validatedDecision) {
          decision = validatedDecision;
        } else {
          log(
            logConfig,
            "decision",
            "Parsed decision failed validation, defaulting to final_answer",
            { parsedKeys: Object.keys(parsed), parsed }
          );
          decision = {
            action: "final_answer",
            rationale: "Invalid decision structure",
          } as Decision;
        }
      }
    } catch (error) {
      logError(logConfig, "Failed to parse LLM response as JSON", error, {
        rawContent:
          rawContent.substring(0, 500) + (rawContent.length > 500 ? "..." : ""),
        contentLength: rawContent.length,
      });
      // Default to final_answer if parsing fails
      decision = {
        action: "final_answer",
        rationale: "JSON parsing error occurred",
      } as Decision;
    }

    log(logConfig, "decision", `Agent decided: ${decision.action}`, {
      decision: decision,
    });

    if (decision.action === "final_answer") {
      log(logConfig, "step", "Agent chose final_answer - generating summary");
      // Produce a succinct status + next steps for the user
      let final;
      try {
        const summaryMessages = [
          ...transcript.slice(-10), // Only use last 10 messages for summary
          {
            role: "system" as const,
            content:
              "Now summarize the changes made, current test status, and any follow-ups succinctly. Keep it under 200 words.",
          },
        ];

        final = await withSpan("ai.summary", () =>
          makeAICallWithSchema(
            summaryMessages,
            z
              .object({
                summary: z.string(),
              })
              .describe("Summary"),
            logConfig,
            {
              maxRetries: 2,
              timeoutMs: 60000,
              truncateTranscript: false,
              provider: opts?.aiProvider,
              model: opts?.aiModel,
            }
          )
        );
      } catch (summaryError) {
        logError(
          logConfig,
          "Failed to generate summary, using default",
          summaryError
        );
        return {
          steps: step,
          message: `Task completed in ${step} steps. Summary generation failed, but agent finished execution.`,
        };
      }
      const result = {
        steps: step,
        message:
          final.choices[0].message.content || "Task completed successfully",
      };

      // Get final token statistics
      const tokenStats = getTokenStats();

      log(logConfig, "step", "Agent completed successfully", {
        ...result,
        tokenUsage: tokenStats,
      });

      // Display token summary
      displayTokenSummary(tokenStats);

      return result;
    }

    // Execute appropriate tool handler
    if (decision.action === "read_files") {
      await handleReadFiles(decision, transcript, logConfig);
      continue;
    }

    if (decision.action === "search_repo") {
      await handleSearchRepo(decision, transcript, logConfig);
      continue;
    }

    if (decision.action === "write_patch") {
      writes = await handleWritePatch(
        decision,
        transcript,
        writes,
        caps,
        logConfig
      );
      continue;
    }

    if (decision.action === "run_cmd") {
      cmds = await handleRunCmd(
        decision,
        transcript,
        cmds,
        caps,
        testCmd,
        logConfig
      );
      continue;
    }

    if (decision.action === "evaluate_work") {
      await handleEvaluateWork(decision, transcript, logConfig);
      continue;
    }

    if (decision.action === "create_plan") {
      await handleCreatePlan(decision, transcript, logConfig);
      continue;
    }

    if (decision.action === "analyze_project") {
      await handleAnalyzeProject(decision, transcript, logConfig);
      continue;
    }

    // Unknown action
    log(logConfig, "step", "Unknown action encountered", {
      action: (decision as any).action,
    });
    transcript.push({
      role: "assistant",
      content: `ERROR: Unknown action ${JSON.stringify(decision)}`,
    });
  }

  const result = {
    steps: maxSteps,
    message: "Max steps reached without finalization.",
  };
  log(logConfig, "step", "Agent reached max steps without completion", result);
  return result;
}
