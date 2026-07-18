import React, { useEffect, useRef, useState } from "react";
import type {
  ArtifactFiles,
  CodeWalkthrough,
  WalkthroughStep,
} from "../../shared/api";
import type { Artifacts } from "../phases";
import { renderMarkdown } from "../markdown";
import { highlight } from "./CodeEditor";

// Guided tour of freshly generated code: the agent picks an ordered set of
// file regions and explains each one; this panel plays them back with
// prev/next navigation and the code scrolled to the discussed lines.

interface WalkthroughPanelProps {
  specPath: string;
  artifacts: Artifacts;
  // Bumped when a background generation (after a story run) finishes, so the
  // panel re-reads the persisted walkthrough.
  refreshToken: number;
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

interface LoadedFile {
  lines: string[];
  note?: string; // set instead of lines when the file can't be shown
}

export function WalkthroughPanel({
  specPath,
  artifacts,
  refreshToken,
  onOpenFile,
}: WalkthroughPanelProps): JSX.Element {
  const [wt, setWt] = useState<CodeWalkthrough | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 0 = overview page, 1..n = wt.steps[i-1]
  const [pos, setPos] = useState(0);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const fileCache = useRef<Map<string, LoadedFile>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fileCache.current.clear();
    window.specops
      .readWalkthrough(specPath)
      .then((saved) => {
        if (cancelled) return;
        setWt((prev) => {
          // Only reset the cursor when the tour actually changed.
          if (saved?.generatedAt !== prev?.generatedAt) setPos(0);
          return saved;
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specPath, refreshToken]);

  const steps = wt?.steps ?? [];
  const step: WalkthroughStep | null = pos >= 1 ? steps[pos - 1] ?? null : null;

  // Load (and cache) the current step's file.
  useEffect(() => {
    if (!step) {
      setFile(null);
      return;
    }
    let cancelled = false;
    const cached = fileCache.current.get(step.file);
    if (cached) {
      setFile(cached);
      return;
    }
    setFile(null);
    window.specops
      .readProjectFile(specPath, step.file)
      .then((res) => {
        const loaded: LoadedFile =
          res.binary || res.tooLarge
            ? { lines: [], note: res.content }
            : { lines: res.content.split("\n") };
        fileCache.current.set(step.file, loaded);
        if (!cancelled) setFile(loaded);
      })
      .catch((err: Error) => {
        const loaded: LoadedFile = {
          lines: [],
          note: `could not open ${step.file}: ${err.message}`,
        };
        if (!cancelled) setFile(loaded);
      });
    return () => {
      cancelled = true;
    };
  }, [specPath, step?.file, wt?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the highlighted region into view once the file is rendered.
  useEffect(() => {
    if (!file || !step) return;
    const el = codeRef.current?.querySelector(".wt-line.hl");
    if (el) el.scrollIntoView({ block: "center" });
    else codeRef.current?.scrollTo({ top: 0 });
  }, [file, step]);

  async function generate(): Promise<void> {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await window.specops.generateWalkthrough({
        specPath,
        artifacts: toApiArtifacts(artifacts),
      });
      if (res.error) {
        setError(res.error);
      } else {
        fileCache.current.clear();
        setWt(res);
        setPos(0);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function move(delta: number): void {
    if (!wt) return;
    setPos((p) => Math.min(steps.length, Math.max(0, p + delta)));
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="msg">loading walkthrough…</div>
      </div>
    );
  }

  if (!wt) {
    return (
      <div className="empty-state">
        <div className="msg" style={{ maxWidth: 520 }}>
          <div style={{ marginBottom: 10 }}>
            no walkthrough yet. after the workers generate code, SpecOps can walk you
            through it step by step — file by file, with the reasoning behind each
            piece. run a story to get one automatically, or generate one now from the
            current branch changes.
          </div>
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? "generating walkthrough…" : "generate walkthrough"}
          </button>
          {error && <div className="notice danger" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="walkthrough-view" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="wt-sidebar">
        <div className="wt-sidebar-head">
          <span>steps</span>
          <button
            className="btn btn-sm"
            onClick={generate}
            disabled={generating}
            title="regenerate the walkthrough from the current branch changes"
          >
            {generating ? "generating…" : "regenerate"}
          </button>
        </div>
        <div className="wt-sidebar-list">
          <button
            className={`wt-step-row${pos === 0 ? " active" : ""}`}
            onClick={() => setPos(0)}
          >
            <span className="wt-step-num">◉</span>
            <span className="wt-step-title">overview</span>
          </button>
          {steps.map((s, i) => (
            <button
              key={i}
              className={`wt-step-row${pos === i + 1 ? " active" : ""}`}
              onClick={() => setPos(i + 1)}
              title={s.file}
            >
              <span className="wt-step-num">{i + 1}</span>
              <span className="wt-step-title">
                {s.title}
                <span className="wt-step-file">{s.file.split("/").pop()}</span>
              </span>
            </button>
          ))}
        </div>
        {error && <div className="notice danger" style={{ margin: 8 }}>{error}</div>}
      </div>

      <div className="wt-main">
        <div className="wt-head">
          <div className="wt-head-title">
            {pos === 0 ? wt.title || "code walkthrough" : step?.title}
            {step && (
              <span className="wt-head-file">
                <code className="inline">{step.file}</code>
                {step.startLine !== undefined && (
                  <span className="wt-head-lines">
                    :{step.startLine}
                    {step.endLine !== undefined && step.endLine !== step.startLine
                      ? `–${step.endLine}`
                      : ""}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="wt-head-actions">
            {step && (
              <button
                className="btn btn-sm"
                onClick={() => onOpenFile(step.file)}
                title="open this file in the code editor"
              >
                open in editor
              </button>
            )}
            <span className="wt-pos">
              {pos === 0 ? `${steps.length} steps` : `step ${pos} of ${steps.length}`}
            </span>
            <button className="btn btn-sm" onClick={() => move(-1)} disabled={pos === 0}>
              ← prev
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => move(1)}
              disabled={pos >= steps.length}
            >
              next →
            </button>
          </div>
        </div>

        {pos === 0 ? (
          <div className="wt-overview">
            <div
              className="chat-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(wt.intro || "(no intro)") }}
            />
            <div className="wt-overview-meta">
              generated {new Date(wt.generatedAt).toLocaleString()} · use{" "}
              <code className="inline">←</code> <code className="inline">→</code> to navigate
            </div>
            {steps.length > 0 && (
              <button className="btn btn-primary" onClick={() => setPos(1)}>
                start tour →
              </button>
            )}
          </div>
        ) : step ? (
          <>
            <div
              className="wt-explanation chat-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(step.explanation) }}
            />
            <div className="wt-code" ref={codeRef}>
              {file === null ? (
                <div className="wt-code-note">loading {step.file}…</div>
              ) : file.note ? (
                <div className="wt-code-note">{file.note}</div>
              ) : (
                <CodeLines lines={file.lines} step={step} />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CodeLines({ lines, step }: { lines: string[]; step: WalkthroughStep }): JSX.Element {
  const start = step.startLine ?? 0;
  const end = step.endLine ?? step.startLine ?? 0;
  return (
    <pre className="wt-code-pre">
      {lines.map((line, i) => {
        const n = i + 1;
        const hl = start > 0 && n >= start && n <= end;
        return (
          <div key={n} className={`wt-line${hl ? " hl" : ""}`}>
            <span className="wt-gutter">{n}</span>
            {/* Highlighted per line: cheap, and safe against unbalanced tags. */}
            <span
              className="wt-line-code"
              dangerouslySetInnerHTML={{ __html: highlight(line, step.file) || "​" }}
            />
          </div>
        );
      })}
    </pre>
  );
}
