/**
 * Asclepius — Lakebase read routes.
 *
 * GET endpoints over the Lakebase Postgres schema `app_read.*`, synced from
 * Unity Catalog by Snapshot pipelines. UC ARRAY/STRUCT columns arrive as JSONB
 * (e.g. `facilities.specialties` is a JSONB array of discipline strings;
 * `claims` is a JSONB array of {text,status}). Membership tests use the JSONB
 * `?` containment operator: `specialties ? $1`.
 *
 * NOTE (deploy-first): the app service principal is granted SELECT on `app_read`
 * separately. Until that lands, every query here will error — that is expected.
 * Errors are returned as JSON 500 envelopes, not crashes.
 *
 * API used:  appkit.lakebase.query<T>(text, values?) -> { rows: T[] }
 */
import type express from 'express';
import type { AppkitLike, LakebaseClient } from './persistence-routes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(res: express.Response, body: unknown, status = 200): void {
  res.status(status).json(body);
}
function fail(res: express.Response, code: string, message: string, status = 400): void {
  res.status(status).json({ error: { code, message } });
}

function h(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[asclepius:read] route error:', message);
      if (!res.headersSent) fail(res, 'INTERNAL', message, 500);
    });
  };
}

/** Clamp a `limit` query param to a sane range. */
function limitParam(raw: unknown, def = 60, max = 500): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

function registerReadRoutes(app: express.Application, db: LakebaseClient): void {
  // ===== Facility KPIs (counts for the landing dashboard) ==================
  // GET /api/data/facility-kpis
  // Field names match the client `FacilityKpiRow` contract (lib/api.ts):
  // total_facilities, states, districts, claimed_facilities, unverified_facilities.
  app.get(
    '/api/data/facility-kpis',
    h(async (_req, res) => {
      const r = await db.query<{
        total_facilities: number;
        states: number;
        districts: number;
        claimed_facilities: number;
        unverified_facilities: number;
      }>(
        `SELECT
           COUNT(*)::int                                              AS total_facilities,
           COUNT(DISTINCT state)::int                                 AS states,
           COUNT(DISTINCT district)::int                              AS districts,
           COUNT(*) FILTER (WHERE trust = 'verified')::int            AS claimed_facilities,
           COUNT(*) FILTER (WHERE trust IS DISTINCT FROM 'verified')::int
                                                                      AS unverified_facilities
         FROM app_read.facilities`,
      );
      ok(res, {
        kpis: r.rows[0] ?? {
          total_facilities: 0,
          states: 0,
          districts: 0,
          claimed_facilities: 0,
          unverified_facilities: 0,
        },
      });
    }),
  );

  // ===== Facility search ===================================================
  // GET /api/data/facilities?state=&district=&type=&trust=&q=&specialty=&limit=
  app.get(
    '/api/data/facilities',
    h(async (req, res) => {
      const state = str(req.query.state);
      const district = str(req.query.district);
      const type = str(req.query.type);
      const trust = str(req.query.trust);
      const specialty = str(req.query.specialty);
      const q = str(req.query.q).trim().toLowerCase();
      const like = q ? `%${q}%` : '';
      const limit = limitParam(req.query.limit);

      const r = await db.query(
        `SELECT id, name, type, city, state, lat, lng, specialties, trust, conf,
                beds, year, capability, procedure, equipment, description,
                pincode, district, data_quality_flag
         FROM app_read.facilities
         WHERE ($1 = '' OR state = $1)
           AND ($2 = '' OR district = $2)
           AND ($3 = '' OR type = $3)
           AND ($4 = '' OR trust = $4)
           AND ($5 = '' OR specialties ? $5)
           AND ($6 = '' OR lower(name) LIKE $7 OR lower(city) LIKE $7
                OR lower(COALESCE(capability,'')) LIKE $7)
         ORDER BY (trust = 'verified') DESC, conf DESC NULLS LAST
         LIMIT $8`,
        [state, district, type, trust, specialty, q, like, limit],
      );
      ok(res, { items: r.rows, shown: r.rows.length });
    }),
  );

  // ===== Facility detail ===================================================
  // GET /api/data/facility/:id
  app.get(
    '/api/data/facility/:id',
    h(async (req, res) => {
      const r = await db.query(
        `SELECT id, name, type, city, state, lat, lng, specialties, specialties_detail,
                needs, trust, conf, beds, year, capability, procedure, equipment,
                description, evidence, claims, pincode, district, data_quality_flag,
                possible_entity_dup, id_valid, coord_source
         FROM app_read.facilities WHERE id = $1 LIMIT 1`,
        [req.params.id],
      );
      if (!r.rows[0]) return fail(res, 'NOT_FOUND', 'facility not found', 404);
      ok(res, { facility: r.rows[0] });
    }),
  );

  // ===== Facility NABH accreditation (independent authority tier) ==========
  // GET /api/data/facility-nabh/:id -> nabh.facility_authority row, or null.
  // Gated to name-corroborated matches (geo-only matches are not credited).
  app.get(
    '/api/data/facility-nabh/:id',
    h(async (req, res) => {
      const r = await db.query(
        `SELECT facility_id, nabh_name, program_tier, status, match_confidence,
                accreditation_valid_thru, verified_bed_count, verified_specialties,
                verified_specialty_count, cert_no, cert_url
         FROM nabh.facility_authority
         WHERE facility_id = $1 AND match_confidence = 'name_corroborated'
         LIMIT 1`,
        [req.params.id],
      );
      ok(res, { nabh: r.rows[0] ?? null });
    }),
  );

  // ===== Atlas — state health (NFHS-5) =====================================
  // GET /api/data/atlas/state-health
  app.get(
    '/api/data/atlas/state-health',
    h(async (_req, res) => {
      // app_read.state_health's region column is `state` (district_health uses
      // state_ut); alias it so the client StateHealthRow.state_ut contract holds.
      const r = await db.query(
        `SELECT *, state AS state_ut FROM app_read.state_health ORDER BY state`,
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Atlas — district health (NFHS-5) ==================================
  // GET /api/data/atlas/district-health?state=&layer=&limit=
  app.get(
    '/api/data/atlas/district-health',
    h(async (req, res) => {
      const state = str(req.query.state);
      const limit = limitParam(req.query.limit, 200, 1000);
      const r = await db.query(
        `SELECT nfhs_district, state_ut, ncd, anaemia, malnutrition, womensnut,
                acutechild, cancerscreen, riskfactors
         FROM app_read.district_health
         WHERE ($1 = '' OR state_ut = $1)
         ORDER BY nfhs_district
         LIMIT $2`,
        [state, limit],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Medical desert planner ============================================
  // GET /api/data/deserts?state=&limit=  (top by desert_rank, lower rank = worse)
  app.get(
    '/api/data/deserts',
    h(async (req, res) => {
      const state = str(req.query.state);
      const limit = limitParam(req.query.limit, 60, 706);
      // Reads the Peter-corrected gold (readiness.gold_district_supply_need): the
      // 87.0 join-gap pin is gone and the 189 unknown-supply districts carry NULL
      // desert_rank/desert_score + coverage_flag='insufficient_supply_data'. NULLS
      // LAST keeps real deserts at the top; the client badges the unknown ones.
      const r = await db.query(
        `SELECT nfhs_district, state, facility_count, need_score, supply_scarcity,
                desert_score, desert_rank, coverage_flag
         FROM readiness.gold_district_supply_need
         WHERE ($1 = '' OR state = $1)
         ORDER BY desert_rank ASC NULLS LAST
         LIMIT $2`,
        [state, limit],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Medical desert (distance-based) — ranked district list ============
  // GET /api/data/medical-deserts?state=&sort=burden|scarcity&limit=
  //
  // The rigorous, distance-based desert layer (schema `medical_desert`). Unlike
  // app_read.gold_district_supply_need.desert_score (which conflated true
  // scarcity with a facility->district join gap), this measures distance to the
  // nearest claiming provider per needed service. Every district is scored
  // 32/32 — there is no zero-facility artifact.
  //   sort=burden   (default) -> ORDER BY burden_rank   ("where most people are affected")
  //   sort=scarcity           -> ORDER BY scarcity_rank ("how bad access is per person")
  // `sort` is WHITELISTED to a known column below — never interpolate raw input.
  // Ranks/counts/population are cast ::int and 0..1 scores ::float8 so the wire
  // value is a JS number, not a Postgres bigint/Decimal string.
  app.get(
    '/api/data/medical-deserts',
    h(async (req, res) => {
      const state = str(req.query.state);
      const sort: 'burden_rank' | 'scarcity_rank' =
        str(req.query.sort) === 'scarcity' ? 'scarcity_rank' : 'burden_rank';
      const limit = limitParam(req.query.limit, 60, 706);
      const r = await db.query(
        `SELECT district_id,
                district,
                state,
                burden_rank::int                  AS burden_rank,
                burden_score::float8              AS burden_score,
                n_capability_deserts::int         AS n_capability_deserts,
                population_2011::int               AS population_2011,
                scarcity_rank::int                AS scarcity_rank,
                medical_scarcity::float8          AS medical_scarcity,
                scarcity_tier,
                mean_distance_score::float8       AS mean_distance_score,
                n_capabilities_scored::int        AS n_capabilities_scored,
                worst_capability,
                second_worst_capability,
                third_worst_capability
           FROM medical_desert.area_medical_scarcity
          WHERE ($1 = '' OR UPPER(state) = UPPER($1))
          ORDER BY ${sort} ASC
          LIMIT $2`,
        [state, limit],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Medical desert — district detail (capability gaps) ================
  // GET /api/data/medical-desert/:districtId/capabilities
  //
  // Per care-family scarcity for one district, worst-first. districtId is the
  // medical_desert key: UPPER(state) || '::' || UPPER(district) (always carry
  // the full key end-to-end — 8 district names repeat across two states each).
  app.get(
    '/api/data/medical-desert/:districtId/capabilities',
    h(async (req, res) => {
      const r = await db.query(
        `SELECT district_id,
                district,
                state,
                capability,
                capability_severity::float8       AS capability_severity,
                severity_tier,
                capability_distance_score::float8 AS capability_distance_score,
                capability_burden::float8         AS capability_burden,
                n_specialties_total::int          AS n_specialties_total,
                n_specialties_scored::int         AS n_specialties_scored,
                n_no_provider::int                AS n_no_provider,
                worst_specialty,
                worst_specialty_severity::float8  AS worst_specialty_severity
           FROM medical_desert.area_capability_desert
          WHERE district_id = $1
          ORDER BY capability_severity DESC`,
        [req.params.districtId],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Medical desert — specialty drill-down (nearest_km) ================
  // GET /api/data/medical-desert/:districtId/specialties?capability=&limit=
  //
  // Per-service detail for one district (optionally one capability), worst-first,
  // with nearest_km to the closest facility that CLAIMS the service. Claims are
  // not credential-verified (Trust Desk validates separately) and distances are
  // straight-line, circuity-corrected — the client surfaces both caveats plus
  // the coverage_confidence (high|medium) chip on every row.
  //
  // CITATION JOIN: each row carries its nearest CLAIMING provider's own evidence
  // via a LEFT JOIN to medical_desert.facility_evidence on the nearest_facility_id
  // (clean 100% join over the slice). The evidence columns are aliased
  // (evidence_*) to keep them distinct from the desert grain's columns; the 3
  // no_provider_nationwide services have no nearest facility, so these come back
  // NULL — the client renders "no provider claims this anywhere." source_url is
  // the facility's OWN claimed URL (may be wrong/dead) — the client renders it as
  // a clearly-labeled, untrusted "facility-reported source," never an auto-followed
  // link. claim_capability is free-text; the client flags thin/empty claim text as
  // a low-confidence signal rather than hiding it.
  app.get(
    '/api/data/medical-desert/:districtId/specialties',
    h(async (req, res) => {
      const capability = str(req.query.capability);
      const limit = limitParam(req.query.limit, 100, 500);
      const r = await db.query(
        `SELECT s.district_id,
                s.district,
                s.state,
                s.specialty,
                s.capability,
                s.care_tier,
                s.n_facilities_claiming::int        AS n_facilities_claiming,
                s.claim_rate::float8                AS claim_rate,
                s.coverage_confidence,
                s.risk_uplift::float8               AS risk_uplift,
                s.need_intensity::float8            AS need_intensity,
                s.nearest_km::float8                AS nearest_km,
                s.effective_km::float8              AS effective_km,
                s.distance_score::float8            AS distance_score,
                s.severity::float8                  AS severity,
                s.severity_tier,
                s.burden::float8                    AS burden,
                s.population_2011::int               AS population_2011,
                s.no_provider_nationwide,
                s.nearest_facility_id,
                e.facility_name,
                e.city                              AS evidence_city,
                e.source_url,
                e.claim_specialties,
                e.claim_capability,
                e.claim_procedure,
                e.claim_equipment
           FROM medical_desert.area_specialty_desert s
           LEFT JOIN medical_desert.facility_evidence e
                  ON e.unique_id = s.nearest_facility_id
          WHERE s.district_id = $1
            AND ($2 = '' OR s.capability = $2)
          ORDER BY s.severity DESC
          LIMIT $3`,
        [req.params.districtId, capability, limit],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== District demand by discipline =====================================
  // GET /api/data/district-demand?district=&state=&discipline=
  app.get(
    '/api/data/district-demand',
    h(async (req, res) => {
      const district = str(req.query.district);
      const state = str(req.query.state);
      const discipline = str(req.query.discipline);
      const r = await db.query(
        `SELECT nfhs_district, state, discipline, demand_score, top_driver
         FROM app_read.district_demand
         WHERE ($1 = '' OR nfhs_district = $1)
           AND ($2 = '' OR state = $2)
           AND ($3 = '' OR discipline = $3)
         ORDER BY demand_score DESC
         LIMIT 200`,
        [district, state, discipline],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Symptom -> specialty crosswalk ====================================
  // GET /api/data/symptom-specialties?symptom=
  app.get(
    '/api/data/symptom-specialties',
    h(async (req, res) => {
      const symptom = str(req.query.symptom).trim().toLowerCase();
      const like = symptom ? `%${symptom}%` : '';
      const r = await db.query(
        `SELECT symptom, discipline, source_condition, confidence
         FROM app_read.ref_symptom_specialty
         WHERE ($1 = '' OR lower(symptom) LIKE $2)
         ORDER BY confidence DESC NULLS LAST
         LIMIT 100`,
        [symptom, like],
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== State coverage ====================================================
  // GET /api/data/state-coverage
  app.get(
    '/api/data/state-coverage',
    h(async (_req, res) => {
      const r = await db.query(
        `SELECT state, facility_count, coverage_index
         FROM app_read.state_coverage
         ORDER BY coverage_index DESC NULLS LAST`,
      );
      ok(res, { items: r.rows });
    }),
  );

  // ===== Per-discipline coverage (REAL facility counts) ====================
  // GET /api/data/coverage-by-discipline?level=state|district&state=
  //
  // REAL per-discipline supply: counts facilities that offer each discipline,
  // per region, from app_read.facilities.specialties (a JSONB array). Each
  // facility is placed via facility_district (id = unique_id, 100% clean);
  // ~1,059 unmapped facilities (NULL nfhs_state) are excluded. Disciplines are
  // unnested with jsonb_array_elements_text so we can GROUP BY discipline.
  //   level=state    → all states × all disciplines (no params)
  //   level=district → districts × disciplines for one state ($1 = NFHS state
  //                    spelling, '' for nationwide). Joins gold_district_supply_need
  //                    on the (nfhs_district, state) PAIR — district names repeat
  //                    across states — so the emitted (region, state) composite key
  //                    matches the Atlas district drill (useDeserts) exactly.
  // Rows: { region, state, discipline, facility_count }. COUNT(*)::int so the
  // wire value is a JS number, not a Decimal/bigint.
  app.get(
    '/api/data/coverage-by-discipline',
    h(async (req, res) => {
      const level = str(req.query.level) === 'district' ? 'district' : 'state';
      if (level === 'district') {
        const state = str(req.query.state);
        const r = await db.query<{
          region: string;
          state: string;
          discipline: string;
          facility_count: number;
        }>(
          `SELECT g.nfhs_district AS region,
                  g.state         AS state,
                  d.discipline    AS discipline,
                  COUNT(*)::int   AS facility_count
           FROM app_read.facilities f
           JOIN app_read.facility_district fd ON fd.unique_id = f.id
           JOIN app_read.gold_district_supply_need g
                ON g.nfhs_district = fd.nfhs_district
               AND g.state         = fd.nfhs_state
           JOIN LATERAL jsonb_array_elements_text(f.specialties) AS d(discipline) ON true
           WHERE ($1 = '' OR g.state = $1)
           GROUP BY g.nfhs_district, g.state, d.discipline
           ORDER BY g.nfhs_district, facility_count DESC`,
          [state],
        );
        return ok(res, { items: r.rows });
      }
      const r = await db.query<{
        region: string;
        state: string;
        discipline: string;
        facility_count: number;
      }>(
        `SELECT fd.nfhs_state AS region,
                fd.nfhs_state AS state,
                d.discipline  AS discipline,
                COUNT(*)::int AS facility_count
         FROM app_read.facilities f
         JOIN app_read.facility_district fd ON fd.unique_id = f.id
         JOIN LATERAL jsonb_array_elements_text(f.specialties) AS d(discipline) ON true
         WHERE fd.nfhs_state IS NOT NULL
         GROUP BY fd.nfhs_state, d.discipline
         ORDER BY fd.nfhs_state, facility_count DESC`,
      );
      ok(res, { items: r.rows });
    }),
  );
}

// ---------------------------------------------------------------------------
// Entry point — called from onPluginsReady.
// ---------------------------------------------------------------------------

/** Mounts all `app_read.*`-backed GET routes. Async-shaped to mirror
 *  {@link setupPersistenceRoutes} and stay awaitable in `onPluginsReady`. */
export function setupReadRoutes(appkit: AppkitLike): Promise<void> {
  appkit.server.extend((app) => {
    registerReadRoutes(app, appkit.lakebase);
  });
  return Promise.resolve();
}
