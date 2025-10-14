import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createTwoFilesPatch, parsePatch, applyPatch } from "diff";

// Plan-based edit types (non-breaking addition)
export type FileChangePlan = {
  filePath: string;
  edits: Array<
    | { kind: "replace"; find: string; replace: string; occurrence?: number }
    | { kind: "replaceRange"; start: number; end: number; replace: string }
    | { kind: "insertAfter"; find: string; insert: string; occurrence?: number }
    | { kind: "delete"; find: string; occurrence?: number }
  >;
};

export type Plan = { changes: FileChangePlan[] };

type ConcreteEdit = { start: number; end: number; text: string };

function findNthIndex(haystack: string, needle: string, n: number): number {
  if (n <= 0) return -1;
  let from = 0;
  for (let i = 0; i < n; i++) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    from = idx + needle.length;
    if (i === n - 1) return idx;
  }
  return -1;
}

function editsOverlap(a: ConcreteEdit, b: ConcreteEdit): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

export function applyEditsToText(
  original: string,
  edits: FileChangePlan["edits"]
): string {
  const concrete: ConcreteEdit[] = [];

  for (const e of edits) {
    if (e.kind === "replaceRange") {
      if (e.start < 0 || e.end < e.start || e.end > original.length) {
        throw new Error(`Invalid replaceRange: [${e.start}, ${e.end}]`);
      }
      concrete.push({ start: e.start, end: e.end, text: e.replace });
      continue;
    }

    if (e.kind === "replace") {
      const occurrence = e.occurrence ?? 1;
      const start = findNthIndex(original, e.find, occurrence);
      if (start === -1)
        throw new Error(
          `Token not found for replace: "${e.find}" (occurrence ${occurrence})`
        );
      concrete.push({ start, end: start + e.find.length, text: e.replace });
      continue;
    }

    if (e.kind === "insertAfter") {
      const occurrence = e.occurrence ?? 1;
      const start = findNthIndex(original, e.find, occurrence);
      if (start === -1)
        throw new Error(
          `Token not found for insertAfter: "${e.find}" (occurrence ${occurrence})`
        );
      const pos = start + e.find.length;
      concrete.push({ start: pos, end: pos, text: e.insert });
      continue;
    }

    if (e.kind === "delete") {
      const occurrence = e.occurrence ?? 1;
      const start = findNthIndex(original, e.find, occurrence);
      if (start === -1)
        throw new Error(
          `Token not found for delete: "${e.find}" (occurrence ${occurrence})`
        );
      concrete.push({ start, end: start + e.find.length, text: "" });
      continue;
    }
  }

  // Overlap detection
  for (let i = 0; i < concrete.length; i++) {
    for (let j = i + 1; j < concrete.length; j++) {
      if (editsOverlap(concrete[i], concrete[j])) {
        throw new Error(
          "Overlapping edits detected; refuse to apply ambiguous plan."
        );
      }
    }
  }

  // Apply from right to left to avoid index shifting
  const sorted = [...concrete].sort((a, b) => b.start - a.start);
  let result = original;
  for (const c of sorted) {
    result = result.slice(0, c.start) + c.text + result.slice(c.end);
  }
  return result;
}

export function generateUnifiedDiffForFile(
  filePath: string,
  oldText: string,
  editedText: string
): string {
  const oldLabel = `a/${filePath}`;
  const newLabel = `b/${filePath}`;
  const patch = createTwoFilesPatch(
    oldLabel,
    newLabel,
    oldText,
    editedText,
    "old",
    "new",
    { context: 3 }
  );

  const parsed = parsePatch(patch);
  const roundTrip = applyPatch(oldText, parsed[0]);
  if (roundTrip === false || roundTrip !== editedText) {
    throw new Error(
      "Self-apply verification failed; refusing to emit unsafe diff."
    );
  }
  return patch;
}

export async function planToUnifiedDiffs(
  plan: Plan,
  readFileFn: (path: string) => string | Promise<string>
): Promise<Array<{ filePath: string; diff: string }>> {
  const results = await Promise.all(
    plan.changes.map(async ({ filePath, edits }) => {
      const oldText = await Promise.resolve(readFileFn(filePath));
      const newText = applyEditsToText(oldText, edits);
      const diff = generateUnifiedDiffForFile(filePath, oldText, newText);
      return { filePath, diff };
    })
  );
  return results;
}

export interface PatchInstruction {
  file: string;
  operation: "add" | "replace" | "delete" | "insert";
  line?: number; // Line number for insert/replace/delete operations
  content?: string; // Content to add/replace
  oldContent?: string; // Content to replace (for replace operations)
  context?: string; // Context lines around the change for better matching
}

export interface PatchGenerationResult {
  success: boolean;
  patch?: string;
  error?: string;
  applied?: string[];
}

/**
 * Find the start and end line indexes for a multi-line block within an array of lines.
 * Returns null if not found.
 */
function findBlockRange(
  lines: string[],
  block: string
): { start: number; end: number } | null {
  if (!block) return null;
  const haystack = lines.join("\n");
  const idx = haystack.indexOf(block);
  if (idx === -1) return null;
  // Count how many newlines occur before the match to get start line
  const before = haystack.slice(0, idx);
  const start = before === "" ? 0 : before.split("\n").length - 1;
  const blockLineCount = block.split("\n").length;
  const end = start + blockLineCount - 1;
  return { start, end };
}

/**
 * Validates patch instructions to prevent common errors
 */
function validatePatchInstruction(instruction: PatchInstruction): string[] {
  const errors: string[] = [];

  if (!instruction.file) {
    errors.push("File path is required");
  }

  if (!instruction.operation) {
    errors.push("Operation is required");
  } else if (
    !["add", "replace", "delete", "insert"].includes(instruction.operation)
  ) {
    errors.push(`Invalid operation: ${instruction.operation}`);
  }

  if (instruction.operation === "add" && !instruction.content) {
    errors.push("Content is required for 'add' operation");
  }

  if (instruction.operation === "replace" && !instruction.content) {
    errors.push("Content is required for 'replace' operation");
  }

  if (instruction.operation === "insert" && !instruction.content) {
    errors.push("Content is required for 'insert' operation");
  }

  if (instruction.operation === "delete" && !instruction.oldContent) {
    errors.push("oldContent is required for 'delete' operation");
  }

  if (instruction.line !== undefined && instruction.line < 0) {
    errors.push("Line number must be non-negative");
  }

  return errors;
}

/**
 * Generates a unified diff patch based on structured instructions from the LLM
 */
export async function generate_patch(
  instructions: PatchInstruction[]
): Promise<PatchGenerationResult> {
  const patches: string[] = [];
  const applied: string[] = [];

  // Validate all instructions first
  for (const instruction of instructions) {
    const errors = validatePatchInstruction(instruction);
    if (errors.length > 0) {
      return {
        success: false,
        error: `Invalid instruction for ${instruction.file}: ${errors.join(
          ", "
        )}`,
        applied,
      };
    }
  }

  for (const instruction of instructions) {
    try {
      const patch = await generateSinglePatch(instruction);
      if (patch) {
        patches.push(patch);
        applied.push(instruction.file);
      }
    } catch (error) {
      console.error(
        `[ERROR] Failed to generate patch for ${instruction.file}:`,
        error
      );
      return {
        success: false,
        error: `Failed to generate patch for ${instruction.file}: ${error}`,
        applied,
      };
    }
  }

  if (patches.length === 0) {
    return {
      success: false,
      error: "No patches were generated",
      applied,
    };
  }

  const unifiedPatch = patches.join("\n");

  // Validate the generated patch by trying to parse it
  try {
    const parsed = parsePatch(unifiedPatch);
    if (!parsed || parsed.length === 0) {
      return {
        success: false,
        error: "Generated patch is invalid or empty",
        applied,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Generated patch is malformed: ${error}`,
      applied,
    };
  }

  return {
    success: true,
    patch: unifiedPatch,
    applied,
  };
}

/**
 * Generates a single unified diff patch for one file instruction
 */
async function generateSinglePatch(
  instruction: PatchInstruction
): Promise<string | null> {
  const { file, operation, line, content, oldContent, context } = instruction;

  // Read the current file content
  let originalContent = "";
  let fileExists = true;

  try {
    originalContent = await fs.readFile(file, "utf8");
  } catch (error) {
    fileExists = false;
    if (operation !== "add") {
      throw new Error(`File ${file} does not exist and operation is not 'add'`);
    }
  }

  const lines = originalContent.split("\n");

  switch (operation) {
    case "add":
      return generateAddPatch(file, content || "", fileExists);

    case "insert":
      return generateInsertPatch(file, lines, line || 0, content || "");

    case "replace":
      return generateReplacePatch(
        file,
        lines,
        line ?? 0,
        oldContent ?? "",
        content ?? "",
        context
      );

    case "delete":
      return generateDeletePatch(
        file,
        lines,
        line ?? 0,
        oldContent ?? "",
        context
      );

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Generates a patch for adding a new file
 */
function generateAddPatch(
  file: string,
  content: string,
  fileExists: boolean
): string {
  if (fileExists) {
    throw new Error(
      `File ${file} already exists. Use 'replace' operation to modify existing files.`
    );
  }

  const lines = content.split("\n");
  const patchLines = [
    `--- /dev/null`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ];

  return patchLines.join("\n");
}

/**
 * Generates a patch for inserting content at a specific line
 */
function generateInsertPatch(
  file: string,
  lines: string[],
  insertLine: number,
  content: string
): string {
  if (insertLine < 0 || insertLine > lines.length) {
    throw new Error(
      `Invalid line number ${insertLine}. File has ${lines.length} lines.`
    );
  }

  const newLines = content.split("\n");
  const contextLines = 3; // Number of context lines to include

  // Calculate the start line for the patch (with context)
  const patchStart = Math.max(0, insertLine - contextLines);
  const patchEnd = Math.min(lines.length, insertLine + contextLines);

  // Build the patch
  const patchLines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${patchStart + 1},${patchEnd - patchStart} +${patchStart + 1},${
      patchEnd - patchStart + newLines.length
    } @@`,
  ];

  // Add context lines before the insertion
  for (let i = patchStart; i < insertLine; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  // Add the new lines
  for (const newLine of newLines) {
    patchLines.push(`+${newLine}`);
  }

  // Add context lines after the insertion
  for (let i = insertLine; i < patchEnd; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  return patchLines.join("\n");
}

/**
 * Generates a patch for replacing content at a specific line
 */
function generateReplacePatch(
  file: string,
  lines: string[],
  line: number,
  oldContent: string,
  newContent: string,
  context?: string
): string {
  if (line < 0 || line > lines.length) {
    throw new Error(
      `Invalid line number ${line}. File has ${lines.length} lines.`
    );
  }

  const newLines = newContent.split("\n");

  // Special case: if line is 0 and no oldContent is provided, replace entire file
  if (line === 0 && !oldContent) {
    return generateFullFileReplacePatch(file, lines, newLines);
  }

  // Special case: if oldContent matches the entire file content, replace entire file
  if (oldContent && oldContent.trim() === lines.join("\n").trim()) {
    return generateFullFileReplacePatch(file, lines, newLines);
  }

  const contextLines = 3;

  // Determine replacement range
  let replaceStart = line;
  let replaceEnd = line; // inclusive

  if (oldContent) {
    // First try exact single-line match at or near the provided line
    if (lines[line] !== oldContent) {
      // Try to find as single line within window
      const searchRange = 5;
      let foundLine = -1;
      for (
        let i = Math.max(0, line - searchRange);
        i <= Math.min(lines.length - 1, line + searchRange);
        i++
      ) {
        if (lines[i] === oldContent) {
          foundLine = i;
          break;
        }
      }
      if (foundLine !== -1) {
        replaceStart = foundLine;
        replaceEnd = foundLine;
      } else {
        // Try multi-line block match anywhere in the file
        const block = findBlockRange(lines, oldContent);
        if (block) {
          replaceStart = block.start;
          replaceEnd = block.end;
        } else {
          throw new Error(
            `Could not find line matching "${oldContent}" around line ${line}`
          );
        }
      }
    }
  }

  // Calculate patch boundaries with context
  const patchStart = Math.max(0, replaceStart - contextLines);
  const patchEnd = Math.min(lines.length, replaceEnd + contextLines + 1);

  const patchLines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${patchStart + 1},${patchEnd - patchStart} +${patchStart + 1},${
      patchEnd - patchStart - (replaceEnd - replaceStart + 1) + newLines.length
    } @@`,
  ];

  // Context before
  for (let i = patchStart; i < replaceStart; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  // Old block removed
  for (let i = replaceStart; i <= replaceEnd; i++) {
    patchLines.push(`-${lines[i]}`);
  }

  // New block added
  for (const newLine of newLines) {
    patchLines.push(`+${newLine}`);
  }

  // Context after
  for (let i = replaceEnd + 1; i < patchEnd; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  return patchLines.join("\n");
}

/**
 * Generates a patch for replacing the entire file content
 */
function generateFullFileReplacePatch(
  file: string,
  oldLines: string[],
  newLines: string[]
): string {
  const patchLines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ];

  // Remove all old lines
  for (const oldLine of oldLines) {
    patchLines.push(`-${oldLine}`);
  }

  // Add all new lines
  for (const newLine of newLines) {
    patchLines.push(`+${newLine}`);
  }

  return patchLines.join("\n");
}

/**
 * Generates a patch for deleting content at a specific line
 */
function generateDeletePatch(
  file: string,
  lines: string[],
  line: number,
  oldContent: string,
  context?: string
): string {
  if (line < 0 || line > lines.length) {
    throw new Error(
      `Invalid line number ${line}. File has ${lines.length} lines.`
    );
  }

  const contextLines = 3;

  // Determine delete range
  let deleteStart = line;
  let deleteEnd = line; // inclusive

  if (oldContent) {
    if (lines[line] !== oldContent) {
      const searchRange = 5;
      let foundLine = -1;
      for (
        let i = Math.max(0, line - searchRange);
        i <= Math.min(lines.length - 1, line + searchRange);
        i++
      ) {
        if (lines[i] === oldContent) {
          foundLine = i;
          break;
        }
      }
      if (foundLine !== -1) {
        deleteStart = foundLine;
        deleteEnd = foundLine;
      } else {
        const block = findBlockRange(lines, oldContent);
        if (block) {
          deleteStart = block.start;
          deleteEnd = block.end;
        } else {
          throw new Error(
            `Could not find line matching "${oldContent}" around line ${line}`
          );
        }
      }
    }
  }

  // Calculate patch boundaries
  const patchStart = Math.max(0, deleteStart - contextLines);
  const patchEnd = Math.min(lines.length, deleteEnd + contextLines + 1);

  const patchLines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${patchStart + 1},${patchEnd - patchStart} +${patchStart + 1},${
      patchEnd - patchStart - (deleteEnd - deleteStart + 1)
    } @@`,
  ];

  // Context before
  for (let i = patchStart; i < deleteStart; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  // Deleted block
  for (let i = deleteStart; i <= deleteEnd; i++) {
    patchLines.push(`-${lines[i]}`);
  }

  // Context after
  for (let i = deleteEnd + 1; i < patchEnd; i++) {
    patchLines.push(` ${lines[i]}`);
  }

  return patchLines.join("\n");
}
