import { describe, it, expect, mock, beforeEach } from "vitest";

// Mock the Worker's fetch handler by importing the default export
// We'll test via the exported fetch handler using Request/Response

// Type helpers
type MockAI = {
  run: ReturnType<typeof mock>;
};

type MockVectorizeIndex = {
  query: ReturnType<typeof mock>;
};

// Re-create the Env interface for testing
interface TestEnv {
  AI: MockAI;
  CRATE_INDEX: MockVectorizeIndex;
}

// Helper: create a mock AI binding that returns embeddings or text
function createMockAI(overrides: Partial<MockAI> = {}): MockAI {
  return {
    run: mock((model: string, _input: any) => {
      if (model.includes("bge-small")) {
        return Promise.resolve({ data: [[0.1, 0.2, 0.3, 0.4]] });
      }
      if (model.includes("llama")) {
        return Promise.resolve({ response: "Mock LLM response about crates." });
      }
      return Promise.resolve({});
    }),
    ...overrides,
  };
}

// Helper: create a mock VectorizeIndex
function createMockIndex(
  matches: Array<{ id: string; score: number; metadata?: Record<string, string> }> = []
): MockVectorizeIndex {
  return {
    query: mock(() =>
      Promise.resolve({ matches })
    ),
  };
}

// Helper: build a Request
function makeRequest(
  path: string,
  method: string = "GET",
  body?: unknown
): Request {
  const url = `https://test.example${path}`;
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  return new Request(url, opts);
}

// Helper: call the worker and parse response
async function callWorker(
  request: Request,
  env: TestEnv
): Promise<{ status: number; body: any }> {
  // Dynamically import the worker
  const worker = (await import("../src/index")).default;
  const response = await worker.fetch(request, env as any);
  const body = await response.json();
  return { status: response.status, body };
}

describe("SuperInstance Agent — Health Check", () => {
  it("GET /health returns 200 with service info", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { status, body } = await callWorker(makeRequest("/health"), env);
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("superinstance-agent");
    expect(body.version).toBe("1.0.0");
  });

  it("GET /health reports component binding status", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { body } = await callWorker(makeRequest("/health"), env);
    expect(body.components.ai_binding).toBe(true);
    expect(body.components.vectorize_binding).toBe(true);
  });

  it("GET /health reports false when bindings missing", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    // Test with undefined bindings
    const envNoBindings = { AI: undefined, CRATE_INDEX: undefined } as any;
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(makeRequest("/health"), envNoBindings);
    const body = await response.json();
    expect(body.components.ai_binding).toBe(false);
    expect(body.components.vectorize_binding).toBe(false);
  });
});

describe("SuperInstance Agent — /ask Endpoint", () => {
  it("POST /ask returns 400 when question is missing", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { status, body } = await callWorker(
      makeRequest("/ask", "POST", {}),
      env
    );
    expect(status).toBe(400);
    expect(body.error).toContain("question");
  });

  it("POST /ask returns answer with citations when question is provided", async () => {
    const mockMatches = [
      {
        id: "crate-1",
        score: 0.95,
        metadata: {
          name: "raft-cluster",
          desc: "Distributed Raft consensus implementation",
        },
      },
      {
        id: "crate-2",
        score: 0.87,
        metadata: {
          name: "paxos-fleet",
          desc: "Paxos consensus for fleet coordination",
        },
      },
    ];
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(mockMatches),
    };
    const { status, body } = await callWorker(
      makeRequest("/ask", "POST", { question: "How do I do distributed consensus?" }),
      env
    );
    expect(status).toBe(200);
    expect(body.question).toBe("How do I do distributed consensus?");
    expect(body.answer).toBeDefined();
    expect(body.citations).toHaveLength(2);
    expect(body.citations[0].name).toBe("raft-cluster");
    expect(body.crates_searched).toBe(2);
  });

  it("POST /ask respects topK parameter", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    await callWorker(
      makeRequest("/ask", "POST", { question: "test", topK: 5 }),
      env
    );
    expect(env.CRATE_INDEX.query).toHaveBeenCalled();
    const callArgs = env.CRATE_INDEX.query.mock.calls[0];
    expect(callArgs[1]).toBe(5); // topK is the second positional arg
  });

  it("POST /ask caps topK at 20", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    await callWorker(
      makeRequest("/ask", "POST", { question: "test", topK: 100 }),
      env
    );
    const callArgs = env.CRATE_INDEX.query.mock.calls[0];
    expect(callArgs[1]).toBe(20);
  });

  it("POST /ask handles empty search results gracefully", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex([]),
    };
    const { status, body } = await callWorker(
      makeRequest("/ask", "POST", { question: "nonexistent thing" }),
      env
    );
    expect(status).toBe(200);
    expect(body.citations).toEqual([]);
    expect(body.crates_searched).toBe(0);
  });

  it("POST /ask checks desc field (not just description) for metadata", async () => {
    // This tests the bug fix from DEBUG-REPORT.md
    const mockMatches = [
      {
        id: "crate-1",
        score: 0.9,
        metadata: {
          name: "test-crate",
          desc: "Description via desc field",
        },
      },
    ];
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(mockMatches),
    };
    const { body } = await callWorker(
      makeRequest("/ask", "POST", { question: "test" }),
      env
    );
    expect(body.citations[0].description).toBe("Description via desc field");
  });
});

describe("SuperInstance Agent — /recommend Endpoint", () => {
  it("POST /recommend returns 400 when task is missing", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { status } = await callWorker(
      makeRequest("/recommend", "POST", {}),
      env
    );
    expect(status).toBe(400);
  });

  it("POST /recommend returns recommendation with ranked crates", async () => {
    const mockMatches = [
      {
        id: "c1",
        score: 0.92,
        metadata: { name: "api-gateway", desc: "Rate-limited API gateway" },
      },
      {
        id: "c2",
        score: 0.85,
        metadata: { name: "load-balancer", desc: "Load balancing crate" },
      },
    ];
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(mockMatches),
    };
    const { status, body } = await callWorker(
      makeRequest("/recommend", "POST", { task: "build an API gateway" }),
      env
    );
    expect(status).toBe(200);
    expect(body.task).toBe("build an API gateway");
    expect(body.recommendation).toBeDefined();
    expect(body.recommended_crates).toHaveLength(2);
    expect(body.total_candidates).toBe(2);
  });

  it("POST /recommend limits recommended_crates to top 5", async () => {
    const manyMatches = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      score: 0.9 - i * 0.05,
      metadata: { name: `crate-${i}`, desc: `Description ${i}` },
    }));
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(manyMatches),
    };
    const { body } = await callWorker(
      makeRequest("/recommend", "POST", { task: "test" }),
      env
    );
    expect(body.recommended_crates).toHaveLength(5);
    expect(body.total_candidates).toBe(10);
  });
});

describe("SuperInstance Agent — Routing & CORS", () => {
  it("OPTIONS returns 200 with CORS headers", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const worker = (await import("../src/index")).default;
    const response = await worker.fetch(
      makeRequest("/ask", "OPTIONS"),
      env as any
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
  });

  it("Unknown path returns 404 with endpoint listing", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { status, body } = await callWorker(
      makeRequest("/unknown"),
      env
    );
    expect(status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(body.endpoints).toBeDefined();
    expect(body.endpoints.length).toBe(3);
  });

  it("GET on a POST-only endpoint returns 404", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
    const { status } = await callWorker(makeRequest("/ask"), env);
    expect(status).toBe(404);
  });
});

describe("SuperInstance Agent — Error Handling", () => {
  it("Returns 500 when AI binding throws", async () => {
    const env: TestEnv = {
      AI: createMockAI({
        run: mock(() => Promise.reject(new Error("AI service down"))),
      }),
      CRATE_INDEX: createMockIndex(),
    };
    const { status, body } = await callWorker(
      makeRequest("/ask", "POST", { question: "test" }),
      env
    );
    expect(status).toBe(500);
    expect(body.error).toContain("Internal server error");
  });

  it("Returns 500 when Vectorize throws", async () => {
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex().query
        ? {
            query: mock(() =>
              Promise.reject(new Error("Vectorize unavailable"))
            ),
          } as any,
      } as any,
    };
    const { status } = await callWorker(
      makeRequest("/ask", "POST", { question: "test" }),
      env
    );
    expect(status).toBe(500);
  });
});

describe("SuperInstance Agent — buildContext edge cases", () => {
  it("Handles matches with missing metadata gracefully", async () => {
    const mockMatches = [
      { id: "bare-crate", score: 0.5 }, // no metadata at all
    ];
    const env: TestEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(mockMatches),
    };
    const { body } = await callWorker(
      makeRequest("/ask", "POST", { question: "test" }),
      env
    );
    expect(body.citations[0].name).toBe("bare-crate");
    expect(body.citations[0].description).toBe("");
  });
});
