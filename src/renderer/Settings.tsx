import React, { useEffect, useState } from "react";
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

interface Props {
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
}

export function Settings({ onClose, onSaved }: Props): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.specops.getSettings().then(setSettings);
  }, []);

  if (!settings) {
    return (
      <Overlay onClose={onClose}>
        <div className="modal" style={{ padding: 24 }}>loading settings…</div>
      </Overlay>
    );
  }

  const active = settings.activeProvider;

  function updateProvider(id: ProviderId, patch: Partial<ProviderConfig>): void {
    setSettings((s) =>
      s
        ? {
            ...s,
            providers: {
              ...s.providers,
              [id]: { ...s.providers[id], ...patch, id },
            },
          }
        : s,
    );
  }

  async function save(): Promise<void> {
    if (!settings) return;
    setSaving(true);
    try {
      const merged = await window.specops.saveSettings(settings);
      onSaved(merged);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">settings</div>
          <button className="btn-icon" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-side">
            {PROVIDER_DESCRIPTORS.map((d) => {
              const isActive = d.id === active;
              return (
                <button
                  key={d.id}
                  className={isActive ? "active" : ""}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      activeProvider: d.id,
                      providers: {
                        ...settings.providers,
                        [d.id]: settings.providers[d.id] ?? {
                          id: d.id,
                          model: d.defaultModel,
                          apiKey: d.needsApiKey ? "" : undefined,
                          baseUrl: d.defaultBaseUrl,
                        },
                      },
                    })
                  }
                >
                  {d.label}
                  {isActive && <span className="sub">active</span>}
                </button>
              );
            })}
          </div>

          <div className="modal-content">
            <ProviderForm
              cfg={
                settings.providers[active] ?? {
                  id: active,
                  model:
                    PROVIDER_DESCRIPTORS.find((p) => p.id === active)?.defaultModel ?? "",
                  apiKey: PROVIDER_DESCRIPTORS.find((p) => p.id === active)?.needsApiKey
                    ? ""
                    : undefined,
                  baseUrl: PROVIDER_DESCRIPTORS.find((p) => p.id === active)?.defaultBaseUrl,
                }
              }
              onChange={(patch) => updateProvider(active, patch)}
            />
            <AgentModeSection
              mode={settings.agentMode}
              onChange={(agentMode) => setSettings({ ...settings, agentMode })}
            />
            <CodingAgentSection
              codingAgent={settings.codingAgent}
              onChange={(codingAgent) => setSettings({ ...settings, codingAgent })}
            />
            <ReviewerSection
              devServerUrl={settings.devServerUrl ?? ""}
              onChange={(devServerUrl) => setSettings({ ...settings, devServerUrl: devServerUrl || undefined })}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function ProviderForm({
  cfg,
  onChange,
}: {
  cfg: ProviderConfig;
  onChange: (patch: Partial<ProviderConfig>) => void;
}): JSX.Element {
  const d = PROVIDER_DESCRIPTORS.find((p) => p.id === cfg.id)!;
  return (
    <div className="flex-col" style={{ gap: 14 }}>
      <div>
        <div className="section-title">{d.label}</div>
        <div className="section-subtitle">{d.description}</div>
      </div>

      <Field label="model">
        <input
          list={`models-${d.id}`}
          value={cfg.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={d.defaultModel}
        />
        <datalist id={`models-${d.id}`}>
          {d.suggestedModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      {d.defaultBaseUrl !== undefined && (
        <Field label="base url">
          <input
            value={cfg.baseUrl ?? ""}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder={d.defaultBaseUrl}
          />
        </Field>
      )}

      {d.needsApiKey && (
        <Field label="api key">
          <input
            type="password"
            value={cfg.apiKey ?? ""}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder="stored on this device"
          />
        </Field>
      )}

      <ThinkingField
        descriptor={d}
        thinking={cfg.thinking}
        onChange={(thinking) => onChange({ thinking })}
      />
    </div>
  );
}

function ThinkingField({
  descriptor,
  thinking,
  onChange,
}: {
  descriptor: ProviderDescriptor;
  thinking?: ThinkingConfig;
  onChange: (t: ThinkingConfig) => void;
}): JSX.Element | null {
  if (descriptor.thinking === "none") return null;
  const enabled = thinking?.enabled === true;
  const budget = thinking?.budgetTokens ?? descriptor.defaultThinkingBudget ?? 2048;
  const effort = thinking?.effort ?? "medium";

  const hint: Record<Exclude<ProviderDescriptor["thinking"], "none">, string> = {
    budget: "stream the model's reasoning; higher budget = deeper thinking, more tokens",
    effort: "reasoning models only (o-series, gpt-5…) — ignored by gpt-4o and similar",
    toggle: "ask Ollama to emit reasoning — only works on models that support it",
  };

  return (
    <div className="field" style={{ gap: 8 }}>
      <label className="thinking-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked, budgetTokens: budget, effort })}
        />
        <span className="field-label" style={{ margin: 0 }}>
          extended thinking
        </span>
      </label>
      <div className="section-subtitle" style={{ marginTop: 0 }}>
        {hint[descriptor.thinking]}
      </div>

      {enabled && descriptor.thinking === "budget" && (
        <Field label="thinking budget (tokens)">
          <input
            type="number"
            min={1024}
            step={512}
            value={budget}
            onChange={(e) =>
              onChange({
                enabled,
                budgetTokens: Math.max(1024, Number(e.target.value) || 1024),
                effort,
              })
            }
          />
        </Field>
      )}

      {enabled && descriptor.thinking === "effort" && (
        <Field label="reasoning effort">
          <select
            value={effort}
            onChange={(e) =>
              onChange({
                enabled,
                budgetTokens: budget,
                effort: e.target.value as ThinkingConfig["effort"],
              })
            }
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function AgentModeSection({
  mode,
  onChange,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
}): JSX.Element {
  const options: Array<{ id: AgentMode; label: string; description: string }> = [
    {
      id: "hitl",
      label: "human-in-the-loop",
      description: "pause after each task for confirmation before continuing",
    },
    {
      id: "yolo",
      label: "yolo · autonomous",
      description: "run all pending tasks end-to-end without stopping — fit for unattended runs",
    },
  ];
  return (
    <div className="divider-t" style={{ paddingTop: 18 }}>
      <div className="section-title">agent mode</div>
      <div className="section-subtitle">
        controls how Workers advance through technical story tasks
      </div>
      <div className="flex-col" style={{ gap: 8, marginTop: 12 }}>
        {options.map((opt) => {
          const active = opt.id === mode;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`option-card${active ? " active" : ""}`}
            >
              <div className="opt-title">{opt.label}</div>
              <div className="opt-desc">{opt.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CodingAgentSection({
  codingAgent,
  onChange,
}: {
  codingAgent: CodingAgentId;
  onChange: (id: CodingAgentId) => void;
}): JSX.Element {
  const options: Array<{ id: CodingAgentId; label: string; description: string }> = [
    {
      id: "claude-code",
      label: "claude code",
      description: "runs `claude --print` CLI for each task — must be installed globally",
    },
    {
      id: "gh-copilot",
      label: "github copilot",
      description: "runs `gh copilot suggest` CLI — requires GitHub Copilot subscription",
    },
    {
      id: "codex",
      label: "codex (openai)",
      description: "runs `codex --quiet` CLI for each task — requires OpenAI Codex CLI installed globally",
    },
    {
      id: "antigravity",
      label: "antigravity (google)",
      description: "runs `antigravity --print` CLI for each task — Google's next-gen coding agent",
    },
  ];
  return (
    <div className="divider-t" style={{ paddingTop: 18 }}>
      <div className="section-title">coding agent</div>
      <div className="section-subtitle">
        CLI agent used to execute implementation tasks
      </div>
      <div className="flex-col" style={{ gap: 8, marginTop: 12 }}>
        {options.map((opt) => {
          const active = opt.id === codingAgent;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`option-card${active ? " active" : ""}`}
            >
              <div className="opt-title">{opt.label}</div>
              <div className="opt-desc">{opt.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReviewerSection({
  devServerUrl,
  onChange,
}: {
  devServerUrl: string;
  onChange: (url: string) => void;
}): JSX.Element {
  return (
    <div className="divider-t" style={{ paddingTop: 18 }}>
      <div className="section-title">reviewer</div>
      <div className="section-subtitle">
        optional dev server URL — the reviewer deepagent uses browser tools to verify features when it makes sense
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="dev server url">
          <input
            value={devServerUrl}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. http://localhost:3000"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
