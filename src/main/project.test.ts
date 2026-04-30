import { describe, it, expect } from "vitest";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `spec-${Date.now()}`;
}

describe("slugify", () => {
  it("converts to lowercase", () => {
    expect(slugify("My Spec")).toBe("my-spec");
  });

  it("replaces non-alphanumeric with dashes", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("-test-")).toBe("test");
  });

  it("handles empty input", () => {
    const result = slugify("");
    expect(result).toMatch(/^spec-\d+$/);
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long)).toHaveLength(64);
  });

  it("handles special characters", () => {
    expect(slugify("My @#$%^&* Spec!")).toBe("my-spec");
  });
});
