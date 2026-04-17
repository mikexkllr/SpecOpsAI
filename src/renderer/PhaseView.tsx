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
    <div className="flex-row" style={{ height: "100%", minHeight: 0 }}>
      <div className="flex-col flex-1">
        {phase === "spec" && (
          <>
            <EditorHeader
              title="specification"
              subtitle="describe what to build · code is hidden until the implementation phase"
            />
            <MarkdownEditor
              value={artifacts.spec}
              onChange={(v) => onChange({ spec: v })}
              placeholder="# spec&#10;&#10;goals, constraints, non-goals…"
            />
          </>
        )}
        {phase === "user-story" && (
          <>
            <EditorHeader
              title="user stories"
              subtitle="derived from the spec · edit manually or via chat"
            />
            <MarkdownEditor
              value={artifacts.userStories}
              onChange={(v) => onChange({ userStories: v })}
              placeholder="- as a …, i want …, so that …"
            />
          </>
        )}
        {phase === "technical-story" && (
          <>
            <EditorHeader
              title="technical stories"
              subtitle="derived from user stories · each becomes a Worker task"
            />
            <MarkdownEditor
              value={artifacts.technicalStories}
              onChange={(v) => onChange({ technicalStories: v })}
              placeholder="- [TS-1] implement …"
            />
          </>
        )}
        {phase === "implementation" && (
          <ArtifactEditor
            title="implementation"
            subtitle="minimal code editor · visible only in this phase"
            value={artifacts.code}
            onChange={(v) => onChange({ code: v })}
            placeholder="// code"
          />
        )}
      </div>
      {refs.length > 0 && <ReferencesDrawer refs={refs} artifacts={artifacts} />}
    </div>
  );
}

function EditorHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="editor-header">
      <div className="title">{title}</div>
      <div className="subtitle">{subtitle}</div>
    </div>
  );
}

interface EditorProps {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function ArtifactEditor({
  title,
  subtitle,
  value,
  onChange,
  placeholder,
}: EditorProps): JSX.Element {
  return (
    <div className="flex-col" style={{ height: "100%", overflow: "hidden" }}>
      <EditorHeader title={title} subtitle={subtitle} />
      <textarea
        className="code-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
        className="refs-collapsed"
        onClick={() => setOpen(true)}
        title="show upstream references (read-only)"
      >
        ‹ references
      </button>
    );
  }

  const value = artifacts[active] ?? "";

  return (
    <div className="refs-drawer">
      <div className="refs-header">
        <div className="label">references · read-only</div>
        <button
          className="btn-icon"
          onClick={() => setOpen(false)}
          title="hide references"
        >
          ›
        </button>
      </div>
      <div className="refs-tabs">
        {refs.map((k) => {
          const isActive = k === active;
          return (
            <button
              key={k}
              onClick={() => setActive(k)}
              className={isActive ? "active" : ""}
            >
              {REF_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div className="refs-content">
        {value.trim() ? value : <span className="empty">(empty)</span>}
      </div>
    </div>
  );
}
