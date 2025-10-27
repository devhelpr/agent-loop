import { z } from "zod";

export const DecisionSchema = z
  .object({
    action: z
      .enum([
        "read_files",
        "search_repo",
        "write_patch",
        "run_cmd",
        "evaluate_work",
        "final_answer",
      ])
      .describe("The action to take"),
    tool_input: z
      .object({
        paths: z
          .array(z.string())
          .optional()
          .describe("File paths for read_files action"),
        query: z
          .string()
          .optional()
          .describe("Search query for search_repo action"),
        patch: z
          .string()
          .optional()
          .describe("Patch content for write_patch action"),
        cmd: z
          .string()
          .optional()
          .describe("Command to run for run_cmd action"),
        args: z
          .array(z.string())
          .optional()
          .describe("Command arguments for run_cmd action"),
        timeoutMs: z
          .number()
          .optional()
          .describe("Timeout in milliseconds for run_cmd action"),
        files: z
          .array(z.string())
          .optional()
          .describe("Files to evaluate for evaluate_work action"),
        criteria: z
          .string()
          .optional()
          .describe(
            "Specific criteria to evaluate against (e.g., 'styling', 'functionality', 'performance')"
          ),
      })
      .optional()
      .describe("Input parameters for the selected tool"),
    rationale: z
      .string()
      .optional()
      .describe("Brief explanation of why this action was chosen"),
  })
  .describe("AgentDecision");

export type Decision =
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
  | {
      action: "evaluate_work";
      tool_input: { files: string[]; criteria?: string };
      rationale?: string;
    }
  | { action: "final_answer"; rationale?: string };
