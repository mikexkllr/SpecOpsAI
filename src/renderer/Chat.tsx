import React, { useState } from "react";
import type { Phase } from "./phases";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

interface ChatProps {
  phase: Phase;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  pending?: boolean;
}

export function Chat({ phase, messages, onSend, pending }: ChatProps): JSX.Element {
  const [draft, setDraft] = useState("");

  function submit(): void {
    if (pending) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid #2a2a2a" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #2a2a2a", fontSize: 12, opacity: 0.7 }}>
        Chat — {phase}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13 }}>
            Describe what you want. The agent will update the current artifact.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "#2b3a55" : "#23272e",
              color: "#e6e6e6",
              padding: "6px 10px",
              borderRadius: 8,
              maxWidth: "85%",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {m.text}
          </div>
        ))}
        {pending && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "#23272e",
              color: "#9aa",
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontStyle: "italic",
            }}
          >
            Thinking…
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #2a2a2a" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={pending ? "Waiting for agent…" : "Message the agent…"}
          rows={2}
          disabled={pending}
          style={{
            flex: 1,
            resize: "none",
            background: "#1a1a1a",
            color: "#ffffff",
            border: "1px solid #333",
            borderRadius: 6,
            padding: 6,
            fontFamily: "inherit",
            fontSize: 13,
            opacity: pending ? 0.6 : 1,
          }}
        />
        <button
          onClick={submit}
          disabled={pending}
          style={{
            background: pending ? "#1e3a5a" : "#2b6cb0",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "0 14px",
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
