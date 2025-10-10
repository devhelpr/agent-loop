// pnpm add openai execa fast-glob diff
import OpenAI from "openai";
import { execa } from "execa";
import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import { ResponseInputItem } from "openai/resources/responses/responses.mjs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ---------- Tooling layer ---------- */

async function read_files(paths: string[]) {
  const results: Record<string, string> = {};
  for (const p of paths) {
    const full = path.resolve(p);
    try {
      results[p] = await fs.readFile(full, "utf8");
    } catch {
      /* ignore */
    }
  }
  return results;
}

async function search_repo(
  query: string,
  include = ["**/*.{ts,tsx,js,json,md}"],
  exclude = ["**/node_modules/**", "**/dist/**"]
) {
  const files = await fg(include, { ignore: exclude });
  const hits: Array<{ file: string; line: number; snippet: string }> = [];
  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        hits.push({ file: f, line: i + 1, snippet: line.trim().slice(0, 400) });
      }
    });
  }
  return { query, hits: hits.slice(0, 60) };
}

// Minimal unified diff applier (file-by-file full replacement fallback if needed)
async function write_patch(patch: string) {
  // Accepts diffs in the form of multiple files with "+++ b/..." and "--- a/..."
  // For brevity, support a safer “full file propose” format too:
  // === file:path ===\n<new file content>\n=== end ===
  const replaced: string[] = [];
  const blocks = patch.split("\n=== file:").slice(1);
  if (blocks.length) {
    for (const blk of blocks) {
      const [header, ...rest] = blk.split("\n");
      const file = header.trim();
      const body = rest.join("\n").replace(/\n=== end ===\s*$/m, "");
      await fs.writeFile(file, body, "utf8");
      replaced.push(file);
    }
    return { applied: replaced, mode: "full-file" };
  }
  // (You can extend this with proper unified diff parsing if you like.)
  return { applied: [], mode: "none", error: "No recognized patch blocks" };
}

async function run_cmd(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number } = {}
) {
  try {
    const res = await execa(cmd, args, { timeout: opts.timeoutMs ?? 120_000 });
    return {
      ok: true,
      code: 0,
      stdout: res.stdout.slice(0, 100_000),
      stderr: res.stderr.slice(0, 50_000),
    };
  } catch (err: any) {
    return {
      ok: false,
      code: err.exitCode ?? 1,
      stdout: err.stdout?.slice?.(0, 100_000) ?? "",
      stderr: err.stderr?.slice?.(0, 100_000) ?? String(err),
    };
  }
}

/** ---------- Decision schema ---------- */

const DecisionSchema = {
  name: "AgentDecision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [
          "read_files",
          "search_repo",
          "write_patch",
          "run_cmd",
          "final_answer",
        ],
      },
      tool_input: { type: "object" },
      rationale: { type: "string" }, // short, for logs
    },
    required: ["action"],
  },
} as const;

type Decision =
  | {
      action: "read_files";
      tool_input: { paths: string[] };
      rationale?: string;
    }
  | { action: "search_repo"; tool_input: { query: string }; rationale?: string }
  | { action: "write_patch"; tool_input: { patch: string }; rationale?: string }
  | {
      action: "run_cmd";
      tool_input: { cmd: string; args?: string[]; timeoutMs?: number };
      rationale?: string;
    }
  | { action: "final_answer"; rationale?: string };

/** ---------- Agent loop ---------- */

export async function runCodingAgent(
  userGoal: string,
  opts?: {
    maxSteps?: number;
    testCommand?: { cmd: string; args?: string[] };
    hardCaps?: { maxWrites?: number; maxCmds?: number };
  }
) {
  const maxSteps = opts?.maxSteps ?? 20;
  const testCmd = opts?.testCommand ?? {
    cmd: "npm",
    args: ["test", "--silent"],
  };
  const caps = { maxWrites: 10, maxCmds: 20, ...(opts?.hardCaps ?? {}) };
  let writes = 0,
    cmds = 0;

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
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  };
  const transcript: ResponseInputItem[] = [
    { role: "system", content: system },
    { role: "user", content: userGoal },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    const decisionResp = await openai.responses.create({
      model: "gpt-4.1-mini",

      input: transcript,
      response_format: DecisionSchema,
    });

    const d = decisionResp.output[0].content[0].json as Decision;

    if (d.action === "final_answer") {
      // Produce a succinct status + next steps for the user
      const final = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          ...transcript,
          {
            role: "system",
            content:
              "Now summarize the changes made, current test status, and any follow-ups succinctly.",
          },
        ],
      });
      return { steps: step, message: final.output_text };
    }

    // Execute tool
    if (d.action === "read_files") {
      const out = await read_files(d.tool_input.paths ?? []);
      transcript.push({
        role: "tool",
        content: `read_files:${JSON.stringify({
          paths: Object.keys(out),
          bytes: Object.fromEntries(
            Object.entries(out).map(([k, v]) => [k, v.length])
          ),
        })}`,
      });
      // Add a trimmed payload for the model to actually read
      for (const [file, text] of Object.entries(out)) {
        const chunk = text.slice(0, 40_000); // token guard
        transcript.push({ role: "tool", content: `file:${file}\n${chunk}` });
      }
      continue;
    }

    if (d.action === "search_repo") {
      const out = await search_repo(d.tool_input.query);
      transcript.push({
        role: "tool",
        content: `search_repo:${JSON.stringify(out)}`,
      });
      continue;
    }

    if (d.action === "write_patch") {
      if (writes >= caps.maxWrites) {
        transcript.push({
          role: "tool",
          content: `write_patch:ERROR: write cap exceeded`,
        });
        continue;
      }
      const out = await write_patch(String(d.tool_input.patch || ""));
      writes++;
      transcript.push({
        role: "tool",
        content: `write_patch:${JSON.stringify(out)}`,
      });
      continue;
    }

    if (d.action === "run_cmd") {
      if (cmds >= caps.maxCmds) {
        transcript.push({
          role: "tool",
          content: `run_cmd:ERROR: command cap exceeded`,
        });
        continue;
      }
      const { cmd, args = [], timeoutMs } = d.tool_input;
      const out = await run_cmd(cmd, args, { timeoutMs });
      cmds++;
      transcript.push({
        role: "tool",
        content: `run_cmd:${JSON.stringify({ cmd, args, ...out })}`,
      });

      // If the command was a test run and it passed, we can suggest finalizing next step
      if (
        cmd === testCmd.cmd &&
        JSON.stringify(args) === JSON.stringify(testCmd.args) &&
        out.ok
      ) {
        transcript.push({ role: "assistant", content: `Tests passed.` });
      }
      continue;
    }

    // Unknown action
    transcript.push({
      role: "tool",
      content: `ERROR: Unknown action ${JSON.stringify(d)}`,
    });
  }

  return {
    steps: maxSteps,
    message: "Max steps reached without finalization.",
  };
}

/** ---------- Example usage ----------
 * Goal: “Add a new utility `titleCase(s: string)` with tests, pass `npm test`,
 * and fix any TypeScript/ESLint errors encountered.”
 */
runCodingAgent(
  "Create util/titleCase.ts and unit tests. Wire it in my-file.ts exports. Ensure `npm test` passes and `tsc -p .` has no errors. Keep changes minimal."
)
  .then((r) => console.log(r))
  .catch(console.error);
