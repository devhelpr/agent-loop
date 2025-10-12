import { LogConfig, log, logError } from "../utils/logging";
import { DecisionSchema, Decision } from "../types/decision";
import {
  handleReadFiles,
  handleSearchRepo,
  handleWritePatch,
  handleRunCmd,
  handleEvaluateWork,
} from "../handlers";
import {
  makeOpenAICall,
  getTokenStats,
  resetTokenStats,
  displayTokenSummary,
} from "../ai/api-calls";
import { prompt } from "../ai/prompts";

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

  for (let step = 1; step <= maxSteps; step++) {
    log(logConfig, "step", `=== Step ${step}/${maxSteps} ===`, {
      writes,
      cmds,
    });
    log(logConfig, "transcript", "Current transcript length", {
      messageCount: transcript.length,
    });

    let decisionResp: Awaited<
      ReturnType<
        typeof import("../ai/openai-client").openai.chat.completions.create
      >
    >;

    try {
      decisionResp = await makeOpenAICall(
        transcript,
        DecisionSchema,
        logConfig,
        {
          maxRetries: 3,
          timeoutMs: 120000, // 2 minutes
          truncateTranscript: true,
        }
      );
    } catch (error) {
      logError(logConfig, "OpenAI API call failed after all retries", error);

      // Get token statistics even on error
      const tokenStats = getTokenStats();

      // Display token summary even on error
      displayTokenSummary(tokenStats);

      return {
        steps: step,
        message: `OpenAI API call failed at step ${step}: ${error}`,
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
      log(logConfig, "decision", "Raw response parsed", {
        parsed: parsed,
        contentLength: rawContent.length,
      });

      // Handle case where the decision is nested under properties
      if (parsed.properties?.action) {
        log(
          logConfig,
          "decision",
          "Decision found in properties, extracting..."
        );
        decision = {
          action: parsed.properties.action,
          tool_input: parsed.properties.tool_input || {},
          rationale: parsed.properties.rationale,
        } as Decision;
      } else if (parsed.action) {
        decision = parsed as Decision;
      } else {
        log(
          logConfig,
          "decision",
          "No action found in response, defaulting to final_answer"
        );
        decision = {
          action: "final_answer",
          rationale: "No valid action in response",
        } as Decision;
      }
    } catch (error) {
      logError(logConfig, "Failed to parse decision", error, { rawContent });
      // Default to final_answer if parsing fails
      decision = {
        action: "final_answer",
        rationale: "Parsing error occurred",
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

        final = await makeOpenAICall(
          summaryMessages,
          {
            name: "Summary",
            strict: false,
            schema: {
              type: "object",
              properties: { summary: { type: "string" } },
            },
          },
          logConfig,
          { maxRetries: 2, timeoutMs: 60000, truncateTranscript: false }
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
