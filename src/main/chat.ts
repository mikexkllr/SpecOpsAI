import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatHistory } from "../shared/api";

function chatsPath(): string {
  return path.join(app.getPath("userData"), "chats.json");
}

function emptyHistory(): ChatHistory {
  return { spec: [], "user-story": [], "technical-story": [], implementation: [] };
}

type ChatStore = Record<string, ChatHistory>;

let cached: ChatStore | null = null;

async function loadStore(): Promise<ChatStore> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(chatsPath(), "utf8");
    const parsed = JSON.parse(raw) as ChatStore;
    cached = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cached = {};
  }
  return cached;
}

export async function readChat(specPath: string): Promise<ChatHistory> {
  const store = await loadStore();
  return { ...emptyHistory(), ...store[specPath] };
}

export async function writeChat(specPath: string, history: ChatHistory): Promise<void> {
  const store = await loadStore();
  store[specPath] = history;
  const file = chatsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");
}
