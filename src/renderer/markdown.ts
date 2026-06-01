import { Marked, Renderer, type Tokens } from "marked";

// Markdown rendering for chat messages. Chat shows *model* output, and the
// renderer can reach the privileged `window.specops` IPC bridge, so this is
// hardened beyond a plain `marked.parse`:
//   - raw HTML in the model output is escaped to inert text, never live DOM
//   - link / image hrefs are restricted to safe schemes (no `javascript:` etc.)
//   - images render as their alt text (no external loads from chat)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_HREF = /^(https?:|mailto:)/i;

const renderer = new Renderer();

renderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escapeHtml(text);

renderer.link = function link({ href, title, tokens }: Tokens.Link): string {
  const text = this.parser?.parseInline(tokens) ?? escapeHtml(tokens.map((t) => t.raw).join(""));
  if (!href || !SAFE_HREF.test(href.trim())) return text;
  const t = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noreferrer">${text}</a>`;
};

renderer.image = ({ text }: Tokens.Image): string => escapeHtml(text || "");

const marked = new Marked({ gfm: true, breaks: true, renderer });

export function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false }) as string;
}
