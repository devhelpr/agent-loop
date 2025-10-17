import { LogConfig, log } from "../utils/logging";
import { generateObject } from "ai";
import { z } from "zod";
import { AIClient, AIProvider } from "./ai-client";

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
  provider?: AIProvider;
  model?: string;
}

export async function makeAICall(
  messages: Array<{ role: string; content: string }>,
  schema: z.ZodSchema,
  logConfig: LogConfig,
  options: ApiCallOptions = {}
) {
  const {
    maxRetries = 3,
    timeoutMs = 120000,
    truncateTranscript = true,
    provider,
    model,
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

  // Create AI client
  const aiClient = provider
    ? new AIClient({ provider, model })
    : AIClient.fromEnvironment(provider, model);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(
        logConfig,
        "step",
        `Making ${aiClient
          .getProvider()
          .toUpperCase()} API call (attempt ${attempt}/${maxRetries})...`
      );

      // Convert messages to AI SDK format
      const systemMessage = processedMessages.find((m) => m.role === "system");
      const userMessages = processedMessages.filter((m) => m.role !== "system");

      const apiCallPromise = generateObject({
        model: aiClient.getModel(),
        schema,
        messages: userMessages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        system: systemMessage?.content,
        maxOutputTokens: 4000,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `${aiClient
                  .getProvider()
                  .toUpperCase()} API call timeout after ${
                  timeoutMs / 1000
                } seconds`
              )
            ),
          timeoutMs
        )
      );

      const response = await Promise.race([apiCallPromise, timeoutPromise]);

      // Extract token usage from response
      const usage = response.usage;
      if (usage) {
        const inputTokens = usage.inputTokens || 0;
        const outputTokens = usage.outputTokens || 0;
        const totalTokens = usage.totalTokens || 0;

        // Update global counters
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCalls += 1;

        // Log token usage for this call
        log(
          logConfig,
          "step",
          `${aiClient
            .getProvider()
            .toUpperCase()} API call completed successfully`,
          {
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
          }
        );
      } else {
        log(
          logConfig,
          "step",
          `${aiClient
            .getProvider()
            .toUpperCase()} API call completed successfully (no token usage data)`
        );
      }

      // Return response in OpenAI-compatible format for backward compatibility
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(response.object),
              role: "assistant" as const,
            },
          },
        ],
        usage: usage
          ? {
              prompt_tokens: usage.inputTokens,
              completion_tokens: usage.outputTokens,
              total_tokens: usage.totalTokens,
            }
          : undefined,
      };
    } catch (error) {
      const errorMsg = String(error);
      log(
        logConfig,
        "step",
        `${aiClient
          .getProvider()
          .toUpperCase()} API call attempt ${attempt} failed`,
        {
          error: errorMsg,
        }
      );

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

// Backward compatibility function
export async function makeOpenAICall(
  messages: Array<{ role: string; content: string }>,
  schema: any,
  logConfig: LogConfig,
  options: ApiCallOptions = {}
) {
  // Convert JSON schema to Zod schema if needed
  let zodSchema: z.ZodSchema;

  if (schema && typeof schema === "object") {
    // Handle nested schema structure (like DecisionSchema)
    const actualSchema = schema.schema || schema;

    if (actualSchema && actualSchema.type === "object") {
      // Convert JSON schema to Zod schema
      zodSchema = convertJsonSchemaToZod(actualSchema);
    } else if (schema && typeof schema.parse === "function") {
      // Already a Zod schema
      zodSchema = schema;
    } else {
      // Fallback to any object
      zodSchema = z.any();
    }
  } else if (schema && typeof schema.parse === "function") {
    // Already a Zod schema
    zodSchema = schema;
  } else {
    // Fallback to any object
    zodSchema = z.any();
  }

  return makeAICall(messages, zodSchema, logConfig, {
    ...options,
    provider: options.provider || "openai",
  });
}

// Helper function to convert JSON schema to Zod schema
function convertJsonSchemaToZod(jsonSchema: any): z.ZodSchema {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.any();
  }

  if (jsonSchema.type === "object" && jsonSchema.properties) {
    const shape: Record<string, z.ZodSchema> = {};

    for (const [key, prop] of Object.entries(jsonSchema.properties)) {
      const propSchema = prop as any;
      let zodProp: z.ZodSchema;

      switch (propSchema.type) {
        case "string":
          if (propSchema.enum) {
            zodProp = z.enum(propSchema.enum);
          } else {
            zodProp = z.string();
          }
          break;
        case "number":
          zodProp = z.number();
          break;
        case "boolean":
          zodProp = z.boolean();
          break;
        case "array":
          if (propSchema.items) {
            const itemSchema = convertJsonSchemaToZod(propSchema.items);
            zodProp = z.array(itemSchema);
          } else {
            zodProp = z.array(z.any());
          }
          break;
        case "object":
          zodProp = convertJsonSchemaToZod(propSchema);
          break;
        default:
          zodProp = z.any();
      }

      if (jsonSchema.required && jsonSchema.required.includes(key)) {
        shape[key] = zodProp;
      } else {
        shape[key] = zodProp.optional();
      }
    }

    return z.object(shape);
  }

  // Handle other types
  switch (jsonSchema.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.any());
    default:
      return z.any();
  }
}
