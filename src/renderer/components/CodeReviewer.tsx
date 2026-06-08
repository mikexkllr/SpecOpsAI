import React, { useEffect, useRef, useState } from "react";
import type {
  AgentTurn,
  ArtifactFiles,
  CodeReviewReport,
  FileChangeStatus,
} from "../../shared/api";
import type { Artifacts } from "../phases";
import { renderMarkdown } from "../markdown";

interface CodeReviewerProps {
  specPath: string;
  artifacts: Artifacts;
  // Open a file in the (separate) code editor view.
  onOpenFile: (path: string) => void;
}

function toApiArtifacts(a: Artifacts): ArtifactFiles {
  return {
    spec: a.spec,
    userStories: a.userStories,
    technicalStories: a.technicalStories,
    code: a.code,
  };
}

const STATUS_GLYPH: Record<FileChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

export function CodeReviewer({ specPath, artifacts, onOpenFile }: CodeReviewerProps): JSX.Element {
  const [report, setReport] = useState<CodeReviewReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const [qaTurns, setQaTurns] = useState<AgentTurn[]>([]);
  const [qaDraft, setQaDraft] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const qaScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReport(null);
    setQaTurns([]);
    setExpandedFiles(new Set());
  }, [specPath]);

  useEffect(() => {
    qaScrollRef.current?.scrollTo({ top: qaScrollRef.current.scrollHeight });
  }, [qaTurns.length, qaBusy]);

  function toggleFile(path: string): void {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function generateReport(): Promise<void> {
    if (generating) return;
    setGenerating(true);
    try {
      const r = await window.specops.generateCodeReview({
        specPath,
        artifacts: toApiArtifacts(artifacts),
      });
      setReport(r);
      setExpandedFiles(new Set(r.files.map((f) => f.path)));
    } catch (err) {
      setReport({
        overview: "",
        files: [],
        markedImplemented: [],
        error: (err as Error).message,
      });
    } finally {
      setGenerating(false);
    }
  }

  async function askQuestion(): Promise<void> {
    if (qaBusy) return;
    const instruction = qaDraft.trim();
    if (!instruction) return;
    setQaDraft("");
    const history = qaTurns;
    setQaTurns((t) => [...t, { role: "user", text: instruction }]);
    setQaBusy(true);
    try {
      const res = await window.specops.reviewCode({
        specPath,
        instruction,
        history,
        artifacts: toApiArtifacts(artifacts),
        report: report ?? undefined,
      });
      setQaTurns((t) => [
        ...t,
        { role: "agent", text: res.error ? `Error: ${res.error}` : res.markdown },
      ]);
    } catch (err) {
      setQaTurns((t) => [...t, { role: "agent", text: `Error: ${(err as Error).message}` }]);
    } finally {
      setQaBusy(false);
    }
  }

  return (
    <div className="code-reviewer-view">
      {/* left: the GitHub / Devin-style self-review */}
      <div className="reviewer-main">
        <div className="reviewer-head">
          <div>
            <div className="reviewer-title">code review</div>
            <div className="reviewer-sub">
              the custom coding agent self-reviews the branch against the spec, user stories
              &amp; technical stories
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={generateReport}
            disabled={generating}
          >
            {generating ? "reviewing…" : report ? "re-review" : "generate review"}
          </button>
        </div>

        <div className="reviewer-report">
          {generating ? (
            <div className="code-review-thinking">
              reviewing the diff against the spec &amp; stories…
            </div>
          ) : !report ? (
            <div className="code-review-empty">
              Generate a review and the custom coding agent will inspect the branch&apos;s
              changes, describe what it changed in each file (GitHub / Devin style), and mark
              any fully-implemented technical-story tasks as done.
            </div>
          ) : report.error ? (
            <div className="notice danger">review failed: {report.error}</div>
          ) : (
            <>
              {report.markedImplemented.length > 0 && (
                <div className="marked-tasks">
                  <span className="marked-label">marked implemented</span>
                  {report.markedImplemented.map((m) => (
                    <span key={`${m.storyId}-${m.taskId}`} className="marked-chip" title={m.title}>
                      ✓ {m.taskId}
                    </span>
                  ))}
                </div>
              )}
              {report.overview && (
                <div
                  className="chat-md review-overview"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(report.overview) }}
                />
              )}
              {report.files.length === 0 ? (
                <div className="code-review-empty">
                  No file changes were found in the working tree.
                </div>
              ) : (
                <div className="review-files">
                  {report.files.map((f) => {
                    const isOpen = expandedFiles.has(f.path);
                    return (
                      <div key={f.path} className="review-file">
                        <div className="review-file-head">
                          <button
                            className="review-file-toggle"
                            onClick={() => toggleFile(f.path)}
                          >
                            <span className="rf-caret">{isOpen ? "▾" : "▸"}</span>
                            <span className={`change-badge ${f.status}`}>
                              {STATUS_GLYPH[f.status]}
                            </span>
                          </button>
                          <button
                            className="review-file-path"
                            onClick={() => onOpenFile(f.path)}
                            title="open in code editor"
                          >
                            {f.path}
                          </button>
                        </div>
                        {isOpen && (
                          <div
                            className="chat-md review-file-body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(f.summary) }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* right: Q&A — only for asking questions about the review */}
      <div className="reviewer-chat">
        <div className="reviewer-chat-head">questions about the review</div>
        <div ref={qaScrollRef} className="code-review-log">
          {qaTurns.length === 0 && !qaBusy ? (
            <div className="code-review-empty">
              {report
                ? "Ask anything about the review — why a change was made, whether an edge case is handled, how it maps to a story."
                : "Generate a review first, then ask questions about it here. (You can still ask about the current diff.)"}
            </div>
          ) : (
            qaTurns.map((m, i) =>
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
          {qaBusy && <div className="code-review-thinking">thinking…</div>}
        </div>
        <div className="code-review-input">
          <textarea
            value={qaDraft}
            onChange={(e) => setQaDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void askQuestion();
              }
            }}
            placeholder="ask about the review…"
            rows={2}
            disabled={qaBusy}
          />
          <button className="btn btn-primary btn-sm" onClick={askQuestion} disabled={qaBusy}>
            {qaBusy ? "…" : "ask ↵"}
          </button>
        </div>
      </div>
    </div>
  );
}
