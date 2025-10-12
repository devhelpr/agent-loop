import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { read_files, write_patch } from "../tools";
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
