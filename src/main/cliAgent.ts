import { spawn } from "node:child_process";
import type {
  ArtifactFiles,
  CodingAgentId,
  TaskChunk,
  TechnicalStory,
} from "../shared/api";

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
    const proc = spawn(cmd, args, { cwd, env: { ...process.env } });

    if (stdinPrompt !== null) {
      proc.stdin?.write(stdinPrompt);
    }
    proc.stdin?.end();

    let output = "";

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      emitChunk(storyId, text);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      emitChunk(storyId, text);
    });

    proc.on("close", (code) => {
      if (code !== 0 && !output.trim()) {
        reject(new Error(`CLI agent exited with code ${code}`));
        return;
      }
      const result = output || "(no output)";
      resolve(code !== 0 ? result + `\n[exited with code ${code}]` : result);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start CLI agent '${cmd}': ${err.message}`));
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
      reject(err);
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
