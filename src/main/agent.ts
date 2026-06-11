import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import {
  ARTIFACT_FILENAMES,
  type AgentAction,
  type AgentStreamEvent,
  type AgentTurnRequest,
  type AgentTurnResult,
  type ArtifactFiles,
  type Phase,
} from "../shared/api";
import { getActiveProvider, loadSettings } from "./settings";
import { buildChatModel } from "./models";
import { workerSubagents } from "./workerSubagents";
import { loadDeps } from "./deepagentsDeps";
import { buildProjectBackend, turnsToLcMessages } from "./agentCommon";
import { projectContextSections } from "./projectContext";
import { commitPaths } from "./git";
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

// Spec Kit-style phase playbooks. Each phase gets a concrete artifact template,
// explicit quality rules, and a brownfield rule: ground claims in the real
// codebase instead of inventing structure.
const PHASE_CONFIG: Record<Phase, PhaseConfig> = {
  spec: {
    artifact: "spec",
    label: "Specification",
    guidance: [
      "Produce a clear, testable software **Specification** in markdown. Structure it with these sections (omit a section only when it is genuinely empty):",
      "`## Summary` — 2-4 sentences on what is being built and for whom.",
      "`## Context` — for changes to an existing system: the CURRENT behavior and the areas of the codebase affected (read the real code first and cite paths). Skip for greenfield work.",
      "`## Goals` / `## Non-goals` — what success means, and what is explicitly out of scope.",
      "`## Functional requirements` — numbered `FR-1`, `FR-2`, … Each requirement is user-visible, unambiguous, and verifiable. No implementation details.",
      "`## Constraints` — performance, compatibility, security, platform limits.",
      "`## Edge cases` — error states, empty states, concurrency/limits the behavior must handle.",
      "`## Open questions` — anything unresolved, as `[NEEDS CLARIFICATION: question]` items.",
      "",
      "Rules:",
      "- NEVER guess at an ambiguous requirement: mark it `[NEEDS CLARIFICATION: …]` (keep at most 5 — the most impactful) and ask the user in your reply.",
      "- No implementation details, no user stories, no code — those belong to later phases.",
      "- Refine the existing spec; never drop content the user already has unless they ask.",
      "- Keep requirement IDs (`FR-n`) stable across refinements so later phases can reference them.",
    ].join("\n"),
  },
  "user-story": {
    artifact: "userStories",
    label: "User Stories",
    guidance: [
      "Derive **User Stories** from the Specification. Format:",
      "`## Epic: <name>` groups related stories; under it, one `### US-1: <short title>` heading per story containing:",
      "- the story line: `As a <role>, I want <capability>, so that <value>.`",
      "- `**Priority:** P1|P2|P3` (P1 = must-have for the smallest useful release).",
      "- `**Covers:** FR-x, FR-y` — the spec requirements this story delivers.",
      "- `**Acceptance criteria:**` Given/When/Then bullets — concrete and independently testable.",
      "",
      "Rules:",
      "- Every functional requirement in the spec must be covered by at least one story; call out any FR you could not cover.",
      "- Do not invent features that are not in the spec.",
      "- Keep `US-n` IDs stable across refinements — downstream tooling parses them.",
      "- Carry over any `[NEEDS CLARIFICATION]` items that affect a story instead of resolving them silently.",
    ].join("\n"),
  },
  "technical-story": {
    artifact: "technicalStories",
    label: "Technical Stories",
    guidance: [
      "Derive **Technical Stories** from the User Stories, grounded in the REAL codebase (read the relevant files first). Format: one `## TS-1: <short title>` heading per story containing:",
      "- a 2-4 sentence description of the change.",
      "- `**Covers:** US-x, US-y` — the user stories this delivers.",
      "- `**Depends on:** TS-z` (or `none`) — stories with no mutual dependencies can be implemented in parallel.",
      "- `**Files:** ` — the real paths likely touched (verify they exist with your tools; mark new files as `(new)`).",
      "- `**Acceptance criteria:**` verifiable bullets, including 'existing tests still pass'.",
      "- `### Example` — a short fenced code snippet (with language tag) of the key interface/type/stub the story builds toward, matching the existing language and patterns of the codebase. Illustrative shape, not a full implementation.",
      "",
      "Rules:",
      "- Each story must be small and self-contained — implementable in roughly half a day; split anything bigger.",
      "- Order stories so dependencies come first.",
      "- Keep `TS-n` IDs stable across refinements — each becomes a Worker task.",
    ].join("\n"),
  },
  implementation: {
    artifact: "code",
    label: "Implementation",
    guidance: [
      "This phase implements the technical stories. Sketch the implementation plan in dependency order (which stories can run in parallel), call out risks, and capture decisions in the artifact; the Workers do the detailed per-story work.",
      "You may edit source files directly in this phase when the user asks for it.",
    ].join("\n"),
  },
};

// Instruction blocks for the Spec Kit-style slash actions. They reuse the
// normal phase agent (same tools, same context) with a sharply scoped job.
const ACTION_INSTRUCTIONS: Record<AgentAction, string> = {
  clarify: [
    "## Action: /clarify",
    "Audit the current artifact for ambiguity. Hunt for: vague adjectives ('fast', 'simple', 'secure'), undefined terms, missing limits/quantities, unstated assumptions, unresolved `[NEEDS CLARIFICATION]` markers, and requirements that cannot be verified.",
    "1. Insert or update `[NEEDS CLARIFICATION: …]` markers at the exact ambiguous spots in the artifact (persist with `write_file`). Do not restructure or reword anything else.",
    "2. Reply with at most 5 numbered questions, most impactful first. For each: why it matters, and a sensible default the user can accept with a 'yes'.",
    "If the artifact is genuinely unambiguous, say so and list what you checked.",
  ].join("\n"),
  analyze: [
    "## Action: /analyze",
    "Run a READ-ONLY consistency audit across all artifacts that exist (spec, user stories, technical stories). Do NOT modify any file.",
    "Check: every FR covered by a US and every US by a TS (coverage gaps); contradictions between artifacts; duplicated or conflicting requirements; terminology drift (same concept, different names); acceptance criteria that are not verifiable; violations of the Project Constitution; dependency cycles or impossible ordering in technical stories.",
    "Reply with a markdown report: `### Critical` / `### Warning` / `### Info` findings (each with artifact + quote + why), a short coverage table (FR → US → TS), and a final 'recommended next steps' list. If everything is consistent, give the coverage table and say so.",
  ].join("\n"),
  ground: [
    "## Action: /ground",
    "Verify the current artifact against the REAL codebase. For every claim about existing code — file paths, module names, APIs, behaviors, commands — check it with your tools (`glob`, `grep`, `read_file`). Do NOT modify the artifact.",
    "Reply with a markdown report listing: ✗ mismatches (claim vs. what the code actually does, with file:line evidence), ✓ confirmed claims worth noting, and any parts of the codebase the artifact overlooks but will be affected. End with the concrete corrections you recommend.",
  ].join("\n"),
};

async function buildSystemPrompt(
  phase: Phase,
  artifacts: ArtifactFiles,
  specPath: string,
  action?: AgentAction,
): Promise<string> {
  const cfg = PHASE_CONFIG[phase];
  const root = projectRoot(specPath);
  const specRel = path.relative(root, specPath).replace(/\\/g, "/") || ".";
  const artifactVirtual = `/${specRel}/${ARTIFACT_FILENAMES[cfg.artifact]}`;
  const sections: string[] = [
    "You are the SpecOps AI agent, guiding a developer through Spec-Driven Development.",
    `Current phase: **${cfg.label}**.`,
    "",
    cfg.guidance,
    "",
    "## Paths you care about",
    `- Your filesystem tools are rooted at the **project root**: \`${root}\`.`,
    `- This conversation's spec folder: \`/${specRel}/\` — contains \`spec.md\`, \`user-stories.md\`, \`technical-stories.md\`, \`code.md\`.`,
    `- The artifact you are editing in this phase: \`${artifactVirtual}\`.`,
    "- Project context lives in `/.specops/` (constitution.md, codebase.md). Other specs live under `/specs/`.",
    "",
    "## How to work",
    "You have filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) rooted at the project root. Use them to ground your answers — actually read the relevant files, actually grep for real symbols. All paths are virtual absolute paths starting with `/`.",
    `To persist the ${cfg.label}, call \`write_file\` on \`${artifactVirtual}\` with the FULL updated markdown (never a diff). Only write when the user's message implies a change. For pure questions, don't touch the file — just answer.`,
    phase === "implementation"
      ? "You may also edit other source files with `write_file` / `edit_file` in this phase."
      : "",
    "Finish with a short reply: what you changed, what you need from the user (clarifying questions first), nothing else. Never answer meta questions about your tools by listing them — just demonstrate by using them.",
  ];

  const ctx = await projectContextSections(root);
  if (ctx.length) sections.push("", ...ctx);

  sections.push("", "## Context from earlier phases");
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

  if (action) sections.push("", ACTION_INSTRUCTIONS[action]);
  return sections.join("\n");
}

// The message actually sent to the model for a turn. For slash actions the
// transcript keeps the short "/clarify …" text; the model gets an explicit
// directive plus any focus text the user added after the command.
function turnMessage(req: AgentTurnRequest): string {
  if (!req.action) return req.message;
  const focus = req.message.trim();
  return [`Run the /${req.action} action now.`, focus ? `Focus: ${focus}` : ""]
    .filter(Boolean)
    .join("\n");
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
  const root = projectRoot(req.specPath);

  try {
    const system = await buildSystemPrompt(req.phase, req.artifacts, req.specPath, req.action);
    const baseline = req.artifacts[phaseCfg.artifact];
    await syncArtifactToDisk(req.specPath, phaseCfg.artifact, baseline);

    const cfg = await getActiveProvider();
    const model = await buildChatModel(cfg);
    const { deepagents } = await loadDeps();
    const lcMessages = await turnsToLcMessages(req.history, turnMessage(req));

    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: system,
      backend: await buildProjectBackend(root),
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

    if (changed) {
      const settings = await loadSettings();
      if (settings.autoCommit !== false) {
        const specRel = path.relative(root, req.specPath);
        const specId = path.basename(req.specPath);
        await commitPaths(
          root,
          [specRel],
          `docs(${specId}): update ${ARTIFACT_FILENAMES[phaseCfg.artifact]} (${req.phase} agent)`,
        );
      }
    }

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
