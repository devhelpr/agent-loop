#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import { runCodingAgent } from "./core/agent.js";
import { AIProvider } from "./ai/ai-client.js";

const program = new Command();

program
  .name("agent-loop")
  .description(
    "AI coding agent that iteratively edits a repository to satisfy your goals"
  )
  .version("1.0.0");

// Add command line options
program
  .option(
    "-p, --prompt <prompt>",
    "Direct prompt to execute (skips interactive mode)"
  )
  .option(
    "-m, --max-steps <number>",
    "Maximum number of steps to execute",
    "20"
  )
  .option("-w, --max-writes <number>", "Maximum number of file writes", "10")
  .option(
    "-c, --max-commands <number>",
    "Maximum number of commands to run",
    "20"
  )
  .option("--no-console-log", "Disable console logging")
  .option("--file-log", "Enable file logging")
  .option("--log-file <path>", "Log file path", "agent-log.txt")
  .option(
    "--test-command <command>",
    "Test command to run (default: npm test --silent)"
  )
  .option("--test-args <args>", "Test command arguments (comma-separated)")
  .option(
    "--timeout <seconds>",
    "Maximum time to wait for agent completion (default: 300 seconds, 0 = no timeout)",
    "300"
  )
  .option(
    "--provider <provider>",
    "AI provider to use (openai, anthropic, google)",
    "openai"
  )
  .option("--model <model>", "Specific model to use (optional)")
  .parse();

async function main() {
  const options = program.opts();

  // Check for AI provider API key
  const provider = options.provider as AIProvider;
  const requiredEnvVars = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
    ollama: null, // Ollama doesn't require an API key
  };

  const requiredEnvVar = requiredEnvVars[provider];
  if (requiredEnvVar && !process.env[requiredEnvVar]) {
    console.error(
      `❌ Error: ${requiredEnvVar} environment variable is not set`
    );
    console.log(`Please set your ${provider} API key:`);
    console.log(`export ${requiredEnvVar}="your-api-key-here"`);
    console.log("\nSupported providers:");
    console.log('  - OpenAI: export OPENAI_API_KEY="your-key"');
    console.log('  - Anthropic: export ANTHROPIC_API_KEY="your-key"');
    console.log('  - Google: export GOOGLE_API_KEY="your-key"');
    console.log("  - Ollama: No API key required (runs locally)");
    process.exit(1);
  }

  let userPrompt: string;

  // Get user prompt
  if (options.prompt) {
    userPrompt = options.prompt;
    console.log(`🎯 Using prompt: ${userPrompt}`);
  } else {
    // Interactive mode
    console.log("🤖 Agent Loop - AI Coding Agent");
    console.log(
      "This agent will help you accomplish coding tasks by iteratively editing your repository.\n"
    );

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "prompt",
        message: "What would you like the agent to help you with?",
        validate: (input: string) => {
          if (!input.trim()) {
            return "Please enter a prompt describing what you want to accomplish";
          }
          return true;
        },
      },
    ]);

    userPrompt = answers.prompt;
  }

  // Parse numeric options
  const maxSteps = parseInt(options.maxSteps, 10);
  const maxWrites = parseInt(options.maxWrites, 10);
  const maxCommands = parseInt(options.maxCommands, 10);
  const timeoutSeconds = parseInt(options.timeout, 10);

  // Parse test command
  let testCommand = { cmd: "npm", args: ["test", "--silent"] };
  if (options.testCommand) {
    testCommand.cmd = options.testCommand;
    if (options.testArgs) {
      testCommand.args = options.testArgs
        .split(",")
        .map((arg: string) => arg.trim());
    }
  }

  // Configure logging
  const logging = {
    enabled: options.consoleLog !== false,
    fileLogging: {
      enabled: options.fileLog || false,
      filePath: options.logFile,
    },
  };

  console.log("\n🚀 Starting agent with the following configuration:");
  console.log(`📝 Prompt: ${userPrompt}`);
  console.log(`🔄 Max steps: ${maxSteps}`);
  console.log(`📝 Max writes: ${maxWrites}`);
  console.log(`⚡ Max commands: ${maxCommands}`);
  console.log(
    `🧪 Test command: ${testCommand.cmd} ${testCommand.args.join(" ")}`
  );
  console.log(
    `⏱️  Timeout: ${
      timeoutSeconds === 0 ? "disabled" : `${timeoutSeconds} seconds`
    }`
  );
  console.log(
    `📊 Console logging: ${logging.enabled ? "enabled" : "disabled"}`
  );
  console.log(
    `📁 File logging: ${
      logging.fileLogging.enabled
        ? `enabled (${logging.fileLogging.filePath})`
        : "disabled"
    }`
  );
  console.log(
    `🤖 AI Provider: ${provider}${options.model ? ` (${options.model})` : ""}`
  );
  console.log("");

  // Set up configurable timeout if specified
  let timeoutId: NodeJS.Timeout | null = null;
  if (timeoutSeconds > 0) {
    timeoutId = setTimeout(() => {
      console.log(
        `⚠️  Process timeout after ${timeoutSeconds} seconds - forcing exit`
      );
      process.exit(0);
    }, timeoutSeconds * 1000);
  }

  try {
    const result = await runCodingAgent(userPrompt, {
      maxSteps,
      hardCaps: {
        maxWrites,
        maxCmds: maxCommands,
      },
      testCommand,
      logging,
      aiProvider: provider,
      aiModel: options.model,
    });

    // Clear timeout since we completed successfully
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    console.log("\n✅ Agent completed successfully!");
    console.log("📊 Final result:", result);

    // Force exit immediately to ensure the process terminates
    process.exit(0);
  } catch (error) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    console.error("\n❌ Agent execution failed:", error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the CLI
main().catch((error) => {
  console.error("❌ CLI execution failed:", error);
  process.exit(1);
});
