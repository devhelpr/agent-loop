import { promises as fs } from "node:fs";
import { makeAICall } from "../ai/api-calls";
import { getAIClient } from "../ai/ai-client";
import { htmlEvaluationPrompt } from "../ai/prompts/html-evaluation";
import { cssEvaluationPrompt } from "../ai/prompts/css-evaluation";
import { javascriptEvaluationPrompt } from "../ai/prompts/javascript-evaluation";
import { generalEvaluationPrompt } from "../ai/prompts/general-evaluation";
import {
  FileEvaluationSchema,
  type FileEvaluation,
} from "../ai/prompts/evaluation-schema";
import { LogConfig, log } from "../utils/logging";

export async function evaluate_work(
  files: string[],
  criteria?: string,
  userGoal?: string
): Promise<{
  evaluation: {
    overall_score: number;
    strengths: string[];
    improvements: string[];
    specific_suggestions: Array<{
      file: string;
      line?: number;
      suggestion: string;
      priority: "low" | "medium" | "high";
    }>;
  };
  files_analyzed: string[];
  criteria_used: string;
}> {
  const files_analyzed: string[] = [];
  const file_contents: Record<string, string> = {};

  // Read all specified files
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      file_contents[file] = content;
      files_analyzed.push(file);
    } catch (err) {
      console.log(`[DEBUG] Could not read file ${file}:`, err);
      // Continue processing other files even if one fails
    }
  }

  // If no files could be read, return a default evaluation
  if (files_analyzed.length === 0) {
    return {
      evaluation: {
        overall_score: 0,
        strengths: [],
        improvements: ["No files could be read for evaluation"],
        specific_suggestions: [
          {
            file: "evaluation",
            suggestion: "Ensure all specified files exist and are accessible",
            priority: "high" as const,
          },
        ],
      },
      files_analyzed: [],
      criteria_used: criteria || "general",
    };
  }

  // Analyze the files based on criteria
  let analysis;
  try {
    analysis = await analyzeFiles(
      file_contents,
      criteria || "general",
      userGoal
    );
  } catch (err) {
    console.log(`[DEBUG] Analysis failed:`, err);
    // Return a default analysis if the analysis function fails
    analysis = {
      overall_score: 50,
      strengths: ["Files were successfully read"],
      improvements: ["Analysis encountered an error"],
      specific_suggestions: [
        {
          file: "analysis",
          suggestion: "Review file contents for potential issues",
          priority: "medium" as const,
        },
      ],
    };
  }

  return {
    evaluation: analysis,
    files_analyzed,
    criteria_used: criteria || "general",
  };
}

async function analyzeFiles(
  file_contents: Record<string, string>,
  criteria: string,
  userGoal?: string
): Promise<{
  overall_score: number;
  strengths: string[];
  improvements: string[];
  specific_suggestions: Array<{
    file: string;
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }>;
}> {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const specific_suggestions: Array<{
    file: string;
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }> = [];

  let total_score = 0;
  let file_count = 0;

  // Create a default log config for LLM calls
  const logConfig: LogConfig = {
    enabled: true,
    logSteps: true,
    logToolCalls: false,
    logToolResults: false,
    logDecisions: false,
    logTranscript: false,
    logErrors: true,
    logPromptContext: false,
  };

  for (const [file, content] of Object.entries(file_contents)) {
    file_count++;

    try {
      // Get the appropriate prompt based on file type
      let prompt: string;
      if (file.endsWith(".html")) {
        prompt = htmlEvaluationPrompt;
      } else if (file.endsWith(".css")) {
        prompt = cssEvaluationPrompt;
      } else if (file.endsWith(".ts") || file.endsWith(".js")) {
        prompt = javascriptEvaluationPrompt;
      } else {
        prompt = generalEvaluationPrompt;
      }

      // Prepare the evaluation request
      const userContent = `Please evaluate the following ${
        file.split(".").pop()?.toUpperCase() || "file"
      } code:\n\nFile: ${file}\n\n${content}${
        userGoal
          ? `\n\nUSER'S ORIGINAL GOAL: ${userGoal}\n\nPlease ensure your evaluation focuses on how well this code fulfills the user's specific goal and only suggest changes that are necessary to achieve that goal.`
          : ""
      }`;

      const messages = [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: userContent,
        },
      ];

      // Make LLM call for evaluation
      const response = await makeAICall(
        messages,
        FileEvaluationSchema,
        logConfig,
        {
          maxRetries: 2,
          timeoutMs: 30000,
        }
      );

      if (response.choices && response.choices[0]?.message?.content) {
        const evaluation: FileEvaluation = JSON.parse(
          response.choices[0].message.content
        );

        // Aggregate results
        total_score += evaluation.overall_score;
        strengths.push(...evaluation.strengths);
        improvements.push(...evaluation.improvements);
        specific_suggestions.push(
          ...evaluation.specific_suggestions.map((s: any) => ({
            ...s,
            file,
            category: s.category,
          }))
        );
      } else {
        // Fallback to basic analysis if LLM call fails
        console.log(
          `[DEBUG] LLM evaluation failed for ${file}, using fallback analysis`
        );
        const fallbackAnalysis = getFallbackAnalysis(file, content);
        total_score += fallbackAnalysis.score;
        strengths.push(...fallbackAnalysis.strengths);
        improvements.push(...fallbackAnalysis.improvements);
        specific_suggestions.push(
          ...fallbackAnalysis.suggestions.map((s) => ({ ...s, file }))
        );
      }
    } catch (error) {
      console.log(`[DEBUG] Error evaluating ${file}:`, error);
      // Fallback to basic analysis
      const fallbackAnalysis = getFallbackAnalysis(file, content);
      total_score += fallbackAnalysis.score;
      strengths.push(...fallbackAnalysis.strengths);
      improvements.push(...fallbackAnalysis.improvements);
      specific_suggestions.push(
        ...fallbackAnalysis.suggestions.map((s) => ({ ...s, file }))
      );
    }
  }

  const overall_score =
    file_count > 0 ? Math.round(total_score / file_count) : 0;

  return {
    overall_score,
    strengths: [...new Set(strengths)], // Remove duplicates
    improvements: [...new Set(improvements)], // Remove duplicates
    specific_suggestions,
  };
}

function analyzeHTML(content: string, lines: string[]) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const suggestions: Array<{
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }> = [];
  let score = 50; // Base score

  // Check for DOCTYPE
  if (content.includes("<!DOCTYPE html>")) {
    strengths.push("Proper HTML5 DOCTYPE declaration");
    score += 10;
  } else {
    improvements.push("Add HTML5 DOCTYPE declaration");
    suggestions.push({
      suggestion: "Add <!DOCTYPE html> at the beginning",
      priority: "high",
    });
  }

  // Check for meta viewport
  if (content.includes("viewport")) {
    strengths.push("Responsive viewport meta tag present");
    score += 10;
  } else {
    improvements.push("Add responsive viewport meta tag");
    suggestions.push({
      suggestion:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      priority: "high",
    });
  }

  // Check for semantic HTML
  const semanticTags = [
    "header",
    "main",
    "section",
    "article",
    "nav",
    "footer",
    "aside",
  ];
  const foundSemantic = semanticTags.filter((tag) =>
    content.includes(`<${tag}`)
  );
  if (foundSemantic.length > 0) {
    strengths.push(`Uses semantic HTML tags: ${foundSemantic.join(", ")}`);
    score += foundSemantic.length * 5;
  } else {
    improvements.push("Use semantic HTML tags for better structure");
    suggestions.push({
      suggestion:
        "Replace div elements with semantic tags like header, main, section, footer",
      priority: "medium",
    });
  }

  // Check for accessibility
  if (content.includes("alt=") || content.includes("aria-")) {
    strengths.push("Includes accessibility attributes");
    score += 10;
  } else if (content.includes("<img")) {
    improvements.push("Add alt attributes to images for accessibility");
    suggestions.push({
      suggestion: "Add alt attributes to all img tags",
      priority: "medium",
    });
  }

  // Check for CSS link
  if (content.includes('<link rel="stylesheet"')) {
    strengths.push("Properly links to external CSS");
    score += 5;
  }

  return { score: Math.min(score, 100), strengths, improvements, suggestions };
}

function analyzeCSS(content: string, lines: string[]) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const suggestions: Array<{
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }> = [];
  let score = 50; // Base score

  // Check for responsive design
  if (content.includes("@media")) {
    strengths.push("Includes responsive design with media queries");
    score += 15;
  } else {
    improvements.push("Add responsive design with media queries");
    suggestions.push({
      suggestion: "Add @media queries for mobile and tablet breakpoints",
      priority: "high",
    });
  }

  // Check for modern CSS features
  if (
    content.includes("flexbox") ||
    content.includes("display: flex") ||
    content.includes("display: grid")
  ) {
    strengths.push("Uses modern CSS layout (flexbox/grid)");
    score += 10;
  } else {
    improvements.push("Consider using modern CSS layout methods");
    suggestions.push({
      suggestion: "Use flexbox or grid for better layout control",
      priority: "medium",
    });
  }

  // Check for CSS variables
  if (content.includes("--") && content.includes("var(")) {
    strengths.push("Uses CSS custom properties (variables)");
    score += 10;
  }

  // Check for hover effects
  if (content.includes(":hover")) {
    strengths.push("Includes interactive hover effects");
    score += 5;
  } else {
    improvements.push("Add hover effects for better interactivity");
    suggestions.push({
      suggestion: "Add :hover pseudo-classes for interactive elements",
      priority: "low",
    });
  }

  // Check for transitions/animations
  if (content.includes("transition") || content.includes("animation")) {
    strengths.push("Includes smooth transitions or animations");
    score += 10;
  }

  // Check for color scheme
  const colorCount = (content.match(/#[0-9a-fA-F]{3,6}/g) || []).length;
  if (colorCount > 3) {
    strengths.push("Uses a diverse color palette");
    score += 5;
  } else if (colorCount < 2) {
    improvements.push("Consider adding more colors to the design");
    suggestions.push({
      suggestion: "Add more colors to create visual hierarchy",
      priority: "low",
    });
  }

  return { score: Math.min(score, 100), strengths, improvements, suggestions };
}

function analyzeJavaScript(content: string, lines: string[]) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const suggestions: Array<{
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }> = [];
  let score = 50; // Base score

  // Check for TypeScript
  if (
    content.includes(": string") ||
    content.includes(": number") ||
    content.includes(": boolean")
  ) {
    strengths.push("Uses TypeScript type annotations");
    score += 15;
  }

  // Check for modern JavaScript features
  if (content.includes("const ") || content.includes("let ")) {
    strengths.push("Uses modern variable declarations");
    score += 5;
  }

  if (content.includes("=>")) {
    strengths.push("Uses arrow functions");
    score += 5;
  }

  if (content.includes("async") || content.includes("await")) {
    strengths.push("Uses async/await for asynchronous operations");
    score += 10;
  }

  // Check for error handling
  if (content.includes("try") && content.includes("catch")) {
    strengths.push("Includes proper error handling");
    score += 10;
  } else {
    improvements.push("Add error handling for robustness");
    suggestions.push({
      suggestion: "Wrap async operations in try-catch blocks",
      priority: "medium",
    });
  }

  // Check for comments
  const commentLines = lines.filter(
    (line) => line.trim().startsWith("//") || line.trim().startsWith("/*")
  ).length;
  if (commentLines > 0) {
    strengths.push("Includes code comments for documentation");
    score += 5;
  }

  return { score: Math.min(score, 100), strengths, improvements, suggestions };
}

function analyzeGeneral(content: string, lines: string[]) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const suggestions: Array<{
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }> = [];
  let score = 50; // Base score

  // Check for structure
  if (lines.length > 10) {
    strengths.push("File has substantial content");
    score += 10;
  }

  // Check for consistency
  const hasConsistentIndentation = lines.every(
    (line) =>
      line === "" ||
      line.startsWith("    ") ||
      line.startsWith("\t") ||
      !line.startsWith(" ")
  );
  if (hasConsistentIndentation) {
    strengths.push("Consistent indentation throughout");
    score += 10;
  } else {
    improvements.push("Improve indentation consistency");
    suggestions.push({
      suggestion: "Use consistent indentation (spaces or tabs)",
      priority: "low",
    });
  }

  return { score: Math.min(score, 100), strengths, improvements, suggestions };
}

// Fallback analysis function for when LLM evaluation fails
function getFallbackAnalysis(
  file: string,
  content: string
): {
  score: number;
  strengths: string[];
  improvements: string[];
  suggestions: Array<{
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }>;
} {
  const lines = content.split("\n");

  // Use the existing analysis functions as fallback
  if (file.endsWith(".html")) {
    return analyzeHTML(content, lines);
  } else if (file.endsWith(".css")) {
    return analyzeCSS(content, lines);
  } else if (file.endsWith(".ts") || file.endsWith(".js")) {
    return analyzeJavaScript(content, lines);
  } else {
    return analyzeGeneral(content, lines);
  }
}
