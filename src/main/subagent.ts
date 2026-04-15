import * as fs from "node:fs/promises";
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
  ArtifactFiles,
  GenerateIntegrationTestsRequest,
  GenerateIntegrationTestsResult,
  GenerateUnitTestsRequest,
  GenerateUnitTestsResult,
  SubAgentChatRequest,
  SubAgentDecomposeRequest,
  SubAgentRunTaskRequest,
  SubAgentState,
  SubAgentStore,
  TaskChunk,
  TaskStatus,
  TechnicalStory,
  UserStory,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";

const STORE_FILE = path.join(".specops", "subagents.json");

type ChatMsg = { role: "user" | "assistant"; content: string };

async function loadStore(specPath: string): Promise<SubAgentStore> {
  try {
    const raw = await fs.readFile(path.join(specPath, STORE_FILE), "utf8");
    const parsed = JSON.parse(raw) as SubAgentStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(specPath: string, store: SubAgentStore): Promise<void> {
  const file = path.join(specPath, STORE_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

function emptyState(storyId: string): SubAgentState {
  return { storyId, tasks: [], messages: [], status: "idle" };
}

function contextSections(artifacts: ArtifactFiles): string {
  const parts: string[] = [];
  if (artifacts.spec.trim()) parts.push("## Spec", artifacts.spec.trim());
  if (artifacts.userStories.trim())
    parts.push("## User Stories", artifacts.userStories.trim());
  return parts.join("\n\n");
}

function storySection(story: TechnicalStory): string {
  return [
    "## This Technical Story",
    `### ${story.id}: ${story.title}`,
    story.body || "(no body)",
  ].join("\n\n");
}

function decompositionPrompt(
  story: TechnicalStory,
  artifacts: ArtifactFiles,
): string {
  return [
    "You decompose one Technical Story into the smallest useful implementation chunks.",
    "Call the `emit_tasks` tool exactly once with 2–8 task objects. Do not reply in prose.",
    "Each chunk must be independently implementable in under ~30 minutes.",
    "Use the story id as prefix for chunk ids (e.g. " + story.id + ".1).",
    "",
    contextSections(artifacts),
    "",
    storySection(story),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function toLcMessages(messages: ChatMsg[]): Promise<BaseMessage[]> {
  const { HumanMessage, AIMessage } = await loadMessages();
  return messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
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

export async function readSubAgents(specPath: string): Promise<SubAgentStore> {
  return loadStore(specPath);
}

export async function decomposeStory(
  req: SubAgentDecomposeRequest,
): Promise<SubAgentState> {
  const store = await loadStore(req.specPath);
  const prev = store[req.story.id] ?? emptyState(req.story.id);
  const working: SubAgentState = { ...prev, status: "decomposing", error: undefined };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  try {
    let captured: Array<{ id: string; title: string; description: string }> | null = null;
    const { tool } = await loadTools();
    const { HumanMessage } = await loadMessages();
    const emitTasks = tool(
      async (input: { tasks: Array<{ id: string; title: string; description: string }> }) => {
        captured = input.tasks;
        return `Captured ${input.tasks.length} tasks.`;
      },
      {
        name: "emit_tasks",
        description: "Emit the decomposed task chunks for this Technical Story.",
        schema: z.object({
          tasks: z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                description: z.string(),
              }),
            )
            .min(2)
            .max(8),
        }),
      },
    );

    const cfg = await getActiveProvider();
    const { createDeepAgent } = await loadDeepagents();
    const agent = createDeepAgent({
      model: await buildChatModel(cfg),
      systemPrompt: decompositionPrompt(req.story, req.artifacts),
      tools: [emitTasks],
    });
    await agent.invoke({
      messages: [new HumanMessage("Decompose the story now by calling emit_tasks.")],
    });

    const emitted = captured as Array<{ id: string; title: string; description: string }> | null;
    if (!emitted || emitted.length === 0) {
      throw new Error("Agent did not call emit_tasks.");
    }
    const tasks: TaskChunk[] = emitted.map((t, i) => ({
      id: t.id?.trim() || `${req.story.id}.${i + 1}`,
      title: t.title?.trim() || `Task ${i + 1}`,
      description: t.description?.trim() || "",
      status: "pending",
    }));
    const existing = new Map(prev.tasks.map((t) => [t.id, t.status]));
    const merged = tasks.map((t) => ({ ...t, status: existing.get(t.id) ?? "pending" }));
    const next: SubAgentState = {
      storyId: req.story.id,
      tasks: merged,
      messages: prev.messages,
      status: allDone(merged) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const next: SubAgentState = {
      ...prev,
      status: "idle",
      error: `Decomposition failed: ${(err as Error).message}`,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  }
}

function chatSystemPrompt(
  story: TechnicalStory,
  tasks: TaskChunk[],
  artifacts: ArtifactFiles,
): string {
  const taskBlock = tasks.length
    ? tasks
        .map((t) => `- [${t.status}] ${t.id} ${t.title} — ${t.description}`)
        .join("\n")
    : "(not decomposed yet — suggest decomposition if helpful)";
  return [
    "You are a SUB-AGENT scoped to a single Technical Story.",
    "Your context is isolated: do not discuss other stories. Keep responses concise and actionable.",
    "You have filesystem tools (ls, read_file, write_file, edit_file, glob, grep) rooted at this spec's working directory.",
    "Help implement the tasks below: propose code, ask targeted questions, flag blockers.",
    "",
    contextSections(artifacts),
    "",
    storySection(story),
    "",
    "## Decomposed tasks",
    taskBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runStorySubAgent(
  specPath: string,
  system: string,
  history: ChatMsg[],
  userMessage: string,
): Promise<string> {
  const cfg = await getActiveProvider();
  const { createDeepAgent, FilesystemBackend } = await loadDeepagents();
  const model = await buildChatModel(cfg);
  const lcMessages = await toLcMessages([...history, { role: "user", content: userMessage }]);
  const agent = createDeepAgent({
    model,
    systemPrompt: system,
    backend: new FilesystemBackend({ rootDir: specPath }),
  });
  const result = await agent.invoke({ messages: lcMessages });
  return lastAssistantText(result) || "(no reply)";
}

export async function subAgentChat(
  req: SubAgentChatRequest,
): Promise<SubAgentState> {
  const store = await loadStore(req.specPath);
  const prev = store[req.story.id] ?? emptyState(req.story.id);
  const userTurn = { role: "user" as const, text: req.message };
  const working: SubAgentState = {
    ...prev,
    messages: [...prev.messages, userTurn],
    status: "running",
    error: undefined,
  };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  try {
    const system = chatSystemPrompt(req.story, prev.tasks, req.artifacts);
    const history: ChatMsg[] = prev.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const reply = await runStorySubAgent(req.specPath, system, history, req.message);
    const next: SubAgentState = {
      ...working,
      messages: [...working.messages, { role: "agent", text: reply }],
      status: allDone(prev.tasks) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const next: SubAgentState = {
      ...working,
      messages: [
        ...working.messages,
        { role: "agent", text: `Sub-agent error: ${(err as Error).message}` },
      ],
      status: "idle",
      error: (err as Error).message,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  }
}

function taskPrompt(task: TaskChunk, story: TechnicalStory): string {
  return [
    `Work on task ${task.id} — "${task.title}" — of story ${story.id}.`,
    task.description ? `Acceptance: ${task.description}` : "",
    "Use your filesystem tools to inspect and edit files as needed.",
    "Produce a concrete, reviewable implementation proposal (code diff outline, files touched, edge cases).",
    "Keep the response focused on THIS task only.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runSubAgentTask(
  req: SubAgentRunTaskRequest,
): Promise<SubAgentState> {
  const store = await loadStore(req.specPath);
  const prev = store[req.story.id] ?? emptyState(req.story.id);
  const task = prev.tasks.find((t) => t.id === req.taskId);
  if (!task) {
    return {
      ...prev,
      error: `Task ${req.taskId} not found — decompose the story first.`,
    };
  }

  const inProgressTasks = prev.tasks.map((t) =>
    t.id === task.id ? { ...t, status: "in-progress" as TaskStatus } : t,
  );
  const userTurnText = taskPrompt(task, req.story);
  const userTurn = { role: "user" as const, text: userTurnText };
  const working: SubAgentState = {
    ...prev,
    tasks: inProgressTasks,
    messages: [...prev.messages, userTurn],
    status: "running",
    error: undefined,
  };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  try {
    const system = chatSystemPrompt(req.story, inProgressTasks, req.artifacts);
    const history: ChatMsg[] = prev.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const reply = await runStorySubAgent(req.specPath, system, history, userTurnText);
    const finalTasks = req.autoComplete
      ? inProgressTasks.map((t) =>
          t.id === task.id ? { ...t, status: "done" as TaskStatus } : t,
        )
      : inProgressTasks;
    const next: SubAgentState = {
      ...working,
      tasks: finalTasks,
      messages: [...working.messages, { role: "agent", text: reply }],
      status: allDone(finalTasks) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const next: SubAgentState = {
      ...working,
      tasks: prev.tasks,
      messages: [
        ...working.messages,
        { role: "agent", text: `Sub-agent error: ${(err as Error).message}` },
      ],
      status: "idle",
      error: (err as Error).message,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  }
}

function allDone(tasks: TaskChunk[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.status === "done");
}

export async function updateTaskStatus(
  specPath: string,
  storyId: string,
  taskId: string,
  status: TaskStatus,
): Promise<SubAgentState> {
  const store = await loadStore(specPath);
  const prev = store[storyId] ?? emptyState(storyId);
  const tasks = prev.tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
  const next: SubAgentState = {
    ...prev,
    tasks,
    status: allDone(tasks) ? "done" : prev.status === "done" ? "idle" : prev.status,
  };
  store[storyId] = next;
  await saveStore(specPath, store);
  return next;
}

function unitTestRelPath(storyId: string): string {
  const safe = storyId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join("tests", "unit", `${safe}.test.md`);
}

function unitTestPrompt(
  story: TechnicalStory,
  tasks: TaskChunk[],
  artifacts: ArtifactFiles,
  testFile: string,
): string {
  const taskBlock = tasks.length
    ? tasks.map((t) => `- ${t.id} ${t.title} — ${t.description}`).join("\n")
    : "(no decomposed tasks — derive tests directly from the acceptance criteria)";
  return [
    "You are a test-authoring sub-agent for ONE Technical Story.",
    "Generate a unit-test specification for the story and WRITE it to the file path below using your `write_file` tool.",
    "Tests must be derived strictly from the story's acceptance criteria and decomposed tasks — one `it(...)` per observable behavior.",
    "Include: a short preamble, `describe` blocks grouping behaviors, and concrete `it(...)` cases with Arrange/Act/Assert notes.",
    "Prefer framework-agnostic pseudocode unless the artifacts clearly indicate a stack (Jest/Vitest/etc). Mark assumptions explicitly.",
    "Do NOT invent requirements not grounded in the story or user stories.",
    "",
    `## Target file (use write_file to create or overwrite this exact path)\n${testFile}`,
    "",
    contextSections(artifacts),
    "",
    storySection(story),
    "",
    "## Decomposed tasks",
    taskBlock,
    "",
    "After writing the file, reply with one or two sentences summarizing the tests you generated.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateUnitTests(
  req: GenerateUnitTestsRequest,
): Promise<GenerateUnitTestsResult> {
  const store = await loadStore(req.specPath);
  const state = store[req.story.id];
  const tasks = state?.tasks ?? [];
  const relPath = unitTestRelPath(req.story.id);
  const absPath = path.join(req.specPath, relPath);

  try {
    const cfg = await getActiveProvider();
    const { createDeepAgent, FilesystemBackend } = await loadDeepagents();
    const { HumanMessage } = await loadMessages();
    const model = await buildChatModel(cfg);
    const agent = createDeepAgent({
      model,
      systemPrompt: unitTestPrompt(req.story, tasks, req.artifacts, relPath),
      backend: new FilesystemBackend({ rootDir: req.specPath }),
    });
    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          `Generate unit tests for ${req.story.id} and save them to ${relPath}.`,
        ),
      ],
    });
    const summary = lastAssistantText(result) || "(no summary)";
    let content = "";
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      return {
        storyId: req.story.id,
        path: relPath,
        content: "",
        summary,
        error: `Sub-agent did not write ${relPath}.`,
      };
    }
    return { storyId: req.story.id, path: relPath, content, summary };
  } catch (err) {
    return {
      storyId: req.story.id,
      path: relPath,
      content: "",
      summary: "",
      error: (err as Error).message,
    };
  }
}

function integrationTestRelPath(storyId: string): string {
  const safe = storyId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join("tests", "integration", `${safe}.test.md`);
}

function detectTargetStackHint(artifacts: ArtifactFiles): string {
  const blob = `${artifacts.spec}\n${artifacts.userStories}\n${artifacts.technicalStories}`.toLowerCase();
  const hints: string[] = [];
  if (/\breact\b|\bnext\.js\b|\bvue\b|\bsvelte\b|web app|browser/.test(blob)) {
    hints.push("Web target detected — prefer Playwright for end-to-end browser flows.");
  }
  if (/\bflutter\b/.test(blob)) {
    hints.push("Flutter target detected — use `flutter test integration_test/` patterns.");
  }
  if (/\bios\b|swift|xcode|xcuitest/.test(blob)) {
    hints.push("iOS target detected — use XCUITest patterns.");
  }
  if (/\bandroid\b|kotlin|espresso/.test(blob)) {
    hints.push("Android target detected — use Espresso / UI Automator patterns.");
  }
  if (hints.length === 0) {
    hints.push(
      "No explicit target stack detected — write framework-agnostic Given/When/Then scenarios and flag the assumed stack.",
    );
  }
  return hints.join("\n");
}

function userStorySection(story: UserStory): string {
  return [
    "## This User Story",
    `### ${story.id}: ${story.title}`,
    story.body || "(no body)",
  ].join("\n\n");
}

function integrationTestPrompt(
  story: UserStory,
  artifacts: ArtifactFiles,
  testFile: string,
): string {
  return [
    "You are a test-authoring sub-agent generating INTEGRATION / end-to-end tests for ONE User Story.",
    "Write the test specification to the file path below using your `write_file` tool.",
    "Integration tests must exercise the user-visible flow end to end — not internal units.",
    "Structure each scenario as Given / When / Then and tie it to an acceptance criterion of the story.",
    "Cover the happy path plus the most important failure / edge cases the story implies.",
    "",
    "## Target framework guidance",
    detectTargetStackHint(artifacts),
    "",
    `## Target file (use write_file to create or overwrite this exact path)\n${testFile}`,
    "",
    contextSections(artifacts),
    "",
    userStorySection(story),
    "",
    "After writing the file, reply with one or two sentences summarizing the scenarios you generated.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateIntegrationTests(
  req: GenerateIntegrationTestsRequest,
): Promise<GenerateIntegrationTestsResult> {
  const relPath = integrationTestRelPath(req.story.id);
  const absPath = path.join(req.specPath, relPath);

  try {
    const cfg = await getActiveProvider();
    const { createDeepAgent, FilesystemBackend } = await loadDeepagents();
    const { HumanMessage } = await loadMessages();
    const model = await buildChatModel(cfg);
    const agent = createDeepAgent({
      model,
      systemPrompt: integrationTestPrompt(req.story, req.artifacts, relPath),
      backend: new FilesystemBackend({ rootDir: req.specPath }),
    });
    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          `Generate integration tests for ${req.story.id} and save them to ${relPath}.`,
        ),
      ],
    });
    const summary = lastAssistantText(result) || "(no summary)";
    let content = "";
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      return {
        storyId: req.story.id,
        path: relPath,
        content: "",
        summary,
        error: `Sub-agent did not write ${relPath}.`,
      };
    }
    return { storyId: req.story.id, path: relPath, content, summary };
  } catch (err) {
    return {
      storyId: req.story.id,
      path: relPath,
      content: "",
      summary: "",
      error: (err as Error).message,
    };
  }
}

export async function resetSubAgent(
  specPath: string,
  storyId: string,
): Promise<SubAgentStore> {
  const store = await loadStore(specPath);
  delete store[storyId];
  await saveStore(specPath, store);
  return store;
}
