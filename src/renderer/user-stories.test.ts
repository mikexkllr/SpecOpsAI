import { describe, it, expect } from "vitest";
import { parseUserStories } from "./user-stories";

describe("parseUserStories", () => {
  it("returns empty array for empty input", () => {
    expect(parseUserStories("")).toEqual([]);
    expect(parseUserStories("   ")).toEqual([]);
  });

  it("parses stories from headings with US-N pattern", () => {
    const md = `## US-1: Login
As a user, I want to login so that I can access my account.

## US-2: Logout
As a user, I want to logout so that I can secure my session.`;
    const stories = parseUserStories(md);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("US-1");
    expect(stories[1].id).toBe("US-2");
  });

  it("extracts title from heading text", () => {
    const md = `## US-1: User Login
As a user, I want to login.`;
    const stories = parseUserStories(md);
    expect(stories[0].title).toBe("User Login");
  });

  it("captures body content", () => {
    const md = `## US-1: Login
As a user, I want to login so that I can access my account.
Additional details here.`;
    const stories = parseUserStories(md);
    expect(stories[0].body).toContain("As a user");
  });

  it("falls back to inline US-N detection", () => {
    const md = `This spec covers US-1 and US-2 for the auth flow.`;
    const stories = parseUserStories(md);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("US-1");
    expect(stories[1].id).toBe("US-2");
  });

  it('falls back to "As a..." bullet detection', () => {
    const md = `- As a user, I want to login
- As an admin, I want to manage users`;
    const stories = parseUserStories(md);
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toContain("As a user");
    expect(stories[1].title).toContain("As an admin");
  });

  it("handles US-N with space separator", () => {
    const md = `## US 1: Login`;
    const stories = parseUserStories(md);
    expect(stories).toHaveLength(1);
    expect(stories[0].id).toBe("US-1");
  });

  it("deduplicates inline IDs", () => {
    const md = `US-1 is mentioned again in US-1 context.`;
    const stories = parseUserStories(md);
    expect(stories).toHaveLength(1);
  });
});
