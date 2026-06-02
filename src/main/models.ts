import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProviderConfig } from "../shared/api";

type AnthropicMod = typeof import("@langchain/anthropic");
type OpenAIMod = typeof import("@langchain/openai");
type GoogleMod = typeof import("@langchain/google-genai");
type OllamaMod = typeof import("@langchain/ollama");
type BedrockMod = typeof import("@langchain/aws");

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
        ...(cfg.baseUrl ? { anthropicApiUrl: cfg.baseUrl } : {}),
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
    case "bedrock": {
      const { ChatBedrockConverse } = await esm<BedrockMod>("@langchain/aws");
      const budget = t?.budgetTokens ?? 2048;
      // Explicit access key + secret override the default AWS credential chain;
      // omit both to fall back to env vars / ~/.aws / instance role.
      const haveKeys = Boolean(cfg.accessKeyId && cfg.secretAccessKey);
      // Custom endpoint host for company proxies / VPC (PrivateLink) endpoints.
      // The SDK prepends https://, so strip any scheme or trailing slash the user pasted.
      const endpointHost = cfg.baseUrl?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      return new ChatBedrockConverse({
        model: cfg.model,
        ...(cfg.region ? { region: cfg.region } : {}),
        ...(endpointHost ? { endpointHost } : {}),
        ...(haveKeys
          ? { bedrockApiKey: cfg.accessKeyId, bedrockApiSecret: cfg.secretAccessKey }
          : {}),
        // Anthropic extended thinking on Converse goes through additionalModelRequestFields;
        // max_tokens must exceed the reasoning budget.
        ...(thinkingOn
          ? {
              maxTokens: budget + 4096,
              additionalModelRequestFields: {
                reasoning_config: { type: "enabled", budget_tokens: budget },
              },
            }
          : {}),
      });
    }
  }
}
