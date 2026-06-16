# Asclepius — AI Grounding / RAG Layer

**"Cite every claim, show uncertainty."** This document specifies the retrieval-augmented grounding layer that makes every AI-surfaced claim in Asclepius traceable to a literal span of source facility text, and attaches a calibrated uncertainty chip to every answer. It is the differentiating layer for the hackathon: no ungrounded prose ever reaches a user.

---

## 0. Scope, stack, and invariants

**Locked stack.** React + TypeScript SPA (Vite) via Databricks AppKit. Backend = AppKit Node/TS server.

```ts
// app/server/index.ts
import { createApp, server, analytics, servingEndpoint } from "@databricks/appkit";

export default createApp({
  plugins: [
    server(),            // custom backend routes: /api/cite, /api/llm, /api/assistant
    analytics(),         // SQL warehouse reads/writes — warehouse 5465d8c2d7be7f58
    servingEndpoint(),   // Foundation Models + Vector Search query proxy (SP identity)
  ],
});
```

Deploy as **ONE** Databricks App (Free Edition: max 3 apps, 24h auto-stop, serverless, no file >10MB in app dir). App service principal auto-injects identity via `X-Forwarded-Email` / `X-Forwarded-User`.

**Hard invariants (non-negotiable):**

1. **The app reads ONLY `workspace.app_state.*`.** Never raw v2/v3. RAG reads/writes happen in `app_state` (one new Delta table `facility_chunks`, one verdict cache `cite_cache`).
2. **Every AI claim carries a citation** = `{unique_id, field, char_start, char_end, quote}` where `quote` is a **literal substring** of the named source field. If we cannot produce that substring, we return `INSUFFICIENT_EVIDENCE` — we do not paraphrase, infer, or "round up."
3. **Every AI answer carries an uncertainty chip** in [0,100] with a band (`high` / `medium` / `low`) and the component breakdown, so the UI can show *why* it is (un)certain.
4. **Determinism for grounding.** `temperature = 0`, strict JSON (`response_format`), cache-first. Same input + same `source_version` → same verdict.

**Endpoints / models (serving):**

| Purpose | Endpoint | Notes |
|---|---|---|
| Embeddings (managed) | `databricks-gte-large-en` | 1024-dim, used by the VS index. |
| Cheap batch / classify | `databricks-meta-llama-3-1-8b-instruct` | symptom→specialty, chunk tagging, bulk pre-verify. |
| Default reasoning | `databricks-meta-llama-3-3-70b-instruct` | assistant turns, default cite verification. |
| Hard grounding / adjudication | `databricks-claude-opus-4-8` | contested claims, Trust Desk verdicts, EN/हिं synthesis. |

Vector Search: **one** endpoint (1 unit, Standard), **one** Delta Sync index over `facility_chunks`, **managed embeddings**, **TRIGGERED** sync.

---

## 1. `facility_chunks` — the citeable unit table

### 1.1 Design

Each facility's free text is split into **citeable units** (chunks). A chunk is the atom of retrieval AND the atom of citation: it is small enough that an LLM verdict over it is cheap and a cited span inside it is unambiguous, and it carries **field provenance** so a citation always names which source field (`description`, `capability`, `procedure`, `equipment`, or a specific `claims[i].text`) it came from.

Chunking rules:

- **Field-bounded.** A chunk never crosses a field boundary. This guarantees the `field` provenance is exact and the substring check runs against the right column.
- **Sentence-packed.** Within a field, pack sentences into chunks of ~**350–600 chars** (soft max 700) on sentence boundaries; never split a sentence. Short fields (e.g. a single `claims[i].text`) become one chunk.
- **Char offsets retained.** `field_char_start` / `field_char_end` are the chunk's offset *within its source field's full text*, so the citation engine can map a verified quote back to an absolute span in the original field.
- **One row per (facility, field, chunk_ix).** `chunk_id = sha2(unique_id || ':' || field || ':' || chunk_ix, 256)` — stable across rebuilds when text is unchanged.

### 1.2 Schema (Delta, CDF enabled)

```sql
CREATE TABLE IF NOT EXISTS workspace.app_state.facility_chunks (
  chunk_id        STRING    NOT NULL,   -- stable hash; VS primary key
  unique_id       STRING    NOT NULL,   -- FK -> app_state.facilities.id
  facility_name   STRING,               -- denormalized for display in citations
  field           STRING    NOT NULL,   -- 'description'|'capability'|'procedure'|'equipment'|'claim'|'evidence'
  claim_ix        INT,                  -- when field='claim': index into facilities.claims[]
  claim_status    STRING,               -- when field='claim': claims[i].status ('verified'|'review'|...)
  chunk_ix        INT       NOT NULL,   -- ordinal within (unique_id, field)
  text            STRING    NOT NULL,   -- the chunk text (embedded + cited against)
  field_char_start INT      NOT NULL,   -- offset within the source field's full text
  field_char_end   INT      NOT NULL,
  -- retrieval/filter facets (denormalized from facilities for index-side filtering):
  state           STRING,
  city            STRING,
  district        STRING,
  type            STRING,
  specialties     ARRAY<STRING>,        -- the 9 disciplines
  trust           STRING,               -- 'verified'|'review'|'unverified'
  conf            INT,                  -- facility confidence 0-100
  data_quality_flag STRING,
  coord_source    STRING,
  id_valid        BOOLEAN,
  source_version  STRING    NOT NULL,   -- tag for cache invalidation (e.g. 'v2-2026-06-15')
  updated_at      TIMESTAMP NOT NULL
)
USING DELTA
TBLPROPERTIES (
  delta.enableChangeDataFeed = true,         -- REQUIRED for Delta Sync index
  delta.enableDeletionVectors = false        -- DV off: Delta Sync compatibility
);
```

> CDF is mandatory: a Delta Sync index reads the change feed to apply incremental TRIGGERED syncs. `enableDeletionVectors=false` avoids the known Delta-Sync incompatibility.

### 1.3 Build SQL (from `app_state.facilities`)

The builder is a single MERGE so reruns are idempotent and TRIGGERED-sync friendly. We explode the four long text fields + the `claims[]` array, sentence-split with a regex UDF-free approach using `split` on sentence terminators, then window-pack into chunks. Below is the production form (Databricks SQL / Photon).

```sql
-- 0. Param: bump on any upstream rebuild so the verdict cache invalidates.
SET var.source_version = 'v2-2026-06-15';

-- 1. Normalize: one row per (facility, field, full_text). 'claims' explode separately.
CREATE OR REPLACE TEMP VIEW _ff AS
WITH base AS (
  SELECT id AS unique_id, name AS facility_name, state, city, district, type,
         specialties, trust, conf, data_quality_flag, coord_source, id_valid,
         description, capability, procedure, equipment, evidence, claims
  FROM workspace.app_state.facilities
),
long_fields AS (
  SELECT unique_id, facility_name, state, city, district, type, specialties, trust, conf,
         data_quality_flag, coord_source, id_valid,
         f.field, f.text AS full_text,
         CAST(NULL AS INT) AS claim_ix, CAST(NULL AS STRING) AS claim_status
  FROM base
  LATERAL VIEW explode(map(
      'description', description,
      'capability',  capability,
      'procedure',   procedure,
      'equipment',   equipment,
      'evidence',    evidence
  )) f AS field, text
  WHERE f.text IS NOT NULL AND length(trim(f.text)) > 0
),
claim_fields AS (
  SELECT unique_id, facility_name, state, city, district, type, specialties, trust, conf,
         data_quality_flag, coord_source, id_valid,
         'claim' AS field, c.text AS full_text,
         CAST(c.pos AS INT) AS claim_ix, c.status AS claim_status
  FROM base
  LATERAL VIEW posexplode(claims) c AS pos, claim_struct
  -- claim_struct is STRUCT<text,status>; alias projected below
  -- (Databricks: posexplode of array<struct> -> use c.claim_struct.text / .status)
)
SELECT * FROM long_fields
UNION ALL
SELECT unique_id, facility_name, state, city, district, type, specialties, trust, conf,
       data_quality_flag, coord_source, id_valid, field,
       claim_struct.text AS full_text, claim_ix, claim_struct.status AS claim_status
FROM claim_fields
WHERE claim_struct.text IS NOT NULL AND length(trim(claim_struct.text)) > 0;

-- 2. Sentence split with retained offsets. Split on . ! ? । (Devanagari danda) followed by space.
--    We keep the running char offset so citations map back to the original field.
CREATE OR REPLACE TEMP VIEW _sent AS
SELECT *,
       posexplode(
         filter(
           split(full_text, '(?<=[.!?।])\\s+'),  -- keep terminator with the sentence
           s -> length(trim(s)) > 0
         )
       ) AS (sent_ix, sentence)
FROM _ff;

-- 3. Compute each sentence's absolute char offset within its field (running prefix length),
--    then greedily pack sentences into <=600-char chunks (soft 700) on sentence boundaries.
CREATE OR REPLACE TEMP VIEW _offsets AS
SELECT *,
       -- absolute start = sum of lengths (+1 join space) of prior sentences in this field
       coalesce(sum(length(sentence) + 1)
         OVER (PARTITION BY unique_id, field, claim_ix
               ORDER BY sent_ix
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS sent_start
FROM _sent;

-- 4. Greedy pack: assign chunk_ix by cumulative length buckets of ~600 chars.
CREATE OR REPLACE TEMP VIEW _packed AS
SELECT *,
       CAST(floor(
         (sum(length(sentence) + 1)
            OVER (PARTITION BY unique_id, field, claim_ix
                  ORDER BY sent_ix
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - 1) / 600.0
       ) AS INT) AS chunk_ix
FROM _offsets;

-- 5. Collapse sentences -> chunk text + chunk char span.
CREATE OR REPLACE TEMP VIEW _chunks AS
SELECT unique_id, any_value(facility_name) AS facility_name,
       field, claim_ix, any_value(claim_status) AS claim_status, chunk_ix,
       concat_ws(' ', collect_list(sentence)) AS text,
       min(sent_start) AS field_char_start,
       max(sent_start + length(sentence)) AS field_char_end,
       any_value(state) AS state, any_value(city) AS city, any_value(district) AS district,
       any_value(type) AS type, any_value(specialties) AS specialties,
       any_value(trust) AS trust, any_value(conf) AS conf,
       any_value(data_quality_flag) AS data_quality_flag,
       any_value(coord_source) AS coord_source, any_value(id_valid) AS id_valid
FROM _packed
GROUP BY unique_id, field, claim_ix, chunk_ix;

-- 6. Idempotent MERGE into the target (stable chunk_id; TRIGGERED-sync friendly).
MERGE INTO workspace.app_state.facility_chunks AS t
USING (
  SELECT sha2(concat_ws(':', unique_id, field, coalesce(cast(claim_ix as string),'-'), cast(chunk_ix as string)), 256) AS chunk_id,
         *, '${var.source_version}' AS source_version, current_timestamp() AS updated_at
  FROM _chunks
) AS s
ON t.chunk_id = s.chunk_id
WHEN MATCHED AND (t.text <> s.text OR t.trust <> s.trust OR t.conf <> s.conf
                  OR t.source_version <> s.source_version) THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

-- 7. Remove chunks whose source rows/fields disappeared (keeps index lean).
DELETE FROM workspace.app_state.facility_chunks t
WHERE NOT EXISTS (
  SELECT 1 FROM _chunks s
  WHERE s.unique_id = t.unique_id AND s.field = t.field
    AND coalesce(s.claim_ix,-1) = coalesce(t.claim_ix,-1) AND s.chunk_ix = t.chunk_ix
);
```

> Expected scale: ~10,077 facilities × ~3–6 non-empty long fields + claims ≈ **40k–70k chunks**. Comfortable for 1 VS unit.

---

## 2. The Vector Search index (Delta Sync, managed embeddings, TRIGGERED)

### 2.1 Endpoint + index config

```python
from databricks.vector_search.client import VectorSearchClient
vsc = VectorSearchClient()  # SP auth inside the App

# One endpoint, 1 unit.
vsc.create_endpoint_and_wait(name="asclepius_vs", endpoint_type="STANDARD")

# One Delta Sync index with MANAGED embeddings via gte-large-en, TRIGGERED.
vsc.create_delta_sync_index_and_wait(
    endpoint_name="asclepius_vs",
    index_name="workspace.app_state.facility_chunks_idx",
    source_table_name="workspace.app_state.facility_chunks",
    primary_key="chunk_id",
    pipeline_type="TRIGGERED",                       # manual/scheduled sync, not CONTINUOUS
    embedding_source_column="text",                  # managed embeddings: VS embeds this column
    embedding_model_endpoint_name="databricks-gte-large-en",
    # columns surfaced on results + usable as metadata filters:
    columns=[
        "chunk_id","unique_id","facility_name","field","claim_ix","claim_status",
        "chunk_ix","text","field_char_start","field_char_end",
        "state","city","district","type","specialties","trust","conf",
        "data_quality_flag","coord_source","id_valid","source_version",
    ],
)
```

**TRIGGERED sync** is invoked after every `facility_chunks` rebuild (job step or `/api/admin/reindex` route):

```python
vsc.get_index("asclepius_vs", "workspace.app_state.facility_chunks_idx").sync()
```

### 2.2 Query (server-side proxy) and the two filter profiles

Asclepius has two retrieval surfaces with **different trust postures**:

- **Trust Desk** (verification/curation UI) — must only ground on **trustworthy, well-formed** rows.
- **Copilot** (open assistant / atlas) — may retrieve the **full corpus** so it can *surface and caveat* low-trust facilities (the uncertainty chip carries the warning rather than hiding the row).

```ts
// app/server/vs.ts — server proxy over the VS query REST API
type FilterProfile = "trust_desk" | "copilot";

function buildFilters(profile: FilterProfile, extra?: Record<string, unknown>) {
  const base = extra ?? {};
  if (profile === "trust_desk") {
    return {
      ...base,
      // Index-side filtering — VS supports equality, IN, NOT, comparison, LIKE.
      "trust": ["verified", "review"],   // exclude 'unverified'
      "id_valid": true,
      "conf >=": 60,
      "data_quality_flag NOT": "reject",
    };
  }
  // copilot: open corpus, no trust gate (uncertainty chip carries the caveat)
  return base;
}

export async function retrieve(opts: {
  queryText: string;
  profile: FilterProfile;
  numResults?: number;
  scope?: { state?: string; district?: string; specialty?: string; unique_id?: string };
}) {
  const filters: Record<string, unknown> = buildFilters(opts.profile);
  if (opts.scope?.state)     filters["state"] = opts.scope.state;
  if (opts.scope?.district)  filters["district"] = opts.scope.district;
  if (opts.scope?.specialty) filters["specialties"] = opts.scope.specialty; // ARRAY contains
  if (opts.scope?.unique_id) filters["unique_id"] = opts.scope.unique_id;    // single-facility cite

  // POST /api/2.0/vector-search/indexes/{index}/query
  return vsQuery({
    index: "workspace.app_state.facility_chunks_idx",
    query_text: opts.queryText,             // managed embeddings -> server embeds the text
    query_type: "HYBRID",                   // ANN + BM25; robust for short clinical terms/acronyms
    columns: ["chunk_id","unique_id","facility_name","field","text",
              "field_char_start","field_char_end","trust","conf","specialties",
              "claim_status","data_quality_flag","coord_source","source_version"],
    filters_json: JSON.stringify(filters),
    num_results: opts.numResults ?? 8,      // small k; the citation engine re-checks each
  });
}
```

**Per-facility filter for the Trust Desk cite path:** when verifying claims on a single open facility card, set `scope.unique_id = <id>` so retrieval is confined to that facility's own chunks — citations can never leak text from a *different* facility. Copilot omits `unique_id` and ranges over the (optionally state/specialty-scoped) corpus.

VS similarity scores are **normalized so the max possible is 1.0**; we use the returned score directly as `retrieval_sim` (see §4).

### 2.3 SQL keyword-filter fallback (if VS stalls)

VS on Free Edition can be cold/throttled or mid-sync. The retrieve proxy wraps VS in a timeout (1.5s) and on timeout/5xx falls back to a **keyword filter over `facility_chunks` via the analytics SQL warehouse** — same shape of result, lower recall, and the uncertainty engine adds a **throttle caveat** (§4) so the UI shows we degraded.

```sql
-- config/queries/cite_fallback.sql  (params: :q_terms array, :unique_id?, :profile_trust?)
WITH terms AS (SELECT explode(:q_terms) AS term)
SELECT c.chunk_id, c.unique_id, c.facility_name, c.field, c.text,
       c.field_char_start, c.field_char_end, c.trust, c.conf, c.specialties,
       c.claim_status, c.data_quality_flag, c.coord_source, c.source_version,
       -- crude lexical score: # distinct query terms present, length-normalized
       size(filter(transform((SELECT collect_list(term) FROM terms),
                             t -> CASE WHEN lower(c.text) LIKE concat('%', lower(t), '%')
                                       THEN 1 ELSE 0 END), x -> x = 1))
         / GREATEST(1, size((SELECT collect_list(term) FROM terms))) AS lex_score
FROM workspace.app_state.facility_chunks c
WHERE ( :unique_id IS NULL OR c.unique_id = :unique_id )
  AND ( :profile_trust = false OR (c.trust IN ('verified','review') AND c.id_valid AND c.conf >= 60) )
  AND EXISTS (SELECT 1 FROM terms WHERE lower(c.text) LIKE concat('%', lower(terms.term), '%'))
ORDER BY lex_score DESC, c.conf DESC
LIMIT 8;
```

`lex_score ∈ [0,1]` substitutes for `retrieval_sim` in the uncertainty formula, and `fallback=true` sets the throttle caveat.

---

## 3. The Citation Engine — `/api/cite`

**Contract:** given a claim (free text or a `claims[i]` from a facility) and a scope, return either a verified citation set or `INSUFFICIENT_EVIDENCE`. The engine *never* trusts the LLM's quote — it re-derives the literal span itself.

### 3.1 Pipeline

```
/api/cite { claim, scope, profile }
  1. cache lookup  (cite_cache keyed by hash(claim)+scope+source_version)  -> hit? return
  2. retrieve()    (VS HYBRID, then SQL fallback on stall)  -> top-k chunks
  3. LLM verify    (model routing per §5) -> strict JSON: {supported, chunk_id, quote, llm_conf, reason}
  4. SUBSTRING GUARD (the anti-hallucination core)  <-- enforced in code, not by the model
  5. uncertainty   (§4) -> chip + band
  6. persist verdict to cite_cache (tagged source_version)
  7. return { status, citations[], uncertainty, caveats[] }
```

### 3.2 The LLM verify call (strict JSON, temp 0)

System prompt (abridged): *"You are a citation verifier. Decide whether the CLAIM is directly supported by one of the provided SOURCE CHUNKS. You may ONLY cite text that appears verbatim in a chunk. Return the exact verbatim quote you relied on. If no chunk directly supports the claim, set supported=false. Never use outside knowledge."*

```jsonc
// response_format: { "type": "json_schema", ... }  — strict
{
  "supported": true,
  "chunk_id": "ab12…",
  "quote": "performs laparoscopic cholecystectomy and appendectomy",
  "llm_conf": 0.86,            // model's self-rated support strength [0,1]
  "reason": "chunk states the listed procedures explicitly"
}
```

### 3.3 The substring guard (anti-hallucination core)

The model's `quote` is treated as a **hypothesis**, not a fact. We verify it is a literal substring of the named chunk; if exact match fails we try a single **whitespace/diacritic-normalized** pass (to tolerate the model collapsing spaces), then re-anchor to absolute field offsets. Anything that does not anchor → `INSUFFICIENT_EVIDENCE`.

```ts
function anchorCitation(model: VerifyOut, chunk: Chunk): Citation | null {
  if (!model.supported) return null;
  const hay = chunk.text;
  const needle = model.quote ?? "";
  if (needle.length < 8) return null;                       // reject trivially-short "quotes"

  // (a) exact literal substring — the strict path
  let rel = hay.indexOf(needle);
  // (b) tolerant: normalize whitespace only (NOT meaning); map back to a real raw span
  if (rel < 0) {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const hn = norm(hay), nn = norm(needle);
    const i = hn.indexOf(nn);
    if (i < 0) return null;                                 // GUARD FAILS -> insufficient
    rel = mapNormIndexToRaw(hay, i);                        // re-anchor to raw chunk offsets
  }
  // absolute offsets within the original source field (for deep-linking + UI highlight)
  const absStart = chunk.field_char_start + rel;
  const absEnd   = absStart + needle.length;
  return {
    unique_id: chunk.unique_id,
    facility_name: chunk.facility_name,
    field: chunk.field,
    char_start: absStart, char_end: absEnd,
    quote: hay.slice(rel, rel + needle.length),             // the REAL substring, not the model's
    chunk_id: chunk.chunk_id,
    claim_status: chunk.claim_status ?? null,
  };
}
```

```ts
// /api/cite handler core
const cands = await retrieve({ queryText: claim, profile, numResults: 8, scope });
const top = cands.results.slice(0, 6);
const verdict = await llmVerify(claim, top);                 // §5 routing, temp 0, JSON
const chunk = top.find(c => c.chunk_id === verdict.chunk_id);
const citation = chunk ? anchorCitation(verdict, chunk) : null;

if (!citation) {
  return json({ status: "INSUFFICIENT_EVIDENCE",
                citations: [],
                uncertainty: { score: 0, band: "low", reason: "no anchored span" },
                caveats: ["No source text directly supports this claim."] });
}
const unc = computeUncertainty({ verdict, chunk, citation, cands, fallback });
await cacheVerdict(claim, scope, sourceVersion, { citation, unc });
return json({ status: "CITED", citations: [citation], uncertainty: unc, caveats: unc.caveats });
```

> **Why the guard wins the hackathon:** the judging rubric rewards "cite every claim, show uncertainty." A model can hallucinate a plausible quote; the substring guard makes that *structurally impossible* to surface — if the bytes aren't in the source, the claim is downgraded to `INSUFFICIENT_EVIDENCE`. Every green "cited" badge in the UI is byte-for-byte real.

---

## 4. The Uncertainty Score (one chip)

A single confidence chip in **[0,100]** blends retrieval quality, model confidence, and **data-layer provenance signals** unique to this dataset. Each factor is a multiplier in [0,1] on a base; penalties subtract.

### 4.1 Components

| Symbol | Source | Range | Meaning |
|---|---|---|---|
| `sim` | VS score (or `lex_score` on fallback) of the cited chunk | [0,1] | retrieval similarity |
| `llm` | `verify.llm_conf` | [0,1] | model's support strength |
| `cov` | field coverage = distinct supporting fields / fields expected for claim type | [0,1] | breadth of evidence |
| `sparse` | sparse-field penalty (chunk's source field very short / boilerplate) | {0, 0.10} | thin evidence |
| `coordP` | `coord_source ∈ {gps, geocoded_exact}`→0, `centroid/pincode`→0.05, `unknown`→0.10 | {0,.05,.10} | location trust |
| `xwalk` | crosswalk status: facility mapped in `facility_district`→0, unmapped→0.07 | {0,.07} | district linkage |
| `throttle` | VS fallback used (SQL keyword path) | {0, 0.12} | degraded retrieval caveat |

### 4.2 Formula

```
raw = 100
    * (0.45*sim + 0.35*llm + 0.20*cov)        // weighted evidence core (weights sum to 1)
    * trust_mult                              // trust gate: verified=1.00, review=0.90, unverified=0.75
    - 100 * (sparse + coordP + xwalk + throttle)   // provenance penalties

score = clamp(round(raw), 0, 100)

band  = score >= 75 ? "high"
      : score >= 50 ? "medium"
      :               "low"
```

`trust_mult` folds the facility's own `trust` label into the chip so a perfectly-retrieved claim on an `unverified` row still can't read as "high." If `status = INSUFFICIENT_EVIDENCE`, `score = 0`, `band = low` (no citation → no confidence).

### 4.3 Reference implementation

```ts
function computeUncertainty(x: {
  verdict: VerifyOut; chunk: Chunk; citation: Citation;
  cands: VsResults; fallback: boolean;
}) {
  const sim = clamp01(x.fallback ? x.chunk.lex_score ?? 0 : x.chunk.score ?? 0);
  const llm = clamp01(x.verdict.llm_conf ?? 0);
  const cov = clamp01(coverageForClaim(x.cands, x.citation));     // distinct supporting fields / expected

  const trustMult = x.chunk.trust === "verified" ? 1.0
                  : x.chunk.trust === "review"   ? 0.90 : 0.75;

  const sparse   = isSparseField(x.chunk) ? 0.10 : 0;
  const coordP   = ({ gps:0, geocoded_exact:0, centroid:0.05, pincode:0.05, unknown:0.10 } as any)
                    [x.chunk.coord_source] ?? 0.10;
  const xwalk    = x.chunk.crosswalk_mapped ? 0 : 0.07;
  const throttle = x.fallback ? 0.12 : 0;

  const raw = 100 * (0.45*sim + 0.35*llm + 0.20*cov) * trustMult
            - 100 * (sparse + coordP + xwalk + throttle);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const band  = score >= 75 ? "high" : score >= 50 ? "medium" : "low";

  const caveats: string[] = [];
  if (x.fallback)            caveats.push("Retrieval degraded to keyword search (vector index busy).");
  if (sparse)               caveats.push("Evidence comes from a short / sparse source field.");
  if (coordP >= 0.10)       caveats.push("Facility location is unverified.");
  if (xwalk)                caveats.push("Facility not mapped to an NFHS district.");
  if (x.chunk.trust !== "verified") caveats.push(`Facility trust level: ${x.chunk.trust}.`);

  return { score, band, components: { sim, llm, cov, trustMult, sparse, coordP, xwalk, throttle }, caveats };
}
```

The chip ships its `components` to the client so the UI can render the breakdown on hover — that *is* the "show uncertainty" deliverable.

---

## 5. Foundation Model service — `/api/llm`

A single internal LLM gateway with **model routing**, `temperature=0` for grounding tasks, strict JSON, **429 backoff**, and a **cache-first** Delta verdict cache.

### 5.1 Model routing

```ts
type Task = "classify" | "verify" | "assistant" | "hard_ground";
function routeModel(t: Task, opts?: { contested?: boolean; lang?: "en"|"hi" }): string {
  switch (t) {
    case "classify":     return "databricks-meta-llama-3-1-8b-instruct";      // cheap batch
    case "verify":       return opts?.contested
                                ? "databricks-claude-opus-4-8"                // escalate contested cites
                                : "databricks-meta-llama-3-3-70b-instruct";   // default verify
    case "assistant":    return "databricks-meta-llama-3-3-70b-instruct";
    case "hard_ground":  return "databricks-claude-opus-4-8";                 // Trust Desk verdicts, EN/हिं
  }
}
```

Escalation rule: a `verify` call whose 70b result is `supported=true` **but** the substring guard fails, OR `llm_conf` ∈ [0.4,0.6] (ambiguous), is retried once on `databricks-claude-opus-4-8` (`contested=true`) before we conclude `INSUFFICIENT_EVIDENCE`.

### 5.2 Call contract (temp 0, strict JSON, backoff)

```ts
async function llmCall(req: {
  task: Task; messages: ChatMessage[]; schema?: JsonSchema; lang?: "en"|"hi"; contested?: boolean;
}): Promise<any> {
  const model = routeModel(req.task, { contested: req.contested, lang: req.lang });
  const body = {
    messages: req.messages,
    temperature: 0,                              // determinism for grounding
    max_tokens: req.task === "assistant" ? 900 : 400,
    response_format: req.schema
      ? { type: "json_schema", json_schema: { name: "out", schema: req.schema, strict: true } }
      : { type: "json_object" },
  };
  // POST /serving-endpoints/{model}/invocations  via servingEndpoint() plugin (SP auth)
  return withBackoff(() => serving.invoke(model, body));
}

async function withBackoff<T>(fn: () => Promise<T>, max = 5): Promise<T> {
  let delay = 500;
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      if (status !== 429 && !(status >= 500) || i >= max) throw e;
      const ra = Number(e?.response?.headers?.["retry-after"]); // honor Retry-After if present
      const wait = Number.isFinite(ra) ? ra * 1000 : delay + Math.random() * 250; // jitter
      await sleep(wait);
      delay = Math.min(delay * 2, 8000);          // exponential, capped
    }
  }
}
```

> Foundation Model APIs return **HTTP 429** on rate/throughput limits (pay-per-token has account-level QPS/token caps); we honor `Retry-After` when present and otherwise use capped exponential backoff with jitter. 5xx is retried identically.

### 5.3 Cache-first verdict cache (Delta, tagged `source_version`)

```sql
CREATE TABLE IF NOT EXISTS workspace.app_state.cite_cache (
  cache_key       STRING NOT NULL,   -- sha2(task || claim_norm || scope_json || model)
  task            STRING NOT NULL,
  source_version  STRING NOT NULL,   -- verdict valid ONLY for this corpus version
  model           STRING NOT NULL,
  result_json     STRING NOT NULL,   -- {citation, uncertainty, caveats} or INSUFFICIENT_EVIDENCE
  created_at      TIMESTAMP NOT NULL
) USING DELTA TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

- **Read path:** `/api/cite` and `/api/llm` (verify/classify) check `cite_cache WHERE cache_key=? AND source_version=?` first. Hit → return instantly (no model call, no 429 exposure).
- **Invalidation:** bump `source_version` in the chunk rebuild (§1.3 step 0). Old rows are ignored (never read) and swept by a weekly `DELETE WHERE source_version <> current`.
- Only **verify/classify/hard_ground** verdicts are cached (deterministic at temp 0). Free-form `assistant` turns are **not** cached.

---

## 6. Multi-persona AI assistant grounding (`buildDataContext`)

The Copilot is multi-persona (e.g. *Clinician*, *Planner/NGO*, *Volunteer*) and bilingual (EN / हिं). Every assistant turn is grounded by assembling a compact, **already-cited** context bundle from `app_state` — the assistant may only speak from this bundle plus `/api/cite`-verified spans.

### 6.1 `buildDataContext`

```ts
async function buildDataContext(turn: {
  persona: "clinician"|"planner"|"volunteer";
  query: string; lang: "en"|"hi"; scope?: Scope;
}): Promise<GroundingBundle> {
  // 1. FACILITIES slice — retrieve cited chunks (Copilot profile = open corpus, caveated)
  const facCands = await retrieve({ queryText: turn.query, profile: "copilot",
                                    numResults: 8, scope: turn.scope });

  // 2. ATLAS slice — district/state aggregates from gold views (deterministic, no LLM)
  const atlas = await sql("config/queries/atlas_context.sql", {           // gold_district_supply_need,
    state: turn.scope?.state, district: turn.scope?.district });          // district_health, state_coverage

  // 3. AGENTS slice — OLTP roster/availability the persona is allowed to see (accounts/roster)
  const agents = turn.persona !== "volunteer"
    ? await sql("config/queries/agents_context.sql", { scope: turn.scope }) : [];

  // 4. Persona system prompt + grounding rules + language
  return {
    system: personaSystem(turn.persona, turn.lang),  // includes "only cite provided spans"
    facilities: facCands.results,                    // each carries chunk text + provenance
    atlas, agents,
    citeRequired: true,                              // any factual sentence must call /api/cite
  };
}
```

### 6.2 Grounding rules baked into the persona system prompt

- **No claim without a span.** When the assistant states a fact about a facility, it must emit a `cite_request` for it; the server resolves each via `/api/cite` (§3) and only keeps sentences that anchor. Unanchored sentences are stripped and replaced with an `INSUFFICIENT_EVIDENCE` note.
- **Atlas numbers are deterministic** (from gold views) and rendered as `{value, source_view, district}` — labeled as aggregates, not per-facility claims.
- **Uncertainty chip per message.** The message-level chip = min over the cited claims' chips (a message is only as confident as its weakest cited claim), plus the throttle caveat if any retrieval fell back.
- **Bilingual integrity (EN/हिं).** Quotes are shown in the **source language** of the facility text (we never translate a *quote*, only the surrounding explanation), so the substring guard still holds against the original bytes. `hard_ground` (opus) handles हिं synthesis when the persona answers in Hindi.

### 6.3 Flow

```
user turn -> buildDataContext (facilities + atlas + agents, persona, lang)
          -> assistant drafts answer w/ cite_requests
          -> server resolves each cite_request via /api/cite (cache-first)
          -> strip unanchored sentences; attach citations + per-claim chips
          -> message-level uncertainty = min(chips); collect caveats
          -> render: prose + inline [facility • field] citations + one confidence chip
```

---

## 7. Operational notes

- **Single App footprint:** `facility_chunks` + `facility_chunks_idx` + `cite_cache` all live in `app_state`; the VS endpoint (1 unit) is the only standing compute. No file in the app dir exceeds 10MB (queries are `.sql`, models are remote).
- **Reindex cadence:** TRIGGERED. After any `facilities` rebuild → run §1.3 MERGE → bump `source_version` → `index.sync()` → (cache auto-invalidates).
- **Cold-start / 24h auto-stop:** first request after auto-stop may hit a cold VS endpoint → the 1.5s timeout trips the SQL keyword fallback (§2.3) so the user still gets a (throttle-caveated) cited answer instead of an error.
- **Determinism contract:** `(claim, scope, source_version)` → identical verdict, because temp 0 + cache + substring guard remove the two sources of drift (sampling and retrieval jitter is bounded by re-verification).

---

## Appendix — summary of the two load-bearing pieces

**Citation guard (anti-hallucination):** retrieve top-k chunks → LLM proposes `{chunk_id, quote}` → the server independently verifies `quote` is a **literal substring** of that chunk's `text` (exact, then whitespace-normalized re-anchored to raw offsets); rejects quotes < 8 chars; on failure escalates once to `databricks-claude-opus-4-8`, then returns `INSUFFICIENT_EVIDENCE`. The emitted `quote` is always the *real* substring sliced from source, not the model's text — so no displayed citation can be hallucinated.

**Uncertainty formula:**
```
score = clamp( round(
          100 * (0.45*sim + 0.35*llm + 0.20*cov) * trust_mult
        - 100 * (sparse + coordP + xwalk + throttle)
        ), 0, 100 )
band  = score>=75 high | >=50 medium | else low
```
where `sim`=retrieval similarity (VS score or `lex_score` on fallback), `llm`=model support self-rating, `cov`=field coverage, `trust_mult`∈{1.0,0.90,0.75} for verified/review/unverified, and the penalties are sparse-field (0.10), coord_source (0/.05/.10), crosswalk-unmapped (0.07), and throttle/fallback (0.12). `INSUFFICIENT_EVIDENCE → score 0`.
