import React from "react";
import { PHASE_LABEL, PHASE_ORDER, type Phase, type Artifacts, canAdvance } from "./phases";

interface PhaseNavProps {
  phase: Phase;
  artifacts: Artifacts;
  onSelect: (p: Phase) => void;
}

export function PhaseNav({ phase, artifacts, onSelect }: PhaseNavProps): JSX.Element {
  const currentIdx = PHASE_ORDER.indexOf(phase);

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 8,
        borderBottom: "1px solid #2a2a2a",
        background: "#101010",
      }}
    >
      {PHASE_ORDER.map((p, i) => {
        const active = p === phase;
        const reachable = i <= currentIdx || isReachable(p, artifacts);
        return (
          <button
            key={p}
            disabled={!reachable}
            onClick={() => onSelect(p)}
            style={{
              background: active ? "#2b6cb0" : reachable ? "#1f1f1f" : "#181818",
              color: active ? "white" : reachable ? "#ddd" : "#555",
              border: "1px solid " + (active ? "#2b6cb0" : "#2a2a2a"),
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 13,
              cursor: reachable ? "pointer" : "not-allowed",
            }}
            title={reachable ? "" : "Complete previous phases to unlock"}
          >
            {i + 1}. {PHASE_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

function isReachable(target: Phase, artifacts: Artifacts): boolean {
  const idx = PHASE_ORDER.indexOf(target);
  for (let i = 0; i < idx; i++) {
    if (!canAdvance(PHASE_ORDER[i], artifacts)) return false;
  }
  return true;
}
