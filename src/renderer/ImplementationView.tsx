import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMode,
  ArtifactFiles,
  GenerateIntegrationTestsResult,
  GenerateUnitTestsResult,
  IntegrationTestFramework,
  MergeCheckResult,
  MergeResult,
  WorkerState,
  WorkerStore,
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
  pending: "pending",
  "in-progress": "running",
  done: "done",
};

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  pending: "in-progress",
  "in-progress": "done",
  done: "pending",
};

const FRAMEWORK_BADGE: Record<
  Exclude<IntegrationTestFramework, "generic">,
  { label: string; cls: string }
> = {
  playwright: { label: "Playwright", cls: "ok" },
  flutter: { label: "Flutter", cls: "info" },
  xcuitest: { label: "XCUITest", cls: "warn" },
  espresso: { label: "Espresso", cls: "magenta" },
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
  const [store, setStore] = useState<WorkerStore>({});
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
  const [mergeCheck, setMergeCheck] = useState<MergeCheckResult | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [mergeBusy, setMergeBusy] = useState<"check" | "merge" | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingApproval, setPendingApproval] = useState<{
    storyId: string;
    taskId: string;
  } | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    window.specops.readWorkers(specPath).then(setStore);
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
  const selectedState: WorkerState | null = selectedId ? store[selectedId] ?? null : null;

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
      const state = await window.specops.workerChat({
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
    const next = await window.specops.resetWorker(specPath, selectedStory.id);
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

  async function runMergeCheck(): Promise<void> {
    if (mergeBusy) return;
    setMergeBusy("check");
    try {
      const c = await window.specops.checkMerge(specPath);
      setMergeCheck(c);
      setMergeResult(null);
    } finally {
      setMergeBusy(null);
    }
  }

  async function runMerge(): Promise<void> {
    if (mergeBusy) return;
    setMergeBusy("merge");
    try {
      const r = await window.specops.mergeToMain(specPath);
      setMergeResult(r);
      setMergeCheck(r.check);
    } finally {
      setMergeBusy(null);
    }
  }

  async function runTask(
    story: TechnicalStory,
    taskId: string,
    autoComplete: boolean,
  ): Promise<WorkerState> {
    const state = await window.specops.runWorkerTask({
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
        (await window.specops.readWorkers(specPath).then((s) => {
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
    if (selectedStory) {
      void window.specops.stopWorker(specPath, selectedStory.id);
    }
  }

  if (tab === "code") {
    return (
      <div className="flex-col flex-1">
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
      <div className="flex-col flex-1">
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
      <div className="flex-col flex-1">
        <Tabs tab={tab} onChange={setTab} />
        <TestLoopPanel
          state={testLoopState}
          onStart={startTestLoop}
          onStop={stopTestLoop}
          mergeCheck={mergeCheck}
          mergeResult={mergeResult}
          mergeBusy={mergeBusy}
          onCheckMerge={runMergeCheck}
          onMerge={runMerge}
        />
      </div>
    );
  }

  return (
    <div className="flex-col flex-1">
      <Tabs tab={tab} onChange={setTab} />
      {stories.length === 0 ? (
        <EmptyStories />
      ) : (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "280px 1fr",
            minHeight: 0,
          }}
        >
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
            <div style={{ padding: 24, color: "var(--fg-2)" }}>select a story</div>
          )}
        </div>
      )}
    </div>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }): JSX.Element {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "stories", label: "workers" },
    { id: "integration", label: "integration tests" },
    { id: "testloop", label: "test loop" },
    { id: "code", label: "code notes" },
  ];
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={tab === t.id ? "active" : ""}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function EmptyStories(): JSX.Element {
  return (
    <div className="empty-state">
      <div className="msg">
        no technical stories yet. go back to the technical stories phase and define
        some (<code className="inline">TS-1</code>, <code className="inline">TS-2</code>…)
        so each can get its own Worker.
      </div>
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
  store: WorkerStore;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div className="story-list">
      {stories.map((s) => {
        const state = store[s.id];
        const progress = state ? progressLabel(state) : "not started";
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={active ? "active" : ""}
          >
            <div className="story-id">{s.id}</div>
            <div className="story-title">{s.title || "(untitled)"}</div>
            <div className="story-meta">{progress}</div>
          </button>
        );
      })}
    </div>
  );
}

function progressLabel(state: WorkerState): string {
  if (state.status === "decomposing") return "decomposing…";
  if (state.status === "running") return "Worker thinking…";
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
  state: WorkerState | null;
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
    <div className="story-workspace flex-1">
      <div className="story-head">
        <div className="id">{story.id}</div>
        <div className="title">{story.title || "(untitled)"}</div>
        {story.body && <div className="body">{story.body}</div>}
      </div>
      <div className="story-toolbar">
        <div className="story-toolbar-row">
          <div className="story-toolbar-title">
            tasks {tasks.length > 0 && `(${tasks.length})`}
            <span className={`badge ${agentMode === "yolo" ? "yolo" : "hitl"}`}>
              {agentMode === "yolo" ? "YOLO" : "HITL"}
            </span>
          </div>
          {busy !== null ? (
            <button
              className="btn btn-danger btn-sm"
              onClick={onStop}
              title="abort the running worker call"
            >
              stop
            </button>
          ) : (
            <button
              className={`btn btn-sm ${agentMode === "yolo" ? "btn-primary" : ""}`}
              onClick={onRun}
              disabled={pendingApproval !== null}
              title={
                agentMode === "yolo"
                  ? "autonomously run all pending tasks"
                  : "run next task, then wait for confirmation"
              }
            >
              {agentMode === "yolo" ? "▶ run all (yolo)" : "▶ run next"}
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={onDecompose}
            disabled={busy !== null}
          >
            {busy === "decompose"
              ? "decomposing…"
              : tasks.length
                ? "re-decompose"
                : "decompose"}
          </button>
          <button
            className="btn btn-sm"
            onClick={onGenerateTests}
            disabled={busy !== null}
            title="Generate unit tests from this story and save them in tests/unit/"
          >
            {busy === "tests" ? "generating…" : "generate tests"}
          </button>
          {tasks.length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={onReset}
              disabled={busy !== null}
            >
              reset
            </button>
          )}
        </div>
        {tests && (
          <div className={`notice ${tests.error ? "danger" : "ok"}`}>
            {tests.error ? (
              <div>test generation failed: {tests.error}</div>
            ) : (
              <div className="grow">
                <div>
                  unit tests written to <code className="inline">{tests.path}</code>
                </div>
                {tests.summary && (
                  <div style={{ color: "var(--fg-2)", marginTop: 4 }}>{tests.summary}</div>
                )}
                {tests.content && <pre className="code-block">{tests.content}</pre>}
              </div>
            )}
          </div>
        )}
        {pendingApproval && (
          <div className="notice info">
            <span className="grow">
              hitl: confirm completion of <strong>{pendingApproval}</strong> to continue
            </span>
            <button className="btn btn-success btn-sm" onClick={onApprove}>
              approve & continue
            </button>
            <button className="btn btn-danger btn-sm" onClick={onReject}>
              cancel
            </button>
          </div>
        )}
        {state?.error && (
          <div style={{ color: "var(--danger)", fontSize: "var(--fs-sm)", marginTop: 8 }}>
            {state.error}
          </div>
        )}
        {tasks.length > 0 ? (
          <div className="task-list">
            {tasks.map((t) => (
              <div key={t.id} className="task-item">
                <button
                  onClick={() => onCycleTask(t.id, t.status)}
                  title="cycle status"
                  className={`task-status ${t.status}`}
                >
                  {STATUS_LABEL[t.status]}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="task-title">
                    {t.id} · {t.title}
                  </div>
                  {t.description && <div className="task-desc">{t.description}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: "var(--fs-sm)", color: "var(--fg-3)" }}>
            click decompose to break this story into implementation chunks
          </div>
        )}
      </div>
      <div ref={scrollRef} className="chat-log" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--fg-2)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Worker chat — isolated to <span style={{ color: "var(--accent)" }}>{story.id}</span>
        </div>
        {state?.messages.length ? (
          <>
            {state.messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {(busy === "chat" || busy === "run" || busy === "tests") && (
              <div className="chat-msg thinking">
                {busy === "run"
                  ? "Worker working…"
                  : busy === "tests"
                    ? "generating unit tests…"
                    : "thinking…"}
              </div>
            )}
          </>
        ) : (
          <div className="chat-empty">ask this Worker anything scoped to {story.id}</div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={busy === "chat" ? "waiting…" : `message the ${story.id} Worker…`}
          rows={2}
          disabled={busy !== null}
        />
        <button
          className="btn btn-primary"
          onClick={onSend}
          disabled={busy !== null}
        >
          send ↵
        </button>
      </div>
    </div>
  );
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
      <div className="empty-state">
        <div className="msg">
          no user stories detected. go back to the user stories phase and add some
          (headings like <code className="inline">## US-1: …</code> or bullets
          starting with <code className="inline">As a …</code>).
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)", marginBottom: 14 }}>
        integration tests are derived from user stories and saved under{" "}
        <code className="inline">tests/integration/</code>. the Worker picks an
        appropriate stack (Playwright, Flutter, XCUITest, Espresso) from your spec
        or writes framework-agnostic Given/When/Then scenarios.
      </div>
      <div className="flex-col" style={{ gap: 10 }}>
        {userStories.map((story) => {
          const res = results[story.id] ?? null;
          const busy = busyId === story.id;
          return (
            <div key={story.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--accent)", fontWeight: 600 }}>
                    {story.id}
                  </div>
                  <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--fg-0)" }}>
                    {story.title || "(untitled)"}
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => onGenerate(story)}
                  disabled={busyId !== null}
                  title="generate integration tests for this story"
                >
                  {busy ? "generating…" : res ? "regenerate" : "generate"}
                </button>
              </div>
              {story.body && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: "var(--fs-sm)",
                    color: "var(--fg-2)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 90,
                    overflowY: "auto",
                  }}
                >
                  {story.body}
                </div>
              )}
              {res && (
                <div className={`notice ${res.error ? "danger" : "ok"}`}>
                  {res.error ? (
                    <div>integration test generation failed: {res.error}</div>
                  ) : (
                    <div className="grow">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>
                          written to <code className="inline">{res.path}</code>
                        </span>
                        {res.framework !== "generic" && (
                          <span className={`badge ${FRAMEWORK_BADGE[res.framework].cls}`}>
                            {FRAMEWORK_BADGE[res.framework].label}
                          </span>
                        )}
                      </div>
                      {res.summary && (
                        <div style={{ marginTop: 4, color: "var(--fg-2)" }}>{res.summary}</div>
                      )}
                      {res.content && <pre className="code-block">{res.content}</pre>}
                    </div>
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
  idle: "ready to run",
  "running-tests": "running tests…",
  analyzing: "analyzing failures…",
  fixing: "applying fix…",
  passed: "all tests passed",
  "max-iterations": "max iterations reached — failures remain",
  error: "error",
  stopped: "stopped",
};

function testLoopStatusClass(status: TestLoopStatus): string {
  switch (status) {
    case "passed":
      return "ok";
    case "error":
    case "stopped":
      return "danger";
    case "max-iterations":
      return "warn";
    default:
      return "info";
  }
}

function TestLoopPanel({
  state,
  onStart,
  onStop,
  mergeCheck,
  mergeResult,
  mergeBusy,
  onCheckMerge,
  onMerge,
}: {
  state: TestLoopState;
  onStart: () => void;
  onStop: () => void;
  mergeCheck: MergeCheckResult | null;
  mergeResult: MergeResult | null;
  mergeBusy: "check" | "merge" | null;
  onCheckMerge: () => void;
  onMerge: () => void;
}): JSX.Element {
  const isRunning =
    state.status === "running-tests" ||
    state.status === "analyzing" ||
    state.status === "fixing";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)", marginBottom: 14 }}>
        the autonomous test loop runs all unit and integration tests, then asks
        the agent to decide — fix the source code or correct the test — and
        applies the fix. it repeats until everything passes or the iteration
        limit is reached.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <div className={`status-text ${testLoopStatusClass(state.status)}`} style={{ flex: 1 }}>
          ● {TESTLOOP_STATUS_LABEL[state.status]}
        </div>
        {isRunning ? (
          <button className="btn btn-danger btn-sm" onClick={onStop}>
            stop
          </button>
        ) : (
          <button className="btn btn-success btn-sm" onClick={onStart}>
            {state.iterations.length > 0 ? "▶ re-run loop" : "▶ start test loop"}
          </button>
        )}
      </div>

      {state.error && <div className="notice danger">{state.error}</div>}

      <MergePanel
        testsPassed={state.status === "passed"}
        check={mergeCheck}
        result={mergeResult}
        busy={mergeBusy}
        onCheck={onCheckMerge}
        onMerge={onMerge}
      />

      {state.iterations.length === 0 ? (
        <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>
          no iterations yet. generate unit / integration tests in the other tabs,
          then start the loop.
        </div>
      ) : (
        <div className="flex-col" style={{ gap: 12 }}>
          {state.iterations.map((iter) => (
            <div
              key={iter.iteration}
              className={`iter ${iter.failures === 0 ? "passed" : "failing"}`}
            >
              <div className="iter-head">
                <span className="iter-title">iteration {iter.iteration}</span>
                <span className={`badge ${iter.failures === 0 ? "ok" : "warn"}`}>
                  {iter.failures === 0
                    ? "ALL PASSED"
                    : `${iter.failures} FAILURE${iter.failures > 1 ? "S" : ""}`}
                </span>
                {iter.verdict && (
                  <span className={`badge ${iter.verdict === "fix-code" ? "info" : "magenta"}`}>
                    {iter.verdict === "fix-code" ? "FIXED CODE" : "FIXED TEST"}
                  </span>
                )}
              </div>

              {iter.agentSummary && (
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--fg-1)",
                    marginBottom: 8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {iter.agentSummary}
                </div>
              )}

              <div className="flex-col" style={{ gap: 4 }}>
                {iter.results.map((r) => (
                  <div key={r.file} className="test-row">
                    <span className={`dot ${r.passed ? "ok" : "fail"}`} />
                    <code>{r.file}</code>
                    <span className="duration">
                      {r.duration > 0 ? `${(r.duration / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                ))}
              </div>

              {iter.results.some((r) => !r.passed) && (
                <details style={{ marginTop: 8 }}>
                  <summary
                    style={{
                      fontSize: "var(--fs-xs)",
                      cursor: "pointer",
                      color: "var(--fg-2)",
                    }}
                  >
                    show failure output
                  </summary>
                  {iter.results
                    .filter((r) => !r.passed)
                    .map((r) => (
                      <pre key={r.file} className="code-block failure">
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

function MergePanel({
  testsPassed,
  check,
  result,
  busy,
  onCheck,
  onMerge,
}: {
  testsPassed: boolean;
  check: MergeCheckResult | null;
  result: MergeResult | null;
  busy: "check" | "merge" | null;
  onCheck: () => void;
  onMerge: () => void;
}): JSX.Element {
  const ready = check?.ready ?? false;
  const merged = result?.ok ?? false;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="section-title" style={{ flex: 1 }}>merge to main</div>
        <button
          className="btn btn-sm"
          onClick={onCheck}
          disabled={busy !== null}
          title="re-run merge safety checks"
        >
          {busy === "check" ? "checking…" : "run safety checks"}
        </button>
        <button
          className={`btn btn-sm ${ready ? "btn-success" : ""}`}
          onClick={onMerge}
          disabled={busy !== null || !ready}
          title={
            ready
              ? "merge this spec branch into main"
              : "run safety checks and resolve issues before merging"
          }
        >
          {busy === "merge" ? "merging…" : "merge to main"}
        </button>
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--fg-2)", marginBottom: 8 }}>
        auto-merges <code className="inline">{check?.branch ?? "this spec branch"}</code> into{" "}
        <code className="inline">{check?.mainBranch ?? "main"}</code> after verifying the test
        loop is green, the working tree is clean, and the branch is up-to-date with the remote
        (when present).
      </div>
      {!testsPassed && !check && (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)" }}>
          tip: run the test loop to "passed" first, then re-run safety checks.
        </div>
      )}
      {check && (
        <div className="flex-col" style={{ gap: 4, marginBottom: 8 }}>
          <CheckRow label="tests passed" ok={check.testsPassed} />
          <CheckRow label="working tree clean" ok={check.workingTreeClean} />
          <CheckRow label="branch up-to-date with origin/main" ok={check.branchUpToDate} />
          {check.issues.length > 0 && (
            <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "var(--fs-sm)", color: "var(--danger)" }}>
              {check.issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result && (
        <div className={`notice ${merged ? "ok" : "danger"}`}>
          {merged
            ? `merged ${result.branch} → ${result.mainBranch} at ${result.mergedAt}`
            : `merge failed: ${result.error ?? "see safety checks above"}`}
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)" }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--danger)",
          boxShadow: `0 0 4px ${ok ? "var(--ok)" : "var(--danger)"}`,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--fg-1)" }}>{label}</span>
    </div>
  );
}
