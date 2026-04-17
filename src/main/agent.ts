import * as path from "node:path";
import type * as DeepAgents from "deepagents";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

async function loadDeepagents(): Promise<typeof DeepAgents> {
  return await (Function('return import("deepagents")')() as Promise<typeof DeepAgents>);
}

type MessagesModule = typeof import("@langchain/core/messages");
async function loadMessages(): Promise<MessagesModule> {
  return await (Function('return import("@langchain/core/messages")')() as Promise<MessagesModule>);
}

type ToolsModule = typeof import("@langchain/core/tools");
async function loadTools(): Promise<ToolsModule> {
  return await (Function('return import("@langchain/core/tools")')() as Promise<ToolsModule>);
}
import type {
  AgentTurn,
  AgentTurnRequest,
  AgentTurnResult,
  ArtifactFiles,
  Phase,
} from "../shared/api";
import { getActiveProvider } from "./settings";
import { buildChatModel } from "./models";

interface PhaseConfig {
  artifact: keyof ArtifactFiles;
  label: string;
  guidance: string;
}

const PHASE_CONFIG: Record<Phase, PhaseConfig> = {
  spec: {
    artifact: "spec",
    label: "Specification",
    guidance: [
      "Produce a clear, structured software **Specification** in markdown.",
      "Cover: goals, user-visible behavior, constraints, non-goals.",
      "Do NOT include implementation details, user stories, or code.",
      "Refine the existing spec; never drop content the user already has unless they ask.",
    ].join(" "),
  },
  "user-story": {
    artifact: "userStories",
    label: "User Stories",
    guidance: [
      "Derive **User Stories** from the spec in the standard form:",
      "`- As a <role>, I want <capability>, so that <value>.`",
      "One story per bullet. Group related stories under `## Epic: ...` headings.",
    ].join(" "),
  },
  "technical-story": {
    artifact: "technicalStories",
    label: "Technical Stories",
    guidance: [
      "Derive **Technical Stories** from the user stories.",
      "Each story: an ID (`TS-1`, `TS-2`…), a one-line title, a short description, and acceptance criteria.",
      "These will each become a sub-agent task — keep them small and self-contained.",
    ].join(" "),
  },
  implementation: {
    artifact: "code",
    label: "Implementation",
    guidance: [
      "This phase implements the technical stories. Return code or scaffolding notes.",
      "Sketch the implementation plan; the sub-agents will do the detailed per-story work.",
    ].join(" "),
  },
};

function projectRoot(specPath: string): string {
  return path.resolve(specPath, "..", "..");
}

function buildSystemPrompt(phase: Phase, artifacts: ArtifactFiles): string {
  const cfg = PHASE_CONFIG[phase];
  const sections: string[] = [
    "You are the SpecOps AI agent, guiding a developer through Spec-Driven Development.",
    `Current phase: **${cfg.label}**.`,
    cfg.guidance,
    "",
    "## Tools available to you",
    "You have filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) rooted at the PROJECT ROOT. Use them to ground your answers in the real codebase — look at `src/`, `package.json`, existing specs under `specs/`, etc. — before proposing or revising the artifact.",
    `To persist the ${cfg.label} markdown, call the **\`update_artifact\`** tool with the FULL updated content (never a diff). Call it exactly once per turn when you intend to change the artifact. If the user's message is purely a question, SKIP the tool call and leave the artifact untouched.`,
    phase === "implementation"
      ? "You may also use `write_file` / `edit_file` to make direct source edits in this phase."
      : "Do not edit files outside the current artifact via `write_file`; use `update_artifact` for the artifact itself.",
    "After any tool calls, reply with 1–3 sentences describing what you changed or what you need from the user.",
    "",
    "## Context from earlier phases",
  ];
  if (artifacts.spec.trim()) sections.push("### Spec", artifacts.spec.trim());
  if (phase !== "spec" && artifacts.userStories.trim())
    sections.push("### User Stories", artifacts.userStories.trim());
  if (
    (phase === "technical-story" || phase === "implementation") &&
    artifacts.technicalStories.trim()
  )
    sections.push("### Technical Stories", artifacts.technicalStories.trim());

  const current = artifacts[cfg.artifact].trim();
  sections.push(
    "",
    `## Current ${cfg.label} (to refine)`,
    current || "(empty — create from scratch based on the user's message)",
  );
  return sections.join("\n");
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

async function toLcMessages(messages: ChatMessage[]): Promise<BaseMessage[]> {
  const { HumanMessage, AIMessage } = await loadMessages();
  return messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
}

function toMessages(history: AgentTurn[], userMessage: string): ChatMessage[] {
  const msgs: ChatMessage[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
  msgs.push({ role: "user", content: userMessage });
  return msgs;
}

function lastAssistantText(result: unknown): string {
  const r = result as { messages?: BaseMessage[] };
  const msgs = r?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const type = (m as { _getType?: () => string })._getType?.() ?? (m as { type?: string }).type;
    if (type === "ai" || type === "AIMessage") {
      const content = (m as BaseMessage).content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        return content
          .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
          .join("")
          .trim();
      }
    }
  }
  return "";
}

export async function runAgentTurn(req: AgentTurnRequest): Promise<AgentTurnResult> {
  const phaseCfg = PHASE_CONFIG[req.phase];
  const system = buildSystemPrompt(req.phase, req.artifacts);
  const messages = toMessages(req.history, req.message);

  try {
    const cfg = await getActiveProvider();
    const model = await buildChatModel(cfg);
    const { createDeepAgent, FilesystemBackend } = await loadDeepagents();
    const { tool } = await loadTools();
    const lcMessages = await toLcMessages(messages);

    let captured: string | null = null;
    const updateArtifact = tool(
      async (input: { content: string }) => {
        captured = input.content;
        return `Captured ${input.content.length} chars for ${phaseCfg.label}.`;
      },
      {
        name: "update_artifact",
        description: `Persist the full updated ${phaseCfg.label} markdown. Call this exactly once per turn when you intend to change the artifact. Omit the call if the user's message is purely a question.`,
        schema: z.object({ content: z.string() }),
      },
    );

    const agent = createDeepAgent({
      model,
      systemPrompt: system,
      backend: new FilesystemBackend({ rootDir: projectRoot(req.specPath) }),
      tools: [updateArtifact],
    });
    const result = await agent.invoke({ messages: lcMessages });
    const reply = lastAssistantText(result) || "(no reply)";
    return {
      reply,
      artifact:
        captured !== null
          ? { key: phaseCfg.artifact, content: captured }
          : undefined,
    };
  } catch (err) {
    return { reply: `Agent error: ${(err as Error).message}` };
  }
}
