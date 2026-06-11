import React, { useEffect, useState } from "react";
import type { ProjectContextInfo, ProjectInfo, SpecInfo } from "../shared/api";

interface Props {
  project: ProjectInfo | null;
  activeSpec: SpecInfo | null;
  // Project context + analysis state live in App, shared with the /codebase
  // chat command so both surfaces stay in sync.
  context: ProjectContextInfo | null;
  analyzingCodebase: boolean;
  onAnalyzeCodebase: () => Promise<{ ok: boolean; message: string }>;
  onOpenProject: () => void;
  onCloseProject: () => void;
  onSelectSpec: (spec: SpecInfo) => void;
  onCreateSpec: (name: string) => void;
}

export function ProjectBar({
  project,
  activeSpec,
  context,
  analyzingCodebase,
  onAnalyzeCodebase,
  onOpenProject,
  onCloseProject,
  onSelectSpec,
  onCreateSpec,
}: Props): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  // Transient git/context status shown at the right edge of the bar.
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setNotice(null);
  }, [project]);

  function submitNew(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateSpec(trimmed);
    setName("");
    setCreating(false);
  }

  // Selecting a spec also checks out its branch (skipped with a warning when
  // the tree is dirty), so artifacts and code always match what's on disk.
  async function selectSpec(spec: SpecInfo): Promise<void> {
    const result = await window.specops.checkoutSpecBranch(spec.path);
    setNotice(result.warning ?? null);
    onSelectSpec(spec);
  }

  async function sync(): Promise<void> {
    if (!project || syncing) return;
    setSyncing(true);
    setNotice(null);
    try {
      const result = await window.specops.gitSync(project.path);
      setNotice(result.message);
    } finally {
      setSyncing(false);
    }
  }

  async function analyze(): Promise<void> {
    if (!project || analyzingCodebase) return;
    setNotice("analyzing codebase — this can take a few minutes…");
    const result = await onAnalyzeCodebase();
    setNotice(result.message);
  }

  const analyzedLabel = context?.codebaseAnalyzedAt
    ? `re-analyze codebase (last: ${new Date(context.codebaseAnalyzedAt).toLocaleDateString()})`
    : "analyze the codebase so agents understand this project (recommended for existing projects)";

  return (
    <div className="projectbar">
      <span className="prompt-prefix">$</span>
      <button className="btn btn-sm" onClick={onOpenProject}>
        {project ? "change project" : "open project…"}
      </button>
      {project && (
        <button className="btn btn-sm btn-ghost" onClick={onCloseProject}>
          close project
        </button>
      )}
      {project && (
        <div className="project-info">
          <span className="label">project</span>
          <span className="name">{project.name}</span>
          <span className="path">{project.path}</span>
        </div>
      )}
      {project && (
        <div className="right">
          {notice && <span className="bar-notice">{notice}</span>}
          <button
            className="btn btn-sm btn-ghost"
            onClick={analyze}
            disabled={analyzingCodebase}
            title={analyzedLabel}
          >
            {analyzingCodebase
              ? "◌ analyzing…"
              : context?.codebase
                ? "◉ codebase"
                : "○ analyze codebase"}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={sync}
            disabled={syncing}
            title="fetch + pull --rebase + push the current branch"
          >
            {syncing ? "⇅ syncing…" : "⇅ sync"}
          </button>
          <select
            value={activeSpec?.id ?? ""}
            onChange={(e) => {
              const s = project.specs.find((x) => x.id === e.target.value);
              if (s) void selectSpec(s);
            }}
          >
            <option value="" disabled>
              {project.specs.length === 0 ? "no specs yet" : "select a spec"}
            </option>
            {project.specs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.branch}
              </option>
            ))}
          </select>
          {creating ? (
            <>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setName("");
                  }
                }}
                placeholder="spec name"
                style={{ width: 180 }}
              />
              <button className="btn btn-primary btn-sm" onClick={submitNew}>
                create
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setCreating(true)}>
              + new spec
            </button>
          )}
        </div>
      )}
    </div>
  );
}
