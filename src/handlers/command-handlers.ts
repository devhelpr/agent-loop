import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { run_cmd } from "../tools";
import { MessageArray } from "../types/handlers";

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
