import React, { useEffect, useRef, useState } from "react";
import type { AgentTurn, ArtifactFiles, ProjectInfo, SpecInfo } from "../shared/api";
import { Chat, type ChatMessage } from "./Chat";
import { ImplementationView } from "./ImplementationView";
import { PhaseNav } from "./PhaseNav";
import { PhaseView } from "./PhaseView";
import { ProjectBar } from "./ProjectBar";
import { Settings } from "./Settings";
import { EMPTY_ARTIFACTS, type Artifacts, type Phase } from "./phases";
import { PROVIDER_DESCRIPTORS, type AgentMode, type AppSettings } from "../shared/api";

const ARTIFACT_KEYS: Record<keyof Artifacts, keyof ArtifactFiles> = {
  spec: "spec",
  userStories: "userStories",
  technicalStories: "technicalStories",
  code: "code",
};

const RENDERER_ARTIFACT_KEYS: Record<keyof ArtifactFiles, keyof Artifacts> = {
  spec: "spec",
  userStories: "userStories",
  technicalStories: "technicalStories",
  code: "code",
};

export function App(): JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeSpec, setActiveSpec] = useState<SpecInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("spec");
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY_ARTIFACTS);
  const [messagesByPhase, setMessagesByPhase] = useState<Record<Phase, ChatMessage[]>>({
    spec: [],
    "user-story": [],
    "technical-story": [],
    implementation: [],
  });
  const [pending, setPending] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveTimers = useRef<Partial<Record<keyof Artifacts, number>>>({});

  useEffect(() => {
    window.specops.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!activeSpec) {
      setArtifacts(EMPTY_ARTIFACTS);
      return;
    }
    let cancelled = false;
    window.specops.readArtifacts(activeSpec.path).then((files) => {
      if (cancelled) return;
      setArtifacts({
        spec: files.spec,
        userStories: files.userStories,
        technicalStories: files.technicalStories,
        code: files.code,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeSpec]);

  async function handleOpenProject(): Promise<void> {
    const p = await window.specops.openProject();
    if (!p) return;
    setProject(p);
    const first = p.specs[0] ?? null;
    setActiveSpec(first);
    setPhase("spec");
  }

  async function handleCreateSpec(name: string): Promise<void> {
    if (!project) return;
    const spec = await window.specops.createSpec(project.path, name);
    const specs = await window.specops.listSpecs(project.path);
    setProject({ ...project, specs });
    setActiveSpec(spec);
    setPhase("spec");
  }

  function updateArtifacts(patch: Partial<Artifacts>, opts?: { flush?: boolean }): void {
    setArtifacts((a) => ({ ...a, ...patch }));
    if (!activeSpec) return;
    const specPath = activeSpec.path;
    for (const key of Object.keys(patch) as (keyof Artifacts)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      const existing = saveTimers.current[key];
      if (existing) window.clearTimeout(existing);
      if (opts?.flush) {
        saveTimers.current[key] = undefined;
        void window.specops.writeArtifact(specPath, ARTIFACT_KEYS[key], value);
      } else {
        saveTimers.current[key] = window.setTimeout(() => {
          window.specops.writeArtifact(specPath, ARTIFACT_KEYS[key], value);
        }, 300);
      }
    }
  }

  async function sendMessage(text: string): Promise<void> {
    if (pending || !activeSpec) return;
    const history: AgentTurn[] = messagesByPhase[phase].map((m) => ({
      role: m.role,
      text: m.text,
    }));
    setMessagesByPhase((prev) => ({
      ...prev,
      [phase]: [...prev[phase], { role: "user", text }],
    }));
    setPending(true);
    try {
      const result = await window.specops.agentChat({
        phase,
        artifacts,
        history,
        message: text,
      });
      if (result.artifact) {
        const artifactKey = RENDERER_ARTIFACT_KEYS[result.artifact.key];
        updateArtifacts({ [artifactKey]: result.artifact.content } as Partial<Artifacts>, {
          flush: true,
        });
      }
      setMessagesByPhase((prev) => ({
        ...prev,
        [phase]: [...prev[phase], { role: "agent", text: result.reply }],
      }));
    } catch (err) {
      setMessagesByPhase((prev) => ({
        ...prev,
        [phase]: [
          ...prev[phase],
          { role: "agent", text: `Agent error: ${(err as Error).message}` },
        ],
      }));
    } finally {
      setPending(false);
    }
  }

  const ready = !!activeSpec;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="glyph">▸</span>
          <span className="name">
            specops<span className="dim">.ai</span>
          </span>
        </div>
        <div className="header-meta">
          <div className="header-status">
            <span className="dot" />
            {activeSpec
              ? `${activeSpec.name} · ${activeSpec.branch}`
              : "spec-driven dev shell"}
          </div>
          <ModeToggle
            mode={settings?.agentMode ?? "hitl"}
            disabled={!settings}
            onChange={async (mode) => {
              if (!settings || settings.agentMode === mode) return;
              const next = { ...settings, agentMode: mode };
              setSettings(next);
              const saved = await window.specops.saveSettings(next);
              setSettings(saved);
            }}
          />
          <button
            className="btn btn-sm"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            {providerLabel(settings)}
          </button>
          <WindowControls />
        </div>
      </header>
      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => setSettings(s)}
        />
      )}
      <ProjectBar
        project={project}
        activeSpec={activeSpec}
        onOpenProject={handleOpenProject}
        onSelectSpec={(s) => {
          setActiveSpec(s);
          setPhase("spec");
        }}
        onCreateSpec={handleCreateSpec}
      />
      {ready && activeSpec ? (
        <>
          <PhaseNav phase={phase} artifacts={artifacts} onSelect={setPhase} />
          {phase === "implementation" ? (
            <div className="flex-1 flex-row">
              <ImplementationView
                specPath={activeSpec.path}
                artifacts={artifacts}
                agentMode={settings?.agentMode ?? "hitl"}
                onCodeChange={(code) => updateArtifacts({ code })}
              />
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "1fr 380px",
                minHeight: 0,
              }}
            >
              <PhaseView phase={phase} artifacts={artifacts} onChange={updateArtifacts} />
              <Chat
                phase={phase}
                messages={messagesByPhase[phase]}
                onSend={sendMessage}
                pending={pending}
              />
            </div>
          )}
        </>
      ) : (
        <EmptyState hasProject={!!project} onOpen={handleOpenProject} />
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: AgentMode;
  disabled: boolean;
  onChange: (m: AgentMode) => void;
}): JSX.Element {
  const modes: Array<{ id: AgentMode; label: string; hint: string }> = [
    { id: "hitl", label: "HITL", hint: "Human-in-the-loop: confirm each task" },
    { id: "yolo", label: "YOLO", hint: "Autonomous: run all tasks unattended" },
  ];
  return (
    <div className={`mode-toggle${disabled ? " disabled" : ""}`} title="Agent mode">
      {modes.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            disabled={disabled}
            title={m.hint}
            className={active ? `active ${m.id}` : ""}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    window.specops.isWindowMaximized().then(setMaximized);
    return window.specops.onMaximizedChange(setMaximized);
  }, []);
  return (
    <div className="window-controls">
      <button
        className="wc-btn"
        onClick={() => window.specops.minimizeWindow()}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        className="wc-btn"
        onClick={() => window.specops.toggleMaximizeWindow()}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
          </svg>
        )}
      </button>
      <button
        className="wc-btn wc-close"
        onClick={() => window.specops.closeWindow()}
        title="Close"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}

function providerLabel(settings: AppSettings | null): string {
  if (!settings) return "⚙ settings";
  const d = PROVIDER_DESCRIPTORS.find((p) => p.id === settings.activeProvider);
  const cfg = settings.providers[settings.activeProvider];
  const model = cfg?.model ?? d?.defaultModel ?? "";
  return `⚙ ${d?.label ?? settings.activeProvider} · ${model}`;
}

function EmptyState({
  hasProject,
  onOpen,
}: {
  hasProject: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <div className="empty-state">
      <pre className="ascii">{`   ▗▄▖   ▗▄▄▖ ▗▄▄▄▖ ▗▄▄▖
  ▐▌ ▐▌ ▐▌    ▐▌   ▐▌
  ▐▛▀▜▌  ▝▀▚▖ ▐▛▀▘ ▐▌
  ▐▌ ▐▌ ▗▄▄▞▘ ▐▌   ▝▚▄▄▖
        spec-driven dev`}</pre>
      <div className="msg">
        {hasProject
          ? "create a new spec to start the phase-based workflow"
          : "open a project folder to begin"}
      </div>
      {!hasProject && (
        <button className="btn btn-primary" onClick={onOpen}>
          ▸ open project
        </button>
      )}
    </div>
  );
}
