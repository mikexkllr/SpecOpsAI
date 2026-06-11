import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProjectContextInfo } from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider, loadSettings } from "./settings";
import { loadDeps } from "./deepagentsDeps";
import { buildProjectBackend } from "./agentCommon";
import { commitPaths } from "./git";
import { exploreSubagent } from "./workerSubagents";

// Project-wide agent context, shared with collaborators via git:
//   <project>/.specops/constitution.md  — user-editable engineering principles
//   <project>/.specops/codebase.md     — generated codebase analysis (brownfield)
const CONTEXT_DIR = ".specops";
const CONSTITUTION_FILE = "constitution.md";
const CODEBASE_FILE = "codebase.md";

// Caps applied when splicing context into prompts, so a sprawling constitution
// or analysis can't crowd out the actual task in large brownfield projects.
const CONSTITUTION_PROMPT_CAP = 6_000;
const CODEBASE_PROMPT_CAP = 10_000;

const DEFAULT_CONSTITUTION = `# Project Constitution

Principles every SpecOps agent (and human) follows in this project. Edit this
file freely — it is injected into every agent prompt. Keep it short and
testable; delete anything that doesn't apply.

## Engineering principles

- Prefer the smallest change that satisfies the acceptance criteria — no
  speculative abstractions, no drive-by refactors.
- Follow the existing conventions of the surrounding code (naming, structure,
  error handling) rather than introducing new patterns.
- Every behavior change needs a test or an explicit note on why not.
- Never break the build: code must typecheck/compile and existing tests must
  still pass after each task.

## Spec principles

- Specs describe user-visible behavior and constraints, never implementation.
- Mark anything uncertain with \`[NEEDS CLARIFICATION: question]\` instead of
  guessing.
- For changes to existing behavior, state the current behavior and the new
  behavior explicitly.
`;

function constitutionPath(root: string): string {
  return path.join(root, CONTEXT_DIR, CONSTITUTION_FILE);
}

function codebasePath(root: string): string {
  return path.join(root, CONTEXT_DIR, CODEBASE_FILE);
}

async function readFileOrEmpty(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
}

// Called when a project is opened: make sure the context dir and a starter
// constitution exist, so the user has something concrete to edit. Returns true
// when the constitution was newly created (callers may want to commit it).
export async function ensureProjectContextFiles(root: string): Promise<boolean> {
  const dir = path.join(root, CONTEXT_DIR);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(constitutionPath(root));
    return false;
  } catch {
    await fs.writeFile(constitutionPath(root), DEFAULT_CONSTITUTION, "utf8");
    return true;
  }
}

export async function readProjectContext(root: string): Promise<ProjectContextInfo> {
  const [constitution, codebase] = await Promise.all([
    readFileOrEmpty(constitutionPath(root)),
    readFileOrEmpty(codebasePath(root)),
  ]);
  let codebaseAnalyzedAt: string | undefined;
  if (codebase) {
    try {
      codebaseAnalyzedAt = (await fs.stat(codebasePath(root))).mtime.toISOString();
    } catch {
      /* file vanished between read and stat — treat as never analyzed */
    }
  }
  return { constitution, codebase, codebaseAnalyzedAt };
}

const ANALYSIS_PROMPT = [
  "You are a codebase analyst. Survey this repository and write a compact onboarding document for AI agents that will write specs and code here.",
  "",
  "## How to work",
  "Use your filesystem tools (`ls`, `glob`, `grep`, `read_file`) rooted at the project root. Read manifests (package.json, pyproject.toml, go.mod, Cargo.toml, …), top-level READMEs, build/CI configs, and skim representative source files. Delegate broad sweeps to the `explore` subagent to keep your own context lean.",
  "Do NOT read generated or vendored directories (node_modules, dist, build, .git).",
  "",
  "## Output",
  `Write the finished document to \`/${CONTEXT_DIR}/${CODEBASE_FILE}\` with \`write_file\` (full file, markdown). Keep it under ~250 lines — dense and factual, no filler. Structure:`,
  "",
  "```",
  "# Codebase Analysis",
  "## Overview        — what the product does, in 2-4 sentences",
  "## Stack           — languages, frameworks, key dependencies, target platforms",
  "## Architecture    — top-level directory map with one line per area; entry points; how the pieces talk to each other",
  "## Conventions     — naming, error handling, state management, testing patterns actually used here (cite real files)",
  "## Commands        — how to build, run, lint, and test (exact commands from the manifests/CI)",
  "## Gotchas         — non-obvious constraints, legacy areas, things an agent would get wrong",
  "```",
  "",
  "Ground every claim in files you actually read — cite paths. If the repository is empty or trivial, say so briefly instead of inventing structure.",
  "Finish with a one-sentence reply confirming the file was written.",
].join("\n");

// One analysis at a time per project — repeated clicks reuse the running pass.
const inFlight = new Map<string, Promise<ProjectContextInfo>>();

export async function analyzeCodebase(root: string): Promise<ProjectContextInfo> {
  const running = inFlight.get(root);
  if (running) return running;
  const task = (async () => {
    await ensureProjectContextFiles(root);
    const cfg = await getActiveProvider();
    const { deepagents, messages: M } = await loadDeps();
    const model = await buildChatModel(cfg);
    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: ANALYSIS_PROMPT,
      backend: await buildProjectBackend(root),
      subagents: [exploreSubagent],
    });
    await agent.invoke({
      messages: [
        new M.HumanMessage(
          `Analyze the repository now and write /${CONTEXT_DIR}/${CODEBASE_FILE}.`,
        ),
      ],
    });
    if ((await loadSettings()).autoCommit !== false) {
      await commitPaths(root, [CONTEXT_DIR], "chore: update codebase analysis");
    }
    return readProjectContext(root);
  })().finally(() => inFlight.delete(root));
  inFlight.set(root, task);
  return task;
}

// Prompt sections injected into every agent's system prompt. Returns [] when
// there is no context yet, so prompts stay clean on fresh projects.
export async function projectContextSections(root: string): Promise<string[]> {
  const ctx = await readProjectContext(root);
  const sections: string[] = [];
  const constitution = cap(ctx.constitution.trim(), CONSTITUTION_PROMPT_CAP);
  const codebase = cap(ctx.codebase.trim(), CODEBASE_PROMPT_CAP);
  if (constitution) {
    sections.push(
      "## Project Constitution (binding — never violate these principles)",
      constitution,
    );
  }
  if (codebase) {
    sections.push(
      `## Codebase Analysis (generated ${ctx.codebaseAnalyzedAt ?? "earlier"} — verify against the real code when in doubt)`,
      codebase,
    );
  }
  return sections;
}

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s;
}
