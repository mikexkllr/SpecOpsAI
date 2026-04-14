import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ArtifactFiles,
  SubAgentChatRequest,
  SubAgentDecomposeRequest,
  SubAgentState,
  SubAgentStore,
  TaskChunk,
  TaskStatus,
  TechnicalStory,
} from "../shared/api";
import { callProvider, type ChatMessage } from "./agent";

const STORE_FILE = path.join(".specops", "subagents.json");

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
    "Return ONLY a JSON array — no prose, no code fences — of 2 to 8 objects with this exact shape:",
    `[{"id":"${story.id}.1","title":"short imperative","description":"1-2 sentences with acceptance criteria"}]`,
    "Each chunk must be independently implementable in under ~30 minutes.",
    "Use the story id as prefix for chunk ids.",
    "",
    contextSections(artifacts),
    "",
    storySection(story),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeTasks(raw: unknown, storyId: string): TaskChunk[] {
  if (!Array.isArray(raw)) return [];
  const tasks: TaskChunk[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const r = item as Record<string, unknown>;
    const id =
      typeof r.id === "string" && r.id.trim() ? r.id.trim() : `${storyId}.${i + 1}`;
    const title =
      typeof r.title === "string" && r.title.trim()
        ? r.title.trim()
        : `Task ${i + 1}`;
    const description =
      typeof r.description === "string" ? r.description.trim() : "";
    tasks.push({ id, title, description, status: "pending" });
  });
  return tasks;
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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
    const system = decompositionPrompt(req.story, req.artifacts);
    const text = await callProvider(system, [
      { role: "user", content: "Decompose the story now." },
    ]);
    const parsed = extractJsonArray(text);
    const tasks = normalizeTasks(parsed, req.story.id);
    if (tasks.length === 0) throw new Error("No tasks extracted from model output.");
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
    const messages: ChatMessage[] = [
      ...prev.messages.map<ChatMessage>((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      })),
      { role: "user", content: req.message },
    ];
    const reply = (await callProvider(system, messages)).trim() || "(no reply)";
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

export async function resetSubAgent(
  specPath: string,
  storyId: string,
): Promise<SubAgentStore> {
  const store = await loadStore(specPath);
  delete store[storyId];
  await saveStore(specPath, store);
  return store;
}
