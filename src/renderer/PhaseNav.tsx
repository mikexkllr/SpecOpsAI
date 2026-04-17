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
    <div className="phasenav">
      {PHASE_ORDER.map((p, i) => {
        const active = p === phase;
        const reachable = i <= currentIdx || isReachable(p, artifacts);
        return (
          <button
            key={p}
            disabled={!reachable}
            onClick={() => onSelect(p)}
            className={active ? "active" : ""}
            title={reachable ? "" : "complete previous phases to unlock"}
          >
            <span className="step-num">[{i + 1}]</span>
            {PHASE_LABEL[p]}
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
