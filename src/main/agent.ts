import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import type {
  AgentStreamEvent,
  AgentTurn,
  AgentTurnRequest,
  AgentTurnResult,
  ArtifactFiles,
  Phase,
} from "../shared/api";
import { getActiveProvider } from "./settings";
import { buildChatModel } from "./models";
import { workerSubagents } from "./workerSubagents";
import { loadDeps, createFsBackend } from "./deepagentsDeps";
import { projectRoot, lastAssistantText } from "./utils";

// --- live event stream ----------------------------------------------------
// Mirrors cliAgent's onCliChunk pattern: main.ts subscribes once and rebroadcasts
// over the `agent:event` IPC channel to every renderer window.
type AgentEventListener = (event: AgentStreamEvent) => void;
const agentEventListeners: AgentEventListener[] = [];

export function onAgentEvent(cb: AgentEventListener): () => void {
  agentEventListeners.push(cb);
  return () => {
    const i = agentEventListeners.indexOf(cb);
    if (i >= 0) agentEventListeners.splice(i, 1);
  };
}

function emitAgentEvent(event: AgentStreamEvent): void {
  for (const cb of agentEventListeners) cb(event);
}

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
      "These will each become a Worker task — keep them small and self-contained.",
    ].join(" "),
  },
  implementation: {
    artifact: "code",
    label: "Implementation",
    guidance: [
      "This phase implements the technical stories. Return code or scaffolding notes.",
      "Sketch the implementation plan; the Workers will do the detailed per-story work.",
    ].join(" "),
  },
};

const ARTIFACT_FILENAMES: Record<keyof ArtifactFiles, string> = {
  spec: "spec.md",
  userStories: "user-stories.md",
  technicalStories: "technical-stories.md",
  code: "code.md",
};

function buildSystemPrompt(
  phase: Phase,
  artifacts: ArtifactFiles,
  specPath: string,
): string {
  const cfg = PHASE_CONFIG[phase];
  const root = projectRoot(specPath);
  const specRel = path.relative(root, specPath).replace(/\\/g, "/") || ".";
  const artifactVirtual = `/${specRel}/${ARTIFACT_FILENAMES[cfg.artifact]}`;
  const sections: string[] = [
    "You are the SpecOps AI agent, guiding a developer through Spec-Driven Development.",
    `Current phase: **${cfg.label}**.`,
    cfg.guidance,
    "",
    "## Paths you care about",
    `- Your filesystem tools are rooted at the **project root**: \`${root}\`.`,
    `- This conversation's spec folder: \`/${specRel}/\` — contains \`spec.md\`, \`user-stories.md\`, \`technical-stories.md\`, \`code.md\`.`,
    `- The artifact you are editing in this phase: \`${artifactVirtual}\`.`,
    "- Source code lives under `/src/`. Dependencies in `/package.json`. Other specs live alongside under `/specs/`.",
    "",
    "## How to work",
    "You have filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) rooted at the project root. Use them to ground your answers — actually read the relevant files, actually grep for real symbols. All paths are virtual absolute paths starting with `/`.",
    `To persist the ${cfg.label}, call \`write_file\` on \`${artifactVirtual}\` with the FULL updated markdown (never a diff). Only write when the user's message implies a change. For pure questions, don't touch the file — just answer.`,
    phase === "implementation"
      ? "You may also edit other source files with `write_file` / `edit_file` in this phase."
      : "",
    "Finish with a 1–3 sentence reply describing what you changed or what you need from the user. Never answer meta questions about your tools by listing them — just demonstrate by using them.",
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
  const { messages: M } = await loadDeps();
  return messages.map((m) =>
    m.role === "user" ? new M.HumanMessage(m.content) : new M.AIMessage(m.content),
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

async function syncArtifactToDisk(
  specPath: string,
  key: keyof ArtifactFiles,
  content: string,
): Promise<void> {
  // Write the UI's current artifact content to disk before the agent runs, so
  // any post-turn difference is attributable to the agent (not pre-existing
  // drift between UI state and disk).
  const abs = path.join(specPath, ARTIFACT_FILENAMES[key]);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function readArtifactFromDisk(
  specPath: string,
  key: keyof ArtifactFiles,
): Promise<string | null> {
  try {
    return await fs.readFile(path.join(specPath, ARTIFACT_FILENAMES[key]), "utf8");
  } catch {
    return null;
  }
}

const MAX_TOOL_OUTPUT = 4000;

// Pull human-readable text and reasoning out of a (possibly chunked) message.
// Content shape varies by provider: a plain string, or an array of typed blocks
// (`text` / `thinking` / `reasoning`), and some providers stash reasoning in
// additional_kwargs instead. We extract both defensively and let empty strings
// be skipped by the caller.
function extractMessageDeltas(msg: BaseMessage): { text: string; thinking: string } {
  let text = "";
  let thinking = "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    text += content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "string") {
        text += block;
        continue;
      }
      const b = block as Record<string, unknown>;
      const type = b.type;
      if (type === "text" || type === "text_delta") {
        text += (b.text as string) ?? "";
      } else if (type === "thinking" || type === "reasoning" || type === "reasoning_content") {
        thinking +=
          (b.thinking as string) ?? (b.reasoning as string) ?? (b.text as string) ?? "";
      }
    }
  }
  const ak = (msg as { additional_kwargs?: Record<string, unknown> }).additional_kwargs;
  const reasoning = ak?.reasoning_content;
  if (typeof reasoning === "string") thinking += reasoning;
  return { text, thinking };
}

function stringifyToolOutput(output: unknown): string {
  let text: string;
  if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    text =
      typeof content === "string"
        ? content
        : (() => {
            try {
              return JSON.stringify(content ?? output);
            } catch {
              return String(output);
            }
          })();
  } else {
    text = String(output ?? "");
  }
  return text.length > MAX_TOOL_OUTPUT
    ? text.slice(0, MAX_TOOL_OUTPUT) + `\n… (+${text.length - MAX_TOOL_OUTPUT} chars)`
    : text;
}

// Runs the agent with live streaming, emitting thinking / text / tool events as
// they arrive, and returns the top-level messages so the caller can derive the
// final reply. `subgraphs: true` surfaces nested subagent activity too; we tag
// every event with the subgraph depth. When turnId is undefined we still stream
// (to collect the reply) but suppress events.
async function streamAgentTurn(
  agent: { stream: (input: unknown, options: unknown) => Promise<AsyncIterable<unknown>> },
  lcMessages: BaseMessage[],
  turnId: string | undefined,
): Promise<{ messages?: BaseMessage[] }> {
  // The last top-level "values" emission is the complete final state — the same
  // object agent.invoke() would have resolved to — so we derive the reply from it.
  let finalState: { messages?: BaseMessage[] } = {};
  const stream = await agent.stream(
    { messages: lcMessages },
    { streamMode: ["messages", "tools", "values"], subgraphs: true },
  );

  for await (const event of stream) {
    // With subgraphs:true + array streamMode each item is [namespace, mode, data].
    const tuple = event as unknown[];
    const [ns, mode, data] =
      tuple.length >= 3
        ? (tuple as [string[], string, unknown])
        : ([[], tuple[0], tuple[1]] as [string[], string, unknown]);
    const depth = Array.isArray(ns) ? ns.length : 0;

    if (mode === "messages") {
      const [msg] = data as [BaseMessage, Record<string, unknown>];
      const type = (msg as { _getType?: () => string })._getType?.();
      if (type !== "ai") continue;
      if (!turnId) continue;
      const { text, thinking } = extractMessageDeltas(msg);
      if (thinking) emitAgentEvent({ turnId, depth, kind: "thinking", text: thinking });
      if (text) emitAgentEvent({ turnId, depth, kind: "text", text });
    } else if (mode === "tools") {
      if (!turnId) continue;
      const ev = data as {
        event: string;
        name: string;
        toolCallId?: string;
        input?: unknown;
        output?: unknown;
      };
      if (ev.event === "on_tool_start") {
        emitAgentEvent({
          turnId,
          depth,
          kind: "tool-start",
          name: ev.name,
          input: ev.input,
          toolCallId: ev.toolCallId,
        });
      } else if (ev.event === "on_tool_end") {
        emitAgentEvent({
          turnId,
          depth,
          kind: "tool-end",
          name: ev.name,
          output: stringifyToolOutput(ev.output),
          toolCallId: ev.toolCallId,
        });
      }
    } else if (mode === "values" && depth === 0) {
      // Full state snapshot from the top-level graph; last one wins.
      finalState = (data as { messages?: BaseMessage[] }) ?? finalState;
    }
  }

  return finalState;
}

export async function runAgentTurn(req: AgentTurnRequest): Promise<AgentTurnResult> {
  const phaseCfg = PHASE_CONFIG[req.phase];
  const system = buildSystemPrompt(req.phase, req.artifacts, req.specPath);
  const messages = toMessages(req.history, req.message);

  try {
    const baseline = req.artifacts[phaseCfg.artifact];
    await syncArtifactToDisk(req.specPath, phaseCfg.artifact, baseline);

    const cfg = await getActiveProvider();
    const model = await buildChatModel(cfg);
    const { deepagents } = await loadDeps();
    const { createDeepAgent, CompositeBackend, StateBackend } = deepagents;
    const lcMessages = await toLcMessages(messages);

    const fsBackend = createFsBackend(deepagents, {
      rootDir: projectRoot(req.specPath),
      virtualMode: true,
    });
    const agent = createDeepAgent({
      model,
      systemPrompt: system,
      backend: (runtime) =>
        new CompositeBackend(fsBackend, {
          "/conversation_history": new StateBackend(runtime),
          "/large_tool_results": new StateBackend(runtime),
        }),
      subagents: workerSubagents,
    });
    const finalState = await streamAgentTurn(
      agent as unknown as {
        stream: (input: unknown, options: unknown) => Promise<AsyncIterable<unknown>>;
      },
      lcMessages,
      req.turnId,
    );
    const reply = lastAssistantText(finalState) || "(no reply)";

    const after = await readArtifactFromDisk(req.specPath, phaseCfg.artifact);
    const changed = after !== null && after !== baseline;
    return {
      reply,
      artifact: changed
        ? { key: phaseCfg.artifact, content: after }
        : undefined,
    };
  } catch (err) {
    return { reply: `Agent error: ${(err as Error).message}` };
  }
}
