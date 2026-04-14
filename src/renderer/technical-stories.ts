import type { TechnicalStory } from "../shared/api";

const HEADER_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+|[-*][ \t]+)?\[?(TS-\d+)\]?[ \t]*(?:[:.)\-–][ \t]*)?([^\n]*)/gi;

export function parseTechnicalStories(markdown: string): TechnicalStory[] {
  if (!markdown || !markdown.trim()) return [];
  const headers: Array<{ id: string; title: string; start: number; end: number }> = [];
  const re = new RegExp(HEADER_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const offset = m[0].startsWith("\n") ? 1 : 0;
    headers.push({
      id: m[1].toUpperCase(),
      title: m[2].trim(),
      start: m.index + offset,
      end: re.lastIndex,
    });
  }
  if (headers.length === 0) return [];
  const stories: TechnicalStory[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1]?.start ?? markdown.length;
    const body = markdown.slice(h.end, next).trim();
    stories.push({ id: h.id, title: h.title, body });
  }
  return stories;
}
