import React, { useState } from "react";
import type { ProjectInfo, SpecInfo } from "../shared/api";

interface Props {
  project: ProjectInfo | null;
  activeSpec: SpecInfo | null;
  onOpenProject: () => void;
  onSelectSpec: (spec: SpecInfo) => void;
  onCreateSpec: (name: string) => void;
}

export function ProjectBar({
  project,
  activeSpec,
  onOpenProject,
  onSelectSpec,
  onCreateSpec,
}: Props): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function submitNew(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateSpec(trimmed);
    setName("");
    setCreating(false);
  }

  return (
    <div className="projectbar">
      <span className="prompt-prefix">$</span>
      <button className="btn btn-sm" onClick={onOpenProject}>
        {project ? "change project" : "open project…"}
      </button>
      {project && (
        <div className="project-info">
          <span className="label">project</span>
          <span className="name">{project.name}</span>
          <span className="path">{project.path}</span>
        </div>
      )}
      {project && (
        <div className="right">
          <select
            value={activeSpec?.id ?? ""}
            onChange={(e) => {
              const s = project.specs.find((x) => x.id === e.target.value);
              if (s) onSelectSpec(s);
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
