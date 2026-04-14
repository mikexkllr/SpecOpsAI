import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  PROVIDER_DESCRIPTORS,
  type AgentMode,
  type AppSettings,
  type ProviderConfig,
  type ProviderId,
} from "../shared/api";

const AGENT_MODES: AgentMode[] = ["yolo", "hitl"];

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultProvider(id: ProviderId): ProviderConfig {
  const d = PROVIDER_DESCRIPTORS.find((p) => p.id === id)!;
  return {
    id,
    model: d.defaultModel,
    apiKey: d.needsApiKey ? "" : undefined,
    baseUrl: d.defaultBaseUrl,
  };
}

function defaultSettings(): AppSettings {
  const providers = {} as Record<ProviderId, ProviderConfig>;
  for (const d of PROVIDER_DESCRIPTORS) providers[d.id] = defaultProvider(d.id);
  return { activeProvider: "anthropic", providers, agentMode: "hitl" };
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
