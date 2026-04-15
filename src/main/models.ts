import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProviderConfig } from "../shared/api";

type AnthropicMod = typeof import("@langchain/anthropic");
type OpenAIMod = typeof import("@langchain/openai");
type GoogleMod = typeof import("@langchain/google-genai");
type OllamaMod = typeof import("@langchain/ollama");

function esm<T>(spec: string): Promise<T> {
  return Function(`return import("${spec}")`)() as Promise<T>;
}

export async function buildChatModel(cfg: ProviderConfig): Promise<BaseChatModel> {
  switch (cfg.id) {
    case "anthropic": {
      if (!cfg.apiKey) throw new Error("Anthropic API key is not set. Configure it in Settings.");
      const { ChatAnthropic } = await esm<AnthropicMod>("@langchain/anthropic");
      return new ChatAnthropic({ apiKey: cfg.apiKey, model: cfg.model });
    }
    case "openai": {
      if (!cfg.apiKey) throw new Error("OpenAI API key is not set. Configure it in Settings.");
      const { ChatOpenAI } = await esm<OpenAIMod>("@langchain/openai");
      return new ChatOpenAI({
        apiKey: cfg.apiKey,
        model: cfg.model,
        configuration: cfg.baseUrl ? { baseURL: cfg.baseUrl } : undefined,
      });
    }
    case "google": {
      if (!cfg.apiKey) throw new Error("Google API key is not set. Configure it in Settings.");
      const { ChatGoogleGenerativeAI } = await esm<GoogleMod>("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ apiKey: cfg.apiKey, model: cfg.model });
    }
    case "ollama": {
      const { ChatOllama } = await esm<OllamaMod>("@langchain/ollama");
      return new ChatOllama({
        baseUrl: cfg.baseUrl || "http://localhost:11434",
        model: cfg.model,
      });
    }
  }
}
