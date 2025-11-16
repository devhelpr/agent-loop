import { Decision } from "../types/decision";
import { LogConfig, log } from "../utils/logging";
import { search_repo } from "../tools";
import { MessageArray } from "../types/handlers";
import { withSpan } from "../utils/observability";

export async function handleSearchRepo(
  decision: Decision,
  transcript: MessageArray,
  logConfig: LogConfig
) {
  if (decision.action !== "search_repo") return;

  const query = decision.tool_input.query;
  log(logConfig, "tool-call", "Executing search_repo", {
    query,
  });
  
  const out = await withSpan("tool.search_repo", async (span) => {
    if (span) {
      span.setAttribute("tool.name", "search_repo");
      span.setAttribute("tool.input.query", query);
    }
    const result = await search_repo(query);
    if (span) {
      span.setAttribute("tool.output.hit_count", result.hits.length);
    }
    return result;
  });
  
  log(logConfig, "tool-result", "search_repo completed", {
    hitCount: out.hits.length,
  });
  transcript.push({
    role: "assistant",
    content: `search_repo:${JSON.stringify(out)}`,
  });
}
