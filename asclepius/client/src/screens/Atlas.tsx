import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  ArrowBendUpLeft,
  GlobeHemisphereEast,
  MapPin,
  Trophy,
  WarningDiamond,
  FirstAid,
  Pulse,
  UsersThree,
  Crosshair,
  Info,
  Intersect,
} from '@phosphor-icons/react';
import {
  useStateCoverage,
  useAtlasStateHealth,
  useMedicalDeserts,
  useAtlasDistrictHealth,
  useCoverageByDiscipline,
  type StateCoverageRow,
  type StateHealthRow,
  type MedicalScarcityRow,
  type DesertSort,
  type DistrictHealthRow,
  type DisciplineCoverageRow,
} from '@/lib/api';
import { fonts, neutral, atlas, atlasColor, healthColor } from '@/components/asclepius/theme';
import { INDIA_GEO, projectGeo } from '@/lib/india-geo';
import {
  projectDistricts,
  districtsForState,
  INDIA_DISTRICTS_GEO,
  type ProjectedDistrict,
} from '@/lib/india-districts-geo';

/* ============================================================================
   Atlas (/atlas) — national coverage + NFHS-5 condition choropleth.

   STATE level is the zoomed-out default (lib/india-geo.ts). Clicking a state
   drills into its DISTRICTS (lib/india-districts-geo.ts). Two layers via a
   segmented toggle:
     · Coverage    — green ramp, supply / access indices
         state    → useStateCoverage()         (coverage_index per state)
         district → useMedicalDeserts({state})  (medical_desert distance-based
                    per-capita scarcity / deploy burden — see the lens sub-toggle)
     · Conditions  — red ramp, REAL NFHS-5 (2019-21) prevalence
         state    → useAtlasStateHealth()
         district → useAtlasDistrictHealth(state)

   The district desert shading reads the rigorous, distance-based medical_desert
   layer (replacing the join-gap-biased gold_district_supply_need.desert_score,
   which conflated true scarcity with facility→district crosswalk misses —
   182/706 districts read zero facilities). The Conditions layer (real NFHS-5)
   and the per-discipline REAL facility-count coverage layer are UNCHANGED.

   Metro one-to-many polygons (Delhi ↔ 11, Mumbai ↔ 2) aggregate (mean) their
   constituent NFHS districts via path.nfhsKeys (see india-districts-geo.ts).
   Polygons with no NFHS-5 record render in a neutral "no data" style.
   ============================================================================ */

const COVERAGE = '#2E7D67'; // clinician green — coverage accent
const PREVAL = '#B2503C'; // danger red — prevalence accent
const NODATA_FILL = '#EFE9DF'; // neutral "no NFHS-5 data" polygon fill
const BOTH_ACCENT = '#7A4FB0'; // bivariate "Both" accent (purple)

type Layer = 'coverage' | 'health' | 'both';

// ---------------------------------------------------------------------------
// Bivariate ("Both") palette — blend OVERALL care coverage (x axis) with the
// selected NFHS-5 condition's need (y axis) into one fill via 4-corner bilinear:
//   low cov + low need  → neutral sand        high cov + low need → green (well served)
//   low cov + high need → deep crimson (ACT)  high cov + high need → steel blue (covered, high-need)
// ---------------------------------------------------------------------------
const BV_CORNERS = {
  c00: [227, 221, 210], // low coverage, low need — neutral sand
  c10: [46, 125, 103], // high coverage, low need — green (well served)
  c01: [158, 46, 38], // low coverage, high need — deep crimson (ACT HERE)
  c11: [59, 111, 176], // high coverage, high need — steel blue (covered but high-need)
} as const;
const mixRgb = (a: readonly number[], b: readonly number[], t: number): number[] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgbToHex = (c: number[]): string =>
  '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** cov, need each 0-100 → blended bivariate hex. */
function bivariateColor(cov: number, need: number): string {
  const x = Math.max(0, Math.min(1, cov / 100));
  const y = Math.max(0, Math.min(1, need / 100));
  const bottom = mixRgb(BV_CORNERS.c00, BV_CORNERS.c10, x);
  const top = mixRgb(BV_CORNERS.c01, BV_CORNERS.c11, x);
  return rgbToHex(mixRgb(bottom, top, y));
}

// The 7 REAL NFHS-5 condition keys (DistrictHealthRow / StateHealthRow numeric
// columns) + friendly labels + a Phosphor icon, mirroring the prototype HEALTH.
type HealthKey =
  | 'ncd'
  | 'anaemia'
  | 'malnutrition'
  | 'womensnut'
  | 'acutechild'
  | 'cancerscreen'
  | 'riskfactors';

const HEALTH_CONDITIONS: {
  key: HealthKey;
  label: string;
  /** Conditions phrase appended to the health-layer subtitle (mirrors prototype HEALTH conds). */
  conds: string;
}[] = [
  { key: 'ncd', label: 'Chronic / NCD', conds: 'Hypertension, Diabetes' },
  { key: 'anaemia', label: 'Anaemia', conds: 'All women, pregnant women, children, adolescent girls' },
  { key: 'malnutrition', label: 'Child malnutrition', conds: 'Stunting, wasting, severe wasting, underweight, overweight' },
  { key: 'womensnut', label: "Women's nutrition", conds: 'Underweight BMI, obesity, high waist-hip ratio' },
  { key: 'acutechild', label: 'Acute child illness', conds: 'Recent diarrhoea, acute respiratory infection (ARI)' },
  { key: 'cancerscreen', label: 'Cancer screening gaps', conds: 'Cervical, breast, oral exam rates' },
  { key: 'riskfactors', label: 'Risk factors', conds: 'Tobacco use, alcohol use' },
];

// ---------------------------------------------------------------------------
// Coverage-mode disciplines. The 9 tokens in app_read.facilities.specialties
// (= ref_disciplines) ARE the display labels (no separate label column lives in
// the data), so friendly labels here are short cosmetic aliases of those tokens.
// `'all'` keeps today's overall behaviour (state_coverage / deserts); selecting
// a discipline re-shades the map by that discipline's REAL per-region facility
// count (count / max-count × 100 for the green ramp; raw count in tooltip + board).
// ---------------------------------------------------------------------------
// `string & {}` keeps the 'all' literal for editor autocomplete while still
// accepting any discipline token (mirrors RoleInput in lib/api.ts).
type DisciplineKey = 'all' | (string & {});

const DISCIPLINES: { token: string; label: string }[] = [
  { token: 'General Medicine', label: 'General Medicine' },
  { token: 'Obstetrics', label: 'Obstetrics' },
  { token: 'Trauma', label: 'Trauma' },
  { token: 'Pediatrics', label: 'Pediatrics' },
  { token: 'Orthopedics', label: 'Orthopedics' },
  { token: 'Nephrology', label: 'Nephrology' },
  { token: 'Cardiology', label: 'Cardiology' },
  { token: 'Ophthalmology', label: 'Ophthalmology' },
  { token: 'Oncology', label: 'Oncology' },
];

// Chip row for Coverage mode: leading "All disciplines" (token 'all' = overall
// behaviour) + one chip per discipline. `token` doubles as the React key.
const DISCIPLINE_CHIPS: { token: DisciplineKey; label: string }[] = [
  { token: 'all', label: 'All disciplines' },
  ...DISCIPLINES.map((d) => ({ token: d.token, label: d.label })),
];

// ---------------------------------------------------------------------------
// State-name normalization — the coverage table (`state`), the state-health
// table (`state_ut`) and the GeoJSON (`st_nm`) carry slightly different
// spellings (e.g. "NCT of Delhi" vs "Delhi", "&" vs "and"). Normalize to join.
// ---------------------------------------------------------------------------
function normState(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bnct of\b/g, '')
    .replace(/[^a-z]/g, '')
    .trim();
}

// Case-insensitive district key. The medical_desert `district` column carries
// the NFHS district spelling (proper-case), matching the GeoJSON path.nfhsKeys;
// lowercasing makes the join robust to minor case drift. Rows are always
// state-scoped first (the drill fetches one state), so the 8 homonym district
// names (e.g. Bijapur CG vs KA) never cross-contaminate.
function normDistrict(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

// NFHS state spelling → display st_nm, derived from the district GeoJSON (which
// carries both). Per-discipline STATE rows are keyed by the NFHS state spelling
// (e.g. "Maharastra"); this bridges them onto the state polygons (st_nm, e.g.
// "Maharashtra") so they share the SAME normState() join the rest of the Atlas
// uses. Built once at module load.
const NFHS_STATE_TO_NORM: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of INDIA_DISTRICTS_GEO.features) {
    const nfhs = f.properties.nfhs_state;
    if (nfhs) m.set(nfhs, normState(f.properties.st_nm));
  }
  return m;
})();

// Mean of finite numbers, or null when none.
function meanOf(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface RegionValue {
  /** Joined metric value (0-100); null = no data → neutral fill. */
  value: number | null;
  /** Color-ramp input (coverage: higher=darker green; health: higher=darker red). */
  shade: number | null;
}

export function Atlas() {
  const [layer, setLayer] = useState<Layer>('coverage');
  const [condition, setCondition] = useState<HealthKey>('ncd');
  // Coverage-mode discipline filter: 'all' = overall (today's behaviour) or a
  // discipline token from DISCIPLINES (re-shades by REAL per-region count).
  const [discipline, setDiscipline] = useState<DisciplineKey>('all');
  const byDiscipline = discipline !== 'all';
  // District desert lens (only used in the drilled, overall coverage view).
  // 'scarcity' (per-capita, population-independent) is the honest default;
  // 'burden' = deploy priority (severity × population).
  const [desertLens, setDesertLens] = useState<DesertSort>('scarcity');
  // Drill-down: the display state name (st_nm) we're zoomed into, or null = nation.
  const [drillState, setDrillState] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; value: number | null; value2?: number | null } | null>(null);

  // ---- STATE-level data (national view) ----
  const coverage = useStateCoverage();
  const stateHealth = useAtlasStateHealth();

  // ---- DISTRICT-level data (drill-down). The district hooks take the NFHS
  // state spelling; derive it from the clicked state's first district polygon. ----
  const nfhsStateForDrill = useMemo(() => {
    if (!drillState) return undefined;
    const ds = districtsForState(drillState);
    return ds.find((d) => d.properties.nfhs_state)?.properties.nfhs_state ?? undefined;
  }, [drillState]);

  // District desert shading reads the medical_desert layer (distance-based,
  // per-capita). Scoped to the drilled NFHS state (the route filters
  // case-insensitively on UPPER(state)); the sentinel ' ' matches no row so we
  // never pull the full 706 nationwide set when not drilled. The lens picks the
  // ranking + the shaded metric.
  const medicalDeserts = useMedicalDeserts({
    state: drillState ? (nfhsStateForDrill ?? ' ') : ' ',
    sort: desertLens,
    limit: 706,
  });
  const districtHealth = useAtlasDistrictHealth(drillState ? nfhsStateForDrill : undefined);

  // ---- Per-discipline coverage (REAL facility counts). State-level loads once
  // (all states × 9 disciplines); district-level loads on drill, scoped to the
  // SAME NFHS state string useMedicalDeserts uses (keeps the (district,state) key
  // aligned). The district hook always runs but is given a sentinel state when
  // not drilled so it never pulls the nationwide 514×9 set unnecessarily. ----
  const stateDiscCoverage = useCoverageByDiscipline({ level: 'state' });
  const districtDiscCoverage = useCoverageByDiscipline({
    level: 'district',
    // ' ' is a state that matches no row → empty result when not drilled,
    // avoiding a nationwide fetch. When drilled, the real NFHS state spelling.
    state: drillState ? (nfhsStateForDrill ?? ' ') : ' ',
  });

  const inDistrict = drillState != null;
  const byScarcity = desertLens === 'scarcity';

  // ---- Projected geometry ----
  const stateGeo = useMemo(() => projectGeo(INDIA_GEO, { W: 600, H: 660 }), []);
  const districtGeo = useMemo(
    () => (drillState ? projectDistricts(districtsForState(drillState), { W: 600, H: 660 }) : null),
    [drillState],
  );

  // ---- Join: state value lookups (normalized name → value) ----
  const stateCoverageByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of coverage.data ?? ([] as StateCoverageRow[])) {
      m.set(normState(r.state), r.coverage_index);
    }
    return m;
  }, [coverage.data]);

  const stateHealthByName = useMemo(() => {
    const m = new Map<string, StateHealthRow>();
    for (const r of stateHealth.data ?? ([] as StateHealthRow[])) {
      m.set(normState(r.state_ut), r);
    }
    return m;
  }, [stateHealth.data]);

  // ---- Join: district value lookups ----
  // medical_desert rows keyed by case-insensitive district name. Rows are
  // already state-scoped by the route, so homonyms can't collide here.
  // `burdenMax` normalizes the population-scaled burden_score for the green ramp
  // (medical_scarcity is already 0–1).
  const desertByDistrict = useMemo(() => {
    const m = new Map<string, MedicalScarcityRow>();
    let burdenMax = 0;
    for (const r of medicalDeserts.data ?? ([] as MedicalScarcityRow[])) {
      m.set(normDistrict(r.district), r);
      if (r.burden_score > burdenMax) burdenMax = r.burden_score;
    }
    return { map: m, burdenMax };
  }, [medicalDeserts.data]);

  const districtHealthByDistrict = useMemo(() => {
    const m = new Map<string, DistrictHealthRow>();
    for (const r of districtHealth.data ?? ([] as DistrictHealthRow[])) {
      m.set(r.nfhs_district, r);
    }
    return m;
  }, [districtHealth.data]);

  // ---- Per-discipline count lookups (only meaningful when a discipline is
  // selected). STATE: normState(st_nm) → count for the active discipline, via
  // the NFHS-spelling bridge. DISTRICT: nfhs_district → count for the active
  // discipline (rows are already scoped to the drilled state). `*Max` is the
  // peak count across regions, used to normalize counts to 0–100 for the green
  // ramp (shade encodes RELATIVE density; tooltips/board show the raw count). ----
  const stateDiscByName = useMemo(() => {
    const m = new Map<string, number>();
    let max = 0;
    if (byDiscipline) {
      for (const r of stateDiscCoverage.data ?? ([] as DisciplineCoverageRow[])) {
        if (r.discipline !== discipline) continue;
        const norm = NFHS_STATE_TO_NORM.get(r.state) ?? normState(r.state);
        m.set(norm, r.facility_count);
        if (r.facility_count > max) max = r.facility_count;
      }
    }
    return { map: m, max };
  }, [byDiscipline, discipline, stateDiscCoverage.data]);

  const districtDiscByName = useMemo(() => {
    const m = new Map<string, number>();
    let max = 0;
    if (byDiscipline) {
      for (const r of districtDiscCoverage.data ?? ([] as DisciplineCoverageRow[])) {
        if (r.discipline !== discipline) continue;
        m.set(r.region, r.facility_count);
        if (r.facility_count > max) max = r.facility_count;
      }
    }
    return { map: m, max };
  }, [byDiscipline, discipline, districtDiscCoverage.data]);

  // Count → 0–100 shade for the green ramp (honest relative density: a region's
  // count as a fraction of the peak region's count in the active view). A region
  // with the max gets ~100; a region with 0/absent gets 0 (neutral via null).
  const shadeForCount = (count: number, max: number): number =>
    max > 0 ? Math.max(0, Math.min(100, (count / max) * 100)) : 0;

  // District medical_desert leaderboard value → 0–100 "worse-ness" shade.
  // Scarcity leaderboard values are already scarcity×100 (≤ ~55); burden values
  // are raw burden_score, normalized to the view peak so the bars/ramp differ.
  const desertWorstShade = (v: number): number =>
    byScarcity
      ? Math.max(0, Math.min(100, v))
      : desertByDistrict.burdenMax > 0
        ? Math.max(0, Math.min(100, (v / Math.round(desertByDistrict.burdenMax)) * 100))
        : 0;

  // ---- Value resolver: state polygon ----
  const valueForState = (st_nm: string): RegionValue => {
    if (layer === 'coverage') {
      if (byDiscipline) {
        // REAL per-discipline facility count. `value` = raw count (tooltip/board);
        // `shade` = count normalized to the peak state for the green ramp. A state
        // with no facilities of this discipline (absent row) reads as count 0.
        const c = stateDiscByName.map.get(normState(st_nm));
        if (c == null) return { value: 0, shade: null };
        return { value: c, shade: shadeForCount(c, stateDiscByName.max) };
      }
      const v = stateCoverageByName.get(normState(st_nm));
      return { value: v ?? null, shade: v ?? null };
    }
    const row = stateHealthByName.get(normState(st_nm));
    const v = row ? row[condition] : null;
    return { value: v ?? null, shade: v ?? null };
  };

  // ---- Value resolver: district polygon (aggregates metro one-to-many) ----
  const valueForDistrict = (path: ProjectedDistrict): RegionValue => {
    if (path.nfhsKeys.length === 0) return { value: null, shade: null }; // no NFHS record
    if (layer === 'coverage') {
      if (byDiscipline) {
        // REAL per-discipline counts SUM across constituent metro NFHS districts
        // (counts are additive, unlike the desert-score mean). `value` = raw sum;
        // `shade` = sum normalized to the peak district for the green ramp.
        const counts = path.nfhsKeys
          .map((k) => districtDiscByName.map.get(k))
          .filter((c): c is number => typeof c === 'number');
        const sum = counts.reduce((a, b) => a + b, 0);
        return { value: sum, shade: shadeForCount(sum, districtDiscByName.max) };
      }
      // medical_desert shading. Aggregate (mean) the active metric across the
      // constituent NFHS districts (metro one-to-many). The Coverage layer reads
      // "darker green = better access," so invert the desert metric into the ramp.
      const rows = path.nfhsKeys
        .map((k) => desertByDistrict.map.get(normDistrict(k)))
        .filter((r): r is MedicalScarcityRow => r != null);
      if (rows.length === 0) return { value: null, shade: null };
      if (byScarcity) {
        // medical_scarcity 0–1 (per-capita). value = 0–1; shade inverts so a
        // LESS scarce district reads darker green (stronger access).
        const v = meanOf(rows.map((r) => r.medical_scarcity));
        if (v == null) return { value: null, shade: null };
        return { value: v, shade: Math.max(0, Math.min(100, 100 - v * 100)) };
      }
      // burden_score (severity × population). value = raw burden; shade inverts
      // the burden normalized to the view peak so a lower-burden district reads
      // darker green.
      const v = meanOf(rows.map((r) => r.burden_score));
      if (v == null) return { value: null, shade: null };
      const norm = desertByDistrict.burdenMax > 0 ? (v / desertByDistrict.burdenMax) * 100 : 0;
      return { value: v, shade: Math.max(0, Math.min(100, 100 - norm)) };
    }
    const v = meanOf(
      path.nfhsKeys.map((k) => {
        const row = districtHealthByDistrict.get(k);
        return row ? row[condition] : null;
      }),
    );
    return { value: v, shade: v };
  };

  // ---- Bivariate ("Both") per-region shades. Coverage is the OVERALL index
  // (ignores the discipline filter); need is the selected NFHS-5 condition. Each
  // 0-100 or null. Reuses the same metrics the single layers shade by. ----
  const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));
  const covShadeForState = (st_nm: string): number | null =>
    stateCoverageByName.get(normState(st_nm)) ?? null;
  const needShadeForState = (st_nm: string): number | null => {
    const row = stateHealthByName.get(normState(st_nm));
    const v = row ? row[condition] : null;
    return v ?? null;
  };
  const covShadeForDistrict = (path: ProjectedDistrict): number | null => {
    if (path.nfhsKeys.length === 0) return null;
    const rows = path.nfhsKeys
      .map((k) => desertByDistrict.map.get(normDistrict(k)))
      .filter((r): r is MedicalScarcityRow => r != null);
    if (rows.length === 0) return null;
    if (byScarcity) {
      const v = meanOf(rows.map((r) => r.medical_scarcity));
      return v == null ? null : clamp100(100 - v * 100);
    }
    const v = meanOf(rows.map((r) => r.burden_score));
    if (v == null) return null;
    const norm = desertByDistrict.burdenMax > 0 ? (v / desertByDistrict.burdenMax) * 100 : 0;
    return clamp100(100 - norm);
  };
  const needShadeForDistrict = (path: ProjectedDistrict): number | null => {
    if (path.nfhsKeys.length === 0) return null;
    return meanOf(
      path.nfhsKeys.map((k) => {
        const row = districtHealthByDistrict.get(k);
        return row ? row[condition] : null;
      }),
    );
  };

  // ---- Loading / error flags for the active layer + view ----
  // In coverage mode with a discipline selected, the per-discipline hooks drive
  // status; otherwise the overall coverage/desert hooks do (unchanged).
  const coverageLoading = inDistrict
    ? byDiscipline
      ? districtDiscCoverage.loading
      : medicalDeserts.loading
    : byDiscipline
      ? stateDiscCoverage.loading
      : coverage.loading;
  const coverageError = inDistrict
    ? byDiscipline
      ? districtDiscCoverage.error
      : medicalDeserts.error
    : byDiscipline
      ? stateDiscCoverage.error
      : coverage.error;

  const healthLoading = inDistrict ? districtHealth.loading : stateHealth.loading;
  const healthError = inDistrict ? districtHealth.error : stateHealth.error;
  const activeLoading =
    layer === 'coverage'
      ? coverageLoading
      : layer === 'both'
        ? coverageLoading || healthLoading
        : healthLoading;
  const activeError =
    layer === 'coverage'
      ? coverageError
      : layer === 'both'
        ? (coverageError ?? healthError)
        : healthError;

  const ramp = layer === 'coverage' ? atlasColor : healthColor;
  const accent = layer === 'coverage' ? COVERAGE : layer === 'both' ? BOTH_ACCENT : PREVAL;

  // ---- Leaderboards (Best + Deserts) ----
  const activeCondition = HEALTH_CONDITIONS.find((c) => c.key === condition);
  const conditionLabel = activeCondition?.label ?? '';
  const conditionConds = activeCondition?.conds ?? '';

  const disciplineLabel =
    DISCIPLINES.find((d) => d.token === discipline)?.label ?? '';

  const leaderboards = useMemo(() => {
    type LbRow = { id: string; name: string; v: number };
    let best: LbRow[] = [];
    let worst: LbRow[] = [];

    // Per-discipline coverage: REAL facility counts. Best = most facilities
    // offering this discipline; "deserts" = fewest among regions that have ANY.
    if (layer === 'coverage' && byDiscipline) {
      const src = inDistrict ? districtDiscCoverage.data : stateDiscCoverage.data;
      const rows = (src ?? [])
        .filter((r) => r.discipline === discipline)
        .map((r) => ({ id: r.region, name: r.region, v: r.facility_count }))
        .sort((a, b) => b.v - a.v);
      best = rows.slice(0, 5); // most facilities = best covered
      worst = rows.slice(-5).reverse(); // fewest facilities = thinnest coverage
      return { best, worst };
    }

    if (!inDistrict) {
      if (layer === 'coverage') {
        const rows = (coverage.data ?? [])
          .map((r) => ({ id: r.state, name: r.state, v: Math.round(r.coverage_index) }))
          .sort((a, b) => b.v - a.v);
        best = rows.slice(0, 5);
        worst = rows.slice(-5).reverse();
      } else {
        // Mirror the prototype: sort states by prevalence DESC so the top panel
        // ("Highest prevalence") holds the most-affected states and the bottom
        // panel ("Lowest prevalence") holds the least-affected ones.
        const rows = (stateHealth.data ?? [])
          .map((r) => ({ id: r.state_ut, name: r.state_ut, v: r[condition] }))
          .filter((r): r is LbRow => typeof r.v === 'number')
          .map((r) => ({ ...r, v: Math.round(r.v) }))
          .sort((a, b) => b.v - a.v);
        best = rows.slice(0, 5); // highest prevalence
        worst = rows.slice(-5).reverse(); // lowest prevalence
      }
    } else {
      if (layer === 'coverage') {
        // medical_desert: best = least scarce / lowest burden; deserts = most.
        const src = medicalDeserts.data ?? [];
        const metric = (r: MedicalScarcityRow): number =>
          byScarcity ? r.medical_scarcity : r.burden_score;
        const fmt = (r: MedicalScarcityRow): number =>
          byScarcity ? Math.round(r.medical_scarcity * 100) : Math.round(r.burden_score);
        best = [...src]
          .sort((a, b) => metric(a) - metric(b))
          .slice(0, 5)
          .map((r) => ({ id: r.district_id, name: r.district, v: fmt(r) }));
        // Worst deserts ordered by the lens's own rank (1 = worst).
        worst = [...src]
          .sort((a, b) =>
            byScarcity ? a.scarcity_rank - b.scarcity_rank : a.burden_rank - b.burden_rank,
          )
          .slice(0, 5)
          .map((r) => ({ id: r.district_id, name: r.district, v: fmt(r) }));
      } else {
        const rows = (districtHealth.data ?? [])
          .map((r) => ({ id: r.nfhs_district, name: r.nfhs_district, v: r[condition] }))
          .filter((r): r is LbRow => typeof r.v === 'number')
          .map((r) => ({ ...r, v: Math.round(r.v) }))
          .sort((a, b) => a.v - b.v);
        best = rows.slice(0, 5);
        worst = rows.slice(-5).reverse();
      }
    }
    return { best, worst };
  }, [
    inDistrict,
    layer,
    condition,
    byDiscipline,
    discipline,
    byScarcity,
    coverage.data,
    stateHealth.data,
    medicalDeserts.data,
    districtHealth.data,
    stateDiscCoverage.data,
    districtDiscCoverage.data,
  ]);

  // ---- Copy ----
  const regionNoun = inDistrict ? 'districts' : 'states';
  const lensNoun = byScarcity ? 'per-capita scarcity' : 'deploy burden';
  const title =
    layer === 'both'
      ? inDistrict
        ? `${drillState ?? ''} — coverage vs ${conditionLabel}`
        : `Coverage vs ${conditionLabel} across India`
      : layer === 'coverage' && byDiscipline
      ? inDistrict
        ? `${drillState ?? ''} — ${disciplineLabel} coverage`
        : `${disciplineLabel} coverage across India`
      : inDistrict
        ? layer === 'coverage'
          ? `${drillState ?? ''} — medical deserts`
          : `${drillState ?? ''} — ${conditionLabel}`
        : layer === 'coverage'
          ? 'Healthcare coverage across India'
          : `${conditionLabel} prevalence across India`;

  const sub =
    layer === 'both'
      ? `Each region blends overall care coverage (green) with ${conditionLabel} need (red). Deep red-purple = thin care + high need (act here); green = well covered, low need.${
          inDistrict ? ' Click Back to zoom out.' : ' Click a state to drill into its districts.'
        }`
      : layer === 'coverage' && byDiscipline
      ? `Real count of facilities offering ${disciplineLabel} per ${
          inDistrict ? 'district' : 'state'
        }. Darker = more facilities (relative to the busiest ${
          inDistrict ? 'district' : 'state'
        }); hover for the raw count.${inDistrict ? ' Click Back to zoom out.' : ' Click a state to drill into its districts.'}`
      : inDistrict
        ? layer === 'coverage'
          ? `Distance-based ${lensNoun} (medical_desert). Darker = better access; ${
              byScarcity
                ? 'shading is per-capita (population-independent)'
                : 'shading reflects severity × population'
            }. Click Back to zoom out.`
          : 'District NFHS-5 (2019-21) prevalence — real survey values. Darker = higher prevalence.'
        : layer === 'coverage'
          ? 'Each state shaded by coverage strength — darker is heavier coverage, lighter is a thinner, higher-risk gap.'
          : `Modelled state-level prevalence — darker means the condition is more concentrated. ${conditionConds}. Illustrative, not case-tracking.`;

  // Legend right-hand label.
  const legendRight =
    layer === 'coverage'
      ? byDiscipline
        ? 'More facilities'
        : inDistrict
          ? 'Better access'
          : 'Stronger coverage'
      : 'Higher prevalence';
  const legendGradient =
    layer === 'coverage'
      ? `linear-gradient(90deg, ${atlasColor(8)}, ${atlasColor(100)})`
      : `linear-gradient(90deg, ${healthColor(8)}, ${healthColor(100)})`;

  const bestLabel =
    layer === 'coverage' && byDiscipline
      ? `Most ${disciplineLabel} ${regionNoun}`
      : inDistrict
        ? layer === 'coverage'
          ? byScarcity
            ? 'Least isolated districts'
            : 'Lowest-burden districts'
          : 'Lowest prevalence districts'
        : layer === 'coverage'
          ? 'Best covered'
          : 'Highest prevalence';
  const desertsLabel =
    layer === 'coverage' && byDiscipline
      ? `Thinnest ${disciplineLabel} ${regionNoun}`
      : inDistrict
        ? layer === 'coverage'
          ? byScarcity
            ? 'Most isolated deserts'
            : 'Top deploy-priority deserts'
          : 'Highest prevalence districts'
        : layer === 'coverage'
          ? 'Largest deserts'
          : 'Lowest prevalence';

  // Map render data: list of {key, name, d, fill, value} for the active view.
  const mapPaths = useMemo(() => {
    if (inDistrict && districtGeo) {
      return districtGeo.paths.map((p) => {
        if (layer === 'both') {
          const cov = covShadeForDistrict(p);
          const need = needShadeForDistrict(p);
          return {
            key: `${p.state}::${p.name}`,
            name: p.name,
            d: p.d,
            fill:
              cov != null && need != null
                ? bivariateColor(cov, need)
                : cov != null
                  ? atlasColor(cov)
                  : need != null
                    ? healthColor(need)
                    : NODATA_FILL,
            value: cov,
            value2: need,
            clickable: false as const,
            state: null as string | null,
          };
        }
        const rv = valueForDistrict(p);
        return {
          key: `${p.state}::${p.name}`,
          name: p.name,
          d: p.d,
          fill: rv.shade == null ? NODATA_FILL : ramp(rv.shade),
          value: rv.value,
          value2: null as number | null,
          clickable: false as const,
          state: null as string | null,
        };
      });
    }
    return stateGeo.paths.map((p) => {
      if (layer === 'both') {
        const cov = covShadeForState(p.name);
        const need = needShadeForState(p.name);
        return {
          key: p.name,
          name: p.name,
          d: p.d,
          fill:
            cov != null && need != null
              ? bivariateColor(cov, need)
              : cov != null
                ? atlasColor(cov)
                : need != null
                  ? healthColor(need)
                  : NODATA_FILL,
          value: cov,
          value2: need,
          clickable: true as const,
          state: p.name,
        };
      }
      const rv = valueForState(p.name);
      return {
        key: p.name,
        name: p.name,
        d: p.d,
        fill: rv.shade == null ? NODATA_FILL : ramp(rv.shade),
        value: rv.value,
        value2: null as number | null,
        clickable: true as const,
        state: p.name,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inDistrict,
    districtGeo,
    stateGeo,
    layer,
    condition,
    byDiscipline,
    discipline,
    byScarcity,
    stateCoverageByName,
    stateHealthByName,
    desertByDistrict,
    districtHealthByDistrict,
    stateDiscByName,
    districtDiscByName,
  ]);

  const viewW = inDistrict && districtGeo ? districtGeo.W : stateGeo.W;
  const viewH = inDistrict && districtGeo ? districtGeo.H : stateGeo.H;

  // Hover value formatter.
  const fmtVal = (v: number | null): string => {
    if (v == null) return 'no data';
    // Per-discipline coverage: raw facility count, pluralized.
    if (layer === 'coverage' && byDiscipline) {
      return `${String(Math.round(v))} ${Math.round(v) === 1 ? 'facility' : 'facilities'}`;
    }
    if (layer === 'coverage' && inDistrict) {
      return byScarcity ? `scarcity ${v.toFixed(2)}` : `burden ${String(Math.round(v))}`;
    }
    return layer === 'coverage' ? `${String(Math.round(v))}` : `${String(Math.round(v))}%`;
  };

  return (
    <div
      className="mx-auto w-full max-w-[1240px] px-[30px] pb-[70px] pt-6"
      style={{ animation: 'ascFade .45s ease both' }}
    >
      <Button asChild variant="ghost" className="mb-1 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/">
          <ArrowLeft weight="bold" size={15} />
          Back
        </Link>
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 32, letterSpacing: '-.025em', color: neutral.ink, margin: 0 }}>
            {title}
          </h2>
          <p style={{ fontSize: 16, color: neutral.textSoft, margin: '8px 0 0', maxWidth: '46em', textWrap: 'pretty' }}>
            {sub}
          </p>
        </div>
        {inDistrict && (
          <button
            type="button"
            onClick={() => {
              setDrillState(null);
              setHover(null);
            }}
            className="inline-flex items-center gap-2 rounded-[11px] px-[15px] py-2.5"
            style={{ background: '#fff', border: `1px solid ${neutral.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.text, cursor: 'pointer' }}
          >
            <ArrowBendUpLeft weight="bold" size={16} />
            Back to all states
          </button>
        )}
      </div>

      <div className="mt-[22px] grid grid-cols-1 items-start gap-[26px] lg:grid-cols-[1.45fr_.85fr]">
        {/* ---------------------------------------------------------- MAP */}
        <div
          className="rounded-[22px] p-[18px]"
          style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 44px -32px rgba(43,39,34,.3)' }}
        >
          {activeError ? (
            <div className="flex h-[460px] flex-col items-center justify-center gap-2.5 text-center" style={{ color: PREVAL }}>
              <WarningDiamond weight="fill" size={34} />
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 15 }}>Couldn’t load the map data</span>
              <span style={{ fontFamily: fonts.body, fontSize: 13, color: neutral.textFaint2 }}>{activeError}</span>
            </div>
          ) : activeLoading ? (
            <div className="flex h-[460px] flex-col items-center justify-center gap-2.5" style={{ color: neutral.textDisabled }}>
              <GlobeHemisphereEast size={38} />
              <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 14 }}>
                {inDistrict ? 'Loading district map…' : 'Loading the national map…'}
              </span>
            </div>
          ) : mapPaths.length === 0 ? (
            <div className="flex h-[460px] flex-col items-center justify-center gap-2.5" style={{ color: neutral.textDisabled }}>
              <GlobeHemisphereEast size={38} />
              <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 14 }}>No regions to show</span>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <svg viewBox={`0 0 ${String(viewW)} ${String(viewH)}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={title}>
                {mapPaths.map((p) => {
                  const isHover = hover?.name === p.name;
                  return (
                    <path
                      key={p.key}
                      d={p.d}
                      fill={p.fill}
                      stroke={isHover ? atlas.strokeHover : atlas.stroke}
                      strokeWidth={isHover ? 1.4 : 0.6}
                      style={{ cursor: p.clickable ? 'pointer' : 'default', transition: 'stroke .12s ease' }}
                      onMouseEnter={() => setHover({ name: p.name, value: p.value, value2: p.value2 })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => {
                        if (p.clickable && p.state) {
                          setDrillState(p.state);
                          setHover(null);
                        }
                      }}
                    />
                  );
                })}
              </svg>
            </div>
          )}

          {/* legend */}
          <div className="mt-2 flex flex-wrap items-center gap-4 px-1.5">
            {layer === 'both' ? (
              <div className="flex items-center gap-2.5">
                <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 15px)', gridAutoRows: '15px', gap: 2 }}>
                  {[84, 50, 16].flatMap((need) =>
                    [16, 50, 84].map((cov) => (
                      <span
                        key={`bv-${String(need)}-${String(cov)}`}
                        style={{ width: 15, height: 15, borderRadius: 3, background: bivariateColor(cov, need) }}
                      />
                    )),
                  )}
                </div>
                <div className="flex flex-col gap-0.5" style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 11, color: neutral.textFaint }}>
                  <span style={{ color: '#9E2E26', fontWeight: 700 }}>◤ thin care + high need = act here</span>
                  <span>↑ more need · → more coverage</span>
                </div>
              </div>
            ) : (
              <div className="flex min-w-[220px] flex-1 items-center gap-2.5">
                <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: neutral.textFaint, whiteSpace: 'nowrap' }}>Less</span>
                <span className="h-2.5 flex-1 rounded-full" style={{ background: legendGradient, border: `1px solid ${neutral.borderCard}` }} />
                <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: neutral.textFaint, whiteSpace: 'nowrap' }}>{legendRight}</span>
              </div>
            )}
            <div className="inline-flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: neutral.textMuted }}>
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: NODATA_FILL, border: `1px solid ${neutral.border}` }} />
              {layer === 'coverage' && byDiscipline ? 'No facilities here' : 'No NFHS-5 data'}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- SIDE */}
        <div className="flex flex-col gap-[18px] lg:sticky lg:top-[88px]">
          {/* layer toggle + chips + hover */}
          <div className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
            {/* segmented coverage ↔ conditions */}
            <div className="mb-3.5 flex gap-1 rounded-[11px] p-1" style={{ background: '#F1EBE1' }}>
              {(
                [
                  { key: 'coverage' as const, label: 'Coverage', Icon: FirstAid, color: COVERAGE },
                  { key: 'health' as const, label: 'Conditions', Icon: Pulse, color: PREVAL },
                  { key: 'both' as const, label: 'Both', Icon: Intersect, color: BOTH_ACCENT },
                ]
              ).map(({ key, label, Icon, color }) => {
                const active = layer === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setLayer(key);
                      if (key === 'both') setDiscipline('all');
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-2"
                    style={{
                      fontFamily: fonts.body,
                      fontWeight: 600,
                      fontSize: 13.5,
                      cursor: 'pointer',
                      border: 'none',
                      background: active ? '#fff' : 'transparent',
                      color: active ? color : neutral.textFaint,
                      boxShadow: active ? '0 2px 6px rgba(43,39,34,.1)' : 'none',
                    }}
                  >
                    <Icon weight="fill" size={15} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* District desert lens sub-toggle — only in the drilled, overall
                (non-discipline) coverage view. Deploy burden ↔ per-capita scarcity. */}
            {(layer === 'coverage' || layer === 'both') && inDistrict && !byDiscipline && (
              <div className="mb-3.5 flex gap-1 rounded-[11px] p-1" style={{ background: '#F1EBE1' }}>
                {(
                  [
                    { key: 'burden' as const, label: 'Deploy burden', Icon: UsersThree },
                    { key: 'scarcity' as const, label: 'Per-capita scarcity', Icon: Crosshair },
                  ]
                ).map(({ key, label, Icon }) => {
                  const active = desertLens === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDesertLens(key)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2.5 py-1.5"
                      style={{
                        fontFamily: fonts.body,
                        fontWeight: 600,
                        fontSize: 12.5,
                        cursor: 'pointer',
                        border: 'none',
                        background: active ? '#fff' : 'transparent',
                        color: active ? COVERAGE : neutral.textFaint,
                        boxShadow: active ? '0 2px 6px rgba(43,39,34,.1)' : 'none',
                      }}
                    >
                      <Icon weight="fill" size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mb-3" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, color: neutral.textFaint2, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {layer === 'coverage' ? 'Discipline' : layer === 'both' ? 'Overlay condition' : 'Condition'}
            </div>

            {layer !== 'coverage' ? (
              <div className="flex flex-wrap gap-2">
                {HEALTH_CONDITIONS.map(({ key, label }) => {
                  const active = condition === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCondition(key)}
                      className="inline-flex items-center rounded-full px-3 py-1.5"
                      style={{
                        fontFamily: fonts.body,
                        fontWeight: active ? 600 : 500,
                        fontSize: 12.5,
                        cursor: 'pointer',
                        border: `1px solid ${active ? PREVAL : neutral.border}`,
                        background: active ? `${PREVAL}1a` : '#fff',
                        color: active ? PREVAL : neutral.textMuted,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* "All disciplines" = today's overall coverage (state_coverage /
                    deserts). Each discipline chip re-shades by REAL facility count. */}
                {DISCIPLINE_CHIPS.map(({ token, label }) => {
                  const active = discipline === token;
                  return (
                    <button
                      key={token}
                      type="button"
                      onClick={() => setDiscipline(token)}
                      className="inline-flex items-center rounded-full px-3 py-1.5"
                      style={{
                        fontFamily: fonts.body,
                        fontWeight: active ? 600 : 500,
                        fontSize: 12.5,
                        cursor: 'pointer',
                        border: `1px solid ${active ? COVERAGE : neutral.border}`,
                        background: active ? `${COVERAGE}1a` : '#fff',
                        color: active ? COVERAGE : neutral.textMuted,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* hover readout */}
            {hover && (
              <div
                className="mt-3.5 flex items-center justify-between gap-2.5 rounded-[12px] px-3.5 py-2.5"
                style={{ background: '#F7F2EA', border: `1px solid ${neutral.border2}` }}
              >
                <span className="inline-flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>
                  <MapPin weight="fill" size={15} style={{ color: accent }} />
                  {hover.name}
                </span>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, color: accent, whiteSpace: 'nowrap' }}>
                  {layer === 'both'
                    ? `cov ${hover.value != null ? String(Math.round(hover.value)) : '–'} · ${
                        hover.value2 != null ? `${String(Math.round(hover.value2))}%` : '–'
                      }`
                    : fmtVal(hover.value)}
                </span>
              </div>
            )}
          </div>

          {/* best leaderboard */}
          <Leaderboard
            icon={<Trophy weight="fill" size={16} style={{ color: COVERAGE }} />}
            label={bestLabel}
            rows={leaderboards.best}
            valueColor={COVERAGE}
            loading={activeLoading}
            // Per-discipline rows carry raw facility counts (higher = more), so
            // normalize the count to the active view's peak for the green ramp.
            // District medical_desert rows carry scarcity×100 / burden (LOWER =
            // better access), so invert into the green ramp (darker = better access).
            // State coverage rows already carry coverage_index (higher = better).
            ramp={
              layer === 'coverage'
                ? byDiscipline
                  ? (v) =>
                      atlasColor(
                        shadeForCount(
                          v,
                          inDistrict ? districtDiscByName.max : stateDiscByName.max,
                        ),
                      )
                  : inDistrict
                    ? (v) => atlasColor(Math.max(0, Math.min(100, 100 - desertWorstShade(v))))
                    : atlasColor
                : healthColor
            }
          />

          {/* deserts leaderboard */}
          <Leaderboard
            icon={<WarningDiamond weight="fill" size={16} style={{ color: PREVAL }} />}
            label={desertsLabel}
            rows={leaderboards.worst}
            valueColor={PREVAL}
            loading={activeLoading}
            // Per-discipline "thinnest" rows carry raw counts (LOWER = worse), so
            // invert against the view peak — a sparser region reads as a darker red.
            // District medical_desert "deserts" carry scarcity×100 / burden (HIGHER
            // = worse), normalized to the view peak → darker red = worse access.
            // State coverage rows carry coverage_index (LOWER = worse) — invert so a
            // weaker-covered state reads as a darker (alarming) red bar.
            ramp={
              layer === 'coverage' && byDiscipline
                ? (v) =>
                    healthColor(
                      100 -
                        shadeForCount(
                          v,
                          inDistrict ? districtDiscByName.max : stateDiscByName.max,
                        ),
                    )
                : layer === 'coverage' && inDistrict
                  ? (v) => healthColor(desertWorstShade(v))
                  : layer === 'coverage' && !inDistrict
                    ? (v) => healthColor(Math.max(0, Math.min(100, 100 - v)))
                    : healthColor
            }
          />
        </div>
      </div>

      {/* uncertainty / honesty note */}
      <div
        className="mt-5 flex items-start gap-2.5 rounded-[14px] px-4 py-3.5"
        style={{ background: '#FCF8F2', border: `1px solid ${neutral.borderCard}` }}
      >
        <Info weight="fill" size={17} style={{ color: neutral.textFaint2, marginTop: 1, flexShrink: 0 }} />
        {layer === 'coverage' && byDiscipline ? (
          <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: 0, lineHeight: 1.55, textWrap: 'pretty' }}>
            <strong style={{ color: neutral.text }}>How to read this.</strong> Per-discipline coverage is a{' '}
            <strong style={{ color: neutral.text }}>real facility count</strong> — the number of facilities whose
            verified specialties include <strong style={{ color: neutral.text }}>{disciplineLabel}</strong>, placed
            on the NFHS map via the facility→district crosswalk. It is{' '}
            <strong style={{ color: neutral.text }}>not modeled</strong>. Shade encodes count relative to the busiest{' '}
            {inDistrict ? 'district' : 'state'} (darker = more); hover or the leaderboards show the raw count. About
            1,059 facilities that couldn’t be mapped to an NFHS district are excluded; metro polygons (Delhi, Mumbai)
            sum their constituent NFHS districts, and regions with no facility of this discipline render neutral.
          </p>
        ) : layer === 'coverage' && inDistrict ? (
          <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: 0, lineHeight: 1.55, textWrap: 'pretty' }}>
            <strong style={{ color: neutral.text }}>How to read this.</strong> District deserts now read the{' '}
            <strong style={{ color: neutral.text }}>distance-based medical_desert layer</strong> — straight-line,
            circuity-corrected distance to the nearest facility that{' '}
            <strong style={{ color: neutral.text }}>claims</strong> each needed service (claims are{' '}
            <strong style={{ color: neutral.text }}>not credential-verified</strong>; the Trust Desk validates
            separately). This supersedes the old supply-need score, which conflated true scarcity with crosswalk join
            gaps. <strong style={{ color: neutral.text }}>Per-capita scarcity</strong> is population-independent;{' '}
            <strong style={{ color: neutral.text }}>deploy burden</strong> is severity × population. Darker green =
            better access. Metro polygons (Delhi, Mumbai) shade the mean of their constituent NFHS districts. Open the{' '}
            <Link to="/planner" style={{ color: COVERAGE, fontWeight: 700 }}>
              Planner
            </Link>{' '}
            for the full capability → service drill-down.
          </p>
        ) : layer === 'both' ? (
          <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: 0, lineHeight: 1.55, textWrap: 'pretty' }}>
            <strong style={{ color: neutral.text }}>How to read this.</strong> Each region blends two real signals —{' '}
            <strong style={{ color: COVERAGE }}>overall care coverage</strong> (greener = stronger access) and{' '}
            <strong style={{ color: PREVAL }}>{conditionLabel} need</strong> (redder = higher NFHS-5 prevalence). The{' '}
            <strong style={{ color: '#9E2E26' }}>deep crimson</strong> corner — thin care AND high need — is where to act
            first; green is well covered and low need. Coverage is the overall index (not a single discipline); need is
            real NFHS-5 (2019-21) prevalence. Drill into a state for the distance-based district view.
          </p>
        ) : (
          <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: 0, lineHeight: 1.55, textWrap: 'pretty' }}>
            <strong style={{ color: neutral.text }}>How to read this.</strong> Condition layers are{' '}
            <strong style={{ color: neutral.text }}>real NFHS-5 (2019-21)</strong> prevalence (%, no population
            denominator). State coverage is a <strong style={{ color: neutral.text }}>modeled</strong> supply-need
            index — an estimate, not an official figure. Drill into a state to see the distance-based{' '}
            <strong style={{ color: neutral.text }}>medical_desert</strong> layer. Metro polygons (Delhi, Mumbai)
            shade the mean of their constituent NFHS districts; post-2011 splits and PoK areas have no NFHS-5 record
            and render neutral.
          </p>
        )}
      </div>

      {/* source line */}
      <p className="mt-3 flex items-center gap-1.5 px-1" style={{ fontSize: 12, color: neutral.textDisabled }}>
        <GlobeHemisphereEast size={13} />
        ~10,077 India facility records · NFHS-5 (2019-21), 706 districts · choropleth rendered from district + state
        GeoJSON.
      </p>
    </div>
  );
}

/* ---- ranked leaderboard (Best / Deserts) --------------------------------- */
function Leaderboard({
  icon,
  label,
  rows,
  valueColor,
  loading,
  ramp,
}: {
  icon: React.ReactNode;
  label: string;
  rows: { id: string; name: string; v: number }[];
  valueColor: string;
  loading: boolean;
  ramp: (v: number) => string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.v), 1);
  return (
    <div className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
      <div className="mb-3.5 flex items-center gap-2" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.ink }}>
        {icon}
        {label}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2.5">
          {['l1', 'l2', 'l3', 'l4', 'l5'].map((sk) => (
            <Skeleton key={sk} className="h-[18px] rounded-[6px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontFamily: fonts.body, fontSize: 13, color: neutral.textFaint2 }}>No data for this layer yet.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5">
              <span className="shrink-0 truncate" style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, color: neutral.text, width: 120 }} title={r.name}>
                {r.name}
              </span>
              <span className="h-[7px] flex-1 overflow-hidden rounded-full" style={{ background: neutral.track }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${String(Math.max(6, Math.round((100 * r.v) / max)))}%`, background: ramp(r.v) }}
                />
              </span>
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: valueColor, width: 34, textAlign: 'right' }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Atlas;
