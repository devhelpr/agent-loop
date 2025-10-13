import OpenAI from "openai";

let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000, // 2 minutes timeout
      maxRetries: 2,
    });
  }
  return _openai;
}

// For backward compatibility
export const openai = {
  get chat() {
    return getOpenAI().chat;
  },
  get completions() {
    return getOpenAI().completions;
  },
};
