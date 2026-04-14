import { marked, type Tokens } from "marked";
import type { TechnicalStory } from "../shared/api";

const TS_ID_RE = /\bTS[-\s]?(\d+)\b/i;

function extractTitle(heading: string, body: string): string {
  const cleaned = heading.replace(/^\s*ID[:.\-–]?\s*/i, "").replace(TS_ID_RE, "").trim();
  const afterSep = cleaned.replace(/^[:.\-–)\s]+/, "").trim();
  if (afterSep) return afterSep;
  const titleLine = body.match(/\*\*Title:?\*\*\s*([^\n]+)/i);
  if (titleLine) return titleLine[1].trim();
  const firstLine = body.split("\n").find((l) => l.trim());
  return firstLine?.trim().replace(/^[-*]\s+/, "") ?? "";
}

export function parseTechnicalStories(markdown: string): TechnicalStory[] {
  if (!markdown || !markdown.trim()) return [];
  const tokens = marked.lexer(markdown);
  const stories: TechnicalStory[] = [];
  let current: { id: string; headingText: string; bodyParts: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const body = current.bodyParts.join("").trim();
    stories.push({
      id: current.id,
      title: extractTitle(current.headingText, body),
      body,
    });
    current = null;
  };

  for (const tok of tokens) {
    if (tok.type === "heading") {
      const h = tok as Tokens.Heading;
      const match = h.text.match(TS_ID_RE);
      if (match) {
        flush();
        current = {
          id: `TS-${match[1]}`.toUpperCase(),
          headingText: h.text,
          bodyParts: [],
        };
        continue;
      }
    }
    if (current) current.bodyParts.push((tok as { raw?: string }).raw ?? "");
  }
  flush();

  if (stories.length === 0) {
    const inline = Array.from(markdown.matchAll(/\bTS[-\s]?(\d+)\b/gi));
    const seen = new Set<string>();
    for (const m of inline) {
      const id = `TS-${m[1]}`.toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      stories.push({ id, title: "", body: "" });
    }
  }

  return stories;
}
