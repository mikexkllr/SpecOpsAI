import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ArtifactFiles,
  CodingAgentId,
  TaskChunk,
  TechnicalStory,
} from "../shared/api";

/**
 * A GUI Electron app (launched from Finder/dock) inherits a stripped PATH that
 * usually omits user-local install dirs like ~/.local/bin or ~/.npm-global/bin,
 * so `spawn("claude")` fails with ENOENT even when the CLI is installed. Prepend
 * the common locations so the coding-agent binaries resolve regardless of how
 * the app was launched.
 */
function spawnEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extras = [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const current = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const merged = [...extras.filter((p) => !current.includes(p)), ...current];
  return { ...process.env, PATH: merged.join(path.delimiter) };
}

const chunkListeners: Array<(storyId: string, text: string) => void> = [];

export function onCliChunk(cb: (storyId: string, text: string) => void): () => void {
  chunkListeners.push(cb);
  return () => {
    const i = chunkListeners.indexOf(cb);
    if (i >= 0) chunkListeners.splice(i, 1);
  };
}

function emitChunk(storyId: string, text: string): void {
  for (const cb of chunkListeners) cb(storyId, text);
}

/**
 * Push a status line into a story's live terminal stream (e.g. "reviewing
 * changes…") without it becoming part of the captured CLI output. Lets callers
 * like runWorkerTask give the UI feedback between the CLI and reviewer phases.
 */
export function emitWorkerStatus(storyId: string, text: string): void {
  emitChunk(storyId, text);
}

export interface CliAgentOptions {
  agentId: CodingAgentId;
  cwd: string;
  storyId: string;
  prompt: string;
  yolo: boolean;
  signal?: AbortSignal;
}

export async function runCliAgent(opts: CliAgentOptions): Promise<string> {
  const { agentId, cwd, storyId, prompt, yolo, signal } = opts;

  let cmd: string;
  let args: string[];
  let stdinPrompt: string | null;

  switch (agentId) {
    case "claude-code":
      cmd = "claude";
      args = yolo
        ? ["--print", "--dangerously-skip-permissions"]
        : ["--print"];
      stdinPrompt = prompt;
      break;
    case "gh-copilot":
      cmd = "gh";
      args = ["copilot", "suggest", "-t", "shell", prompt];
      stdinPrompt = null;
      break;
    case "codex":
      cmd = "codex";
      args = yolo ? ["--quiet", "--no-confirm"] : ["--quiet"];
      stdinPrompt = prompt;
      break;
    case "antigravity":
      // Google Antigravity CLI — prompt via stdin
      cmd = "antigravity";
      args = ["--print"];
      stdinPrompt = prompt;
      break;
    default:
      throw new Error(`Unknown CLI agent: ${agentId}`);
  }

  return new Promise<string>((resolve, reject) => {
    // Guard so a spawn failure (e.g. ENOENT when the binary isn't installed)
    // can only settle the promise once, even if both the stdin stream and the
    // child process emit 'error'.
    let settled = false;
    const settleResolve = (val: string): void => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const settleReject = (err: Error): void => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    // Tell the UI immediately that the agent is launching, so the run doesn't
    // look idle while a buffered CLI (e.g. `claude --print`) thinks.
    emitChunk(storyId, `▶ ${agentId} starting…\n`);

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(cmd, args, { cwd, env: spawnEnv() });
    } catch (err) {
      const message = (err as Error).message;
      emitChunk(storyId, `\n[error] could not start '${cmd}': ${message}\n`);
      settleReject(new Error(`Failed to start CLI agent '${cmd}': ${message}`));
      return;
    }

    // The child can fail asynchronously (ENOENT) — surface it as a clean
    // rejection plus a visible terminal line instead of an unhandled error.
    proc.on("error", (err) => {
      emitChunk(storyId, `\n[error] failed to start '${cmd}': ${err.message}\n`);
      settleReject(new Error(`Failed to start CLI agent '${cmd}': ${err.message}`));
    });

    // Writing the prompt before the 'error' event fires can emit EPIPE on stdin
    // for a process that never spawned — swallow it; proc 'error' is the source
    // of truth.
    proc.stdin?.on("error", () => {
      /* surfaced via proc 'error' */
    });
    if (stdinPrompt !== null) {
      try {
        proc.stdin?.write(stdinPrompt);
      } catch {
        /* surfaced via proc 'error' */
      }
    }
    try {
      proc.stdin?.end();
    } catch {
      /* surfaced via proc 'error' */
    }

    let output = "";

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      emitChunk(storyId, text);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      emitChunk(storyId, text);
    });

    proc.on("close", (code) => {
      if (code !== 0 && !output.trim()) {
        settleReject(new Error(`CLI agent exited with code ${code}`));
        return;
      }
      const result = output || "(no output)";
      settleResolve(code !== 0 ? result + `\n[exited with code ${code}]` : result);
    });

    signal?.addEventListener("abort", () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // process may have already exited
      }
      const killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already exited */ }
      }, 5000);
      proc.once("close", () => clearTimeout(killTimer));
      const err = new Error("AbortError");
      err.name = "AbortError";
      settleReject(err);
    });
  });
}

export function buildCliTaskPrompt(
  task: TaskChunk,
  story: TechnicalStory,
  artifacts: ArtifactFiles,
): string {
  const sections: string[] = [
    `Implement task ${task.id} — "${task.title}" — which is part of technical story ${story.id}.`,
    "",
    `## Story: ${story.id} — ${story.title}`,
    story.body.trim(),
    "",
    "## Task to implement",
    `**ID**: ${task.id}`,
    `**Title**: ${task.title}`,
    task.description ? `**Acceptance criteria**: ${task.description}` : "",
    "",
    "## Context from earlier phases",
  ];

  if (artifacts.spec.trim()) {
    sections.push("### Spec", artifacts.spec.trim(), "");
  }
  if (artifacts.technicalStories.trim()) {
    sections.push("### Technical Stories", artifacts.technicalStories.trim(), "");
  }

  sections.push(
    "Read the relevant source files to understand existing patterns, then make the necessary changes to implement this task.",
    "Focus on this task only. When done, briefly describe what you changed.",
  );

  return sections.join("\n");
}
