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
    <div className="custom-markdown-editor" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <MdEditor
        value={value}
        style={{ flex: 1, border: "none" }}
        renderHTML={(text) => marked.parse(text) as string}
        onChange={({ text }) => onChange(text)}
        placeholder={placeholder}
        view={{ menu: true, md: true, html: false }} // Default view
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: true, hideMenu: true }}
      />
      <style>{`
        .custom-markdown-editor .rc-md-editor {
          background: #141414;
          border: none !important;
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
          color: #e6e6e6 !important;
          caret-color: #fff;
          font-family: inherit;
          font-size: 13px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style {
          color: #e6e6e6 !important;
          padding: 24px 32px;
          overflow: auto;
          line-height: 1.6;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2,
        .custom-markdown-editor .editor-container .section.html .custom-html-style h3 {
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
          line-height: 1.25;
          color: #fff;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h1 { border-bottom: 1px solid #333; padding-bottom: 8px; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style h2 { border-bottom: 1px solid #2a2a2a; padding-bottom: 6px; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style p { margin-bottom: 16px; }
        .custom-markdown-editor .editor-container .section.html .custom-html-style ul,
        .custom-markdown-editor .editor-container .section.html .custom-html-style ol {
          padding-left: 2em;
          margin-bottom: 16px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style code {
          background: #2a2a2a;
          padding: 2px 4px;
          border-radius: 4px;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 85%;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style pre {
          background: #1e1e1e;
          padding: 16px;
          border-radius: 6px;
          overflow: auto;
          margin-bottom: 16px;
        }
        .custom-markdown-editor .editor-container .section.html .custom-html-style blockquote {
          border-left: 4px solid #333;
          padding-left: 16px;
          color: #999;
          margin: 0 0 16px 0;
        }
        .custom-markdown-editor .rc-md-navigation .button.active {
            color: #2b6cb0;
        }
      `}</style>
    </div>
  );
}
