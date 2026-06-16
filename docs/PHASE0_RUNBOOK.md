# Phase 0 — Scaffold Runbook: Asclepius Databricks App

> **Status:** RECON COMPLETE. Nothing has been scaffolded, initialized, or deployed.
> This runbook is copy-pasteable. Execute only after greenlight.
>
> **Stack (LOCKED):** React + TypeScript via Databricks AppKit (Vite SPA). Backend = AppKit Node/TS (Express) server.
> `createApp({ plugins: [server(), analytics(), serving()] })`.
> **Profile:** `team`  ·  **CLI verified:** Databricks CLI v1.3.0  ·  **Edition:** Free Edition (serverless).

---

## 0. Verified facts (from read-only recon)

These were confirmed live against profile `team` — they are NOT guesses. The `databricks apps manifest -p team` output is the source of truth for every plugin key, resourceKey, field, and `--set` path below.

| Fact | Verified value | Source |
|---|---|---|
| CLI version | `Databricks CLI v1.3.0` | `databricks --version` |
| Existing apps | **none** (clean slate; `asclepius` does not exist) | `databricks apps list -p team`, `databricks apps get asclepius -p team` |
| AppKit manifest version | `2.0` (`$schema` template-plugins) | `databricks apps manifest -p team` |
| SQL warehouse plugin key | **`analytics`** | manifest |
| SQL warehouse resourceKey / field | **`sql-warehouse`** / **`id`** → `--set analytics.sql-warehouse.id=<ID>` | manifest |
| Model-serving plugin key | **`serving`** (NOT `serving-endpoint`) | manifest |
| Serving resourceKey / field | **`serving-endpoint`** / **`name`** → `--set serving.serving-endpoint.name=<NAME>` | manifest |
| `server` plugin | **`requiredByTemplate: true`** → auto-included, MUST NOT appear in `--features` | manifest |
| Target warehouse | id `5465d8c2d7be7f58`, name **`Serverless Starter Warehouse`**, state **`RUNNING`** | `databricks warehouses get 5465d8c2d7be7f58 -p team` |
| Analytics scaffolding rule (must) | "Before init, ensure the SQL Warehouse passed via `--set analytics.sql-warehouse.id` is running" | manifest `plugins.analytics.scaffolding.rules.must` — already satisfied (RUNNING) |
| Analytics scaffolding rule (should) | "After init, ensure `config/queries/` has at least one `.sql` file before running `npm run typegen`" | manifest |
| Template rule (must) | "Keep all secrets and credentials only in `app.yaml`, `databricks.yml`, and/or `.env`" | manifest `scaffolding.rules.must` |
| Template rule (never) | "guess resources" / "embed secrets in client-bundle files" | manifest `scaffolding.rules.never` |

> **Important manifest nuance — `serving` is OBO by default.** Per the serving plugin, every `/api/serving/*` route runs **on behalf of the requesting user** (`X-Forwarded-Access-Token`), not the app SP. For shared Foundation-Model access in this app, the SP path is via the declared `serving_endpoint` resource (CAN_QUERY auto-grant) and `user_api_scopes: [serving.serving-endpoints]`. Decide per-route whether OBO or SP identity is wanted. (See §5 + §6.)

---

## 1. Pre-flight checks

Run all of these and confirm before init. They are read-only.

```powershell
# 1a. CLI present and authenticated to the team workspace
databricks --version                       # expect: Databricks CLI v1.3.0 (or newer)
databricks auth describe -p team           # confirm host + that auth resolves

# 1b. Target warehouse exists and is RUNNING (analytics 'must' rule)
databricks warehouses get 5465d8c2d7be7f58 -p team -o json
#   -> .state must be "RUNNING"; if STOPPED:  databricks warehouses start 5465d8c2d7be7f58 -p team

# 1c. App-name slot is free (Free Edition allows max 3 apps; 0 exist now)
databricks apps list -p team               # expect: no rows (or < 3 rows)

# 1d. Re-pull the manifest right before init (keys must match the installed AppKit version)
databricks apps manifest -p team
#   -> confirm plugin keys: analytics (sql-warehouse.id), serving (serving-endpoint.name), server (requiredByTemplate:true)

# 1e. Toolchain for the AppKit project (Node 20+ LTS recommended)
node --version
npm --version
```

**Name constraint:** app name `asclepius` is 9 chars, lowercase, no underscores — valid (≤26 chars; `dev-` prefix adds 4 → still ≤30). 

**Serving endpoints to be used (Foundation Models, pre-provisioned on the workspace — no creation needed):**
`databricks-claude-opus-4-8`, `databricks-meta-llama-3-3-70b-instruct` (default), `databricks-meta-llama-3-1-8b-instruct` (cheap batch), `databricks-gte-large-en` (embeddings).
Verify reachability before relying on them:

```powershell
databricks serving-endpoints get databricks-meta-llama-3-3-70b-instruct -p team -o json
databricks serving-endpoints get databricks-claude-opus-4-8 -p team -o json
databricks serving-endpoints get databricks-gte-large-en -p team -o json
```

The app binds **one** serving endpoint via `--set` at init time. Pin `databricks-meta-llama-3-3-70b-instruct` as the default at init; add the others later as **named endpoints** (multi-env aliases) — see §5.

---

## 2. The exact `databricks apps init` command

`server` is `requiredByTemplate:true`, so it is **omitted** from `--features`; only the optional plugins `analytics` and `serving` go there. Each gets its required `--set`.

```powershell
databricks apps init `
  --name asclepius `
  --features analytics,serving `
  --set analytics.sql-warehouse.id=5465d8c2d7be7f58 `
  --set serving.serving-endpoint.name=databricks-meta-llama-3-3-70b-instruct `
  --description "Asclepius — Virtue Foundation health-facility intelligence (analytics + Foundation Models)" `
  --output-dir C:/Users/Dakota/Projects/databricks-2026-hackathon `
  --run none `
  --profile team
```

Bash / single-line equivalent:

```bash
databricks apps init --name asclepius --features analytics,serving \
  --set analytics.sql-warehouse.id=5465d8c2d7be7f58 \
  --set serving.serving-endpoint.name=databricks-meta-llama-3-3-70b-instruct \
  --description "Asclepius — Virtue Foundation health-facility intelligence (analytics + Foundation Models)" \
  --output-dir C:/Users/Dakota/Projects/databricks-2026-hackathon \
  --run none --profile team
```

Why each token:
- `--features analytics,serving` — the two **optional** plugins. `server()` is auto-injected by the template (do NOT add it; adding `requiredByTemplate` plugins to `--features` is an error).
- `--set analytics.sql-warehouse.id=5465d8c2d7be7f58` — binds the SQL warehouse (the locked `5465d8c2d7be7f58`). Path = `<plugin>.<resourceKey>.<field>` straight from the manifest.
- `--set serving.serving-endpoint.name=databricks-meta-llama-3-3-70b-instruct` — binds the default Foundation Model. Value is the endpoint **name**, not a URL/id.
- `--run none` — review code before any local/remote run.
- **No `--auto-approve`** — the manifest's template rule advises asking when in doubt; we have exactly one warehouse and one default endpoint, so the prompts will just confirm.

Post-init install + typegen (analytics `should` rule — add ≥1 SQL file first; see §3):

```powershell
cd C:/Users/Dakota/Projects/databricks-2026-hackathon/asclepius
npm install
npm run typegen      # expect every query in config/queries/ to show ✓
```

---

## 3. Resulting project structure

`databricks apps init` writes a kebab-case dir = app name: `…/databricks-2026-hackathon/asclepius/`.

```
asclepius/
├── app.yaml                      # Deploy manifest: env injections (valueFrom) + resources
├── databricks.yml                # Bundle: app resource, resources[] w/ permission, user_api_scopes
├── package.json                  # @databricks/appkit + @databricks/appkit-ui (DO NOT bump versions)
├── tsconfig.json
├── server/
│   ├── server.ts                 # Backend entry: createApp({plugins:[server(),analytics(),serving()]})
│   └── .env                      # LOCAL dev only — DATABRICKS_WAREHOUSE_ID / *_SERVING_ENDPOINT_NAME (gitignored)
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx               # <- main React component (start here)
│       └── appKitTypes.d.ts      # AUTO-GENERATED by `npm run typegen` (do not hand-edit)
├── config/
│   └── queries/                  # SQL files → queryKey = filename (no .sql)
│       └── *.sql                 #   e.g. facility_counts.sql -> queryKey "facility_counts"
└── tests/
    └── smoke.spec.ts             # ⚠️ default asserts "Minimal Databricks App"/"hello world" — MUST edit before validate
```

**Reads vs writes (per the locked architecture):**
- **Reads** → `config/queries/*.sql` only (warehouse `5465d8c2d7be7f58`), surfaced via `useAnalyticsQuery` / chart+table components. NEVER add a custom endpoint to run a SELECT.
- **Writes / mutations** → custom Express routes in `server/server.ts` inside `onPluginsReady` → `appkit.server.extend(app => …)`. Persistence target = Lakebase Postgres (no instance yet → Delta-table fallback via SP-authed `serviceDatabricksClient` until Lakebase is provisioned).
- **Foundation Models** → `serving()` plugin auto-routes `/api/serving/invoke` + `/api/serving/stream`; call from React via `useServingStream` / `useServingInvoke`. Do NOT call endpoints directly from the client.

Seed at least one SQL file before `npm run typegen`, e.g. `config/queries/facility_counts.sql`:

```sql
-- queryKey: facility_counts   (smoke-safe: aggregated, well under the 1MB analytics-event cap)
SELECT state, COUNT(*) AS facility_count
FROM workspace.virtue_foundation_clean_v2.facilities
GROUP BY state
ORDER BY facility_count DESC
LIMIT 50;
```

---

## 4. Hello-world deploy + grabbing the SP client id

**Before validate (AppKit gotcha):** the default `tests/smoke.spec.ts` asserts "Minimal Databricks App" / "hello world" — those WILL fail. Update the heading/text selectors to match `App.tsx` (use only Playwright locators: `getByRole`, `getByText`, `getByPlaceholder`, `getByLabel`). Keep any smoke query aggregated/`LIMIT`ed (<1 MB).

```powershell
cd C:/Users/Dakota/Projects/databricks-2026-hackathon/asclepius

# 4a. Validate (tsc --noEmit + appkit lint + smoke). Fix before deploying.
databricks apps validate --profile team

# 4b. Deploy (validates, deploys bundle, runs the app). USER CONSENT REQUIRED.
databricks apps deploy --profile team
#   step-by-step alternative:
#   databricks bundle deploy -t <TARGET> --profile team
#   databricks bundle run asclepius -t <TARGET> --profile team   # MUST run after deploy or config won't apply

# 4c. Confirm it is up
databricks apps get asclepius -p team -o json    # expect .app_status.state == "RUNNING"
```

**Grab the service-principal client id** (the identity the platform auto-injects and that needs the GRANTs in §5):

```powershell
# Primary: read it straight off the deployed app object
databricks apps get asclepius -p team -o json | ConvertFrom-Json | `
  Select-Object name, @{n='sp_client_id';e={$_.service_principal_client_id}}, `
                       @{n='sp_id';e={$_.service_principal_id}}, `
                       @{n='sp_name';e={$_.service_principal_name}}
```

```bash
# Bash/jq equivalent
databricks apps get asclepius -p team -o json | jq '{name, service_principal_client_id, service_principal_id, service_principal_name}'
```

- `service_principal_client_id` → the OAuth **client id / applicationId (UUID)**. Use this in `GRANT … TO \`<uuid>\`` and in serving-endpoint permission grants.
- `service_principal_id` → numeric workspace SP id (used by some `permissions set` APIs).
- `service_principal_name` → human-readable SP name.

Bundle alternative if you prefer the deploy graph: `databricks bundle summary -t <TARGET> --profile team` (the app node carries the SP fields once deployed).

> The SP fields are only populated **after** the first successful deploy — that deploy is what creates the app SP. There is no SP to grant before §4.

---

## 5. GRANTs the app SP needs

Resources **declared** in `databricks.yml` with a `permission` field are auto-granted to the SP on deploy — you do NOT hand-grant those:
- `analytics` → `sql_warehouse 5465d8c2d7be7f58` `permission: CAN_USE` (auto).
- `serving` → `serving_endpoint databricks-meta-llama-3-3-70b-instruct` `permission: CAN_QUERY` (auto).

You DO still need: (a) **Unity Catalog data GRANTs** (UC securables are not auto-granted from `app.yaml`), and (b) **CAN_QUERY on the additional Foundation-Model endpoints** that are not the single one bound at init.

Let `:SP` = the `service_principal_client_id` UUID from §4. Run the SQL on warehouse `5465d8c2d7be7f58`.

### 5a. Unity Catalog — app state (writes / Delta fallback)

```sql
-- App needs USE on catalog+schema, then table-level rights on the state table.
GRANT USE CATALOG ON CATALOG workspace TO `:SP`;
GRANT USE SCHEMA  ON SCHEMA  workspace.app_state TO `:SP`;          -- create schema first if absent

-- If app_state is a single state table written via the Delta fallback:
GRANT SELECT, MODIFY ON TABLE workspace.app_state.app_state TO `:SP`;
-- If the SP also creates state tables on first run (Delta-fallback bootstrap):
GRANT CREATE TABLE ON SCHEMA workspace.app_state TO `:SP`;
```

> Once Lakebase Postgres is provisioned, app_state moves there (Lakebase grants are `CAN_CONNECT_AND_CREATE` on the Postgres resource, declared in `databricks.yml`, auto-granted) and these Delta-fallback GRANTs can be revoked.

### 5b. Unity Catalog — Virtue Foundation cleaned data (reads)

```sql
-- v2 (current cleaned dataset) and v3 (next iteration) — read-only for the dashboard queries.
GRANT USE CATALOG ON CATALOG workspace TO `:SP`;
GRANT USE SCHEMA  ON SCHEMA  workspace.virtue_foundation_clean_v2 TO `:SP`;
GRANT SELECT ON SCHEMA workspace.virtue_foundation_clean_v2 TO `:SP`;   -- all tables in schema

GRANT USE SCHEMA  ON SCHEMA  workspace.virtue_foundation_clean_v3 TO `:SP`;
GRANT SELECT ON SCHEMA workspace.virtue_foundation_clean_v3 TO `:SP`;
```

> `GRANT SELECT ON SCHEMA …` covers all current and future tables in that schema. If you must scope tighter, replace with per-table `GRANT SELECT ON TABLE workspace.virtue_foundation_clean_v2.<table> TO \`:SP\`;`.
> The **Vector Search index** (Delta Sync, 1 endpoint/1 unit, TRIGGERED) is a UC securable of type TABLE — once created, grant it the same way: `GRANT SELECT ON TABLE workspace.<schema>.<vs_index> TO \`:SP\`;`.

### 5c. Serving endpoints (the ones NOT bound at init)

The init-bound default (`…-llama-3-3-70b-instruct`) is auto-granted via the declared resource. Grant CAN_QUERY on the other three so the SP can call them as named endpoints:

```powershell
# Look up each endpoint's id, then grant CAN_QUERY to the SP (UUID from §4 as :SP)
foreach ($ep in @('databricks-claude-opus-4-8','databricks-meta-llama-3-1-8b-instruct','databricks-gte-large-en')) {
  $id = (databricks serving-endpoints get $ep -p team -o json | ConvertFrom-Json).id
  databricks serving-endpoints set-permissions $id -p team --json (@{
    access_control_list = @(@{ service_principal_name = ':SP'; permission_level = 'CAN_QUERY' })
  } | ConvertTo-Json -Depth 5)
}
```

> Cleaner alternative: **declare all four endpoints as `serving_endpoint` resources in `databricks.yml`** (each `permission: CAN_QUERY`) and wire them as named endpoints in `serving({ endpoints: { default:…, opus:…, cheap:…, embed:… } })`. Then the platform auto-grants all four on deploy and §5c becomes unnecessary. Preferred for reproducibility.
>
> Also add to `databricks.yml`: `user_api_scopes: [serving.serving-endpoints]` (and `sql` if any OBO warehouse reads are added) — required because `serving()` routes run OBO by default.

---

## 6. Free Edition gotchas (10 MB · 24 h · serverless)

| Constraint | Impact on Asclepius | Mitigation |
|---|---|---|
| **Max 3 apps** per workspace | Only 3 deploy slots; `dev-asclepius` + `asclepius` already eats 2 | Don't spawn throwaway apps; reuse one slot; `databricks apps list -p team` before each new init |
| **24 h auto-stop** | App container is stopped after ~24h idle; cold start on next hit | Treat as ephemeral; never store state in the container — all state in UC/Lakebase. Expect a cold-start delay after idle (must boot < 10 min). |
| **No file > 10 MB** in app dir | Large bundles/data files fail deploy (`File is larger than 10485760 bytes`) | Never commit data/model files; rely on `package.json`/`requirements.txt`; keep `client/` build lean; data lives in UC, not the bundle. Vite tree-shaking helps. |
| **Serverless / no root** | No `apt-get`, no GPU, ephemeral FS | npm/PyPI deps only; inference via serving endpoints (already the plan); logs to stdout/stderr only (file logs lost on recycle) |
| **120 s proxy timeout** | Foundation-Model streaming + long agent turns can hit it | Keep `max_tokens` bounded; prefer streaming; for long agent runs use **WebSockets** (bypass the 120s SSE cap). 504 shows nothing in app logs (raised at proxy). |
| **1 MB analytics-event cap** | Big SELECTs from `virtue_foundation_clean_v2` crash the UI (`Event exceeds max size of 1048576 bytes`) | Aggregate or `LIMIT` every `config/queries/*.sql`; never raw-dump rows; smoke-test queries especially must be aggregated |
| **Warehouse must be RUNNING at init** | Analytics `must` rule | `5465d8c2d7be7f58` is RUNNING now; if it auto-stops before init, `databricks warehouses start 5465d8c2d7be7f58 -p team` |
| **SP exists only post-deploy** | §5 GRANTs can't run until after first deploy | Deploy hello-world (§4) → read `service_principal_client_id` → then run §5 GRANTs → redeploy/refresh |
| **Destructive app updates** | `apps update`/`bundle run` full-replaces config; can wipe `user_api_scopes` | Re-verify `user_api_scopes: [serving.serving-endpoints]` after every deploy |
| **Secrets** (template `must` rule) | No secrets in client bundle | Keep creds only in `app.yaml` / `databricks.yml` / `.env`; inject via `valueFrom`; never hardcode the warehouse id or endpoint names in `client/src` |

---

## Phase 0 exit criteria

1. Pre-flight (§1) all green; warehouse RUNNING; ≤2 apps exist.
2. `databricks apps init …` (§2) run; project tree (§3) present; `npm install` + `npm run typegen` show ✓ for ≥1 seed query.
3. Smoke test selectors updated; `databricks apps validate -p team` passes.
4. Hello-world deployed; `databricks apps get asclepius -p team -o json` → `RUNNING`; `service_principal_client_id` captured.
5. §5 GRANTs applied for that SP on `workspace.app_state`, `…clean_v2`, `…clean_v3`, and the 3 extra serving endpoints; app re-refreshed.
6. Free-Edition guardrails (§6) acknowledged in the build plan.
