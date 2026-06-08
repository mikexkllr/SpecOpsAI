import React, { useEffect, useRef, useState } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
// Order matters: tsx extends jsx + typescript, so its deps load first. markup,
// css, clike and javascript ship in prismjs core.
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import type { AgentTurn, ArtifactFiles, FileNode, MarkedTask } from "../../shared/api";
import type { Artifacts } from "../phases";
import { renderMarkdown } from "../markdown";

// A request from another view (e.g. the reviewer) to open a specific file. The
// `id` makes repeat requests for the same path re-trigger the open effect.
export interface OpenFileRequest {
  path: string;
  id: number;
}

interface CodeEditorProps {
  specPath: string;
  artifacts: Artifacts;
  openRequest?: OpenFileRequest | null;
}

function toApiArtifacts(a: Artifacts): ArtifactFiles {
  return {
    spec: a.spec,
    userStories: a.userStories,
    technicalStories: a.technicalStories,
    code: a.code,
  };
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(code: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = LANG_BY_EXT[ext];
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, lang);
  } catch {
    return escapeHtml(code);
  }
}

export function CodeEditor({ specPath, artifacts, openRequest }: CodeEditorProps): JSX.Element {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const [agentTurns, setAgentTurns] = useState<AgentTurn[]>([]);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [marked, setMarked] = useState<MarkedTask[]>([]);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  // Mirror of openPath/dirty for use inside async agent callbacks without stale
  // closures, so post-run reload reads the latest editor state.
  const openPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setOpenPath(null);
    setContent("");
    setSavedContent("");
    setAgentTurns([]);
    setMarked([]);
    window.specops.readProjectTree(specPath).then((t) => {
      if (!cancelled) setTree(t);
    });
    return () => {
      cancelled = true;
    };
  }, [specPath]);

  // Open a file requested by another view (the reviewer's "open in editor").
  useEffect(() => {
    if (openRequest) void openFile(openRequest.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.id]);

  const dirty = openPath !== null && !readOnly && content !== savedContent;

  useEffect(() => {
    openPathRef.current = openPath;
    dirtyRef.current = dirty;
  }, [openPath, dirty]);

  useEffect(() => {
    agentScrollRef.current?.scrollTo({ top: agentScrollRef.current.scrollHeight });
  }, [agentTurns.length, agentBusy]);

  async function openFile(path: string): Promise<void> {
    setLoadingFile(true);
    setOpenPath(path);
    try {
      const res = await window.specops.readProjectFile(specPath, path);
      setContent(res.content);
      setSavedContent(res.content);
      setReadOnly(res.binary || res.tooLarge);
    } catch (err) {
      setContent(`// Could not open file: ${(err as Error).message}`);
      setSavedContent("");
      setReadOnly(true);
    } finally {
      setLoadingFile(false);
    }
  }

  async function save(): Promise<void> {
    if (!openPath || !dirty || saving) return;
    setSaving(true);
    try {
      await window.specops.writeProjectFile(specPath, openPath, content);
      setSavedContent(content);
    } finally {
      setSaving(false);
    }
  }

  async function refreshTree(): Promise<void> {
    const t = await window.specops.readProjectTree(specPath);
    setTree(t);
  }

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function runAgent(): Promise<void> {
    if (agentBusy) return;
    const message = agentDraft.trim();
    if (!message) return;
    setAgentDraft("");
    const history = agentTurns;
    setAgentTurns((t) => [...t, { role: "user", text: message }]);
    setAgentBusy(true);
    try {
      const res = await window.specops.runEditorAgent({
        specPath,
        artifacts: toApiArtifacts(artifacts),
        history,
        message,
      });
      setAgentTurns((t) => [
        ...t,
        { role: "agent", text: res.error ? `Error: ${res.error}` : res.reply },
      ]);
      if (res.markedImplemented.length) {
        setMarked((prev) => {
          const seen = new Set(prev.map((m) => `${m.storyId}::${m.taskId}`));
          return [...prev, ...res.markedImplemented.filter((m) => !seen.has(`${m.storyId}::${m.taskId}`))];
        });
      }
      // The agent edits files on disk — refresh the tree, and reload the open
      // file so its edits show (unless the user has unsaved local changes).
      await refreshTree();
      const cur = openPathRef.current;
      if (cur && !dirtyRef.current) await openFile(cur);
    } catch (err) {
      setAgentTurns((t) => [...t, { role: "agent", text: `Error: ${(err as Error).message}` }]);
    } finally {
      setAgentBusy(false);
    }
  }

  return (
    <div className="code-editor-view">
      <div className="code-tree">
        <div className="code-tree-head">
          <span>explorer</span>
          <button className="btn-icon" title="refresh" onClick={refreshTree}>
            ⟳
          </button>
        </div>
        <div className="code-tree-body">
          {tree === null ? (
            <div className="code-tree-empty">loading…</div>
          ) : tree.length === 0 ? (
            <div className="code-tree-empty">no files</div>
          ) : (
            <Tree
              nodes={tree}
              depth={0}
              expanded={expanded}
              openPath={openPath}
              onToggle={toggleDir}
              onOpen={openFile}
            />
          )}
        </div>
      </div>

      <div className="code-editor-pane">
        <div className="code-editor-head">
          <div className="path">
            {openPath ?? "no file open"}
            {dirty && <span className="dirty-dot" title="unsaved changes" />}
            {readOnly && openPath && <span className="ro-badge">read-only</span>}
          </div>
          <div className="actions">
            {openPath && !readOnly && (
              <button
                className="btn btn-primary btn-sm"
                onClick={save}
                disabled={!dirty || saving}
                title="save to disk (⌘S)"
              >
                {saving ? "saving…" : "save"}
              </button>
            )}
          </div>
        </div>
        {openPath ? (
          <div className="code-editor-scroll">
            <Editor
              value={loadingFile ? "// loading…" : content}
              onValueChange={(v) => {
                if (!readOnly && !loadingFile) setContent(v);
              }}
              highlight={(code) => highlight(code, openPath)}
              readOnly={readOnly || loadingFile}
              padding={16}
              tabSize={2}
              textareaClassName="cm-textarea"
              preClassName="cm-pre"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void save();
                }
              }}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                lineHeight: 1.6,
                minHeight: "100%",
                color: "var(--fg-0)",
              }}
            />
          </div>
        ) : (
          <div className="code-editor-empty">
            select a file from the explorer to view and edit it
          </div>
        )}
      </div>

      {/* embedded coding agent — implements changes & marks tasks done */}
      <div className="code-agent">
        <div className="code-agent-head">
          <span>coding agent</span>
          <span className="code-agent-sub">edits files · marks tasks done</span>
        </div>
        {marked.length > 0 && (
          <div className="marked-tasks">
            <span className="marked-label">marked done</span>
            {marked.map((m) => (
              <span key={`${m.storyId}-${m.taskId}`} className="marked-chip" title={m.title}>
                ✓ {m.taskId}
              </span>
            ))}
          </div>
        )}
        <div ref={agentScrollRef} className="code-review-log">
          {agentTurns.length === 0 && !agentBusy ? (
            <div className="code-review-empty">
              Ask the agent to implement a technical-story task or user story — it edits the
              real files and marks tasks done. e.g. &ldquo;implement TS-2&rdquo;, &ldquo;wire
              the save button to the API&rdquo;, &ldquo;add validation to the login form&rdquo;.
            </div>
          ) : (
            agentTurns.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="code-review-user">
                  {m.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="chat-md code-review-agent"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                />
              ),
            )
          )}
          {agentBusy && <div className="code-review-thinking">working…</div>}
        </div>
        <div className="code-review-input">
          <textarea
            value={agentDraft}
            onChange={(e) => setAgentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void runAgent();
              }
            }}
            placeholder={agentBusy ? "working…" : "tell the agent what to implement…"}
            rows={2}
            disabled={agentBusy}
          />
          <button className="btn btn-primary btn-sm" onClick={runAgent} disabled={agentBusy}>
            {agentBusy ? "…" : "send ↵"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tree({
  nodes,
  depth,
  expanded,
  openPath,
  onToggle,
  onOpen,
}: {
  nodes: FileNode[];
  depth: number;
  expanded: Set<string>;
  openPath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        const pad = 8 + depth * 12;
        if (node.type === "dir") {
          return (
            <div key={node.path}>
              <button
                className="tree-row tree-dir"
                style={{ paddingLeft: pad }}
                onClick={() => onToggle(node.path)}
              >
                <span className="tree-caret">{isOpen ? "▾" : "▸"}</span>
                <span className="tree-name">{node.name}</span>
              </button>
              {isOpen && node.children && node.children.length > 0 && (
                <Tree
                  nodes={node.children}
                  depth={depth + 1}
                  expanded={expanded}
                  openPath={openPath}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={node.path}
            className={`tree-row tree-file${openPath === node.path ? " active" : ""}`}
            style={{ paddingLeft: pad + 12 }}
            onClick={() => onOpen(node.path)}
            title={node.path}
          >
            <span className="tree-name">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}
