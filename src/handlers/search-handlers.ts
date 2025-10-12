import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { search_repo } from "../tools";
import { MessageArray } from "../types/handlers";

export async function handleSearchRepo(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "search_repo") return;

  log(logConfig, "tool-call", "Executing search_repo", {
    query: decision.tool_input.query,
  });
  const out = await search_repo(decision.tool_input.query);
  log(logConfig, "tool-result", "search_repo completed", {
    hitCount: out.hits.length,
  });
  transcript.push({
    role: "assistant",
    content: `search_repo:${JSON.stringify(out)}`,
  });
}
