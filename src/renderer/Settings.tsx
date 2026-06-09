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
  type UpdateStatus,
} from "../shared/api";

interface Props {
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
}

export function Settings({ onClose, onSaved }: Props): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  // Snapshot of the settings as loaded, so we can detect unsaved edits and warn
  // before the modal is dismissed.
  const [baseline, setBaseline] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    window.specops.getSettings().then((s) => {
      setSettings(s);
      setBaseline(JSON.stringify(s));
    });
  }, []);

  const dirty = baseline !== null && settings !== null && JSON.stringify(settings) !== baseline;

  // Guarded dismissal: a no-op edit closes immediately, unsaved edits prompt first.
  function requestClose(): void {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

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
    <Overlay onClose={requestClose}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">settings{dirty ? " — unsaved" : ""}</div>
          <button className="btn-icon" onClick={requestClose} aria-label="close">
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
            <UpdatesSection
              autoUpdate={settings.autoUpdate !== false}
              onChange={(autoUpdate) => setSettings({ ...settings, autoUpdate })}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={requestClose}>
            cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div
          className="overlay"
          style={{ zIndex: 110 }}
          onClick={() => setConfirmDiscard(false)}
        >
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">unsaved changes</div>
            </div>
            <div style={{ padding: 18 }}>
              <div className="section-subtitle" style={{ marginTop: 0 }}>
                You have unsaved changes. Discard them and close, or keep editing?
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDiscard(false)}>
                keep editing
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
              >
                discard changes
              </button>
            </div>
          </div>
        </div>
      )}
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

      {d.needsAwsCreds && (
        <>
          <Field label="endpoint url">
            <input
              value={cfg.baseUrl ?? ""}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              placeholder="e.g. https://bedrock.proxy.company.com — blank = default AWS"
            />
          </Field>
          <Field label="api key (bearer token)">
            <input
              type="password"
              value={cfg.apiKey ?? ""}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder="your Bedrock API key / gateway token"
            />
          </Field>
          <Field label="aws region">
            <input
              value={cfg.region ?? ""}
              onChange={(e) => onChange({ region: e.target.value })}
              placeholder="e.g. us-east-1"
            />
          </Field>
          <div className="section-subtitle" style={{ marginTop: 2 }}>
            No API key? Use AWS access keys instead (leave the API key blank), or leave both
            blank to use the machine's default AWS credential chain.
          </div>
          <Field label="aws access key id (optional)">
            <input
              value={cfg.accessKeyId ?? ""}
              onChange={(e) => onChange({ accessKeyId: e.target.value })}
              placeholder="AKIA… — only for SigV4 auth"
            />
          </Field>
          <Field label="aws secret access key (optional)">
            <input
              type="password"
              value={cfg.secretAccessKey ?? ""}
              onChange={(e) => onChange({ secretAccessKey: e.target.value })}
              placeholder="only for SigV4 auth"
            />
          </Field>
        </>
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
      id: "deepagent",
      label: "custom agent (built-in)",
      description:
        "uses the in-app deepagents Worker with your configured provider — no external CLI to install (default)",
    },
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
    {
      id: "opencode",
      label: "opencode",
      description:
        "runs `opencode run` CLI for each task — install opencode and set its model/auth (point it at OpenCode Zen for cheap models)",
    },
  ];
  return (
    <div className="divider-t" style={{ paddingTop: 18 }}>
      <div className="section-title">coding agent</div>
      <div className="section-subtitle">
        agent used to execute implementation tasks — the built-in custom agent, or an external CLI
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

function UpdatesSection({
  autoUpdate,
  onChange,
}: {
  autoUpdate: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    window.specops.getUpdateStatus().then(setStatus);
    return window.specops.onUpdateStatus(setStatus);
  }, []);

  const state = status?.state ?? "idle";
  const busy = state === "checking" || state === "downloading";
  const disabled = state === "disabled";

  const options: Array<{ id: boolean; label: string; description: string }> = [
    {
      id: true,
      label: "automatic",
      description: "check GitHub on launch and download new versions in the background",
    },
    {
      id: false,
      label: "manual",
      description: "only check when you press the button below",
    },
  ];

  return (
    <div className="divider-t" style={{ paddingTop: 18 }}>
      <div className="section-title">updates</div>
      <div className="section-subtitle">
        SpecOps updates itself from GitHub Releases — current version v{status?.currentVersion ?? "—"}
      </div>

      <div className="flex-col" style={{ gap: 8, marginTop: 12 }}>
        {options.map((opt) => (
          <button
            key={String(opt.id)}
            onClick={() => onChange(opt.id)}
            className={`option-card${opt.id === autoUpdate ? " active" : ""}`}
          >
            <div className="opt-title">{opt.label}</div>
            <div className="opt-desc">{opt.description}</div>
          </button>
        ))}
      </div>

      <div className="section-subtitle" style={{ marginTop: 12 }}>
        {updateStatusLabel(status)}
      </div>

      {state === "downloading" && status?.progressPercent !== undefined && (
        <div className="section-subtitle" style={{ marginTop: 4 }}>
          {status.progressPercent}%
        </div>
      )}

      <div className="flex-row" style={{ gap: 8, marginTop: 12 }}>
        <button
          className="btn"
          disabled={busy || disabled}
          onClick={() => window.specops.checkForUpdates()}
        >
          {state === "checking" ? "checking…" : "check for updates"}
        </button>

        {state === "available" && (
          <button className="btn btn-primary" onClick={() => window.specops.downloadUpdate()}>
            download v{status?.newVersion}
          </button>
        )}

        {state === "downloaded" && (
          <button
            className="btn btn-primary"
            onClick={() => window.specops.quitAndInstallUpdate()}
          >
            restart &amp; install v{status?.newVersion}
          </button>
        )}
      </div>
    </div>
  );
}

function updateStatusLabel(status: UpdateStatus | null): string {
  if (!status) return "";
  switch (status.state) {
    case "disabled":
      return "auto-update is unavailable in development builds";
    case "checking":
      return "checking GitHub for a newer version…";
    case "available":
      return `version ${status.newVersion} is available`;
    case "downloading":
      return `downloading version ${status.newVersion ?? ""}…`;
    case "downloaded":
      return `version ${status.newVersion} is ready — restart to install`;
    case "not-available":
      return "you're on the latest version";
    case "error":
      return `update check failed: ${status.error ?? "unknown error"}`;
    default:
      return "";
  }
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
