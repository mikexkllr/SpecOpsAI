import { describe, it, expect } from "vitest";
import { parseChatCommand } from "./api";

describe("parseChatCommand", () => {
  it("parses a bare command", () => {
    expect(parseChatCommand("/clarify")).toEqual({ command: "clarify", rest: "" });
  });

  it("parses a command with focus text", () => {
    expect(parseChatCommand("/analyze focus on auth")).toEqual({
      command: "analyze",
      rest: "focus on auth",
    });
  });

  it("parses the project-level codebase command", () => {
    expect(parseChatCommand("/codebase")).toEqual({ command: "codebase", rest: "" });
  });

  it("tolerates surrounding whitespace and newlines in the focus", () => {
    expect(parseChatCommand("  /ground\ncheck the IPC channels ")).toEqual({
      command: "ground",
      rest: "check the IPC channels",
    });
  });

  it("rejects unknown commands", () => {
    expect(parseChatCommand("/refactor everything")).toBeNull();
  });

  it("rejects plain messages", () => {
    expect(parseChatCommand("clarify the spec please")).toBeNull();
  });

  it("rejects prefix matches without a word boundary", () => {
    expect(parseChatCommand("/clarifying")).toBeNull();
  });
});
