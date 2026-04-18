import { exec, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type * as DeepAgents from "deepagents";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type {
  ArtifactFiles,
  TestLoopIteration,
  TestLoopRequest,
  TestLoopState,
  TestLoopStatus,
  TestLoopVerdict,
  TestRunResult,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";

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

const DEFAULT_MAX_ITERATIONS = 5;
const TEST_TIMEOUT_MS = 120_000;

let currentState: TestLoopState = {
  status: "idle",
  iterations: [],
  maxIterations: DEFAULT_MAX_ITERATIONS,
};

let stopRequested = false;
let listener: ((state: TestLoopState) => void) | null = null;
let activeAbortController: AbortController | null = null;
let activeChildProcess: ChildProcess | null = null;

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "AbortError") return true;
  return /\baborted?\b/i.test(e.message ?? "");
}

function emit(): void {
  listener?.(currentState);
}

function setState(patch: Partial<TestLoopState>): void {
  currentState = { ...currentState, ...patch };
  emit();
}

function setStatus(status: TestLoopStatus): void {
  setState({ status });
}

export function getTestLoopState(): TestLoopState {
  return currentState;
}

export function onTestLoopUpdate(cb: (state: TestLoopState) => void): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}

export function stopTestLoop(): void {
  stopRequested = true;
  activeAbortController?.abort();
  if (activeChildProcess && activeChildProcess.exitCode === null) {
    try {
      activeChildProcess.kill("SIGTERM");
    } catch {
      // ignore — process may have already exited
    }
  }
  const s = currentState.status;
  if (s === "running-tests" || s === "analyzing" || s === "fixing") {
    setStatus("stopped");
  }
}

function projectRoot(specPath: string): string {
  return path.resolve(specPath, "..", "..");
}

async function discoverTestFiles(specPath: string): Promise<string[]> {
  const out: string[] = [];
  try {
    await collect(path.join(projectRoot(specPath), "tests"), out);
  } catch {
    /* tests/ may not exist yet */
  }
  return out;
}

async function collect(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collect(full, out);
    } else if (
      /\.(test|spec)\.(ts|tsx|js|jsx|md)$/.test(e.name) ||
      /_test\.dart$/.test(e.name) ||
      /UITests\.swift$/.test(e.name) ||
      /Test\.kt$/.test(e.name)
    ) {
      out.push(full);
    }
  }
}

function runCommand(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = exec(
      cmd,
      { cwd, timeout: TEST_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) {
          const raw = (err as NodeJS.ErrnoException & { code?: number | string })
            .code;
          code = typeof raw === "number" ? raw : 1;
        }
        if (activeChildProcess === child) activeChildProcess = null;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
    activeChildProcess = child;
  });
}

interface TestInvocation {
  cmd: string;
  skipReason?: string;
}

function testCommand(file: string, root: string): TestInvocation {
  const rel = path.relative(root, file);
  if (file.endsWith(".spec.ts") || file.endsWith(".spec.tsx")) {
    return { cmd: `npx --yes playwright test "${rel}" --reporter=line` };
  }
  if (/\.test\.(ts|tsx|js|jsx)$/.test(file)) {
    return {
      cmd: `npx --yes vitest run "${rel}" 2>&1 || npx --yes jest "${rel}" --no-coverage --forceExit 2>&1`,
    };
  }
  if (file.endsWith("_test.dart")) {
    return { cmd: `flutter test "${rel}"` };
  }
  if (file.endsWith("UITests.swift")) {
    return {
      cmd: "",
      skipReason:
        "(XCUITest — requires Xcode + simulator; open the iOS project and run this target.)",
    };
  }
  if (file.endsWith("Test.kt")) {
    return {
      cmd: "",
      skipReason:
        "(Espresso — requires the Android SDK + emulator; run `./gradlew connectedAndroidTest` from the Android project.)",
    };
  }
  return { cmd: "", skipReason: "(documentation spec — skipped)" };
}

async function runTests(specPath: string): Promise<TestRunResult[]> {
  const root = projectRoot(specPath);
  const files = await discoverTestFiles(specPath);
  const results: TestRunResult[] = [];
  for (const file of files) {
    const invocation = testCommand(file, root);
    const rel = path.relative(root, file);
    if (!invocation.cmd) {
      results.push({
        file: rel,
        passed: true,
        stdout: invocation.skipReason ?? "(skipped)",
        stderr: "",
        duration: 0,
      });
      continue;
    }
    const start = Date.now();
    const { stdout, stderr, code } = await runCommand(invocation.cmd, root);
    results.push({
      file: rel,
      passed: code === 0,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-2000),
      duration: Date.now() - start,
    });
  }
  return results;
}

function lastAssistantText(result: unknown): string {
  const r = result as { messages?: BaseMessage[] };
  const msgs = r?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const type =
      (m as { _getType?: () => string })._getType?.() ?? (m as { type?: string }).type;
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

function fixSystemPrompt(artifacts: ArtifactFiles, failures: TestRunResult[]): string {
  const failureBlock = failures
    .map(
      (f) =>
        `### ${f.file}\n\`\`\`\n${(f.stderr || f.stdout).slice(-1500)}\n\`\`\``,
    )
    .join("\n\n");

  return [
    "You are a test-fix agent in the SpecOps AI autonomous test loop.",
    "Analyze the failing tests below and decide whether to FIX THE CODE or CORRECT THE TEST, then apply the fix using your filesystem tools.",
    "",
    "## Decision rules",
    "- If the test expectation matches the documented behavior in the Spec / User Stories, the CODE is wrong — fix the code.",
    "- If the test asserts behavior that contradicts the Spec / User Stories (wrong selector, stale assumption, wrong assertion), the TEST is wrong — fix the test.",
    "- Prefer the smallest, most targeted change.",
    "",
    "## Workflow",
    "1. Call the `verdict` tool exactly once with your decision and a one-sentence rationale.",
    "2. Use ls / read_file / edit_file / write_file to apply the fix.",
    "3. Reply with one or two sentences summarizing what you changed.",
    "",
    "## Project context",
    artifacts.spec.trim() ? `### Spec\n${artifacts.spec.trim()}` : "",
    artifacts.userStories.trim() ? `### User Stories\n${artifacts.userStories.trim()}` : "",
    "",
    "## Failing tests",
    failureBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runFixAgent(
  specPath: string,
  artifacts: ArtifactFiles,
  failures: TestRunResult[],
  signal: AbortSignal,
): Promise<{ verdict: TestLoopVerdict; summary: string }> {
  const { tool } = await loadTools();
  const { HumanMessage } = await loadMessages();
  const {
    createDeepAgent,
    CompositeBackend,
    FilesystemBackend,
    StateBackend,
  } = await loadDeepagents();

  let captured: TestLoopVerdict = "fix-code";

  const verdictTool = tool(
    async (input: { verdict: TestLoopVerdict; rationale: string }) => {
      captured = input.verdict === "fix-test" ? "fix-test" : "fix-code";
      return `Verdict: ${captured}. Rationale: ${input.rationale}`;
    },
    {
      name: "verdict",
      description:
        "Declare whether to fix the source code or correct the test. Must be called exactly once before applying the fix.",
      schema: z.object({
        verdict: z.enum(["fix-code", "fix-test"]),
        rationale: z.string(),
      }),
    },
  );

  const cfg = await getActiveProvider();
  const model = await buildChatModel(cfg);
  const fsBackend = new FilesystemBackend({
    rootDir: projectRoot(specPath),
    virtualMode: true,
  });
  const agent = createDeepAgent({
    model,
    systemPrompt: fixSystemPrompt(artifacts, failures),
    tools: [verdictTool],
    backend: (runtime) =>
      new CompositeBackend(fsBackend, {
        "/conversation_history": new StateBackend(runtime),
        "/large_tool_results": new StateBackend(runtime),
      }),
  });

  const result = await agent.invoke(
    {
      messages: [
        new HumanMessage(
          `Analyze the ${failures.length} failing test(s), call verdict, then apply the fix.`,
        ),
      ],
    },
    { signal },
  );

  return { verdict: captured, summary: lastAssistantText(result) || "(no summary)" };
}

export async function startTestLoop(req: TestLoopRequest): Promise<void> {
  const maxIter = req.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  stopRequested = false;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  setState({
    status: "running-tests",
    iterations: [],
    maxIterations: maxIter,
    error: undefined,
  });

  try {
    for (let i = 1; i <= maxIter; i++) {
      if (stopRequested) return;

      setStatus("running-tests");
      const results = await runTests(req.specPath);
      const failures = results.filter((r) => !r.passed);

      const iteration: TestLoopIteration = {
        iteration: i,
        results,
        failures: failures.length,
      };

      if (failures.length === 0) {
        setState({
          status: "passed",
          iterations: [...currentState.iterations, iteration],
        });
        return;
      }

      if (stopRequested) {
        setState({ iterations: [...currentState.iterations, iteration] });
        return;
      }

      setStatus("analyzing");
      const { verdict, summary } = await runFixAgent(
        req.specPath,
        req.artifacts,
        failures,
        signal,
      );
      iteration.verdict = verdict;
      iteration.agentSummary = summary;

      setState({
        status: "fixing",
        iterations: [...currentState.iterations, iteration],
      });

      if (stopRequested) return;
    }

    setStatus("max-iterations");
  } catch (err) {
    if (isAbortError(err) || stopRequested) {
      setStatus("stopped");
    } else {
      setState({ status: "error", error: (err as Error).message });
    }
  } finally {
    activeAbortController = null;
    activeChildProcess = null;
  }
}
