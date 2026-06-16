# Handoff: Asclepius — Healthcare Facility Intelligence (Databricks build)

## Overview
Asclepius is a healthcare-facility intelligence app for the **Databricks "Apps & Agents for Good" Hackathon** (Data+AI Summit 2026). It turns ~10,000 messy Indian healthcare-facility records (FDR dataset, 51 columns) into decisions a non-technical planner can trust, across **three personas** — Patient, Clinician (doctor), Hospital admin — and all four hackathon tracks:

- **Facility Trust Desk** — can a facility actually do what it claims?
- **Medical Desert Planner** — where are the real, highest-risk gaps?
- **Referral Copilot** — where should a patient/coordinator go?
- **Data Readiness Desk** — what must be fixed before planning can trust the data?

It also adds a **two-sided clinician↔hospital marketplace**, an **AI assistant**, a **national coverage + health-conditions atlas**, and **simulated profile sign-up**.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look, flows, and behavior. **They are not production code to copy directly.** The task is to **recreate these designs as a Databricks App** using its environment (Python/Flask or the Databricks Apps framework + a JS/React front-end, your choice), wired to the **real FDR dataset** and **Delta/Lakebase persistence** — using the prototype as the functional + visual spec.

- `Asclepius.dc.html` — the full source (a single-file "Design Component": an HTML template + a `class Component` logic class holding ALL state, data, and behavior). **This is the most useful reference** — read the logic class for exact data shapes, scoring formulas, and handlers.
- `Asclepius-demo.html` — the same app compiled to one offline, self-contained file (fonts/icons/data inlined). Open in any browser to click through.
- `asc-data.js` — `window.ASC_REGISTRY_EXTRA`: 47 synthetic national facilities (FDR-style columns). Replace with the real 10k dataset.
- `india-geo.js` — `window.INDIA_GEO`: simplified India state GeoJSON (`st_nm` property) for the atlas choropleth.
- `CLAUDE.md` — project notes + the **decision log** (esp. DEC-001 simulated sign-up). Treat as binding.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, copy, and interactions. Recreate pixel-accurately using your codebase's component library; pull exact values from the HTML source (inline styles) and the tokens below.

## Architecture of the prototype (how to read the source)
- One class `Component extends DCLogic`. `this.state` holds everything; `renderVals()` returns the props the template binds to. Handlers (e.g. `toggleSave`, `recruit`, `applyToPosting`, `createAccount`, `pushNotif`) mutate state and call `persist()`.
- **Persistence:** single `localStorage` key **`asclepius_v1`** (JSON). Keys: `shortlist`, `notes`, `hRoster`, `hPipeline`, `postings`, `applications`, `reviews`, `overrides`, `dupDecisions`, `referrals`, `scenarios`, `savedSearches`, `accounts`, `currentEmail`, `notifications`. **In Databricks, replace this with Lakebase/Delta tables in an `app_state` schema** (one table per concept; see DEC-001 for `accounts`/`profiles`).
- **Static demo data lives in the logic class** as getters: the curated 10 Maharashtra facilities (`FAC`), free agents (`_baseAgents`), `STATE_STRENGTH`, `BURDEN` (per-city disease-burden + sub-need), `SUBS` (sub-specialties), `HEALTH` (7 condition layers), `CITY` / `CITY_LL` (coords), `NEEDS`, `DISCIPLINES`. **Derive all of these from the real FDR records in the build.**

## Personas & Screens

### Shared
- **Landing** — logo + nav (Atlas / Registry / **Sign up · Log in**), a 3-variant hero (split / centered / editorial; demo-only switcher below the nav), three role-entry cards (Patient coral, Clinician green, Hospital blue).
- **Auth (Sign up / Log in)** — no password. Role picker (Patient / Doctor / Hospital admin) → display name, email, city; doctors add specialty, sub-specialty, years, availability, relocate/telehealth. **A doctor signing up becomes a recruitable free agent** (appears in the hospital recruiter & on alerts). Log in = email → profile + role reload. Guardrail copy shown: "Demo profiles only — no passwords, no real personal or medical data." Implements DEC-001.
- **Facility Detail** (shared by all roles) — header (name, type, city, trust badge + confidence); **Why we surfaced this** (cited reason chips); **Claimed capabilities** (each claim = verified / claimed / no-evidence, with per-claim **confirm/dispute** buttons); **How we read this record** (raw free-text → extracted structured fields, each tagged with source field + confidence — the "extract structure + show uncertainty" view); **Source evidence** (quoted FDR description); **Record quality & caveats**; **Record freshness** ("last crawled ~N months ago", confidence **decays with age**, stale nudge); **Call to confirm** (synthetic phone, `tel:` + WhatsApp deep links, "Reached — confirmed / Doesn't match" → logs a review + refreshes confidence); **At a glance** (beds/year with inline override inputs when missing); **Review & fix** (Verify / Site-visit decision, persisted); Save, Refer a patient, Add to compare, Get directions (Maps deep link) + travel time/cost estimate.

### Patient (Referral Copilot)
- **Location** (origin city chips + travel-radius slider), **Needs** (multi-select symptom cards → specialties; urgency), **Results** (ranked facility list with fit-score + **"Why this score"** breakdown citing source fields, trust badge, evidence link; geo-radius map with concentric rings + facility pins).

### Clinician (Medical Desert / marketplace)
- **Profile** (specialty + sub-specialty + years), **Opportunities** (3 tabs: **Live openings** = hospital postings ranked by sub-specialty fit, with **Express interest**; **Inferred gaps** = facilities whose records imply a need; **Offers it** = facilities already providing it; gap/opportunity map).

### Hospital admin (Coverage + recruiting)
- **Roster** (city + per-discipline headcount steppers + "Import roster (CSV)"; **Save as scenario**; **scenario comparison** of the two latest), **Coverage** (disease-burden-weighted **demand vs coverage** bars per discipline with overlap counts; weak-points with sub-need + **Post opening** + **Find free agents**; "Your open roles" with applicant counts; **Board report** → printable PDF), **Recruiter / free agents** (ranked agents w/ sub-match badges; **Recruit** → pipeline; **AI Recruiter** panel that names agents and offers "Do it for you" actions; clickable **pipeline** modal).

### Registry & Data Readiness Desk
- **Registry** screen, 3 tabs: **Browse** (search + filters by state/type/trust over the full registry; **Save search** + voice search; per-card data-quality score), **Data quality** (registry readiness score, **field-coverage dashboard** mirroring FDR coverage %, **review queue** worst-first with issue chips + **Export fix-list CSV**), **Duplicates** (entity-resolution candidate pairs with **Merge / Keep distinct** decisions).

### Atlas
- **Coverage Atlas** — India state choropleth. Toggle **Care coverage** (green ramp, darker = more coverage; facility markers) ↔ **Health conditions** (red ramp, darker = higher modelled prevalence; 7 layers: Chronic/NCD, Anaemia, Child malnutrition, Women's nutrition, Acute child illness, Cancer-screening gaps, Risk factors). Best/lowest panels, hover read-out, honest "modelled, not case-tracking" labeling. (Build: replace with derived district-level metrics from real records / NFHS.)

### Cross-cutting
- **Notifications** (bell + unread badge): (1) hospital reaches out to an agent, (2) agent shows interest in a posting, (3) a matching free agent appears within ~240 km of the hospital filling an unmet need. Clickable, persisted.
- **⌘K command palette**, **Compare facilities** (tray → side-by-side), **Share shortlist** (QR + deep link `#s=ids`), **Undo** snackbar on destructive actions, **Multilingual** (EN/हिं toggle — the AI assistant replies in the chosen language) + **voice** input/read-aloud (Web Speech API), **AI assistant** (grounded in the data; clickable facility/doctor links; agentic action chips).

## Design Tokens
- **Type:** Display/headings = **Bricolage Grotesque** (700); UI/body = **Hanken Grotesk** (400/500/600/700). Icons = **Phosphor Icons** (`ph-fill` / `ph-bold` / regular).
- **Neutrals:** paper bg `#FAF6F0`; surface `#FFFFFF` / `#FCFAF6`; borders `#ECE4D8` / `#E7DFD2` / `#F0EAE0`; ink `#241F1A` / `#2B2722`; muted text `#6E665B` / `#857B6C` / `#938A7C` / `#A79D8E`.
- **Role accents:** Patient `#E0714C` (soft `#FBE8E0`, deep `#C0552F`); Clinician `#2E7D67` (soft `#E4EFEA`); Hospital `#3B6FB0` (soft `#E3ECF6`).
- **Trust states:** verified `#2E7D67` on `#E4EFEA`; review/claimed `#9A6A12` on `#F6EBD6`; unverified `#857B6C` on `#EEE9DF`; no-evidence/dispute `#B2503C` on `#F6E2DC`.
- **Atlas ramps:** coverage (green) `rgb(234,243,238)`→`rgb(18,78,61)`; prevalence (red) `rgb(252,239,231)`→`rgb(140,45,26)`; gamma ~0.8.
- **Radius:** pills/chips `999px`; cards `16–22px`; inputs/buttons `10–14px`.
- **Shadows:** card `0 1px 2px rgba(43,39,34,.04)`; raised `0 18px 40px -28px rgba(43,39,34,.3)`; modal `0 34px 80px -28px rgba(0,0,0,.55)`.
- **Motion:** entrance `ascFade`/`ascPop` ~.18–.5s ease; map fill transition .25s.

## Interactions & Behavior (key rules)
- **Patient fit score** = need-coverage (matched specialties / selected needs) + trust/confidence + proximity; shown with a cited breakdown. **Hospital gap** = burden-weighted demand − (nearby-facility coverage + own roster). **Sub-specialty matching**: postings/agents rank exact sub-specialty fit above same-discipline. See `renderVals` for exact weights.
- **Two-sided loop:** hospital posts opening → appears in clinician "Live openings" → clinician "Express interest" → hospital sees applicant count + a notification.
- **Confidence decay:** effective confidence = base − f(record age); resets to "verified by you today" on Verify / Call-confirm.
- All destructive actions (remove saved/referral/scenario, withdraw) offer **Undo**.

## State Management
Single in-memory state object persisted to `asclepius_v1` (see keys above). Each maps cleanly to a Delta table in the build (e.g. `accounts`, `referrals`, `reviews`/overrides as an audit table, `postings`, `applications`, `notifications`, `scenarios`). Capture Databricks identity as `created_by` for audit (DEC-001).

## Assets
- Fonts via Google Fonts (Bricolage Grotesque, Hanken Grotesk); icons via Phosphor Icons CDN; QR via `qrcodejs`. No proprietary/brand assets — swap for your stack's libraries.
- `india-geo.js` geometry: adapted from public India GeoJSON (`st_nm`).

## Databricks build plan (from CLAUDE.md — deferred items)
1. Run as a **Databricks App on Free Edition**; ingest the real ~10k-record / 51-column FDR dataset.
2. **Derive** desert/coverage + atlas + health-condition scores from real records (currently modelled), with **citations** to source text for every score/ranking.
3. Unify referral/clinician/hospital matching onto the **full registry** (role flows currently use the curated 10-facility slice).
4. **DEC-001 simulated sign-up** (LOCKED): `accounts`/`profiles` Delta table — `email`, `display_name`, `role`, role-specific fields, `created_at`; **no password column**. Sign up = create profile (a doctor = a free-agent listing); log in = email → profile loads. Guardrail: no passwords, no real personal/medical data — synthetic/labeled only.
5. Replace `localStorage` with **Lakebase/Delta** persistence.

## Files in this bundle
- `Asclepius.dc.html` — full source (template + logic class). Primary reference.
- `Asclepius-demo.html` — runnable offline build.
- `asc-data.js`, `india-geo.js` — demo data + map geometry.
- `CLAUDE.md` — project notes + decision log.
