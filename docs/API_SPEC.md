# Asclepius — Backend API Surface (AppKit Node/TS server)

> **Stack (LOCKED).** React + TypeScript via Databricks AppKit (Vite SPA). Single Node/TS server: `createApp({ plugins: [server(), analytics(), servingEndpoint()] })`.
> - `analytics()` → SQL warehouse `5465d8c2d7be7f58` (profile `team`). Reads via `config/queries/*.sql`; writes via custom routes.
> - `servingEndpoint()` → Foundation Models: `databricks-claude-opus-4-8` (assistant), `databricks-meta-llama-3-3-70b-instruct` (default), `databricks-meta-llama-3-1-8b-instruct` (cheap batch), `databricks-gte-large-en` (embeddings).
> - 1 Vector Search index (Delta Sync, 1 endpoint / 1 unit, TRIGGERED) over facility text.
> - Deploy as ONE Databricks App, Free Edition (serverless, 24h auto-stop, no file >10MB).
> - **Identity:** App SP auto-injects `X-Forwarded-Email` / `X-Forwarded-User`. Every write captures `created_by = X-Forwarded-Email`. No passwords anywhere (DEC-001).
> - **Persistence target:** Lakebase Postgres (write tables in `app_state`), Delta fallback. App reads ONLY `app_state.*` views — never raw v2/v3.

This spec is derived directly from the prototype logic class (`Asclepius.dc.html`, `class Component extends DCLogic`). The prototype kept ALL state in a single `localStorage` key `asclepius_v1` and computed every score client-side in `renderVals()` over a 10-facility demo slice. The build splits this into:
- **READ endpoints** backed by `config/queries/*.sql` over the full registry (10,077 rows) + derived `app_state` tables.
- **WRITE endpoints** (REST) — one per persistence table — replacing the 17 localStorage keys.

---

## 0. Conventions

- Base path `/api`. JSON in/out. All times ISO-8601 UTC.
- **Identity middleware** reads `X-Forwarded-Email` → `email`, `X-Forwarded-User` → `display`. If absent (local dev) fall back to `dev@asclepius.local`. This value is `created_by` on every write and the implicit owner filter on every "my …" read.
- Errors: `{ "error": { "code": string, "message": string } }`, HTTP 4xx/5xx.
- Pagination: `?limit` (default 60, the prototype's `.slice(0,60)` cap) `&offset`.
- `id` columns: server-generated `gen_random_uuid()` in Lakebase (prototype used `pfx_+Date.now()`).

---

## 1. Server-vs-client scoring decision

**Rule of thumb from the prototype:** the formulas are cheap arithmetic, but the *inputs* differ. Anything that must rank/aggregate across the **full 10,077-row registry** runs **server-side in SQL** (you cannot ship 10k rows + their per-row scores to the browser on Free Edition). Anything that re-ranks a **small, already-fetched result set** in response to a UI toggle runs **client-side** (no round-trip, instant).

### Runs SERVER-side (SQL over full registry / derived tables)

| Score | Where it appears | Formula (reproduced exactly from `renderVals` / helpers) |
|---|---|---|
| **Patient fit** | `/api/search/patient` | `fit = clamp(22,98, round( (hasNeeds ? 14 + coverFrac*48 : 42) + tScore(trust)*24 + prox*16 ))` where `coverFrac = matchedSpecialties/selectedNeeds`, `tScore = verified→1, review→0.6, else 0.3`, `prox = max(0, 1 - dist/radius)`. Breakdown points: `needPts=round(14+coverFrac*48)` (or 42), `trustPts=round(tScore*24)`, `proxPts=round(prox*16)`. Sort `fit DESC, dist ASC`. Filter `dist <= radius`. Distance = haversine(origin_ll, facility_ll). |
| **Hospital gap** | `/api/coverage` | Per discipline: `coverage = min(100, facCount*28 + (roster>0 ? 18 + roster*7 : 0))`; `demand = demandFor(city,disc)` (from `app_state.district_demand` / burden); `gap = demand - coverage`. Status: `gap>=30 Critical`, `gap>=10 Thin`, `coverage-demand>=28 && facCount>=2 Overlap`, else `Covered`. `facCount` = facilities within 170 km offering the discipline. Sort `gap DESC`. |
| **Agent relevance** | `/api/agents` | `relevance = (matchesWeak?60:0) + (subMatch?28:0) + round(demand*0.3) + (relocate?8:0) + (tele?5:0)`. `matchesWeak` = discipline in the hospital's weak set (gap>=10); `subMatch` = agent.subs includes `subNeedFor(city,disc)`. Sort `relevance DESC`. |
| **DQ score** | `/api/registry`, `/api/registry/quality` | `score=100`; subtract weights: beds-missing 16, year-missing 11, equipment-missing 13, procedure-missing 9, unverified-capabilities 18, possible-duplicate 22, stale-record 9, per-batch unverified-claims 7; `+12` if user-confirmed review exists. `clamp(0,100)`. Aggregations (overall readiness avg, field-coverage %, worst-first queue) MUST be SQL over all 10,077 rows. |
| **Freshness decay** | facility detail, DQ | If a user review exists: `decayedConf=conf, stale=false, monthsOld=0` (verified-by-you). Else `monthsOld = 2 + hash(id)%34`, `lost = min(40, round(monthsOld*1.2))`, `decayedConf = max(20, conf - lost)`, `stale = monthsOld>=18`. (Hash is deterministic; in the build replace the synthetic `monthsOld` with `coord_source` / crawl date from `app_state.facilities`.) |
| **Coverage / prevalence (atlas)** | `/api/atlas` | Prototype modelled these; build reads **REAL** values from `app_state.state_coverage.coverage_index`, `app_state.district_health.*`, `app_state.state_health.*`, `app_state.gold_district_supply_need.desert_score/desert_rank`. No client computation — values are pre-materialized. |
| **Vector / semantic facility search** | `/api/search/semantic` | Vector Search index over facility `description`/`evidence` (embeddings `databricks-gte-large-en`). Server-only. |

### Runs CLIENT-side (small fetched result set, instant UI toggle)

| Behavior | Why client-side |
|---|---|
| **Posting rank** (`subMatch?100:0 + urgency(20/10/0) + mine?-3`) | Operates on the few postings for one discipline already returned by `/api/postings?discipline=`. Re-sorts on `cSub` toggle with no round-trip. |
| **Clinician opps tab toggle** (Live openings / Inferred gaps / Offers it) | Each tab is its own endpoint; the *active tab* + chip selection is pure client state. |
| **Compare tray, command-palette filter, fit-label bucketing** (`fit>=78 Strong` …), trust/claim badge styling, map-pin projection | Presentation over already-fetched rows. |
| **Saved-search match preview** (re-count on chip change) | Cheap; can also hit `/api/registry?…&countOnly=1` if the registry is large — prefer server count for accuracy over 10k rows. |
| **Roster steppers / scenario gap preview** | Local until "Save scenario" / "Save as scenario" POST. The *authoritative* gap recompute on save is server-side. |

**Net:** 5 scoring families server-side (patient fit, hospital gap, agent relevance, DQ/readiness, atlas) + semantic search; ~6 presentational re-rank/format behaviors client-side.

---

## 2. READ endpoints (`config/queries/*.sql` via `analytics()`)

All read from `app_state.*` only.

### 2.1 Facility search + filter (registry browse, 10,077 rows)
**`GET /api/registry`** — `query.sql: registry_browse.sql`
Params: `q, state, type, trust, limit, offset`.
SQL: `SELECT id,name,type,city,state,lat,lng,specialties,trust,conf,beds,year,description,capability,procedure,equipment FROM app_state.facilities WHERE (:state='All' OR state=:state) AND (:type='All' OR type=:type) AND (:trust='All' OR trust=:trust) AND (:q='' OR lower(name) LIKE :q OR lower(city) LIKE :q OR lower(capability) LIKE :q OR array_contains(specialties, :q)) …` plus the **DQ score** computed in SQL (CASE-WHEN weight subtraction above) as `dq_score`. Returns rows + `{ total, shown }`.
Response item: `{ id,name,type,city,state,specialties[],trust,conf,beds,year,dqScore }`.

### 2.2 Patient search (fit-scored)
**`GET /api/search/patient`** — `query.sql: patient_results.sql`
Params: `origin` (city or lat,lng), `radius` (km, 50–650), `needs` (comma list of need keys → specialties via `app_state.ref_needs`).
SQL computes haversine distance, `coverFrac`, fit (formula §1), filters `dist<=radius`, sorts `fit DESC, dist ASC`. Returns each facility + `{ fit, dist, matched[], breakdown:[{label,pts,src}] }`.

### 2.3 Semantic facility search (Vector Search)
**`GET /api/search/semantic`** — Params `q, k`. Hits the Vector Search index (Delta Sync, TRIGGERED) on facility text; returns ranked `{ id, name, score, snippet }`. Used by the assistant + free-text registry queries.

### 2.4 Facility detail
**`GET /api/facilities/:id`** — `query.sql: facility_detail.sql`
Returns full `app_state.facilities` row: identity, `specialties[]`, `specialties_detail[]`, `needs[]`, `claims[{text,status}]`, `description, evidence, capability, procedure, equipment, beds, year`, `pincode, district, data_quality_flag, possible_entity_dup, id_valid, coord_source`. Server attaches: `dq` (score+issues), `freshness` (decayedConf/monthsOld/stale per §1), `phone` (synthetic), `parsed[]` (raw→structured w/ confidence), and the user's own `reviews/overrides/claimReviews` for this id (joined from `app_state` write tables, owner = email).

### 2.5 Registry — data quality desk
**`GET /api/registry/quality`** — `query.sql: dq_field_coverage.sql` + `dq_queue.sql`
Returns `{ overall (avg dq over all rows), fields:[{label,pct,canon}] (REGFIELDS: description 100, capability 99.7, procedure 92.5, equipment 77, capacity 25, year 48), queue:[ worst-first rows dq<70 with issues[] ], queueCount }`. All aggregation in SQL.

### 2.6 Registry — duplicates
**`GET /api/registry/duplicates`** — `query.sql: dup_pairs.sql`
`SELECT … FROM app_state.facilities WHERE possible_entity_dup IS NOT NULL` joined to its base record; left-join `app_state.dup_decisions` (owner) for current decision. Returns `pairs:[{id, a:{…}, b:{…}, decision}]`, `openCount`.

### 2.7 Atlas (coverage + health conditions)
**`GET /api/atlas`** — `query.sql: atlas_state.sql`
Params: `mode` (`coverage`|`health`), `layer` (one of 7 health keys: ncd, anaemia, malnutrition, womensnut, acutechild, cancerscreen, riskfactors), `disc` (optional).
- coverage → `app_state.state_coverage` (`coverage_index 0-100`, `facility_count`).
- health → `app_state.state_health` / `app_state.district_health` (REAL NFHS-5 0-100 per layer).
Returns per-region values + `{ best:[…], lowest:[…] }` panels. (Color ramps applied client-side: coverage green `rgb(234,243,238)→rgb(18,78,61)` γ0.8; prevalence red `rgb(252,239,231)→rgb(140,45,26)` γ0.85.)

### 2.8 Desert planner
**`GET /api/desert`** — `query.sql: desert_districts.sql`
`SELECT nfhs_district, desert_score, desert_rank, facility_count, ncd, anaemia, malnutrition, womensnut, acutechild, cancerscreen, riskfactors FROM app_state.gold_district_supply_need ORDER BY desert_rank` (706 rows). Params `state, limit`. Drives the Medical Desert Planner.

### 2.9 Demand (district demand by discipline)
**`GET /api/demand`** — `query.sql: district_demand.sql`
Params `district, state, discipline`. `SELECT nfhs_district, state, discipline, demand_score, top_driver FROM app_state.district_demand`. Backs `demandFor(city,disc)` and `subNeedFor` used by coverage + agent relevance.

### 2.10 Coverage (hospital, gap-scored)
**`GET /api/coverage`** — `query.sql: hospital_coverage.sql`
Params: `city` (or district), plus the caller's roster (`roster[discipline]=n`, from the hospital's persisted roster row — server can also load it by `created_by`).
SQL: for each of the 9 disciplines compute `facCount` (within 170 km offering it, over full registry), join `demand`, compute `coverage`/`gap`/`status` (§1), sort `gap DESC`. Returns `rows[]`, `weakPoints[]` (gap>=10, top 3, with `subNeed`), `drivers[]`.

### 2.11 Recruiter / free agents (relevance-scored)
**`GET /api/agents`** — `query.sql: agents.sql`
Params: `city, spec` (optional focus filter).
Source = seed agents (materialize `_baseAgents` into `app_state` ref or a seed table) **UNION** `app_state.accounts WHERE role='doctor'` (a doctor sign-up becomes a free agent). Compute `relevance` (§1) using the city's weak set + sub-need; sort `relevance DESC`. Returns `{ id,name,spec,sub,subs[],years,city,avail,relocate,tele,blurb, relevance, matchesWeak, subMatch, neededSub }`.

### 2.12 State coverage list / crosswalks (support reads)
**`GET /api/states/coverage`** → `app_state.state_coverage`. **`GET /api/districts/crosswalk`** → `app_state.district_crosswalk`. **`GET /api/ref/:dim`** → `ref_disciplines | ref_specialty_discipline | ref_sub_specialties | ref_needs | ref_symptom_specialty | ref_health_layers` (static dims for chips/filters).

### 2.13 AI assistant (grounded)
**`POST /api/assistant`** — Body `{ messages:[{role,text}], lang:'en'|'hi', role, context:{ city?, needs?, spec? } }`.
Server builds the grounding context from `app_state` (facilities snippet via Vector Search top-k, agents, live postings, atlas best/worst from `state_coverage`), prompts `databricks-claude-opus-4-8` (reproduce `buildPrompt` system text incl. Hindi switch), returns `{ answer, actions:[{label,kind,payload}] }` (agentic chips: post-opening, see-agents, open-facility, save, open-atlas). Falls back to a deterministic local answer on error.

---

## 3. WRITE endpoints (REST routes, custom backend via `server()`)

Each writes to a `app_state` OLTP table (Lakebase Postgres; Delta fallback). `created_by`/owner = `X-Forwarded-Email`. These replace the 17 `localStorage` keys. Methods follow the prototype's toggle semantics (most handlers toggle add/remove).

| # | Route | Method(s) | app_state table | Payload | Source handler |
|---|---|---|---|---|---|
| 1 | `/api/accounts` | `POST` (sign up) | `accounts` | `{ email, display_name, role('patient'\|'doctor'\|'hospital_admin'), city, specialty?, sub_specialty?, years_experience?, availability?, relocate?, telehealth?, hospital_city? }` — **NO password** (DEC-001). `account_id` server-gen, `created_at`, `created_by=email`. A `doctor` row is simultaneously a free-agent listing (surfaced by `/api/agents`). | `createAccount()` |
| 1b | `/api/accounts/login` | `POST` | `accounts` (read) | `{ email }` → returns profile + role (no password check). | `login()` |
| 1c | `/api/accounts/me` | `GET` | `accounts` | identity from header → current profile. | `applyProfile()` |
| 2 | `/api/shortlist` | `GET`, `POST` (toggle), `DELETE /:facilityId` | `shortlist` | `{ facility_id }`. Toggle add/remove; owner-scoped. Supports share-hash bulk-add (`#s=ids`). | `toggleSave()`, `applyShareHash()` |
| 3 | `/api/notes` | `GET`, `PUT /:facilityId` | `notes` | `{ facility_id, text }`. Upsert one note per (owner, facility). | `saveNote()` |
| 4 | `/api/reviews` | `GET`, `POST` | `reviews` | `{ facility_id, decision('confirmed'\|'site_visit'), via('manual'\|'call'), claim_label? , claim_decision('confirmed'\|'disputed')? }`. `decision` refreshes confidence/freshness; `claim_*` records per-claim confirm/dispute. Re-POST same value = clear (toggle). | `reviewFacility()`, `reviewClaim()` |
| 5 | `/api/overrides` | `GET`, `PUT /:facilityId` | `overrides` | `{ facility_id, field('beds'\|'year'\|…), value }`. Inline override of missing fields; `value=null` clears. | `setOverride()` |
| 6 | `/api/duplicates` | `GET`, `POST` | `dup_decisions` | `{ facility_id, decision('merged'\|'distinct') }`. Resolves an entity-resolution pair; re-POST same = clear. | `resolveDup()` |
| 7 | `/api/roster` | `GET`, `PUT` | `roster` | `{ city, counts:{discipline:int 0-30} }`. One roster per (owner, city); steppers + "Import roster (CSV)". | `adjustRoster()`, `importRoster()` |
| 8 | `/api/pipeline` | `GET`, `POST` (toggle), `DELETE /:agentId` | `pipeline` | `{ agent_id }`. Recruit toggle → recruitment pipeline. Side effect: emit a `reach` notification to the agent. | `recruit()` |
| 9 | `/api/postings` | `GET`, `POST` (toggle), `DELETE /:id` | `postings` | `{ city, discipline, sub, driver, urgency('high'\|'medium'\|'low') }`. `hospital`+`sub`+`driver` derived server-side from burden/registry if omitted. `mine=true`, owner-scoped. Toggle posts/withdraws. | `postOpening()` |
| 10 | `/api/applications` | `GET`, `POST` (toggle), `DELETE /:id` | `applications` | `{ posting_id, spec, sub, exp }`. "Express interest". Side effect: emit `interest` notification to the posting owner (hospital). | `applyToPosting()` |
| 11 | `/api/referrals` | `GET`, `POST`, `PATCH /:id` (advance), `DELETE /:id` | `referrals` | POST `{ facility_id, reason, urgency, patient }` → status `sent`. PATCH advances `sent→accepted→completed`. | `createReferral()`, `advanceReferral()`, `removeReferral()` |
| 12 | `/api/scenarios` | `GET`, `POST`, `DELETE /:id` | `scenarios` | `{ name, city, roster:{disc:int} }`. Server recomputes `gaps` (count of disciplines with demand>=70 and no roster) authoritatively on save; stores snapshot. | `saveScenario()`, `removeScenario()` |
| 13 | `/api/saved-searches` | `GET`, `POST`, `DELETE /:id` | `saved_searches` | `{ name, query, state, type, trust }`. Plus `matchCount` recomputed server-side from registry. | `saveSearch()`, `removeSearch()` |
| 14 | `/api/notifications` | `GET`, `POST` (internal), `PATCH /read`, `DELETE` (clear) | `notifications` | `{ type('reach'\|'interest'\|'match'), text, agent_id?, posting_id?, nav?, dedupe_key }`. `dedupe_key` enforces the prototype's `key`-based de-dup. `PATCH /read` marks all read. | `pushNotif()`, `toggleNotif()`, `clearNotifs()`, `scanMatches()` |

**Notes on identity/audit:** every row gets `created_by = X-Forwarded-Email`, `created_at = now()`. "GET" on owned tables filters `WHERE created_by = :email` (the prototype scoped everything to one device/`currentEmail`).

---

## 4. Two-sided marketplace loop

The clinician↔hospital loop is three writes + the notification fan-out, all owner-scoped:

1. **Hospital posts** → `POST /api/postings` (`postOpening`). Appears in clinician "Live openings" via `GET /api/postings?discipline=<spec>` (ranked client-side by sub-fit).
2. **Clinician expresses interest** → `POST /api/applications` (`applyToPosting`). Server inserts application **and** `POST`s an `interest` notification to the posting's owner (hospital): *"A {spec} clinician is interested in your {discipline} opening at {hospital}."* (`nav:'h-agents'`).
3. **Hospital sees applicant count** → `GET /api/postings?mine=1` returns each posting with `applicants = COUNT(applications WHERE posting_id=…)`; weak-points + "Your open roles" show the count. Hospital recruits an agent → `POST /api/pipeline` (`recruit`) emits a `reach` notification to the agent.
4. **Proximity match alert** (`scanMatches`): on sign-up / roster change, server scans free agents within ~240 km (haversine over `app_state.pincode`/`CITY_LL`) of the hospital whose discipline fills an unmet weak point (demand>=60, roster=0) → emits `match` notifications. Implement as a server route `POST /api/match/scan` (called after roster PUT / account POST) writing to `notifications` with `dedupe_key = match_<agentId>_<city>`.

**Endpoints touched by the loop:** `/api/postings`, `/api/applications`, `/api/pipeline`, `/api/notifications`, `/api/match/scan`, plus reads `/api/agents` and `/api/coverage`.

---

## 5. Endpoint inventory

**READ (13 query-backed routes):** `/api/registry`, `/api/search/patient`, `/api/search/semantic`, `/api/facilities/:id`, `/api/registry/quality`, `/api/registry/duplicates`, `/api/atlas`, `/api/desert`, `/api/demand`, `/api/coverage`, `/api/agents`, `/api/states/coverage` (+ `/districts/crosswalk`, `/ref/:dim` support), `/api/assistant`.

**WRITE (14 persistence resources):** `/api/accounts` (+`/login`,`/me`), `/api/shortlist`, `/api/notes`, `/api/reviews`, `/api/overrides`, `/api/duplicates`, `/api/roster`, `/api/pipeline`, `/api/postings`, `/api/applications`, `/api/referrals`, `/api/scenarios`, `/api/saved-searches`, `/api/notifications` (+ `/api/match/scan`).

Total ≈ **27 routes** (13 read + 14 write resources) backing the 3 personas, 4 tracks, and the marketplace loop.
