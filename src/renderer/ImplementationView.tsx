import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMode,
  ArtifactFiles,
  GenerateIntegrationTestsResult,
  GenerateUnitTestsResult,
  SubAgentState,
  SubAgentStore,
  TaskStatus,
  TechnicalStory,
  TestLoopState,
  TestLoopStatus,
  UserStory,
} from "../shared/api";
import type { Artifacts } from "./phases";
import { parseTechnicalStories } from "./technical-stories";
import { parseUserStories } from "./user-stories";
import { MarkdownEditor } from "./MarkdownEditor";

interface ImplementationViewProps {
  specPath: string;
  artifacts: Artifacts;
  agentMode: AgentMode;
  onCodeChange: (code: string) => void;
}

type Tab = "stories" | "integration" | "testloop" | "code";

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
  const userStories = useMemo(
    () => parseUserStories(artifacts.userStories),
    [artifacts.userStories],
  );
  const [tab, setTab] = useState<Tab>("stories");
  const [selectedId, setSelectedId] = useState<string | null>(stories[0]?.id ?? null);
  const [store, setStore] = useState<SubAgentStore>({});
  const [busy, setBusy] = useState<"decompose" | "chat" | "run" | "tests" | null>(
    null,
  );
  const [testsByStory, setTestsByStory] = useState<
    Record<string, GenerateUnitTestsResult>
  >({});
  const [integrationByStory, setIntegrationByStory] = useState<
    Record<string, GenerateIntegrationTestsResult>
  >({});
  const [integrationBusy, setIntegrationBusy] = useState<string | null>(null);
  const [testLoopState, setTestLoopState] = useState<TestLoopState>({
    status: "idle",
    iterations: [],
    maxIterations: 5,
  });
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

  useEffect(() => {
    window.specops.getTestLoopState().then(setTestLoopState);
    return window.specops.onTestLoopUpdate(setTestLoopState);
  }, []);

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

  async function generateTests(): Promise<void> {
    if (!selectedStory || busy) return;
    setBusy("tests");
    try {
      const res = await window.specops.generateUnitTests({
        specPath,
        story: selectedStory,
        artifacts: toApiArtifacts(artifacts),
      });
      setTestsByStory((m) => ({ ...m, [res.storyId]: res }));
    } finally {
      setBusy(null);
    }
  }

  async function generateIntegrationFor(story: UserStory): Promise<void> {
    if (integrationBusy) return;
    setIntegrationBusy(story.id);
    try {
      const res = await window.specops.generateIntegrationTests({
        specPath,
        story,
        artifacts: toApiArtifacts(artifacts),
      });
      setIntegrationByStory((m) => ({ ...m, [res.storyId]: res }));
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function resetStory(): Promise<void> {
    if (!selectedStory) return;
    const next = await window.specops.resetSubAgent(specPath, selectedStory.id);
    setStore(next);
    setPendingApproval(null);
  }

  async function startTestLoop(): Promise<void> {
    await window.specops.startTestLoop({
      specPath,
      artifacts: toApiArtifacts(artifacts),
    });
  }

  async function stopTestLoop(): Promise<void> {
    await window.specops.stopTestLoop();
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
        <MarkdownEditor
          value={artifacts.code}
          onChange={(v) => onCodeChange(v)}
          placeholder="// code notes — implementation agent will drive real edits"
        />
      </div>
    );
  }

  if (tab === "integration") {
    return (
      <div style={layoutStyle}>
        <Tabs tab={tab} onChange={setTab} />
        <IntegrationTestsPanel
          userStories={userStories}
          results={integrationByStory}
          busyId={integrationBusy}
          onGenerate={generateIntegrationFor}
        />
      </div>
    );
  }

  if (tab === "testloop") {
    return (
      <div style={layoutStyle}>
        <Tabs tab={tab} onChange={setTab} />
        <TestLoopPanel
          state={testLoopState}
          onStart={startTestLoop}
          onStop={stopTestLoop}
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
              onGenerateTests={generateTests}
              tests={testsByStory[selectedStory.id] ?? null}
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
    { id: "integration", label: "Integration tests" },
    { id: "testloop", label: "Test loop" },
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
  onGenerateTests,
  tests,
}: {
  story: TechnicalStory;
  state: SubAgentState | null;
  draft: string;
  setDraft: (v: string) => void;
  busy: "decompose" | "chat" | "run" | "tests" | null;
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
  onGenerateTests: () => void;
  tests: GenerateUnitTestsResult | null;
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
          <button
            onClick={onGenerateTests}
            disabled={busy !== null}
            style={buttonStyle(busy === "tests")}
            title="Generate unit tests from this story and save them in tests/unit/"
          >
            {busy === "tests" ? "Generating…" : "Generate tests"}
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
        {tests && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "#151a20",
              border: tests.error ? "1px solid #a33" : "1px solid #2f855a",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {tests.error ? (
              <div style={{ color: "#ff8080" }}>
                Test generation failed: {tests.error}
              </div>
            ) : (
              <>
                <div style={{ opacity: 0.8 }}>
                  Unit tests written to <code>{tests.path}</code>
                </div>
                {tests.summary && (
                  <div style={{ marginTop: 4, opacity: 0.65 }}>{tests.summary}</div>
                )}
                {tests.content && (
                  <pre
                    style={{
                      marginTop: 6,
                      maxHeight: 180,
                      overflow: "auto",
                      background: "#0f1115",
                      color: "#dce6f0",
                      padding: 8,
                      borderRadius: 3,
                      fontSize: 11,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {tests.content}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
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
            {(busy === "chat" || busy === "run" || busy === "tests") && (
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
                {busy === "run"
                  ? "Sub-agent working…"
                  : busy === "tests"
                    ? "Generating unit tests…"
                    : "Thinking…"}
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

function IntegrationTestsPanel({
  userStories,
  results,
  busyId,
  onGenerate,
}: {
  userStories: UserStory[];
  results: Record<string, GenerateIntegrationTestsResult>;
  busyId: string | null;
  onGenerate: (story: UserStory) => void;
}): JSX.Element {
  if (userStories.length === 0) {
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
        No User Stories detected. Go back to the User Stories phase and add some
        (headings like `## US-1: …` or bullets starting with `As a …`).
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        Integration tests are derived from User Stories and saved under
        <code> tests/integration/</code>. The sub-agent picks an appropriate stack
        (Playwright, Flutter, XCUITest, Espresso) from your spec or writes
        framework-agnostic Given/When/Then scenarios.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {userStories.map((story) => {
          const res = results[story.id] ?? null;
          const busy = busyId === story.id;
          return (
            <div
              key={story.id}
              style={{
                padding: "10px 12px",
                background: "#151515",
                border: "1px solid #2a2a2a",
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, opacity: 0.65 }}>{story.id}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {story.title || "(untitled)"}
                  </div>
                </div>
                <button
                  onClick={() => onGenerate(story)}
                  disabled={busyId !== null}
                  style={buttonStyle(busy)}
                  title="Generate integration tests for this story"
                >
                  {busy ? "Generating…" : res ? "Regenerate" : "Generate"}
                </button>
              </div>
              {story.body && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    opacity: 0.7,
                    whiteSpace: "pre-wrap",
                    maxHeight: 90,
                    overflowY: "auto",
                  }}
                >
                  {story.body}
                </div>
              )}
              {res && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    background: "#0f1115",
                    border: res.error ? "1px solid #a33" : "1px solid #2f855a",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {res.error ? (
                    <div style={{ color: "#ff8080" }}>
                      Integration test generation failed: {res.error}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.8 }}>
                        <span>Written to <code>{res.path}</code></span>
                        {res.framework === "playwright" && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: "#2e7d32",
                              color: "#fff",
                              fontWeight: 600,
                            }}
                          >
                            Playwright
                          </span>
                        )}
                      </div>
                      {res.summary && (
                        <div style={{ marginTop: 4, opacity: 0.65 }}>
                          {res.summary}
                        </div>
                      )}
                      {res.content && (
                        <pre
                          style={{
                            marginTop: 6,
                            maxHeight: 240,
                            overflow: "auto",
                            background: "#0a0b0f",
                            color: "#dce6f0",
                            padding: 8,
                            borderRadius: 3,
                            fontSize: 11,
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {res.content}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TESTLOOP_STATUS_LABEL: Record<TestLoopStatus, string> = {
  idle: "Ready to run",
  "running-tests": "Running tests…",
  analyzing: "Analyzing failures…",
  fixing: "Applying fix…",
  passed: "All tests passed",
  "max-iterations": "Max iterations reached — failures remain",
  error: "Error",
  stopped: "Stopped",
};

function testLoopStatusColor(status: TestLoopStatus): string {
  switch (status) {
    case "passed":
      return "#68d391";
    case "error":
    case "stopped":
      return "#fc8181";
    case "max-iterations":
      return "#f6ad55";
    default:
      return "#e6e6e6";
  }
}

function TestLoopPanel({
  state,
  onStart,
  onStop,
}: {
  state: TestLoopState;
  onStart: () => void;
  onStop: () => void;
}): JSX.Element {
  const isRunning =
    state.status === "running-tests" ||
    state.status === "analyzing" ||
    state.status === "fixing";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
        The autonomous test loop runs all unit and integration tests, then asks
        the agent to decide — fix the source code or correct the test — and
        applies the fix. It repeats until everything passes or the iteration
        limit is reached.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: testLoopStatusColor(state.status),
          }}
        >
          {TESTLOOP_STATUS_LABEL[state.status]}
        </div>
        {isRunning ? (
          <button
            onClick={onStop}
            style={{ ...buttonStyle(false), background: "#3a1e1e" }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onStart}
            style={{
              ...buttonStyle(false),
              background: "#2f855a",
              color: "#fff",
            }}
          >
            {state.iterations.length > 0 ? "Re-run loop" : "Start test loop"}
          </button>
        )}
      </div>

      {state.error && (
        <div
          style={{
            padding: "8px 10px",
            background: "#2a1515",
            border: "1px solid #a33",
            borderRadius: 4,
            fontSize: 12,
            color: "#ff8080",
            marginBottom: 12,
          }}
        >
          {state.error}
        </div>
      )}

      {state.iterations.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 12 }}>
          No iterations yet. Generate unit / integration tests in the other
          tabs, then start the loop.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {state.iterations.map((iter) => (
            <div
              key={iter.iteration}
              style={{
                padding: "10px 12px",
                background: "#151515",
                border: `1px solid ${iter.failures === 0 ? "#2f855a" : "#7a4a00"}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Iteration {iter.iteration}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: iter.failures === 0 ? "#2f855a" : "#7a4a00",
                    color: "#fff",
                    fontWeight: 600,
                  }}
                >
                  {iter.failures === 0
                    ? "ALL PASSED"
                    : `${iter.failures} failure${iter.failures > 1 ? "s" : ""}`}
                </span>
                {iter.verdict && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background:
                        iter.verdict === "fix-code" ? "#2b6cb0" : "#6b46c1",
                      color: "#fff",
                      fontWeight: 600,
                    }}
                  >
                    {iter.verdict === "fix-code" ? "Fixed code" : "Fixed test"}
                  </span>
                )}
              </div>

              {iter.agentSummary && (
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    marginBottom: 8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {iter.agentSummary}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {iter.results.map((r) => (
                  <div
                    key={r.file}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 6px",
                      background: "#0f1115",
                      borderRadius: 3,
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: r.passed ? "#2f855a" : "#c53030",
                        flexShrink: 0,
                      }}
                    />
                    <code style={{ flex: 1, opacity: 0.85 }}>{r.file}</code>
                    <span style={{ opacity: 0.5, fontSize: 10 }}>
                      {r.duration > 0 ? `${(r.duration / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                ))}
              </div>

              {iter.results.some((r) => !r.passed) && (
                <details style={{ marginTop: 8 }}>
                  <summary
                    style={{ fontSize: 11, cursor: "pointer", opacity: 0.7 }}
                  >
                    Show failure output
                  </summary>
                  {iter.results
                    .filter((r) => !r.passed)
                    .map((r) => (
                      <pre
                        key={r.file}
                        style={{
                          marginTop: 6,
                          maxHeight: 200,
                          overflow: "auto",
                          background: "#0a0b0f",
                          color: "#ff8080",
                          padding: 8,
                          borderRadius: 3,
                          fontSize: 10,
                          lineHeight: 1.4,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {`--- ${r.file} ---\n${r.stderr || r.stdout}`}
                      </pre>
                    ))}
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
