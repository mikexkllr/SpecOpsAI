import { z } from "zod";
import type * as DeepAgents from "deepagents";
import type {
  ArtifactFiles,
  EditorAgentRequest,
  EditorAgentResult,
  MarkedTask,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import { loadDeps, createFsBackend } from "./deepagentsDeps";
import { workerSubagents } from "./workerSubagents";
import { readWorkers, updateTaskStatus } from "./worker";
import { projectRoot, lastAssistantText, isAbortError } from "./utils";

type BackendFactory = NonNullable<DeepAgents.CreateDeepAgentParams["backend"]>;

async function buildBackend(specPath: string): Promise<BackendFactory> {
  const { deepagents } = await loadDeps();
  const { CompositeBackend, StateBackend } = deepagents;
  const fsBackend = createFsBackend(deepagents, {
    rootDir: projectRoot(specPath),
    virtualMode: true,
  });
  return (runtime) =>
    new CompositeBackend(fsBackend, {
      "/conversation_history": new StateBackend(runtime),
      "/large_tool_results": new StateBackend(runtime),
    });
}

function contextSections(artifacts: ArtifactFiles): string[] {
  const out: string[] = [];
  if (artifacts.spec.trim()) out.push("## Spec", artifacts.spec.trim(), "");
  if (artifacts.userStories.trim())
    out.push("## User Stories", artifacts.userStories.trim(), "");
  if (artifacts.technicalStories.trim())
    out.push("## Technical Stories", artifacts.technicalStories.trim(), "");
  return out;
}

export async function runEditorAgent(
  req: EditorAgentRequest,
): Promise<EditorAgentResult> {
  try {
    const cfg = await getActiveProvider();
    const { deepagents, messages: M, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);

    // Snapshot every still-open task so the agent knows the ids it may mark done.
    const store = await readWorkers(req.specPath);
    const openTasks: Array<{ storyId: string; taskId: string; title: string; status: string }> =
      [];
    for (const [storyId, state] of Object.entries(store)) {
      for (const t of state.tasks) {
        if (t.status !== "done") {
          openTasks.push({ storyId, taskId: t.id, title: t.title, status: t.status });
        }
      }
    }
    const taskIndex = new Map(openTasks.map((t) => [`${t.storyId}::${t.taskId}`, t]));
    const marked: MarkedTask[] = [];

    const listTasks = T.tool(
      async () =>
        openTasks.length
          ? openTasks
              .map((t) => `- ${t.storyId} / ${t.taskId} [${t.status}] — ${t.title}`)
              .join("\n")
          : "(no open tasks)",
      {
        name: "list_open_tasks",
        description:
          "List technical-story tasks that are not yet done, with their storyId and taskId.",
        schema: z.object({}),
      },
    );

    const markTask = T.tool(
      async (input: { storyId: string; taskId: string }) => {
        const task = taskIndex.get(`${input.storyId}::${input.taskId}`);
        if (!task) return `No open task ${input.taskId} in story ${input.storyId}.`;
        await updateTaskStatus(req.specPath, input.storyId, input.taskId, "done");
        if (!marked.some((m) => m.storyId === input.storyId && m.taskId === input.taskId)) {
          marked.push({ storyId: input.storyId, taskId: input.taskId, title: task.title });
        }
        return `Marked ${input.taskId} as implemented.`;
      },
      {
        name: "mark_task_implemented",
        description:
          "Mark a technical-story task as implemented (done) once the code actually satisfies it. Use storyId + taskId from list_open_tasks.",
        schema: z.object({ storyId: z.string(), taskId: z.string() }),
      },
    );

    const openTaskBlock = openTasks.length
      ? openTasks.map((t) => `- ${t.storyId} / ${t.taskId} [${t.status}] — ${t.title}`).join("\n")
      : "(none decomposed yet)";

    const system = [
      "You are a coding agent embedded directly in the SpecOps code editor.",
      "You implement features and fixes by editing the project's real files, and you keep the technical-story tasks in sync with the code.",
      "",
      "## What you can do",
      "- Read and edit any file in the project with your filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`), rooted at the project root. MAKE the changes — do not just describe them.",
      "- Mark a technical-story task implemented with `mark_task_implemented` once the code genuinely satisfies it (be conservative). Use `list_open_tasks` for ids.",
      "- Delegate large survey / planning passes to your `task` subagents when useful.",
      "",
      "## How to respond",
      "After doing the work, reply in 1–4 sentences: what you changed (cite file paths) and which tasks you marked done. Don't paste whole files back.",
      "",
      ...contextSections(req.artifacts),
      "## Open tasks (candidates to implement / mark done)",
      openTaskBlock,
    ].join("\n");

    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: system,
      backend: await buildBackend(req.specPath),
      tools: [listTasks, markTask],
      subagents: workerSubagents,
    });

    const lcMessages = [
      ...req.history.map((m) =>
        m.role === "user" ? new M.HumanMessage(m.text) : new M.AIMessage(m.text),
      ),
      new M.HumanMessage(req.message),
    ];
    const result = await agent.invoke({ messages: lcMessages });
    return { reply: lastAssistantText(result) || "(no reply)", markedImplemented: marked };
  } catch (err) {
    return {
      reply: "",
      markedImplemented: [],
      error: isAbortError(err) ? "Stopped." : (err as Error).message,
    };
  }
}
