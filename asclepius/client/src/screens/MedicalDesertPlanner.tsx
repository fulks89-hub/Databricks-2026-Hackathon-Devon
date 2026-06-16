import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  BookmarkSimple,
  Buildings,
  CaretDown,
  CaretRight,
  Compass,
  Crosshair,
  FloppyDisk,
  Info,
  LinkSimple,
  MapPin,
  Path,
  Prohibit,
  Ruler,
  ShieldCheck,
  Stack,
  UsersThree,
  WarningDiamond,
  WarningOctagon,
} from '@phosphor-icons/react';
import {
  useMedicalDeserts,
  useDesertCapabilities,
  useDesertSpecialties,
  usePlannerPriorities,
  savePlannerPriority,
  removePlannerPriority,
  type DesertSort,
  type MedicalScarcityRow,
  type CapabilityDesertRow,
  type SpecialtyDesertRow,
} from '@/lib/api';
import { EvidenceQuote } from '@/components/asclepius/EvidenceQuote';
import { ConfidenceChip } from '@/components/asclepius/ConfidenceChip';
import { fonts, neutral, semantic, role as roleTheme, type ConfidenceLevel } from '@/components/asclepius/theme';
import { usePlanner } from '@/lib/persona';

/* ============================================================================
   Medical Desert Planner (/planner) — the rigorous, distance-based desert
   layer (medical_desert.*), the app's PRIMARY desert view. It supersedes the
   join-gap-biased gold_district_supply_need.desert_score: instead of "how many
   facilities did we manage to map here" it measures "how far is the nearest
   provider of each needed service, per person."

   Two orthogonal lenses via a segmented toggle (genuinely different rankings —
   no district is top-20 on both):
     · Deploy priority (burden)  — burden_rank, severity × population. Where the
       MOST PEOPLE are affected (populous, moderately-scarce districts).
     · Most isolated (scarcity)  — scarcity_rank, medical_scarcity 0–1. How bad
       access is for ONE PERSON (remote, low-population, badly cut off).

   Three-level drill: district → capability gaps (area_capability_desert) →
   services (area_specialty_desert) with nearest_km to the closest CLAIMING
   provider + care_tier + a coverage_confidence chip.

   Honesty surfaced persistently: claims are NOT credential-verified (Trust Desk
   validates separately); severity is per-capita, burden is the population
   overlay; distances are straight-line (circuity-corrected), not road km.
   ============================================================================ */

const SCARCITY = semantic.danger; // per-capita isolation = danger red
const BURDEN = roleTheme.hospital.base; // deploy priority = hospital blue

// Tier → chip palette. medical_desert tiers: low/moderate/high/extreme.
const TIER_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
  low: { fg: semantic.success, bg: semantic.successBg, label: 'Low' },
  moderate: { fg: semantic.warn, bg: semantic.warnBg, label: 'Moderate' },
  high: { fg: semantic.danger, bg: semantic.dangerBg, label: 'High' },
  extreme: { fg: '#7A1F12', bg: '#F3D9D2', label: 'Extreme' },
};
function tierStyle(tier: string | null | undefined): { fg: string; bg: string; label: string } {
  return TIER_STYLE[(tier ?? '').toLowerCase()] ?? TIER_STYLE.moderate;
}

// coverage_confidence → chip palette (high|medium in the ≥medium Lakebase slice).
const CONF_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
  high: { fg: semantic.success, bg: semantic.successBg, label: 'High confidence' },
  medium: { fg: semantic.warn, bg: semantic.warnBg, label: 'Medium confidence' },
};
function confStyle(c: string | null | undefined): { fg: string; bg: string; label: string } {
  return CONF_STYLE[(c ?? '').toLowerCase()] ?? CONF_STYLE.medium;
}

/** True when readiness flags the district as data-poor / unknown-supply (0 mapped
 *  facilities — a data gap, NOT proven absence). Drives the amber district badge. */
function isUnknownSupply(d: { coverage_flag: string | null; supply_label: string | null }): boolean {
  return d.coverage_flag === 'insufficient_supply_data' || d.supply_label === 'unknown_supply';
}

// care_tier → short label + tint for the specialty rows.
const TIER_TAG: Record<string, { label: string; fg: string; bg: string }> = {
  primary: { label: 'Primary', fg: semantic.success, bg: semantic.successBg },
  secondary: { label: 'Secondary', fg: semantic.info, bg: semantic.infoBg },
  tertiary: { label: 'Tertiary', fg: '#6A3FA0', bg: '#ECE3F6' },
};
function careTierTag(t: string | null | undefined): { label: string; fg: string; bg: string } {
  return TIER_TAG[(t ?? '').toLowerCase()] ?? { label: t ?? '—', fg: neutral.textMuted, bg: neutral.bgSunken };
}

const fmtPop = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};
const fmtKm = (km: number): string =>
  Number.isFinite(km) ? `${km >= 100 ? Math.round(km).toString() : km.toFixed(1)} km` : '—';

/* ---- evidence / citation helpers ------------------------------------------ */

const trimOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
};

/** The claim text shown in the cited quote — prefer the free-text capability,
 *  then the controlled specialty list, then procedure/equipment. Returns the
 *  chosen text plus which field it came from (for the source attribution). */
function pickClaimText(s: SpecialtyDesertRow): { text: string; field: string } | null {
  const cap = trimOrNull(s.claim_capability);
  if (cap) return { text: cap, field: 'claimed capability' };
  const spec = trimOrNull(s.claim_specialties);
  if (spec) return { text: spec, field: 'claimed specialties' };
  const proc = trimOrNull(s.claim_procedure);
  if (proc) return { text: proc, field: 'claimed procedures' };
  const equip = trimOrNull(s.claim_equipment);
  if (equip) return { text: equip, field: 'claimed equipment' };
  return null;
}

/**
 * Whether the free-text claim is THIN relative to the specialty this provider
 * is cited for. Surfaced (not hidden) as a low-confidence signal: the row is
 * the nearest CLAIMING facility, but if its own capability text is empty, very
 * short, or never mentions the specialty's word stem, treat the match as
 * unverified rather than confident. Judges reward communicating this gap.
 */
function isClaimThin(s: SpecialtyDesertRow): boolean {
  const cap = trimOrNull(s.claim_capability);
  // Empty free-text capability → thin (the controlled list alone is weak signal).
  if (!cap) return true;
  // Very short blurbs carry little evidence.
  if (cap.length < 12) return true;
  // Off-topic: the capability text never references the specialty's lead word.
  const stem = (s.specialty.match(/[a-z]+/i)?.[0] ?? '').toLowerCase();
  if (stem.length >= 4 && !cap.toLowerCase().includes(stem)) {
    // Allow a match against the controlled specialties list too before flagging.
    const spec = (s.claim_specialties ?? '').toLowerCase();
    if (!spec.includes(s.specialty.toLowerCase())) return true;
  }
  return false;
}

/** coverage_confidence → ConfidenceChip level (the slice is high|medium only). */
function coverageLevel(c: string | null | undefined): ConfidenceLevel {
  return (c ?? '').toLowerCase() === 'high' ? 'high' : 'medium';
}

/* ---- small chip ----------------------------------------------------------- */
function Chip({ fg, bg, children }: { fg: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{ color: fg, background: bg, fontFamily: fonts.body, fontWeight: 600, fontSize: 11.5 }}
    >
      {children}
    </span>
  );
}

export function MedicalDesertPlanner() {
  const [sort, setSort] = useState<DesertSort>('burden');
  const [selected, setSelected] = useState<MedicalScarcityRow | null>(null);
  const [capability, setCapability] = useState<string | null>(null);

  const districts = useMedicalDeserts({ sort, limit: 706 });
  // The capability drill is keyed on district_id (homonym-safe — never bare name).
  const capabilities = useDesertCapabilities(selected?.district_id);
  // Specialty drill is scoped to the selected capability (undefined = all).
  const specialties = useDesertSpecialties(selected?.district_id, capability ?? undefined);
  // Saved deploy-priority districts (owner-scoped) — reloaded on mount so saves persist.
  const priorities = usePlannerPriorities();

  const byScarcity = sort === 'scarcity';
  const accent = byScarcity ? SCARCITY : BURDEN;
  // Readiness Desk is planner-only; show its entry here for the planner persona.
  const planner = usePlanner();

  // The ranked list is already sorted by the server; keep that order.
  const rows = useMemo(() => districts.data ?? [], [districts.data]);

  // O(1) lookups for "is this district saved" + the saved note text (by district_id).
  const savedIds = useMemo(
    () => new Set((priorities.data ?? []).map((p) => p.district_id)),
    [priorities.data],
  );
  const savedNotes = useMemo(
    () => new Map((priorities.data ?? []).map((p) => [p.district_id, p.note ?? ''] as const)),
    [priorities.data],
  );

  const onPickDistrict = (d: MedicalScarcityRow) => {
    setSelected(d);
    setCapability(null);
  };

  // Save / un-save a district as a deploy priority + persist a one-line note.
  // POST always upserts (save + edit note); DELETE un-saves. refetch() after each.
  const onSavePriority = async (d: MedicalScarcityRow, note: string): Promise<void> => {
    await savePlannerPriority({
      district_id: d.district_id,
      district: d.district,
      state: d.state,
      lens: byScarcity ? 'scarcity' : 'burden',
      note,
    });
    priorities.refetch();
  };
  const onUnsavePriority = async (d: MedicalScarcityRow): Promise<void> => {
    await removePlannerPriority(d.district_id);
    priorities.refetch();
  };

  return (
    <div
      className="mx-auto w-full max-w-[1240px] px-[30px] pb-[70px] pt-6"
      style={{ animation: 'ascFade .45s ease both' }}
    >
      <Button asChild variant="ghost" className="mb-1 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/">
          <ArrowLeft weight="bold" size={15} />
          Back to home
        </Link>
      </Button>

      {/* ---- header + lens toggle ------------------------------------------ */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            style={{
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: '-.025em',
              color: neutral.ink,
              margin: 0,
            }}
          >
            Medical Desert Planner
          </h2>
          <p
            style={{
              fontSize: 16,
              color: neutral.textSoft,
              margin: '8px 0 0',
              maxWidth: '52em',
              textWrap: 'pretty',
            }}
          >
            {byScarcity
              ? 'Districts ranked by how bad access is for one person — distance to the nearest provider of each needed service, per capita. Remote, low-population, badly cut off.'
              : 'Districts ranked by where the most people are affected — per-capita severity multiplied by population. Populous districts with real access gaps rise to the top.'}
          </p>
        </div>
      </div>

      {/* readiness entry (planners only) + segmented lens toggle */}
      <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
        {planner && (
          <Link
            to="/readiness"
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2.5"
            style={{
              fontFamily: fonts.body,
              fontWeight: 700,
              fontSize: 13,
              background: '#fff',
              color: BURDEN,
              border: `1px solid ${roleTheme.hospital.border}`,
              textDecoration: 'none',
            }}
          >
            <ShieldCheck weight="fill" size={15} />
            Data Readiness
          </Link>
        )}
        <div className="flex max-w-[520px] flex-1 gap-1 rounded-[12px] p-1" style={{ background: '#F1EBE1' }}>
          {(
            [
              { key: 'burden' as const, label: 'Deploy priority (burden)', Icon: UsersThree, color: BURDEN },
              { key: 'scarcity' as const, label: 'Most isolated (per-capita)', Icon: Crosshair, color: SCARCITY },
            ]
          ).map(({ key, label, Icon, color }) => {
            const active = sort === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-2"
                style={{
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  fontSize: 13,
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
      </div>
      <p className="mt-2 px-1" style={{ fontFamily: fonts.body, fontSize: 12.5, color: neutral.textFaint }}>
        {byScarcity
          ? 'Scarcity = how bad access is for an individual (population-independent).'
          : 'Burden = where the most people are affected (severity × population).'}{' '}
        The two lenses are genuinely orthogonal — no district leads both.
      </p>

      {/* ---- two-pane: ranked list + detail -------------------------------- */}
      <div className="mt-[22px] grid grid-cols-1 items-start gap-[26px] lg:grid-cols-[.92fr_1.08fr]">
        {/* ============================================================ LIST */}
        <div
          className="rounded-[22px] p-[18px]"
          style={{
            background: '#fff',
            border: `1px solid ${neutral.borderCard}`,
            boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 44px -32px rgba(43,39,34,.3)',
          }}
        >
          <div
            className="mb-3 flex items-center gap-2 px-1"
            style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: neutral.ink }}
          >
            <Stack weight="fill" size={16} style={{ color: accent }} />
            {byScarcity ? 'Most isolated districts' : 'Deploy-priority districts'}
            <span style={{ fontWeight: 600, fontSize: 12, color: neutral.textFaint2 }}>
              {rows.length > 0 ? `· ${String(rows.length)} of 706` : ''}
            </span>
          </div>

          {districts.error ? (
            <div
              className="flex h-[360px] flex-col items-center justify-center gap-2.5 text-center"
              style={{ color: SCARCITY }}
            >
              <WarningDiamond weight="fill" size={32} />
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5 }}>
                Couldn’t load the desert ranking
              </span>
              <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: neutral.textFaint2 }}>
                {districts.error}
              </span>
            </div>
          ) : districts.loading ? (
            <div className="flex flex-col gap-2">
              {['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((sk) => (
                <Skeleton key={sk} className="h-[58px] rounded-[12px]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div
              className="flex h-[360px] items-center justify-center"
              style={{ fontFamily: fonts.body, fontSize: 13.5, color: neutral.textFaint2 }}
            >
              No districts to show.
            </div>
          ) : (
            <div className="flex max-h-[640px] flex-col gap-1.5 overflow-y-auto pr-0.5">
              {rows.map((d) => {
                const active = selected?.district_id === d.district_id;
                const rank = byScarcity ? d.scarcity_rank : d.burden_rank;
                const ts = tierStyle(d.scarcity_tier);
                return (
                  <button
                    key={d.district_id}
                    type="button"
                    onClick={() => onPickDistrict(d)}
                    className="flex items-center gap-3 rounded-[13px] px-3 py-2.5 text-left transition-colors"
                    style={{
                      border: `1px solid ${active ? accent : neutral.border}`,
                      background: active ? `${accent}10` : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                      style={{
                        background: active ? accent : neutral.bgSunken,
                        color: active ? '#fff' : neutral.textMuted,
                        fontFamily: fonts.display,
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {rank}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="flex items-center gap-1.5 truncate"
                        style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.ink }}
                      >
                        {savedIds.has(d.district_id) && (
                          <BookmarkSimple
                            weight="fill"
                            size={13}
                            style={{ color: BURDEN, flexShrink: 0 }}
                            aria-label="Saved deploy priority"
                          />
                        )}
                        <span className="truncate">{d.district}</span>
                        {isUnknownSupply(d) && (
                          <span
                            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                            style={{ background: semantic.warn }}
                            title="Unknown supply — data-poor (0 mapped facilities)"
                          />
                        )}
                      </span>
                      <span
                        className="block truncate"
                        style={{ fontFamily: fonts.body, fontSize: 12, color: neutral.textFaint2 }}
                      >
                        {d.state} · {fmtPop(d.population_2011)} people
                      </span>
                    </span>
                    {/* the metric the active lens ranks by */}
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Chip fg={ts.fg} bg={ts.bg}>
                        {byScarcity ? d.medical_scarcity.toFixed(2) : `${ts.label}`}
                      </Chip>
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 11, color: SCARCITY }}
                        title="Care families (of 32) with no nearby access"
                      >
                        <WarningOctagon weight="fill" size={12} />
                        {d.n_capability_deserts}/{d.n_capabilities_scored}
                      </span>
                    </span>
                    <CaretRight weight="bold" size={14} style={{ color: neutral.textDisabled, flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ========================================================== DETAIL */}
        <div className="flex flex-col gap-[18px]">
          {selected == null ? (
            <div
              className="flex h-[360px] flex-col items-center justify-center gap-3 rounded-[22px] text-center"
              style={{ background: '#fff', border: `1px dashed ${neutral.borderDashed}` }}
            >
              <Compass size={40} style={{ color: neutral.textDisabled }} />
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 15, color: neutral.textMuted }}>
                Pick a district to see its care-family gaps
              </span>
              <span
                style={{ fontFamily: fonts.body, fontSize: 13, color: neutral.textFaint2, maxWidth: '26em' }}
              >
                Drill from district → capability → individual services, each with the straight-line distance to the
                nearest claiming provider.
              </span>
            </div>
          ) : (
            <DistrictDetail
              district={selected}
              capabilities={capabilities.data ?? []}
              capLoading={capabilities.loading}
              capError={capabilities.error}
              specialties={specialties.data ?? []}
              specLoading={specialties.loading}
              specError={specialties.error}
              activeCapability={capability}
              onPickCapability={setCapability}
              accent={accent}
              isSaved={savedIds.has(selected.district_id)}
              savedNote={savedNotes.get(selected.district_id) ?? ''}
              onSavePriority={onSavePriority}
              onUnsavePriority={onUnsavePriority}
            />
          )}
        </div>
      </div>

      {/* ---- persistent uncertainty / honesty note ------------------------- */}
      <div
        className="mt-5 flex items-start gap-2.5 rounded-[14px] px-4 py-3.5"
        style={{ background: '#FCF8F2', border: `1px solid ${neutral.borderCard}` }}
      >
        <Info weight="fill" size={17} style={{ color: neutral.textFaint2, marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: 0, lineHeight: 1.55, textWrap: 'pretty' }}>
          <strong style={{ color: neutral.text }}>How to read this.</strong> Severity is{' '}
          <strong style={{ color: neutral.text }}>per-capita</strong> (population-independent); deploy priority adds
          population as a separate <strong style={{ color: neutral.text }}>burden</strong> overlay (severity ×
          population). Distances are <strong style={{ color: neutral.text }}>straight-line, circuity-corrected</strong>{' '}
          to the nearest facility that <strong style={{ color: neutral.text }}>claims</strong> the service — claims are{' '}
          <strong style={{ color: neutral.text }}>not credential-verified</strong> (the Trust Desk validates
          separately). Distance bands are grounded in IPHS catchment norms and the Lancet 2-hour surgical-access
          standard; <strong style={{ color: neutral.text }}>coverage confidence</strong> flags how reliable the distance
          signal is per service. Each district is scored on{' '}
          <strong style={{ color: neutral.text }}>32 of 35</strong> care families — 3 (Medical Genetics, Sexual Health
          &amp; HIV, AYUSH) have too few claiming facilities to score and are a tagging gap, not proven absence.
        </p>
      </div>

      <p className="mt-3 flex items-center gap-1.5 px-1" style={{ fontSize: 12, color: neutral.textDisabled }}>
        <Path size={13} />
        medical_desert layer · 706 districts · per-capita distance-based scarcity, superseding the join-gap-biased
        supply-need score.
      </p>
    </div>
  );
}

/* ===========================================================================
   District detail — headline badge + capability gaps → specialty drill.
   =========================================================================== */
function DistrictDetail({
  district,
  capabilities,
  capLoading,
  capError,
  specialties,
  specLoading,
  specError,
  activeCapability,
  onPickCapability,
  accent,
  isSaved,
  savedNote,
  onSavePriority,
  onUnsavePriority,
}: {
  district: MedicalScarcityRow;
  capabilities: CapabilityDesertRow[];
  capLoading: boolean;
  capError: string | undefined;
  specialties: SpecialtyDesertRow[];
  specLoading: boolean;
  specError: string | undefined;
  activeCapability: string | null;
  onPickCapability: (c: string | null) => void;
  accent: string;
  isSaved: boolean;
  savedNote: string;
  onSavePriority: (d: MedicalScarcityRow, note: string) => Promise<void>;
  onUnsavePriority: (d: MedicalScarcityRow) => Promise<void>;
}) {
  const ts = tierStyle(district.scarcity_tier);
  const worst = [
    district.worst_capability,
    district.second_worst_capability,
    district.third_worst_capability,
  ].filter((w): w is string => typeof w === 'string' && w.length > 0);

  return (
    <>
      {/* headline card */}
      <div
        className="rounded-[22px] p-[20px]"
        style={{
          background: '#fff',
          border: `1px solid ${neutral.borderCard}`,
          boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 44px -32px rgba(43,39,34,.3)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span
              className="inline-flex items-center gap-1.5"
              style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12.5, color: neutral.textFaint2 }}
            >
              <MapPin weight="fill" size={13} style={{ color: accent }} />
              {district.state}
            </span>
            <h3
              style={{
                fontFamily: fonts.display,
                fontWeight: 700,
                fontSize: 24,
                letterSpacing: '-.02em',
                color: neutral.ink,
                margin: '3px 0 0',
              }}
            >
              {district.district}
            </h3>
            {isUnknownSupply(district) && (
              <span className="mt-2 inline-flex">
                <Chip fg={semantic.warn} bg={semantic.warnBg}>
                  <WarningDiamond weight="fill" size={11} />
                  <span title="0 facilities mapped to this district — a data gap, not proven absence. The naive supply map mistakes these for deserts.">
                    Unknown supply — data-poor
                  </span>
                </Chip>
              </span>
            )}
          </div>
          {/* the X of 32 badge — the track's headline metric */}
          <div
            className="flex shrink-0 items-center gap-2.5 rounded-[14px] px-3.5 py-2.5"
            style={{ background: semantic.dangerBg, border: `1px solid ${SCARCITY}33` }}
          >
            <WarningOctagon weight="fill" size={22} style={{ color: SCARCITY }} />
            <span>
              <span
                style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, color: SCARCITY, display: 'block' }}
              >
                {district.n_capability_deserts} of {district.n_capabilities_scored}
              </span>
              <span style={{ fontFamily: fonts.body, fontSize: 11.5, color: neutral.textMuted }}>
                care families with no nearby access
              </span>
            </span>
          </div>
        </div>

        {/* quick stats */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Deploy rank" value={`#${String(district.burden_rank)}`} sub="of 706 (burden)" Icon={UsersThree} />
          <Stat
            label="Isolation rank"
            value={`#${String(district.scarcity_rank)}`}
            sub="of 706 (per-capita)"
            Icon={Crosshair}
          />
          <Stat
            label="Scarcity"
            value={district.medical_scarcity.toFixed(3)}
            sub={ts.label.toLowerCase()}
            valueColor={ts.fg}
            Icon={WarningDiamond}
          />
          <Stat label="Population" value={fmtPop(district.population_2011)} sub="2011 census" Icon={UsersThree} />
        </div>

        {worst.length > 0 && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 11.5, color: neutral.textFaint2 }}>
              Worst care families:
            </span>
            {worst.map((w) => (
              <Chip key={w} fg={neutral.textMuted} bg={neutral.bgSunken}>
                {w}
              </Chip>
            ))}
          </div>
        )}

        {/* save this district as a deploy priority + a one-line note (persists).
            Keyed on the saved record so it remounts (re-seeding its local mirror)
            when the district changes OR usePlannerPriorities resolves on mount. */}
        <SavePriority
          key={`${district.district_id}::${String(isSaved)}::${savedNote}`}
          district={district}
          isSaved={isSaved}
          savedNote={savedNote}
          onSave={onSavePriority}
          onUnsave={onUnsavePriority}
        />
      </div>

      {/* capability gaps */}
      <div
        className="rounded-[22px] p-[18px]"
        style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}
      >
        <div
          className="mb-3 flex items-center justify-between gap-2 px-1"
          style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: neutral.ink }}
        >
          <span className="inline-flex items-center gap-2">
            <Stack weight="fill" size={16} style={{ color: accent }} />
            Care-family gaps
          </span>
          {activeCapability != null && (
            <button
              type="button"
              onClick={() => onPickCapability(null)}
              className="inline-flex items-center gap-1"
              style={{
                fontFamily: fonts.body,
                fontWeight: 600,
                fontSize: 12,
                color: accent,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <ArrowLeft weight="bold" size={12} />
              All families
            </button>
          )}
        </div>

        {capError ? (
          <ErrorLine accent={SCARCITY} message={capError} />
        ) : capLoading ? (
          <div className="flex flex-col gap-1.5">
            {['c1', 'c2', 'c3', 'c4', 'c5'].map((sk) => (
              <Skeleton key={sk} className="h-[44px] rounded-[11px]" />
            ))}
          </div>
        ) : capabilities.length === 0 ? (
          <EmptyLine message="No scored care families for this district." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {capabilities.map((c) => {
              const cts = tierStyle(c.severity_tier);
              const active = activeCapability === c.capability;
              return (
                <button
                  key={`${c.district_id}::${c.capability}`}
                  type="button"
                  onClick={() => onPickCapability(active ? null : c.capability)}
                  className="flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition-colors"
                  style={{
                    border: `1px solid ${active ? accent : neutral.border}`,
                    background: active ? `${accent}10` : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate"
                      style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: neutral.ink }}
                    >
                      {c.capability}
                    </span>
                    <span
                      className="block truncate"
                      style={{ fontFamily: fonts.body, fontSize: 11.5, color: neutral.textFaint2 }}
                    >
                      {c.n_specialties_scored} of {c.n_specialties_total} services scored
                      {c.worst_specialty ? ` · worst: ${c.worst_specialty}` : ''}
                    </span>
                  </span>
                  <Chip fg={cts.fg} bg={cts.bg}>
                    {cts.label} · {c.capability_severity.toFixed(2)}
                  </Chip>
                  <CaretRight
                    weight="bold"
                    size={14}
                    style={{
                      color: active ? accent : neutral.textDisabled,
                      flexShrink: 0,
                      transform: active ? 'rotate(90deg)' : 'none',
                      transition: 'transform .15s ease',
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* specialty drill */}
      <div
        className="rounded-[22px] p-[18px]"
        style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}
      >
        <div
          className="mb-1 flex items-center gap-2 px-1"
          style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: neutral.ink }}
        >
          <Ruler weight="fill" size={16} style={{ color: accent }} />
          {activeCapability ? `${activeCapability} — services` : 'All services, by severity'}
        </div>
        <p className="mb-3 px-1" style={{ fontFamily: fonts.body, fontSize: 11.5, color: neutral.textFaint2 }}>
          Distance to the nearest facility that <strong>claims</strong> each service (not credential-verified). Open{' '}
          <strong>Evidence</strong> on any service to see that facility, its claimed text, and the facility-reported
          source.
        </p>

        {specError ? (
          <ErrorLine accent={SCARCITY} message={specError} />
        ) : specLoading ? (
          <div className="flex flex-col gap-1.5">
            {['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((sk) => (
              <Skeleton key={sk} className="h-[50px] rounded-[11px]" />
            ))}
          </div>
        ) : specialties.length === 0 ? (
          <EmptyLine message="No services to show for this selection." />
        ) : (
          <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-0.5">
            {specialties.map((s) => (
              <SpecialtyRow key={`${s.district_id}::${s.specialty}`} s={s} showCapability={!activeCapability} />
            ))}
          </div>
        )}
      </div>

      <Button asChild variant="outline" className="h-[40px] rounded-[12px] font-bold">
        <Link to="/atlas">
          See this on the map
          <ArrowRight weight="bold" size={15} />
        </Link>
      </Button>
    </>
  );
}

/* ===========================================================================
   Save-priority — mark this district as a deploy priority + attach a one-line
   note, owner-scoped and persisted server-side (app.planner_priorities). Mirrors
   FacilityDetail's Save/note UX: optimistic local mirror, await the write, then
   the parent refetch()es so the saved state is restored on return.
   =========================================================================== */
function SavePriority({
  district,
  isSaved,
  savedNote,
  onSave,
  onUnsave,
}: {
  district: MedicalScarcityRow;
  isSaved: boolean;
  savedNote: string;
  onSave: (d: MedicalScarcityRow, note: string) => Promise<void>;
  onUnsave: (d: MedicalScarcityRow) => Promise<void>;
}) {
  // Local mirrors so the save/note state stays responsive while the write is in
  // flight. The parent keys this component on the persisted record, so it remounts
  // (re-seeding these from props) when the district changes or the saved priorities
  // resolve on mount — no derived-state-during-render needed.
  const [saved, setSaved] = useState(isSaved);
  const [note, setNote] = useState(savedNote);
  const [pending, setPending] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const toggleSave = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    const next = !saved;
    setSaved(next); // optimistic
    try {
      if (next) {
        await onSave(district, note);
        setNoteSaved(true);
      } else {
        await onUnsave(district);
        setNoteSaved(false);
      }
    } catch {
      setSaved(!next); // revert
    } finally {
      setPending(false);
    }
  };

  // Persist note edits (only once the district is already a saved priority) on blur.
  const saveNote = async (): Promise<void> => {
    if (!saved || pending) return;
    setPending(true);
    try {
      await onSave(district, note);
      setNoteSaved(true);
    } catch {
      /* keep the optimistic note; the upsert is idempotent on retry */
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-4 border-t pt-3.5" style={{ borderColor: neutral.divider }}>
      <Button
        type="button"
        onClick={() => {
          void toggleSave();
        }}
        disabled={pending}
        className="w-full font-bold"
        style={
          saved
            ? {
                background: roleTheme.hospital.tint,
                color: roleTheme.hospital.press,
                border: `1px solid ${roleTheme.hospital.border}`,
                height: 44,
                fontSize: 14,
              }
            : {
                background: BURDEN,
                color: '#fff',
                border: 'none',
                height: 44,
                fontSize: 14,
              }
        }
      >
        <BookmarkSimple weight={saved ? 'fill' : 'bold'} size={17} />
        {saved ? 'Saved as a deploy priority' : 'Save as a deploy priority'}
      </Button>

      <div
        className="mt-2.5 flex items-center gap-1.5 px-1"
        style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: neutral.text }}
      >
        <BookmarkSimple weight="fill" size={13} style={{ color: BURDEN }} />
        Priority note
      </div>
      <Textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setNoteSaved(false);
        }}
        onBlur={() => {
          void saveNote();
        }}
        placeholder="e.g. Deploy a mobile cardiology unit Q3 — partner with the district hospital."
        className="mt-2 w-full"
        style={{ minHeight: 64, resize: 'vertical', borderColor: neutral.border, fontSize: 13.5, color: neutral.text }}
      />
      <div
        className="mt-1.5 flex items-center gap-1.5 px-1"
        style={{ fontFamily: fonts.body, fontSize: 11.5, color: neutral.textDisabled }}
      >
        <FloppyDisk size={13} />
        {saved
          ? noteSaved
            ? 'Priority & note saved to your account.'
            : 'Note saves to your account when you click away.'
          : 'Save this district to attach a priority note.'}
      </div>
    </div>
  );
}

/* ===========================================================================
   Specialty row — the metric line plus a collapsible Evidence / citation panel
   that clicks through to the nearest CLAIMING provider, its claimed text, and
   the facility-reported (untrusted) source. Each row owns its own open state so
   the drill stays a flat scroll list.
   =========================================================================== */
function SpecialtyRow({ s, showCapability }: { s: SpecialtyDesertRow; showCapability: boolean }) {
  const [open, setOpen] = useState(false);
  const cs = confStyle(s.coverage_confidence);
  const ct = careTierTag(s.care_tier);
  const sv = tierStyle(s.severity_tier);
  // Data-poor / thin-coverage signal at the SERVICE grain: very few facilities
  // claim this service nationwide, or distance is only medium-confidence. This is
  // the honest-coverage analogue of the district 'unknown supply' badge.
  const thinCoverage =
    !s.no_provider_nationwide &&
    (s.n_facilities_claiming <= 2 || (s.coverage_confidence ?? '').toLowerCase() === 'medium');

  return (
    <div
      className="rounded-[11px]"
      style={{ border: `1px solid ${open ? `${semantic.evidenceRule}55` : neutral.border}`, background: neutral.surfaceWarm }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: neutral.ink }}
          >
            {s.specialty}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip fg={ct.fg} bg={ct.bg}>
              {ct.label}
            </Chip>
            <Chip fg={cs.fg} bg={cs.bg}>
              {cs.label}
            </Chip>
            {thinCoverage && (
              <Chip fg={semantic.warn} bg={semantic.warnBg}>
                <WarningDiamond weight="fill" size={11} />
                {s.n_facilities_claiming <= 2 ? `Only ${s.n_facilities_claiming} claim this` : 'Thin coverage'}
              </Chip>
            )}
            {showCapability && (
              <span style={{ fontFamily: fonts.body, fontSize: 11, color: neutral.textFaint2 }}>{s.capability}</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className="inline-flex items-center gap-1"
            style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, color: sv.fg }}
            title="Straight-line distance to the nearest claiming provider"
          >
            <MapPin weight="fill" size={13} />
            {s.no_provider_nationwide ? 'none' : fmtKm(s.nearest_km)}
          </span>
          <span
            className="inline-flex items-center gap-1"
            style={{
              fontFamily: fonts.body,
              fontSize: 10.5,
              color: thinCoverage ? semantic.warn : neutral.textFaint2,
            }}
            title="Facilities nationwide that claim this service (claims, not credential-verified)"
          >
            sev {s.severity.toFixed(2)} · {s.n_facilities_claiming} claim
          </span>
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: 11,
            color: open ? semantic.evidenceRule : neutral.textFaint,
            background: open ? semantic.evidenceBg : neutral.bgSunken,
          }}
        >
          Evidence
          <CaretDown
            weight="bold"
            size={11}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }}
          />
        </span>
      </button>

      {open && <EvidencePanel s={s} />}
    </div>
  );
}

/* ---- the cited evidence panel for one specialty row ----------------------- */
function EvidencePanel({ s }: { s: SpecialtyDesertRow }) {
  // The 3 no-provider-nationwide services have no nearest facility to cite.
  if (s.no_provider_nationwide || !trimOrNull(s.nearest_facility_id) || !trimOrNull(s.facility_name)) {
    return (
      <div className="px-3 pb-3 pt-1">
        <div
          className="flex items-start gap-2 rounded-[11px] px-3 py-2.5"
          style={{ background: neutral.bgSunken, border: `1px solid ${neutral.border}` }}
        >
          <Prohibit weight="fill" size={16} style={{ color: neutral.textFaint, marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: neutral.textMuted, lineHeight: 1.5 }}>
            <strong>0 facilities</strong> claim <strong>{s.specialty}</strong> anywhere in the dataset — there is no
            nearest facility to cite. This is the worst possible access gap for the service.
          </span>
        </div>
      </div>
    );
  }

  const facility = s.facility_name ?? 'Unknown facility';
  const city = trimOrNull(s.evidence_city);
  const claim = pickClaimText(s);
  const url = trimOrNull(s.source_url);
  const thin = isClaimThin(s);

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3 pt-1">
      {/* nearest provider line */}
      <div className="flex items-start gap-2">
        <Buildings weight="fill" size={16} style={{ color: semantic.info, marginTop: 1, flexShrink: 0 }} />
        <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: neutral.textMuted, lineHeight: 1.5 }}>
          Nearest <strong style={{ color: neutral.text }}>{s.specialty}</strong> provider:{' '}
          <strong style={{ color: neutral.ink }}>{facility}</strong>
          {city ? `, ${city}` : ''}{' '}
          <span style={{ color: neutral.textFaint2 }}>({fmtKm(s.nearest_km)} away)</span>
        </span>
      </div>

      {/* gap-derivation line — WHY this service is a desert, from the closest of N
          nationwide claiming facilities + the distance to it. */}
      <div className="flex items-start gap-2">
        <MapPin weight="fill" size={16} style={{ color: neutral.textFaint2, marginTop: 1, flexShrink: 0 }} />
        <span style={{ fontFamily: fonts.body, fontSize: 12, color: neutral.textFaint2, lineHeight: 1.5 }}>
          Why it&rsquo;s a gap: the nearest of <strong style={{ color: neutral.textMuted }}>{s.n_facilities_claiming}</strong>{' '}
          {s.n_facilities_claiming === 1 ? 'facility' : 'facilities'} claiming {s.specialty} nationwide is{' '}
          {fmtKm(s.nearest_km)} away.
        </span>
      </div>

      {/* the cited claim text (or a clear "no claim text" note) */}
      {claim ? (
        <EvidenceQuote
          text={claim.text}
          sourceLabel={`Facility-reported ${claim.field} · not credential-verified`}
        />
      ) : (
        <div
          className="flex items-start gap-2 rounded-[11px] px-3 py-2.5"
          style={{ background: semantic.warnBg, border: `1px solid ${semantic.warn}33` }}
        >
          <WarningDiamond weight="fill" size={15} style={{ color: semantic.warn, marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontFamily: fonts.body, fontSize: 12, color: neutral.textMuted, lineHeight: 1.5 }}>
            This facility is the nearest match by its controlled specialty tag, but reports{' '}
            <strong>no descriptive claim text</strong> — treat the match as unverified.
          </span>
        </div>
      )}

      {/* uncertainty signals: coverage confidence + thin-claim flag */}
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip level={coverageLevel(s.coverage_confidence)} />
        {thin && claim && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: 11,
              color: semantic.warn,
              background: semantic.warnBg,
            }}
            title="The facility's free-text claim is short or doesn't clearly reference this specialty."
          >
            <WarningDiamond weight="fill" size={11} />
            Claim text is thin — treat as unverified
          </span>
        )}
      </div>

      {/* facility-reported source — UNTRUSTED. Render the URL as plain text plus a
          clearly-labeled external link (rel=noopener noreferrer, never auto-followed). */}
      <div
        className="flex items-start gap-2 rounded-[11px] px-3 py-2"
        style={{ background: neutral.surfaceWarm2, border: `1px solid ${neutral.border2}` }}
      >
        <LinkSimple weight="bold" size={15} style={{ color: neutral.textFaint, marginTop: 2, flexShrink: 0 }} />
        <span className="min-w-0" style={{ fontFamily: fonts.body, fontSize: 11.5, color: neutral.textFaint2, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: neutral.textFaint }}>Facility-reported source</span> (may be inaccurate
          or unreachable):{' '}
          {url ? (
            <>
              <span style={{ wordBreak: 'break-all', color: neutral.textMuted }}>{url}</span>
              <a
                href={normalizeUrl(url)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="ml-1.5 inline-flex items-center gap-0.5 align-middle"
                style={{ color: semantic.info, fontWeight: 600 }}
              >
                open
                <ArrowSquareOut weight="bold" size={11} />
              </a>
            </>
          ) : (
            <span style={{ color: neutral.textDisabled }}>none reported</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** Prefix a bare host (e.g. "cancerclinics.in") with https:// so the external
 *  link resolves. The link is rel=noopener noreferrer nofollow + target=_blank
 *  — opened only on an explicit user click, never auto-followed or trusted. */
function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/* ---- detail sub-bits ------------------------------------------------------ */
function Stat({
  label,
  value,
  sub,
  valueColor,
  Icon,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  Icon: typeof UsersThree;
}) {
  return (
    <div
      className="rounded-[12px] px-3 py-2.5"
      style={{ background: neutral.surfaceWarm, border: `1px solid ${neutral.border2}` }}
    >
      <span
        className="inline-flex items-center gap-1"
        style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 10.5, color: neutral.textFaint2, textTransform: 'uppercase', letterSpacing: '.05em' }}
      >
        <Icon weight="fill" size={11} />
        {label}
      </span>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, color: valueColor ?? neutral.ink, marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontFamily: fonts.body, fontSize: 11, color: neutral.textFaint2 }}>{sub}</div>
    </div>
  );
}

function ErrorLine({ accent, message }: { accent: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center" style={{ color: accent }}>
      <WarningDiamond weight="fill" size={26} />
      <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5 }}>Couldn’t load this</span>
      <span style={{ fontFamily: fonts.body, fontSize: 12, color: neutral.textFaint2 }}>{message}</span>
    </div>
  );
}

function EmptyLine({ message }: { message: string }) {
  return (
    <div
      className="py-8 text-center"
      style={{ fontFamily: fonts.body, fontSize: 13, color: neutral.textFaint2 }}
    >
      {message}
    </div>
  );
}

export default MedicalDesertPlanner;
