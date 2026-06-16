// Shared helpers for the Registry / Saved / Compare screens.
//
// The data layer (lib/api.ts) returns a permissive FacilityRow (trust: string |
// null, nullable type/city/state, claims:{text,status}[]). The presentational
// components (components/asclepius) take a stricter FacilityRow (trust:
// TrustState, claims:{text,status:ClaimStatus}[]). These helpers bridge the two
// and reproduce the prototype's `dqOf()` data-quality scorer + `trustMeta`
// labels so the registry's quality dashboard and review queue match the design.

import type { FacilityRow as ApiFacilityRow } from '@/lib/api';
import type {
  FacilityRow as CardFacilityRow,
  Claim as CardClaim,
} from '@/components/asclepius';
import type { TrustState, ClaimStatus } from '@/components/asclepius/theme';

/** Coerce the free-text `trust` column to one of the three UI tiers. */
export function normalizeTrust(t: string | null | undefined): TrustState {
  if (t === 'verified' || t === 'review' || t === 'unverified') return t;
  return 'unverified';
}

/** Coerce a claim status string to a ClaimStatus the ClaimRow understands. */
export function normalizeClaimStatus(s: string | null | undefined): ClaimStatus {
  if (s === 'verified') return 'verified';
  if (s === 'claimed' || s === 'review') return 'claimed';
  return 'no-evidence';
}

/**
 * Adapt a data-layer facility row to the shape the shared presentational
 * components expect. Fills the few non-null fields they require with sensible
 * fallbacks (the prototype's normFac did the same).
 */
export function toCardFacility(f: ApiFacilityRow): CardFacilityRow {
  const claims: CardClaim[] = (f.claims ?? []).map((c) => ({
    text: c.text,
    status: normalizeClaimStatus(c.status),
  }));
  return {
    id: f.id,
    name: f.name,
    type: f.type ?? 'Facility',
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
    capability: f.capability ?? undefined,
    procedure: f.procedure ?? undefined,
    equipment: f.equipment ?? undefined,
    description: f.description ?? undefined,
    evidence: f.evidence ?? undefined,
    claims,
    pincode: f.pincode ?? undefined,
    district: f.district ?? undefined,
    data_quality_flag: f.data_quality_flag,
    possible_entity_dup: f.possible_entity_dup ? 'true' : null,
    id_valid: f.id_valid ?? undefined,
    coord_source: f.coord_source ?? undefined,
  };
}

export interface DqIssue {
  t: string;
  /** The override field a fix would target ('beds' | 'year'), when applicable. */
  fix?: 'beds' | 'year';
}

export interface DqResult {
  score: number;
  issues: DqIssue[];
}

/**
 * Data-quality scorer — a faithful port of the prototype's `dqOf(f)`.
 * Starts at 100 and subtracts weighted penalties for missing/unverified fields,
 * possible duplicates, and unverified claims. The local-state `confirmed` flag
 * (from the reviews table) adds a bonus and clears the "unverified" penalty.
 */
export function dqOf(f: ApiFacilityRow, confirmed = false): DqResult {
  const issues: DqIssue[] = [];
  let score = 100;

  if (f.beds == null) issues.push({ t: 'Bed capacity missing', fix: 'beds' });
  if (f.year == null) issues.push({ t: 'Year established missing', fix: 'year' });
  if (!f.equipment) issues.push({ t: 'Equipment not parsed from text' });
  if (!f.procedure) issues.push({ t: 'Procedure list missing' });
  if (normalizeTrust(f.trust) !== 'verified' && !confirmed)
    issues.push({ t: 'Capabilities unverified' });
  if (f.possible_entity_dup) issues.push({ t: 'Possible duplicate record' });

  const unverifiedClaims = (f.claims ?? []).filter(
    (c) => normalizeClaimStatus(c.status) === 'no-evidence',
  ).length;
  if (unverifiedClaims > 0)
    issues.push({
      t: `${unverifiedClaims} claim${unverifiedClaims === 1 ? '' : 's'} with no evidence`,
    });

  const weights: Record<string, number> = {
    'Bed capacity missing': 16,
    'Year established missing': 11,
    'Equipment not parsed from text': 13,
    'Procedure list missing': 9,
    'Capabilities unverified': 18,
    'Possible duplicate record': 22,
  };
  for (const i of issues) {
    score -= weights[i.t] ?? 7;
  }
  if (confirmed) score += 12;

  return { score: Math.max(0, Math.min(100, score)), issues };
}

/** dq → tier color (mirror of the prototype's inline thresholds). */
export const dqColor = (score: number): string =>
  score >= 75 ? '#2E7D67' : score >= 50 ? '#9A6A12' : '#B2503C';

/** field-coverage bar color. */
export const coverageColor = (pct: number): string =>
  pct >= 75 ? '#2E7D67' : pct >= 45 ? '#9A6A12' : '#B2503C';
