import { z } from "zod";

export const FileEvaluationSchema = z.object({
  overall_score: z
    .number()
    .min(0)
    .max(100)
    .describe("Overall quality score from 0-100"),
  strengths: z
    .array(z.string())
    .describe("List of code strengths and positive aspects"),
  improvements: z.array(z.string()).describe("List of areas for improvement"),
  specific_suggestions: z
    .array(
      z.object({
        line: z
          .number()
          .optional()
          .describe("Line number where the suggestion applies"),
        suggestion: z.string().describe("Specific improvement suggestion"),
        priority: z
          .enum(["low", "medium", "high"])
          .describe("Priority level of the suggestion"),
        category: z
          .string()
          .optional()
          .describe(
            "Category of the suggestion (e.g., 'accessibility', 'performance', 'security')"
          ),
      })
    )
    .describe(
      "Specific, actionable suggestions with line numbers and priorities"
    ),
  technical_analysis: z
    .object({
      code_complexity: z
        .enum(["low", "medium", "high"])
        .describe("Assessment of code complexity"),
      maintainability: z
        .enum(["excellent", "good", "fair", "poor"])
        .describe("Code maintainability assessment"),
      performance_impact: z
        .enum(["excellent", "good", "fair", "poor"])
        .describe("Performance impact assessment"),
      security_considerations: z
        .enum(["excellent", "good", "fair", "poor"])
        .describe("Security considerations assessment"),
    })
    .describe("Technical analysis of the code"),
  recommendations: z
    .array(z.string())
    .describe("High-level recommendations for improvement"),
});

export type FileEvaluation = z.infer<typeof FileEvaluationSchema>;
