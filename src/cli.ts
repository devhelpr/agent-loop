#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import { runCodingAgent } from "./core/agent.js";

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
  .parse();

async function main() {
  const options = program.opts();

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    console.log("Please set your OpenAI API key:");
    console.log('export OPENAI_API_KEY="your-api-key-here"');
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
    `📊 Console logging: ${logging.enabled ? "enabled" : "disabled"}`
  );
  console.log(
    `📁 File logging: ${
      logging.fileLogging.enabled
        ? `enabled (${logging.fileLogging.filePath})`
        : "disabled"
    }`
  );
  console.log("");

  try {
    const result = await runCodingAgent(userPrompt, {
      maxSteps,
      hardCaps: {
        maxWrites,
        maxCmds: maxCommands,
      },
      testCommand,
      logging,
    });

    console.log("\n✅ Agent completed successfully!");
    console.log("📊 Final result:", result);
  } catch (error) {
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
