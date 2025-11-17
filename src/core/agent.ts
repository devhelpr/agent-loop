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
import { withSpan, recordErrorSpan } from "../utils/observability";

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
  return await withSpan("agent.run", async (span) => {
    if (span) {
      span.setAttribute("agent.user_goal", userGoal.substring(0, 500));
      span.setAttribute("agent.user_goal_length", userGoal.length);
      span.setAttribute("agent.max_steps", opts?.maxSteps ?? 20);
      span.setAttribute("agent.max_writes", opts?.hardCaps?.maxWrites ?? 10);
      span.setAttribute("agent.max_cmds", opts?.hardCaps?.maxCmds ?? 20);
      span.setAttribute("agent.provider", opts?.aiProvider || "openai");
      span.setAttribute("agent.model", opts?.aiModel || "default");
      span.setAttribute("agent.test_command", JSON.stringify(opts?.testCommand || { cmd: "npm", args: ["test", "--silent"] }));
    }
    
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
  await withSpan("agent.planning_phase", async (planningSpan) => {
    if (planningSpan) {
      planningSpan.setAttribute("agent.planning.user_goal_length", userGoal.length);
      planningSpan.setAttribute("agent.planning.user_goal_preview", userGoal.substring(0, 200));
    }

    log(logConfig, "step", "=== Planning Phase ===");

    // Always analyze the project first
    const analyzeDecision: Decision = {
      action: "analyze_project",
      tool_input: { scan_directories: ["."] },
      rationale: "Analyzing project structure before starting work",
    };

    await withSpan("agent.planning.project_analysis", async (analysisSpan) => {
      if (analysisSpan) {
        analysisSpan.setAttribute("agent.planning.analysis.scan_directories", JSON.stringify(analyzeDecision.tool_input.scan_directories));
      }
      await handleAnalyzeProject(
        analyzeDecision,
        transcript,
        logConfig,
        opts?.aiProvider
      );
    });

    // For complex tasks, create a structured plan
    // Lowered thresholds to make planning more common
    const isComplexTask =
      userGoal.length > 30 ||
      userGoal.toLowerCase().includes("implement") ||
      userGoal.toLowerCase().includes("create") ||
      userGoal.toLowerCase().includes("build") ||
      userGoal.toLowerCase().includes("add") ||
      userGoal.toLowerCase().includes("update") ||
      userGoal.toLowerCase().includes("modify") ||
      userGoal.toLowerCase().includes("change") ||
      userGoal.toLowerCase().includes("fix") ||
      userGoal.toLowerCase().includes("refactor") ||
      userGoal.toLowerCase().includes("improve") ||
      userGoal.toLowerCase().includes("feature") ||
      userGoal.toLowerCase().includes("functionality");

    if (planningSpan) {
      const lowerGoal = userGoal.toLowerCase();
      planningSpan.setAttribute("agent.planning.is_complex_task", isComplexTask);
      planningSpan.setAttribute("agent.planning.complexity_check.length", userGoal.length > 30);
      planningSpan.setAttribute("agent.planning.complexity_check.has_implement", lowerGoal.includes("implement"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_create", lowerGoal.includes("create"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_build", lowerGoal.includes("build"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_add", lowerGoal.includes("add"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_update", lowerGoal.includes("update"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_modify", lowerGoal.includes("modify"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_change", lowerGoal.includes("change"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_fix", lowerGoal.includes("fix"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_refactor", lowerGoal.includes("refactor"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_improve", lowerGoal.includes("improve"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_feature", lowerGoal.includes("feature"));
      planningSpan.setAttribute("agent.planning.complexity_check.has_functionality", lowerGoal.includes("functionality"));
    }

    // Always create a span for plan creation decision, even if skipped
    await withSpan("agent.planning.create_plan", async (createPlanSpan) => {
      if (createPlanSpan) {
        createPlanSpan.setAttribute("agent.planning.plan.executed", isComplexTask);
        createPlanSpan.setAttribute("agent.planning.plan.is_complex_task", isComplexTask);
      }

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

        if (createPlanSpan) {
          createPlanSpan.setAttribute("agent.planning.plan.has_initial_steps", !!planDecision.tool_input.plan_steps);
          createPlanSpan.setAttribute("agent.planning.plan.initial_steps_count", planDecision.tool_input.plan_steps?.length || 0);
          createPlanSpan.setAttribute("agent.planning.plan.has_project_context", !!planDecision.tool_input.project_context);
        }
        await handleCreatePlan(
          planDecision,
          transcript,
          logConfig,
          opts?.aiProvider
        );
      } else {
        log(logConfig, "step", "Simple task detected, skipping execution plan creation");
        if (createPlanSpan) {
          createPlanSpan.setAttribute("agent.planning.plan.skip_reason", "task_not_complex");
          createPlanSpan.setAttribute("agent.planning.plan.user_goal_length", userGoal.length);
        }
        if (planningSpan) {
          planningSpan.setAttribute("agent.planning.plan_created", false);
          planningSpan.setAttribute("agent.planning.skip_reason", "task_not_complex");
        }
      }
    });

    if (planningSpan) {
      planningSpan.setAttribute("agent.planning.completed", true);
    }
  });

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
      const systemMessage = transcript.find((m) => m.role === "system");
      const userMessages = transcript.filter((m) => m.role !== "system");
      
      decisionResp = await withSpan("ai.call", async (span) => {
        if (span) {
          span.setAttribute("ai.step", step);
          span.setAttribute("ai.max_steps", maxSteps);
          span.setAttribute("ai.provider", opts?.aiProvider || "openai");
          span.setAttribute("ai.model", opts?.aiModel || "default");
          span.setAttribute("ai.transcript_length", transcript.length);
          span.setAttribute("ai.message_count", transcript.length);
          span.setAttribute("ai.system_prompt_length", systemMessage?.content.length || 0);
          span.setAttribute("ai.system_prompt_preview", systemMessage?.content.substring(0, 500) || "");
          span.setAttribute("ai.user_goal", transcript.find((m) => m.role === "user")?.content.substring(0, 200) || "");
          span.setAttribute("ai.schema_type", "DecisionSchema");
          span.setAttribute("ai.max_retries", 3);
          span.setAttribute("ai.timeout_ms", 120000);
          span.setAttribute("ai.truncate_transcript", true);
          span.setAttribute("agent.writes", writes);
          span.setAttribute("agent.cmds", cmds);
        }
        const result = await makeAICallWithSchema(transcript, DecisionSchema, logConfig, {
          maxRetries: 3,
          timeoutMs: 120000, // 2 minutes
          truncateTranscript: true,
          provider: opts?.aiProvider,
          model: opts?.aiModel,
          span, // Pass span to makeAICall
        });
        if (span && result.usage) {
          span.setAttribute("ai.tokens.input", result.usage.prompt_tokens || 0);
          span.setAttribute("ai.tokens.output", result.usage.completion_tokens || 0);
          span.setAttribute("ai.tokens.total", result.usage.total_tokens || 0);
        }
        if (span && result.choices?.[0]?.message?.content) {
          const content = result.choices[0].message.content;
          span.setAttribute("ai.response.length", content.length);
          span.setAttribute("ai.response.preview", content.substring(0, 500));
        }
        return result;
      });
    } catch (error) {
      await logError(logConfig, "AI API call failed after all retries", error);

      // Get token statistics even on error
      const tokenStats = getTokenStats();

      // Display token summary even on error
      displayTokenSummary(tokenStats);

      // Error is already recorded by withSpan's error handling and logError
      // Add error info to agent.run span via a nested span
      await withSpan("agent.error", async (errorSpan) => {
        if (errorSpan) {
          errorSpan.setAttribute("agent.error.step", step);
          errorSpan.setAttribute("agent.error.type", "ai_call_failed");
          errorSpan.setAttribute("agent.error.message", String(error));
          errorSpan.setAttribute("agent.error.total_tokens", tokenStats.totalTokens);
          errorSpan.setAttribute("agent.error.total_calls", tokenStats.totalCalls);
          if (error instanceof Error) {
            errorSpan.recordException?.(error);
          }
        }
      });

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
      await logError(logConfig, "Failed to parse LLM response as JSON", error, {
        rawContent:
          rawContent.substring(0, 500) + (rawContent.length > 500 ? "..." : ""),
        contentLength: rawContent.length,
      });
      
      await recordErrorSpan(error, "parse_llm_response", {
        step,
        contentLength: rawContent.length,
        rawContentPreview: rawContent.substring(0, 500),
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

    // Trace the decision made
    await withSpan("agent.decision", async (span) => {
      if (span) {
        span.setAttribute("agent.step", step);
        span.setAttribute("agent.decision.action", decision.action);
        span.setAttribute("agent.decision.rationale", decision.rationale || "");
        if (decision.action !== "final_answer" && decision.tool_input) {
          span.setAttribute("agent.decision.tool_input", JSON.stringify(decision.tool_input));
        }
        span.setAttribute("agent.writes", writes);
        span.setAttribute("agent.cmds", cmds);
      }
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

        final = await withSpan("ai.summary", async (span) => {
          if (span) {
            span.setAttribute("ai.summary.step", step);
            span.setAttribute("ai.summary.provider", opts?.aiProvider || "openai");
            span.setAttribute("ai.summary.model", opts?.aiModel || "default");
            span.setAttribute("ai.summary.message_count", summaryMessages.length);
            span.setAttribute("ai.summary.max_retries", 2);
            span.setAttribute("ai.summary.timeout_ms", 60000);
            span.setAttribute("ai.summary.truncate_transcript", false);
            span.setAttribute("agent.total_steps", step);
            span.setAttribute("agent.final_writes", writes);
            span.setAttribute("agent.final_cmds", cmds);
          }
          const result = await makeAICallWithSchema(
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
              span, // Pass span to makeAICall
            }
          );
          if (span && result.usage) {
            span.setAttribute("ai.summary.tokens.input", result.usage.prompt_tokens || 0);
            span.setAttribute("ai.summary.tokens.output", result.usage.completion_tokens || 0);
            span.setAttribute("ai.summary.tokens.total", result.usage.total_tokens || 0);
          }
          if (span && result.choices?.[0]?.message?.content) {
            const summary = result.choices[0].message.content;
            span.setAttribute("ai.summary.response.length", summary.length);
            span.setAttribute("ai.summary.response.preview", summary.substring(0, 500));
          }
          return result;
        });
      } catch (summaryError) {
        await logError(
          logConfig,
          "Failed to generate summary, using default",
          summaryError
        );
        
        await recordErrorSpan(summaryError, "generate_summary", {
          step,
          tool: "ai.summary",
        });
        
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

      if (span) {
        span.setAttribute("agent.completed", true);
        span.setAttribute("agent.reason", "final_answer");
        span.setAttribute("agent.final_steps", step);
        span.setAttribute("agent.final_writes", writes);
        span.setAttribute("agent.final_cmds", cmds);
        span.setAttribute("agent.total_tokens", tokenStats.totalTokens);
        span.setAttribute("agent.total_calls", tokenStats.totalCalls);
      }

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
      await handleCreatePlan(decision, transcript, logConfig, opts?.aiProvider);
      continue;
    }

    if (decision.action === "analyze_project") {
      await handleAnalyzeProject(
        decision,
        transcript,
        logConfig,
        opts?.aiProvider
      );
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
    
    if (span) {
      span.setAttribute("agent.completed", false);
      span.setAttribute("agent.reason", "max_steps_reached");
      span.setAttribute("agent.final_writes", writes);
      span.setAttribute("agent.final_cmds", cmds);
      const tokenStats = getTokenStats();
      span.setAttribute("agent.total_tokens", tokenStats.totalTokens);
      span.setAttribute("agent.total_calls", tokenStats.totalCalls);
    }
    
    return result;
  });
}
