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
  const t = cfg.thinking;
  const thinkingOn = t?.enabled === true;
  switch (cfg.id) {
    case "anthropic": {
      if (!cfg.apiKey) throw new Error("Anthropic API key is not set. Configure it in Settings.");
      const { ChatAnthropic } = await esm<AnthropicMod>("@langchain/anthropic");
      const budget = t?.budgetTokens ?? 2048;
      // When thinking is on, max_tokens must exceed the thinking budget.
      return new ChatAnthropic({
        apiKey: cfg.apiKey,
        model: cfg.model,
        ...(thinkingOn
          ? {
              thinking: { type: "enabled" as const, budget_tokens: budget },
              maxTokens: budget + 4096,
            }
          : {}),
      });
    }
    case "openai": {
      if (!cfg.apiKey) throw new Error("OpenAI API key is not set. Configure it in Settings.");
      const { ChatOpenAI } = await esm<OpenAIMod>("@langchain/openai");
      return new ChatOpenAI({
        apiKey: cfg.apiKey,
        model: cfg.model,
        configuration: cfg.baseUrl ? { baseURL: cfg.baseUrl } : undefined,
        // Only applies to reasoning models (o-series, gpt-5…); ignored otherwise.
        ...(thinkingOn && t?.effort ? { reasoningEffort: t.effort } : {}),
      });
    }
    case "google": {
      if (!cfg.apiKey) throw new Error("Google API key is not set. Configure it in Settings.");
      const { ChatGoogleGenerativeAI } = await esm<GoogleMod>("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({
        apiKey: cfg.apiKey,
        model: cfg.model,
        ...(thinkingOn
          ? {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: t?.budgetTokens ?? 2048,
              },
            }
          : {}),
      });
    }
    case "ollama": {
      const { ChatOllama } = await esm<OllamaMod>("@langchain/ollama");
      return new ChatOllama({
        baseUrl: cfg.baseUrl || "http://localhost:11434",
        model: cfg.model,
        ...(thinkingOn ? { think: true } : {}),
      });
    }
  }
}
