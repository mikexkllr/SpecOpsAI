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

// First http(s) URL a dev server prints, normalized to something a webview can
// load (0.0.0.0 / [::] listen addresses are not navigable).
export function devServerUrlFromOutput(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s'"`)\]]+/);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[.,;]+$/, ""));
    if (u.hostname === "0.0.0.0" || u.hostname === "::" || u.hostname === "[::]") {
      u.hostname = "localhost";
    }
    return u.toString();
  } catch {
    return null;
  }
}

// Port named inside an npm script ("vite --port 3001", "PORT=8080 next dev").
export function scriptPort(script: string | undefined): number | null {
  if (!script) return null;
  const m =
    script.match(/(?:--port|-p)[= ]+(\d{2,5})/) ??
    script.match(/PORT=(\d{2,5})/) ??
    script.match(/localhost:(\d{2,5})/);
  return m ? Number(m[1]) : null;
}

// "US-1.spec.ts" → "US-1"; mirrors the sanitized ids integrationTestRelPath
// writes, so specs found on disk can be matched back to their user story.
export function storyIdFromSpecFilename(name: string): string | undefined {
  const base = name.replace(/\.(spec|test)\.(ts|tsx|js|jsx|md)$/, "");
  return /^[A-Za-z]+-?\d+/.test(base) ? base : undefined;
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
