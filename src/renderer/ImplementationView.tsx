import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ArtifactFiles,
  GenerateIntegrationTestsResult,
  GenerateUnitTestsResult,
  MergeCheckResult,
  MergeResult,
  WorkerState,
  WorkerStore,
  TaskStatus,
  TechnicalStory,
  TestLoopState,
  UserStory,
} from "../shared/api";
import type { Artifacts } from "./phases";
import { parseTechnicalStories } from "./technical-stories";
import { parseUserStories } from "./user-stories";
import { MarkdownEditor } from "./MarkdownEditor";
import { StoryList } from "./components/StoryList";
import { StoryWorkspace } from "./components/StoryWorkspace";
import { IntegrationTestsPanel } from "./components/IntegrationTestsPanel";
import { TestLoopPanel } from "./components/TestLoopPanel";

interface ImplementationViewProps {
  specPath: string;
  artifacts: Artifacts;
  agentMode: "hitl" | "yolo";
  onCodeChange: (code: string) => void;
}

type Tab = "stories" | "integration" | "testloop" | "code";

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
  const [cliBuffers, setCliBuffers] = useState<Record<string, string>>({});
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

  useEffect(() => {
    return window.specops.onCliChunk(({ storyId, text }) => {
      setCliBuffers((prev) => ({
        ...prev,
        [storyId]: (prev[storyId] ?? "") + text,
      }));
    });
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
    const nextStatus: Record<TaskStatus, TaskStatus> = {
      pending: "in-progress",
      "in-progress": "done",
      "needs-attention": "done",
      done: "pending",
    };
    const state = await window.specops.updateTaskStatus(
      specPath,
      selectedStory.id,
      taskId,
      nextStatus[current],
    );
    setStore((s) => ({ ...s, [state.storyId]: state }));
  }

  async function markTaskDone(taskId: string): Promise<void> {
    if (!selectedStory) return;
    const state = await window.specops.updateTaskStatus(
      specPath,
      selectedStory.id,
      taskId,
      "done",
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
    setCliBuffers((prev) => {
      const updated = { ...prev };
      delete updated[selectedStory.id];
      return updated;
    });
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
    setCliBuffers((prev) => ({ ...prev, [story.id]: "" }));
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

  async function runStory(freshState?: WorkerState): Promise<void> {
    if (!selectedStory || busy) return;
    stopRef.current = false;
    setBusy("run");
    setPendingApproval(null);
    try {
      let state: WorkerState | undefined =
        freshState ??
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
        const next = state.tasks.find(
          (t) => t.status !== "done" && t.status !== "needs-attention",
        );
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
    void runStory(state);
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
              cliBuffer={cliBuffers[selectedStory.id] ?? ""}
              onDecompose={decompose}
              onSend={sendChat}
              onCycleTask={cycleTask}
              onMarkDone={markTaskDone}
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
