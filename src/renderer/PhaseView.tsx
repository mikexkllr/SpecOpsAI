import React from "react";
import type { Phase, Artifacts } from "./phases";

interface PhaseViewProps {
  phase: Phase;
  artifacts: Artifacts;
  onChange: (patch: Partial<Artifacts>) => void;
}

export function PhaseView({ phase, artifacts, onChange }: PhaseViewProps): JSX.Element {
  switch (phase) {
    case "spec":
      return (
        <ArtifactEditor
          title="Specification"
          subtitle="Describe what to build. Code is hidden until the Implementation phase."
          value={artifacts.spec}
          onChange={(v) => onChange({ spec: v })}
          placeholder="# Spec&#10;&#10;Goals, constraints, non-goals…"
        />
      );
    case "user-story":
      return (
        <ArtifactEditor
          title="User Stories"
          subtitle="Derived from the Spec. Edit manually or via chat."
          value={artifacts.userStories}
          onChange={(v) => onChange({ userStories: v })}
          placeholder="- As a …, I want …, so that …"
        />
      );
    case "technical-story":
      return (
        <ArtifactEditor
          title="Technical Stories"
          subtitle="Derived from User Stories. Each becomes a sub-agent task."
          value={artifacts.technicalStories}
          onChange={(v) => onChange({ technicalStories: v })}
          placeholder="- [TS-1] Implement …"
        />
      );
    case "implementation":
      return (
        <ArtifactEditor
          title="Implementation"
          subtitle="Minimal code editor. Visible only in this phase."
          value={artifacts.code}
          onChange={(v) => onChange({ code: v })}
          placeholder="// code"
          monospace
        />
      );
  }
}

interface EditorProps {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
}

function ArtifactEditor({ title, subtitle, value, onChange, placeholder, monospace }: EditorProps): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2a2a" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>{subtitle}</div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "#141414",
          color: "#e6e6e6",
          border: "none",
          outline: "none",
          padding: 16,
          resize: "none",
          fontFamily: monospace ? "ui-monospace, Menlo, monospace" : "inherit",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      />
    </div>
  );
}
