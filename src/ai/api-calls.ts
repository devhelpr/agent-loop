import { LogConfig, log } from "../utils/logging";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { AIClient, AIProvider } from "./ai-client";
import { planningPrompt } from "./prompts/planning";
import { projectAnalysisPrompt } from "./prompts/project-analysis";
import { PlanStep, ExecutionPlan } from "../tools/planning";
import { ProjectAnalysis } from "../tools/project-analysis";

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
  span?: any; // OpenTelemetry span for tracing
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

      // Add detailed information to span if provided
      if (options.span) {
        const span = options.span;
        span.setAttribute("ai.call.provider", aiClient.getProvider());
        span.setAttribute("ai.call.model", aiClient.getModel());
        span.setAttribute("ai.call.model_name", aiClient.getModelName());
        span.setAttribute("ai.call.temperature", aiClient.getTemperature());
        span.setAttribute("ai.call.max_output_tokens", 4000);
        span.setAttribute("ai.call.message_count", generateObjectParams.messages.length);
        span.setAttribute("ai.call.has_system_prompt", !!generateObjectParams.system);
        if (generateObjectParams.system) {
          span.setAttribute("ai.call.system_prompt_length", generateObjectParams.system.length);
          span.setAttribute("ai.call.system_prompt", generateObjectParams.system.substring(0, 1000));
        }
        // Add user messages summary
        const userMessagesSummary = userMessages.map((msg, idx) => ({
          index: idx,
          role: msg.role,
          length: msg.content.length,
          preview: msg.content.substring(0, 200),
        }));
        span.setAttribute("ai.call.user_messages_summary", JSON.stringify(userMessagesSummary));
        span.setAttribute("ai.call.schema_info", getSchemaInfo(schema));
        span.setAttribute("ai.call.attempt", attempt);
        span.setAttribute("ai.call.max_retries", maxRetries);
      }

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

        // Add token usage to span if provided
        if (options.span) {
          const span = options.span;
          span.setAttribute("ai.call.tokens.input", inputTokens);
          span.setAttribute("ai.call.tokens.output", outputTokens);
          span.setAttribute("ai.call.tokens.total", totalTokens);
          span.setAttribute("ai.call.success", true);
        }

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

      // Add response information to span if provided
      if (options.span && response.object) {
        const span = options.span;
        const responseContent = JSON.stringify(response.object);
        span.setAttribute("ai.call.response.length", responseContent.length);
        span.setAttribute("ai.call.response.preview", responseContent.substring(0, 1000));
        span.setAttribute("ai.call.has_response", true);
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

      // Add error information to span if provided
      if (options.span) {
        const span = options.span;
        span.setAttribute("ai.call.success", false);
        span.setAttribute("ai.call.error.message", errorMsg);
        span.setAttribute("ai.call.error.attempt", attempt);
        if (error instanceof Error) {
          span.recordException?.(error);
        }
      }

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

// Generic AI call function with schema validation
export async function makeAICallWithSchema(
  messages: Array<{ role: string; content: string }>,
  schema: z.ZodSchema,
  logConfig: LogConfig,
  options: ApiCallOptions = {}
) {
  return makeAICall(messages, schema, logConfig, {
    ...options,
    provider: options.provider || "openai",
  });
}

// Planning API call function
export async function createPlanWithAI(
  userGoal: string,
  projectContext?: string,
  logConfig: LogConfig = { enabled: true, logSteps: true },
  options: ApiCallOptions = {}
): Promise<ExecutionPlan> {
  const planStepSchema = z.object({
    step: z.string().describe("Clear description of the step to be executed"),
    required: z
      .boolean()
      .describe("Whether this step is required to achieve the user's goal"),
    dependencies: z
      .array(z.string())
      .optional()
      .describe("Array of step IDs that must be completed before this step"),
  });

  const planningSchema = z.object({
    steps: z
      .array(planStepSchema)
      .describe("Array of plan steps in execution order"),
    projectContext: z
      .string()
      .optional()
      .describe("Summary of project context and technology stack"),
    userGoal: z.string().describe("The user's goal that this plan addresses"),
  });

  const messages = [
    {
      role: "system",
      content: planningPrompt,
    },
    {
      role: "user",
      content: `Create a structured execution plan for the following goal:

**User Goal:** ${userGoal}

${projectContext ? `**Project Context:** ${projectContext}` : ""}

Please analyze this goal and create a detailed, executable plan with clear steps, dependencies, and priorities. Focus on breaking down complex tasks into manageable, sequential steps.`,
    },
  ];

  log(logConfig, "planning", "Creating AI-generated execution plan", {
    userGoal,
    hasProjectContext: !!projectContext,
    provider: options.provider || "openai",
  });

  const response = await makeAICall(
    messages,
    planningSchema,
    logConfig,
    options
  );

  if (!response.choices?.[0]?.message?.content) {
    throw new Error("No content received from AI planning call");
  }

  const planData = JSON.parse(response.choices[0].message.content);

  // Convert to ExecutionPlan format
  const executionPlan: ExecutionPlan = {
    steps: planData.steps,
    projectContext: planData.projectContext || projectContext,
    createdAt: new Date(),
    userGoal: planData.userGoal || userGoal,
  };

  log(logConfig, "planning", "AI-generated plan created successfully", {
    stepCount: executionPlan.steps.length,
    requiredSteps: executionPlan.steps.filter((s) => s.required).length,
    optionalSteps: executionPlan.steps.filter((s) => !s.required).length,
  });

  return executionPlan;
}

// Project Analysis API call function
export async function analyzeProjectWithAI(
  scanDirectories: string[],
  projectFiles: string[],
  logConfig: LogConfig = { enabled: true, logSteps: true },
  options: ApiCallOptions = {}
): Promise<ProjectAnalysis> {
  const projectAnalysisSchema = z.object({
    language: z.string().describe("Primary programming language detected"),
    projectType: z
      .enum(["node", "browser", "library", "unknown"])
      .describe("Type of project"),
    buildTools: z
      .array(z.string())
      .describe("Build tools and bundlers detected"),
    testFramework: z
      .string()
      .optional()
      .describe("Testing framework if detected"),
    packageManager: z.string().optional().describe("Package manager used"),
    hasTypeScript: z.boolean().describe("Whether TypeScript is used"),
    hasReact: z.boolean().describe("Whether React is used"),
    hasVue: z.boolean().describe("Whether Vue is used"),
    hasAngular: z.boolean().describe("Whether Angular is used"),
    mainFiles: z.array(z.string()).describe("Key source files found"),
    configFiles: z.array(z.string()).describe("Configuration files found"),
    dependencies: z
      .record(z.string(), z.string())
      .describe("Production dependencies"),
    devDependencies: z
      .record(z.string(), z.string())
      .describe("Development dependencies"),
    architecture: z
      .string()
      .optional()
      .describe("Architectural patterns detected"),
    recommendations: z
      .array(z.string())
      .optional()
      .describe("Recommendations for improvements"),
  });

  const messages = [
    {
      role: "system",
      content: projectAnalysisPrompt,
    },
    {
      role: "user",
      content: `Analyze the following project structure:

**Scan Directories:** ${scanDirectories.join(", ")}

**Project Files Found:** ${projectFiles.join(", ")}

Please provide a comprehensive analysis of this project's technology stack, structure, dependencies, and architecture. Focus on identifying key technologies, patterns, and providing actionable insights.`,
    },
  ];

  log(logConfig, "project-analysis", "Performing AI-powered project analysis", {
    scanDirectories,
    fileCount: projectFiles.length,
    provider: options.provider || "openai",
  });

  const response = await makeAICall(
    messages,
    projectAnalysisSchema,
    logConfig,
    options
  );

  if (!response.choices?.[0]?.message?.content) {
    throw new Error("No content received from AI project analysis call");
  }

  const analysisData = JSON.parse(response.choices[0].message.content);

  // Convert to ProjectAnalysis format
  const projectAnalysis: ProjectAnalysis = {
    language: analysisData.language,
    projectType: analysisData.projectType,
    buildTools: analysisData.buildTools,
    testFramework: analysisData.testFramework,
    packageManager: analysisData.packageManager,
    hasTypeScript: analysisData.hasTypeScript,
    hasReact: analysisData.hasReact,
    hasVue: analysisData.hasVue,
    hasAngular: analysisData.hasAngular,
    mainFiles: analysisData.mainFiles,
    configFiles: analysisData.configFiles,
    dependencies: analysisData.dependencies,
    devDependencies: analysisData.devDependencies,
  };

  log(logConfig, "project-analysis", "AI-powered project analysis completed", {
    language: projectAnalysis.language,
    projectType: projectAnalysis.projectType,
    buildToolsCount: projectAnalysis.buildTools.length,
    hasTypeScript: projectAnalysis.hasTypeScript,
    hasReact: projectAnalysis.hasReact,
  });

  return projectAnalysis;
}
