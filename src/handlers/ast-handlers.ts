import { Decision, MessageArray } from "../types";
import { LogConfig, log } from "../utils/logging";
import { executeASTRefactor } from "../tools/ast-plan-builder";

export async function handleASTRefactor(
  decision: Decision,
  transcript: MessageArray,
  writes: number,
  caps: { maxWrites: number },
  logConfig: LogConfig
): Promise<number> {
  if (decision.action !== "ast_refactor") {
    throw new Error("Invalid decision type for AST refactor handler");
  }

  const { intent, tsConfigPath } = decision.tool_input;

  log(logConfig, "tool", "Executing AST refactor", {
    intent,
    tsConfigPath: tsConfigPath || "tsconfig.json",
  });

  try {
    // Execute the AST refactoring
    const results = await executeASTRefactor(intent, tsConfigPath);

    if (results.length === 0) {
      transcript.push({
        role: "assistant",
        content: `AST refactor completed but no changes were made. Intent: "${intent}"`,
      });
      return writes;
    }

    // Apply the generated diffs using write_patch
    for (const { filePath, diff } of results) {
      if (writes >= caps.maxWrites) {
        transcript.push({
          role: "assistant",
          content: `Reached maximum write limit (${caps.maxWrites}). AST refactor partially completed.`,
        });
        break;
      }

      // Use the existing write_patch functionality
      const { write_patch } = await import("../tools/file-operations");
      const patchResult = await write_patch(diff);

      if (patchResult.applied.length > 0) {
        writes++;
        log(logConfig, "tool", "Applied AST refactor diff", {
          file: filePath,
          applied: patchResult.applied,
        });
      }
    }

    const appliedFiles = results.map((r) => r.filePath).join(", ");
    transcript.push({
      role: "assistant",
      content: `AST refactor completed successfully. Applied changes to: ${appliedFiles}. Intent: "${intent}"`,
    });
  } catch (error) {
    const errorMessage = `AST refactor failed: ${error}`;
    log(logConfig, "error", errorMessage, { intent, error });

    transcript.push({
      role: "assistant",
      content: errorMessage,
    });
  }

  return writes;
}
