import { runCodingAgent } from "./core/agent";

// Export the main function for external use
export { runCodingAgent };

// If this file is run directly (not imported), show a message
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🤖 Agent Loop - AI Coding Agent");
  console.log("This is the library version. To use the CLI, run:");
  console.log("  npm install -g .");
  console.log("  agent-loop");
  console.log("\nOr run directly:");
  console.log("  npx agent-loop");
}
