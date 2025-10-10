// pnpm add openai execa fast-glob diff
//
// Environment Variables for Logging:
// - AGENT_CONSOLE_LOGGING=false  : Disable console logging (default: true)
// - AGENT_FILE_LOGGING=true      : Enable file logging (default: false)
// - AGENT_LOG_FILE=path/to/log   : Log file path (default: agent-log.txt)
//
import OpenAI from "openai";
import { LogConfig, log } from "./logging.js";
import { DecisionSchema, Decision } from "./schema.js";
import {
  handleReadFiles,
  handleSearchRepo,
  handleWritePatch,
  handleRunCmd,
} from "./handlers.js";

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
You are a coding agent that iteratively edits a repository to satisfy the user's goal.
Rules:
- Prefer small, safe, incremental patches.
- Run linters/compilers/tests to validate progress (e.g., "npm test", "tsc -p .", "eslint .").
- Always keep edits minimal and reversible. Only modify necessary files.
- When tests pass (exit code 0), produce final_answer.
- Stop early if the requested change is fulfilled and validated.
- Never output source code directly in decisions; use write_patch with file blocks:
  === file:relative/path.ext ===
  <entire new file content>
  === end ===
- If you need context, call read_files or search_repo first.
- You MUST NOT loop forever; if blocked, propose a minimal failing test to clarify, then final_answer.

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

    log(logConfig, "step", "Making OpenAI API call...");

    let decisionResp: Awaited<
      ReturnType<typeof openai.chat.completions.create>
    >;
    try {
      // Add a timeout to the API call
      const apiCallPromise = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: transcript,
        response_format: {
          type: "json_schema",
          json_schema: DecisionSchema,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("OpenAI API call timeout after 30 seconds")),
          30000
        )
      );

      decisionResp = await Promise.race([apiCallPromise, timeoutPromise]);
      log(logConfig, "step", "OpenAI API call completed");
    } catch (error) {
      log(logConfig, "step", "OpenAI API call failed", {
        error: String(error),
      });
      // Return early with an error message
      return {
        steps: step,
        message: `OpenAI API call failed at step ${step}: ${error}`,
      };
    }

    const rawContent = decisionResp.choices[0].message.content || "{}";
    let d: Decision;

    try {
      const parsed = JSON.parse(rawContent);
      log(logConfig, "decision", "Raw response parsed", { parsed });

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
      log(logConfig, "decision", "Failed to parse decision", {
        rawContent,
        error,
      });
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
      const final = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          ...transcript,
          {
            role: "system",
            content:
              "Now summarize the changes made, current test status, and any follow-ups succinctly.",
          },
        ],
      });
      const result = {
        steps: step,
        message: final.choices[0].message.content || "No response",
      };
      log(logConfig, "step", "Agent completed successfully", result);
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

/** ---------- Example usage ----------
 * Goal: "Add a new utility `titleCase(s: string)` with tests, pass `npm test`,
 * and fix any TypeScript/ESLint errors encountered."
 */
runCodingAgent(
  "Create util/titleCase.ts and unit tests. Wire it in my-file.ts exports. Ensure `npm test` passes and `tsc -p .` has no errors. Keep changes minimal.",
  {
    logging: {
      enabled: true,
      logSteps: true,
      logToolCalls: true,
      logToolResults: true,
      logDecisions: true,
      logTranscript: false, // Set to true if you want to see full transcript
      fileLogging: {
        enabled: true,
        filePath: "agent-execution.log",
      },
    },
  }
)
  .then((r) => console.log("\n=== FINAL RESULT ===", r))
  .catch(console.error);
