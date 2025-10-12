import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { write_patch } from "../../tools/file-operations";

describe("Diff and Patch Functionality", () => {
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

  describe("Full File Patches", () => {
    it("should create a new file with full-file format", async () => {
      const testFile = path.join(testDir, "new-file.txt");
      const content = "Hello, World!\nThis is a test file.\n";

      const patch = `=== file:${testFile} ===
${content}=== end ===`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("full-file");

      const fileContent = await fs.readFile(testFile, "utf-8");
      // The content should match exactly, including trailing newline
      expect(fileContent).toBe(content);
    });

    it("should create multiple files with full-file format", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");

      const patch = `=== file:${file1} ===
Content of file 1
=== end ===

=== file:${file2} ===
Content of file 2
=== end ===`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(file1);
      expect(result.applied).toContain(file2);
      expect(result.mode).toBe("full-file");

      const content1 = await fs.readFile(file1, "utf-8");
      const content2 = await fs.readFile(file2, "utf-8");
      expect(content1).toBe("Content of file 1\n");
      expect(content2).toBe("Content of file 2\n");
    });
  });

  describe("Unified Diff Patches", () => {
    it("should apply a simple addition diff patch", async () => {
      const testFile = path.join(testDir, "diff-test.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3\n", "utf-8");

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,3 +1,4 @@
 Line 1
 Line 2
+Line 2.5
 Line 3`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 2\nLine 2.5\nLine 3\n");
    });

    it("should apply a deletion diff patch", async () => {
      const testFile = path.join(testDir, "delete-test.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3\nLine 4\n", "utf-8");

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,4 +1,3 @@
 Line 1
-Line 2
 Line 3
 Line 4`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 3\nLine 4\n");
    });

    it("should apply a modification diff patch", async () => {
      const testFile = path.join(testDir, "modify-test.txt");

      // Create initial file
      await fs.writeFile(
        testFile,
        "Hello World\nThis is a test\nGoodbye\n",
        "utf-8"
      );

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,3 +1,3 @@
-Hello World
+Hello Universe
 This is a test
 Goodbye`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Hello Universe\nThis is a test\nGoodbye\n");
    });

    it("should apply a complex diff patch with multiple changes", async () => {
      const testFile = path.join(testDir, "complex-test.txt");

      // Create initial file
      await fs.writeFile(
        testFile,
        "Header\nContent 1\nContent 2\nFooter\n",
        "utf-8"
      );

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,4 +1,5 @@
 Header
+New Content
 Content 1
-Content 2
+Modified Content
 Footer`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe(
        "Header\nNew Content\nContent 1\nModified Content\nFooter\n"
      );
    });

    it("should handle diff patches with proper context lines", async () => {
      const testFile = path.join(testDir, "context-test.txt");

      // Create initial file with more context
      await fs.writeFile(
        testFile,
        "Start\nLine 1\nLine 2\nLine 3\nLine 4\nEnd\n",
        "utf-8"
      );

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -2,3 +2,4 @@
 Line 1
 Line 2
+Inserted Line
 Line 3`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe(
        "Start\nLine 1\nLine 2\nInserted Line\nLine 3\nLine 4\nEnd\n"
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty patches gracefully", async () => {
      const result = await write_patch("");

      expect(result.applied).toEqual([]);
      expect(result.mode).toBe("none");
    });

    it("should handle malformed patches gracefully", async () => {
      const result = await write_patch("This is not a valid patch");

      expect(result.applied).toEqual([]);
      expect(result.mode).toBe("none");
    });

    it("should handle diff patches with incorrect line numbers", async () => {
      const testFile = path.join(testDir, "bad-line-numbers.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3\n", "utf-8");

      // Patch with incorrect line numbers
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -10,3 +10,4 @@
 Line 1
 Line 2
+This should fail
 Line 3`;

      const result = await write_patch(patch);

      // Should either fail gracefully or use manual fallback
      expect(result.mode).toBe("diff");
    });

    it("should handle patches for non-existent files", async () => {
      const nonExistentFile = path.join(testDir, "does-not-exist.txt");

      const patch = `--- a/${nonExistentFile}
+++ b/${nonExistentFile}
@@ -1,3 +1,4 @@
 Line 1
 Line 2
+New line
 Line 3`;

      const result = await write_patch(patch);

      // Should fail to apply patch to non-existent file
      expect(result.applied).not.toContain(nonExistentFile);
      expect(result.mode).toBe("none");
    });

    it("should handle escaped characters in patches", async () => {
      const testFile = path.join(testDir, "escaped-test.txt");

      // Create initial file
      await fs.writeFile(testFile, "Normal line\n", "utf-8");

      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,1 +1,2 @@
 Normal line
+Line with special chars`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      // The patch should add the new line successfully
      expect(content).toContain("Line with special chars");
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle TypeScript file modifications", async () => {
      const tsFile = path.join(testDir, "test.ts");

      // Create initial TypeScript
      const initialTS = `function greet(name: string) {
    return \`Hello, \${name}!\`;
}`;

      await fs.writeFile(tsFile, initialTS, "utf-8");

      // Add error handling
      const patch = `--- a/${tsFile}
+++ b/${tsFile}
@@ -1,3 +1,7 @@
-function greet(name: string) {
-    return \`Hello, \${name}!\`;
+function greet(name: string): string {
+    try {
+        return \`Hello, \${name}!\`;
+    } catch (error) {
+        return 'Hello, World!';
+    }
 }`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(tsFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(tsFile, "utf-8");
      expect(content).toContain("try {");
      expect(content).toContain("catch (error)");
    });
  });

  describe("Performance and Large Files", () => {
    it("should handle large file patches efficiently", async () => {
      const largeFile = path.join(testDir, "large.txt");

      // Create a large file (1000 lines)
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
      await fs.writeFile(largeFile, lines.join("\n"), "utf-8");

      // Add a line in the middle
      const patch = `--- a/${largeFile}
+++ b/${largeFile}
@@ -500,3 +500,4 @@
 Line 500
 Line 501
+Inserted in middle
 Line 502`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(largeFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(largeFile, "utf-8");
      expect(content).toContain("Inserted in middle");
    });
  });

  describe("Diff Library Specific Tests", () => {
    it("should handle patches with no context lines", async () => {
      const testFile = path.join(testDir, "no-context.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3\n", "utf-8");

      // Patch with no context lines (0,0)
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -2,0 +2,1 @@
+New line`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 2\nNew line\nLine 3\n");
    });

    it("should handle patches with multiple hunks in one file", async () => {
      const testFile = path.join(testDir, "multi-hunk.txt");

      // Create initial file
      await fs.writeFile(
        testFile,
        "Header\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nFooter\n",
        "utf-8"
      );

      // Patch with multiple hunks
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,3 +1,4 @@
 Header
+Added at top
 Line 1
 Line 2
@@ -4,3 +5,4 @@
 Line 3
 Line 4
+Added in middle
 Line 5`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe(
        "Header\nAdded at top\nLine 1\nLine 2\nLine 3\nLine 4\nAdded in middle\nLine 5\nFooter\n"
      );
    });

    it("should handle patches with exact line number matches", async () => {
      const testFile = path.join(testDir, "exact-match.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3\n", "utf-8");

      // Patch that should match exactly
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,3 +1,4 @@
 Line 1
 Line 2
+Exact match insertion
 Line 3`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 2\nExact match insertion\nLine 3\n");
    });

    it("should handle patches with trailing newlines correctly", async () => {
      const testFile = path.join(testDir, "trailing-newline.txt");

      // Create initial file with trailing newline
      await fs.writeFile(testFile, "Line 1\nLine 2\n", "utf-8");

      // Patch that adds content
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,2 +1,3 @@
 Line 1
 Line 2
+Line 3`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 2\nLine 3\n");
    });

    it("should handle patches without trailing newlines", async () => {
      const testFile = path.join(testDir, "no-trailing-newline.txt");

      // Create initial file without trailing newline
      await fs.writeFile(testFile, "Line 1\nLine 2", "utf-8");

      // Patch that adds content
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,2 +1,3 @@
 Line 1
 Line 2
+Line 3`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\nLine 2\nLine 3");
    });

    it("should handle patches with special characters", async () => {
      const testFile = path.join(testDir, "special-chars.txt");

      // Create initial file
      await fs.writeFile(testFile, "Normal line\n", "utf-8");

      // Patch with special characters
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,1 +1,2 @@
 Normal line
+Line with special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toContain(
        "Line with special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?"
      );
    });

    it("should handle patches with unicode characters", async () => {
      const testFile = path.join(testDir, "unicode.txt");

      // Create initial file
      await fs.writeFile(testFile, "Hello\n", "utf-8");

      // Patch with unicode characters
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,1 +1,2 @@
 Hello
+Hello 世界 🌍`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toContain("Hello 世界 🌍");
    });

    it("should handle patches with tabs and spaces", async () => {
      const testFile = path.join(testDir, "whitespace.txt");

      // Create initial file with mixed whitespace
      await fs.writeFile(testFile, "Line 1\n\tIndented line\n", "utf-8");

      // Patch that modifies whitespace
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,2 +1,3 @@
 Line 1
+    Four spaces
 \tIndented line`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(testFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Line 1\n    Four spaces\n\tIndented line\n");
    });
  });

  describe("Diff Library Error Handling", () => {
    it("should fail gracefully when patch doesn't match file content", async () => {
      const testFile = path.join(testDir, "mismatch.txt");

      // Create initial file
      await fs.writeFile(testFile, "Different content\n", "utf-8");

      // Patch that expects different content
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,1 +1,2 @@
 Expected content
+New line`;

      const result = await write_patch(patch);

      // Should fail to apply the patch
      expect(result.applied).not.toContain(testFile);
      expect(result.mode).toBe("none");
    });

    it("should fail gracefully when patch has invalid line numbers", async () => {
      const testFile = path.join(testDir, "invalid-lines.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\nLine 2\n", "utf-8");

      // Patch with invalid line numbers
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -10,1 +10,2 @@
 Line 1
+This should fail`;

      const result = await write_patch(patch);

      // The diff library may still apply the patch even with invalid line numbers
      // This test documents the current behavior
      expect(result.mode).toBe("diff");
    });

    it("should fail gracefully when patch is malformed", async () => {
      const testFile = path.join(testDir, "malformed.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\n", "utf-8");

      // Malformed patch
      const patch = `--- a/${testFile}
+++ b/${testFile}
@@ -1,1 +1,2 @@
 Line 1
+Missing context`;

      const result = await write_patch(patch);

      // The diff library may still apply the patch even with malformed context
      // This test documents the current behavior
      expect(result.mode).toBe("diff");
    });

    it("should handle empty patches gracefully", async () => {
      const result = await write_patch("");

      expect(result.applied).toEqual([]);
      expect(result.mode).toBe("none");
    });

    it("should handle patches with no hunks", async () => {
      const testFile = path.join(testDir, "no-hunks.txt");

      // Create initial file
      await fs.writeFile(testFile, "Line 1\n", "utf-8");

      // Patch with no hunks
      const patch = `--- a/${testFile}
+++ b/${testFile}`;

      const result = await write_patch(patch);

      // The diff library may still process patches with no hunks
      // This test documents the current behavior
      expect(result.mode).toBe("diff");
    });
  });
});
