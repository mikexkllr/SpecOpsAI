import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type * as DeepAgents from "deepagents";
import type { ArtifactFiles, ReviewVerdict, TaskChunk, TechnicalStory } from "../shared/api";

type BackendFactory = NonNullable<DeepAgents.CreateDeepAgentParams["backend"]>;
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import { loadDeps } from "./deepagentsDeps";
import { makeBrowserTools, closeBrowser } from "./browserTools";
import { projectRoot, isAbortError } from "./utils";

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
  const { CompositeBackend, FilesystemBackend, StateBackend } = deepagents;
  const fsBackend = new FilesystemBackend({ rootDir: root, virtualMode: true });
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
