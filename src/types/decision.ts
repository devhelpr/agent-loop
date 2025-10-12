export const DecisionSchema = {
  name: "AgentDecision",
  strict: false,
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
          "evaluate_work",
          "final_answer",
        ],
        description: "The action to take",
      },
      tool_input: {
        type: "object",
        description: "Input parameters for the selected tool",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "File paths for read_files action",
          },
          query: {
            type: "string",
            description: "Search query for search_repo action",
          },
          patch: {
            type: "string",
            description: "Patch content for write_patch action",
          },
          cmd: {
            type: "string",
            description: "Command to run for run_cmd action",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Command arguments for run_cmd action",
          },
          timeoutMs: {
            type: "number",
            description: "Timeout in milliseconds for run_cmd action",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files to evaluate for evaluate_work action",
          },
          criteria: {
            type: "string",
            description:
              "Specific criteria to evaluate against (e.g., 'styling', 'functionality', 'performance')",
          },
        },
      },
      rationale: {
        type: "string",
        description: "Brief explanation of why this action was chosen",
      },
    },
    required: ["action"],
  },
} as const;

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
