import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Project, SourceFile, Diagnostic, CompilerOptions } from "ts-morph";
import {
  FileValidator,
  ValidationError,
  ValidationResult,
} from "./validator-registry";

export class TypeScriptValidator implements FileValidator {
  private project: Project;
  private compilerOptions: CompilerOptions;

  constructor() {
    this.project = new Project();
    this.compilerOptions = {
      strict: true,
      noImplicitAny: true,
      noImplicitReturns: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noPropertyAccessFromIndexSignature: true,
      noUncheckedIndexedAccess: true,
    };
  }

  canValidate(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx";
  }

  async validate(filePath: string, content: string): Promise<ValidationResult> {
    try {
      // Load tsconfig.json if it exists
      await this.loadProjectConfig(filePath);

      // Create or update source file
      const sourceFile = this.project.createSourceFile(filePath, content, {
        overwrite: true,
      });

      // Get diagnostics
      const diagnostics = sourceFile.getPreEmitDiagnostics();

      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      diagnostics.forEach((diagnostic) => {
        const error: ValidationError = {
          file: filePath,
          line: diagnostic.getLineNumber() || 1,
          column: diagnostic.getStart() || 0,
          message: diagnostic.getMessageText().toString(),
          code: diagnostic.getCode().toString(),
          severity: diagnostic.getCategory() === 1 ? "error" : "warning",
        };

        if (error.severity === "error") {
          errors.push(error);
        } else {
          warnings.push(error);
        }
      });

      return {
        success: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      // If validation fails due to parsing errors, return a basic error
      return {
        success: false,
        errors: [
          {
            file: filePath,
            line: 1,
            column: 0,
            message: `Validation failed: ${error}`,
            code: "VALIDATION_ERROR",
            severity: "error",
          },
        ],
        warnings: [],
      };
    }
  }

  async autoFix(
    filePath: string,
    content: string,
    errors: ValidationError[]
  ): Promise<string> {
    try {
      // Load project config
      await this.loadProjectConfig(filePath);

      // Create source file
      const sourceFile = this.project.createSourceFile(filePath, content, {
        overwrite: true,
      });

      // Apply basic fixes
      let fixedContent = content;

      // Fix common issues
      for (const error of errors) {
        switch (error.code) {
          case "2304": // Cannot find name
            // Try to add basic type annotations
            fixedContent = this.fixUnknownType(fixedContent, error);
            break;
          case "7006": // Parameter implicitly has 'any' type
            fixedContent = this.fixImplicitAny(fixedContent, error);
            break;
          case "6133": // Unused variable
            fixedContent = this.fixUnusedVariable(fixedContent, error);
            break;
        }
      }

      return fixedContent;
    } catch (error) {
      // If auto-fix fails, return original content
      return content;
    }
  }

  private async loadProjectConfig(filePath: string): Promise<void> {
    try {
      // Look for tsconfig.json in the file's directory and parent directories
      let currentDir = path.dirname(path.resolve(filePath));

      while (currentDir !== path.dirname(currentDir)) {
        const tsconfigPath = path.join(currentDir, "tsconfig.json");

        try {
          const tsconfigContent = await fs.readFile(tsconfigPath, "utf8");
          const tsconfig = JSON.parse(tsconfigContent);

          // Merge compiler options
          this.compilerOptions = {
            ...this.compilerOptions,
            ...tsconfig.compilerOptions,
          };

          // Set project root
          this.project = new Project({
            compilerOptions: this.compilerOptions,
            tsConfigFilePath: tsconfigPath,
          });

          break;
        } catch {
          // tsconfig.json doesn't exist in this directory, try parent
          currentDir = path.dirname(currentDir);
        }
      }
    } catch (error) {
      // Use default compiler options if no tsconfig found
      this.project = new Project({
        compilerOptions: this.compilerOptions,
      });
    }
  }

  private fixUnknownType(content: string, error: ValidationError): string {
    const lines = content.split("\n");
    const lineIndex = error.line - 1;

    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];

      // Try to add basic type annotations for common patterns
      if (line.includes("const ") && !line.includes(":")) {
        lines[lineIndex] = line.replace(/const\s+(\w+)\s*=/, "const $1: any =");
      } else if (line.includes("let ") && !line.includes(":")) {
        lines[lineIndex] = line.replace(/let\s+(\w+)\s*=/, "let $1: any =");
      } else if (line.includes("function ") && !line.includes(":")) {
        lines[lineIndex] = line.replace(
          /function\s+(\w+)\s*\(/,
          "function $1(/* TODO: add parameter types */"
        );
      }
    }

    return lines.join("\n");
  }

  private fixImplicitAny(content: string, error: ValidationError): string {
    const lines = content.split("\n");
    const lineIndex = error.line - 1;

    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];

      // Add any type annotation for parameters
      if (line.includes("(") && line.includes(")") && !line.includes(":")) {
        lines[lineIndex] = line.replace(/\(([^)]*)\)/, (match, params) => {
          const paramList = params
            .split(",")
            .map((p: string) => {
              const param = p.trim();
              if (param && !param.includes(":")) {
                return `${param}: any`;
              }
              return param;
            })
            .join(", ");
          return `(${paramList})`;
        });
      }
    }

    return lines.join("\n");
  }

  private fixUnusedVariable(content: string, error: ValidationError): string {
    const lines = content.split("\n");
    const lineIndex = error.line - 1;

    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];

      // Prefix unused variables with underscore
      if (line.includes("const ") || line.includes("let ")) {
        lines[lineIndex] = line.replace(
          /(const|let)\s+(\w+)/,
          (match, keyword, varName) => {
            return `${keyword} _${varName}`;
          }
        );
      }
    }

    return lines.join("\n");
  }
}
