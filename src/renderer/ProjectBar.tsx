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
    <div
      style={{
        padding: "6px 16px",
        borderBottom: "1px solid #2a2a2a",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 13,
        background: "#121212",
      }}
    >
      <button
        onClick={onOpenProject}
        style={{
          background: "#1e1e1e",
          color: "#e6e6e6",
          border: "1px solid #333",
          padding: "4px 10px",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        {project ? "Change project" : "Open project…"}
      </button>
      {project && (
        <span style={{ opacity: 0.7 }}>
          <span style={{ opacity: 0.5 }}>Project:</span>{" "}
          <span style={{ fontWeight: 600 }}>{project.name}</span>
          <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 11 }}>
            {project.path}
          </span>
        </span>
      )}
      {project && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <select
            value={activeSpec?.id ?? ""}
            onChange={(e) => {
              const s = project.specs.find((x) => x.id === e.target.value);
              if (s) onSelectSpec(s);
            }}
            style={{
              background: "#1e1e1e",
              color: "#e6e6e6",
              border: "1px solid #333",
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            <option value="" disabled>
              {project.specs.length === 0 ? "No specs yet" : "Select a spec"}
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
                placeholder="Spec name"
                style={{
                  background: "#1e1e1e",
                  color: "#e6e6e6",
                  border: "1px solid #333",
                  padding: "4px 8px",
                  borderRadius: 4,
                  width: 160,
                }}
              />
              <button
                onClick={submitNew}
                style={{
                  background: "#2a5cff",
                  color: "#fff",
                  border: "none",
                  padding: "4px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Create
              </button>
            </>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{
                background: "#1e1e1e",
                color: "#e6e6e6",
                border: "1px solid #333",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              + New spec
            </button>
          )}
        </div>
      )}
    </div>
  );
}
