import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatHistory } from "../shared/api";

// Per-spec chat history lives INSIDE the spec folder, so it is committed and
// shared with collaborators via git — reopening a spec (or pulling a branch)
// replays the conversation that produced its artifacts.
const CHAT_FILE = path.join(".specops", "chats.json");

function chatPath(specPath: string): string {
  return path.join(specPath, CHAT_FILE);
}

// Pre-0.2 builds stored every spec's chats in one app-local file keyed by the
// spec's absolute path. Migrate lazily: first read for a spec lifts its entry
// into the spec folder, where it is shared via git from then on.
function legacyChatsPath(): string {
  return path.join(app.getPath("userData"), "chats.json");
}

function emptyHistory(): ChatHistory {
  return { spec: [], "user-story": [], "technical-story": [], implementation: [] };
}

async function readLegacyChat(specPath: string): Promise<ChatHistory | null> {
  try {
    const raw = await fs.readFile(legacyChatsPath(), "utf8");
    const store = JSON.parse(raw) as Record<string, ChatHistory>;
    return store && typeof store === "object" ? store[specPath] ?? null : null;
  } catch {
    return null;
  }
}

export async function readChat(specPath: string): Promise<ChatHistory> {
  try {
    const raw = await fs.readFile(chatPath(specPath), "utf8");
    const parsed = JSON.parse(raw) as ChatHistory;
    return { ...emptyHistory(), ...parsed };
  } catch {
    // No per-spec file yet — fall back to (and migrate) the legacy global store.
  }
  const legacy = await readLegacyChat(specPath);
  if (legacy) {
    const history = { ...emptyHistory(), ...legacy };
    await writeChat(specPath, history).catch(() => undefined);
    return history;
  }
  return emptyHistory();
}

export async function writeChat(specPath: string, history: ChatHistory): Promise<void> {
  const file = chatPath(specPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(history, null, 2), "utf8");
}
