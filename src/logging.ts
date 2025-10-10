import { promises as fs } from "node:fs";

export interface LogConfig {
  enabled: boolean;
  logSteps?: boolean;
  logToolCalls?: boolean;
  logToolResults?: boolean;
  logDecisions?: boolean;
  logTranscript?: boolean;
  fileLogging?: {
    enabled: boolean;
    filePath: string;
  };
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

  const shouldLog =
    (category === "step" && config.logSteps) ||
    (category === "tool-call" && config.logToolCalls) ||
    (category === "tool-result" && config.logToolResults) ||
    (category === "decision" && config.logDecisions) ||
    (category === "transcript" && config.logTranscript);

  if (shouldLog) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${category.toUpperCase()}] ${message}`;
    const dataLine = data !== undefined ? JSON.stringify(data, null, 2) : null;

    // Console logging (if enabled)
    if (consoleLoggingEnabled) {
      console.log(`[${category.toUpperCase()}] ${message}`);
      if (dataLine) {
        console.log(dataLine);
      }
    }

    // File logging (if enabled)
    if (fileLoggingEnabled && config.fileLogging?.filePath) {
      const logContent = logLine + (dataLine ? "\n" + dataLine : "") + "\n";
      // Use fs.appendFile to avoid blocking the main thread
      fs.appendFile(config.fileLogging.filePath, logContent, "utf8").catch(
        (err) => {
          console.error("Failed to write to log file:", err);
        }
      );
    }
  }
}
