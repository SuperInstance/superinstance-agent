export interface Env {
  AI: any;
  CRATE_INDEX: VectorizeIndex;
}

const SYSTEM_PROMPT = `You are an expert assistant for the SuperInstance ecosystem, a massive Rust-based distributed systems platform.

Key facts about SuperInstance:
- Over 1,605 repositories organized into specialized crates
- Built on ternary design principles: three-state logic, ternary consensus, ternary spectral methods
- Conservation law: γ + η = C (gamma + eta equals a constant), fundamental to the system's physics-inspired architecture
- Crates span networking, consensus, spectral analysis, distributed protocols, and more
- The ecosystem uses semantic versioning and modular crate design

When answering questions:
- Reference specific crate names from the provided search results
- Explain how crates relate to the user's question
- Be precise about technical details
- If multiple crates are relevant, compare them
- Always cite your sources (crate names from search results)

Format your answers clearly with headers and bullet points when appropriate.`;

interface AskRequest {
  question: string;
  topK?: number;
}

interface RecommendRequest {
  task: string;
  topK?: number;
}

async function embedQuestion(ai: any, text: string): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-small-en-v1.5", {
    text: [text],
  });
  return response.data[0];
}

async function searchCrates(
  index: VectorizeIndex,
  queryVector: number[],
  topK: number
): Promise<VectorizeMatches> {
  return index.query(queryVector, { topK, returnMetadata: "all" });
}

function buildContext(matches: VectorizeMatches): string {
  if (!matches.matches || matches.matches.length === 0) {
    return "No relevant crates found in the vector index.";
  }
  return matches.matches
    .map((m, i) => {
      const meta = m.metadata || {};
      const name = meta.name || meta.crate_name || `crate-${m.id}`;
      const description = meta.description || meta.desc || meta.doc || "No description available";
      const score = m.score?.toFixed(4);
      return `[${i + 1}] ${name} (score: ${score})\n    ${description}`;
    })
    .join("\n\n");
}

async function generateAnswer(
  ai: any,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    max_tokens: 1024,
    temperature: 0.3,
  });
  return response.response || "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/health" && request.method === "GET") {
        return Response.json(
          {
            status: "ok",
            service: "superinstance-agent",
            version: "1.0.0",
            components: {
              ai_binding: !!env.AI,
              vectorize_binding: !!env.CRATE_INDEX,
            },
          },
          { headers: corsHeaders }
        );
      }

      if (path === "/ask" && request.method === "POST") {
        const body = (await request.json()) as AskRequest;
        if (!body.question) {
          return Response.json(
            { error: "Missing 'question' field" },
            { status: 400, headers: corsHeaders }
          );
        }

        const topK = Math.min(body.topK || 10, 20);

        // Step 1: Embed the question
        const queryVector = await embedQuestion(env.AI, body.question);

        // Step 2: Search Vectorize
        const matches = await searchCrates(env.CRATE_INDEX, queryVector, topK);

        // Step 3: Build context
        const context = buildContext(matches);

        // Step 4: Generate answer
        const prompt = `Question: ${body.question}\n\nRelevant crates from the SuperInstance ecosystem:\n${context}\n\nBased on the crates above, answer the question. Cite specific crate names.`;
        const answer = await generateAnswer(env.AI, prompt, SYSTEM_PROMPT);

        // Step 5: Return with citations
        const citations = (matches.matches || []).map((m) => ({
          id: m.id,
          name: m.metadata?.name || m.metadata?.crate_name || m.id,
          score: m.score,
          description: m.metadata?.description || m.metadata?.desc || m.metadata?.doc || "",
        }));

        return Response.json(
          {
            question: body.question,
            answer,
            citations,
            crates_searched: citations.length,
          },
          { headers: corsHeaders }
        );
      }

      if (path === "/recommend" && request.method === "POST") {
        const body = (await request.json()) as RecommendRequest;
        if (!body.task) {
          return Response.json(
            { error: "Missing 'task' field" },
            { status: 400, headers: corsHeaders }
          );
        }

        const topK = Math.min(body.topK || 10, 20);

        // Embed & search
        const queryVector = await embedQuestion(env.AI, body.task);
        const matches = await searchCrates(env.CRATE_INDEX, queryVector, topK);
        const context = buildContext(matches);

        // Generate recommendation
        const prompt = `Task: ${body.task}\n\nAvailable crates:\n${context}\n\nBased on the crates above, recommend the best crates for this task. For each recommendation explain:\n1. Why it fits the task\n2. How to integrate it\n3. Any caveats or alternatives\n\nStructure your response with clear sections.`;
        const recommendation = await generateAnswer(env.AI, prompt, SYSTEM_PROMPT);

        const recommended = (matches.matches || []).slice(0, 5).map((m) => ({
          id: m.id,
          name: m.metadata?.name || m.metadata?.crate_name || m.id,
          score: m.score,
          description: m.metadata?.description || m.metadata?.desc || m.metadata?.doc || "",
        }));

        return Response.json(
          {
            task: body.task,
            recommendation,
            recommended_crates: recommended,
            total_candidates: matches.matches?.length || 0,
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        {
          error: "Not found",
          endpoints: [
            "POST /ask - Ask a question about the SuperInstance ecosystem",
            "POST /recommend - Get crate recommendations for a task",
            "GET /health - Service health check",
          ],
        },
        { status: 404, headers: corsHeaders }
      );
    } catch (err: any) {
      return Response.json(
        {
          error: "Internal server error",
          message: err.message || String(err),
        },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
