import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execa } from "execa";

describe("CLI", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should show help when --help is passed", async () => {
    const { stdout } = await execa("node", ["dist/src/cli.js", "--help"]);
    expect(stdout).toContain("Usage: agent-loop [options]");
    expect(stdout).toContain(
      "AI coding agent that iteratively edits a repository"
    );
  });

  it("should show version when --version is passed", async () => {
    const { stdout } = await execa("node", ["dist/src/cli.js", "--version"]);
    expect(stdout.trim()).toBe("1.0.0");
  });

  it("should show error when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    try {
      await execa("node", ["dist/src/cli.js", "--prompt", "test"]);
    } catch (error: any) {
      expect(error.exitCode).toBe(1);
      expect(error.stdout).toContain("Please set your OpenAI API key:");
    }
  });

  it("should accept prompt via command line argument", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    try {
      await execa(
        "node",
        ["dist/src/cli.js", "--prompt", "Create a simple HTML page"],
        { timeout: 5000 }
      );
    } catch (error: any) {
      // This will fail because we don't have a real API key, but it should get past the API key check
      expect(error.stdout).toContain(
        "🎯 Using prompt: Create a simple HTML page"
      );
    }
  });

  it("should exit cleanly after completion", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const startTime = Date.now();
    try {
      await execa(
        "node",
        ["dist/src/cli.js", "--prompt", "Create a simple HTML page"],
        { timeout: 10000 }
      );
    } catch (error: any) {
      const duration = Date.now() - startTime;
      // Should exit within reasonable time (not hang)
      expect(duration).toBeLessThan(8000);
    }
  });
});
