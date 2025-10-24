import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  write_patch,
  read_files,
  search_repo,
} from "../../tools/file-operations";

describe("File Operations", () => {
  const testDir = path.join(process.cwd(), "test-files");

  beforeEach(async () => {
    // Create test directory
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    // Clean up test files
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe("Full File Operations", () => {
    it("should create a new file with full-file format", async () => {
      const testFile = path.join(testDir, "new-file.txt");
      const content = "Hello, World!\nThis is a test file.\n";

      const patch = `=== file:${testFile} ===
${content}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should create multiple files with full-file format", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");
      const content1 = "Content of file 1\n";
      const content2 = "Content of file 2\n";

      const patch = `=== file:${file1} ===
${content1}=== end ===

=== file:${file2} ===
${content2}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(2);
      expect(result.message).toContain(file1);
      expect(result.message).toContain(file2);

      const file1Content = await fs.readFile(file1, "utf-8");
      const file2Content = await fs.readFile(file2, "utf-8");
      expect(file1Content).toBe(content1);
      expect(file2Content).toBe(content2);
    });

    it("should replace existing file content", async () => {
      const testFile = path.join(testDir, "existing-file.txt");
      const originalContent = "Original content\n";
      const newContent = "New content\n";

      // Create the original file
      await fs.writeFile(testFile, originalContent, "utf-8");

      const patch = `=== file:${testFile} ===
${newContent}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(newContent);
    });

    it("should handle files without end markers", async () => {
      const testFile = path.join(testDir, "no-end-marker.txt");
      const content = "Content without end marker\n";

      const patch = `=== file:${testFile} ===
${content}`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should handle empty files", async () => {
      const testFile = path.join(testDir, "empty-file.txt");
      const content = "";

      const patch = `=== file:${testFile} ===
${content}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should handle files with special characters", async () => {
      const testFile = path.join(testDir, "special-chars.txt");
      const content =
        "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?\nUnicode: 你好世界 🌍\n";

      const patch = `=== file:${testFile} ===
${content}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should handle escaped characters in patches", async () => {
      const testFile = path.join(testDir, "escaped-test.txt");
      const content = "Line 1\nLine 2\nLine 3\n";

      const patch = `=== file:${testFile} ===
${content.replace(/\n/g, "\\n")}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(testFile);

      const fileContent = await fs.readFile(testFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should create directories as needed", async () => {
      const nestedFile = path.join(testDir, "nested", "deep", "file.txt");
      const content = "Nested file content\n";

      const patch = `=== file:${nestedFile} ===
${content}=== end ===`;

      const result = await write_patch(patch);

      expect(result.success).toBe(true);
      expect(result.files_written).toBe(1);
      expect(result.message).toContain(nestedFile);

      const fileContent = await fs.readFile(nestedFile, "utf-8");
      expect(fileContent).toBe(content);
    });

    it("should handle empty patches gracefully", async () => {
      const result = await write_patch("");

      expect(result.success).toBe(false);
      expect(result.files_written).toBe(0);
      expect(result.error).toBe("No recognized full-file blocks");
    });

    it("should handle malformed patches gracefully", async () => {
      const result = await write_patch("This is not a valid patch");

      expect(result.success).toBe(false);
      expect(result.files_written).toBe(0);
      expect(result.error).toBe("No recognized full-file blocks");
    });
  });

  describe("Read Files", () => {
    it("should read multiple files", async () => {
      const file1 = path.join(testDir, "read1.txt");
      const file2 = path.join(testDir, "read2.txt");
      const content1 = "Content 1\n";
      const content2 = "Content 2\n";

      await fs.writeFile(file1, content1, "utf-8");
      await fs.writeFile(file2, content2, "utf-8");

      const result = await read_files([file1, file2]);

      expect(result[file1]).toBe(content1);
      expect(result[file2]).toBe(content2);
    });

    it("should handle non-existent files gracefully", async () => {
      const nonExistentFile = path.join(testDir, "does-not-exist.txt");

      const result = await read_files([nonExistentFile]);

      expect(result[nonExistentFile]).toBeUndefined();
    });
  });

  describe("Search Repository", () => {
    it("should search for content in files", async () => {
      const result = await search_repo("describe");

      expect(result.query).toBe("describe");
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0]).toHaveProperty("file");
      expect(result.hits[0]).toHaveProperty("line");
      expect(result.hits[0]).toHaveProperty("snippet");
    });

    it("should return results for queries that exist", async () => {
      const result = await search_repo("function");

      expect(result.query).toBe("function");
      expect(result.hits.length).toBeGreaterThan(0);
    });
  });
});
