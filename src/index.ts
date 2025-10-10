import { LogConfig, log, logError } from "./logging.js";
import { DecisionSchema, Decision } from "./schema.js";
import {
  handleReadFiles,
  handleSearchRepo,
  handleWritePatch,
  handleRunCmd,
  handleEvaluateWork,
} from "./handlers.js";
import {
  makeOpenAICall,
  getTokenStats,
  resetTokenStats,
  displayTokenSummary,
} from "./makeOpenAICall.js";
import { openai } from "./openai.js";
import { prompt } from "./prompt.js";

console.log(
  "🚀 Starting agent - API key:",
  process.env.OPENAI_API_KEY ? "***set***" : "❌ NOT SET"
);
console.log(
  "📊 Environment - Console logging:",
  process.env.AGENT_CONSOLE_LOGGING || "default"
);
console.log(
  "📁 Environment - File logging:",
  process.env.AGENT_FILE_LOGGING || "default"
);

/** ---------- Agent loop ---------- */

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

  type Msg = {
    role: "system" | "user" | "assistant";
    content: string;
  };
  const transcript: Msg[] = [
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
      ReturnType<typeof openai.chat.completions.create>
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
    let d: Decision;

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
        d = {
          action: parsed.properties.action,
          tool_input: parsed.properties.tool_input || {},
          rationale: parsed.properties.rationale,
        } as Decision;
      } else if (parsed.action) {
        d = parsed as Decision;
      } else {
        log(
          logConfig,
          "decision",
          "No action found in response, defaulting to final_answer"
        );
        d = {
          action: "final_answer",
          rationale: "No valid action in response",
        } as Decision;
      }
    } catch (error) {
      logError(logConfig, "Failed to parse decision", error, { rawContent });
      // Default to final_answer if parsing fails
      d = {
        action: "final_answer",
        rationale: "Parsing error occurred",
      } as Decision;
    }

    log(logConfig, "decision", `Agent decided: ${d.action}`, { decision: d });

    if (d.action === "final_answer") {
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
    if (d.action === "read_files") {
      await handleReadFiles(d, transcript, logConfig);
      continue;
    }

    if (d.action === "search_repo") {
      await handleSearchRepo(d, transcript, logConfig);
      continue;
    }

    if (d.action === "write_patch") {
      writes = await handleWritePatch(d, transcript, writes, caps, logConfig);
      continue;
    }

    if (d.action === "run_cmd") {
      cmds = await handleRunCmd(d, transcript, cmds, caps, testCmd, logConfig);
      continue;
    }

    if (d.action === "evaluate_work") {
      await handleEvaluateWork(d, transcript, logConfig);
      continue;
    }

    // Unknown action
    log(logConfig, "step", "Unknown action encountered", {
      action: (d as any).action,
    });
    transcript.push({
      role: "assistant",
      content: `ERROR: Unknown action ${JSON.stringify(d)}`,
    });
  }

  const result = {
    steps: maxSteps,
    message: "Max steps reached without finalization.",
  };
  log(logConfig, "step", "Agent reached max steps without completion", result);
  return result;
}

//   "Create two files: 1) util/titleCase.ts with a titleCase function, and 2) my-file.ts that imports and exports the titleCase function. Both files should be created from scratch."
// "Create a my-website.html which is beautiful/modern/fancy/responsive and use vanilla CSS: let it tell a story about AI and the future. Add a style.css file and make it look great."
runCodingAgent(
  "Create a my-game.html which is an arcarde-style asteroids game and is retro.beautiful/modern/fancy/responsive and use vanilla CSS AND JS. Add game.css and game.js files and make it look great.  "
)
  .then((r) => {
    console.log("\n=== FINAL RESULT ===", r);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Agent execution failed:", error);
    process.exit(1);
  });
