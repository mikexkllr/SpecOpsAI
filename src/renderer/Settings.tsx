import React, { useEffect, useState } from "react";
import {
  PROVIDER_DESCRIPTORS,
  type AgentMode,
  type AppSettings,
  type ProviderConfig,
  type ProviderId,
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
        controls how sub-agents advance through technical story tasks
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
