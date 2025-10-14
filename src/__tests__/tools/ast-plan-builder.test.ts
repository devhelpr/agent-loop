import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  ASTPlanBuilder,
  executeASTRefactor,
} from "../../tools/ast-plan-builder";

describe("ast-plan-builder", () => {
  const testDir = path.join(__dirname, "ast-test-files");
  const tsConfigPath = path.join(testDir, "tsconfig.json");
  const testFile = path.join(testDir, "test.ts");

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    // Create tsconfig.json
    await fs.writeFile(
      tsConfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "commonjs",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
          },
          include: ["**/*.ts"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2
      ),
      "utf8"
    );

    // Create initial test file
    await fs.writeFile(
      testFile,
      `export function getUserName(user: any): string {
  return user.name;
}

export function processUser(user: any): void {
  const name = getUserName(user);
  console.log(\`Processing user: \${name}\`);
}

export const userName = getUserName;
`,
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

  describe("ASTPlanBuilder", () => {
    it("should rename a function and all its references", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);

      const plan = await builder.parseIntent(
        "rename getUserName to getUsername"
      );

      expect(plan.changes).toHaveLength(1);
      expect(plan.changes[0].filePath).toBe(testFile);
      expect(plan.changes[0].astEdits).toHaveLength(1);
      expect(plan.changes[0].astEdits[0]).toEqual({
        kind: "renameSymbol",
        symbol: "getUserName",
        newName: "getUsername",
        scope: "file",
      });

      // Execute the plan
      const results = await builder.executeASTPlan(plan);

      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe(testFile);
      expect(results[0].diff).toContain("getUsername");
      expect(results[0].diff).toContain("-export function getUserName");
      expect(results[0].diff).toContain("+export function getUsername");
    });

    it("should add a parameter to a function", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);

      const plan = await builder.parseIntent(
        "add parameter options: UserOptions to function processUser"
      );

      expect(plan.changes).toHaveLength(1);
      expect(plan.changes[0].astEdits[0]).toEqual({
        kind: "addParameter",
        function: "processUser",
        param: "options: UserOptions",
      });

      const results = await builder.executeASTPlan(plan);
      expect(results).toHaveLength(1);
      expect(results[0].diff).toContain("options: UserOptions");
    });

    it("should change return type of a function", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);

      const plan = await builder.parseIntent(
        "change return type of getUserName to Promise<string>"
      );

      // Note: This would need a more sophisticated intent parser
      // For now, we'll test the direct AST operation
      const sourceFile = builder["project"].getSourceFileOrThrow(testFile);
      const originalText = sourceFile.getFullText();

      await builder["applyASTEdit"](sourceFile, {
        kind: "changeReturnType",
        function: "getUserName",
        newType: "Promise<string>",
      });

      const modifiedText = sourceFile.getFullText();
      expect(modifiedText).toContain("Promise<string>");
      expect(modifiedText).not.toContain(": string");
    });

    it("should add an import statement", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);
      const sourceFile = builder["project"].getSourceFileOrThrow(testFile);
      const originalText = sourceFile.getFullText();

      await builder["applyASTEdit"](sourceFile, {
        kind: "addImport",
        module: "lodash",
        symbol: "debounce",
      });

      const modifiedText = sourceFile.getFullText();
      expect(modifiedText).toContain('import { debounce } from "lodash"');
    });

    it("should handle multiple edits in one file", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);

      // Create a plan with multiple edits
      const plan = {
        changes: [
          {
            filePath: testFile,
            astEdits: [
              {
                kind: "renameSymbol" as const,
                symbol: "getUserName",
                newName: "getUsername",
                scope: "file" as const,
              },
              {
                kind: "addImport" as const,
                module: "lodash",
                symbol: "debounce",
              },
            ],
          },
        ],
        tsConfigPath,
      };

      const results = await builder.executeASTPlan(plan);

      expect(results).toHaveLength(1);
      const diff = results[0].diff;
      expect(diff).toContain("getUsername");
      expect(diff).toContain('import { debounce } from "lodash"');
    });
  });

  describe("executeASTRefactor", () => {
    it("should execute a simple refactor intent", async () => {
      const results = await executeASTRefactor(
        "rename getUserName to getUsername",
        tsConfigPath
      );

      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe(testFile);
      expect(results[0].diff).toContain("getUsername");
    });

    it("should handle non-matching intent gracefully", async () => {
      const results = await executeASTRefactor(
        "rename nonExistentFunction to newName",
        tsConfigPath
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("should handle invalid tsconfig path", async () => {
      await expect(
        () => new ASTPlanBuilder("non-existent-tsconfig.json")
      ).toThrow();
    });

    it("should handle unsupported AST edit", async () => {
      const builder = new ASTPlanBuilder(tsConfigPath);
      const sourceFile = builder["project"].getSourceFileOrThrow(testFile);

      await expect(
        builder["applyASTEdit"](sourceFile, {
          kind: "unsupportedEdit" as any,
          symbol: "test",
        })
      ).rejects.toThrow("Unsupported AST edit");
    });
  });
});
