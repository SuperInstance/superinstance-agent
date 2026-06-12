# Debug Report: RAG Agent Missing Descriptions

**Date:** 2026-06-11  
**Issue:** superinstance-agent returns `description:""` for all crate citations despite enrichment data being present in the vector index.

## Root Cause

**Metadata field name mismatch between ingest and query.**

The pipeline has two storage layers:

| Layer | Service | Field Name | Has Full Metadata? |
|-------|---------|------------|--------------------|
| Vectorize metadata | `fleet-vector-api` ingest | `desc` | No — truncated to 200 chars |
| KV store | `fleet-vector-api` ingest | `description` | Yes — full text |

The enrichment agent re-ingested 1,512 crates with descriptions into `fleet-vector-api`. The `/ingest` handler stores metadata in Vectorize with the field name **`desc`** (shortened, ~200 chars), and stores full metadata in KV with the field name **`description`**.

The `superinstance-agent` queries **Vectorize directly** (not fleet-vector-api's `/search` endpoint). It looks for `metadata.description` — but Vectorize only has `metadata.desc`. Neither field matches, so every citation gets `description: ""`.

### Code Locations

- **Ingest (fleet-vector-api):** `src/index.ts` → `handleIngest()` → Vectorize metadata uses `desc`
  ```typescript
  metadata: {
    name: c.name,
    desc: c.description?.slice(0, 200) || '',  // <-- "desc" not "description"
    ...
  }
  ```
- **Query (superinstance-agent):** `src/index.ts` → `buildContext()` and citation builders look for `meta.description`
  ```typescript
  const description = meta.description || meta.doc || "No description available";
  // "desc" was never checked
  ```

## Fix Applied

Added `meta.desc` as a fallback in three locations in `superinstance-agent/src/index.ts`:

1. **`buildContext()`** — context building for LLM prompt
2. **`/ask` citations** — citation metadata returned to caller
3. **`/recommend` recommended_crates** — recommendation metadata

```typescript
// Before
meta.description || meta.doc

// After
meta.description || meta.desc || meta.doc
```

**Commit:** `2b27a33` — `fix: map Vectorize metadata 'desc' field to description`

## Test Results

### Before Fix (deployed version)

Query: `"ternary signal processing"` via `/ask` endpoint:

```
ternary-signals: description=""
ternary-signal-flow: description=""
ternary-transform: description=""
```

All descriptions empty. Data exists in fleet-vector-api (enriched from KV) but not in Vectorize metadata.

### Verification: Data Exists in fleet-vector-api

Same query via fleet-vector-api `/search` (which enriches from KV):

```
ternary-signals: description="Ternary signal processing: convolution, spectral analysis, filtering"
ternary-signal-flow: description="Experiment: ternary signal flow through GPU processing pipeline..."
ternary-transform: description="Transform theory for ternary data on {-1, 0, +1}"
```

### After Fix (requires redeployment)

The fix is committed and ready to deploy. Once deployed, the agent will read `desc` from Vectorize metadata and populate descriptions correctly.

## Deployment Required

The fix is committed but not yet deployed. The Cloudflare auth token is expired. To deploy:

```bash
cd /home/phoenix/repos/superinstance-agent
# Set valid CLOUDFLARE_API_TOKEN first
npx wrangler deploy
```

Then verify:
```bash
curl -s -X POST "https://superinstance-agent.casey-digennaro.workers.dev/ask" \
  -d '{"question": "ternary signal processing", "topK": 3}' | python3 -m json.tool
```

## Architecture Note

Both services share the same Vectorize index (`fleet-crates`) and same binding name (`CRATE_INDEX`). The issue was purely a field naming convention mismatch. For long-term robustness, consider:

1. **Standardize field names** — use `description` everywhere (in both Vectorize metadata and KV)
2. **Or have superinstance-agent call fleet-vector-api's `/search`** — which already enriches from KV with full metadata, rather than querying Vectorize directly
3. **Add field mapping tests** — prevent regressions when either service changes metadata schema
