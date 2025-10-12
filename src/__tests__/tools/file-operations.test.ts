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
 Line 3
 Line 4`;

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

      // Should handle gracefully - either create file or fail
      expect(result.mode).toBe("diff");
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
    it("should handle CSS file modifications", async () => {
      const cssFile = path.join(testDir, "style.css");

      // Create initial CSS
      const initialCSS = `body {
    margin: 0;
    padding: 0;
    background: #f4f4f4;
}`;

      await fs.writeFile(cssFile, initialCSS, "utf-8");

      // Add flexbox properties
      const patch = `--- a/${cssFile}
+++ b/${cssFile}
@@ -1,4 +1,7 @@
 body {
     margin: 0;
     padding: 0;
+    display: flex;
+    flex-direction: column;
+    align-items: center;
     background: #f4f4f4;
 }`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(cssFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(cssFile, "utf-8");
      expect(content).toContain("display: flex");
      expect(content).toContain("flex-direction: column");
      expect(content).toContain("align-items: center");
    });

    it("should handle HTML file modifications", async () => {
      const htmlFile = path.join(testDir, "index.html");

      // Create initial HTML
      const initialHTML = `<!DOCTYPE html>
<html>
<head>
    <title>Test</title>
</head>
<body>
    <h1>Hello</h1>
</body>
</html>`;

      await fs.writeFile(htmlFile, initialHTML, "utf-8");

      // Add meta viewport tag
      const patch = `--- a/${htmlFile}
+++ b/${htmlFile}
@@ -2,6 +2,7 @@
 <html>
 <head>
+    <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Test</title>
 </head>
 <body>`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(htmlFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(htmlFile, "utf-8");
      expect(content).toContain("viewport");
    });

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
 Line 502
 Line 503`;

      const result = await write_patch(patch);

      expect(result.applied).toContain(largeFile);
      expect(result.mode).toBe("diff");

      const content = await fs.readFile(largeFile, "utf-8");
      expect(content).toContain("Inserted in middle");
    });
  });
});
