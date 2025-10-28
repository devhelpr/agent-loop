import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { evaluate_work } from "../tools";
import { MessageArray } from "../types/handlers";

export async function handleEvaluateWork(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "evaluate_work") return;

  // Extract user's goal from transcript (first user message)
  const userGoal = transcript.find((msg) => msg.role === "user")?.content;

  // Extract plan context from transcript
  const planSummary = transcript.find(
    (msg) => msg.role === "assistant" && msg.content.startsWith("plan_summary:")
  )?.content;

  const analysisSummary = transcript.find(
    (msg) =>
      msg.role === "assistant" && msg.content.startsWith("analysis_summary:")
  )?.content;

  log(logConfig, "tool-call", "Executing evaluate_work", {
    files: decision.tool_input.files,
    criteria: decision.tool_input.criteria,
    hasUserGoal: !!userGoal,
    hasPlanContext: !!planSummary,
    hasAnalysisContext: !!analysisSummary,
  });

  let out;
  try {
    out = await evaluate_work(
      decision.tool_input.files ?? [],
      decision.tool_input.criteria,
      userGoal
    );
  } catch (error) {
    log(logConfig, "tool-error", "evaluate_work failed", {
      error: String(error),
      files: decision.tool_input.files,
    });

    // Return a default evaluation result when evaluation fails
    out = {
      evaluation: {
        overall_score: 0,
        strengths: [],
        improvements: ["Evaluation failed due to file access errors"],
        specific_suggestions: [
          {
            file: "evaluation",
            suggestion: "Fix file access issues and try evaluation again",
            priority: "high" as const,
          },
        ],
      },
      files_analyzed: [],
      criteria_used: decision.tool_input.criteria || "general",
    };
  }

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
- Criteria: ${out.criteria_used}${
    userGoal ? `\n- User's Goal: ${userGoal}` : ""
  }${planSummary ? `\n- Execution Plan: Available` : ""}${
    analysisSummary ? `\n- Project Analysis: Available` : ""
  }

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

IMPORTANT GUIDANCE:
- If the overall score is 70+ and the work meets the user's core requirements, consider final_answer
- Only make changes that directly address the user's original goal${
    userGoal ? `: "${userGoal}"` : ""
  }
- Always read files with read_files before making any modifications
- Focus on high-priority suggestions that align with the user's request
- Avoid making changes that deviate from the user's original intent
- The evaluation has been performed with the user's goal in mind - suggestions should be goal-aligned${
    planSummary
      ? "\n- Reference the execution plan to ensure you're following the structured approach"
      : ""
  }${
    analysisSummary
      ? "\n- Consider the project context and technology stack when implementing suggestions"
      : ""
  }
`;

  transcript.push({
    role: "assistant",
    content: `evaluation_summary:${summary}`,
  });
}
