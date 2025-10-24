import { LogConfig, log } from "../utils/logging";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
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

// Helper function to extract meaningful schema information for logging
function getSchemaInfo(schema: z.ZodSchema): string {
  try {
    // Access the internal definition with proper typing
    const def = (schema as any)._def;

    // Try to get the schema name or description
    if (def && def.description) {
      return def.description;
    }

    // For Zod object schemas, try to extract field information
    if (def && def.type === "object" && def.shape) {
      const shape = def.shape; // It's a getter, not a function
      const fields = Object.keys(shape);
      return `ZodObject with fields: ${fields.join(", ")}`;
    }

    // For other Zod types, show the type
    if (def && def.type) {
      return `Zod${def.type.charAt(0).toUpperCase() + def.type.slice(1)}`;
    }

    // Fallback to a generic description
    return "Zod schema (structured output)";
  } catch (error) {
    return "Zod schema (unable to inspect)";
  }
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

      // Log detailed schema information for debugging
      log(
        logConfig,
        "debug",
        `Schema details for ${aiClient.getProvider().toUpperCase()} call`,
        {
          schemaType: getSchemaInfo(schema),
          schemaConstructor: schema.constructor.name,
          hasDescription: !!(schema as any)._def?.description,
          isZodObject: (schema as any)._def?.typeName === "ZodObject",
        }
      );

      // Convert messages to AI SDK format
      const systemMessage = processedMessages.find((m) => m.role === "system");
      const userMessages = processedMessages.filter((m) => m.role !== "system");

      // Log prompt and context information
      log(
        logConfig,
        "prompt-context",
        `Prompt and context for ${aiClient
          .getProvider()
          .toUpperCase()} API call`,
        {
          systemPrompt: systemMessage?.content || "No system prompt",
          userMessages: userMessages.map((msg, index) => ({
            index: index + 1,
            role: msg.role,
            content: msg.content,
            contentLength: msg.content.length,
            preview:
              msg.content.substring(0, 200) +
              (msg.content.length > 200 ? "..." : ""),
          })),
          totalMessages: processedMessages.length,
          schema: getSchemaInfo(schema),
          model: aiClient.getModel(),
          provider: aiClient.getProvider(),
        }
      );

      // Log the actual parameters being sent to generateObject
      const generateObjectParams = {
        model: aiClient.getModel(),
        schema,
        messages: userMessages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        system: systemMessage?.content,
        maxOutputTokens: 4000,
        temperature: aiClient.getTemperature(),
      };

      log(
        logConfig,
        "debug",
        `generateObject parameters for ${aiClient.getProvider().toUpperCase()}`,
        {
          modelName: aiClient.getModelName(),
          messageCount: generateObjectParams.messages.length,
          hasSystemPrompt: !!generateObjectParams.system,
          systemPromptLength: generateObjectParams.system?.length || 0,
          maxOutputTokens: generateObjectParams.maxOutputTokens,
          temperature: generateObjectParams.temperature,
          schemaInfo: getSchemaInfo(schema),
        }
      );

      const apiCallPromise = generateObject(generateObjectParams);

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

      // Enhanced error logging for schema validation failures
      if (NoObjectGeneratedError.isInstance(error)) {
        log(
          logConfig,
          "step",
          `${aiClient
            .getProvider()
            .toUpperCase()} API call attempt ${attempt} failed - Schema validation error, trying fallback`,
          {
            error: errorMsg,
            cause: error.cause,
            generatedText: error.text
              ? error.text.substring(0, 500) +
                (error.text.length > 500 ? "..." : "")
              : "No text generated",
            response: error.response,
            usage: error.usage,
          }
        );

        // Try fallback with generateText if we have generated text
        if (error.text && attempt === maxRetries) {
          try {
            log(
              logConfig,
              "step",
              "Attempting fallback parsing of generated text"
            );

            // Try to repair and parse the generated text
            const repairedText = repairMalformedJSON(error.text);
            const parsedText = JSON.parse(repairedText);

            // Validate against the schema manually
            const validatedObject = schema.parse(parsedText);

            log(logConfig, "step", "Fallback parsing successful");

            // Return in the same format as generateObject
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify(validatedObject),
                    role: "assistant" as const,
                  },
                },
              ],
              usage: error.usage
                ? {
                    prompt_tokens: error.usage.inputTokens,
                    completion_tokens: error.usage.outputTokens,
                    total_tokens: error.usage.totalTokens,
                  }
                : undefined,
            };
          } catch (fallbackError) {
            log(logConfig, "step", "Fallback parsing also failed", {
              fallbackError: String(fallbackError),
            });
          }
        }
      } else {
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
      }

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

// Helper function to repair malformed JSON responses
function repairMalformedJSON(text: string): string {
  try {
    // First, try to parse as-is
    const parsed = JSON.parse(text);

    // Check if tool_input is a string that contains XML-like content
    if (parsed.tool_input && typeof parsed.tool_input === "string") {
      const toolInputStr = parsed.tool_input;

      // Handle XML-like parameter syntax (both complete and incomplete tags)
      // Example: "\n<parameter name=\"files\">[\"App.tsx\"]</parameter>"
      // Example: "\n<parameter name=\"paths\">[\"App.tsx\", \"src/App.tsx\"]" (incomplete)
      const xmlParamMatch = toolInputStr.match(
        /\n<parameter\s+name="([^"]+)">([^<]+)(?:<\/parameter>)?/
      );
      if (xmlParamMatch) {
        const [, paramName, paramValue] = xmlParamMatch;
        try {
          const parsedValue = JSON.parse(paramValue);
          parsed.tool_input = { [paramName]: parsedValue };
        } catch {
          parsed.tool_input = { [paramName]: paramValue };
        }
        return JSON.stringify(parsed);
      }

      // Handle other XML-like patterns
      const xmlTagMatches = toolInputStr.match(/<([^>]+)>([^<]+)<\/[^>]+>/g);
      if (xmlTagMatches) {
        const toolInputObj: Record<string, any> = {};
        xmlTagMatches.forEach((match: string) => {
          const tagMatch = match.match(/<([^>]+)>([^<]+)<\/[^>]+>/);
          if (tagMatch) {
            const [, tagName, value] = tagMatch;
            try {
              toolInputObj[tagName] = JSON.parse(value);
            } catch {
              toolInputObj[tagName] = value;
            }
          }
        });
        parsed.tool_input = toolInputObj;
        return JSON.stringify(parsed);
      }
    }

    return text;
  } catch (error) {
    // If parsing fails, try to repair common issues

    // Handle XML-like parameter syntax in tool_input
    // Example: "tool_input": "\n<parameter name=\"files\">[\"App.tsx\"]"
    let repaired = text;

    // Fix XML-like parameter syntax (both complete and incomplete tags)
    const xmlParamRegex =
      /"tool_input":\s*"\\n<parameter\s+name=\\"([^"]+)\\">([^<]+)(?:<\/parameter>)?"/g;
    repaired = repaired.replace(
      xmlParamRegex,
      (match, paramName, paramValue) => {
        try {
          // Try to parse the parameter value as JSON
          const parsedValue = JSON.parse(paramValue);
          return `"tool_input": ${JSON.stringify({
            [paramName]: parsedValue,
          })}`;
        } catch {
          // If parsing fails, treat as string
          return `"tool_input": ${JSON.stringify({ [paramName]: paramValue })}`;
        }
      }
    );

    // Fix other common XML-like patterns
    const xmlValueRegex = /"tool_input":\s*"\\n<([^>]+)>([^<]+)<\/[^>]+>"/g;
    repaired = repaired.replace(xmlValueRegex, (match, tagName, value) => {
      try {
        const parsedValue = JSON.parse(value);
        return `"tool_input": ${JSON.stringify(parsedValue)}`;
      } catch {
        return `"tool_input": ${JSON.stringify({ [tagName]: value })}`;
      }
    });

    // Fix escaped quotes in strings
    repaired = repaired.replace(/\\"/g, '"');

    // Fix common JSON syntax issues
    repaired = repaired.replace(/,(\s*[}\]])/g, "$1"); // Remove trailing commas
    repaired = repaired.replace(
      /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
      '$1"$2":'
    ); // Quote unquoted keys

    return repaired;
  }
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

      // Make tool_input optional to be more permissive with schema validation
      // The actual validation is handled by validateDecision function in agent.ts
      if (key === "tool_input") {
        shape[key] = zodProp.optional();
      } else if (jsonSchema.required && jsonSchema.required.includes(key)) {
        shape[key] = zodProp;
      } else {
        shape[key] = zodProp.optional();
      }
    }

    return z
      .object(shape)
      .describe(
        `JSON Schema converted to Zod: ${jsonSchema.title || "Object"}`
      );
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
