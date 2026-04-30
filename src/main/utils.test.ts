import { describe, it, expect } from "vitest";
import { projectRoot, isAbortError, lastAssistantText } from "./utils";

describe("projectRoot", () => {
  it("resolves two levels up from spec path", () => {
    expect(projectRoot("/project/specs/my-spec")).toBe("/project");
  });

  it("handles nested spec paths", () => {
    expect(projectRoot("/a/b/c/specs/deep/nested")).toBe("/a/b/c/specs");
  });
});

describe("isAbortError", () => {
  it("returns true for AbortError name", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("returns true for aborted message", () => {
    expect(isAbortError({ message: "The operation was aborted" })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isAbortError({ name: "TypeError", message: "something failed" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe("lastAssistantText", () => {
  it("returns empty string for null result", () => {
    expect(lastAssistantText(null)).toBe("");
  });

  it("returns empty string for no messages", () => {
    expect(lastAssistantText({})).toBe("");
    expect(lastAssistantText({ messages: [] })).toBe("");
  });

  it("extracts text from last AI message", () => {
    const msg = {
      _getType: () => "ai",
      content: "Hello from assistant",
    };
    expect(lastAssistantText({ messages: [msg] })).toBe("Hello from assistant");
  });

  it("finds the last AI message among mixed messages", () => {
    const humanMsg = { _getType: () => "human", content: "Hi" };
    const aiMsg = { _getType: () => "ai", content: "Response" };
    expect(lastAssistantText({ messages: [humanMsg, aiMsg] })).toBe("Response");
  });

  it("handles array content", () => {
    const aiMsg = {
      _getType: () => "ai",
      content: [{ text: "Part 1" }, { text: "Part 2" }],
    };
    expect(lastAssistantText({ messages: [aiMsg] })).toBe("Part 1Part 2");
  });
});
