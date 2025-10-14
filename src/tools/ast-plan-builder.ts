import { Project, SourceFile, Node, Symbol } from "ts-morph";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  FileChangePlan,
  Plan,
  applyEditsToText,
  generateUnifiedDiffForFile,
} from "./patch-generator";

// AST-based edit types
export type ASTEdit =
  | {
      kind: "renameSymbol";
      symbol: string;
      newName: string;
      scope: "file" | "project";
    }
  | {
      kind: "addParameter";
      function: string;
      param: string;
      defaultValue?: string;
    }
  | { kind: "changeReturnType"; function: string; newType: string }
  | { kind: "moveSymbol"; symbol: string; fromFile: string; toFile: string }
  | { kind: "addImport"; module: string; symbol: string; alias?: string }
  | { kind: "removeImport"; module: string; symbol: string }
  | { kind: "addExport"; symbol: string; isDefault?: boolean }
  | { kind: "removeExport"; symbol: string };

export type ASTFileChangePlan = {
  filePath: string;
  astEdits: ASTEdit[];
};

export type ASTPlan = {
  changes: ASTFileChangePlan[];
  tsConfigPath?: string;
};

export class ASTPlanBuilder {
  private project: Project;
  private tsConfigPath: string;

  constructor(tsConfigPath: string = "tsconfig.json") {
    this.tsConfigPath = tsConfigPath;
    this.project = new Project({ tsConfigFilePath: tsConfigPath });
  }

  /**
   * Parse LLM intent and convert to AST operations
   * This is a simplified parser - in practice, you'd use more sophisticated NLP
   */
  async parseIntent(intent: string): Promise<ASTPlan> {
    const changes: ASTFileChangePlan[] = [];

    // Simple pattern matching for common intents
    const renameMatch = intent.match(/rename\s+(\w+)\s+to\s+(\w+)/i);
    if (renameMatch) {
      const [, oldName, newName] = renameMatch;
      // For now, assume single file - in practice, you'd search the project
      const sourceFiles = this.project.getSourceFiles();
      for (const sourceFile of sourceFiles) {
        const hasSymbol = this.findSymbolsInFile(sourceFile, oldName);
        if (hasSymbol) {
          changes.push({
            filePath: sourceFile.getFilePath(),
            astEdits: [
              { kind: "renameSymbol", symbol: oldName, newName, scope: "file" },
            ],
          });
        }
      }
    }

    const addParamMatch = intent.match(
      /add\s+parameter\s+([^:]+):\s*([^:]+)\s+to\s+function\s+(\w+)/i
    );
    if (addParamMatch) {
      const [, paramName, paramType, functionName] = addParamMatch;
      const param = `${paramName.trim()}: ${paramType.trim()}`;
      const sourceFiles = this.project.getSourceFiles();
      for (const sourceFile of sourceFiles) {
        const functions = this.findFunctionsInFile(sourceFile, functionName);
        if (functions.length > 0) {
          changes.push({
            filePath: sourceFile.getFilePath(),
            astEdits: [{ kind: "addParameter", function: functionName, param }],
          });
        }
      }
    }

    return { changes, tsConfigPath: this.tsConfigPath };
  }

  /**
   * Execute AST plan and generate unified diffs
   */
  async executeASTPlan(
    plan: ASTPlan
  ): Promise<Array<{ filePath: string; diff: string }>> {
    const results: Array<{ filePath: string; diff: string }> = [];

    for (const { filePath, astEdits } of plan.changes) {
      try {
        const sourceFile = this.project.getSourceFileOrThrow(filePath);
        const originalText = sourceFile.getFullText();

        // Apply AST edits
        for (const edit of astEdits) {
          await this.applyASTEdit(sourceFile, edit);
        }

        const modifiedText = sourceFile.getFullText();

        // Generate diff
        const diff = generateUnifiedDiffForFile(
          filePath,
          originalText,
          modifiedText
        );
        results.push({ filePath, diff });
      } catch (error) {
        console.error(`Failed to apply AST edits to ${filePath}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Convert AST plan to traditional FileChangePlan for compatibility
   */
  async convertToFileChangePlan(plan: ASTPlan): Promise<Plan> {
    const changes: FileChangePlan[] = [];

    for (const { filePath, astEdits } of plan.changes) {
      const sourceFile = this.project.getSourceFileOrThrow(filePath);
      const originalText = sourceFile.getFullText();

      // Apply AST edits to get modified text
      for (const edit of astEdits) {
        await this.applyASTEdit(sourceFile, edit);
      }

      const modifiedText = sourceFile.getFullText();

      // Convert to traditional edits by comparing texts
      const edits = this.textToEdits(originalText, modifiedText);
      changes.push({ filePath, edits });
    }

    return { changes };
  }

  private async applyASTEdit(
    sourceFile: SourceFile,
    edit: ASTEdit
  ): Promise<void> {
    switch (edit.kind) {
      case "renameSymbol":
        await this.renameSymbol(
          sourceFile,
          edit.symbol,
          edit.newName,
          edit.scope
        );
        break;
      case "addParameter":
        await this.addParameter(
          sourceFile,
          edit.function,
          edit.param,
          edit.defaultValue
        );
        break;
      case "changeReturnType":
        await this.changeReturnType(sourceFile, edit.function, edit.newType);
        break;
      case "addImport":
        await this.addImport(sourceFile, edit.module, edit.symbol, edit.alias);
        break;
      case "removeImport":
        await this.removeImport(sourceFile, edit.module, edit.symbol);
        break;
      default:
        throw new Error(`Unsupported AST edit: ${edit.kind}`);
    }
  }

  private async renameSymbol(
    sourceFile: SourceFile,
    symbolName: string,
    newName: string,
    scope: "file" | "project"
  ): Promise<void> {
    // Find function declarations
    const functions = sourceFile.getFunctions();
    for (const func of functions) {
      if (func.getName() === symbolName) {
        func.rename(newName);
      }
    }

    // Find variable declarations
    const variableDeclarations = sourceFile.getVariableDeclarations();
    for (const decl of variableDeclarations) {
      if (decl.getName() === symbolName) {
        decl.rename(newName);
      }
    }

    // Rename all references (identifiers)
    const identifiers = sourceFile.getDescendantsOfKind("Identifier" as any);
    for (const identifier of identifiers) {
      if (identifier.getText() === symbolName) {
        identifier.replaceWithText(newName);
      }
    }
  }

  private async addParameter(
    sourceFile: SourceFile,
    functionName: string,
    param: string,
    defaultValue?: string
  ): Promise<void> {
    const functions = this.findFunctionsInFile(sourceFile, functionName);

    for (const func of functions) {
      const parameters = func.getParameters();
      const newParam = func.addParameter({
        name: param.split(":")[0].trim(),
        type: param.includes(":") ? param.split(":")[1].trim() : undefined,
        initializer: defaultValue,
      });
    }
  }

  private async changeReturnType(
    sourceFile: SourceFile,
    functionName: string,
    newType: string
  ): Promise<void> {
    const functions = this.findFunctionsInFile(sourceFile, functionName);

    for (const func of functions) {
      func.setReturnType(newType);
    }
  }

  private async addImport(
    sourceFile: SourceFile,
    module: string,
    symbol: string,
    alias?: string
  ): Promise<void> {
    const importDeclaration = sourceFile.addImportDeclaration({
      moduleSpecifier: module,
      namedImports: [{ name: symbol, alias }],
    });
  }

  private async removeImport(
    sourceFile: SourceFile,
    module: string,
    symbol: string
  ): Promise<void> {
    const importDeclarations = sourceFile.getImportDeclarations();

    for (const importDecl of importDeclarations) {
      if (importDecl.getModuleSpecifierValue() === module) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === symbol) {
            namedImport.remove();
          }
        }
      }
    }
  }

  private findSymbolsInFile(
    sourceFile: SourceFile,
    symbolName: string
  ): boolean {
    // Check if symbol exists in the file
    const functions = sourceFile.getFunctions();
    for (const func of functions) {
      if (func.getName() === symbolName) {
        return true;
      }
    }

    const variableDeclarations = sourceFile.getVariableDeclarations();
    for (const decl of variableDeclarations) {
      if (decl.getName() === symbolName) {
        return true;
      }
    }

    return false;
  }

  private findFunctionsInFile(
    sourceFile: SourceFile,
    functionName: string
  ): any[] {
    return sourceFile
      .getFunctions()
      .filter((func) => func.getName() === functionName);
  }

  private textToEdits(
    originalText: string,
    modifiedText: string
  ): FileChangePlan["edits"] {
    // Simple implementation - in practice, you'd use a more sophisticated diff algorithm
    const edits: FileChangePlan["edits"] = [];

    if (originalText !== modifiedText) {
      // For now, treat as a single replacement
      edits.push({
        kind: "replaceRange",
        start: 0,
        end: originalText.length,
        replace: modifiedText,
      });
    }

    return edits;
  }

  /**
   * Save all modified files
   */
  async save(): Promise<void> {
    await this.project.save();
  }
}

/**
 * Convenience function to create and execute an AST plan
 */
export async function executeASTRefactor(
  intent: string,
  tsConfigPath: string = "tsconfig.json"
): Promise<Array<{ filePath: string; diff: string }>> {
  const builder = new ASTPlanBuilder(tsConfigPath);
  const plan = await builder.parseIntent(intent);
  return await builder.executeASTPlan(plan);
}
