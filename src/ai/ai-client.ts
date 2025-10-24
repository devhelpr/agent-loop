import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { ollama } from "ai-sdk-ollama";
import { LanguageModel } from "ai";

export type AIProvider = "openai" | "anthropic" | "google" | "ollama";

export interface AIClientConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
  temperature?: number;
}

// Default models for each provider
const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  ollama: "granite4:tiny-h",
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
  ollama: {
    createModel: (model: string, apiKey?: string) => {
      // Ollama typically runs locally and doesn't require API keys
      // The baseURL can be configured via OLLAMA_BASE_URL environment variable
      return ollama(model);
    },
    getDefaultModel: () => DEFAULT_MODELS.ollama,
  },
};

export class AIClient {
  private model: LanguageModel;
  private provider: AIProvider;
  private modelName: string;
  private temperature: number;

  constructor(config: AIClientConfig) {
    this.provider = config.provider;
    this.modelName = config.model || DEFAULT_MODELS[config.provider];
    this.temperature = config.temperature ?? 0.0; // Default to minimum temperature for deterministic responses

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

  getTemperature(): number {
    return this.temperature;
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

  static createOllama(model?: string, apiKey?: string): AIClient {
    return new AIClient({
      provider: "ollama",
      model,
      apiKey, // Ollama typically doesn't use API keys
    });
  }

  // Create client from environment variables
  static fromEnvironment(provider?: AIProvider, model?: string): AIClient {
    const detectedProvider = provider || detectProviderFromEnv();

    if (!detectedProvider) {
      throw new Error(
        "No AI provider detected. Please set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or use 'ollama' provider"
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
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST) return "ollama";
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
