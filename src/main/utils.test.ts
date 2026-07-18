import { describe, it, expect } from "vitest";
import {
  projectRoot,
  isAbortError,
  lastAssistantText,
  devServerUrlFromOutput,
  scriptPort,
  storyIdFromSpecFilename,
} from "./utils";

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

describe("devServerUrlFromOutput", () => {
  it("extracts a vite-style local URL", () => {
    expect(devServerUrlFromOutput("  ➜  Local:   http://localhost:5173/")).toBe(
      "http://localhost:5173/",
    );
  });

  it("normalizes 0.0.0.0 listen addresses to localhost", () => {
    expect(devServerUrlFromOutput("listening on http://0.0.0.0:3000")).toBe(
      "http://localhost:3000/",
    );
  });

  it("strips trailing punctuation", () => {
    expect(devServerUrlFromOutput("ready at http://localhost:4321.")).toBe(
      "http://localhost:4321/",
    );
  });

  it("returns null when no URL is present", () => {
    expect(devServerUrlFromOutput("compiling...")).toBeNull();
  });
});

describe("scriptPort", () => {
  it("reads --port flags", () => {
    expect(scriptPort("vite --port 3001")).toBe(3001);
  });

  it("reads --port= form", () => {
    expect(scriptPort("next dev --port=4000")).toBe(4000);
  });

  it("reads PORT= env prefixes", () => {
    expect(scriptPort("PORT=8080 node server.js")).toBe(8080);
  });

  it("returns null when no port is named", () => {
    expect(scriptPort("vite")).toBeNull();
    expect(scriptPort(undefined)).toBeNull();
  });
});

describe("storyIdFromSpecFilename", () => {
  it("derives the story id from a spec filename", () => {
    expect(storyIdFromSpecFilename("US-1.spec.ts")).toBe("US-1");
  });

  it("handles ids without a dash", () => {
    expect(storyIdFromSpecFilename("US2.spec.ts")).toBe("US2");
  });

  it("returns undefined for non-story files", () => {
    expect(storyIdFromSpecFilename("smoke.spec.ts")).toBeUndefined();
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
