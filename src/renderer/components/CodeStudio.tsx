import React, { useEffect, useRef, useState } from "react";
import type { AgentTurn, ArtifactFiles, FileNode } from "../../shared/api";
import type { Artifacts } from "../phases";
import { renderMarkdown } from "../markdown";

interface CodeStudioProps {
  specPath: string;
  artifacts: Artifacts;
}

function toApiArtifacts(a: Artifacts): ArtifactFiles {
  return {
    spec: a.spec,
    userStories: a.userStories,
    technicalStories: a.technicalStories,
    code: a.code,
  };
}

export function CodeStudio({ specPath, artifacts }: CodeStudioProps): JSX.Element {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reviewTurns, setReviewTurns] = useState<AgentTurn[]>([]);
  const [reviewDraft, setReviewDraft] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const reviewScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setOpenPath(null);
    setContent("");
    setSavedContent("");
    window.specops.readProjectTree(specPath).then((t) => {
      if (!cancelled) setTree(t);
    });
    return () => {
      cancelled = true;
    };
  }, [specPath]);

  useEffect(() => {
    reviewScrollRef.current?.scrollTo({ top: reviewScrollRef.current.scrollHeight });
  }, [reviewTurns.length, reviewing]);

  const dirty = openPath !== null && !readOnly && content !== savedContent;

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

  async function runReview(): Promise<void> {
    if (reviewing) return;
    const instruction =
      reviewDraft.trim() ||
      (openPath ? `Review \`${openPath}\`.` : "Review my latest uncommitted changes.");
    setReviewDraft("");
    const history = reviewTurns;
    setReviewTurns((t) => [...t, { role: "user", text: instruction }]);
    setReviewing(true);
    try {
      const res = await window.specops.reviewCode({
        specPath,
        focusPath: openPath ?? undefined,
        instruction,
        history,
        artifacts: toApiArtifacts(artifacts),
      });
      setReviewTurns((t) => [
        ...t,
        { role: "agent", text: res.error ? `Review error: ${res.error}` : res.markdown },
      ]);
    } catch (err) {
      setReviewTurns((t) => [
        ...t,
        { role: "agent", text: `Review error: ${(err as Error).message}` },
      ]);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="code-studio">
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
            {openPath && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setReviewDraft(`Review \`${openPath}\` for bugs and quality.`);
                }}
                title="ask the reviewer about this file"
              >
                review →
              </button>
            )}
          </div>
        </div>
        {openPath ? (
          <textarea
            className="code-editor"
            value={loadingFile ? "// loading…" : content}
            readOnly={readOnly || loadingFile}
            spellCheck={false}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save();
              }
            }}
          />
        ) : (
          <div className="code-editor-empty">
            select a file from the explorer to view and edit it
          </div>
        )}
      </div>

      <div className="code-review-pane">
        <div className="code-review-head">interactive reviewer</div>
        <div ref={reviewScrollRef} className="code-review-log">
          {reviewTurns.length === 0 && !reviewing ? (
            <div className="code-review-empty">
              Ask for a review of the open file or your latest changes. The reviewer reads
              the working-tree diff and the real source before answering.
            </div>
          ) : (
            reviewTurns.map((m, i) =>
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
          {reviewing && <div className="code-review-thinking">reviewing…</div>}
        </div>
        <div className="code-review-input">
          <textarea
            value={reviewDraft}
            onChange={(e) => setReviewDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void runReview();
              }
            }}
            placeholder={
              openPath ? `review ${openPath}, or ask a question…` : "review my latest changes…"
            }
            rows={2}
            disabled={reviewing}
          />
          <button className="btn btn-primary btn-sm" onClick={runReview} disabled={reviewing}>
            {reviewing ? "…" : "review ↵"}
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
