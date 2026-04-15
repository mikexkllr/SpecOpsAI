import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMode,
  ArtifactFiles,
  SubAgentState,
  SubAgentStore,
  TaskStatus,
  TechnicalStory,
} from "../shared/api";
import type { Artifacts } from "./phases";
import { parseTechnicalStories } from "./technical-stories";

interface ImplementationViewProps {
  specPath: string;
  artifacts: Artifacts;
  agentMode: AgentMode;
  onCodeChange: (code: string) => void;
}

type Tab = "stories" | "code";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  done: "Done",
};

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  pending: "in-progress",
  "in-progress": "done",
  done: "pending",
};

function toApiArtifacts(a: Artifacts): ArtifactFiles {
  return {
    spec: a.spec,
    userStories: a.userStories,
    technicalStories: a.technicalStories,
    code: a.code,
  };
}

export function ImplementationView({
  specPath,
  artifacts,
  agentMode,
  onCodeChange,
}: ImplementationViewProps): JSX.Element {
  const stories = useMemo(
    () => parseTechnicalStories(artifacts.technicalStories),
    [artifacts.technicalStories],
  );
  const [tab, setTab] = useState<Tab>("stories");
  const [selectedId, setSelectedId] = useState<string | null>(stories[0]?.id ?? null);
  const [store, setStore] = useState<SubAgentStore>({});
  const [busy, setBusy] = useState<"decompose" | "chat" | "run" | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingApproval, setPendingApproval] = useState<{
    storyId: string;
    taskId: string;
  } | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    window.specops.readSubAgents(specPath).then(setStore);
  }, [specPath]);

  useEffect(() => {
    if (selectedId && stories.find((s) => s.id === selectedId)) return;
    setSelectedId(stories[0]?.id ?? null);
  }, [stories, selectedId]);

  const selectedStory = stories.find((s) => s.id === selectedId) ?? null;
  const selectedState: SubAgentState | null = selectedId ? store[selectedId] ?? null : null;

  async function decompose(): Promise<void> {
    if (!selectedStory || busy) return;
    setBusy("decompose");
    try {
      const state = await window.specops.decomposeStory({
        specPath,
        story: selectedStory,
        artifacts: toApiArtifacts(artifacts),
      });
      setStore((s) => ({ ...s, [state.storyId]: state }));
    } finally {
      setBusy(null);
    }
  }

  async function sendChat(): Promise<void> {
    if (!selectedStory || busy) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setBusy("chat");
    try {
      const state = await window.specops.subAgentChat({
        specPath,
        story: selectedStory,
        artifacts: toApiArtifacts(artifacts),
        message: text,
      });
      setStore((s) => ({ ...s, [state.storyId]: state }));
    } finally {
      setBusy(null);
    }
  }

  async function cycleTask(taskId: string, current: TaskStatus): Promise<void> {
    if (!selectedStory) return;
    const state = await window.specops.updateTaskStatus(
      specPath,
      selectedStory.id,
      taskId,
      STATUS_NEXT[current],
    );
    setStore((s) => ({ ...s, [state.storyId]: state }));
  }

  async function resetStory(): Promise<void> {
    if (!selectedStory) return;
    const next = await window.specops.resetSubAgent(specPath, selectedStory.id);
    setStore(next);
    setPendingApproval(null);
  }

  async function runTask(
    story: TechnicalStory,
    taskId: string,
    autoComplete: boolean,
  ): Promise<SubAgentState> {
    const state = await window.specops.runSubAgentTask({
      specPath,
      story,
      artifacts: toApiArtifacts(artifacts),
      taskId,
      autoComplete,
    });
    setStore((s) => ({ ...s, [state.storyId]: state }));
    return state;
  }

  async function runStory(): Promise<void> {
    if (!selectedStory || busy) return;
    stopRef.current = false;
    setBusy("run");
    setPendingApproval(null);
    try {
      let state =
        store[selectedStory.id] ??
        (await window.specops.readSubAgents(specPath).then((s) => {
          setStore(s);
          return s[selectedStory.id];
        }));
      if (!state || state.tasks.length === 0) {
        state = await window.specops.decomposeStory({
          specPath,
          story: selectedStory,
          artifacts: toApiArtifacts(artifacts),
        });
        setStore((s) => ({ ...s, [state!.storyId]: state! }));
        if (state.error || state.tasks.length === 0) return;
      }
      while (!stopRef.current) {
        const next = state.tasks.find((t) => t.status !== "done");
        if (!next) break;
        const isYolo = agentMode === "yolo";
        state = await runTask(selectedStory, next.id, isYolo);
        if (state.error) break;
        if (!isYolo) {
          setPendingApproval({ storyId: selectedStory.id, taskId: next.id });
          return;
        }
      }
    } finally {
      setBusy((b) => (b === "run" ? null : b));
    }
  }

  async function approveTask(): Promise<void> {
    if (!pendingApproval || !selectedStory) return;
    const state = await window.specops.updateTaskStatus(
      specPath,
      pendingApproval.storyId,
      pendingApproval.taskId,
      "done",
    );
    setStore((s) => ({ ...s, [state.storyId]: state }));
    setPendingApproval(null);
    void runStory();
  }

  function rejectTask(): void {
    setPendingApproval(null);
  }

  function stopRun(): void {
    stopRef.current = true;
    setPendingApproval(null);
  }

  if (tab === "code") {
    return (
      <div style={layoutStyle}>
        <Tabs tab={tab} onChange={setTab} />
        <textarea
          value={artifacts.code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="// code notes — implementation agent will drive real edits"
          style={{
            flex: 1,
            background: "#141414",
            color: "#e6e6e6",
            border: "none",
            outline: "none",
            padding: 16,
            resize: "none",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        />
      </div>
    );
  }

  return (
    <div style={layoutStyle}>
      <Tabs tab={tab} onChange={setTab} />
      {stories.length === 0 ? (
        <EmptyStories />
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 0 }}>
          <StoryList
            stories={stories}
            store={store}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selectedStory ? (
            <StoryWorkspace
              story={selectedStory}
              state={selectedState}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              agentMode={agentMode}
              pendingApproval={
                pendingApproval && pendingApproval.storyId === selectedStory.id
                  ? pendingApproval.taskId
                  : null
              }
              onDecompose={decompose}
              onSend={sendChat}
              onCycleTask={cycleTask}
              onReset={resetStory}
              onRun={runStory}
              onStop={stopRun}
              onApprove={approveTask}
              onReject={rejectTask}
            />
          ) : (
            <div style={{ padding: 24, opacity: 0.6 }}>Select a story.</div>
          )}
        </div>
      )}
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }): JSX.Element {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "stories", label: "Sub-agents" },
    { id: "code", label: "Code notes" },
  ];
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background: tab === t.id ? "#1e1e1e" : "transparent",
            color: tab === t.id ? "#fff" : "#aaa",
            border: "none",
            borderBottom: tab === t.id ? "2px solid #2b6cb0" : "2px solid transparent",
            padding: "10px 16px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function EmptyStories(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.6,
        fontSize: 14,
        padding: 24,
        textAlign: "center",
      }}
    >
      No Technical Stories yet. Go back to the Technical Stories phase and define some
      (`TS-1`, `TS-2`…) so each can get its own sub-agent.
    </div>
  );
}

function StoryList({
  stories,
  store,
  selectedId,
  onSelect,
}: {
  stories: TechnicalStory[];
  store: SubAgentStore;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div style={{ borderRight: "1px solid #2a2a2a", overflowY: "auto" }}>
      {stories.map((s) => {
        const state = store[s.id];
        const progress = state ? progressLabel(state) : "not started";
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              background: active ? "#1e2a3a" : "transparent",
              color: "#e6e6e6",
              border: "none",
              borderBottom: "1px solid #1a1a1a",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
              {s.title || "(untitled)"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{progress}</div>
          </button>
        );
      })}
    </div>
  );
}

function progressLabel(state: SubAgentState): string {
  if (state.status === "decomposing") return "decomposing…";
  if (state.status === "running") return "sub-agent thinking…";
  if (state.tasks.length === 0) return "no tasks yet";
  const done = state.tasks.filter((t) => t.status === "done").length;
  return `${done}/${state.tasks.length} done`;
}

function StoryWorkspace({
  story,
  state,
  draft,
  setDraft,
  busy,
  agentMode,
  pendingApproval,
  onDecompose,
  onSend,
  onCycleTask,
  onReset,
  onRun,
  onStop,
  onApprove,
  onReject,
}: {
  story: TechnicalStory;
  state: SubAgentState | null;
  draft: string;
  setDraft: (v: string) => void;
  busy: "decompose" | "chat" | "run" | null;
  agentMode: AgentMode;
  pendingApproval: string | null;
  onDecompose: () => void;
  onSend: () => void;
  onCycleTask: (taskId: string, current: TaskStatus) => void;
  onReset: () => void;
  onRun: () => void;
  onStop: () => void;
  onApprove: () => void;
  onReject: () => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state?.messages.length, busy]);

  const tasks = state?.tasks ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ fontSize: 12, opacity: 0.6 }}>{story.id}</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{story.title || "(untitled)"}</div>
        {story.body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              opacity: 0.75,
              whiteSpace: "pre-wrap",
              maxHeight: 90,
              overflowY: "auto",
            }}
          >
            {story.body}
          </div>
        )}
      </div>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
            Tasks {tasks.length > 0 && `(${tasks.length})`}
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 3,
                background: agentMode === "yolo" ? "#4a2e00" : "#1e3a5a",
                color: "#fff",
                fontWeight: 500,
              }}
            >
              {agentMode === "yolo" ? "YOLO" : "HITL"}
            </span>
          </div>
          {busy === "run" ? (
            <button
              onClick={onStop}
              style={{ ...buttonStyle(false), background: "#3a1e1e" }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onRun}
              disabled={busy !== null || pendingApproval !== null}
              style={{
                ...buttonStyle(false),
                background: agentMode === "yolo" ? "#7a4a00" : "#1e3a5a",
                color: "#fff",
              }}
              title={
                agentMode === "yolo"
                  ? "Autonomously run all pending tasks"
                  : "Run next task, then wait for your confirmation"
              }
            >
              {agentMode === "yolo" ? "Run all (YOLO)" : "Run next"}
            </button>
          )}
          <button
            onClick={onDecompose}
            disabled={busy !== null}
            style={buttonStyle(busy === "decompose")}
          >
            {busy === "decompose"
              ? "Decomposing…"
              : tasks.length
                ? "Re-decompose"
                : "Decompose"}
          </button>
          {tasks.length > 0 && (
            <button
              onClick={onReset}
              disabled={busy !== null}
              style={{ ...buttonStyle(false), background: "#3a1e1e" }}
            >
              Reset
            </button>
          )}
        </div>
        {pendingApproval && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "#1e2a3a",
              border: "1px solid #2b6cb0",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1 }}>
              HITL: confirm completion of <strong>{pendingApproval}</strong> to continue.
            </span>
            <button
              onClick={onApprove}
              style={{ ...buttonStyle(false), background: "#2f855a", color: "#fff" }}
            >
              Approve & continue
            </button>
            <button
              onClick={onReject}
              style={{ ...buttonStyle(false), background: "#3a1e1e" }}
            >
              Cancel
            </button>
          </div>
        )}
        {state?.error && (
          <div style={{ color: "#ff8080", fontSize: 12, marginTop: 8 }}>{state.error}</div>
        )}
        {tasks.length > 0 ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "6px 8px",
                  background: "#151515",
                  borderRadius: 4,
                }}
              >
                <button
                  onClick={() => onCycleTask(t.id, t.status)}
                  title="Cycle status"
                  style={{
                    background: statusColor(t.status),
                    color: "#fff",
                    border: "none",
                    borderRadius: 3,
                    padding: "2px 6px",
                    fontSize: 10,
                    cursor: "pointer",
                    minWidth: 78,
                  }}
                >
                  {STATUS_LABEL[t.status]}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {t.id} · {t.title}
                  </div>
                  {t.description && (
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      {t.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.55 }}>
            Click Decompose to break this story into implementation chunks.
          </div>
        )}
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
          Sub-agent chat — isolated to {story.id}
        </div>
        {state?.messages.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {state.messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  background: m.role === "user" ? "#2b3a55" : "#23272e",
                  color: "#e6e6e6",
                  padding: "6px 10px",
                  borderRadius: 8,
                  maxWidth: "85%",
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text}
              </div>
            ))}
            {(busy === "chat" || busy === "run") && (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: "#23272e",
                  color: "#9aa",
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontStyle: "italic",
                }}
              >
                {busy === "run" ? "Sub-agent working…" : "Thinking…"}
              </div>
            )}
          </div>
        ) : (
          <div style={{ opacity: 0.5, fontSize: 13 }}>
            Ask this sub-agent anything scoped to {story.id}.
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #2a2a2a" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={busy === "chat" ? "Waiting…" : `Message the ${story.id} sub-agent…`}
          rows={2}
          disabled={busy !== null}
          style={{
            flex: 1,
            resize: "none",
            background: "#1a1a1a",
            color: "#e6e6e6",
            border: "1px solid #333",
            borderRadius: 6,
            padding: 6,
            fontFamily: "inherit",
            fontSize: 13,
            opacity: busy ? 0.6 : 1,
          }}
        />
        <button
          onClick={onSend}
          disabled={busy !== null}
          style={{
            background: busy ? "#1e3a5a" : "#2b6cb0",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "0 14px",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#1e3a5a" : "#1e1e1e",
    color: "#ddd",
    border: "1px solid #333",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    cursor: active ? "not-allowed" : "pointer",
  };
}

function statusColor(status: TaskStatus): string {
  switch (status) {
    case "pending":
      return "#555";
    case "in-progress":
      return "#2b6cb0";
    case "done":
      return "#2f855a";
  }
}
