import React, { useState } from "react";
import { Chat, type ChatMessage } from "./Chat";
import { PhaseNav } from "./PhaseNav";
import { PhaseView } from "./PhaseView";
import { EMPTY_ARTIFACTS, type Artifacts, type Phase } from "./phases";

export function App(): JSX.Element {
  const [phase, setPhase] = useState<Phase>("spec");
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY_ARTIFACTS);
  const [messagesByPhase, setMessagesByPhase] = useState<Record<Phase, ChatMessage[]>>({
    spec: [],
    "user-story": [],
    "technical-story": [],
    implementation: [],
  });

  function updateArtifacts(patch: Partial<Artifacts>): void {
    setArtifacts((a) => ({ ...a, ...patch }));
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
        <div style={{ fontSize: 12, opacity: 0.6 }}>Spec-Driven Development IDE</div>
      </header>
      <PhaseNav phase={phase} artifacts={artifacts} onSelect={setPhase} />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 360px", minHeight: 0 }}>
        <PhaseView phase={phase} artifacts={artifacts} onChange={updateArtifacts} />
        <Chat phase={phase} messages={messagesByPhase[phase]} onSend={sendMessage} />
      </div>
    </div>
  );
}
