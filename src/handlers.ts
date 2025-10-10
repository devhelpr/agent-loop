import { Decision } from "./schema.js";
import { LogConfig, log } from "./logging.js";
import {
  read_files,
  search_repo,
  write_patch,
  run_cmd,
  evaluate_work,
} from "./tooling.js";

export type MessageArray = Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

export async function handleReadFiles(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "read_files") return;

  log(logConfig, "tool-call", "Executing read_files", {
    paths: decision.tool_input.paths,
  });
  const out = await read_files(decision.tool_input.paths ?? []);
  log(logConfig, "tool-result", "read_files completed", {
    fileCount: Object.keys(out).length,
    totalBytes: Object.values(out).reduce(
      (sum, content) => sum + content.length,
      0
    ),
  });
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

export async function handleSearchRepo(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "search_repo") return;

  log(logConfig, "tool-call", "Executing search_repo", {
    query: decision.tool_input.query,
  });
  const out = await search_repo(decision.tool_input.query);
  log(logConfig, "tool-result", "search_repo completed", {
    hitCount: out.hits.length,
  });
  transcript.push({
    role: "assistant",
    content: `search_repo:${JSON.stringify(out)}`,
  });
}

export async function handleWritePatch(
  decision: Decision,
  transcript: MessageArray,
  writes: number,
  caps: { maxWrites: number },
  logConfig: LogConfig
): Promise<number> {
  if (decision.action !== "write_patch") return writes;

  if (writes >= caps.maxWrites) {
    log(logConfig, "tool-result", "write_patch failed: cap exceeded", {
      writes,
      maxWrites: caps.maxWrites,
    });
    transcript.push({
      role: "assistant",
      content: `write_patch:ERROR: write cap exceeded`,
    });
    return writes;
  }

  const patchContent = String(decision.tool_input.patch || "");
  log(logConfig, "tool-call", "Executing write_patch", {
    patchLength: patchContent.length,
    patchPreview:
      patchContent.substring(0, 200) + (patchContent.length > 200 ? "..." : ""),
  });
  const out = await write_patch(patchContent);
  log(logConfig, "tool-result", "write_patch completed", out);
  const newWrites = writes + 1;
  transcript.push({
    role: "assistant",
    content: `write_patch:${JSON.stringify(out)}`,
  });
  return newWrites;
}

export async function handleRunCmd(
  decision: Decision,
  transcript: MessageArray,
  cmds: number,
  caps: { maxCmds: number },
  testCmd: { cmd: string; args?: string[] },
  logConfig: LogConfig
): Promise<number> {
  if (decision.action !== "run_cmd") return cmds;

  if (cmds >= caps.maxCmds) {
    log(logConfig, "tool-result", "run_cmd failed: cap exceeded", {
      cmds,
      maxCmds: caps.maxCmds,
    });
    transcript.push({
      role: "assistant",
      content: `run_cmd:ERROR: command cap exceeded`,
    });
    return cmds;
  }

  const { cmd, args = [], timeoutMs } = decision.tool_input;
  log(logConfig, "tool-call", "Executing run_cmd", { cmd, args, timeoutMs });
  const out = await run_cmd(cmd, args, { timeoutMs });
  log(logConfig, "tool-result", "run_cmd completed", {
    ok: out.ok,
    code: out.code,
    stdoutLength: out.stdout.length,
    stderrLength: out.stderr.length,
  });
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

export async function handleEvaluateWork(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "evaluate_work") return;

  log(logConfig, "tool-call", "Executing evaluate_work", {
    files: decision.tool_input.files,
    criteria: decision.tool_input.criteria,
  });

  const out = await evaluate_work(
    decision.tool_input.files ?? [],
    decision.tool_input.criteria
  );

  log(logConfig, "tool-result", "evaluate_work completed", {
    filesAnalyzed: out.files_analyzed.length,
    overallScore: out.evaluation.overall_score,
    strengthsCount: out.evaluation.strengths.length,
    improvementsCount: out.evaluation.improvements.length,
    suggestionsCount: out.evaluation.specific_suggestions.length,
  });

  // Add evaluation results to transcript
  transcript.push({
    role: "assistant",
    content: `evaluate_work:${JSON.stringify({
      files_analyzed: out.files_analyzed,
      criteria_used: out.criteria_used,
      overall_score: out.evaluation.overall_score,
      strengths: out.evaluation.strengths,
      improvements: out.evaluation.improvements,
      specific_suggestions: out.evaluation.specific_suggestions,
    })}`,
  });

  // Add a formatted summary for the model to understand
  const summary = `
EVALUATION SUMMARY:
- Overall Score: ${out.evaluation.overall_score}/100
- Files Analyzed: ${out.files_analyzed.join(", ")}
- Criteria: ${out.criteria_used}

STRENGTHS:
${out.evaluation.strengths.map((s) => `✓ ${s}`).join("\n")}

IMPROVEMENTS NEEDED:
${out.evaluation.improvements.map((i) => `⚠ ${i}`).join("\n")}

SPECIFIC SUGGESTIONS:
${out.evaluation.specific_suggestions
  .map(
    (s) =>
      `📝 ${s.file}${s.line ? `:${s.line}` : ""} - ${s.suggestion} (${
        s.priority
      } priority)`
  )
  .join("\n")}
`;

  transcript.push({
    role: "assistant",
    content: `evaluation_summary:${summary}`,
  });
}
