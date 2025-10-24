import { promises as fs } from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";

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
  include = ["**/*.{ts,tsx,js,json,md,css,js,jsx,html}"],
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

  // Parse full-file format
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
    return {
      success: true,
      files_written: replaced.length,
      message: `Successfully wrote ${replaced.length} file(s): ${replaced.join(
        ", "
      )}`,
    };
  }

  return {
    success: false,
    files_written: 0,
    error: "No recognized full-file blocks",
  };
}
