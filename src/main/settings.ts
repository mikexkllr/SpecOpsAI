import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  PROVIDER_DESCRIPTORS,
  type AgentMode,
  type AppSettings,
  type CodingAgentId,
  type ProviderConfig,
  type ProviderDescriptor,
  type ProviderId,
  type ThinkingConfig,
} from "../shared/api";

const AGENT_MODES: AgentMode[] = ["yolo", "hitl"];
const CODING_AGENTS: CodingAgentId[] = ["claude-code", "gh-copilot", "codex", "antigravity"];

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultThinking(d: ProviderDescriptor): ThinkingConfig | undefined {
  switch (d.thinking) {
    case "budget":
      return { enabled: false, budgetTokens: d.defaultThinkingBudget ?? 2048 };
    case "effort":
      return { enabled: false, effort: "medium" };
    case "toggle":
      return { enabled: false };
    default:
      return undefined;
  }
}

// Validate a stored thinking config against what the provider actually supports,
// falling back to the descriptor's default so old/garbage values can't break it.
function mergeThinking(raw: unknown, d: ProviderDescriptor): ThinkingConfig | undefined {
  const base = defaultThinking(d);
  if (!base || !raw || typeof raw !== "object") return base;
  const r = raw as Partial<ThinkingConfig>;
  const out: ThinkingConfig = { enabled: r.enabled === true };
  if (d.thinking === "budget") {
    out.budgetTokens =
      typeof r.budgetTokens === "number" && r.budgetTokens > 0
        ? Math.floor(r.budgetTokens)
        : base.budgetTokens;
  }
  if (d.thinking === "effort") {
    out.effort =
      r.effort === "low" || r.effort === "medium" || r.effort === "high"
        ? r.effort
        : base.effort;
  }
  return out;
}

function defaultProvider(id: ProviderId): ProviderConfig {
  const d = PROVIDER_DESCRIPTORS.find((p) => p.id === id)!;
  return {
    id,
    model: d.defaultModel,
    apiKey: d.needsApiKey ? "" : undefined,
    baseUrl: d.defaultBaseUrl,
    thinking: defaultThinking(d),
  };
}

function defaultSettings(): AppSettings {
  const providers = {} as Record<ProviderId, ProviderConfig>;
  for (const d of PROVIDER_DESCRIPTORS) providers[d.id] = defaultProvider(d.id);
  return { activeProvider: "anthropic", providers, agentMode: "hitl", codingAgent: "claude-code", devServerUrl: undefined };
}

function mergeSettings(raw: unknown): AppSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<AppSettings>;
  if (r.activeProvider && PROVIDER_DESCRIPTORS.some((d) => d.id === r.activeProvider)) {
    base.activeProvider = r.activeProvider;
  }
  if (r.agentMode && AGENT_MODES.includes(r.agentMode)) {
    base.agentMode = r.agentMode;
  }
  if (r.codingAgent && CODING_AGENTS.includes(r.codingAgent)) {
    base.codingAgent = r.codingAgent;
  }
  if (typeof r.devServerUrl === "string") {
    base.devServerUrl = r.devServerUrl || undefined;
  }
  if (r.providers && typeof r.providers === "object") {
    for (const d of PROVIDER_DESCRIPTORS) {
      const saved = (r.providers as Record<string, ProviderConfig>)[d.id];
      if (saved && typeof saved === "object") {
        base.providers[d.id] = {
          id: d.id,
          model: typeof saved.model === "string" && saved.model ? saved.model : d.defaultModel,
          apiKey: typeof saved.apiKey === "string" ? saved.apiKey : base.providers[d.id].apiKey,
          baseUrl:
            typeof saved.baseUrl === "string" && saved.baseUrl
              ? saved.baseUrl
              : d.defaultBaseUrl,
          thinking: mergeThinking(saved.thinking, d),
        };
      }
    }
  }
  return base;
}

let cached: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    cached = mergeSettings(JSON.parse(raw));
  } catch {
    cached = defaultSettings();
  }
  return cached;
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const merged = mergeSettings(next);
  const file = settingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf8");
  cached = merged;
  return merged;
}

export async function getActiveProvider(): Promise<ProviderConfig> {
  const s = await loadSettings();
  return s.providers[s.activeProvider];
}
