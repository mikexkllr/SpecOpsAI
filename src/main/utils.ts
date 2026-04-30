import * as path from "node:path";
import type { BaseMessage } from "@langchain/core/messages";

export function projectRoot(specPath: string): string {
  return path.resolve(specPath, "..", "..");
}

export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "AbortError") return true;
  return /\baborted?\b/i.test(e.message ?? "");
}

export function lastAssistantText(result: unknown): string {
  const r = result as { messages?: BaseMessage[] };
  const msgs = r?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const type = (m as { _getType?: () => string })._getType?.() ?? (m as { type?: string }).type;
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
