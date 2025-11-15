import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { read_files, write_patch } from "../tools";
import { validatorRegistry } from "../tools/validation";
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

  // Safety check: warn if patch content seems incomplete or suspiciously short
  if (patchContent.length < 50) {
    log(
      logConfig,
      "tool-call",
      "WARNING: write_patch content is very short, may be incomplete",
      {
        patchLength: patchContent.length,
        patchPreview: patchContent,
      }
    );
  }

  log(logConfig, "tool-call", "Executing write_patch", {
    patchLength: patchContent.length,
    patchPreview:
      patchContent.substring(0, 200) + (patchContent.length > 200 ? "..." : ""),
  });

  const out = await write_patch(patchContent);
  log(logConfig, "tool-result", "write_patch completed", out);

  // Validate written files if they are JS/TS files
  if (out.success && out.files_written > 0) {
    const writtenFiles = Array.isArray(out.files_written)
      ? out.files_written
      : [];
    for (const filePath of writtenFiles) {
      if (validatorRegistry.getValidator(filePath)) {
        try {
          // Read the file content for validation
          const fileContent = await read_files([filePath]);
          const content = fileContent[filePath];

          if (content) {
            const validationResult = await validatorRegistry.validateFile(
              filePath,
              content
            );

            if (
              !validationResult.success &&
              validationResult.errors.length > 0
            ) {
              log(logConfig, "validation", "File validation found errors", {
                file: filePath,
                errorCount: validationResult.errors.length,
                errors: validationResult.errors.map(
                  (e) => `${e.line}:${e.column} ${e.message}`
                ),
              });

              // Add validation results to transcript
              transcript.push({
                role: "assistant",
                content: `validation_errors:${JSON.stringify({
                  file: filePath,
                  errors: validationResult.errors,
                  warnings: validationResult.warnings,
                })}`,
              });

              // Add formatted validation summary
              const validationSummary = `
VALIDATION ERRORS FOUND IN ${filePath}:
${validationResult.errors
  .map((e) => `- Line ${e.line}:${e.column} - ${e.message} (${e.code})`)
  .join("\n")}

${
  validationResult.warnings.length > 0
    ? `
WARNINGS:
${validationResult.warnings
  .map((w) => `- Line ${w.line}:${w.column} - ${w.message} (${w.code})`)
  .join("\n")}`
    : ""
}

IMPORTANT: These errors need to be fixed. Consider using write_patch to correct the issues.
`;

              transcript.push({
                role: "assistant",
                content: `validation_summary:${validationSummary}`,
              });
            } else if (validationResult.warnings.length > 0) {
              log(logConfig, "validation", "File validation found warnings", {
                file: filePath,
                warningCount: validationResult.warnings.length,
              });

              transcript.push({
                role: "assistant",
                content: `validation_warnings:${JSON.stringify({
                  file: filePath,
                  warnings: validationResult.warnings,
                })}`,
              });
            } else {
              log(logConfig, "validation", "File validation passed", {
                file: filePath,
              });
            }
          }
        } catch (validationError) {
          log(logConfig, "validation", "File validation failed", {
            file: filePath,
            error: String(validationError),
          });
        }
      }
    }
  }

  const newWrites = writes + 1;
  transcript.push({
    role: "assistant",
    content: `write_patch:${JSON.stringify(out)}`,
  });
  return newWrites;
}
