import { runCodingAgent } from "./core/agent";

console.log(
  "🚀 Starting agent - API key:",
  process.env.OPENAI_API_KEY ? "***set***" : "❌ NOT SET"
);
console.log(
  "📊 Environment - Console logging:",
  process.env.AGENT_CONSOLE_LOGGING || "default"
);
console.log(
  "📁 Environment - File logging:",
  process.env.AGENT_FILE_LOGGING || "default"
);

// Export the main function for external use
export { runCodingAgent };

//   "Create two files: 1) util/titleCase.ts with a titleCase function, and 2) my-file.ts that imports and exports the titleCase function. Both files should be created from scratch."
// "Create a my-website.html which is beautiful/modern/fancy/responsive and use vanilla CSS: let it tell a story about AI and the future. Add a style.css file and make it look great."
runCodingAgent(
  "Create a my-game.html which is an arcarde-style asteroids game and is retro.beautiful/modern/fancy/responsive and use vanilla CSS AND JS. Add game.css and game.js files and make it look great.  "
)
  .then((r) => {
    console.log("\n=== FINAL RESULT ===", r);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Agent execution failed:", error);
    process.exit(1);
  });
