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
    <div className="custom-markdown-editor" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <MdEditor
        value={value}
        style={{ flex: 1, border: "none" }}
        renderHTML={(text) => `<div class="custom-html-style">${marked.parse(text)}</div>`}
        onChange={({ text }) => onChange(text)}
        placeholder={placeholder}
        view={{ menu: true, md: false, html: true }} // Default to preview (graphical)
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: true, hideMenu: true }}
      />
      <style>{`
        .custom-markdown-editor .rc-md-editor {
          background: #141414;
          border: none !important;
          font-family: inherit;
        }
        .custom-markdown-editor .rc-md-navigation {
          background: #1e1e1e;
          border-bottom: 1px solid #2a2a2a;
          color: #ddd;
        }
        .custom-markdown-editor .rc-md-navigation .button {
          color: #aaa;
        }
        .custom-markdown-editor .rc-md-navigation .button:hover {
          color: #fff;
          background: #2a2a2a;
        }
        .custom-markdown-editor .editor-container {
          background: #141414 !important;
        }
        .custom-markdown-editor .editor-container .section.md textarea {
          background: #141414 !important;
          color: #f0f0f0 !important;
          caret-color: #fff;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 13px;
          padding: 16px;
          line-height: 1.5;
        }
        .custom-markdown-editor .editor-container .section.html {
          background: #141414 !important;
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style {
          color: #ffffff !important;
          padding: 24px 32px;
          overflow: auto;
          line-height: 1.6;
          font-family: system-ui, -apple-system, sans-serif;
          background: #141414 !important;
          height: 100%;
        }
        /* Target all text elements in the preview to be absolutely sure */
        .custom-markdown-editor .editor-container .section.html .custom-html-style * {
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h3 {
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
          line-height: 1.25;
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1 { border-bottom: 1px solid #444; padding-bottom: 8px; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2 { border-bottom: 1px solid #333; padding-bottom: 6px; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style p { margin-bottom: 16px; color: #ffffff !important; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style ul,
        .custom-markdown-editor .editor-container .section.html .custom-html-style ol {
          padding-left: 2em;
          margin-bottom: 16px;
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style li {
          color: #ffffff !important;
          margin-bottom: 4px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style code {
          background: #2a2a2a !important;
          padding: 2px 4px;
          border-radius: 4px;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 85%;
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style pre {
          background: #1e1e1e !important;
          padding: 16px;
          border-radius: 6px;
          overflow: auto;
          margin-bottom: 16px;
          border: 1px solid #333;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style pre code {
          background: transparent !important;
          padding: 0;
          color: #ffffff !important;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style blockquote {
          border-left: 4px solid #555;
          padding-left: 16px;
          color: #dddddd !important;
          margin: 0 0 16px 0;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style blockquote * {
          color: #dddddd !important;
        }
        .custom-markdown-editor .rc-md-navigation .button.active {
            color: #4dabf7;
        }
        .custom-markdown-editor .editor-container .section {
          height: 100%;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
