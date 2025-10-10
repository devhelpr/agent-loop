// pnpm add openai execa fast-glob diff
import OpenAI from "openai";
import { execa } from "execa";
import * as fg from "fast-glob";
import { promises as fs } from "node:fs";
import * as path from "node:path";

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
  const files = await fg.glob(include, { ignore: exclude });
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

/** ---------- Agent loop helpers ---------- */

type MessageArray = Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

async function handleReadFiles(decision: Decision, transcript: MessageArray) {
  if (decision.action !== "read_files") return;

  const out = await read_files(decision.tool_input.paths ?? []);
  transcript.push({
    role: "assistant",
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
    transcript.push({ role: "assistant", content: `file:${file}\n${chunk}` });
  }
}

async function handleSearchRepo(decision: Decision, transcript: MessageArray) {
  if (decision.action !== "search_repo") return;

  const out = await search_repo(decision.tool_input.query);
  transcript.push({
    role: "assistant",
    content: `search_repo:${JSON.stringify(out)}`,
  });
}

async function handleWritePatch(
  decision: Decision,
  transcript: MessageArray,
  writes: number,
  caps: { maxWrites: number }
): Promise<number> {
  if (decision.action !== "write_patch") return writes;

  if (writes >= caps.maxWrites) {
    transcript.push({
      role: "assistant",
      content: `write_patch:ERROR: write cap exceeded`,
    });
    return writes;
  }

  const out = await write_patch(String(decision.tool_input.patch || ""));
  const newWrites = writes + 1;
  transcript.push({
    role: "assistant",
    content: `write_patch:${JSON.stringify(out)}`,
  });
  return newWrites;
}

async function handleRunCmd(
  decision: Decision,
  transcript: MessageArray,
  cmds: number,
  caps: { maxCmds: number },
  testCmd: { cmd: string; args?: string[] }
): Promise<number> {
  if (decision.action !== "run_cmd") return cmds;

  if (cmds >= caps.maxCmds) {
    transcript.push({
      role: "assistant",
      content: `run_cmd:ERROR: command cap exceeded`,
    });
    return cmds;
  }

  const { cmd, args = [], timeoutMs } = decision.tool_input;
  const out = await run_cmd(cmd, args, { timeoutMs });
  const newCmds = cmds + 1;
  transcript.push({
    role: "assistant",
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

  return newCmds;
}

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
    role: "system" | "user" | "assistant";
    content: string;
  };
  const transcript: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: userGoal },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    const decisionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: transcript,
      response_format: {
        type: "json_schema",
        json_schema: DecisionSchema,
      },
    });

    const d = JSON.parse(
      decisionResp.choices[0].message.content || "{}"
    ) as Decision;

    if (d.action === "final_answer") {
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
      return {
        steps: step,
        message: final.choices[0].message.content || "No response",
      };
    }

    // Execute appropriate tool handler
    if (d.action === "read_files") {
      await handleReadFiles(d, transcript);
      continue;
    }

    if (d.action === "search_repo") {
      await handleSearchRepo(d, transcript);
      continue;
    }

    if (d.action === "write_patch") {
      writes = await handleWritePatch(d, transcript, writes, caps);
      continue;
    }

    if (d.action === "run_cmd") {
      cmds = await handleRunCmd(d, transcript, cmds, caps, testCmd);
      continue;
    }

    // Unknown action
    transcript.push({
      role: "assistant",
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
