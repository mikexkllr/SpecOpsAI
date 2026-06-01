import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Phase } from "./phases";
import type { AgentActivityItem, AgentStreamEvent } from "../shared/api";
import { renderMarkdown } from "./markdown";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  // Persisted thinking / tool-call trace for an agent reply (see chat.ts).
  activity?: AgentActivityItem[];
}

// --- live activity model --------------------------------------------------
// Accumulated, in-order trace of what the agent emitted during a turn:
// reasoning ("thinking"), nested-subagent visible text ("subtext"), and tool
// calls. The top-level reply text streams separately into `liveText` so it can
// render as a forming agent bubble without duplicating the persisted reply.
export type ActivityItem = AgentActivityItem;

export interface PhaseActivity {
  items: ActivityItem[];
  liveText: string;
}

export const EMPTY_PHASE_ACTIVITY: PhaseActivity = { items: [], liveText: "" };

function appendText(
  items: ActivityItem[],
  kind: "thinking" | "subtext",
  depth: number,
  text: string,
): ActivityItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === kind && last.depth === depth) {
    const copy = items.slice();
    copy[copy.length - 1] = { ...last, text: last.text + text };
    return copy;
  }
  return [...items, { kind, depth, text }];
}

export function reduceActivity(prev: PhaseActivity, ev: AgentStreamEvent): PhaseActivity {
  switch (ev.kind) {
    case "thinking":
      return { ...prev, items: appendText(prev.items, "thinking", ev.depth, ev.text) };
    case "text":
      // Top-level reply text forms the agent bubble; nested subagent text is
      // surfaced in the transcript so the user can see delegated work.
      return ev.depth === 0
        ? { ...prev, liveText: prev.liveText + ev.text }
        : { ...prev, items: appendText(prev.items, "subtext", ev.depth, ev.text) };
    case "tool-start":
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            kind: "tool",
            depth: ev.depth,
            name: ev.name,
            input: ev.input,
            done: false,
            toolCallId: ev.toolCallId,
          },
        ],
      };
    case "tool-end": {
      const items = prev.items.slice();
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (
          it.kind === "tool" &&
          !it.done &&
          (it.toolCallId === ev.toolCallId || (!ev.toolCallId && it.name === ev.name))
        ) {
          items[i] = { ...it, output: ev.output, done: true };
          return { ...prev, items };
        }
      }
      return {
        ...prev,
        items: [
          ...items,
          {
            kind: "tool",
            depth: ev.depth,
            name: ev.name,
            input: undefined,
            output: ev.output,
            done: true,
            toolCallId: ev.toolCallId,
          },
        ],
      };
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return truncate(input, 80);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const keys = [
      "file_path",
      "path",
      "pattern",
      "query",
      "command",
      "url",
      "description",
      "subagent_type",
    ];
    for (const k of keys) {
      if (typeof o[k] === "string") return truncate(o[k] as string, 80);
    }
    try {
      return truncate(JSON.stringify(o), 80);
    } catch {
      return "";
    }
  }
  return truncate(String(input), 80);
}

// --- tool-call rendering helpers ------------------------------------------
type ToolItem = Extract<ActivityItem, { kind: "tool" }>;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface TodoEntry {
  text: string;
  status: string;
}

// deepagents' write_todos passes `{ todos: [{ content, status }] }`; the worker
// decomposition's emit_tasks passes `{ tasks: [{ title, description }] }`. Both
// read better as a checklist than as raw JSON.
function extractTodos(input: unknown): TodoEntry[] | null {
  const arr = asObj(input).todos ?? asObj(input).tasks;
  if (!Array.isArray(arr)) return null;
  const out: TodoEntry[] = [];
  for (const raw of arr) {
    const t = asObj(raw);
    const text =
      asStr(t.content) ?? asStr(t.title) ?? asStr(t.activeForm) ?? asStr(t.description);
    if (text) out.push({ text, status: asStr(t.status) ?? "pending" });
  }
  return out.length ? out : null;
}

function todoGlyph(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("progress")) return "◐";
  if (s === "done" || s === "completed") return "✓";
  return "○";
}

// A clean, schema-aware one-liner for the collapsed tool row.
function toolSummary(name: string, input: unknown): string {
  const o = asObj(input);
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return asStr(o.file_path) ?? asStr(o.path) ?? "";
    case "ls":
      return asStr(o.path) ?? "/";
    case "glob":
      return asStr(o.pattern) ?? "";
    case "grep":
      return [
        asStr(o.pattern) ? `"${asStr(o.pattern)}"` : "",
        asStr(o.path) ? `in ${asStr(o.path)}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "task":
      return [asStr(o.subagent_type), asStr(o.description)].filter(Boolean).join(" · ");
    case "write_todos": {
      const t = extractTodos(input);
      return t ? `${t.length} item${t.length === 1 ? "" : "s"}` : "";
    }
    default:
      return summarizeToolInput(input);
  }
}

interface ChatProps {
  phase: Phase;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  pending?: boolean;
  activity?: PhaseActivity;
  // True only when *this* phase's turn is the one currently running.
  running?: boolean;
}

export function Chat({
  phase,
  messages,
  onSend,
  pending,
  activity,
  running,
}: ChatProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, activity, running]);

  function submit(): void {
    if (pending) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  const hasActivity =
    !!activity && (activity.items.length > 0 || activity.liveText.length > 0);

  return (
    <div className="chat">
      <div className="chat-header">
        chat <span className="phase">› {phase}</span>
      </div>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !hasActivity && (
          <div className="chat-empty">
            describe what you want — the agent updates the current artifact
          </div>
        )}
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {m.activity && m.activity.length > 0 && (
              <MessageActivity items={m.activity} />
            )}
            {m.role === "agent" ? (
              <AgentBubble text={m.text} />
            ) : (
              <div className="chat-msg user">{m.text}</div>
            )}
          </React.Fragment>
        ))}
        {(hasActivity || running) && (
          <ActivityPanel activity={activity ?? EMPTY_PHASE_ACTIVITY} running={!!running} />
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={pending ? "waiting for agent…" : "message the agent…"}
          rows={2}
          disabled={pending}
        />
        <button className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending ? "…" : "send ↵"}
        </button>
      </div>
    </div>
  );
}

function ActivityPanel({
  activity,
  running,
}: {
  activity: PhaseActivity;
  running: boolean;
}): JSX.Element {
  const empty = activity.items.length === 0 && !activity.liveText;
  return (
    <div className="chat-activity">
      <div className="chat-activity-head">
        ▸ agent activity{running && <span className="ca-running"> · running</span>}
      </div>
      {activity.items.map((item, i) => (
        <ActivityRow key={i} item={item} />
      ))}
      {activity.liveText && <AgentBubble text={activity.liveText} live />}
      {running && empty && <div className="ca-waiting">◌ thinking…</div>}
    </div>
  );
}

// Persisted trace under a finished agent reply — collapsed by default.
function MessageActivity({ items }: { items: ActivityItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const toolCount = items.filter((it) => it.kind === "tool").length;
  const summary =
    `${items.length} step${items.length === 1 ? "" : "s"}` +
    (toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : "");
  return (
    <div className={`chat-activity collapsed${open ? " open" : ""}`}>
      <button
        className="chat-activity-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} agent activity · {summary}
      </button>
      {open && items.map((item, i) => <ActivityRow key={i} item={item} />)}
    </div>
  );
}

// Agent replies are markdown; render them (hardened) rather than as plain text.
// Used for both finished replies and the forming live reply.
function AgentBubble({ text, live }: { text: string; live?: boolean }): JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className={`chat-msg agent${live ? " ca-live" : ""}`}>
      <span className="chat-msg-glyph">●</span>
      <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }): JSX.Element {
  const indent = item.depth > 0 ? { marginLeft: item.depth * 12 } : undefined;
  if (item.kind === "thinking" || item.kind === "subtext") {
    return (
      <div className={`ca-item ca-${item.kind}`} style={indent}>
        {item.text}
      </div>
    );
  }
  return <ToolRow item={item} indent={indent} />;
}

function ToolRow({
  item,
  indent,
}: {
  item: ToolItem;
  indent?: React.CSSProperties;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const todos = item.name === "write_todos" ? extractTodos(item.input) : null;
  const summary = toolSummary(item.name, item.input);
  // Collapsing reveals the exact input/output — useful as a copy-paste example.
  const hasDetail = item.input !== undefined || !!item.output;
  return (
    <div className="ca-item ca-tool" style={indent}>
      <button
        className="ca-tool-head"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetail}
      >
        <span className={`ca-tool-status ${item.done ? "done" : "running"}`} />
        {hasDetail && <span className="ca-tool-caret">{open ? "▾" : "▸"}</span>}
        <span className="ca-tool-name">{item.name}</span>
        {summary && <span className="ca-tool-input">{summary}</span>}
      </button>
      {todos && <TodoList todos={todos} />}
      {open && (
        <div className="ca-tool-detail">
          {item.input !== undefined && (
            <LabeledCode label="input" text={prettyJson(item.input)} />
          )}
          {item.output && <LabeledCode label="output" text={item.output} />}
        </div>
      )}
    </div>
  );
}

function TodoList({ todos }: { todos: TodoEntry[] }): JSX.Element {
  return (
    <ul className="ca-todos">
      {todos.map((t, i) => (
        <li
          key={i}
          className={`ca-todo status-${t.status.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          <span className="ca-todo-glyph">{todoGlyph(t.status)}</span>
          <span className="ca-todo-text">{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

function LabeledCode({ label, text }: { label: string; text: string }): JSX.Element {
  return (
    <div className="ca-code">
      <div className="ca-code-label">{label}</div>
      <pre className="ca-tool-output">{text}</pre>
    </div>
  );
}
