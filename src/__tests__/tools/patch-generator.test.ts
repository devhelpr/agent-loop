import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  generate_patch,
  PatchInstruction,
  applyEditsToText,
  generateUnifiedDiffForFile,
  planToUnifiedDiffs,
  type Plan,
} from "../../tools/patch-generator";

describe("patch-generator", () => {
  const testDir = path.join(__dirname, "test-files");
  const testFile = path.join(testDir, "test.txt");

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    // Create initial test file
    await fs.writeFile(
      testFile,
      "line 1\nline 2\nline 3\nline 4\nline 5",
      "utf8"
    );
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("generate_patch", () => {
    it("should generate a patch for adding a new file", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: path.join(testDir, "new-file.txt"),
          operation: "add",
          content: "This is a new file\nwith multiple lines",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("--- /dev/null");
      expect(result.patch).toContain("+++ b/");
      expect(result.patch).toContain("+This is a new file");
      expect(result.patch).toContain("+with multiple lines");
      expect(result.applied).toContain(path.join(testDir, "new-file.txt"));
    });

    it("should generate a patch for inserting content at a specific line", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "insert",
          line: 2,
          content: "inserted line 1\ninserted line 2",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("--- a/");
      expect(result.patch).toContain("+++ b/");
      expect(result.patch).toContain("+inserted line 1");
      expect(result.patch).toContain("+inserted line 2");
      expect(result.applied).toContain(testFile);
    });

    it("should generate a patch for replacing content at a specific line", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "replace",
          line: 1,
          oldContent: "line 2",
          content: "replaced line",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("-line 2");
      expect(result.patch).toContain("+replaced line");
      expect(result.applied).toContain(testFile);
    });

    it("should generate a patch for deleting a line", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "delete",
          line: 2,
          oldContent: "line 3",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("-line 3");
      expect(result.applied).toContain(testFile);
    });

    it("should handle multiple instructions in one patch", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "insert",
          line: 1,
          content: "first insertion",
        },
        {
          file: testFile,
          operation: "replace",
          line: 3,
          oldContent: "line 3",
          content: "replaced content",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("+first insertion");
      expect(result.patch).toContain("-line 3");
      expect(result.patch).toContain("+replaced content");
      expect(result.applied).toHaveLength(2);
    });

    it("should handle insert at the beginning of file (line 0)", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "insert",
          line: 0,
          content: "new first line",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("+new first line");
      expect(result.applied).toContain(testFile);
    });

    it("should handle insert at the end of file", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "insert",
          line: 5,
          content: "new last line",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("+new last line");
      expect(result.applied).toContain(testFile);
    });

    it("should fail when trying to add a file that already exists", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "add",
          content: "This should fail",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should fail when trying to modify a non-existent file with non-add operation", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: path.join(testDir, "non-existent.txt"),
          operation: "insert",
          line: 0,
          content: "This should fail",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    it("should fail when line number is out of bounds", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "insert",
          line: 10,
          content: "This should fail",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid line number");
    });

    it("should fail when oldContent doesn't match for replace operation", async () => {
      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "replace",
          line: 1,
          oldContent: "wrong content",
          content: "new content",
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not find line matching");
    });

    it("should replace a multi-line block when oldContent spans lines", async () => {
      // Prepare a multi-line content
      await fs.writeFile(
        testFile,
        [
          "import React from 'react';",
          "",
          "export default function App() {",
          "  return (",
          '    <div className="app-container">',
          "      <h1>hello world</h1>",
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
        "utf8"
      );

      const oldBlock = [
        "import React from 'react';",
        "",
        "export default function App() {",
        "  return (",
        '    <div className="app-container">',
        "      <h1>hello world</h1>",
        "    </div>",
        "  );",
        "}",
      ].join("\n");

      const newBlock = [
        "import React from 'react';",
        "",
        "export default function App() {",
        "  return (",
        '    <div className="app-container">',
        "      <h1>Hej har mar du?</h1>",
        "    </div>",
        "  );",
        "}",
      ].join("\n");

      const instructions: PatchInstruction[] = [
        {
          file: testFile,
          operation: "replace",
          line: 0,
          oldContent: oldBlock,
          content: newBlock,
        },
      ];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(true);
      expect(result.patch).toContain("-      <h1>hello world</h1>");
      expect(result.patch).toContain("+      <h1>Hej har mar du?</h1>");
    });

    it("should handle empty instructions array", async () => {
      const instructions: PatchInstruction[] = [];

      const result = await generate_patch(instructions);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No patches were generated");
    });
  });

  describe("plan-based generator", () => {
    it("applies token edits deterministically and produces a verified diff", async () => {
      const filePath = testFile;
      const oldText = "a a a\nend";
      const plan: Plan = {
        changes: [
          {
            filePath,
            edits: [
              { kind: "replace", find: "a", replace: "A", occurrence: 2 },
              { kind: "insertAfter", find: "a", insert: "!", occurrence: 2 },
              { kind: "delete", find: "end" },
            ],
          },
        ],
      };

      const newText = applyEditsToText(oldText, plan.changes[0].edits);
      expect(newText).toBe("a A! a\n");

      const diff = generateUnifiedDiffForFile(filePath, oldText, newText);
      expect(diff).toContain("--- a/");
      expect(diff).toContain("+++ b/");

      const res = await planToUnifiedDiffs(plan, (p) =>
        p === filePath ? oldText : ""
      );
      expect(res[0].diff).toBe(diff);
    });

    it("rejects overlapping edits", () => {
      const oldText = "hello";
      const edits = [
        { kind: "replaceRange", start: 1, end: 4, replace: "XYZ" },
        { kind: "replaceRange", start: 3, end: 5, replace: "Q" },
      ] as const;
      expect(() => applyEditsToText(oldText, edits as any)).toThrow(
        /Overlapping/
      );
    });

    it("errors when token not found", () => {
      const oldText = "abc";
      expect(() =>
        applyEditsToText(oldText, [
          { kind: "replace", find: "z", replace: "Z" } as any,
        ])
      ).toThrow(/Token not found/);
    });
  });
});
