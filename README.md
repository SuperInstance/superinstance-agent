# superinstance-agent

The **SuperInstance AI Agent** — a Cloudflare Worker that provides natural-language Q&A and crate recommendation across the SuperInstance Rust ecosystem. Combines semantic search (Vectorize) with generative AI (Workers AI) to answer questions about 1,600+ crates.

## Why It Matters

The SuperInstance ecosystem spans **1,600+ Rust crates** covering networking, consensus, spectral analysis, distributed protocols, ternary logic, and more. Finding the right crate for a task is a navigation problem at scale.

This agent solves three problems:

1. **Discovery:** "Which crate handles distributed consensus?" → semantic search finds `raft-cluster`, `paxos-fleet`, `ternary-consensus`
2. **Understanding:** "What does riff-benchmark-hashing do?" → RAG-grounded explanation from crate metadata
3. **Recommendation:** "I need to build a rate-limited API gateway" → ranked crate suggestions with integration guidance

Traditional keyword search fails for semantic queries ("how do I do reliable messaging" doesn't match crate names like `reliable-udp`). Semantic search + LLM reasoning bridges this gap.

### Architecture

```
User Question
     ↓
[Workers AI: BGE Embedding] ← @cf/baai/bge-small-en-v1.5 (384-dim)
     ↓
[Vectorize: fleet-crates index] → Top-K semantic matches
     ↓
[Workers AI: Llama 3.1 8B] ← Context-grounded generation
     ↓
Answer + Citations
```

## How It Works

### Retrieval-Augmented Generation (RAG)

The agent implements a **2-stage RAG pipeline**:

**Stage 1: Retrieval** — Semantic search over crate embeddings

The query $q$ is embedded into a 384-dimensional vector $\vec{q}$ using BGE-small:

$$\vec{q} = \text{BGE}_{\text{small}}(\text{question}) \in \mathbb{R}^{384}$$

Vectorize performs cosine similarity search:

$$\text{score}(\vec{q}, \vec{c}_i) = \frac{\vec{q} \cdot \vec{c}_i}{\|\vec{q}\| \|\vec{c}_i\|}$$

returning the top-$K$ crates with highest similarity.

**Stage 2: Generation** — LLM grounded in retrieved context

The top-$K$ crate descriptions are assembled into a prompt context:

$$\text{prompt} = \text{system\_prompt} + \text{context}(\text{crates}_1 \ldots \text{crates}_K) + \text{question}$$

Llama 3.1 8B generates the answer with $T = 0.3$ (low temperature for factual accuracy).

### Embedding Cost Analysis

BGE-small produces 384-dim vectors in ~5ms on Workers AI:

| Component | Latency | Cost |
|-----------|---------|------|
| Embed query | ~5ms | Free (Workers AI) |
| Vectorize query | ~2ms | $0.30 / M queries |
| LLM generation | ~500ms | $0.0001 / 1K tokens |
| **Total per query** | **~510ms** | **~$0.0001** |

### Complexity

| Operation | Time | Space |
|-----------|------|-------|
| Embed query | $O(V)$ (vocab projection) | $O(384)$ |
| Vector search | $O(\log N)$ (HNSW index) | $O(N \cdot 384)$ index |
| LLM generation | $O(T^2)$ (self-attention) | $O(T \cdot d)$ |
| Context assembly | $O(K)$ | $O(K \cdot \text{desc\_len})$ |

where $N$ = number of indexed crates, $T$ = generated tokens, $d$ = model dimension, $K$ = top results.

## Quick Start

### Deploy

```bash
cd superinstance-agent
npm install
npx wrangler deploy
```

### Use

```bash
# Ask a question
curl -X POST https://superinstance-agent.<account>.workers.dev/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How does the fleet handle distributed consensus?", "topK": 10}'

# Get crate recommendations
curl -X POST https://superinstance-agent.<account>.workers.dev/recommend \
  -H "Content-Type: application/json" \
  -d '{"task": "Build a rate-limited API gateway"}'

# Health check
curl https://superinstance-agent.<account>.workers.dev/health
```

## API

### `POST /ask`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | ✅ | Natural-language question |
| `topK` | number | ❌ | Max crates to retrieve (default: 10, max: 20) |

**Response:**

```json
{
  "question": "...",
  "answer": "LLM-generated answer with crate references",
  "citations": [{ "id": "...", "name": "...", "score": 0.92, "description": "..." }],
  "crates_searched": 10
}
```

### `POST /recommend`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | ✅ | Task description |
| `topK` | number | ❌ | Max candidates (default: 10, max: 20) |

### `GET /health`

Returns service status and binding health.

## Architecture Notes

This crate is part of the **SuperInstance ecosystem** and implements the **γ + η = C conservation law** at the agent interface. The user's question carries an implicit information content $\gamma$ (the semantic intent). The agent's answer carries $\eta$ (the retrieved + generated response). The conservation constraint $C$ requires that the answer fully addresses the question — no information is lost between intent and response.

The Vectorize index (`fleet-crates`) stores 384-dimensional BGE embeddings for 1,012+ crates. Each crate embedding represents the crate's $\gamma$-component (its identity in semantic space). Queries are $\eta$-probes that must find matching $\gamma$-components to achieve conservation.

## References

1. Lewis, P. et al. (2020). *"Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks."* NeurIPS.
2. Cloudflare. *Workers AI: BGE-small-en-v1.5.* <https://developers.cloudflare.com/workers-ai/models/bge-small-en-v1.5/>
3. Cloudflare. *Vectorize: Vector Database for Workers.* <https://developers.cloudflare.com/vectorize/>
4. Xiao, S. et al. (2023). *"C-Pack: Packed Resources For General Chinese Embeddings."* arXiv:2309.07597 (BGE model).

## License

MIT
