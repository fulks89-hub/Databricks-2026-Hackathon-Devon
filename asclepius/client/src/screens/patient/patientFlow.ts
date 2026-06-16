// ============================================================================
// Patient flow — shared state + scoring, lifted from the prototype's
// renderVals() (Asclepius.dc.html ~lines 1571–2076).
//
// The three patient screens (Location → Needs → Results) carry origin / radius
// / needs / urgency through the **URL search params** so the selection survives
// navigation and deep-links, without needing a context provider wired into
// App.tsx (the integration phase owns App.tsx). useUrl* helpers below read +
// write those params via React Router.
//
// Scoring (fit + "why this score" breakdown + reason chips) reproduces the
// prototype formula exactly so the patient experience matches the design.
// ============================================================================

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { FacilityRow as ApiFacilityRow } from '@/lib/api';
import type { FacilityRow as CardFacilityRow, FitReason } from '@/components/asclepius';
import type { TrustState } from '@/components/asclepius';

// ---------------------------------------------------------------------------
// Constants (verbatim from the prototype)
// ---------------------------------------------------------------------------

/**
 * Origin cities the patient can travel from. Expanded nationwide (was ~10
 * Maharashtra cities) so the brief's own examples (Jaipur, Patna, Delhi,
 * Bengaluru) are selectable and the search can be scoped to the origin's state.
 * Every member MUST have a CITY_LL coord and SHOULD have an ORIGIN_STATE entry.
 */
export const ORIGINS = [
  // Maharashtra (kept from the prototype)
  'Pune', 'Mumbai', 'Thane', 'Nashik', 'Aurangabad',
  'Solapur', 'Kolhapur', 'Sangli', 'Latur', 'Nagpur',
  // Nationwide
  'Delhi', 'Jaipur', 'Patna', 'Bengaluru', 'Hyderabad',
  'Chennai', 'Kolkata', 'Ahmedabad', 'Lucknow', 'Bhopal',
  'Indore', 'Surat',
] as const;

export const DEFAULT_ORIGIN = 'Pune';
export const DEFAULT_RADIUS = 300;
export const RADIUS_MIN = 50;
export const RADIUS_MAX = 650;
export const RADIUS_STEP = 25;

/** Lay-symptom need cards → discipline (specialty). prototype `NEEDS`. */
export interface NeedDef {
  key: string;
  label: string;
  /** The discipline this need routes to (facilities.specialties member). */
  spec: string;
  /** Phosphor icon name (kebab, without the `ph-fill ph-` prefix). */
  icon: string;
}

export const NEEDS: NeedDef[] = [
  { key: 'cardiac', label: 'Chest pain / heart', spec: 'Cardiology', icon: 'Heartbeat' },
  { key: 'maternity', label: 'Pregnancy / maternity', spec: 'Obstetrics', icon: 'Baby' },
  { key: 'injury', label: 'Injury / fracture', spec: 'Orthopedics', icon: 'Bandaids' },
  { key: 'cancer', label: 'Cancer care', spec: 'Oncology', icon: 'HandHeart' },
  { key: 'child', label: 'Child health', spec: 'Pediatrics', icon: 'Balloon' },
  { key: 'eyes', label: 'Eye / cataract', spec: 'Ophthalmology', icon: 'Eye' },
  { key: 'kidney', label: 'Dialysis / kidney', spec: 'Nephrology', icon: 'Drop' },
  { key: 'general', label: 'General check-up', spec: 'General Medicine', icon: 'Stethoscope' },
];

/** Urgency chips. prototype `urgencyChips`. */
export interface UrgencyDef {
  key: string;
  label: string;
  icon: string;
}
export const URGENCIES: UrgencyDef[] = [
  { key: 'emergency', label: 'Right now', icon: 'Siren' },
  { key: 'soon', label: 'In a few days', icon: 'Clock' },
  { key: 'planning', label: 'Just planning', icon: 'CalendarDots' },
];
export const DEFAULT_URGENCY = 'soon';

/** City lat/lng for haversine distance. prototype `CITY_LL`, extended nationwide. */
export const CITY_LL: Record<string, [number, number]> = {
  // Maharashtra
  Pune: [18.52, 73.86], Mumbai: [19.07, 72.87], Thane: [19.22, 72.97], Nashik: [20.0, 73.79],
  Nagpur: [21.15, 79.09], Aurangabad: [19.88, 75.34], Solapur: [17.66, 75.91],
  Kolhapur: [16.7, 74.24], Sangli: [16.85, 74.58], Latur: [18.41, 76.58],
  // Nationwide
  Delhi: [28.61, 77.21], Jaipur: [26.91, 75.79], Patna: [25.59, 85.14], Bengaluru: [12.97, 77.59],
  Hyderabad: [17.39, 78.49], Chennai: [13.08, 80.27], Kolkata: [22.57, 88.36], Ahmedabad: [23.03, 72.59],
  Lucknow: [26.85, 80.95], Bhopal: [23.26, 77.41], Indore: [22.72, 75.86], Surat: [21.17, 72.83],
};

/**
 * Origin city → its app_read.facilities `state` spelling. Used to scope the
 * facilities search to the patient's own state. The server matches case-
 * insensitively (UPPER(state)=UPPER($1)), so minor casing drift is tolerated;
 * an origin absent here safely falls back to an unscoped (nationwide) search.
 */
export const ORIGIN_STATE: Record<string, string> = {
  // Maharashtra
  Pune: 'Maharashtra', Mumbai: 'Maharashtra', Thane: 'Maharashtra', Nashik: 'Maharashtra',
  Nagpur: 'Maharashtra', Aurangabad: 'Maharashtra', Solapur: 'Maharashtra',
  Kolhapur: 'Maharashtra', Sangli: 'Maharashtra', Latur: 'Maharashtra',
  // Nationwide
  Delhi: 'Delhi', Jaipur: 'Rajasthan', Patna: 'Bihar', Bengaluru: 'Karnataka',
  Hyderabad: 'Telangana', Chennai: 'Tamil Nadu', Kolkata: 'West Bengal', Ahmedabad: 'Gujarat',
  Lucknow: 'Uttar Pradesh', Bhopal: 'Madhya Pradesh', Indore: 'Madhya Pradesh', Surat: 'Gujarat',
};

// ---------------------------------------------------------------------------
// Geometry (prototype haversine + distOf)
// ---------------------------------------------------------------------------

/** Great-circle distance in km (rounded). prototype `haversine`. */
export function haversine(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371, d = Math.PI / 180;
  const dLa = (la2 - la1) * d, dLo = (lo2 - lo1) * d;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/**
 * Distance from the patient's origin to a facility, with a flag for whether it
 * is a *real* measured distance or an *approximate* placeholder.
 *
 * `approx` is true when we lack the inputs for a real haversine measurement
 * (no known origin centroid, or the facility has neither its own lat/lng nor a
 * CITY_LL-known city). In that case `dist` is a deterministic pseudo-distance
 * used only as a stable sort tiebreaker — it MUST NEVER be displayed as a
 * precise km nor used to hard-exclude a result (see Task #4). When `approx` is
 * false, `dist` is the rounded great-circle distance and is safe to display.
 */
export interface DistanceInfo {
  dist: number;
  approx: boolean;
}
export function distanceInfo(origin: string, f: ApiFacilityRow): DistanceInfo {
  const oll = CITY_LL[origin];
  const fll: [number, number] | undefined =
    f.lat != null && f.lng != null
      ? [f.lat, f.lng]
      : (f.city && CITY_LL[f.city]) || undefined;
  if (oll && fll) return { dist: haversine(oll[0], oll[1], fll[0], fll[1]), approx: false };
  // Deterministic pseudo-distance so coordless rows still get a stable sort
  // order — flagged approximate so it is never shown or used as a hard cutoff.
  let h = 0;
  for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) >>> 0;
  return { dist: 40 + (h % 560), approx: true };
}

/**
 * Distance from the patient's origin to a facility, in km. Prefers the
 * facility's own lat/lng, then its city centroid. Retained for callers that
 * only need a number; prefer {@link distanceInfo} when honesty about whether
 * the value is measured matters (it usually does — see Task #4).
 */
export function distanceOf(origin: string, f: ApiFacilityRow): number {
  return distanceInfo(origin, f).dist;
}

// ---------------------------------------------------------------------------
// Trust / fit scoring (prototype tScore + fit formula + fitMeta)
// ---------------------------------------------------------------------------

/** Normalize a possibly-null/odd trust string to one of the 3 component tiers. */
export function normalizeTrust(t: string | null | undefined): TrustState {
  const v = (t ?? '').toLowerCase();
  if (v === 'verified') return 'verified';
  if (v === 'review' || v === 'needs review' || v === 'needs_review') return 'review';
  return 'unverified';
}

/** Trust weight in the fit formula. prototype `tScore`. */
export function trustScore(t: TrustState): number {
  return t === 'verified' ? 1 : t === 'review' ? 0.6 : 0.3;
}

export interface ScoredFacility {
  f: ApiFacilityRow;
  /** km from origin. Only meaningful as a precise figure when !distApprox. */
  dist: number;
  /**
   * True when `dist` is an approximate placeholder (no real coords for either
   * endpoint). Such rows are never excluded by the radius cutoff, never have
   * their fabricated distance shown as a precise km, and contribute 0 proximity.
   */
  distApprox: boolean;
  /** disciplines the facility offers that the patient asked for. */
  matched: string[];
  /** whether at least one need is matched. */
  serviceMatch: boolean;
  /** 0–100 patient fit score (clamped 22..98). */
  fit: number;
}

/**
 * Patient fit, reproducing the prototype:
 *   fit = (hasNeeds ? 14 + coverFrac*48 : 42)
 *       + trustScore*24
 *       + proximity*16          (proximity = 1 - dist/radius)
 *   clamped to [22, 98].
 */
export function scoreFacility(
  f: ApiFacilityRow,
  needSpecs: string[],
  origin: string,
  radius: number,
): ScoredFacility {
  const { dist, approx } = distanceInfo(origin, f);
  const specs = f.specialties ?? [];
  const matched = needSpecs.filter((sp) => specs.includes(sp));
  const hasNeeds = needSpecs.length > 0;
  const coverFrac = hasNeeds ? matched.length / needSpecs.length : 0;
  // A fabricated (approximate) distance must never inflate fit, so its
  // proximity term is 0 rather than derived from the placeholder number.
  const prox = approx ? 0 : Math.max(0, 1 - dist / radius);
  const t = normalizeTrust(f.trust);
  let fit = Math.round(
    (hasNeeds ? 14 + coverFrac * 48 : 42) + trustScore(t) * 24 + prox * 16,
  );
  fit = Math.max(22, Math.min(98, fit));
  return { f, dist, distApprox: approx, matched, serviceMatch: matched.length > 0, fit };
}

/**
 * Rank facilities by fit (desc), then distance (asc). The radius is a HARD
 * cutoff only for rows with a *real* measured distance — rows whose distance is
 * approximate (no coords) are retained rather than silently dropped by a
 * fabricated number, and are ordered after all measured rows (see Task #4).
 */
export function rankFacilities(
  facilities: ApiFacilityRow[],
  needSpecs: string[],
  origin: string,
  radius: number,
): ScoredFacility[] {
  return facilities
    .map((f) => scoreFacility(f, needSpecs, origin, radius))
    .filter((s) => s.distApprox || s.dist <= radius)
    .sort((a, b) =>
      a.distApprox === b.distApprox
        ? b.fit - a.fit || a.dist - b.dist
        : a.distApprox
          ? 1
          : -1,
    );
}

/**
 * "Why this score" breakdown (3 sourced rows). Mirrors the prototype's
 * `breakdown` array — need-coverage (capability), trust+confidence, proximity.
 */
export function fitBreakdown(
  s: ScoredFacility,
  needSpecs: string[],
  origin: string,
  radius: number,
): FitReason[] {
  const hasNeeds = needSpecs.length > 0;
  // Approximate (placeholder) distance contributes no proximity points and is
  // never shown as a precise km — mirror scoreFacility's prox=0 for approx rows.
  const prox = s.distApprox ? 0 : Math.max(0, 1 - s.dist / radius);
  const needPts = hasNeeds
    ? Math.round(14 + (s.matched.length / needSpecs.length) * 48)
    : 42;
  const t = normalizeTrust(s.f.trust);
  const trustPts = Math.round(trustScore(t) * 24);
  const proxPts = Math.round(prox * 16);
  // Confidence is DISPLAYED but does not enter the math (only the categorical
  // trust tier weights the score). Show the % only when actually recorded —
  // a null conf is "not recorded", never "0% confident".
  const confText = s.f.conf != null ? `, ${s.f.conf}% record confidence` : ', confidence not recorded';
  return [
    {
      label: hasNeeds
        ? s.matched.length
          ? `Service match — offers ${s.matched.join(', ')}`
          : 'No service match for your needs'
        : 'No specific need selected',
      pts: needPts,
      src: 'capability',
    },
    {
      label: `Evidence — ${t} record${confText}`,
      pts: trustPts,
      src: 'trust + confidence',
    },
    {
      label: s.distApprox
        ? 'Proximity — distance approximate (no precise coordinates)'
        : `Proximity — ${s.dist} km from ${origin}`,
      pts: proxPts,
      src: 'location',
    },
  ];
}

/** Reason chips shown on the card. Mirrors the prototype `reasons` array. */
export interface ReasonChip {
  text: string;
}
export function reasonChips(s: ScoredFacility, needSpecs: string[], origin: string): ReasonChip[] {
  const hasNeeds = needSpecs.length > 0;
  const chips: ReasonChip[] = [];
  if (s.serviceMatch) {
    chips.push({
      text:
        s.matched.length <= 2
          ? `Offers ${s.matched.join(' & ')}`
          : `Covers ${s.matched.length} of ${needSpecs.length} needs`,
    });
  } else if (hasNeeds) {
    chips.push({ text: 'No matching service listed' });
  }
  // Never present a fabricated km as a measured fact — label it approximate.
  chips.push({ text: s.distApprox ? 'Distance approximate' : `${s.dist} km from ${origin}` });
  // The record-confidence chip is intentionally omitted for patients: the card's
  // data-quality signal is the neutral "X out of 100 data points have information"
  // pill (see completenessOf + FacilityCard), so a separate "% record confidence"
  // chip would be redundant and contradict it.
  return chips.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Verbatim evidence quote — the cited facility text backing a result card
// ---------------------------------------------------------------------------

/** A verbatim cited quote + its attribution, for the result-card EvidenceQuote. */
export interface EvidenceQuotePick {
  text: string;
  source: string;
}

/** Cap a verbatim quote without paraphrasing: keep the exact prefix + ellipsis. */
function clipVerbatim(text: string, max = 180): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/**
 * Pick the verbatim facility text that best backs this match, for an inline
 * EvidenceQuote on the result card. Preference order (never fabricate):
 *   1. a claims[] entry whose text mentions a matched discipline (case-insensitive)
 *   2. the facility free-text description (FacilityRow.evidence)
 *   3. nothing — return undefined so the card renders no quote rather than invent one.
 * The returned text is the exact source words (only length-clipped with an
 * ellipsis), never a paraphrase.
 */
export function pickEvidenceQuote(
  f: ApiFacilityRow,
  matched: string[],
): EvidenceQuotePick | undefined {
  const claims = f.claims ?? [];
  const lowerMatched = matched.map((m) => m.toLowerCase());
  const claimHit = claims.find((c) => {
    const tx = (c.text ?? '').toLowerCase();
    return !!tx && lowerMatched.some((m) => tx.includes(m));
  });
  if (claimHit && claimHit.text.trim()) {
    return { text: clipVerbatim(claimHit.text), source: 'Claimed capability (FDR)' };
  }
  const ev = (f.evidence ?? '').trim();
  if (ev) {
    return { text: clipVerbatim(ev), source: 'Facility free-text description (FDR field: description)' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Record completeness — the patient-facing "data points have information" score
// ---------------------------------------------------------------------------

/**
 * Share of a facility's tracked data fields that actually carry information,
 * scaled to 0–100. This is the honest, non-alarming signal patients see on a
 * result card ("{n} out of 100 data points have information") in place of the
 * trust badge: unlike the fairly uniform `conf` record-confidence, it reflects
 * how filled-in the underlying FDR record really is (sparse beds/year/equipment
 * pull it down). Counts a fixed list of 14 "data points" — the fields a patient
 * would care about — so the denominator is stable across records.
 */
export function completenessOf(f: ApiFacilityRow): number {
  const has = (v: unknown): boolean =>
    Array.isArray(v) ? v.length > 0 : v != null && v !== '';
  const points: boolean[] = [
    has(f.name),
    has(f.type),
    has(f.city),
    has(f.state),
    f.lat != null && f.lng != null, // coordinates
    has(f.pincode),
    has(f.district),
    has(f.specialties),
    has(f.capability),
    has(f.procedure),
    has(f.equipment),
    has(f.description),
    f.beds != null, // capacity
    f.year != null, // year established
  ];
  const filled = points.filter(Boolean).length;
  return Math.round((100 * filled) / points.length);
}

// ---------------------------------------------------------------------------
// API row → component-card row adapter
// ---------------------------------------------------------------------------

/**
 * The shared FacilityCard / TrustBadge components take the stricter
 * `components/asclepius` FacilityRow shape (trust: TrustState, non-null
 * identity fields). The Lakebase api row is looser (nullable). This narrows it.
 */
export function toCardRow(f: ApiFacilityRow): CardFacilityRow {
  return {
    id: f.id,
    name: f.name,
    type: f.type ?? '',
    city: f.city ?? '',
    state: f.state ?? '',
    lat: f.lat ?? undefined,
    lng: f.lng ?? undefined,
    specialties: f.specialties ?? [],
    needs: f.needs ?? undefined,
    trust: normalizeTrust(f.trust),
    conf: f.conf ?? undefined,
    beds: f.beds ?? undefined,
    year: f.year ?? undefined,
    evidence: f.evidence ?? undefined,
    pincode: f.pincode ?? undefined,
    district: f.district ?? undefined,
    coord_source: f.coord_source ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Shared flow state over URL search params
// ---------------------------------------------------------------------------

export interface PatientFlowState {
  origin: string;
  radius: number;
  /** selected NEEDS keys. */
  needs: string[];
  urgency: string;
  /** specialties derived from the selected needs (for useSearchFacilities). */
  needSpecs: string[];
  /** human labels for the selected needs (for the results subheading). */
  needLabels: string[];
  /**
   * The origin's app_read.facilities `state` spelling, for scoping the search.
   * `undefined` when the origin has no ORIGIN_STATE mapping — callers should
   * then omit `state` (fall back to an unscoped, nationwide search) so an
   * unmapped city never returns zero facilities.
   */
  originState: string | undefined;
}

function clampRadius(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RADIUS;
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, n));
}

/**
 * Read + write the patient flow selection in the URL (`?origin=&radius=&needs=&urgency=`).
 * Returns the parsed state plus setters that preserve the other params, so
 * Location → Needs → Results carry the selection forward automatically.
 */
export function usePatientFlow() {
  const [params, setParams] = useSearchParams();

  const origin = params.get('origin') || DEFAULT_ORIGIN;
  const radius = clampRadius(parseInt(params.get('radius') || '', 10) || DEFAULT_RADIUS);
  const urgency = params.get('urgency') || DEFAULT_URGENCY;
  const needs = useMemo(() => {
    const raw = params.get('needs');
    if (!raw) return [] as string[];
    const valid = new Set(NEEDS.map((n) => n.key));
    return raw.split(',').filter((k) => valid.has(k));
  }, [params]);

  const needSpecs = useMemo(
    () => needs.map((k) => NEEDS.find((n) => n.key === k)?.spec).filter((s): s is string => !!s),
    [needs],
  );
  const needLabels = useMemo(
    () => needs.map((k) => NEEDS.find((n) => n.key === k)?.label).filter((s): s is string => !!s),
    [needs],
  );

  const patch = useCallback(
    (next: Partial<{ origin: string; radius: number; needs: string[]; urgency: string }>) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next.origin !== undefined) p.set('origin', next.origin);
          if (next.radius !== undefined) p.set('radius', String(clampRadius(next.radius)));
          if (next.urgency !== undefined) p.set('urgency', next.urgency);
          if (next.needs !== undefined) {
            if (next.needs.length) p.set('needs', next.needs.join(','));
            else p.delete('needs');
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setOrigin = useCallback((o: string) => patch({ origin: o }), [patch]);
  const setRadius = useCallback((r: number) => patch({ radius: r }), [patch]);
  const setUrgency = useCallback((u: string) => patch({ urgency: u }), [patch]);
  const toggleNeed = useCallback(
    (key: string) => {
      const set = new Set(needs);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      patch({ needs: [...set] });
    },
    [needs, patch],
  );

  const originState = ORIGIN_STATE[origin];
  const state: PatientFlowState = { origin, radius, needs, urgency, needSpecs, needLabels, originState };
  return { ...state, setOrigin, setRadius, setUrgency, toggleNeed, patch };
}

/** Build a `?origin=&radius=&needs=&urgency=` query string for cross-screen links. */
export function flowQuery(s: Pick<PatientFlowState, 'origin' | 'radius' | 'needs' | 'urgency'>): string {
  const p = new URLSearchParams();
  p.set('origin', s.origin);
  p.set('radius', String(s.radius));
  if (s.needs.length) p.set('needs', s.needs.join(','));
  p.set('urgency', s.urgency);
  return `?${p.toString()}`;
}
