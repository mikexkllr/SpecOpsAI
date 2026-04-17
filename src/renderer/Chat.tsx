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
    <div className="chat">
      <div className="chat-header">
        chat <span className="phase">› {phase}</span>
      </div>
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            describe what you want — the agent updates the current artifact
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {pending && <div className="chat-msg thinking">thinking…</div>}
      </div>
      <div className="chat-input-row">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={pending ? "waiting for agent…" : "message the agent…"}
          rows={2}
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "…" : "send ↵"}
        </button>
      </div>
    </div>
  );
}
