# Medical Desert Planner — Integration Plan (`medical_desert.*`)

*Asclepius app · DAIS 2026 "Apps & Agents for Good" hackathon · Virtue Foundation (India healthcare).*
*Read-only exploration + plan. No data/grants/code/deploy changes were made. Verified 2026-06-16 against the Asclepius Lakebase (`projects/asclepius/branches/production`, db `databricks_postgres`).*

---

## 0. TL;DR

A new, rigorous, distance-based desert layer (`medical_desert.*`, 3 tables, owned by `fulks89`) is loaded into the **same** Lakebase as the app's `app_read.*`. It replaces the **biased** `app_read.gold_district_supply_need.desert_score` (whose score conflated true scarcity with a facility→district join gap — 182/706 districts read zero facilities purely from crosswalk misses). The new layer never has that failure mode: it measures *distance to the nearest claiming provider*, not *count of mapped facilities*.

**The join is solved and clean.** `medical_desert.district_id = UPPER(state) || '::' || UPPER(district)`. It reconciles **706/706** to `gold_district_supply_need` and `district_crosswalk` on the case-insensitive `(nfhs_district, state)` pair, and **694/706** directly to the district GeoJSON — the 12 gaps are exactly the Delhi/Mumbai metro one-to-many splits the Atlas already aggregates via `path.nfhsKeys` (+ 1 GeoJSON omission, Chandel). Zero new mapping infrastructure required.

**Recommendation:** make `medical_desert` the app's primary desert layer; keep the burden ↔ per-capita-scarcity distinction front-and-center as the honesty story.

---

## 1. What was verified (real rows)

Row counts confirmed exactly: **706 / 22,592 / 136,964** (`area_medical_scarcity` / `area_capability_desert` / `area_specialty_desert`; the 137k specialty slice is the coverage≥medium cut, full 2.07M lives in `workspace.bf_vf.area_specialty_desert`).

### Top deploy priority (BURDEN = severity × population → `burden_rank`)
Populous, moderately-scarce districts — "where the most people are affected":

| burden_rank | district | state | n_capability_deserts | population_2011 | scarcity_rank | scarcity_tier |
|---|---|---|---|---|---|---|
| 1 | Paschim Barddhaman | West Bengal | 7 | 7,717,563 | 449 | moderate |
| 2 | Murshidabad | West Bengal | 12 | 7,103,807 | 403 | moderate |
| 3 | Paschim Medinipur | West Bengal | 9 | 5,913,457 | 442 | moderate |
| 4 | Nashik | Maharastra | 7 | 6,107,187 | 477 | moderate |
| 5 | Pashchim Champaran | Bihar | 19 | 3,935,042 | 187 | high |

### Most isolated per-capita (`scarcity_rank`, `medical_scarcity` 0–1)
Remote, low-population, badly cut off — "how bad is access for one person here":

| scarcity_rank | district | state | medical_scarcity | scarcity_tier | population_2011 | burden_rank | n_capability_deserts | worst_capability |
|---|---|---|---|---|---|---|---|---|
| 1 | Bijapur | Chhattisgarh | 0.553 | high | 255,230 | 583 | 32 | Public Health & Preventive Medicine |
| 2 | Dantewada | Chhattisgarh | 0.546 | high | 266,819 | 575 | 32 | Primary & Family Medicine |
| 3 | Kodagaon | Chhattisgarh | 0.542 | high | 706,600 | 347 | 32 | Primary & Family Medicine |
| 4 | Anjaw | Arunachal Pradesh | 0.540 | high | 21,167 | 698 | 32 | Oncology & Hematology |
| 5 | Nicobars | Andaman & Nicobar Islands | 0.540 | high | 36,842 | 693 | 32 | Psychiatry & Mental Health |

**The two lenses are genuinely orthogonal.** No district is top-20 on both. This is the product's core insight, not a quirk.

### The honesty payoff (old model was backwards)
The old population-scaled approach ranked the biggest metros as "worst deserts." The new per-capita model puts them where they belong:

| district | state | scarcity_rank | scarcity_tier | n_capability_deserts | burden_rank |
|---|---|---|---|---|---|
| Pune | Maharastra | 682 / 706 | low | 1 | 272 |
| Bangalore | Karnataka | 690 / 706 | low | 0 | 495 |

### scarcity_tier distribution (706 districts)
`low 80` (0.011–0.145) · `moderate 339` (0.154–0.349) · `high 287` (0.351–**0.553**). **No "extreme" tier** appears — observed max is 0.553 and the model does not manufacture one (tier cut is ≥0.60). At the *capability* grain `severity_tier` does include `extreme`.

### Capability + specialty drill-down (Bijapur, the #1 most-isolated district)
Capability deserts (ordered by `capability_severity`, all `extreme`): Public Health & Preventive Medicine 0.769; Primary & Family Medicine 0.728; Oncology & Hematology 0.706; Infectious Disease & Tropical Medicine 0.693; General Internal Medicine 0.685; …

Specialty drill (with `nearest_km` to the closest claiming provider):
- `radiationOncology` (Oncology & Hematology, tertiary): nearest **231.7 km**, effective 324.3 km, distance_score 1.000, severity 1.000, coverage_confidence **medium**, 110 facilities claim it nationwide.
- `gynecologicOncology` (Ob/Gyn, tertiary): nearest **332.4 km**, effective 465.3 km, severity 1.000, medium.
- `gynecologyAndObstetrics` (secondary): nearest **151.5 km**, severity 0.890, coverage_confidence **high**, 4,489 facilities claim it.

### Cross-cutting facts
- All 706 districts have `n_capabilities_scored = 32` (35 families − 3 unscoreable). `n_capability_deserts` ranges 0–32, mean 13.6; **27 districts** hit the full 32/32.
- `area_specialty_desert` (137k slice) splits **66,364 high / 70,600 medium** `coverage_confidence`. Avg `nearest_km` by care tier: primary 96.3, secondary 132.3, tertiary 152.5 km. **No `no_provider_nationwide=true` rows** in the ≥medium slice (those live only in the full 2.07M set).

---

## 2. Methodology that matters for honest UX
*(from `dbfs:/Volumes/workspace/bf_vf/desert_files/ASSUMPTIONS_AND_GAPS.md`)*

- **Need model.** Per-capita baseline = 1 for every service ("everyone needs some"), plus a district-specific **risk uplift** from an 11-condition NFHS-5 disease→specialty bridge. `need_intensity = 1 + ALPHA·risk` with `ALPHA=1` (risk can at most double per-capita need). Population-independent by design.
- **Severity is per-capita, NOT population-scaled.** `severity = distance_score · need_intensity / (1+ALPHA)`, 0–1. Population enters **only** as a labeled overlay: `burden_score = severity × population_2011`. (A first pass scaled by population and wrongly ranked metros as worst deserts — explicitly fixed.)
- **Distance bands** (care-tier-aware, grounded in IPHS catchment norms + observed access + the **Lancet 2-hour surgical-access** benchmark, ~100 km effective). `effective_km = haversine × circuity` where circuity = 1.4 plains / 1.7 hilly (J&K, Ladakh, HP, Uttarakhand, NE). Served→0 / desert→1 linear ramp: **primary 10/40 km · secondary 30/100 km · tertiary 100/250 km**. NOT road distance/time; district reference point = pincode-centroid (no intra-district variation).
- **≥25-facility coverage rule.** 2,741 of 2,935 specialties are claimed by <25 facilities (median 1). A 1-facility token would floor every district near 0.5. So headline/capability/area scores aggregate **only specialties with ≥25 claiming facilities** (`coverage_confidence` high/medium). All 2,935 remain at specialty grain for drill-down, flagged by `coverage_confidence`.
- **`coverage_confidence`** = how reliable distance is as a signal for that specialty. **high/medium** = enough facilities nationwide that geographic distance is meaningful; **low** (specialty grain only, not in the 137k Lakebase slice) = too few claims for distance to be trustworthy. Surface high/medium without caveat; treat anything thinner as advisory.
- **`population_2011` denominator.** Census 2011, joined 640 Census → 706 NFHS districts: **585 exact / 4 fuzzy / 116 sibling-split (post-2011 carve-outs given an EQUAL share of parent population) / 1 state-avg.** Equal-split is the main caveat for per-capita reads. National total reconciles to 1.2109 B (+0.007%).
- **Tier cuts** (fixed/tunable): low <0.15, moderate <0.35, high <0.60, extreme ≥0.60. Observed area max 0.553 → no district is "extreme."

### Known gaps / caveats to show in the UI
1. **Specialties are CLAIMS, not credential-verified.** v1 proximity counts any facility that *claims* a specialty; the Trust Desk validates separately. A hook is reserved to down-weight weakly-corroborated far claims later. **This is the single most important honesty caveat to surface.**
2. **3 of 35 capabilities are not scorable in the headline** — Medical Genetics & Genomic Medicine; Sexual Health/Venereology & HIV; Traditional/Alternative/Integrative (AYUSH) — no specialty in them is claimed by ≥25 facilities (a tagging gap, not proven absence). Excluded from `medical_scarcity`, retained at specialty grain. (So "X of 32," not "X of 35.")
3. **15 districts backfilled centroids** (11 Delhi NCT zones + Chandel, Subarnapur, Thoothukkudi, Warangal Urban) had no in-bounds pincode → city/state centroid (`centroid_backfilled` recorded; Delhi is dense-urban so distance isn't its driver).
4. **Haversine + coarse state-level terrain flag**, circuity-corrected — not road network, no seasonal access.
5. **Equal-split population** for the 116 post-2011 carve-out districts.

---

## 3. The join-key mapping (the make-or-break detail)

**The app's existing district layer keys on the `(nfhs_district, state)` pair** (`gold_district_supply_need`, `district_crosswalk.(nfhs_district, nfhs_state)`, `facility_district.(nfhs_district, nfhs_state)`, and the Atlas district GeoJSON `properties.nfhs_district` / `nfhs_state`).

**The new tables key on `district_id`**, which is literally:

```
district_id = UPPER(state) || '::' || UPPER(district)
```

e.g. `WEST BENGAL::PASCHIM BARDDHAMAN`, `CHHATTISGARH::BIJAPUR`. The `medical_desert.state` column carries the **NFHS state spellings** (`MAHARASTRA` — the NFHS misspelling — and `ANDAMAN & NICOBAR ISLANDS` with `&`), just **UPPERCASED**; `district` is proper-case. `district_id` is NOT a numeric 2011-Census code (population_2011 is a column, not the key).

### Reconciliation (verified, full 706, not a sample)
| Against | Match | Notes |
|---|---|---|
| `app_read.gold_district_supply_need` | **706 / 706** | case-insensitive `(nfhs_district, state)` pair; 0 unmatched either direction |
| `app_read.district_crosswalk` (v3 spine) | **706 / 706** | confirms `(nfhs_district, nfhs_state)` is the universal key |
| District GeoJSON `(nfhs_state, nfhs_district)` | **694 / 706** direct | the 12 gaps are metro one-to-many + 1 omission (below) |

Exact identities, both 706/706:
```sql
-- (a) join to the existing app district layer
JOIN app_read.gold_district_supply_need g
  ON UPPER(g.state) = UPPER(m.state)
 AND UPPER(g.nfhs_district) = UPPER(m.district)
-- (b) equivalently, reconstruct district_id from app keys
WHERE m.district_id = UPPER(g.state) || '::' || UPPER(g.nfhs_district)
```

### The 12 GeoJSON gaps (all expected, all already handled)
10 × `NCT OF DELHI` zones (East, New Delhi, North, North East, North West, Shahdara, South, South East, South West, West) + `MAHARASTRA::MUMBAI SUBURBAN` + `MIZORAM::CHANDEL`. Delhi/Mumbai are exactly the **metro one-to-many polygons** the Atlas already resolves through `path.nfhsKeys` (a single polygon carries multiple `nfhs_district` keys it means-aggregates). Chandel is a genuine GeoJSON omission (and a homonym — see below). So the choropleth join already has the machinery; `medical_desert` slots into the same `nfhsKeys` aggregation with **no new geo work**.

### The 8 homonym districts — KEY ON `district_id`, NEVER NAME ALONE
8 district names occur in two states each. Joining on name alone would cross-contaminate:
`AURANGABAD` (Bihar / Maharastra) · `BALRAMPUR` (Chhattisgarh / Uttar Pradesh) · `BIJAPUR` (Chhattisgarh / Karnataka) · `BILASPUR` (Chhattisgarh / Himachal Pradesh) · `CHANDEL` (Manipur / Mizoram) · `HAMIRPUR` (Himachal Pradesh / Uttar Pradesh) · `PRATAPGARH` (Rajasthan / Uttar Pradesh) · `RAIGARH` (Chhattisgarh / Maharastra).
Always carry `district_id` (or the full `(district, state)` pair) end-to-end; the GeoJSON `path.nfhsKeys` aggregation already keys on the district name *within a drilled state*, so it is safe as long as the drill scopes by state first (which it does).

---

## 4. Integration plan (fits existing patterns)

Patterns to mirror: server routes in `asclepius/server/routes/lakebase/read-routes.ts` (`db.query<T>(sql, params)` → `{ rows }`, returned as `{ items }`); client read fns + `useFetch` hooks + Row types in `asclepius/client/src/lib/api.ts`; screens like `Atlas.tsx`.

### 4.1 Server routes (additive, `medical_desert.*`)

```ts
// ===== Medical desert — ranked district list ==============================
// GET /api/data/medical-deserts?state=&sort=burden|scarcity&limit=
app.get('/api/data/medical-deserts', h(async (req, res) => {
  const state = str(req.query.state);
  const sort = str(req.query.sort) === 'scarcity' ? 'scarcity_rank' : 'burden_rank';
  const limit = limitParam(req.query.limit, 60, 706);
  const r = await db.query(
    `SELECT district_id, district, state, burden_rank, burden_score,
            n_capability_deserts, population_2011, scarcity_rank, medical_scarcity,
            scarcity_tier, mean_distance_score, n_capabilities_scored,
            worst_capability, second_worst_capability, third_worst_capability
       FROM medical_desert.area_medical_scarcity
      WHERE ($1 = '' OR UPPER(state) = UPPER($1))
      ORDER BY ${sort} ASC          -- sort whitelisted above; not user SQL
      LIMIT $2`,
    [state, limit],
  );
  ok(res, { items: r.rows });
}));

// ===== Medical desert — district detail (capability gaps) =================
// GET /api/data/medical-desert/:districtId/capabilities
app.get('/api/data/medical-desert/:districtId/capabilities', h(async (req, res) => {
  const r = await db.query(
    `SELECT district_id, district, state, capability, capability_severity,
            severity_tier, capability_distance_score, capability_burden,
            n_specialties_total, n_specialties_scored, n_no_provider,
            worst_specialty, worst_specialty_severity
       FROM medical_desert.area_capability_desert
      WHERE district_id = $1
      ORDER BY capability_severity DESC`,
    [req.params.districtId],
  );
  ok(res, { items: r.rows });
}));

// ===== Medical desert — specialty drill-down (nearest_km) =================
// GET /api/data/medical-desert/:districtId/specialties?capability=&minConfidence=&limit=
app.get('/api/data/medical-desert/:districtId/specialties', h(async (req, res) => {
  const capability = str(req.query.capability);
  const limit = limitParam(req.query.limit, 100, 500);
  const r = await db.query(
    `SELECT district_id, district, state, specialty, capability, care_tier,
            n_facilities_claiming, claim_rate, coverage_confidence, risk_uplift,
            need_intensity, nearest_km, effective_km, distance_score, severity,
            severity_tier, burden, population_2011, no_provider_nationwide
       FROM medical_desert.area_specialty_desert
      WHERE district_id = $1
        AND ($2 = '' OR capability = $2)
      ORDER BY severity DESC
      LIMIT $3`,
    [req.params.districtId, capability, limit],
  );
  ok(res, { items: r.rows });
}));
```
(Whitelist `sort` to the two known columns — never interpolate raw user input into SQL. Errors already return the JSON-500 envelope via `h()`.)

### 4.2 Client hooks + Row types (`api.ts`)

```ts
export interface MedicalScarcityRow {
  district_id: string; district: string; state: string;
  burden_rank: number; burden_score: number; n_capability_deserts: number;
  population_2011: number; scarcity_rank: number; medical_scarcity: number;
  scarcity_tier: 'low' | 'moderate' | 'high' | 'extreme';
  mean_distance_score: number; n_capabilities_scored: number;
  worst_capability: string | null; second_worst_capability: string | null;
  third_worst_capability: string | null;
}
export interface CapabilityDesertRow {
  district_id: string; district: string; state: string; capability: string;
  capability_severity: number; severity_tier: string; capability_distance_score: number;
  capability_burden: number; n_specialties_total: number; n_specialties_scored: number;
  n_no_provider: number; worst_specialty: string | null; worst_specialty_severity: number | null;
}
export interface SpecialtyDesertRow {
  district_id: string; district: string; state: string; specialty: string;
  capability: string; care_tier: 'primary' | 'secondary' | 'tertiary';
  n_facilities_claiming: number; claim_rate: number;
  coverage_confidence: 'high' | 'medium'; risk_uplift: number; need_intensity: number;
  nearest_km: number; effective_km: number; distance_score: number;
  severity: number; severity_tier: string; burden: number;
  population_2011: number; no_provider_nationwide: boolean;
}

export type DesertSort = 'burden' | 'scarcity';
export interface MedicalDesertParams { state?: string; sort?: DesertSort; limit?: number; }

export async function medicalDeserts(p?: MedicalDesertParams): Promise<MedicalScarcityRow[]> {
  return unwrapRows<MedicalScarcityRow>(await request(`/api/data/medical-deserts${qs(p)}`));
}
export async function desertCapabilities(districtId: string): Promise<CapabilityDesertRow[]> {
  return unwrapRows<CapabilityDesertRow>(
    await request(`/api/data/medical-desert/${encodeURIComponent(districtId)}/capabilities`));
}
export async function desertSpecialties(districtId: string, capability?: string): Promise<SpecialtyDesertRow[]> {
  return unwrapRows<SpecialtyDesertRow>(
    await request(`/api/data/medical-desert/${encodeURIComponent(districtId)}/specialties${qs({ capability })}`));
}

export function useMedicalDeserts(p?: MedicalDesertParams) {
  return useFetch(() => medicalDeserts(p), [p?.state, p?.sort, p?.limit]);
}
export function useDesertCapabilities(districtId?: string) {
  return useFetch(() => (districtId ? desertCapabilities(districtId) : Promise.resolve([])), [districtId]);
}
export function useDesertSpecialties(districtId?: string, capability?: string) {
  return useFetch(() => (districtId ? desertSpecialties(districtId, capability) : Promise.resolve([])), [districtId, capability]);
}
```

### 4.3 UX (per the track brief)
1. **Ranked / sortable district list** with a segmented toggle **"Deploy priority (burden) ↔ Most isolated (per-capita)"** — same segmented-control idiom as Atlas's Coverage/Conditions toggle. Burden mode orders by `burden_rank` and shows population; scarcity mode orders by `scarcity_rank` and shows `medical_scarcity` + `scarcity_tier`. One sentence explaining the difference (burden = where most people are affected; scarcity = how bad access is for an individual).
2. **"X of 32 care families with no nearby access" badge** = `n_capability_deserts` (it is out of `n_capabilities_scored = 32`, not 35; footnote the 3 unscoreable families).
3. **District detail → capability gaps → specialty drill-down.** Click a district → `useDesertCapabilities(district_id)` lists capabilities by `capability_severity` (severity_tier chip). Click a capability → `useDesertSpecialties(district_id, capability)` lists services with **`nearest_km` to the closest claiming provider**, `care_tier`, and a `coverage_confidence` chip. Headline the three `worst_capability` columns.
4. **Choropleth keyed on `district_id`** — reuse the Atlas district drill verbatim. Build the lookup `Map<nfhs_district, MedicalScarcityRow>` exactly like `desertByDistrict`, shade by `medical_scarcity` (per-capita) in scarcity mode or by `burden_score` in burden mode. The metro `path.nfhsKeys` mean-aggregation already covers the 12 Delhi/Mumbai gaps; no GeoJSON change. Build the row map keyed by the same `nfhs_district` the Atlas uses (case-insensitive) so the 8 homonyms stay state-scoped via the existing drill.
5. **Explicit uncertainty** — a persistent note (mirroring Atlas's "How to read this" panel): "Severity is **per-capita** (population-independent); deploy priority adds population as a separate **burden** overlay. Distances are **straight-line, circuity-corrected** to the nearest facility that **claims** the service — claims are **not credential-verified** (see Trust Desk). Distances grounded in IPHS norms + the Lancet 2-hour standard. `coverage_confidence` flags how reliable the distance signal is per service." Show the `coverage_confidence` chip on every specialty row.

### 4.4 Relationship to the current biased layer (Atlas)
The current Atlas district desert shading reads `gold_district_supply_need.desert_score` via `useDeserts`, then inverts it into a green "coverage" ramp. Its own in-app honesty note already admits the flaw: *"the facility-supply join reaches ~90.3%… 182 of 706 districts show zero facilities, so true scarcity is conflated with crosswalk join gaps."* That is precisely the bias to retire.

**Recommendation: swap the Atlas district desert layer to `medical_desert`.**
- Replace the district-level `useDeserts` shading with `useMedicalDeserts({ sort })` shaded by `medical_scarcity` (default) — distance-based, no zero-facility artifact, every district scored 32/32.
- Add the burden ↔ scarcity toggle to the district view so the map itself tells the honesty story: metros (Pune low/scarcity 682, Bangalore low/scarcity 690) correctly stop reading as "worst deserts."
- Keep `gold_district_supply_need`'s **NFHS-5 indicator columns** (institutional birth %, ANC visits, sanitation, etc.) — those are real and still feed the Conditions layer; only the modeled `desert_score`/`desert_rank` columns are superseded.
- Leave the per-discipline REAL facility-count coverage view (`coverage-by-discipline`) untouched — it is a different, honest "real count" view and complements the new desert layer rather than competing.

Net honesty improvement: the desert map goes from *"how many facilities did we manage to map here"* (a data-pipeline artifact) to *"how far is the nearest provider of each needed service, per person"* (a real access measure), with population explicitly separated into a deploy-priority overlay rather than silently driving the ranking.

---

## 5. Decisions to flag (do NOT execute)

1. **GRANT (prerequisite).** The app service principal must get `SELECT` on the `medical_desert` schema (the app reads as the SP, not as the project owner — owner can already read, the SP cannot yet). Mirror how `app_read` was granted. Until this lands, the new routes will return the JSON-500 envelope (same expected pre-grant behavior the read-routes header documents). **Decision for the owner — not executed here.**
2. **Source-of-truth for the data.** Three options:
   - (a) **Keep the current Lakebase tables as-is** (already loaded, 706 / 22,592 / 137k) — simplest, ships now.
   - (b) **Lakebase synced table from UC** (`workspace.bf_vf.area_*`) — the build doc's intended promotion path (UC → synced table → app), refresh-on-rebuild, but requires Brett's promotion of `bf_vf` out of LOCAL/sandbox status first.
   - (c) **Full 2.07M-row `area_specialty_desert`** for drill-down — only needed if the UI must show the <25-facility (`coverage_confidence` low) and `no_provider_nationwide` rows. The 137k ≥medium slice already covers every headline/capability number and every populous service; the full set is a nice-to-have for exhaustive drill-down. Recommend deferring (b)/(c); ship on (a).
3. The data is currently **owned by `fulks89`** and the UC source is in **Brett-owned `workspace.bf_vf`** flagged LOCAL/sandbox — confirm promotion/ownership before treating it as a golden dependency.

---

## 6. Honest limitations of this assessment
- Verified entirely via read-only `SELECT`s against the live Lakebase + the local GeoJSON + the methodology doc; row counts, join reconciliation (706/706 and 694/706), homonyms (8), tiers, and example rows are all directly observed.
- Not verified: whether the app SP currently lacks `medical_desert` SELECT (inferred from the read-routes grant note, not tested by impersonating the SP); the full 2.07M UC table contents (only the 137k Lakebase slice was queried); and runtime rendering (no app code was run or changed).
