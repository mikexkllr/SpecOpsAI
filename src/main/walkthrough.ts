import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type {
  CodeWalkthrough,
  GenerateWalkthroughRequest,
  WalkthroughStep,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import { loadDeps } from "./deepagentsDeps";
import { buildProjectBackend } from "./agentCommon";
import { projectContextSections } from "./projectContext";
import { projectRoot, isAbortError } from "./utils";

const execFileAsync = promisify(execFile);

const WALKTHROUGH_FILE = path.join(".specops", "walkthrough.json");

// ---------------------------------------------------------------------------
// Code walkthrough — after the workers generate code, this agent produces a
// guided, ordered tour of the changes: for each stop, a file region plus a
// plain-language explanation of what the code does and why. The result is
// persisted per spec so the tour can be replayed after a restart.

export async function readWalkthrough(specPath: string): Promise<CodeWalkthrough | null> {
  try {
    const raw = await fs.readFile(path.join(specPath, WALKTHROUGH_FILE), "utf8");
    const parsed = JSON.parse(raw) as CodeWalkthrough;
    return parsed && typeof parsed === "object" && Array.isArray(parsed.steps)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function saveWalkthrough(specPath: string, wt: CodeWalkthrough): Promise<void> {
  const file = path.join(specPath, WALKTHROUGH_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(wt, null, 2), "utf8");
}

// The interesting changeset is everything the spec branch did: committed work
// (auto-commit runs after every task) plus whatever is still uncommitted.
async function branchDiff(root: string): Promise<string> {
  const parts: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "main...HEAD"],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout.trim()) parts.push("## Committed on this branch (vs main)\n" + stdout.trim());
  } catch {
    // no main branch (or not a repo) — fall through to working-tree diff
  }
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout.trim()) parts.push("## Uncommitted changes\n" + stdout.trim());
    const { stdout: untracked } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: root },
    );
    if (untracked.trim()) {
      parts.push(
        "## Untracked (new) files — not shown above; read them directly:\n" +
          untracked.trim(),
      );
    }
  } catch (err) {
    parts.push(`Could not run git diff: ${(err as Error).message}`);
  }
  return parts.length
    ? parts.join("\n\n")
    : "(no diff found — walk through the project's main source files instead)";
}

function normalizeStep(raw: {
  title: string;
  file: string;
  startLine?: number;
  endLine?: number;
  explanation: string;
}): WalkthroughStep {
  const file = raw.file.replace(/\\/g, "/").replace(/^\.?\//, "");
  let start = typeof raw.startLine === "number" ? Math.max(1, Math.floor(raw.startLine)) : undefined;
  let end = typeof raw.endLine === "number" ? Math.max(1, Math.floor(raw.endLine)) : undefined;
  if (start !== undefined && end !== undefined && end < start) [start, end] = [end, start];
  return {
    title: raw.title.trim() || file,
    file,
    startLine: start,
    endLine: end,
    explanation: raw.explanation,
  };
}

function walkthroughSystemPrompt(
  req: GenerateWalkthroughRequest,
  ctx: string[],
): string {
  return [
    "You are a senior engineer giving a colleague a guided walkthrough of code that was just generated for this project.",
    "Your audience read the spec but has NOT read the code. Walk them through it the way you would at a whiteboard: orientation first, then the flow of the feature, file by file.",
    "",
    "## Process",
    "1. Call `git_diff` to see everything this branch changed.",
    "2. Read the changed files with your filesystem tools. Verify every line range you cite by actually reading the file — never guess line numbers.",
    "3. Call `emit_walkthrough` exactly once with the finished tour.",
    "",
    "## What a good walkthrough looks like",
    "- 4–10 steps, ordered as a story: entry point / data model first, then the main flow, then supporting pieces (tests, config) last.",
    "- Each step points at ONE file and, when it helps, a focused 1-based inclusive line range (the function or block being discussed — not the whole file unless it is short).",
    "- Each explanation is 2–6 sentences of markdown: what this code does, why it is designed this way, and how it connects to the spec / stories and to the previous step. Mention key symbols in backticks.",
    "- The `intro` is 2–4 sentences: what was built and the shape of the solution.",
    "- Do not invent files or ranges that are not in the project.",
    req.focus ? `\nPay special attention to: ${req.focus}` : "",
    "",
    ...ctx,
    "",
    "## Project context",
    req.artifacts.spec.trim() ? `### Spec\n${req.artifacts.spec.trim()}` : "",
    req.artifacts.userStories.trim()
      ? `### User Stories\n${req.artifacts.userStories.trim()}`
      : "",
    req.artifacts.technicalStories.trim()
      ? `### Technical Stories\n${req.artifacts.technicalStories.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateWalkthrough(
  req: GenerateWalkthroughRequest,
): Promise<CodeWalkthrough> {
  const root = projectRoot(req.specPath);
  const empty: CodeWalkthrough = {
    title: "",
    intro: "",
    steps: [],
    generatedAt: new Date().toISOString(),
  };
  try {
    const cfg = await getActiveProvider();
    const { deepagents, messages: M, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);

    let captured: CodeWalkthrough | null = null;

    const gitDiffTool = T.tool(() => branchDiff(root), {
      name: "git_diff",
      description:
        "Return everything this spec branch changed: the diff vs main, uncommitted changes, and untracked files. Call this first.",
      schema: z.object({}),
    });

    const emitWalkthrough = T.tool(
      async (input: {
        title: string;
        intro: string;
        steps: Array<{
          title: string;
          file: string;
          startLine?: number;
          endLine?: number;
          explanation: string;
        }>;
      }) => {
        captured = {
          title: input.title.trim() || "Code walkthrough",
          intro: input.intro,
          steps: input.steps.map(normalizeStep).filter((s) => s.file),
          generatedAt: new Date().toISOString(),
        };
        return "Walkthrough captured.";
      },
      {
        name: "emit_walkthrough",
        description:
          "Submit the finished walkthrough. Call exactly once: a short `title`, a markdown `intro`, and 4–10 ordered `steps` (file + optional 1-based inclusive line range + markdown explanation).",
        schema: z.object({
          title: z.string().describe("Short tour title, e.g. 'Kanban board walkthrough'."),
          intro: z
            .string()
            .describe("2–4 sentence markdown orientation shown before step 1."),
          steps: z
            .array(
              z.object({
                title: z.string().describe("Short step title, e.g. 'The board state model'."),
                file: z.string().describe("Repo-relative path of the file this step discusses."),
                startLine: z
                  .number()
                  .optional()
                  .describe("1-based first line of the focused region (verify by reading the file)."),
                endLine: z
                  .number()
                  .optional()
                  .describe("1-based last line (inclusive) of the focused region."),
                explanation: z
                  .string()
                  .describe("2–6 sentences of markdown: what the code does, why, and how it connects."),
              }),
            )
            .min(1)
            .describe("Ordered tour steps."),
        }),
      },
    );

    const backend = await buildProjectBackend(root);
    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: walkthroughSystemPrompt(req, await projectContextSections(root)),
      tools: [gitDiffTool, emitWalkthrough],
      backend,
    });

    await agent.invoke({
      messages: [
        new M.HumanMessage(
          "Generate the code walkthrough now: call git_diff, read the changed files to verify line ranges, then call emit_walkthrough.",
        ),
      ],
    });

    const result = (captured as CodeWalkthrough | null) ?? {
      ...empty,
      error: "The agent did not emit a walkthrough — try again.",
    };
    if (!result.error) await saveWalkthrough(req.specPath, result);
    return result;
  } catch (err) {
    return {
      ...empty,
      error: isAbortError(err) ? "Walkthrough generation stopped." : (err as Error).message,
    };
  }
}
