import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type * as DeepAgents from "deepagents";
import type {
  ArtifactFiles,
  CodeReviewReport,
  CodeReviewRequest,
  CodeReviewResult,
  FileChangeStatus,
  FileReview,
  GenerateCodeReviewRequest,
  MarkedTask,
  ReviewVerdict,
  TaskChunk,
  TechnicalStory,
} from "../shared/api";

type BackendFactory = NonNullable<DeepAgents.CreateDeepAgentParams["backend"]>;
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import { loadDeps, createFsBackend } from "./deepagentsDeps";
import { makeBrowserTools, closeBrowser } from "./browserTools";
import { readWorkers, updateTaskStatus } from "./worker";
import { projectRoot, isAbortError, lastAssistantText } from "./utils";

const execFileAsync = promisify(execFile);

export interface ReviewerOptions {
  specPath: string;
  story: TechnicalStory;
  task: TaskChunk;
  artifacts: ArtifactFiles;
  devServerUrl?: string;
  signal?: AbortSignal;
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  summary: string;
}

function reviewSystemPrompt(
  story: TechnicalStory,
  task: TaskChunk,
  artifacts: ArtifactFiles,
  devServerUrl: string | undefined,
): string {
  const browserHint = devServerUrl
    ? `A dev server may be running at: ${devServerUrl}. Use browser tools to verify the feature works if it makes sense for this task.`
    : "No dev server URL is configured — try discovering one from package.json scripts (e.g. look for a 'dev' script and its port). Use browser verification when it would meaningfully confirm the feature works.";

  return [
    "You are a senior code reviewer. A CLI coding agent just implemented a task.",
    "Your job is to review the changes for correctness, spec alignment, and quality.",
    "",
    "## Review process",
    "1. Call `git_diff` to see what changed.",
    "2. Use filesystem tools (read_file, glob, grep) to read relevant source files for full context.",
    "3. Check: does the implementation satisfy the task acceptance criteria?",
    "4. Check: any obvious bugs, missing edge cases, or spec violations?",
    "5. " + browserHint,
    "6. Call `emit_review` exactly once with your verdict and a concise summary (3–8 sentences).",
    "",
    "## Verdict guide",
    '"approved": the implementation correctly satisfies the task with no blocking issues.',
    '"changes-requested": there are bugs, missing requirements, or the implementation clearly diverges from the spec.',
    "",
    "## Context",
    "",
    "### Spec",
    artifacts.spec.trim() || "(none)",
    "",
    "### User Stories",
    artifacts.userStories.trim() || "(none)",
    "",
    `### Story: ${story.id} — ${story.title}`,
    story.body || "(no body)",
    "",
    `### Task: ${task.id} — ${task.title}`,
    task.description || "(no description)",
  ].join("\n");
}

async function buildReviewerBackend(root: string): Promise<BackendFactory> {
  const { deepagents } = await loadDeps();
  const { CompositeBackend, StateBackend } = deepagents;
  const fsBackend = createFsBackend(deepagents, { rootDir: root, virtualMode: true });
  return (runtime) =>
    new CompositeBackend(fsBackend, {
      "/conversation_history": new StateBackend(runtime),
      "/large_tool_results": new StateBackend(runtime),
    });
}

export async function runReviewerAgent(opts: ReviewerOptions): Promise<ReviewResult> {
  const { specPath, story, task, artifacts, devServerUrl, signal } = opts;
  const root = projectRoot(specPath);
  const browserHelper = makeBrowserTools();

  try {
    const cfg = await getActiveProvider();
    const { deepagents, messages: M, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);

    let captured: { verdict: ReviewVerdict; summary: string } | null = null;

    const gitDiffTool = T.tool(
      async () => {
        try {
          const { stdout } = await execFileAsync("git", ["diff", "HEAD"], { cwd: root });
          if (stdout.trim()) return stdout.trim();
          // Nothing staged yet — show diff of last commit
          const { stdout: prev } = await execFileAsync("git", ["diff", "HEAD~1", "HEAD"], { cwd: root });
          return prev.trim() || "(no diff found)";
        } catch (err) {
          return `Could not run git diff: ${(err as Error).message}`;
        }
      },
      {
        name: "git_diff",
        description:
          "Return the git diff of recent changes in the project — what the coding agent just modified. Call this first.",
        schema: z.object({}),
      },
    );

    const emitReview = T.tool(
      async (input: { verdict: ReviewVerdict; summary: string }) => {
        captured = input;
        return "Review captured.";
      },
      {
        name: "emit_review",
        description: "Submit your review verdict and summary. Call exactly once when you are done reviewing.",
        schema: z.object({
          verdict: z
            .enum(["approved", "changes-requested"])
            .describe('"approved" or "changes-requested"'),
          summary: z.string().describe("Concise review summary (3–8 sentences)"),
        }),
      },
    );

    const browserTools = await browserHelper.buildTools();
    const backend = await buildReviewerBackend(root);

    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: reviewSystemPrompt(story, task, artifacts, devServerUrl),
      tools: [gitDiffTool, emitReview, ...browserTools],
      backend,
    });

    await agent.invoke(
      {
        messages: [
          new M.HumanMessage(
            `Review the implementation of task ${task.id} ("${task.title}"). Start by calling git_diff, then review the changes, then call emit_review.`,
          ),
        ],
      },
      { signal },
    );

    return captured ?? { verdict: "changes-requested", summary: "(Reviewer did not emit a verdict.)" };
  } catch (err) {
    if (isAbortError(err)) {
      return { verdict: "changes-requested", summary: "(Review stopped by user.)" };
    }
    return { verdict: "changes-requested", summary: `Review error: ${(err as Error).message}` };
  } finally {
    await closeBrowser();
  }
}

// ---------------------------------------------------------------------------
// Code Studio — a custom coding agent that reviews the branch's work.
//
// generateCodeReview produces a GitHub / Devin-style review: a structured,
// per-file description of the changes (the agent describing its own work),
// grounded in the spec, user stories and technical stories. It can also mark a
// technical-story task as implemented on its own when the diff satisfies it.
//
// runCodeReview is the follow-up Q&A: the developer asks questions about that
// review and the agent answers in markdown, with the report for context.

async function readWorkingTreeDiff(root: string): Promise<string> {
  try {
    const { stdout: diff } = await execFileAsync("git", ["diff", "HEAD"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    // `git diff` omits brand-new files (they're untracked), but those are often
    // the most important part of a changeset — list them so the agent reads them.
    const { stdout: untracked } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: root },
    );
    const parts: string[] = [];
    if (diff.trim()) parts.push(diff.trim());
    if (untracked.trim()) {
      parts.push(
        "## Untracked (new) files — not shown in the diff above; read them directly:\n" +
          untracked.trim(),
      );
    }
    return parts.length ? parts.join("\n\n") : "(working tree clean — no uncommitted changes)";
  } catch (err) {
    return `Could not run git diff: ${(err as Error).message}`;
  }
}

function specContextSections(artifacts: ArtifactFiles): string[] {
  const out: string[] = [];
  if (artifacts.spec.trim()) out.push("## Spec", artifacts.spec.trim(), "");
  if (artifacts.userStories.trim())
    out.push("## User Stories", artifacts.userStories.trim(), "");
  if (artifacts.technicalStories.trim())
    out.push("## Technical Stories", artifacts.technicalStories.trim(), "");
  return out;
}

function normalizeStatus(raw: unknown): FileChangeStatus {
  return raw === "added" || raw === "deleted" || raw === "renamed" ? raw : "modified";
}

export async function generateCodeReview(
  req: GenerateCodeReviewRequest,
): Promise<CodeReviewReport> {
  const root = projectRoot(req.specPath);
  const empty: CodeReviewReport = { overview: "", files: [], markedImplemented: [] };
  try {
    const cfg = await getActiveProvider();
    const { deepagents, messages: M, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);

    // Snapshot of every open (not-yet-done) task, so the agent knows what it is
    // allowed to mark implemented and by which id.
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

    let captured: CodeReviewReport | null = null;

    const listTasks = T.tool(
      async () =>
        openTasks.length
          ? openTasks
              .map((t) => `- ${t.storyId} / ${t.taskId} [${t.status}] — ${t.title}`)
              .join("\n")
          : "(no open tasks — nothing to mark)",
      {
        name: "list_open_tasks",
        description:
          "List technical-story tasks that are not yet done, with their storyId and taskId — the candidates you may mark implemented.",
        schema: z.object({}),
      },
    );

    const markTask = T.tool(
      async (input: { storyId: string; taskId: string }) => {
        const key = `${input.storyId}::${input.taskId}`;
        const task = taskIndex.get(key);
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
          "Mark a technical-story task as implemented (done) when the changes clearly satisfy it. Use storyId + taskId from list_open_tasks.",
        schema: z.object({ storyId: z.string(), taskId: z.string() }),
      },
    );

    const emitReview = T.tool(
      async (input: {
        overview: string;
        files: Array<{ path: string; status?: string; summary: string }>;
      }) => {
        captured = {
          overview: input.overview,
          files: input.files.map((f) => ({
            path: f.path,
            status: normalizeStatus(f.status),
            summary: f.summary,
          })),
          markedImplemented: [],
        };
        return "Review captured.";
      },
      {
        name: "emit_review",
        description:
          "Submit the finished review. Call exactly once: an overall `overview`, then one `files` entry per changed file describing what you changed and why.",
        schema: z.object({
          overview: z.string().describe("Overall summary of the changeset (2–5 sentences)."),
          files: z
            .array(
              z.object({
                path: z.string().describe("Repo-relative path of the changed file."),
                status: z
                  .enum(["added", "modified", "deleted", "renamed"])
                  .optional(),
                summary: z
                  .string()
                  .describe("What changed in this file and why, in your own words."),
              }),
            )
            .describe("One entry per changed file."),
        }),
      },
    );

    const system = [
      "You are a custom coding agent reviewing the work on the current branch — like a GitHub pull-request author writing a self-review, in the style of Devin's code reviews.",
      "You have full access to the project's Spec, User Stories, and Technical Stories below, plus the working-tree diff and the source tree.",
      "",
      "## Your job",
      "1. Call `git_diff` to see the uncommitted changes.",
      "2. Read the relevant files with your filesystem tools to understand the changes in context.",
      "3. Call `list_open_tasks` to see which technical-story tasks are still open.",
      "4. For every task the diff clearly and fully implements, call `mark_task_implemented`. Be conservative — only mark what the code actually does.",
      "5. Call `emit_review` exactly once: an `overview` of the whole changeset, then a per-file `summary` describing — in your own words — what you changed in that file and why it aligns with the spec/stories. Flag anything risky or incomplete in the relevant file summary.",
      "",
      "Describe the changes as the author who made them. Be concrete; reference symbols and behavior. Do not invent files that aren't in the diff.",
      "",
      ...specContextSections(req.artifacts),
    ].join("\n");

    const gitDiffTool = T.tool(() => readWorkingTreeDiff(root), {
      name: "git_diff",
      description: "Return the diff of uncommitted changes in the working tree.",
      schema: z.object({}),
    });

    const backend = await buildReviewerBackend(root);
    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: system,
      tools: [gitDiffTool, listTasks, markTask, emitReview],
      backend,
    });

    await agent.invoke({
      messages: [
        new M.HumanMessage(
          "Review the current changes now: inspect the diff, mark any fully-implemented tasks, then call emit_review.",
        ),
      ],
    });

    const report = (captured as CodeReviewReport | null) ?? empty;
    return { ...report, markedImplemented: marked };
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
}

function qaSystemPrompt(req: CodeReviewRequest): string {
  const sections: string[] = [
    "You are a custom coding agent answering the developer's questions about a code review you just produced.",
    "You have access to the Spec, User Stories, Technical Stories, the review report, the working-tree diff (`git_diff`), and filesystem read tools.",
    "Answer concisely in markdown, citing file paths and short code excerpts where useful. Read the real source before claiming anything about it.",
  ];
  if (req.focusPath) {
    sections.push("", `The developer is currently viewing \`${req.focusPath}\`.`);
  }
  if (req.report) {
    sections.push(
      "",
      "## The review you produced",
      req.report.overview.trim() || "(no overview)",
      ...req.report.files.map((f) => `- \`${f.path}\` (${f.status}): ${f.summary}`),
    );
    if (req.report.markedImplemented.length) {
      sections.push(
        "",
        "Tasks you marked implemented: " +
          req.report.markedImplemented.map((m) => m.taskId).join(", "),
      );
    }
  }
  const ctx = specContextSections(req.artifacts);
  if (ctx.length) sections.push("", ...ctx);
  return sections.join("\n");
}

export async function runCodeReview(req: CodeReviewRequest): Promise<CodeReviewResult> {
  const root = projectRoot(req.specPath);
  try {
    const cfg = await getActiveProvider();
    const { deepagents, messages: M, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);

    const gitDiffTool = T.tool(() => readWorkingTreeDiff(root), {
      name: "git_diff",
      description: "Return the diff of uncommitted changes in the working tree.",
      schema: z.object({}),
    });

    const backend = await buildReviewerBackend(root);
    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: qaSystemPrompt(req),
      tools: [gitDiffTool],
      backend,
    });

    const lcMessages = [
      ...req.history.map((m) =>
        m.role === "user" ? new M.HumanMessage(m.text) : new M.AIMessage(m.text),
      ),
      new M.HumanMessage(req.instruction),
    ];
    const result = await agent.invoke({ messages: lcMessages });
    return { markdown: lastAssistantText(result) || "(no response)" };
  } catch (err) {
    return {
      markdown: "",
      error: isAbortError(err) ? "Review stopped." : (err as Error).message,
    };
  }
}
