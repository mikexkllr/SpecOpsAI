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
        <div style={{ padding: 24 }}>Loading settings…</div>
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
      <div
        style={{
          width: 640,
          maxHeight: "85vh",
          background: "#151515",
          border: "1px solid #2a2a2a",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 600 }}>Settings</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              color: "#aaa",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", flex: 1, minHeight: 0 }}>
          <div style={{ borderRight: "1px solid #2a2a2a", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {PROVIDER_DESCRIPTORS.map((d) => {
              const isActive = d.id === active;
              return (
                <button
                  key={d.id}
                  onClick={() => setSettings({ ...settings, activeProvider: d.id })}
                  style={{
                    background: isActive ? "#2b6cb0" : "transparent",
                    color: isActive ? "white" : "#ddd",
                    border: "1px solid " + (isActive ? "#2b6cb0" : "transparent"),
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {d.label}
                  {isActive && (
                    <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>active</div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
            <ProviderForm
              cfg={settings.providers[active]}
              onChange={(patch) => updateProvider(active, patch)}
            />
            <AgentModeSection
              mode={settings.agentMode}
              onChange={(agentMode) => setSettings({ ...settings, agentMode })}
            />
          </div>
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#1e1e1e",
              color: "#ddd",
              border: "1px solid #333",
              padding: "6px 14px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saving ? "#1e3a5a" : "#2a5cff",
              color: "white",
              border: "none",
              padding: "6px 14px",
              borderRadius: 4,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{d.label}</div>
        <div style={{ opacity: 0.65, marginTop: 2 }}>{d.description}</div>
      </div>

      <Field label="Model">
        <input
          list={`models-${d.id}`}
          value={cfg.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={d.defaultModel}
          style={inputStyle}
        />
        <datalist id={`models-${d.id}`}>
          {d.suggestedModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      {d.defaultBaseUrl !== undefined && (
        <Field label="Base URL">
          <input
            value={cfg.baseUrl ?? ""}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder={d.defaultBaseUrl}
            style={inputStyle}
          />
        </Field>
      )}

      {d.needsApiKey && (
        <Field label="API key">
          <input
            type="password"
            value={cfg.apiKey ?? ""}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder="stored on this device"
            style={inputStyle}
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
      label: "Human-in-the-Loop",
      description: "Pause after each task for confirmation before continuing.",
    },
    {
      id: "yolo",
      label: "YOLO (autonomous)",
      description: "Run all pending tasks end-to-end without stopping — fit for unattended runs.",
    },
  ];
  return (
    <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Agent mode</div>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 10 }}>
        Controls how sub-agents advance through Technical Story tasks.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((opt) => {
          const active = opt.id === mode;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              style={{
                textAlign: "left",
                background: active ? "#1e3a5a" : "#1a1a1a",
                border: "1px solid " + (active ? "#2b6cb0" : "#333"),
                color: "#e6e6e6",
                borderRadius: 6,
                padding: "8px 10px",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                {opt.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#1a1a1a",
  color: "#e6e6e6",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ opacity: 0.7, fontSize: 12 }}>{label}</span>
      {children}
    </label>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
