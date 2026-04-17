import React from "react";
import { marked } from "marked";
import MdEditor from "react-markdown-editor-lite";
import "react-markdown-editor-lite/lib/index.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps): JSX.Element {
  return (
    <div
      className="custom-markdown-editor"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <MdEditor
        value={value}
        style={{ flex: 1, border: "none" }}
        renderHTML={(text) => `<div class="custom-html-style">${marked.parse(text)}</div>`}
        onChange={({ text }) => onChange(text)}
        placeholder={placeholder}
        view={{ menu: true, md: false, html: true }}
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: true, hideMenu: true }}
      />
      <style>{`
        .custom-markdown-editor .rc-md-editor {
          background: var(--bg-0);
          border: none !important;
          font-family: var(--font-mono);
        }
        .custom-markdown-editor .rc-md-navigation {
          background: var(--bg-1);
          border-bottom: 1px solid var(--border-subtle) !important;
          color: var(--fg-1);
          padding: 4px 8px !important;
        }
        .custom-markdown-editor .rc-md-navigation .button {
          color: var(--fg-2);
          border-radius: 3px;
          transition: background 100ms ease, color 100ms ease;
        }
        .custom-markdown-editor .rc-md-navigation .button:hover {
          color: var(--fg-0);
          background: var(--bg-3);
        }
        .custom-markdown-editor .rc-md-navigation .button.active {
          color: var(--accent);
        }
        .custom-markdown-editor .editor-container {
          background: var(--bg-0) !important;
        }
        .custom-markdown-editor .editor-container .section.md textarea {
          background: var(--bg-0) !important;
          color: var(--fg-0) !important;
          caret-color: var(--accent);
          font-family: var(--font-mono);
          font-size: var(--fs-md);
          padding: 18px;
          line-height: 1.6;
        }
        .custom-markdown-editor .editor-container .section.html {
          background: var(--bg-0) !important;
          color: var(--fg-0) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style {
          color: var(--fg-0) !important;
          padding: 24px 32px;
          overflow: auto;
          line-height: 1.65;
          font-family: var(--font-sans);
          background: var(--bg-0) !important;
          height: 100%;
          max-width: 820px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style * {
          color: var(--fg-0) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h3,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h4 {
          margin-top: 28px;
          margin-bottom: 14px;
          font-weight: 600;
          line-height: 1.25;
          color: var(--fg-0) !important;
          font-family: var(--font-sans);
          letter-spacing: -0.01em;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1 {
          border-bottom: 1px solid var(--border);
          padding-bottom: 8px;
          font-size: 26px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1::before {
          content: "▸ ";
          color: var(--accent);
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2 {
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 6px;
          font-size: 20px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h3 {
          font-size: 16px;
          color: var(--accent) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style p {
          margin-bottom: 14px;
          color: var(--fg-1) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style ul,
        .custom-markdown-editor .editor-container .section.html .custom-html-style ol {
          padding-left: 1.6em;
          margin-bottom: 14px;
          color: var(--fg-1) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style li {
          color: var(--fg-1) !important;
          margin-bottom: 4px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style li::marker {
          color: var(--accent);
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style code {
          background: var(--bg-2) !important;
          padding: 1px 5px;
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 0.88em;
          color: var(--fg-0) !important;
          border: 1px solid var(--border-subtle);
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style pre {
          background: var(--bg-1) !important;
          padding: 14px 16px;
          border-radius: var(--radius);
          overflow: auto;
          margin-bottom: 14px;
          border: 1px solid var(--border-subtle);
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style pre code {
          background: transparent !important;
          padding: 0;
          border: none;
          color: var(--fg-0) !important;
          font-size: 0.85em;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style blockquote {
          border-left: 3px solid var(--accent);
          padding: 4px 14px;
          color: var(--fg-1) !important;
          margin: 0 0 14px 0;
          background: var(--bg-1);
          border-radius: 0 3px 3px 0;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style blockquote * {
          color: var(--fg-1) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style a {
          color: var(--accent) !important;
          text-decoration: none;
          border-bottom: 1px dotted var(--accent);
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style a:hover {
          border-bottom-style: solid;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style hr {
          border: none;
          border-top: 1px solid var(--border-subtle);
          margin: 24px 0;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style table {
          border-collapse: collapse;
          margin-bottom: 14px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style th,
        .custom-markdown-editor .editor-container .section.html .custom-html-style td {
          border: 1px solid var(--border-subtle);
          padding: 6px 10px;
          color: var(--fg-1) !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style th {
          background: var(--bg-1);
          color: var(--fg-0) !important;
          font-weight: 600;
        }
        .custom-markdown-editor .editor-container .section {
          height: 100%;
          overflow: hidden;
        }
        .custom-markdown-editor .drop-wrap {
          background: var(--bg-2) !important;
          border: 1px solid var(--border) !important;
        }
      `}</style>
    </div>
  );
}
