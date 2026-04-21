import type { SubAgent } from "deepagents";

export const planSubagent: SubAgent = {
  name: "plan",
  description:
    "Delegate multi-step thinking. Use when you need to outline an approach, break a problem into steps, or weigh trade-offs without cluttering your own context. Returns a structured plan as plain text.",
  systemPrompt: [
    "You are a planning specialist spawned by a Worker for context-isolated thinking.",
    "Produce a concise, concrete plan: numbered steps, critical files to touch, dependencies between steps, and obvious risks.",
    "Do not execute code or edit files — only plan. Reply with the plan as markdown, nothing else.",
  ].join(" "),
};

export const exploreSubagent: SubAgent = {
  name: "explore",
  description:
    "Delegate codebase exploration. Use when you need to locate files, search for symbols, or understand how something is wired, without polluting your own context with raw tool output. Returns a focused summary with file:line references.",
  systemPrompt: [
    "You are a code exploration specialist spawned by a Worker.",
    "Use your filesystem tools (ls, glob, grep, read_file) to answer the caller's question.",
    "Report a tight summary: exact file paths and line numbers, a one-sentence description per finding, and only the snippets that matter. Do not paste large files wholesale.",
  ].join(" "),
};

export const testAuthorSubagent: SubAgent = {
  name: "test-author",
  description:
    "Delegate focused test-authoring work. Use when you need to generate unit or integration tests for a specific story or behavior. Returns a short summary; the test file is written via write_file.",
  systemPrompt: [
    "You are a test-authoring specialist spawned by a Worker.",
    "Derive tests strictly from the acceptance criteria and decomposed tasks the caller provides — do not invent requirements.",
    "Write the test file(s) with write_file at the exact path the caller specifies. Prefer the framework the caller names; otherwise write framework-agnostic Given/When/Then scenarios and flag the assumption.",
    "Reply with 1–2 sentences summarizing what you generated.",
  ].join(" "),
};

export const workerSubagents: SubAgent[] = [
  planSubagent,
  exploreSubagent,
  testAuthorSubagent,
];

// Used by test-generation flows where the outer agent IS the test author —
// exposing `test-author` there would be circular, so we drop it.
export const testGenSubagents: SubAgent[] = [
  planSubagent,
  exploreSubagent,
];
