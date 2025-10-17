import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { LanguageModel } from "ai";

export type AIProvider = "openai" | "anthropic" | "google";

export interface AIClientConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
}

// Default models for each provider
const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-1.5-flash",
};

// Provider configurations
const providerConfigs = {
  openai: {
    createModel: (model: string, apiKey?: string) => {
      // AI SDK v5 automatically uses OPENAI_API_KEY from environment
      return openai(model);
    },
    getDefaultModel: () => DEFAULT_MODELS.openai,
  },
  anthropic: {
    createModel: (model: string, apiKey?: string) => {
      // AI SDK v5 automatically uses ANTHROPIC_API_KEY from environment
      return anthropic(model);
    },
    getDefaultModel: () => DEFAULT_MODELS.anthropic,
  },
  google: {
    createModel: (model: string, apiKey?: string) => {
      // AI SDK v5 automatically uses GOOGLE_API_KEY from environment
      return google(model);
    },
    getDefaultModel: () => DEFAULT_MODELS.google,
  },
};

export class AIClient {
  private model: LanguageModel;
  private provider: AIProvider;
  private modelName: string;

  constructor(config: AIClientConfig) {
    this.provider = config.provider;
    this.modelName = config.model || DEFAULT_MODELS[config.provider];

    const providerConfig = providerConfigs[config.provider];
    this.model = providerConfig.createModel(this.modelName, config.apiKey);
  }

  getModel(): LanguageModel {
    return this.model;
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  getModelName(): string {
    return this.modelName;
  }

  // Static factory methods for convenience
  static createOpenAI(model?: string, apiKey?: string): AIClient {
    return new AIClient({
      provider: "openai",
      model,
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  static createAnthropic(model?: string, apiKey?: string): AIClient {
    return new AIClient({
      provider: "anthropic",
      model,
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  static createGoogle(model?: string, apiKey?: string): AIClient {
    return new AIClient({
      provider: "google",
      model,
      apiKey: apiKey || process.env.GOOGLE_API_KEY,
    });
  }

  // Create client from environment variables
  static fromEnvironment(provider?: AIProvider, model?: string): AIClient {
    const detectedProvider = provider || detectProviderFromEnv();

    if (!detectedProvider) {
      throw new Error(
        "No AI provider detected. Please set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY"
      );
    }

    return new AIClient({
      provider: detectedProvider,
      model,
    });
  }
}

function detectProviderFromEnv(): AIProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GOOGLE_API_KEY) return "google";
  return null;
}

// For backward compatibility, create a default client
export function getDefaultAIClient(): AIClient {
  return AIClient.fromEnvironment();
}

// Export a lazy getter for the default client instance
let _defaultClient: AIClient | null = null;
export function getAIClient(): AIClient {
  if (!_defaultClient) {
    _defaultClient = AIClient.fromEnvironment();
  }
  return _defaultClient;
}
