import { describe, it, expect } from "vitest";
import { parseTechnicalStories } from "./technical-stories";

describe("parseTechnicalStories", () => {
  it("returns empty array for empty input", () => {
    expect(parseTechnicalStories("")).toEqual([]);
    expect(parseTechnicalStories("   ")).toEqual([]);
  });

  it("parses stories from headings with TS-N pattern", () => {
    const md = `## TS-1: Setup Auth Module
Implement the authentication module.

## TS-2: Setup Database
Configure database connection.`;
    const stories = parseTechnicalStories(md);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("TS-1");
    expect(stories[1].id).toBe("TS-2");
  });

  it("extracts title from heading text", () => {
    const md = `## TS-1: Setup Auth Module
Implement the authentication module.`;
    const stories = parseTechnicalStories(md);
    expect(stories[0].title).toBe("Setup Auth Module");
  });

  it("captures body content", () => {
    const md = `## TS-1: Auth
Implement auth with JWT.
Acceptance criteria:
- User can login
- User can logout`;
    const stories = parseTechnicalStories(md);
    expect(stories[0].body).toContain("Implement auth");
  });

  it("falls back to inline TS-N detection", () => {
    const md = `This implementation covers TS-1 and TS-3 for the backend.`;
    const stories = parseTechnicalStories(md);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("TS-1");
    expect(stories[1].id).toBe("TS-3");
  });

  it("handles TS-N with space separator", () => {
    const md = `## TS 5: Migrate Database`;
    const stories = parseTechnicalStories(md);
    expect(stories).toHaveLength(1);
    expect(stories[0].id).toBe("TS-5");
  });

  it("deduplicates inline IDs", () => {
    const md = `TS-1 references TS-1 in multiple places.`;
    const stories = parseTechnicalStories(md);
    expect(stories).toHaveLength(1);
  });
});
