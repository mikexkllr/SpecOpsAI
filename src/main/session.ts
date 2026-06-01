import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Phase, SessionState } from "../shared/api";

const PHASES: Phase[] = ["spec", "user-story", "technical-story", "implementation"];

function sessionPath(): string {
  return path.join(app.getPath("userData"), "session.json");
}

function sanitize(raw: unknown): SessionState {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Partial<SessionState>;
  const out: SessionState = {};
  if (typeof r.projectPath === "string" && r.projectPath) out.projectPath = r.projectPath;
  if (typeof r.activeSpecId === "string" && r.activeSpecId) out.activeSpecId = r.activeSpecId;
  if (r.phase && PHASES.includes(r.phase)) out.phase = r.phase;
  return out;
}

let cached: SessionState | null = null;

export async function loadSession(): Promise<SessionState> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(sessionPath(), "utf8");
    cached = sanitize(JSON.parse(raw));
  } catch {
    cached = {};
  }
  return cached;
}

export async function saveSession(next: SessionState): Promise<SessionState> {
  const clean = sanitize(next);
  const file = sessionPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(clean, null, 2), "utf8");
  cached = clean;
  return clean;
}
