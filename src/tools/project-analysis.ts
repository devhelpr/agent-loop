import { promises as fs } from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";

export interface ProjectAnalysis {
  language: string;
  projectType: "node" | "browser" | "library" | "unknown";
  buildTools: string[];
  testFramework?: string;
  packageManager?: string;
  hasTypeScript: boolean;
  hasReact: boolean;
  hasVue: boolean;
  hasAngular: boolean;
  mainFiles: string[];
  configFiles: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * Finds the project root by looking for package.json upward from the current directory
 */
async function findProjectRoot(startDir: string = process.cwd()): Promise<string> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const packageJsonPath = path.join(currentDir, "package.json");
    try {
      await fs.access(packageJsonPath);
      return currentDir;
    } catch {
      // package.json doesn't exist in this directory, try parent
      currentDir = path.dirname(currentDir);
    }
  }

  // If no package.json found, return the start directory as fallback
  return path.resolve(startDir);
}

export async function analyze_project(
  scanDirectories: string[] = ["."]
): Promise<ProjectAnalysis> {
  // Find the project root to ensure we don't scan outside the project
  const projectRoot = await findProjectRoot();
  const analysis: ProjectAnalysis = {
    language: "unknown",
    projectType: "unknown",
    buildTools: [],
    hasTypeScript: false,
    hasReact: false,
    hasVue: false,
    hasAngular: false,
    mainFiles: [],
    configFiles: [],
    dependencies: {},
    devDependencies: {},
  };

  // Analyze package.json if it exists
  try {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    analysis.dependencies = packageJson.dependencies || {};
    analysis.devDependencies = packageJson.devDependencies || {};
    analysis.packageManager = "npm"; // Could detect yarn/pnpm from lock files

    // Detect project type from package.json
    if (packageJson.type === "module") {
      analysis.projectType = "node";
    } else if (packageJson.browser || packageJson.main?.endsWith(".js")) {
      analysis.projectType = "browser";
    } else if (packageJson.main || packageJson.exports) {
      analysis.projectType = "library";
    }

    // Detect frameworks
    analysis.hasReact = !!(
      analysis.dependencies.react || analysis.devDependencies.react
    );
    analysis.hasVue = !!(
      analysis.dependencies.vue || analysis.devDependencies.vue
    );
    analysis.hasAngular = !!(
      analysis.dependencies["@angular/core"] ||
      analysis.devDependencies["@angular/core"]
    );

    // Detect TypeScript
    analysis.hasTypeScript = !!(
      analysis.devDependencies.typescript || analysis.dependencies.typescript
    );

    // Detect test framework
    if (analysis.devDependencies.vitest) analysis.testFramework = "vitest";
    else if (analysis.devDependencies.jest) analysis.testFramework = "jest";
    else if (analysis.devDependencies.mocha) analysis.testFramework = "mocha";

    // Detect build tools
    if (analysis.devDependencies.typescript)
      analysis.buildTools.push("typescript");
    if (analysis.devDependencies.webpack) analysis.buildTools.push("webpack");
    if (analysis.devDependencies.vite) analysis.buildTools.push("vite");
    if (analysis.devDependencies["tsc-alias"])
      analysis.buildTools.push("tsc-alias");
  } catch (error) {
    // No package.json found, continue with file-based analysis
  }

  // Scan for files to determine language and project structure
  for (const dir of scanDirectories) {
    // Resolve directory relative to project root, not current working directory
    const resolvedDir = path.isAbsolute(dir)
      ? dir
      : path.join(projectRoot, dir);
    const normalizedDir = path.resolve(resolvedDir);

    // Ensure we don't scan outside the project root
    // Use path.relative to check if directory is within project root
    const relativePath = path.relative(projectRoot, normalizedDir);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      console.warn(
        `Skipping directory outside project root: ${dir} (resolved to ${normalizedDir})`
      );
      continue;
    }

    try {
      // Find main source files
      const sourceFiles = await fg(
        [
          "**/*.{ts,tsx,js,jsx}",
          "**/*.{py,rb,java,cpp,c,go,rs}",
          "**/*.{html,css,scss,sass}",
        ],
        {
          cwd: normalizedDir,
          ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
          absolute: false, // Return relative paths
        }
      );

      analysis.mainFiles.push(
        ...sourceFiles.map((f) => path.join(normalizedDir, f))
      );

      // Determine primary language from file extensions
      const extensions = sourceFiles.map((f) => path.extname(f));
      const extCounts = extensions.reduce((acc, ext) => {
        acc[ext] = (acc[ext] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const sortedExts = Object.entries(extCounts).sort(
        ([, a], [, b]) => b - a
      );
      if (sortedExts.length > 0) {
        const primaryExt = sortedExts[0][0];
        switch (primaryExt) {
          case ".ts":
          case ".tsx":
            analysis.language = "typescript";
            analysis.hasTypeScript = true;
            break;
          case ".js":
          case ".jsx":
            analysis.language = "javascript";
            break;
          case ".py":
            analysis.language = "python";
            break;
          case ".rb":
            analysis.language = "ruby";
            break;
          case ".java":
            analysis.language = "java";
            break;
          case ".cpp":
          case ".c":
            analysis.language = "cpp";
            break;
          case ".go":
            analysis.language = "go";
            break;
          case ".rs":
            analysis.language = "rust";
            break;
        }
      }

      // Find config files
      const configFiles = await fg(
        [
          "**/tsconfig.json",
          "**/webpack.config.*",
          "**/vite.config.*",
          "**/.eslintrc.*",
          "**/jest.config.*",
          "**/vitest.config.*",
          "**/tailwind.config.*",
          "**/next.config.*",
          "**/nuxt.config.*",
          "**/angular.json",
          "**/vue.config.*",
        ],
        {
          cwd: normalizedDir,
          ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
          absolute: false, // Return relative paths
        }
      );

      analysis.configFiles.push(
        ...configFiles.map((f) => path.join(normalizedDir, f))
      );
    } catch (error) {
      // Directory doesn't exist or can't be read, skip
    }
  }

  // Refine project type based on file analysis
  if (analysis.projectType === "unknown") {
    if (
      analysis.mainFiles.some(
        (f) => f.includes("index.html") || f.endsWith(".html")
      )
    ) {
      analysis.projectType = "browser";
    } else if (
      analysis.mainFiles.some(
        (f) =>
          f.includes("server") || f.includes("app.js") || f.includes("index.js")
      )
    ) {
      analysis.projectType = "node";
    } else if (analysis.mainFiles.length > 0) {
      analysis.projectType = "library";
    }
  }

  return analysis;
}
