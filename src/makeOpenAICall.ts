import { LogConfig, log } from "./logging.js";
import { openai } from "./openai.js";

// Global token tracking
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

export function getTokenStats() {
  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCalls,
  };
}

export function resetTokenStats() {
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalCalls = 0;
}

export function displayTokenSummary(
  tokenStats: ReturnType<typeof getTokenStats>
) {
  console.log("\n📊 TOKEN USAGE SUMMARY:");
  console.log(`   Total API Calls: ${tokenStats.totalCalls}`);
  console.log(
    `   Input Tokens: ${tokenStats.totalInputTokens.toLocaleString()}`
  );
  console.log(
    `   Output Tokens: ${tokenStats.totalOutputTokens.toLocaleString()}`
  );
  console.log(`   Total Tokens: ${tokenStats.totalTokens.toLocaleString()}`);
  console.log(
    `   Average per Call: ${
      tokenStats.totalCalls > 0
        ? Math.round(tokenStats.totalTokens / tokenStats.totalCalls)
        : 0
    } tokens\n`
  );
}

/** ---------- API Helper Functions ---------- */
interface ApiCallOptions {
  maxRetries?: number;
  timeoutMs?: number;
  truncateTranscript?: boolean;
}
export async function makeOpenAICall(
  messages: Array<{ role: string; content: string }>,
  schema: any,
  logConfig: LogConfig,
  options: ApiCallOptions = {}
) {
  const {
    maxRetries = 3,
    timeoutMs = 120000,
    truncateTranscript = true,
  } = options;

  // Truncate transcript if it's too long to avoid context length issues
  let processedMessages = messages;
  if (truncateTranscript && messages.length > 20) {
    // Keep system message, user goal, and last 15 messages
    processedMessages = [
      messages[0], // system
      messages[1], // user goal
      ...messages.slice(-15), // last 15 messages
    ];
    log(
      logConfig,
      "step",
      `Truncated transcript from ${messages.length} to ${processedMessages.length} messages`
    );
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(
        logConfig,
        "step",
        `Making OpenAI API call (attempt ${attempt}/${maxRetries})...`
      );

      const apiCallPromise = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: processedMessages as any,
        response_format: {
          type: "json_schema",
          json_schema: schema,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `OpenAI API call timeout after ${timeoutMs / 1000} seconds`
              )
            ),
          timeoutMs
        )
      );

      const response = await Promise.race([apiCallPromise, timeoutPromise]);

      // Extract token usage from response
      const usage = response.usage;
      if (usage) {
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || 0;

        // Update global counters
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCalls += 1;

        // Log token usage for this call
        log(logConfig, "step", "OpenAI API call completed successfully", {
          tokens: {
            input: inputTokens,
            output: outputTokens,
            total: totalTokens,
          },
          cumulative: {
            input: totalInputTokens,
            output: totalOutputTokens,
            total: totalInputTokens + totalOutputTokens,
            calls: totalCalls,
          },
        });
      } else {
        log(
          logConfig,
          "step",
          "OpenAI API call completed successfully (no token usage data)"
        );
      }

      return response;
    } catch (error) {
      const errorMsg = String(error);
      log(logConfig, "step", `OpenAI API call attempt ${attempt} failed`, {
        error: errorMsg,
      });

      if (attempt === maxRetries) {
        throw error; // Re-throw on final attempt
      }

      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      log(logConfig, "step", `Retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw new Error("All retry attempts failed");
}
