import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { read_files, write_patch, generate_patch } from "../tools";
import { MessageArray } from "../types/handlers";

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

export async function handleGeneratePatch(
  decision: Decision,
  transcript: MessageArray,
  writes: number,
  caps: { maxWrites: number },
  logConfig: LogConfig
): Promise<number> {
  if (decision.action !== "generate_patch") return writes;

  if (writes >= caps.maxWrites) {
    log(logConfig, "tool-result", "generate_patch failed: cap exceeded", {
      writes,
      maxWrites: caps.maxWrites,
    });
    transcript.push({
      role: "assistant",
      content: `generate_patch:ERROR: write cap exceeded`,
    });
    return writes;
  }

  const instructions = decision.tool_input.instructions || [];
  log(logConfig, "tool-call", "Executing generate_patch", {
    instructionCount: instructions.length,
    instructions: instructions.map((i) => ({
      file: i.file,
      operation: i.operation,
    })),
  });

  try {
    const result = await generate_patch(instructions);

    if (result.success && result.patch) {
      // Apply the generated patch using the existing write_patch function
      const patchResult = await write_patch(result.patch);
      log(logConfig, "tool-result", "generate_patch completed", {
        generated: result,
        applied: patchResult,
      });

      const newWrites = writes + 1;
      transcript.push({
        role: "assistant",
        content: `generate_patch:${JSON.stringify({
          success: true,
          generated: result,
          applied: patchResult,
        })}`,
      });
      return newWrites;
    } else {
      log(logConfig, "tool-result", "generate_patch failed", result);
      transcript.push({
        role: "assistant",
        content: `generate_patch:${JSON.stringify(result)}`,
      });
      return writes;
    }
  } catch (error) {
    const errorResult = {
      success: false,
      error: `Failed to generate patch: ${error}`,
    };
    log(
      logConfig,
      "tool-result",
      "generate_patch failed with error",
      errorResult
    );
    transcript.push({
      role: "assistant",
      content: `generate_patch:${JSON.stringify(errorResult)}`,
    });
    return writes;
  }
}
