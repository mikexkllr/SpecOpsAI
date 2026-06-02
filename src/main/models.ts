import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import type { ProviderConfig } from "../shared/api";

type AnthropicMod = typeof import("@langchain/anthropic");
type OpenAIMod = typeof import("@langchain/openai");
type GoogleMod = typeof import("@langchain/google-genai");
type OllamaMod = typeof import("@langchain/ollama");
type BedrockMod = typeof import("@langchain/aws");
type BedrockSdkMod = typeof import("@aws-sdk/client-bedrock-runtime");

function esm<T>(spec: string): Promise<T> {
  return Function(`return import("${spec}")`)() as Promise<T>;
}

// Whether the AWS default credential chain has any chance of resolving without
// explicit keys: env vars, a named profile, a web-identity/container role, or a
// shared credentials/config file. Used only to turn the cryptic SDK error
// ("Could not load credentials from any provider") into an actionable one.
function hasAmbientAwsCredentials(): boolean {
  const e = process.env;
  if (e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY) return true;
  if (
    e.AWS_PROFILE ||
    e.AWS_BEARER_TOKEN_BEDROCK ||
    e.BEDROCK_AWS_ACCESS_KEY_ID ||
    e.AWS_WEB_IDENTITY_TOKEN_FILE ||
    e.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    e.AWS_CONTAINER_CREDENTIALS_FULL_URI
  ) {
    return true;
  }
  const home = os.homedir();
  const credFile = e.AWS_SHARED_CREDENTIALS_FILE || path.join(home, ".aws", "credentials");
  const cfgFile = e.AWS_CONFIG_FILE || path.join(home, ".aws", "config");
  return fs.existsSync(credFile) || fs.existsSync(cfgFile);
}

// Secret-safe preview of a credential: enough to confirm the right value is
// flowing (prefix + length) without ever logging the full key. Never used on
// the secret access key — only its length is logged.
function maskKey(v?: string): string {
  if (!v) return "(none)";
  if (v.length <= 6) return `${"*".repeat(v.length)} (len ${v.length})`;
  return `${v.slice(0, 4)}…${v.slice(-2)} (len ${v.length})`;
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
      const { BedrockRuntimeClient } = await esm<BedrockSdkMod>("@aws-sdk/client-bedrock-runtime");
      const budget = t?.budgetTokens ?? 2048;

      const regionSource = cfg.region
        ? "settings"
        : process.env.AWS_DEFAULT_REGION
          ? "AWS_DEFAULT_REGION"
          : process.env.AWS_REGION
            ? "AWS_REGION"
            : "none";
      const region = cfg.region || process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
      if (!region) {
        console.error("[bedrock] no region in settings or AWS_DEFAULT_REGION/AWS_REGION env.");
        throw new Error("AWS region is not set for Bedrock. Set it in Settings (e.g. us-east-1).");
      }

      // Endpoint accepts a full URL or a bare host (a company proxy / gateway / VPC
      // endpoint). Default a missing scheme to https. Blank → standard AWS endpoint.
      let endpoint = cfg.baseUrl?.trim();
      if (endpoint && !/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`;

      // Three auth modes, in priority order:
      //   1) Bearer-token API key (Bedrock API key / gateway token) — a single key,
      //      sent as `Authorization: Bearer …`. This is what most company proxies use.
      //   2) Static SigV4 access key + secret.
      //   3) Ambient AWS default chain (env / profile / ~/.aws / role).
      const bearer = cfg.apiKey?.trim();
      const accessKeyId = cfg.accessKeyId?.trim();
      const secretAccessKey = cfg.secretAccessKey?.trim();
      const ambient = hasAmbientAwsCredentials();

      const clientCfg: BedrockRuntimeClientConfig = { region };
      if (endpoint) clientCfg.endpoint = endpoint;

      let authMode: string;
      if (bearer) {
        clientCfg.token = { token: bearer };
        // Force bearer over SigV4 (which is listed first by default and would
        // otherwise demand AWS credentials we don't have). The preference matches
        // the scheme name after the "#", i.e. "smithy.api#httpBearerAuth".
        clientCfg.authSchemePreference = ["httpBearerAuth"];
        authMode = "bearer token (api key)";
      } else if (accessKeyId && secretAccessKey) {
        clientCfg.credentials = { accessKeyId, secretAccessKey };
        authMode = "sigv4 access key";
      } else if (ambient) {
        authMode = "ambient AWS chain";
      } else {
        console.error("[bedrock] no api key, no access key/secret, no ambient credentials.");
        throw new Error(
          "No credentials found for Bedrock. Enter your API key (bearer token) in Settings — " +
            "or an AWS access key ID + secret — along with the endpoint and region your provider gave you.",
        );
      }

      // Secret-safe diagnostics → Electron main-process stdout.
      console.log(
        `[bedrock] model=${cfg.model} region=${region} (${regionSource}) auth=${authMode} ` +
          `endpoint=${endpoint || "(default AWS)"} ` +
          `apiKey=${maskKey(bearer)} accessKeyId=${maskKey(accessKeyId)} ` +
          `thinking=${thinkingOn ? "on" : "off"}`,
      );

      const client = new BedrockRuntimeClient(clientCfg);
      return new ChatBedrockConverse({
        client,
        region,
        model: cfg.model,
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
