import React from "react";
import type { TechnicalStory, WorkerStore } from "../../shared/api";

function progressLabel(state: NonNullable<WorkerStore[string]>): string {
  if (state.status === "decomposing") return "decomposing…";
  if (state.status === "running") return "Worker thinking…";
  if (state.tasks.length === 0) return "no tasks yet";
  const done = state.tasks.filter((t) => t.status === "done").length;
  return `${done}/${state.tasks.length} done`;
}

interface StoryListProps {
  stories: TechnicalStory[];
  store: WorkerStore;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function StoryList({ stories, store, selectedId, onSelect }: StoryListProps): JSX.Element {
  return (
    <div className="story-list">
      {stories.map((s) => {
        const state = store[s.id];
        const progress = state ? progressLabel(state) : "not started";
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={active ? "active" : ""}
          >
            <div className="story-id">{s.id}</div>
            <div className="story-title">{s.title || "(untitled)"}</div>
            <div className="story-meta">{progress}</div>
          </button>
        );
      })}
    </div>
  );
}
