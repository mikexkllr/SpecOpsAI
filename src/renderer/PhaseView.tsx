import React, { useState } from "react";
import type { Phase, Artifacts } from "./phases";
import { PHASE_LABEL } from "./phases";
import { MarkdownEditor } from "./MarkdownEditor";

interface PhaseViewProps {
  phase: Phase;
  artifacts: Artifacts;
  onChange: (patch: Partial<Artifacts>) => void;
}

type RefKey = Exclude<keyof Artifacts, "code">;

const REF_LABEL: Record<RefKey, string> = {
  spec: PHASE_LABEL.spec,
  userStories: PHASE_LABEL["user-story"],
  technicalStories: PHASE_LABEL["technical-story"],
};

function upstreamRefs(phase: Phase): RefKey[] {
  switch (phase) {
    case "spec":
      return [];
    case "user-story":
      return ["spec"];
    case "technical-story":
      return ["spec", "userStories"];
    case "implementation":
      return ["spec", "userStories", "technicalStories"];
  }
}

export function PhaseView({ phase, artifacts, onChange }: PhaseViewProps): JSX.Element {
  const refs = upstreamRefs(phase);

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {phase === "spec" && (
          <>
            <EditorHeader title="Specification" subtitle="Describe what to build. Code is hidden until the Implementation phase." />
            <MarkdownEditor
              value={artifacts.spec}
              onChange={(v) => onChange({ spec: v })}
              placeholder="# Spec&#10;&#10;Goals, constraints, non-goals…"
            />
          </>
        )}
        {phase === "user-story" && (
          <>
            <EditorHeader title="User Stories" subtitle="Derived from the Spec. Edit manually or via chat." />
            <MarkdownEditor
              value={artifacts.userStories}
              onChange={(v) => onChange({ userStories: v })}
              placeholder="- As a …, I want …, so that …"
            />
          </>
        )}
        {phase === "technical-story" && (
          <>
            <EditorHeader title="Technical Stories" subtitle="Derived from User Stories. Each becomes a sub-agent task." />
            <MarkdownEditor
              value={artifacts.technicalStories}
              onChange={(v) => onChange({ technicalStories: v })}
              placeholder="- [TS-1] Implement …"
            />
          </>
        )}
        {phase === "implementation" && (
          <ArtifactEditor
            title="Implementation"
            subtitle="Minimal code editor. Visible only in this phase."
            value={artifacts.code}
            onChange={(v) => onChange({ code: v })}
            placeholder="// code"
            monospace
          />
        )}
      </div>
      {refs.length > 0 && <ReferencesDrawer refs={refs} artifacts={artifacts} />}
    </div>
  );
}

function EditorHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2a2a" }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.65 }}>{subtitle}</div>
    </div>
  );
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
          color: "#ffffff",
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

function ReferencesDrawer({
  refs,
  artifacts,
}: {
  refs: RefKey[];
  artifacts: Artifacts;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<RefKey>(refs[0]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show upstream references (read-only)"
        style={{
          width: 28,
          background: "#101418",
          color: "#aaa",
          border: "none",
          borderLeft: "1px solid #2a2a2a",
          cursor: "pointer",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          fontSize: 11,
          letterSpacing: 1,
        }}
      >
        ‹ References
      </button>
    );
  }

  const value = artifacts[active] ?? "";

  return (
    <div
      style={{
        width: 320,
        borderLeft: "1px solid #2a2a2a",
        background: "#0f1115",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid #2a2a2a",
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.6, flex: 1 }}>References (read-only)</div>
        <button
          onClick={() => setOpen(false)}
          title="Hide references"
          style={{
            background: "transparent",
            color: "#888",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            padding: "0 4px",
          }}
        >
          ›
        </button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a" }}>
        {refs.map((k) => {
          const isActive = k === active;
          return (
            <button
              key={k}
              onClick={() => setActive(k)}
              style={{
                background: isActive ? "#1a1f26" : "transparent",
                color: isActive ? "#fff" : "#aaa",
                border: "none",
                borderBottom: isActive
                  ? "2px solid #2b6cb0"
                  : "2px solid transparent",
                padding: "6px 10px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {REF_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          color: "#cfd6dd",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        {value.trim() ? value : <span style={{ opacity: 0.5 }}>(empty)</span>}
      </div>
    </div>
  );
}
