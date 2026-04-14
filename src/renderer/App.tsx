import React, { useEffect, useRef, useState } from "react";
import type { ArtifactFiles, ProjectInfo, SpecInfo } from "../shared/api";
import { Chat, type ChatMessage } from "./Chat";
import { PhaseNav } from "./PhaseNav";
import { PhaseView } from "./PhaseView";
import { ProjectBar } from "./ProjectBar";
import { EMPTY_ARTIFACTS, type Artifacts, type Phase } from "./phases";

const ARTIFACT_KEYS: Record<keyof Artifacts, keyof ArtifactFiles> = {
  spec: "spec",
  userStories: "userStories",
  technicalStories: "technicalStories",
  code: "code",
};

export function App(): JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeSpec, setActiveSpec] = useState<SpecInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("spec");
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY_ARTIFACTS);
  const [messagesByPhase, setMessagesByPhase] = useState<Record<Phase, ChatMessage[]>>({
    spec: [],
    "user-story": [],
    "technical-story": [],
    implementation: [],
  });
  const saveTimers = useRef<Partial<Record<keyof Artifacts, number>>>({});

  useEffect(() => {
    if (!activeSpec) {
      setArtifacts(EMPTY_ARTIFACTS);
      return;
    }
    let cancelled = false;
    window.specops.readArtifacts(activeSpec.path).then((files) => {
      if (cancelled) return;
      setArtifacts({
        spec: files.spec,
        userStories: files.userStories,
        technicalStories: files.technicalStories,
        code: files.code,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeSpec]);

  async function handleOpenProject(): Promise<void> {
    const p = await window.specops.openProject();
    if (!p) return;
    setProject(p);
    const first = p.specs[0] ?? null;
    setActiveSpec(first);
    setPhase("spec");
  }

  async function handleCreateSpec(name: string): Promise<void> {
    if (!project) return;
    const spec = await window.specops.createSpec(project.path, name);
    const specs = await window.specops.listSpecs(project.path);
    setProject({ ...project, specs });
    setActiveSpec(spec);
    setPhase("spec");
  }

  function updateArtifacts(patch: Partial<Artifacts>): void {
    setArtifacts((a) => ({ ...a, ...patch }));
    if (!activeSpec) return;
    const specPath = activeSpec.path;
    for (const key of Object.keys(patch) as (keyof Artifacts)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      const existing = saveTimers.current[key];
      if (existing) window.clearTimeout(existing);
      saveTimers.current[key] = window.setTimeout(() => {
        window.specops.writeArtifact(specPath, ARTIFACT_KEYS[key], value);
      }, 300);
    }
  }

  function sendMessage(text: string): void {
    setMessagesByPhase((prev) => ({
      ...prev,
      [phase]: [
        ...prev[phase],
        { role: "user", text },
        { role: "agent", text: "(agent backend not yet wired — Open SWE integration pending)" },
      ],
    }));
  }

  const ready = !!activeSpec;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0d0d",
        color: "#e6e6e6",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid #2a2a2a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 600 }}>SpecOps AI</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {activeSpec ? `${activeSpec.name} · ${activeSpec.branch}` : "Spec-Driven Development IDE"}
        </div>
      </header>
      <ProjectBar
        project={project}
        activeSpec={activeSpec}
        onOpenProject={handleOpenProject}
        onSelectSpec={(s) => {
          setActiveSpec(s);
          setPhase("spec");
        }}
        onCreateSpec={handleCreateSpec}
      />
      {ready ? (
        <>
          <PhaseNav phase={phase} artifacts={artifacts} onSelect={setPhase} />
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 360px", minHeight: 0 }}>
            <PhaseView phase={phase} artifacts={artifacts} onChange={updateArtifacts} />
            <Chat phase={phase} messages={messagesByPhase[phase]} onSend={sendMessage} />
          </div>
        </>
      ) : (
        <EmptyState hasProject={!!project} onOpen={handleOpenProject} />
      )}
    </div>
  );
}

function EmptyState({
  hasProject,
  onOpen,
}: {
  hasProject: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        opacity: 0.8,
      }}
    >
      <div style={{ fontSize: 15 }}>
        {hasProject
          ? "Create a new spec to start the phase-based workflow."
          : "Open a project folder to begin."}
      </div>
      {!hasProject && (
        <button
          onClick={onOpen}
          style={{
            background: "#2a5cff",
            color: "#fff",
            border: "none",
            padding: "8px 16px",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Open project…
        </button>
      )}
    </div>
  );
}
