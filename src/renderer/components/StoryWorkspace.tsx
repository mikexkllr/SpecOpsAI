import React, { useEffect, useRef } from "react";
import type {
  AgentMode,
  GenerateUnitTestsResult,
  TaskStatus,
  TechnicalStory,
  WorkerState,
} from "../../shared/api";

function ReviewerMessage({ text }: { text: string }): JSX.Element {
  const match = text.match(/^\[(approved|changes-requested)\]\s*/);
  const verdict = match ? (match[1] as "approved" | "changes-requested") : null;
  const summary = match ? text.slice(match[0].length) : text;
  return (
    <div
      className="chat-msg reviewer"
      style={{
        borderLeft: `3px solid ${verdict === "approved" ? "var(--success, #4caf50)" : verdict === "changes-requested" ? "var(--danger, #f44336)" : "var(--accent)"}`,
        paddingLeft: 10,
        background: "var(--surface-2, rgba(255,255,255,0.03))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
          fontSize: "var(--fs-xs)",
          color: "var(--fg-2)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        <span>reviewer</span>
        {verdict && (
          <span
            style={{
              color: verdict === "approved" ? "var(--success, #4caf50)" : "var(--danger, #f44336)",
              fontWeight: 600,
            }}
          >
            {verdict === "approved" ? "✓ approved" : "⚠ changes requested"}
          </span>
        )}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{summary}</div>
    </div>
  );
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "pending",
  "in-progress": "running",
  "needs-attention": "review",
  done: "done",
};

interface StoryWorkspaceProps {
  story: TechnicalStory;
  state: WorkerState | null;
  draft: string;
  setDraft: (v: string) => void;
  busy: "decompose" | "chat" | "run" | "tests" | null;
  agentMode: AgentMode;
  pendingApproval: string | null;
  cliBuffer: string;
  onDecompose: () => void;
  onSend: () => void;
  onCycleTask: (taskId: string, current: TaskStatus) => void;
  onMarkDone: (taskId: string) => void;
  onReset: () => void;
  onRun: () => void;
  onStop: () => void;
  onApprove: () => void;
  onReject: () => void;
  onGenerateTests: () => void;
  tests: GenerateUnitTestsResult | null;
}

export function StoryWorkspace({
  story,
  state,
  draft,
  setDraft,
  busy,
  agentMode,
  pendingApproval,
  cliBuffer,
  onDecompose,
  onSend,
  onCycleTask,
  onMarkDone,
  onReset,
  onRun,
  onStop,
  onApprove,
  onReject,
  onGenerateTests,
  tests,
}: StoryWorkspaceProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state?.messages.length, busy, cliBuffer]);

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
                {t.status === "needs-attention" && (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => onMarkDone(t.id)}
                    title="mark this task as done after reviewing the CLI output"
                  >
                    mark done
                  </button>
                )}
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
            {state.messages.map((m, i) =>
              m.role === "terminal" ? (
                <pre key={i} className="terminal-msg">{m.text}</pre>
              ) : m.role === "reviewer" ? (
                <ReviewerMessage key={i} text={m.text} />
              ) : (
                <div key={i} className={`chat-msg ${m.role}`}>
                  {m.text}
                </div>
              ),
            )}
            {busy === "run" && cliBuffer && (
              <pre className="terminal-msg terminal-live">{cliBuffer}</pre>
            )}
            {(busy === "chat" || busy === "run" || busy === "tests") && !cliBuffer && (
              <div className="chat-msg thinking">
                {busy === "run"
                  ? "reviewing…"
                  : busy === "tests"
                    ? "generating unit tests…"
                    : "thinking…"}
              </div>
            )}
          </>
        ) : (
          <>
            {busy === "run" && cliBuffer ? (
              <pre className="terminal-msg terminal-live">{cliBuffer}</pre>
            ) : (
              <div className="chat-empty">ask this Worker anything scoped to {story.id}</div>
            )}
          </>
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
