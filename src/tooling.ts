import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { parsePatch, applyPatch } from "diff";

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

  console.log("[DEBUG] write_patch - patch preview:", patch.substring(0, 100));

  // Try to parse as unified diff format first
  try {
    const parsedPatches = parsePatch(patch);
    console.log("[DEBUG] Parsed as unified diff, patches found:", parsedPatches.length);
    
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
          console.log(`[DEBUG] File "${file}" doesn't exist, treating as empty`);
        }

        // Apply the patch
        const result = applyPatch(originalContent, parsedPatch);
        
        if (result === false) {
          console.log(`[DEBUG] Failed to apply patch to "${file}"`);
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
    console.log("[DEBUG] Not a unified diff patch, trying full-file format:", err);
  }

  // Fall back to full-file format
  // Split on === file: at the beginning of lines or at the start
  const blocks = patch.split(/(?:^|\n)=== file:/);

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

      // Find the content between the header and === end ===
      const contentLines: string[] = [];
      let foundEnd = false;

      for (let j = 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === "=== end ===") {
          foundEnd = true;
          break;
        }
        contentLines.push(line);
      }

      if (!foundEnd) {
        // If no end marker found, take everything after the first line
        contentLines.push(...lines.slice(1));
      }

      const body = contentLines.join("\n");
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
