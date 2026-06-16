/* ============================================================================
   Asclepius — client data-access layer (Lakebase).

   Every screen reads + writes through this module. There are two halves:

   1. READS  → GET  /api/data/*  (Lakebase Postgres schema `app_read`, synced
      from UC by Snapshot pipelines). UC ARRAY/STRUCT columns arrive as JSONB,
      so the server hands them back as native JS arrays/objects already parsed
      from JSON — the Row interfaces below model that parsed shape
      (e.g. `specialties: string[]`, `claims: Claim[]`).

   2. WRITES → POST/PATCH/DELETE /api/{shortlist,notes,reviews,accounts,
      referrals,postings,applications,notifications,...} (Lakebase Postgres
      OLTP schema `app.*`). Owner identity comes from the X-Forwarded-Email
      header the server reads — the client never sends it.

   Convention (deliberately NOT useAnalyticsQuery): plain `fetch` + a tiny
   useState/useEffect hook (`useFetch`) so screens stay framework-light and the
   Lakebase read path is explicit. Mutations are plain async functions screens
   call from event handlers (then re-run the relevant read hook / refetch()).

   Server JSON envelopes (the wrappers below unwrap to the useful payload):
     list reads   → `{ items: T[] }`  (unwrapRows also tolerates rows/data/bare)
     single reads → `{ facility: T }` / `{ kpis: T }`
     writes       → endpoint-specific small ack objects (see each return type).
   ============================================================================ */

// ---------------------------------------------------------------------------
// Core fetch helpers
// ---------------------------------------------------------------------------

/** Error thrown by the fetch helpers; carries the HTTP status + server code. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Server failure envelope: `{ error: { code, message } }`. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Non-JSON body (e.g. an HTML error page) — surface the raw text.
    throw new ApiError(text.slice(0, 200), res.status, 'BAD_JSON');
  }
}

/** Low-level JSON request. Throws {@link ApiError} on non-2xx. */
async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  const data = await parseJson(res);
  if (!res.ok) {
    const env = (data ?? {}) as ErrorEnvelope;
    throw new ApiError(
      env.error?.message ?? res.statusText ?? 'Request failed',
      res.status,
      env.error?.code ?? 'HTTP_' + String(res.status)
    );
  }
  return data as T;
}

/**
 * Build a query string from a params object, dropping null/undefined/'' and
 * any non-primitive values. Accepts any plain object (typed param interfaces
 * pass through) — only string/number/boolean fields are serialized.
 */
function qs(params?: object): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, unknown][]) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      usp.set(k, String(v));
    }
  }
  const str = usp.toString();
  return str ? `?${str}` : '';
}

/** Reads return `{ rows: T[] }`; unwrap to the array (tolerant of a bare array). */
function unwrapRows<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
  }
  return [];
}

/** Single-row reads return `{ row: T }`; unwrap to T | null. */
function unwrapRow<T>(payload: unknown): T | null {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if ('row' in obj) return (obj.row as T) ?? null;
  }
  return (payload as T) ?? null;
}

// ===========================================================================
// READ row types — mirror app_read.* (JSONB columns already parsed to JS).
// ===========================================================================

/** One entry in a facility's `claims` JSONB array (`{text,status}`). */
export interface Claim {
  text: string;
  status: string;
}

/** A discipline-tagged need with optional structured detail. */
export interface SpecialtyDetail {
  discipline?: string;
  [k: string]: unknown;
}

/** app_read.facilities — JSONB arrays/objects arrive parsed. */
export interface FacilityRow {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  /** JSONB array of the 9 discipline strings. */
  specialties: string[];
  /** JSONB structured per-discipline detail. */
  specialties_detail: SpecialtyDetail[];
  /** JSONB array of need descriptors. */
  needs: string[];
  trust: string | null;
  conf: number | null;
  beds: number | null;
  year: number | null;
  capability: string | null;
  procedure: string | null;
  equipment: string | null;
  description: string | null;
  evidence: string | null;
  /** JSONB array of `{text,status}`. */
  claims: Claim[];
  pincode: string | null;
  district: string | null;
  data_quality_flag: string | null;
  possible_entity_dup: boolean | null;
  id_valid: boolean | null;
  coord_source: string | null;
}

/** Aggregate KPIs from app_read.facilities (the /api/data/facility-kpis route). */
export interface FacilityKpiRow {
  total_facilities: number;
  states: number;
  districts: number;
  claimed_facilities: number;
  unverified_facilities: number;
}

/** readiness.gold_district_supply_need — Peter-corrected desert ranking (+7 NFHS
 *  cols). supply_scarcity / desert_score / desert_rank are NULL for the 189
 *  unknown-supply districts (0 mapped facilities); coverage_flag badges them. */
export interface DesertRow {
  nfhs_district: string;
  state: string;
  facility_count: number;
  need_score: number;
  supply_scarcity: number | null;
  desert_score: number | null;
  desert_rank: number | null;
  coverage_flag?: string | null;
  [nfhsCol: string]: string | number | null | undefined;
}

/** app_read.district_health — per-district NFHS-5 indicators. */
export interface DistrictHealthRow {
  nfhs_district: string;
  state_ut: string;
  ncd: number | null;
  anaemia: number | null;
  malnutrition: number | null;
  womensnut: number | null;
  acutechild: number | null;
  cancerscreen: number | null;
  riskfactors: number | null;
}

/** app_read.state_health — per-state NFHS-5 indicators. */
export interface StateHealthRow {
  state_ut: string;
  ncd: number | null;
  anaemia: number | null;
  malnutrition: number | null;
  womensnut: number | null;
  acutechild: number | null;
  cancerscreen: number | null;
  riskfactors: number | null;
}

/** app_read.state_coverage — facility count + coverage index per state. */
export interface StateCoverageRow {
  state: string;
  facility_count: number;
  coverage_index: number;
}

/** app_read.district_demand — modeled discipline demand per district. */
export interface DistrictDemandRow {
  nfhs_district: string;
  state: string;
  discipline: string;
  demand_score: number;
  top_driver: string | null;
}

/** app_read.ref_symptom_specialty — symptom → discipline mapping. */
export interface SymptomSpecialtyRow {
  symptom: string;
  discipline: string;
  source_condition: string | null;
  confidence: number | null;
}

/**
 * Per-discipline coverage = REAL count of facilities offering each discipline,
 * per region (derived from app_read.facilities.specialties via the
 * /api/data/coverage-by-discipline route). NOT a modeled index.
 *   level=state    → `region` and `state` are both the NFHS state spelling.
 *   level=district → `region` is the NFHS district, `state` the NFHS state
 *                    (the (region, state) PAIR is the composite key the Atlas
 *                    district drill / DesertRow uses — district names repeat
 *                    across states).
 */
export interface DisciplineCoverageRow {
  region: string;
  state: string;
  discipline: string;
  facility_count: number;
}

// ---------------------------------------------------------------------------
// medical_desert.* — the rigorous, distance-based desert layer.
//
// Three grains, keyed by district_id = UPPER(state) || '::' || UPPER(district)
// (NFHS spellings, uppercased). This SUPERSEDES gold_district_supply_need's
// modeled desert_score (which conflated true scarcity with facility→district
// join gaps). Every value here is per-capita and population-INDEPENDENT;
// population enters only as a separate `burden` overlay (severity × pop).
//
//   area_medical_scarcity   — district headline (706 rows; PK district_id)
//   area_capability_desert  — per care-family gap (22,592; PK district_id,capability)
//   area_specialty_desert   — per service, nearest_km to closest CLAIMING
//                             provider (~137k ≥medium-confidence slice;
//                             PK district_id,specialty)
//
// Honesty caveats the UI must surface (see the Planner screen):
//   · Specialties are facility CLAIMS, not credential-verified (Trust Desk
//     validates separately). This is the single most important caveat.
//   · Severity is per-capita; deploy `burden` is the population overlay.
//   · Distances are straight-line (haversine), circuity-corrected — not road
//     distance/time. `coverage_confidence` flags how reliable distance is.
//   · "X of 32" care families: 3 of 35 are unscoreable (a tagging gap, not
//     proven absence), so n_capabilities_scored = 32, never 35.
// ---------------------------------------------------------------------------

/** area_medical_scarcity — one row per district (the headline grain). */
export interface MedicalScarcityRow {
  district_id: string;
  district: string;
  state: string;
  /** Deploy-priority rank (severity × population); 1 = most people affected. */
  burden_rank: number;
  burden_score: number;
  /** Care families with no nearby access, out of `n_capabilities_scored` (0–32). */
  n_capability_deserts: number;
  population_2011: number;
  /** Per-capita isolation rank; 1 = worst access for an individual. */
  scarcity_rank: number;
  /** 0–1 per-capita scarcity (population-independent). */
  medical_scarcity: number;
  scarcity_tier: 'low' | 'moderate' | 'high' | 'extreme';
  mean_distance_score: number;
  /** 32 for every district (35 families − 3 unscoreable). */
  n_capabilities_scored: number;
  worst_capability: string | null;
  second_worst_capability: string | null;
  third_worst_capability: string | null;
  /** From readiness.gold_district_supply_need (LEFT JOIN on UPPER(state)/
   *  UPPER(district)). 'insufficient_supply_data' marks a data-poor /
   *  unknown-supply district (0 mapped facilities — a data gap, not proven
   *  absence). NULL when the join misses = render no badge. */
  coverage_flag: string | null;
  /** Derived badge category ('unknown_supply' | null), mirrors readiness gap_label. */
  supply_label: string | null;
}

/** area_capability_desert — one row per (district, care family). */
export interface CapabilityDesertRow {
  district_id: string;
  district: string;
  state: string;
  capability: string;
  /** 0–1 per-capita severity for this care family. */
  capability_severity: number;
  severity_tier: string;
  capability_distance_score: number;
  capability_burden: number;
  n_specialties_total: number;
  n_specialties_scored: number;
  n_no_provider: number;
  worst_specialty: string | null;
  worst_specialty_severity: number | null;
}

/** area_specialty_desert — one row per (district, service). */
export interface SpecialtyDesertRow {
  district_id: string;
  district: string;
  state: string;
  specialty: string;
  capability: string;
  care_tier: 'primary' | 'secondary' | 'tertiary';
  /** Facilities nationwide that CLAIM this service (claims, not verified). */
  n_facilities_claiming: number;
  claim_rate: number;
  /** How reliable distance is as a signal here (the 137k slice is high|medium). */
  coverage_confidence: 'high' | 'medium';
  risk_uplift: number;
  need_intensity: number;
  /** Straight-line km to the nearest claiming provider. */
  nearest_km: number;
  /** Circuity-corrected effective km (haversine × terrain factor). */
  effective_km: number;
  distance_score: number;
  severity: number;
  severity_tier: string;
  burden: number;
  population_2011: number;
  no_provider_nationwide: boolean;
  // --- citation / evidence (LEFT JOIN medical_desert.facility_evidence on
  // nearest_facility_id). NULL for the 3 no_provider_nationwide services (no
  // nearest facility) — the UI renders "no provider claims this anywhere." ---
  /** unique_id of the nearest facility CLAIMING this service. */
  nearest_facility_id: string | null;
  /** That facility's display name (from facility_evidence). */
  facility_name: string | null;
  /** That facility's city (aliased to avoid colliding with the desert grain). */
  evidence_city: string | null;
  /** The facility's OWN claimed URL — may be wrong/dead. Render as an
   *  untrusted "facility-reported source," never an auto-followed link. */
  source_url: string | null;
  /** Controlled specialty list the facility claims. */
  claim_specialties: string | null;
  /** Free-text claimed capabilities (may be thin/empty/off-topic). */
  claim_capability: string | null;
  /** Free-text claimed procedures. */
  claim_procedure: string | null;
  /** Free-text claimed equipment. */
  claim_equipment: string | null;
}

/** Lens for the ranked district list / choropleth shading. */
export type DesertSort = 'burden' | 'scarcity';

export interface MedicalDesertParams {
  /** NFHS state spelling ('' / omitted = nationwide). */
  state?: string;
  /** 'burden' (deploy priority, default) or 'scarcity' (most isolated per-capita). */
  sort?: DesertSort;
  limit?: number;
}

// ===========================================================================
// READ functions — GET /api/data/*
// ===========================================================================

/** Facility KPIs (single aggregate row). GET /api/data/facility-kpis
 *  Server envelope is `{ kpis: {...} }`; also tolerates `{ row }` / one-element
 *  `rows[]` / a bare object in case the read envelope drifts. */
export async function facilityKpis(): Promise<FacilityKpiRow | null> {
  const payload = await request<unknown>('/api/data/facility-kpis');
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (obj.kpis && typeof obj.kpis === 'object') return obj.kpis as FacilityKpiRow;
  }
  const single = unwrapRow<FacilityKpiRow>(payload);
  if (single && 'total_facilities' in (single as object)) return single;
  return unwrapRows<FacilityKpiRow>(payload)[0] ?? null;
}

export interface FacilitySearchParams {
  q?: string;
  state?: string;
  district?: string;
  /** Filter to facilities whose `specialties` JSONB array contains this discipline. */
  specialty?: string;
  trust?: string;
  limit?: number;
  offset?: number;
}

/** Search/list facilities. GET /api/data/facilities */
export async function searchFacilities(params?: FacilitySearchParams): Promise<FacilityRow[]> {
  const payload = await request<unknown>(`/api/data/facilities${qs(params)}`);
  return unwrapRows<FacilityRow>(payload);
}

/** Single facility by id. GET /api/data/facility/:id (server route is singular) */
export async function facilityDetail(id: string): Promise<FacilityRow | null> {
  const payload = await request<unknown>(`/api/data/facility/${encodeURIComponent(id)}`);
  // Server envelope is `{ facility: {...} }`; tolerate `{ row }` / bare object too.
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (obj.facility && typeof obj.facility === 'object') {
      return obj.facility as FacilityRow;
    }
  }
  return unwrapRow<FacilityRow>(payload);
}

/** NABH accreditation authority for a facility (independent, name-corroborated
 *  matches only), or null if not accredited. GET /api/data/facility-nabh/:id */
export interface FacilityNabhRow {
  facility_id: string;
  nabh_name: string | null;
  program_tier: string | null;
  status: string | null;
  match_confidence: string | null;
  accreditation_valid_thru: string | null;
  verified_bed_count: string | null;
  verified_specialties: string | null;
  verified_specialty_count: string | null;
  cert_no: string | null;
  cert_url: string | null;
}
export async function facilityNabh(id: string): Promise<FacilityNabhRow | null> {
  const payload = await request<unknown>(`/api/data/facility-nabh/${encodeURIComponent(id)}`);
  // Server envelope is `{ nabh: {...} | null }`.
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (obj.nabh && typeof obj.nabh === 'object') return obj.nabh as FacilityNabhRow;
  }
  return null;
}

/**
 * One server-graded claim for a facility, from trust.facility_trust_card joined
 * with the facility's NABH authority. `tier` is the trust grade the SERVER
 * assigns (the citation guard stays server-owned) — the client renders
 * row.tier directly, never the broken uniform 'review' path.
 *   verified      — NABH-authority-backed or top trust_tier
 *   review        — corroborated (corroboration <> 'none')
 *   claimed       — extracted claim, not yet corroborated
 *   contradiction — consistency_flag signals a conflict
 * GET /api/data/facility-claims/:id
 */
export type ClaimTier = 'verified' | 'review' | 'claimed' | 'contradiction';

export interface FacilityClaimRow {
  claimed_specialty: string | null;
  /** Server-assigned trust grade — render this, not asClaimStatus. */
  tier: ClaimTier;
  trust_tier: string | null;
  corroboration: string | null;
  consistency_flag: string | null;
  matched_evidence: string | null;
  evidence_snippet: string | null;
  accredited: boolean | null;
  /** NABH cert PDF for the authority tier (null when not accredited). */
  cert_url: string | null;
}

/** Per-claim trust grading for a facility. GET /api/data/facility-claims/:id */
export async function facilityClaims(id: string): Promise<FacilityClaimRow[]> {
  const payload = await request<unknown>(`/api/data/facility-claims/${encodeURIComponent(id)}`);
  // Server envelope is `{ claims: [...] }`.
  return unwrapRows<FacilityClaimRow>(
    payload && typeof payload === 'object' && 'claims' in payload
      ? (payload as { claims: unknown }).claims
      : payload,
  );
}

/** State-level NFHS-5 health. GET /api/data/atlas/state-health */
export async function atlasStateHealth(): Promise<StateHealthRow[]> {
  const payload = await request<unknown>('/api/data/atlas/state-health');
  return unwrapRows<StateHealthRow>(payload);
}

/** District-level NFHS-5 health. GET /api/data/atlas/district-health?state= */
export async function atlasDistrictHealth(state?: string): Promise<DistrictHealthRow[]> {
  const payload = await request<unknown>(`/api/data/atlas/district-health${qs({ state })}`);
  return unwrapRows<DistrictHealthRow>(payload);
}

export interface DesertParams {
  state?: string;
  /** Cap rows (desert_rank ascending = worst deserts first). */
  limit?: number;
}

/** Care-desert ranking. GET /api/data/deserts */
export async function deserts(params?: DesertParams): Promise<DesertRow[]> {
  const payload = await request<unknown>(`/api/data/deserts${qs(params)}`);
  return unwrapRows<DesertRow>(payload);
}

export interface DistrictDemandParams {
  district?: string;
  state?: string;
  discipline?: string;
  limit?: number;
}

/** Modeled discipline demand by district. GET /api/data/district-demand */
export async function districtDemand(params?: DistrictDemandParams): Promise<DistrictDemandRow[]> {
  const payload = await request<unknown>(`/api/data/district-demand${qs(params)}`);
  return unwrapRows<DistrictDemandRow>(payload);
}

/** Symptom → discipline reference. GET /api/data/symptom-specialties?symptom= */
export async function symptomSpecialties(symptom?: string): Promise<SymptomSpecialtyRow[]> {
  const payload = await request<unknown>(`/api/data/symptom-specialties${qs({ symptom })}`);
  return unwrapRows<SymptomSpecialtyRow>(payload);
}

/** State coverage (facility count + coverage index). GET /api/data/state-coverage */
export async function stateCoverage(): Promise<StateCoverageRow[]> {
  const payload = await request<unknown>('/api/data/state-coverage');
  return unwrapRows<StateCoverageRow>(payload);
}

export interface DisciplineCoverageParams {
  /** 'state' (all states) or 'district' (one state's districts). Default 'state'. */
  level?: 'state' | 'district';
  /** NFHS state spelling — only used at district level ('' = nationwide). */
  state?: string;
}

/** Per-discipline REAL facility counts. GET /api/data/coverage-by-discipline */
export async function coverageByDiscipline(params?: DisciplineCoverageParams): Promise<DisciplineCoverageRow[]> {
  const payload = await request<unknown>(`/api/data/coverage-by-discipline${qs(params)}`);
  return unwrapRows<DisciplineCoverageRow>(payload);
}

// --- medical_desert.* (distance-based desert layer) ------------------------

/**
 * Ranked district list. GET /api/data/medical-deserts?state=&sort=&limit=
 * `sort=burden` orders by burden_rank (deploy priority); `sort=scarcity`
 * orders by scarcity_rank (most isolated per-capita). The server whitelists
 * `sort` to the two known rank columns — it never interpolates raw input.
 */
export async function medicalDeserts(p?: MedicalDesertParams): Promise<MedicalScarcityRow[]> {
  const payload = await request<unknown>(`/api/data/medical-deserts${qs(p)}`);
  return unwrapRows<MedicalScarcityRow>(payload);
}

/** Capability gaps for one district (severity DESC). GET /api/data/medical-desert/:districtId/capabilities */
export async function desertCapabilities(districtId: string): Promise<CapabilityDesertRow[]> {
  const payload = await request<unknown>(
    `/api/data/medical-desert/${encodeURIComponent(districtId)}/capabilities`,
  );
  return unwrapRows<CapabilityDesertRow>(payload);
}

/**
 * Specialty drill for one district (severity DESC), optionally scoped to one
 * capability. Each row carries nearest_km to the closest claiming provider +
 * a coverage_confidence chip. GET /api/data/medical-desert/:districtId/specialties?capability=
 */
export async function desertSpecialties(
  districtId: string,
  capability?: string,
): Promise<SpecialtyDesertRow[]> {
  const payload = await request<unknown>(
    `/api/data/medical-desert/${encodeURIComponent(districtId)}/specialties${qs({ capability })}`,
  );
  return unwrapRows<SpecialtyDesertRow>(payload);
}

// ===========================================================================
// WRITE types — mirror workspace.app_state.* OLTP rows + endpoint acks.
// ===========================================================================

/** Known account roles. The wire value is a plain string, so APIs that accept a
 *  role take `Role | string` via the broader `RoleInput` to preserve autocomplete
 *  without collapsing the literal union. */
// Mirrors the server AccountSchema.role enum (persistence-routes.ts).
export type Role = 'patient' | 'doctor' | 'hospital_admin';
// `string & {}` keeps the literal members for editor autocomplete while still
// accepting any string (the server validates), without collapsing to `string`.
export type RoleInput = Role | (string & {});

export interface Account {
  account_id: string;
  email: string;
  display_name: string | null;
  role: string | null;
  city: string | null;
  specialty: string | null;
  sub_specialty: string | null;
  years_experience: number | null;
  availability: string | null;
  relocate: boolean | null;
  telehealth: boolean | null;
  hospital_city: string | null;
  /** NMC / state-council registration number on the Indian Medical Register
   *  (IMR). Free text, not verified — captured for the free-agent listing. */
  registration_no: string | null;
  created_at?: string | null;
}

export interface CreateAccountInput {
  email?: string;
  account_id?: string;
  display_name?: string;
  role?: RoleInput;
  city?: string;
  specialty?: string;
  sub_specialty?: string;
  years_experience?: number;
  availability?: string;
  relocate?: boolean;
  telehealth?: boolean;
  hospital_city?: string;
  /** NMC / state-council (IMR) registration number. Optional, free text. */
  registration_no?: string;
}

export interface ShortlistItem {
  facility_id: string;
  created_at: string;
}

export interface NoteItem {
  facility_id: string;
  text: string;
  created_at: string;
}

export interface ReviewItem {
  facility_id: string;
  decision: string | null;
  via: string | null;
  claim_label: string | null;
  /** Server column is `claim_status` ('confirmed' | 'disputed'). */
  claim_status: string | null;
  created_at: string;
}

export interface Referral {
  referral_id: string;
  facility_id: string | null;
  facility_name: string | null;
  city: string | null;
  state: string | null;
  reason: string | null;
  urgency: string | null;
  patient: string | null;
  status: string;
  created_at: string;
}

export interface Posting {
  posting_id: string;
  city: string;
  hospital: string | null;
  discipline: string;
  sub: string | null;
  driver: string | null;
  urgency: string | null;
  /** Owner email — present on the public listing (server column `user_email`). */
  user_email?: string;
  created_at: string;
  /** Present only on `mine=1` listings. */
  applicants?: number;
}

export interface Application {
  application_id: string;
  posting_id: string;
  /** Server columns: `specialty`, `years_experience`. */
  specialty: string | null;
  sub: string | null;
  years_experience: number | null;
  created_at: string;
}

export interface Notification {
  notification_id: string;
  /** 'reach' | 'interest' | 'match'. */
  type: string;
  /** Server dedup key column is `notif_key`. */
  notif_key: string | null;
  text: string;
  read: boolean;
  created_at: string;
}

/** app.planner_priorities — a saved deploy-priority district + one-line note,
 *  owner-scoped by (user_email, district_id). district_id is the medical_desert
 *  key UPPER(state)||'::'||UPPER(district). */
export interface PlannerPriorityItem {
  district_id: string;
  district: string | null;
  state: string | null;
  /** 'burden' | 'scarcity' — the lens active when the priority was saved. */
  lens: string | null;
  note: string | null;
  created_at: string;
}

export interface SavePlannerPriorityInput {
  district_id: string;
  district?: string;
  state?: string;
  lens?: string;
  note?: string;
}

// ===========================================================================
// WRITE / mutation functions
// ===========================================================================

// --- Accounts --------------------------------------------------------------

/** Create or update a profile (no password, DEC-001). POST /api/accounts */
export async function createAccount(
  input: CreateAccountInput
): Promise<{ account: Account | null; seededAgent: boolean }> {
  return request('/api/accounts', { method: 'POST', json: input });
}

/** Load a profile by email (login = lookup). POST /api/accounts/login */
export async function loginByEmail(email: string): Promise<{ account: Account }> {
  return request('/api/accounts/login', { method: 'POST', json: { email } });
}

/** Current profile from the forwarded-email identity. GET /api/accounts/me */
export async function fetchMe(): Promise<{ account: Account | null; email: string }> {
  return request('/api/accounts/me');
}

/** Load a profile by email path param. GET /api/accounts/:email */
export async function fetchAccount(email: string): Promise<{ account: Account }> {
  return request(`/api/accounts/${encodeURIComponent(email)}`);
}

// --- Shortlist -------------------------------------------------------------

/** The caller's shortlist. GET /api/shortlist */
export async function fetchShortlist(): Promise<ShortlistItem[]> {
  const payload = await request<unknown>('/api/shortlist');
  return unwrapRows<ShortlistItem>(payload);
}

/** Toggle (or set with `on`) a facility on the shortlist. POST /api/shortlist */
export async function saveShortlist(
  facilityId: string,
  on?: boolean
): Promise<{ facility_id: string; saved: boolean }> {
  return request('/api/shortlist', {
    method: 'POST',
    json: { facility_id: facilityId, on },
  });
}

/** Remove a facility from the shortlist. DELETE /api/shortlist/:facilityId */
export async function removeShortlist(facilityId: string): Promise<{ facility_id: string; saved: boolean }> {
  return request(`/api/shortlist/${encodeURIComponent(facilityId)}`, {
    method: 'DELETE',
  });
}

// --- Notes -----------------------------------------------------------------

/** The caller's notes. GET /api/notes */
export async function fetchNotes(): Promise<NoteItem[]> {
  const payload = await request<unknown>('/api/notes');
  return unwrapRows<NoteItem>(payload);
}

/** Upsert one note per (owner, facility). POST /api/notes */
export async function addNote(facilityId: string, text: string): Promise<{ facility_id: string; text: string }> {
  return request('/api/notes', {
    method: 'POST',
    json: { facility_id: facilityId, text },
  });
}

// --- Reviews (Trust Desk) --------------------------------------------------

/** The caller's reviews. GET /api/reviews */
export async function fetchReviews(): Promise<ReviewItem[]> {
  const payload = await request<unknown>('/api/reviews');
  return unwrapRows<ReviewItem>(payload);
}

export interface PostReviewInput {
  facility_id: string;
  /** Facility-level decision ('confirmed' | 'site_visit'). */
  decision?: string;
  via?: string;
  /** Per-claim slot label (when reviewing a single claim). */
  claim_label?: string;
  /** Per-claim decision — server column/field is `claim_status`
   *  ('confirmed' | 'disputed'). */
  claim_status?: string;
}

/** Confirm/dispute a facility or a single claim (toggle). POST /api/reviews */
export async function postReview(input: PostReviewInput): Promise<{
  facility_id: string;
  decision: string | null;
  claim_label: string | null;
  claim_status: string | null;
}> {
  return request('/api/reviews', { method: 'POST', json: input });
}

// --- Referrals -------------------------------------------------------------

/** The caller's referrals. GET /api/referrals */
export async function fetchReferrals(): Promise<Referral[]> {
  const payload = await request<unknown>('/api/referrals');
  return unwrapRows<Referral>(payload);
}

export interface CreateReferralInput {
  facility_id?: string;
  facility_name?: string;
  city?: string;
  state?: string;
  reason?: string;
  urgency?: string;
  patient?: string;
}

/** Create a referral (status 'sent'). POST /api/referrals */
export async function createReferral(input: CreateReferralInput): Promise<{ referral_id: string; status: string }> {
  return request('/api/referrals', { method: 'POST', json: input });
}

/** Advance sent → accepted → completed (or set `status`). PATCH /api/referrals/:id */
export async function updateReferral(
  referralId: string,
  status?: string
): Promise<{ referral_id: string; status: string }> {
  return request(`/api/referrals/${encodeURIComponent(referralId)}`, {
    method: 'PATCH',
    json: { status },
  });
}

/** Delete a referral. DELETE /api/referrals/:id */
export async function deleteReferral(referralId: string): Promise<{ referral_id: string; deleted: boolean }> {
  return request(`/api/referrals/${encodeURIComponent(referralId)}`, {
    method: 'DELETE',
  });
}

// --- Postings --------------------------------------------------------------

export interface PostingsParams {
  /** `mine=1` → owner's postings with applicant counts. */
  mine?: boolean;
  discipline?: string;
}

/** List postings (open openings, or `mine` with applicant counts). GET /api/postings */
export async function fetchPostings(params?: PostingsParams): Promise<Posting[]> {
  const payload = await request<unknown>(
    `/api/postings${qs({ mine: params?.mine ? 1 : undefined, discipline: params?.discipline })}`
  );
  return unwrapRows<Posting>(payload);
}

export interface CreatePostingInput {
  city: string;
  discipline: string;
  hospital?: string;
  sub?: string;
  driver?: string;
  urgency?: string;
}

/** Toggle post/withdraw an opening. POST /api/postings */
export async function createPosting(input: CreatePostingInput): Promise<{ posting_id: string; posted: boolean }> {
  return request('/api/postings', { method: 'POST', json: input });
}

/** Withdraw an opening. DELETE /api/postings/:id */
export async function deletePosting(postingId: string): Promise<{ posting_id: string; posted: boolean }> {
  return request(`/api/postings/${encodeURIComponent(postingId)}`, {
    method: 'DELETE',
  });
}

// --- Applications ----------------------------------------------------------

/** The caller's applications. GET /api/applications */
export async function fetchApplications(): Promise<Application[]> {
  const payload = await request<unknown>('/api/applications');
  return unwrapRows<Application>(payload);
}

export interface ApplyInput {
  posting_id: string | number;
  /** Server fields: `specialty`, `years_experience`. */
  specialty?: string;
  sub?: string;
  years_experience?: number;
}

/** Express interest in a posting (toggle). POST /api/applications */
export async function applyToPosting(input: ApplyInput): Promise<{ posting_id: string; applied: boolean }> {
  return request('/api/applications', { method: 'POST', json: input });
}

/** Withdraw an application. DELETE /api/applications/:id */
export async function deleteApplication(applicationId: string): Promise<{ application_id: string; applied: boolean }> {
  return request(`/api/applications/${encodeURIComponent(applicationId)}`, {
    method: 'DELETE',
  });
}

// --- Notifications ---------------------------------------------------------

/** The caller's notifications + unread count. GET /api/notifications */
export async function fetchNotifications(): Promise<{
  items: Notification[];
  unread: number;
}> {
  const payload = await request<{ items?: Notification[]; unread?: number }>('/api/notifications');
  return { items: payload.items ?? [], unread: payload.unread ?? 0 };
}

export interface PushNotificationInput {
  /** 'reach' | 'interest' | 'match' (server default 'match'). */
  type?: string;
  text: string;
  /** Dedup key (server column/field `notif_key`). */
  notif_key?: string;
  /** Target owner email (server field `user_email`); self-notify when omitted. */
  user_email?: string;
}

/** Push a notification (self-notify when user_email omitted). POST /api/notifications */
export async function pushNotification(
  input: PushNotificationInput
): Promise<{ user_email: string; notif_key: string }> {
  return request('/api/notifications', { method: 'POST', json: input });
}

/** Mark all the caller's notifications read. PATCH /api/notifications/read */
export async function markNotificationsRead(): Promise<{ read: boolean }> {
  return request('/api/notifications/read', { method: 'PATCH' });
}

/** Clear all the caller's notifications. DELETE /api/notifications */
export async function clearNotifications(): Promise<{ cleared: boolean }> {
  return request('/api/notifications', { method: 'DELETE' });
}

// --- Planner priorities (Medical Desert Planner) ---------------------------

/** The caller's saved planner priorities. GET /api/planner-priorities */
export async function fetchPlannerPriorities(): Promise<PlannerPriorityItem[]> {
  const payload = await request<unknown>('/api/planner-priorities');
  return unwrapRows<PlannerPriorityItem>(payload);
}

/** Save (upsert) a district priority + note/lens. POST /api/planner-priorities */
export async function savePlannerPriority(
  input: SavePlannerPriorityInput,
): Promise<{ district_id: string; saved: boolean }> {
  return request('/api/planner-priorities', { method: 'POST', json: input });
}

/** Un-save a district priority. DELETE /api/planner-priorities/:districtId */
export async function removePlannerPriority(
  districtId: string,
): Promise<{ district_id: string; saved: boolean }> {
  return request(`/api/planner-priorities/${encodeURIComponent(districtId)}`, {
    method: 'DELETE',
  });
}

// ===========================================================================
// AI ASSISTANT — POST /api/assistant
//
// The server owns retrieval (SQL keyword fallback over app_read.facilities),
// the Foundation Model call, the citation guard (every quote is a LITERAL
// substring of the named source field — see AI_GROUNDING §3.3), the
// uncertainty score (§4) and action validation (§5). The client only renders
// what the server returns and executes a suggested action on explicit user
// confirm (via the existing write fns: saveShortlist / createReferral /
// createPosting). No ungrounded prose ever reaches here.
// ===========================================================================

/** The three personas the assistant grounds for (AI_GROUNDING §6). */
export type AssistantPersona = 'patient' | 'clinician' | 'hospital';

/** Optional retrieval scope narrowing (state filter joins facility_district). */
export interface AssistantScope {
  state?: string;
  district?: string;
  /** A discipline the facilities' `specialties` JSONB must contain. */
  specialty?: string;
}

/** One conversation turn echoed back to the server for context. */
export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  persona: AssistantPersona;
  message: string;
  scope?: AssistantScope;
  history?: AssistantHistoryTurn[];
}

/**
 * A guarded citation. `quote` is the REAL substring the server sliced from the
 * named `field` of the facility with `facility_id` — never the model's text.
 */
export interface AssistantCitation {
  facility_id: string;
  facility_name: string;
  /** Source field the quote was anchored in (description/capability/…). */
  field: string;
  quote: string;
}

/** The per-message confidence chip (AI_GROUNDING §4). */
export interface AssistantUncertainty {
  /** 0–100; 0 when nothing anchored. */
  score: number;
  band: 'high' | 'medium' | 'low';
  /** Human-readable reasons the answer is (un)certain. */
  caveats: string[];
}

/**
 * A server-validated action the user may confirm. The `payload` always
 * references a `facility_id` (or fields) drawn from the retrieved set, so the
 * model can't invent a target. The CLIENT executes only on user confirm.
 */
export interface AssistantSuggestedAction {
  type: 'shortlist' | 'refer' | 'post_opening';
  label: string;
  payload: Record<string, unknown>;
}

export interface AssistantResponse {
  answer: string;
  citations: AssistantCitation[];
  uncertainty: AssistantUncertainty;
  suggestedActions: AssistantSuggestedAction[];
}

/** Ask the grounded multi-persona assistant. POST /api/assistant */
export async function askAssistant(req: AssistantRequest): Promise<AssistantResponse> {
  const payload = await request<Partial<AssistantResponse>>('/api/assistant', {
    method: 'POST',
    json: req,
  });
  // Defensive defaults: the contract guarantees these, but normalize so the UI
  // never crashes on a partial/legacy envelope.
  return {
    answer: payload.answer ?? '',
    citations: payload.citations ?? [],
    uncertainty: payload.uncertainty ?? { score: 0, band: 'low', caveats: [] },
    suggestedActions: payload.suggestedActions ?? [],
  };
}

// ===========================================================================
// React hooks — useState/useEffect (NOT useAnalyticsQuery).
// ===========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';

/** Async-load result shape returned by the read hooks. */
export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  /** Re-run the fetcher (e.g. after a mutation). */
  refetch: () => void;
}

/**
 * Generic data hook over a fetcher. Re-runs whenever a value in `deps` changes.
 * Guards against setting state after unmount and ignores stale in-flight results
 * when deps change rapidly (last-write-wins via a per-run id).
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown> = []): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  // Bump on each manual refetch to retrigger the effect.
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Keep the latest fetcher without forcing it into the dep array (callers
  // commonly pass an inline closure, which would otherwise loop forever).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    fetcherRef
      .current()
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, refetch };
}

// --- Read hooks (thin wrappers around useFetch + the read functions) -------

export function useFacilityKpis(): AsyncState<FacilityKpiRow | null> {
  return useFetch(() => facilityKpis(), []);
}

export function useSearchFacilities(params?: FacilitySearchParams): AsyncState<FacilityRow[]> {
  return useFetch(
    () => searchFacilities(params),
    [params?.q, params?.state, params?.district, params?.specialty, params?.trust, params?.limit, params?.offset]
  );
}

export function useFacilityDetail(id: string | undefined): AsyncState<FacilityRow | null> {
  return useFetch(() => (id ? facilityDetail(id) : Promise.resolve(null)), [id]);
}

export function useFacilityNabh(id: string | undefined): AsyncState<FacilityNabhRow | null> {
  return useFetch(() => (id ? facilityNabh(id) : Promise.resolve(null)), [id]);
}

export function useFacilityClaims(id: string | undefined): AsyncState<FacilityClaimRow[]> {
  return useFetch(() => (id ? facilityClaims(id) : Promise.resolve([])), [id]);
}

export function useAtlasStateHealth(): AsyncState<StateHealthRow[]> {
  return useFetch(() => atlasStateHealth(), []);
}

export function useAtlasDistrictHealth(state?: string): AsyncState<DistrictHealthRow[]> {
  return useFetch(() => atlasDistrictHealth(state), [state]);
}

export function useDeserts(params?: DesertParams): AsyncState<DesertRow[]> {
  return useFetch(() => deserts(params), [params?.state, params?.limit]);
}

export function useDistrictDemand(params?: DistrictDemandParams): AsyncState<DistrictDemandRow[]> {
  return useFetch(() => districtDemand(params), [params?.district, params?.state, params?.discipline, params?.limit]);
}

export function useSymptomSpecialties(symptom?: string): AsyncState<SymptomSpecialtyRow[]> {
  return useFetch(() => symptomSpecialties(symptom), [symptom]);
}

export function useStateCoverage(): AsyncState<StateCoverageRow[]> {
  return useFetch(() => stateCoverage(), []);
}

export function useCoverageByDiscipline(params?: DisciplineCoverageParams): AsyncState<DisciplineCoverageRow[]> {
  return useFetch(() => coverageByDiscipline(params), [params?.level, params?.state]);
}

// --- medical_desert read hooks ---------------------------------------------

export function useMedicalDeserts(p?: MedicalDesertParams): AsyncState<MedicalScarcityRow[]> {
  return useFetch(() => medicalDeserts(p), [p?.state, p?.sort, p?.limit]);
}

export function useDesertCapabilities(districtId?: string): AsyncState<CapabilityDesertRow[]> {
  return useFetch(
    () => (districtId ? desertCapabilities(districtId) : Promise.resolve([])),
    [districtId],
  );
}

export function useDesertSpecialties(
  districtId?: string,
  capability?: string,
): AsyncState<SpecialtyDesertRow[]> {
  return useFetch(
    () => (districtId ? desertSpecialties(districtId, capability) : Promise.resolve([])),
    [districtId, capability],
  );
}

// --- Owner-scoped read hooks for the write tables --------------------------

export function useShortlist(): AsyncState<ShortlistItem[]> {
  return useFetch(() => fetchShortlist(), []);
}

export function useNotes(): AsyncState<NoteItem[]> {
  return useFetch(() => fetchNotes(), []);
}

export function useReviews(): AsyncState<ReviewItem[]> {
  return useFetch(() => fetchReviews(), []);
}

export function useReferrals(): AsyncState<Referral[]> {
  return useFetch(() => fetchReferrals(), []);
}

export function usePostings(params?: PostingsParams): AsyncState<Posting[]> {
  return useFetch(() => fetchPostings(params), [params?.mine, params?.discipline]);
}

export function useApplications(): AsyncState<Application[]> {
  return useFetch(() => fetchApplications(), []);
}

export function useNotifications(): AsyncState<{ items: Notification[]; unread: number }> {
  return useFetch(() => fetchNotifications(), []);
}

export function useMe(): AsyncState<{ account: Account | null; email: string }> {
  return useFetch(() => fetchMe(), []);
}

export function usePlannerPriorities(): AsyncState<PlannerPriorityItem[]> {
  return useFetch(() => fetchPlannerPriorities(), []);
}

// ===========================================================================
// Track 4 — Data Readiness Desk (readiness.* + app.user_review_actions)
// ===========================================================================

/** readiness.readiness_gap_items — one reviewer-queue row per facility x gap. */
export interface ReadinessGapRow {
  gap_id: string;
  unique_id: string;
  facility_name: string;
  state: string | null;
  district: string | null;
  gap_type: string;
  suggested_action: string;
  contact_channel: string | null;
  contact_value: string | null;
  missing_fields: string | null;
  high_leverage: boolean;
  data_confidence: number;
  completeness_score: number;
  sample_unverified_specialty: string | null;
  unverified_claims: number;
  status: string;
  last_action?: string | null;
}

/** readiness.data_readiness — one per facility. */
export interface DataReadinessRow {
  unique_id: string;
  facility_name: string;
  state: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  has_phone: boolean;
  has_email: boolean;
  has_website: boolean;
  has_facebook: boolean;
  has_coords: boolean;
  data_quality_flag: boolean;
  possible_entity_dup: boolean;
  id_valid: boolean;
  sparse_capability: boolean;
  sparse_procedure: boolean;
  sparse_equipment: boolean;
  unverified_claims: number;
  sample_unverified_specialty: string | null;
  is_unmapped: boolean;
  phone_value: string | null;
  email_value: string | null;
  website_value: string | null;
  facebook_value: string | null;
  contact_channel: string | null;
  contact_value: string | null;
  address_text: string | null;
  completeness_score: number;
  data_confidence: number;
  primary_gap_type: string;
  high_leverage: boolean;
}

/** One cited Track-1 claim for a facility (the field/text a patch or flag changes). */
export interface ReadinessEvidenceRow {
  claimed_specialty: string | null;
  trust_tier: string | null;
  corroboration: string | null;
  consistency_flag: string | null;
  matched_evidence: string | null;
  evidence_snippet: string | null;
  accredited: boolean | null;
}

export interface ReadinessSummary {
  summary: {
    total_facilities: number;
    high_leverage: number;
    clean_facilities: number;
    total_gaps: number;
    avg_confidence: number;
  } | null;
  by_gap: { gap_type: string; n: number; high_leverage: number; avg_confidence: number }[];
}

export interface ReadinessDistrictRow {
  district: string;
  state: string | null;
  n_facilities: number;
  /** NULL for unknown-supply districts (0 mapped facilities). */
  avg_confidence: number | null;
  high_leverage: number;
  desert_score: number | null;
  coverage_flag: string | null;
  facility_count: number | null;
  need_score: number | null;
  /** real_gap | data_poor | unknown_supply | adequate */
  gap_label: string;
}

export interface ReadinessFacilityBundle {
  facility: DataReadinessRow;
  gaps: ReadinessGapRow[];
  evidence: ReadinessEvidenceRow[];
  overrides: { field: string; value: string }[];
}

export interface ReadinessGapParams {
  gap_type?: string;
  state?: string;
  q?: string;
  high_leverage?: boolean;
  /** Comma-separated sparse-field names (capability,procedure,equipment); OR-matched. */
  fields?: string;
  limit?: number;
  offset?: number;
}

export interface ReadinessActionInput {
  action: 'patch' | 'flag' | 'dismiss' | 'note' | 'dedupe';
  unique_id: string;
  gap_id?: string;
  gap_type?: string;
  field?: string;
  new_value?: string;
  issue_description?: string;
  decision?: 'merged' | 'distinct';
}

// --- reads -----------------------------------------------------------------

export async function readinessSummary(): Promise<ReadinessSummary> {
  const payload = await request<unknown>('/api/data/readiness/summary');
  const obj = (payload ?? {}) as Partial<ReadinessSummary>;
  return { summary: obj.summary ?? null, by_gap: obj.by_gap ?? [] };
}

export async function readinessGaps(params?: ReadinessGapParams): Promise<ReadinessGapRow[]> {
  const payload = await request<unknown>(`/api/data/readiness/gaps${qs(params)}`);
  return unwrapRows<ReadinessGapRow>(payload);
}

export async function readinessDistricts(limit = 120): Promise<ReadinessDistrictRow[]> {
  const payload = await request<unknown>(`/api/data/readiness/districts${qs({ limit })}`);
  return unwrapRows<ReadinessDistrictRow>(payload);
}

export async function readinessFacility(id: string): Promise<ReadinessFacilityBundle | null> {
  const payload = await request<unknown>(`/api/data/readiness/facility/${encodeURIComponent(id)}`);
  const obj = payload as ReadinessFacilityBundle | null;
  return obj && obj.facility ? obj : null;
}

/** A distinct field cited by sparse-field gaps, with its record count (a facet). */
export interface ReadinessSparseField {
  field: string;
  n: number;
}
export async function readinessSparseFields(): Promise<ReadinessSparseField[]> {
  const payload = await request<unknown>('/api/data/readiness/sparse-fields');
  return unwrapRows<ReadinessSparseField>(payload);
}

// --- write -----------------------------------------------------------------

export async function saveReadinessAction(
  input: ReadinessActionInput,
): Promise<{ gap_id: string | null; unique_id: string; status: string }> {
  return request('/api/readiness/action', { method: 'POST', json: input });
}

// --- hooks -----------------------------------------------------------------

export function useReadinessSummary(): AsyncState<ReadinessSummary> {
  return useFetch(() => readinessSummary(), []);
}

export function useReadinessGaps(params?: ReadinessGapParams): AsyncState<ReadinessGapRow[]> {
  return useFetch(
    () => readinessGaps(params),
    [params?.gap_type, params?.state, params?.q, params?.high_leverage, params?.fields, params?.limit, params?.offset],
  );
}

export function useReadinessDistricts(limit = 120): AsyncState<ReadinessDistrictRow[]> {
  return useFetch(() => readinessDistricts(limit), [limit]);
}

export function useReadinessSparseFields(): AsyncState<ReadinessSparseField[]> {
  return useFetch(() => readinessSparseFields(), []);
}

export function useReadinessFacility(id: string | undefined): AsyncState<ReadinessFacilityBundle | null> {
  return useFetch(() => (id ? readinessFacility(id) : Promise.resolve(null)), [id]);
}
