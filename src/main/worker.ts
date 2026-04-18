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
  IntegrationTestFramework,
  TaskChunk,
  TaskStatus,
  TechnicalStory,
  UserStory,
  WorkerChatRequest,
  WorkerDecomposeRequest,
  WorkerRunTaskRequest,
  WorkerState,
  WorkerStore,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import {
  workerSubagents,
  workerSubagentsNoTestAuthor,
} from "./workerSubagents";

const STORE_FILE = path.join(".specops", "workers.json");
const LEGACY_STORE_FILE = path.join(".specops", "subagents.json");

function projectRoot(specPath: string): string {
  return path.resolve(specPath, "..", "..");
}

type ChatMsg = { role: "user" | "assistant"; content: string };

const abortControllers = new Map<string, AbortController>();

function abortKey(specPath: string, id: string): string {
  return `${specPath}::${id}`;
}

function makeAbortController(specPath: string, id: string): AbortController {
  const key = abortKey(specPath, id);
  abortControllers.get(key)?.abort();
  const ac = new AbortController();
  abortControllers.set(key, ac);
  return ac;
}

function releaseAbortController(
  specPath: string,
  id: string,
  ac: AbortController,
): void {
  const key = abortKey(specPath, id);
  if (abortControllers.get(key) === ac) abortControllers.delete(key);
}

export function stopWorker(specPath: string, storyId: string): void {
  abortControllers.get(abortKey(specPath, storyId))?.abort();
}

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "AbortError") return true;
  return /\baborted?\b/i.test(e.message ?? "");
}

type BackendFactory = NonNullable<DeepAgents.CreateDeepAgentParams["backend"]>;

async function buildBackend(specPath: string): Promise<BackendFactory> {
  // virtualMode: true sandboxes paths under rootDir. Without it, deepagents'
  // built-in prompt tells the model to use absolute paths starting with `/`,
  // which then escape rootDir entirely (path.resolve drops the prefix), so the
  // model's write_file calls land in the real filesystem root and silently fail.
  //
  // CompositeBackend routes deepagents' internal eviction paths
  // (/conversation_history, /large_tool_results) into an in-memory StateBackend
  // so they never litter the project root.
  const { CompositeBackend, FilesystemBackend, StateBackend } = await loadDeepagents();
  const fsBackend = new FilesystemBackend({
    rootDir: projectRoot(specPath),
    virtualMode: true,
  });
  return (runtime) =>
    new CompositeBackend(fsBackend, {
      "/conversation_history": new StateBackend(runtime),
      "/large_tool_results": new StateBackend(runtime),
    });
}

async function migrateLegacyStore(specPath: string): Promise<void> {
  const newFile = path.join(specPath, STORE_FILE);
  const oldFile = path.join(specPath, LEGACY_STORE_FILE);
  try {
    await fs.access(newFile);
    return;
  } catch {
    // new file missing — check for legacy
  }
  try {
    const raw = await fs.readFile(oldFile, "utf8");
    await fs.mkdir(path.dirname(newFile), { recursive: true });
    await fs.writeFile(newFile, raw, "utf8");
    await fs.unlink(oldFile).catch(() => undefined);
  } catch {
    // no legacy file, nothing to do
  }
}

async function loadStore(specPath: string): Promise<WorkerStore> {
  await migrateLegacyStore(specPath);
  try {
    const raw = await fs.readFile(path.join(specPath, STORE_FILE), "utf8");
    const parsed = JSON.parse(raw) as WorkerStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(specPath: string, store: WorkerStore): Promise<void> {
  const file = path.join(specPath, STORE_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

function emptyState(storyId: string): WorkerState {
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

export async function readWorkers(specPath: string): Promise<WorkerStore> {
  return loadStore(specPath);
}

export async function decomposeStory(
  req: WorkerDecomposeRequest,
): Promise<WorkerState> {
  const store = await loadStore(req.specPath);
  const prev = store[req.story.id] ?? emptyState(req.story.id);
  const working: WorkerState = { ...prev, status: "decomposing", error: undefined };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  const ac = makeAbortController(req.specPath, req.story.id);
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
      subagents: workerSubagentsNoTestAuthor,
    });
    await agent.invoke(
      {
        messages: [new HumanMessage("Decompose the story now by calling emit_tasks.")],
      },
      { signal: ac.signal },
    );

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
    const next: WorkerState = {
      storyId: req.story.id,
      tasks: merged,
      messages: prev.messages,
      status: allDone(merged) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const aborted = isAbortError(err);
    const next: WorkerState = {
      ...prev,
      status: "idle",
      error: aborted
        ? "Decomposition stopped by user."
        : `Decomposition failed: ${(err as Error).message}`,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } finally {
    releaseAbortController(req.specPath, req.story.id, ac);
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
    "You are a Worker scoped to a single Technical Story.",
    "Your context is isolated: do not discuss other stories. Keep responses concise and actionable.",
    "You have filesystem tools (ls, read_file, write_file, edit_file, glob, grep) rooted at the PROJECT ROOT — you can see and edit the full source tree (e.g. `src/`, `package.json`, `tests/`). The spec markdown lives under `specs/<id>/`.",
    "You also have a built-in `task` tool that lets you spawn generic deepagents subagents — `plan`, `explore`, `test-author` — for context-isolated sub-work. Delegate large survey / planning / test-writing passes to them rather than inlining everything in your own context.",
    "Help implement the tasks below by ACTUALLY editing files with write_file / edit_file — do not just describe changes in prose.",
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

async function runStoryWorker(
  specPath: string,
  system: string,
  history: ChatMsg[],
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const cfg = await getActiveProvider();
  const { createDeepAgent } = await loadDeepagents();
  const model = await buildChatModel(cfg);
  const lcMessages = await toLcMessages([...history, { role: "user", content: userMessage }]);
  const agent = createDeepAgent({
    model,
    systemPrompt: system,
    backend: await buildBackend(specPath),
    subagents: workerSubagents,
  });
  const result = await agent.invoke({ messages: lcMessages }, { signal });
  return lastAssistantText(result) || "(no reply)";
}

export async function workerChat(
  req: WorkerChatRequest,
): Promise<WorkerState> {
  const store = await loadStore(req.specPath);
  const prev = store[req.story.id] ?? emptyState(req.story.id);
  const userTurn = { role: "user" as const, text: req.message };
  const working: WorkerState = {
    ...prev,
    messages: [...prev.messages, userTurn],
    status: "running",
    error: undefined,
  };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  const ac = makeAbortController(req.specPath, req.story.id);
  try {
    const system = chatSystemPrompt(req.story, prev.tasks, req.artifacts);
    const history: ChatMsg[] = prev.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const reply = await runStoryWorker(
      req.specPath,
      system,
      history,
      req.message,
      ac.signal,
    );
    const next: WorkerState = {
      ...working,
      messages: [...working.messages, { role: "agent", text: reply }],
      status: allDone(prev.tasks) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const aborted = isAbortError(err);
    const text = aborted ? "(stopped by user)" : `Worker error: ${(err as Error).message}`;
    const next: WorkerState = {
      ...working,
      messages: [...working.messages, { role: "agent", text }],
      status: "idle",
      error: aborted ? undefined : (err as Error).message,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } finally {
    releaseAbortController(req.specPath, req.story.id, ac);
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

export async function runWorkerTask(
  req: WorkerRunTaskRequest,
): Promise<WorkerState> {
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
  const working: WorkerState = {
    ...prev,
    tasks: inProgressTasks,
    messages: [...prev.messages, userTurn],
    status: "running",
    error: undefined,
  };
  store[req.story.id] = working;
  await saveStore(req.specPath, store);

  const ac = makeAbortController(req.specPath, req.story.id);
  try {
    const system = chatSystemPrompt(req.story, inProgressTasks, req.artifacts);
    const history: ChatMsg[] = prev.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const reply = await runStoryWorker(
      req.specPath,
      system,
      history,
      userTurnText,
      ac.signal,
    );
    const finalTasks = req.autoComplete
      ? inProgressTasks.map((t) =>
          t.id === task.id ? { ...t, status: "done" as TaskStatus } : t,
        )
      : inProgressTasks;
    const next: WorkerState = {
      ...working,
      tasks: finalTasks,
      messages: [...working.messages, { role: "agent", text: reply }],
      status: allDone(finalTasks) ? "done" : "idle",
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } catch (err) {
    const aborted = isAbortError(err);
    const text = aborted ? "(stopped by user)" : `Worker error: ${(err as Error).message}`;
    const next: WorkerState = {
      ...working,
      tasks: prev.tasks,
      messages: [...working.messages, { role: "agent", text }],
      status: "idle",
      error: aborted ? undefined : (err as Error).message,
    };
    store[req.story.id] = next;
    await saveStore(req.specPath, store);
    return next;
  } finally {
    releaseAbortController(req.specPath, req.story.id, ac);
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
): Promise<WorkerState> {
  const store = await loadStore(specPath);
  const prev = store[storyId] ?? emptyState(storyId);
  const tasks = prev.tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
  const next: WorkerState = {
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
    "You are a test-authoring Worker for ONE Technical Story.",
    "Generate a unit-test specification for the story and WRITE it to the file path below using your `write_file` tool.",
    "You may delegate the focused writing pass to the `test-author` deepagents subagent via the built-in `task` tool if the story is large, but the final file must end up on disk at the target path.",
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
  const root = projectRoot(req.specPath);
  const absPath = path.join(root, relPath);

  const ac = makeAbortController(req.specPath, req.story.id);
  try {
    const cfg = await getActiveProvider();
    const { createDeepAgent } = await loadDeepagents();
    const { HumanMessage } = await loadMessages();
    const model = await buildChatModel(cfg);
    const agent = createDeepAgent({
      model,
      systemPrompt: unitTestPrompt(req.story, tasks, req.artifacts, relPath),
      backend: await buildBackend(req.specPath),
      subagents: workerSubagents,
    });
    const result = await agent.invoke(
      {
        messages: [
          new HumanMessage(
            `Generate unit tests for ${req.story.id} and save them to ${relPath}.`,
          ),
        ],
      },
      { signal: ac.signal },
    );
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
        error: `Worker did not write ${relPath}.`,
      };
    }
    return { storyId: req.story.id, path: relPath, content, summary };
  } catch (err) {
    return {
      storyId: req.story.id,
      path: relPath,
      content: "",
      summary: "",
      error: isAbortError(err) ? "stopped by user" : (err as Error).message,
    };
  } finally {
    releaseAbortController(req.specPath, req.story.id, ac);
  }
}

function detectFramework(artifacts: ArtifactFiles): IntegrationTestFramework {
  const blob = `${artifacts.spec}\n${artifacts.userStories}\n${artifacts.technicalStories}`.toLowerCase();
  // Mobile stacks take priority over web — a Flutter spec often also mentions "app".
  if (/\bflutter\b|\bdart\b/.test(blob)) return "flutter";
  if (/\bxcuitest\b|\bswiftui\b|\bxcode\b|\bios app\b|\bswift\b/.test(blob)) return "xcuitest";
  if (/\bespresso\b|\bandroid app\b|\bjetpack compose\b|\bkotlin\b/.test(blob)) return "espresso";
  if (/\breact\b|\bnext\.js\b|\bnuxt\b|\bvue\b|\bsvelte\b|\bangular\b|web app|browser|\bplaywright\b/.test(blob)) {
    return "playwright";
  }
  return "generic";
}

function integrationTestRelPath(storyId: string, framework: IntegrationTestFramework): string {
  const safe = storyId.replace(/[^A-Za-z0-9._-]/g, "_");
  switch (framework) {
    case "playwright":
      return path.join("tests", "integration", `${safe}.spec.ts`);
    case "flutter":
      return path.join("tests", "integration", `${safe}_test.dart`);
    case "xcuitest":
      return path.join("tests", "integration", `${safe}UITests.swift`);
    case "espresso":
      return path.join("tests", "integration", `${safe}Test.kt`);
    default:
      return path.join("tests", "integration", `${safe}.test.md`);
  }
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

function playwrightPromptSection(): string {
  return [
    "## Target framework: Playwright (TypeScript)",
    "",
    "Generate a runnable Playwright test file. Follow these rules:",
    "- Import from `@playwright/test`: `import { test, expect } from '@playwright/test';`",
    "- Use `test.describe(...)` to group scenarios for this User Story.",
    "- Each scenario is a `test(...)` block with a descriptive name.",
    "- Use Playwright locators (`page.getByRole`, `page.getByText`, `page.getByTestId`, `page.locator`) — avoid raw CSS selectors when semantic locators work.",
    "- Use `await expect(...)` assertions (e.g., `toBeVisible()`, `toHaveText()`, `toHaveURL()`).",
    "- Add `test.beforeEach` for shared navigation / setup steps.",
    "- Use `// TODO:` comments for app-specific URLs or selectors that must be adapted to the real app.",
    "- Do NOT import anything that doesn't ship with `@playwright/test`.",
    "- The file must be valid TypeScript that passes `tsc --noEmit` against `@playwright/test` types.",
  ].join("\n");
}

function flutterPromptSection(): string {
  return [
    "## Target framework: Flutter integration_test (Dart)",
    "",
    "Generate a runnable Flutter integration test file. Follow these rules:",
    "- Imports: `import 'package:flutter/material.dart';`, `import 'package:flutter_test/flutter_test.dart';`, `import 'package:integration_test/integration_test.dart';`.",
    "- First line of `main()` must be `IntegrationTestWidgetsFlutterBinding.ensureInitialized();`.",
    "- Use `group(...)` to group scenarios for this User Story and `testWidgets(...)` for each scenario.",
    "- Drive the UI with `WidgetTester`: `tester.pumpWidget(...)`, `tester.tap(...)`, `tester.enterText(...)`, `await tester.pumpAndSettle()`.",
    "- Use `find.byKey(Key('…'))`, `find.byType(...)`, `find.text(...)`, `find.bySemanticsLabel(...)` — prefer keys and semantics over raw text when stability matters.",
    "- Assertions via `expect(finder, matcher)` with matchers like `findsOneWidget`, `findsNothing`, `findsNWidgets(n)`.",
    "- Use `// TODO:` comments where the real widget tree / entry point of the app must be plugged in (e.g. `MyApp()`).",
    "- The file must be syntactically valid Dart that compiles under `flutter test integration_test/`.",
  ].join("\n");
}

function xcuitestPromptSection(): string {
  return [
    "## Target framework: XCUITest (Swift)",
    "",
    "Generate a runnable XCUITest file. Follow these rules:",
    "- Imports: `import XCTest`.",
    "- Declare a single `final class <Name>UITests: XCTestCase { … }`. The class name MUST match the file name (minus `.swift`).",
    "- Implement `override func setUpWithError()` with `continueAfterFailure = false` and an `XCUIApplication().launch()`.",
    "- One `func test…()` per scenario with a descriptive name (`testUserCanSignIn`, `testEmptyFormShowsError`, …).",
    "- Drive the UI through `XCUIApplication()`: `app.buttons[\"…\"]`, `app.textFields[\"…\"]`, `app.staticTexts[\"…\"]`, `.tap()`, `.typeText(\"…\")`.",
    "- Assert via `XCTAssert…`: `XCTAssertTrue(element.exists)`, `XCTAssertEqual(...)`, use `.waitForExistence(timeout:)` for async UI.",
    "- Use `// TODO:` comments for accessibility identifiers that must be added on the app side.",
    "- The file must be syntactically valid Swift that compiles under an Xcode UI-testing target.",
  ].join("\n");
}

function espressoPromptSection(): string {
  return [
    "## Target framework: Espresso (Kotlin, AndroidX)",
    "",
    "Generate a runnable Espresso instrumentation test file. Follow these rules:",
    "- Imports: `androidx.test.ext.junit.runners.AndroidJUnit4`, `androidx.test.ext.junit.rules.ActivityScenarioRule`, `androidx.test.espresso.Espresso.onView`, `androidx.test.espresso.action.ViewActions.*`, `androidx.test.espresso.assertion.ViewAssertions.matches`, `androidx.test.espresso.matcher.ViewMatchers.*`, `org.junit.*`.",
    "- Annotate the class with `@RunWith(AndroidJUnit4::class)` and declare a single `class <Name>Test { … }`. Class name MUST match the file name (minus `.kt`).",
    "- Add `@get:Rule val scenarioRule = ActivityScenarioRule(MainActivity::class.java)` (mark the activity class as `// TODO:` if unknown).",
    "- One `@Test fun …()` per scenario with a descriptive name.",
    "- Drive the UI with `onView(withId(R.id.…)).perform(click(), typeText(\"…\"))` and assert with `.check(matches(isDisplayed()))` / `.check(matches(withText(\"…\")))`.",
    "- Use `// TODO:` for view ids / activity classes that must be adapted to the real app.",
    "- The file must be syntactically valid Kotlin that compiles under an Android instrumentation (`androidTest`) source set.",
  ].join("\n");
}

function frameworkPromptSection(
  framework: IntegrationTestFramework,
  artifacts: ArtifactFiles,
): string {
  switch (framework) {
    case "playwright":
      return playwrightPromptSection();
    case "flutter":
      return flutterPromptSection();
    case "xcuitest":
      return xcuitestPromptSection();
    case "espresso":
      return espressoPromptSection();
    default:
      return ["## Target framework guidance", detectTargetStackHint(artifacts)].join(
        "\n\n",
      );
  }
}

function integrationTestPrompt(
  story: UserStory,
  artifacts: ArtifactFiles,
  testFile: string,
  framework: IntegrationTestFramework,
): string {
  const concrete = framework !== "generic";
  return [
    "You are a test-authoring Worker generating INTEGRATION / end-to-end tests for ONE User Story.",
    "Write the test specification to the file path below using your `write_file` tool.",
    "You may delegate the focused writing pass to the `test-author` deepagents subagent via the built-in `task` tool, but the final file must be on disk at the target path.",
    "Integration tests must exercise the user-visible flow end to end — not internal units.",
    concrete
      ? `Each test must be a concrete, runnable ${framework} scenario.`
      : "Structure each scenario as Given / When / Then and tie it to an acceptance criterion of the story.",
    "Cover the happy path plus the most important failure / edge cases the story implies.",
    "",
    frameworkPromptSection(framework, artifacts),
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
  const framework = detectFramework(req.artifacts);
  const relPath = integrationTestRelPath(req.story.id, framework);
  const root = projectRoot(req.specPath);
  const absPath = path.join(root, relPath);

  const ac = makeAbortController(req.specPath, req.story.id);
  try {
    const cfg = await getActiveProvider();
    const { createDeepAgent } = await loadDeepagents();
    const { HumanMessage } = await loadMessages();
    const model = await buildChatModel(cfg);
    const agent = createDeepAgent({
      model,
      systemPrompt: integrationTestPrompt(req.story, req.artifacts, relPath, framework),
      backend: await buildBackend(req.specPath),
      subagents: workerSubagents,
    });
    const result = await agent.invoke(
      {
        messages: [
          new HumanMessage(
            `Generate integration tests for ${req.story.id} and save them to ${relPath}.`,
          ),
        ],
      },
      { signal: ac.signal },
    );
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
        framework,
        error: `Worker did not write ${relPath}.`,
      };
    }
    return { storyId: req.story.id, path: relPath, content, summary, framework };
  } catch (err) {
    return {
      storyId: req.story.id,
      path: relPath,
      content: "",
      summary: "",
      framework,
      error: isAbortError(err) ? "stopped by user" : (err as Error).message,
    };
  } finally {
    releaseAbortController(req.specPath, req.story.id, ac);
  }
}

export async function resetWorker(
  specPath: string,
  storyId: string,
): Promise<WorkerStore> {
  const store = await loadStore(specPath);
  delete store[storyId];
  await saveStore(specPath, store);
  return store;
}
