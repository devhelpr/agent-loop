import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { parsePatch, applyPatch } from "diff";

// Manual patch application for when the diff library fails
async function applyPatchManually(
  originalContent: string,
  parsedPatch: any
): Promise<string | null> {
  try {
    const lines = originalContent.split("\n");
    let result = [...lines];

    // Process each hunk in the patch
    for (const hunk of parsedPatch.hunks || []) {
      const oldStart = hunk.oldStart - 1; // Convert to 0-based index
      const oldLines = hunk.oldLines;
      const newStart = hunk.newStart - 1; // Convert to 0-based index
      const newLines = hunk.newLines;

      console.log(
        `[DEBUG] Manual patch: oldStart=${oldStart}, oldLines=${oldLines}, newStart=${newStart}, newLines=${newLines}`
      );

      // Validate bounds
      if (oldStart < 0 || oldStart >= result.length) {
        console.log(
          `[DEBUG] Invalid oldStart position: ${oldStart}, file length: ${result.length}`
        );
        continue;
      }

      // Remove old lines
      if (oldLines > 0) {
        const endIndex = Math.min(oldStart + oldLines, result.length);
        result.splice(oldStart, endIndex - oldStart);
      }

      // Add new lines
      const newContent = hunk.lines
        .filter((line: string) => line.startsWith("+"))
        .map((line: string) => line.substring(1));

      if (newContent.length > 0) {
        result.splice(oldStart, 0, ...newContent);
      }
    }

    return result.join("\n");
  } catch (err) {
    console.log("[DEBUG] Manual patch application failed:", err);
    return null;
  }
}

// Enhanced diff parsing that can handle more edge cases
function parseDiffPatch(patchContent: string): any[] {
  try {
    // Try the standard diff library first
    return parsePatch(patchContent);
  } catch (err) {
    console.log("[DEBUG] Standard diff parsing failed, trying manual parsing");

    // Manual parsing for edge cases
    const patches = [];
    const lines = patchContent.split("\n");
    let currentPatch: any = null;
    let currentHunk: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Start of a new patch
      if (line.startsWith("--- a/")) {
        if (currentPatch) patches.push(currentPatch);
        currentPatch = {
          oldFileName: line.substring(6),
          newFileName: "",
          hunks: [],
        };
      } else if (line.startsWith("+++ b/")) {
        if (currentPatch) {
          currentPatch.newFileName = line.substring(6);
        }
      } else if (line.startsWith("@@")) {
        // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match && currentPatch) {
          currentHunk = {
            oldStart: parseInt(match[1]),
            oldLines: parseInt(match[2]) || 0,
            newStart: parseInt(match[3]),
            newLines: parseInt(match[4]) || 0,
            lines: [],
          };
          currentPatch.hunks.push(currentHunk);
        }
      } else if (
        currentHunk &&
        (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
      ) {
        currentHunk.lines.push(line);
      }
    }

    if (currentPatch) patches.push(currentPatch);
    return patches;
  }
}

export async function read_files(paths: string[]) {
  const results: Record<string, string> = {};
  for (const p of paths) {
    const full = path.resolve(p);
    try {
      results[p] = await fs.readFile(full, "utf8");
    } catch {
      /* ignore */
    }
  }
  return results;
}

export async function search_repo(
  query: string,
  include = ["**/*.{ts,tsx,js,json,md}"],
  exclude = ["**/node_modules/**", "**/dist/**"]
) {
  const files = await fg(include, { ignore: exclude });
  const hits: Array<{ file: string; line: number; snippet: string }> = [];
  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        hits.push({ file: f, line: i + 1, snippet: line.trim().slice(0, 400) });
      }
    });
  }
  return { query, hits: hits.slice(0, 60) };
}

export async function write_patch(patch: string) {
  const replaced: string[] = [];

  // Unescape newlines and other escape sequences
  const unescapedPatch = patch
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

  console.log(
    "[DEBUG] write_patch - patch preview:",
    unescapedPatch.substring(0, 100)
  );

  // Try to parse as unified diff format first
  try {
    const parsedPatches = parseDiffPatch(unescapedPatch);
    console.log(
      "[DEBUG] Parsed as unified diff, patches found:",
      parsedPatches.length
    );

    if (parsedPatches.length > 0) {
      // Apply each parsed patch
      for (const parsedPatch of parsedPatches) {
        // Extract filename from the patch (prefer newFileName, fall back to oldFileName)
        let file = parsedPatch.newFileName || parsedPatch.oldFileName || "";

        // Remove common prefixes like "a/" or "b/"
        file = file.replace(/^[ab]\//, "");

        if (!file) {
          console.log("[DEBUG] Skipping patch with no filename");
          continue;
        }

        console.log(`[DEBUG] Applying diff patch to file: "${file}"`);

        // Read the current file content (if it exists)
        let originalContent = "";
        try {
          originalContent = await fs.readFile(file, "utf8");
        } catch (err) {
          // File doesn't exist, try to create it if the patch is adding content
          console.log(
            `[DEBUG] File "${file}" doesn't exist, treating as empty`
          );
        }

        // Apply the patch
        const result = applyPatch(originalContent, parsedPatch);

        if (result === false) {
          console.log(
            `[DEBUG] Failed to apply patch to "${file}", trying manual diff application`
          );
          // Try to apply the patch manually by parsing the hunks
          const manualResult = await applyPatchManually(
            originalContent,
            parsedPatch
          );
          if (manualResult !== null) {
            // Create directory if it doesn't exist
            const dir = path.dirname(file);
            if (dir !== "." && dir !== "") {
              console.log(`[DEBUG] Creating directory: "${dir}"`);
              await fs.mkdir(dir, { recursive: true });
            }

            // Write the patched content
            console.log(`[DEBUG] Writing manually patched file: "${file}"`);
            await fs.writeFile(file, manualResult, "utf8");
            replaced.push(file);
          } else {
            console.log(
              `[DEBUG] Manual patch application also failed for "${file}"`
            );
          }
          continue;
        }

        // Create directory if it doesn't exist
        const dir = path.dirname(file);
        if (dir !== "." && dir !== "") {
          console.log(`[DEBUG] Creating directory: "${dir}"`);
          await fs.mkdir(dir, { recursive: true });
        }

        // Write the patched content
        console.log(`[DEBUG] Writing patched file: "${file}"`);
        await fs.writeFile(file, result, "utf8");
        replaced.push(file);
      }

      if (replaced.length > 0) {
        return { applied: replaced, mode: "diff" };
      }
    }
  } catch (err) {
    console.log(
      "[DEBUG] Not a unified diff patch, trying full-file format:",
      err
    );
  }

  // Fall back to full-file format
  // Split on === file: at the beginning of lines or at the start
  const blocks = unescapedPatch.split(/(?:^|\n)=== file:/);

  console.log("[DEBUG] write_patch - full-file blocks found:", blocks.length);

  if (blocks.length > 1) {
    // Skip the first empty block
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      console.log(
        `[DEBUG] Processing full-file block ${i}:`,
        block.substring(0, 50) + "..."
      );

      const lines = block.split("\n");
      const filePathLine = lines[0];

      // Extract filename, handling cases like "path/file.ts ==="
      const file = filePathLine.replace(/\s*===\s*$/, "").trim();
      console.log(`[DEBUG] Extracted filename: "${file}"`);

      // Extract content between header and end marker more carefully
      const endMarkerIndex = block.indexOf("=== end ===");
      let body: string;

      if (endMarkerIndex === -1) {
        // No end marker found, take everything after the first line
        body = lines.slice(1).join("\n");
      } else {
        // Extract content before the end marker
        const contentBeforeEnd = block.substring(
          lines[0].length,
          endMarkerIndex
        );
        // Remove leading newline if present (from the header line)
        body = contentBeforeEnd.startsWith("\n")
          ? contentBeforeEnd.substring(1)
          : contentBeforeEnd;
        // The content should now preserve the original newline structure including trailing newlines
      }
      console.log(
        `[DEBUG] File content (${body.length} chars):`,
        body.substring(0, 100) + "..."
      );

      // Create directory if it doesn't exist
      const dir = path.dirname(file);
      if (dir !== "." && dir !== "") {
        console.log(`[DEBUG] Creating directory: "${dir}"`);
        await fs.mkdir(dir, { recursive: true });
      }

      // Write the file
      console.log(`[DEBUG] Writing file: "${file}"`);
      await fs.writeFile(file, body, "utf8");
      replaced.push(file);
    }
    return { applied: replaced, mode: "full-file" };
  }

  return { applied: [], mode: "none", error: "No recognized patch blocks" };
}

export async function run_cmd(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number } = {}
) {
  try {
    const res = await execa(cmd, args, { timeout: opts.timeoutMs ?? 120_000 });
    return {
      ok: true,
      code: 0,
      stdout: res.stdout.slice(0, 100_000),
      stderr: res.stderr.slice(0, 50_000),
    };
  } catch (err: any) {
    return {
      ok: false,
      code: err.exitCode ?? 1,
      stdout: err.stdout?.slice?.(0, 100_000) ?? "",
      stderr: err.stderr?.slice?.(0, 100_000) ?? String(err),
    };
  }
}

export async function evaluate_work(
  files: string[],
  criteria?: string
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
    }
  }

  // Analyze the files based on criteria
  const analysis = analyzeFiles(file_contents, criteria || "general");

  return {
    evaluation: analysis,
    files_analyzed,
    criteria_used: criteria || "general",
  };
}

function analyzeFiles(
  file_contents: Record<string, string>,
  criteria: string
): {
  overall_score: number;
  strengths: string[];
  improvements: string[];
  specific_suggestions: Array<{
    file: string;
    line?: number;
    suggestion: string;
    priority: "low" | "medium" | "high";
  }>;
} {
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

  for (const [file, content] of Object.entries(file_contents)) {
    file_count++;
    const lines = content.split("\n");
    let file_score = 0;

    // Analyze based on file type and criteria
    if (file.endsWith(".html")) {
      const htmlAnalysis = analyzeHTML(content, lines);
      file_score += htmlAnalysis.score;
      strengths.push(...htmlAnalysis.strengths);
      improvements.push(...htmlAnalysis.improvements);
      specific_suggestions.push(
        ...htmlAnalysis.suggestions.map((s) => ({ ...s, file }))
      );
    } else if (file.endsWith(".css")) {
      const cssAnalysis = analyzeCSS(content, lines);
      file_score += cssAnalysis.score;
      strengths.push(...cssAnalysis.strengths);
      improvements.push(...cssAnalysis.improvements);
      specific_suggestions.push(
        ...cssAnalysis.suggestions.map((s) => ({ ...s, file }))
      );
    } else if (file.endsWith(".ts") || file.endsWith(".js")) {
      const jsAnalysis = analyzeJavaScript(content, lines);
      file_score += jsAnalysis.score;
      strengths.push(...jsAnalysis.strengths);
      improvements.push(...jsAnalysis.improvements);
      specific_suggestions.push(
        ...jsAnalysis.suggestions.map((s) => ({ ...s, file }))
      );
    } else {
      // General file analysis
      const generalAnalysis = analyzeGeneral(content, lines);
      file_score += generalAnalysis.score;
      strengths.push(...generalAnalysis.strengths);
      improvements.push(...generalAnalysis.improvements);
      specific_suggestions.push(
        ...generalAnalysis.suggestions.map((s) => ({ ...s, file }))
      );
    }

    total_score += file_score;
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
