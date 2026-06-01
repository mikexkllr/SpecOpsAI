import React, { useEffect, useRef, useState, useMemo } from "react";
import type {
  AgentActivityItem,
  AgentTurn,
  ArtifactFiles,
  ChatHistory,
  ProjectInfo,
  SpecInfo,
} from "../shared/api";
import {
  Chat,
  EMPTY_PHASE_ACTIVITY,
  reduceActivity,
  type ChatMessage,
  type PhaseActivity,
} from "./Chat";
import { ImplementationView } from "./ImplementationView";
import { PhaseNav } from "./PhaseNav";
import { PhaseView } from "./PhaseView";
import { ProjectBar } from "./ProjectBar";
import { Settings } from "./Settings";
import { EMPTY_ARTIFACTS, type Artifacts, type Phase } from "./phases";
import { PROVIDER_DESCRIPTORS, type AgentMode, type AppSettings } from "../shared/api";

const MemoizedPhaseView = React.memo(PhaseView);
const MemoizedChat = React.memo(Chat);
const MemoizedImplementationView = React.memo(ImplementationView);

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

const EMPTY_MESSAGES: Record<Phase, ChatMessage[]> = {
  spec: [],
  "user-story": [],
  "technical-story": [],
  implementation: [],
};

const EMPTY_ACTIVITY: Record<Phase, PhaseActivity> = {
  spec: EMPTY_PHASE_ACTIVITY,
  "user-story": EMPTY_PHASE_ACTIVITY,
  "technical-story": EMPTY_PHASE_ACTIVITY,
  implementation: EMPTY_PHASE_ACTIVITY,
};

// Keep persisted tool input/output bounded so chats.json doesn't balloon with
// large file reads or writes — the live view already showed the fuller text.
const PERSIST_OUTPUT_CAP = 1500;
const PERSIST_INPUT_STR_CAP = 2000;
function trimStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > PERSIST_INPUT_STR_CAP
      ? value.slice(0, PERSIST_INPUT_STR_CAP) + "…"
      : value;
  }
  if (Array.isArray(value)) return value.map(trimStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trimStrings(v)]),
    );
  }
  return value;
}
function trimForPersist(items: AgentActivityItem[]): AgentActivityItem[] {
  return items.map((it) => {
    if (it.kind !== "tool") return it;
    const output =
      it.output && it.output.length > PERSIST_OUTPUT_CAP
        ? it.output.slice(0, PERSIST_OUTPUT_CAP) + "…"
        : it.output;
    return { ...it, input: trimStrings(it.input), output };
  });
}

export function App(): JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeSpec, setActiveSpec] = useState<SpecInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("spec");
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY_ARTIFACTS);
  const [messagesByPhase, setMessagesByPhase] =
    useState<Record<Phase, ChatMessage[]>>(EMPTY_MESSAGES);
  const [pending, setPending] = useState(false);
  const [activityByPhase, setActivityByPhase] =
    useState<Record<Phase, PhaseActivity>>(EMPTY_ACTIVITY);
  const [runningPhase, setRunningPhase] = useState<Phase | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveTimers = useRef<Partial<Record<keyof Artifacts, number>>>({});
  // The turn whose streamed `agent:event`s we should route into activity state.
  const activeTurn = useRef<{ turnId: string; phase: Phase } | null>(null);
  // Mirror of the in-flight turn's activity, so we can read the final trace
  // synchronously when the turn resolves (state updates are async).
  const liveActivity = useRef<PhaseActivity>(EMPTY_PHASE_ACTIVITY);
  // True until the saved session has been restored, so the session-persist
  // effect below doesn't overwrite it with the initial empty state on launch.
  const restoring = useRef(true);

  useEffect(() => {
    window.specops.getSettings().then(setSettings);
  }, []);

  // Route live agent events into the activity state of the turn that produced
  // them. Subscribe once; `activeTurn` is a ref so this handler stays stable.
  useEffect(() => {
    return window.specops.onAgentEvent((event) => {
      const active = activeTurn.current;
      if (!active || event.turnId !== active.turnId) return;
      const next = reduceActivity(liveActivity.current, event);
      liveActivity.current = next;
      setActivityByPhase((prev) => ({ ...prev, [active.phase]: next }));
    });
  }, []);

  // Restore the last project / spec / phase on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await window.specops.getSession();
        if (cancelled || !session.projectPath) return;
        const p = await window.specops.loadProject(session.projectPath);
        if (cancelled || !p) return;
        setProject(p);
        const spec = session.activeSpecId
          ? p.specs.find((s) => s.id === session.activeSpecId) ?? null
          : null;
        setActiveSpec(spec);
        if (spec && session.phase) setPhase(session.phase);
      } finally {
        if (!cancelled) restoring.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the session whenever the project / spec / phase changes.
  useEffect(() => {
    if (restoring.current) return;
    void window.specops.saveSession({
      projectPath: project?.path,
      activeSpecId: activeSpec?.id,
      phase,
    });
  }, [project, activeSpec, phase]);

  useEffect(() => {
    setActivityByPhase(EMPTY_ACTIVITY);
    if (!activeSpec) {
      setArtifacts(EMPTY_ARTIFACTS);
      setMessagesByPhase(EMPTY_MESSAGES);
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
    window.specops.readChat(activeSpec.path).then((history) => {
      if (cancelled) return;
      setMessagesByPhase(history);
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
    const specPath = activeSpec.path;
    const base = messagesByPhase;
    const history: AgentTurn[] = base[phase].map((m) => ({
      role: m.role,
      text: m.text,
    }));
    const withUser = [...base[phase], { role: "user" as const, text }];
    const afterUser = { ...base, [phase]: withUser };
    setMessagesByPhase(afterUser);
    void window.specops.writeChat(specPath, afterUser);
    const turnId = crypto.randomUUID();
    activeTurn.current = { turnId, phase };
    liveActivity.current = EMPTY_PHASE_ACTIVITY;
    setActivityByPhase((a) => ({ ...a, [phase]: EMPTY_PHASE_ACTIVITY }));
    setRunningPhase(phase);
    setPending(true);
    try {
      const result = await window.specops.agentChat({
        specPath,
        phase,
        artifacts,
        history,
        message: text,
        turnId,
      });
      if (result.artifact) {
        const artifactKey = RENDERER_ARTIFACT_KEYS[result.artifact.key];
        updateArtifacts({ [artifactKey]: result.artifact.content } as Partial<Artifacts>, {
          flush: true,
        });
      }
      const trace = trimForPersist(liveActivity.current.items);
      const afterAgent = {
        ...afterUser,
        [phase]: [
          ...withUser,
          {
            role: "agent" as const,
            text: result.reply,
            activity: trace.length ? trace : undefined,
          },
        ],
      };
      setMessagesByPhase(afterAgent);
      void window.specops.writeChat(specPath, afterAgent);
    } catch (err) {
      const trace = trimForPersist(liveActivity.current.items);
      const afterError = {
        ...afterUser,
        [phase]: [
          ...withUser,
          {
            role: "agent" as const,
            text: `Agent error: ${(err as Error).message}`,
            activity: trace.length ? trace : undefined,
          },
        ],
      };
      setMessagesByPhase(afterError);
      void window.specops.writeChat(specPath, afterError);
    } finally {
      setPending(false);
      setRunningPhase(null);
      activeTurn.current = null;
      // The trace now lives on the agent turn; clear the live panel.
      liveActivity.current = EMPTY_PHASE_ACTIVITY;
      setActivityByPhase((a) => ({ ...a, [phase]: EMPTY_PHASE_ACTIVITY }));
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
              <MemoizedImplementationView
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
                gridTemplateRows: "minmax(0, 1fr)",
                minHeight: 0,
              }}
            >
              <MemoizedPhaseView phase={phase} artifacts={artifacts} onChange={updateArtifacts} />
              <MemoizedChat
                phase={phase}
                messages={messagesByPhase[phase]}
                onSend={sendMessage}
                pending={pending}
                activity={activityByPhase[phase]}
                running={runningPhase === phase}
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

function SpecLogo(): JSX.Element {
  const px = 8, step = 10, lGap = 20, lw = 5 * step;
  // Each letter: array of 5 rows, each row = filled column indices
  const LETTERS = [
    [[1,2,3],[0],[1,2,3],[4],[1,2,3]],       // S
    [[0,1,2,3],[0,4],[0,1,2,3],[0],[0]],      // P
    [[0,1,2,3,4],[0],[0,1,2,3],[0],[0,1,2,3,4]], // E
    [[1,2,3,4],[0],[0],[0],[1,2,3,4]],        // C
  ];
  const W = 3 * (lw + lGap) + lw;
  const H = 5 * step;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width={W} height={H + 22} style={{ opacity: 0.85 }}>
      {LETTERS.flatMap((rows, li) =>
        rows.flatMap((cols, row) =>
          cols.map(col => (
            <rect
              key={`${li}-${row}-${col}`}
              x={li * (lw + lGap) + col * step}
              y={row * step}
              width={px}
              height={px}
              fill="var(--accent)"
            />
          ))
        )
      )}
      <text x={W / 2} y={H + 17} textAnchor="middle" fill="var(--accent)"
        fontSize="11" fontFamily="var(--font-mono)" opacity="0.7">
        spec-driven dev
      </text>
    </svg>
  );
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
      <SpecLogo />
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
