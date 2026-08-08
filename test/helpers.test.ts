import { describe, it, expect } from "vitest";

// Unit tests for internal helper functions
// These test the logic without needing the full Worker environment

// We recreate the helper functions here for testing since they're not exported
// In a production setup, we'd export them from src/index.ts

function buildContext(matches: any[]): string {
  if (!matches || matches.length === 0) {
    return "No relevant crates found in the vector index.";
  }
  return matches
    .map((m, i) => {
      const meta = m.metadata || {};
      const name = meta.name || meta.crate_name || `crate-${m.id}`;
      const description = meta.description || meta.desc || meta.doc || "No description available";
      const score = m.score?.toFixed(4);
      return `[${i + 1}] ${name} (score: ${score})\n    ${description}`;
    })
    .join("\n\n");
}

function validateAskBody(body: any): { valid: boolean; error?: string } {
  if (!body.question) {
    return { valid: false, error: "Missing 'question' field" };
  }
  if (typeof body.question !== "string") {
    return { valid: false, error: "'question' must be a string" };
  }
  if (body.question.trim().length === 0) {
    return { valid: false, error: "'question' cannot be empty" };
  }
  return { valid: true };
}

function validateRecommendBody(body: any): { valid: boolean; error?: string } {
  if (!body.task) {
    return { valid: false, error: "Missing 'task' field" };
  }
  if (typeof body.task !== "string") {
    return { valid: false, error: "'task' must be a string" };
  }
  return { valid: true };
}

function sanitizeTopK(raw: number | undefined): number {
  const requested = raw || 10;
  return Math.min(requested, 20);
}

describe("buildContext", () => {
  it("returns placeholder for empty matches", () => {
    expect(buildContext([])).toContain("No relevant crates");
  });

  it("returns placeholder for null/undefined", () => {
    expect(buildContext(null as any)).toContain("No relevant crates");
    expect(buildContext(undefined as any)).toContain("No relevant crates");
  });

  it("formats a single match correctly", () => {
    const result = buildContext([
      { id: "1", score: 0.95, metadata: { name: "test-crate", desc: "A test" } },
    ]);
    expect(result).toContain("[1]");
    expect(result).toContain("test-crate");
    expect(result).toContain("0.9500");
    expect(result).toContain("A test");
  });

  it("formats multiple matches with correct numbering", () => {
    const result = buildContext([
      { id: "1", score: 0.9, metadata: { name: "a" } },
      { id: "2", score: 0.8, metadata: { name: "b" } },
      { id: "3", score: 0.7, metadata: { name: "c" } },
    ]);
    expect(result).toContain("[1]");
    expect(result).toContain("[2]");
    expect(result).toContain("[3]");
  });

  it("falls back to crate_name when name is missing", () => {
    const result = buildContext([
      { id: "x", score: 0.5, metadata: { crate_name: "alt-name" } },
    ]);
    expect(result).toContain("alt-name");
  });

  it("falls back to id when no name fields exist", () => {
    const result = buildContext([
      { id: "fallback-id", score: 0.5, metadata: {} },
    ]);
    expect(result).toContain("crate-fallback-id");
  });

  it("checks description, desc, and doc fields in order", () => {
    const descOnly = buildContext([
      { id: "1", score: 1, metadata: { name: "a", desc: "from-desc" } },
    ]);
    expect(descOnly).toContain("from-desc");

    const docOnly = buildContext([
      { id: "1", score: 1, metadata: { name: "a", doc: "from-doc" } },
    ]);
    expect(docOnly).toContain("from-doc");

    const descAndDescription = buildContext([
      { id: "1", score: 1, metadata: { name: "a", description: "from-description", desc: "from-desc" } },
    ]);
    // description takes priority
    expect(descAndDescription).toContain("from-description");
    expect(descAndDescription).not.toContain("from-desc");
  });

  it("shows 'No description available' when no description fields exist", () => {
    const result = buildContext([
      { id: "1", score: 0.9, metadata: { name: "bare" } },
    ]);
    expect(result).toContain("No description available");
  });
});

describe("validateAskBody", () => {
  it("accepts valid question", () => {
    expect(validateAskBody({ question: "What is raft?" }).valid).toBe(true);
  });

  it("rejects missing question", () => {
    const result = validateAskBody({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("question");
  });

  it("rejects non-string question", () => {
    const result = validateAskBody({ question: 123 });
    expect(result.valid).toBe(false);
  });

  it("rejects empty string question", () => {
    const result = validateAskBody({ question: "   " });
    expect(result.valid).toBe(false);
  });
});

describe("validateRecommendBody", () => {
  it("accepts valid task", () => {
    expect(validateRecommendBody({ task: "Build a web server" }).valid).toBe(true);
  });

  it("rejects missing task", () => {
    const result = validateRecommendBody({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("task");
  });
});

describe("sanitizeTopK", () => {
  it("defaults to 10", () => {
    expect(sanitizeTopK(undefined)).toBe(10);
  });

  it("uses provided value when under cap", () => {
    expect(sanitizeTopK(5)).toBe(5);
    expect(sanitizeTopK(15)).toBe(15);
  });

  it("caps at 20", () => {
    expect(sanitizeTopK(50)).toBe(20);
    expect(sanitizeTopK(1000)).toBe(20);
  });

  it("uses default for invalid values", () => {
    expect(sanitizeTopK(0)).toBe(0); // 0 is falsy, defaults to 10
    expect(sanitizeTopK(-5 as any)).toBe(10);
  });
});
