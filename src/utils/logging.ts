import * as fs from "fs";
import { recordErrorSpan } from "./observability";

export interface LogConfig {
  enabled: boolean;
  logSteps?: boolean;
  logToolCalls?: boolean;
  logToolResults?: boolean;
  logDecisions?: boolean;
  logTranscript?: boolean;
  logErrors?: boolean; // Add error logging flag
  logPromptContext?: boolean; // Add prompt/context logging flag
  fileLogging?: {
    enabled: boolean;
    filePath: string;
  };
}

// Helper function to serialize data including errors
function serializeLogData(data: any): string | null {
  if (data === undefined || data === null) return null;

  try {
    // Handle Error objects specially to include stack traces
    if (data instanceof Error) {
      const errorObj: any = {
        errorType: "Error",
        name: data.name,
        message: data.message,
        stack: data.stack,
      };

      // Add cause if it exists (newer Node.js versions)
      if ("cause" in data) {
        errorObj.cause = data.cause;
      }

      return JSON.stringify(errorObj, null, 2);
    }

    // Handle objects that might contain errors
    if (typeof data === "object") {
      const serialized = JSON.stringify(
        data,
        (key, value) => {
          if (value instanceof Error) {
            const errorObj: any = {
              errorType: "Error",
              name: value.name,
              message: value.message,
              stack: value.stack,
            };

            if ("cause" in value) {
              errorObj.cause = value.cause;
            }

            return errorObj;
          }
          return value;
        },
        2
      );
      return serialized;
    }

    return JSON.stringify(data, null, 2);
  } catch (serializationError) {
    return `[Serialization Error: ${serializationError}] Original data: ${String(
      data
    )}`;
  }
}

// Helper function to determine if we should log
function shouldLogCategory(category: string, config: LogConfig): boolean {
  switch (category) {
    case "step":
      return config.logSteps ?? true;
    case "tool-call":
      return config.logToolCalls ?? true;
    case "tool-result":
      return config.logToolResults ?? true;
    case "decision":
      return config.logDecisions ?? true;
    case "transcript":
      return config.logTranscript ?? false;
    case "error":
      return config.logErrors ?? true;
    case "prompt-context":
      return config.logPromptContext ?? true;
    default:
      return true; // Log unknown categories by default
  }
}

export function log(
  config: LogConfig,
  category: string,
  message: string,
  data?: any
) {
  // Check environment variables for logging control
  const consoleLoggingEnabled =
    process.env.AGENT_CONSOLE_LOGGING !== "false" && config.enabled;
  const fileLoggingEnabled =
    process.env.AGENT_FILE_LOGGING === "true" && config.fileLogging?.enabled;

  if (!consoleLoggingEnabled && !fileLoggingEnabled) return;

  const shouldLog = shouldLogCategory(category, config);

  if (shouldLog) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${category.toUpperCase()}] ${message}`;
    const dataLine = serializeLogData(data);

    // Console logging (if enabled)
    if (consoleLoggingEnabled) {
      if (category === "error") {
        console.error(`[${category.toUpperCase()}] ${message}`);
      } else {
        console.log(`[${category.toUpperCase()}] ${message}`);
      }
      if (dataLine) {
        console.log(dataLine);
      }
    }

    // File logging (if enabled)
    if (fileLoggingEnabled && config.fileLogging?.filePath) {
      const logContent = logLine + (dataLine ? "\n" + dataLine : "") + "\n";
      // Use fs.appendFile to avoid blocking the main thread
      try {
        fs.appendFileSync(config.fileLogging.filePath, logContent, "utf8");
      } catch (err) {
        console.error("Failed to write to log file:", err);
      }
    }
  }
}

// Convenience function for logging errors
export async function logError(
  config: LogConfig,
  message: string,
  error: unknown,
  additionalData?: any
) {
  const errorObj: any = {};

  if (error instanceof Error) {
    errorObj.name = error.name;
    errorObj.message = error.message;
    errorObj.stack = error.stack;

    // Add cause if it exists
    if ("cause" in error) {
      errorObj.cause = error.cause;
    }
  } else {
    errorObj.value = error;
    errorObj.type = typeof error;
  }

  const errorData = {
    error: errorObj,
    ...additionalData,
  };

  log(config, "error", message, errorData);

  // Also record as a span for observability
  await recordErrorSpan(error, message.replace(/\s+/g, "_").toLowerCase(), {
    "error.log_message": message,
    ...additionalData,
  });
}

// Convenience function for logging caught exceptions
export async function logException(
  config: LogConfig,
  context: string,
  error: unknown,
  additionalData?: any
) {
  await logError(config, `Exception in ${context}`, error, additionalData);
}
