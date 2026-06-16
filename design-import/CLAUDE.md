# Asclepius — Project Notes

Healthcare facility intelligence app for the Databricks "Apps & Agents for Good" hackathon
(Data+AI Summit 2026). Three personas — Patient, Clinician, Hospital admin — over a national
facility registry, covering all four hackathon tracks (Facility Trust Desk, Medical Desert
Planner, Referral Copilot, Data Readiness Desk).

- **Primary file:** `Asclepius.dc.html` (Design Component). Offline build: `Asclepius-demo.html`.
- **Demo data:** `asc-data.js` (national FDR-style facilities), `india-geo.js` (atlas geometry).
- Current state = polished **design prototype**. Real data + deploy happen in the Databricks phase.

## Decision log

### DEC-001 — Simulated sign-up (LOCKED)
Accounts that look/feel real for the demo; **profile fields only, no password security**.

- **`accounts`/`profiles` Delta table** in `app_state`: `email`, `display_name`,
  `role` (patient/doctor/hospital_admin), role-specific fields, `created_at` — **no password column**.
- **"Sign up"** = create a profile (this fills marketplace supply: a doctor signing up *is* a
  free-agent listing). **"Log in"** = enter email → saved profile + data load back. No credential check.
- Layered on the Databricks identity (captured as `created_by` for audit) + the persona switcher.
- **Guardrail (enforce):** no real passwords; **no real personal/medical data** — demo/synthetic
  profiles only, labeled as such. (No auth ⇒ collect nothing sensitive.)
- Demo flow: "sign up as Dr. Mehra, cardiology, Patna" → instantly a recruitable free agent on the
  map; log back in later → profile still there.
- **Phase:** Databricks build (not the HTML prototype).

## Deferred to the Databricks build
- Wire to the real ~10k-record / 51-column FDR dataset; deploy as a Databricks App (Free Edition).
- Derive desert/atlas + hospital coverage scores from real records (currently modelled), with citations.
- Unify referral/matching onto the full registry (role flows currently use the curated slice).
- Live persistence (Lakebase/Delta) in place of localStorage.
