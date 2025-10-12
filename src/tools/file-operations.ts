import { promises as fs } from "node:fs";
import * as path from "node:path";
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
