import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import type {
  AgentTurn,
  AgentTurnRequest,
  AgentTurnResult,
  ArtifactFiles,
  Phase,
} from "../shared/api";
import { getActiveProvider } from "./settings";
import { buildChatModel } from "./models";
import { workerSubagents } from "./workerSubagents";
import { loadDeps } from "./deepagentsDeps";

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

function projectRoot(specPath: string): string {
  return path.resolve(specPath, "..", "..");
}

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
    const { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend } = deepagents;
    const lcMessages = await toLcMessages(messages);

    const fsBackend = new FilesystemBackend({
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
    const result = await agent.invoke({ messages: lcMessages });
    const reply = lastAssistantText(result) || "(no reply)";

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
