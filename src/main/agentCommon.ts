import type * as DeepAgents from "deepagents";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentTurn } from "../shared/api";
import { loadDeps, createFsBackend } from "./deepagentsDeps";

export type BackendFactory = NonNullable<DeepAgents.CreateDeepAgentParams["backend"]>;

export type ChatMessage = { role: "user" | "assistant"; content: string };

// One backend construction shared by every agent in the app (phase chat,
// workers, reviewer, editor agent, test loop, codebase analysis).
//
// virtualMode: true sandboxes paths under rootDir. Without it, deepagents'
// built-in prompt tells the model to use absolute paths starting with `/`,
// which then escape rootDir entirely (path.resolve drops the prefix), so the
// model's write_file calls land in the real filesystem root and silently fail.
//
// CompositeBackend routes deepagents' internal eviction paths
// (/conversation_history, /large_tool_results) into an in-memory StateBackend
// so they never litter the project root.
export async function buildProjectBackend(rootDir: string): Promise<BackendFactory> {
  const { deepagents } = await loadDeps();
  const { CompositeBackend, StateBackend } = deepagents;
  const fsBackend = createFsBackend(deepagents, { rootDir, virtualMode: true });
  return (runtime) =>
    new CompositeBackend(fsBackend, {
      "/conversation_history": new StateBackend(runtime),
      "/large_tool_results": new StateBackend(runtime),
    });
}

export async function toLcMessages(messages: ChatMessage[]): Promise<BaseMessage[]> {
  const { messages: M } = await loadDeps();
  return messages.map((m) =>
    m.role === "user" ? new M.HumanMessage(m.content) : new M.AIMessage(m.content),
  );
}

// Convert a persisted AgentTurn history plus the new user message into
// LangChain messages — the shape every chat-style agent consumes.
export async function turnsToLcMessages(
  history: AgentTurn[],
  message: string,
): Promise<BaseMessage[]> {
  const msgs: ChatMessage[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
  msgs.push({ role: "user", content: message });
  return toLcMessages(msgs);
}
