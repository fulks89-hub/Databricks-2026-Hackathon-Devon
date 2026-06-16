import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Megaphone,
  Target,
  CheckCircle,
  Buildings,
  Stethoscope,
  PaperPlaneTilt,
  Pulse,
  GitBranch,
  Fire,
  Clock,
  Circle,
  MinusCircle,
  UsersThree,
  Gauge,
  BookmarkSimple,
  ArrowRight,
  WarningCircle,
  Sparkle,
} from '@phosphor-icons/react';
import { Skeleton } from '@databricks/appkit-ui/react';
import {
  fonts,
  neutral,
  role,
  semantic,
  type TrustState,
} from '@/components/asclepius';
import {
  useSearchFacilities,
  usePostings,
  useDistrictDemand,
  useDeserts,
  useMe,
  applyToPosting,
  saveShortlist,
  type FacilityRow,
  type Posting,
} from '@/lib/api';
import type { ClinicianProfileState } from './ClinicianProfile';

/* ============================================================================
   Clinician · Opportunities  (/clinician/opportunities)

   Three modes (prototype cModeTabs): "Live openings" (hospital postings ranked
   by sub-specialty fit, Express interest → applications), "Inferred gaps"
   (facilities whose FDR record lists the specialty as a *need*, escalated by
   the district's modeled demand + care-desert rank), and "Offers it"
   (facilities already providing the specialty — for referral / peer support).

   The clinician's specialty/sub/years arrive as navigation state from
   /clinician/profile. With no specialty the screen shows the "choose a
   specialty" prompt (prototype cNoSpec).

   Source of truth: design-import/Asclepius.dc.html §"CLINICIAN: OPPORTUNITIES"
   (isCOpps, cPosted, cFacilityView) — copy/structure/ranking reproduced.
   ============================================================================ */

const ACCENT = role.clinician.base; // #2E7D67

type Mode = 'posted' | 'need' | 'has';

const MODE_TABS: { key: Mode; label: string; Icon: typeof Megaphone }[] = [
  { key: 'posted', label: 'Live openings', Icon: Megaphone },
  { key: 'need', label: 'Inferred gaps', Icon: Target },
  { key: 'has', label: 'Offers it', Icon: CheckCircle },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a (nullable) trust string to a TrustState for the avatar/colors. */
function trustState(t: string | null): TrustState {
  return t === 'verified' || t === 'review' || t === 'unverified' ? t : 'unverified';
}

// avatar() bg/fg by trust (mirror of FacilityAvatar's avatarStyle, but applied
// to the prototype's square 42px tile).
const AVATAR: Record<TrustState, { bg: string; fg: string }> = {
  verified: { bg: '#E4EFEA', fg: '#2E7D67' },
  review: { bg: '#F6EBD6', fg: '#9A6A12' },
  unverified: { bg: '#EEE9DF', fg: '#857B6C' },
};

const urgMeta = (u: string | null | undefined) =>
  u === 'high'
    ? { label: 'Urgent', fg: semantic.danger, bg: semantic.dangerBg, Icon: Fire }
    : u === 'medium'
      ? { label: 'Active', fg: semantic.warn, bg: semantic.warnBg, Icon: Clock }
      : { label: 'Open', fg: semantic.success, bg: semantic.successBg, Icon: Circle };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ClinicianOpportunities() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = (location.state ?? null) as ClinicianProfileState | null;

  const specialty = profile?.specialty ?? null;
  const sub = profile?.sub ?? null;
  const years = profile?.years ?? null;

  const [mode, setMode] = useState<Mode>('posted');
  // Optimistic local sets so the Apply / Save buttons flip immediately.
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Ranked live-openings count, reported up from LiveOpenings so the header
  // subcopy can render the dynamic "N open roles…" line (prototype cSubFinal).
  const [postedCount, setPostedCount] = useState(0);

  const noSpec = !specialty;

  const tabs = (
    <div style={{ display: 'flex', background: '#F1EBE1', borderRadius: 13, padding: 5, gap: 4 }}>
      {MODE_TABS.map((t) => {
        const sel = mode === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setMode(t.key)}
            aria-pressed={sel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10,
              padding: '9px 15px', fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5,
              cursor: 'pointer', border: 'none',
              background: sel ? '#fff' : 'transparent',
              color: sel ? ACCENT : neutral.textFaint,
              boxShadow: sel ? '0 2px 6px rgba(43,39,34,.1)' : 'none',
            }}
          >
            <t.Icon weight="fill" size={15} />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="mx-auto w-full"
      style={{ flex: 1, maxWidth: 1240, padding: '30px 30px 70px', animation: 'ascFade .45s ease both' }}
    >
      <Header mode={mode} specialty={specialty} sub={sub} postedCount={postedCount} tabs={tabs} />

      {noSpec ? (
        <NoSpecPrompt onSet={() => void navigate('/clinician/profile')} />
      ) : mode === 'posted' ? (
        <LiveOpenings
          specialty={specialty}
          sub={sub}
          years={years}
          appliedIds={appliedIds}
          onCount={setPostedCount}
          onApplied={(pid, on) =>
            setAppliedIds((prev) => {
              const next = new Set(prev);
              if (on) next.add(pid);
              else next.delete(pid);
              return next;
            })
          }
        />
      ) : (
        <FacilityView
          mode={mode}
          specialty={specialty}
          savedIds={savedIds}
          onSaved={(fid, on) =>
            setSavedIds((prev) => {
              const next = new Set(prev);
              if (on) next.add(fid);
              else next.delete(fid);
              return next;
            })
          }
          onOpen={(fid) => void navigate(`/facility/${fid}`)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header (headline + sub copy, derived per mode — prototype cHeadline/cSub)
// ---------------------------------------------------------------------------

function Header({
  mode,
  specialty,
  sub,
  postedCount,
  tabs,
}: {
  mode: Mode;
  specialty: string | null;
  sub: string | null;
  postedCount: number;
  tabs: React.ReactNode;
}) {
  let headline: string;
  if (mode === 'posted') headline = specialty ? `Hospitals hiring ${specialty}` : 'Live openings from hospitals';
  else if (mode === 'need') headline = specialty ? `Where ${specialty} is missing` : 'Choose your specialty';
  else headline = specialty ? `Facilities offering ${specialty}` : 'Choose your specialty';

  let subCopy: string;
  if (mode === 'posted') {
    subCopy = specialty
      ? `${postedCount} open ${postedCount === 1 ? 'role' : 'roles'} matched to your specialty${sub ? ` · ${sub} prioritised` : ''}`
      : 'Pick a specialty to see who’s actively recruiting.';
  } else if (specialty) {
    subCopy =
      mode === 'need'
        ? `Facilities whose records show a gap your ${specialty} skills would fill.`
        : `Facilities that already list ${specialty} — for referral or peer support.`;
  } else {
    subCopy = 'Set a specialty to map demand.';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
      <div>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em', margin: 0, color: neutral.ink }}>
          {headline}
        </h2>
        <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>{subCopy}</p>
      </div>
      {tabs}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / error primitives
// ---------------------------------------------------------------------------

function NoSpecPrompt({ onSet }: { onSet: () => void }) {
  return (
    <div
      style={{
        marginTop: 22, background: neutral.surface, border: `1px dashed ${neutral.borderDashed}`,
        borderRadius: 20, padding: 46, textAlign: 'center', color: neutral.textFaint2,
      }}
    >
      <Stethoscope size={36} color={neutral.placeholder} />
      <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 17, color: neutral.textMuted, marginTop: 12 }}>
        Choose a specialty to begin
      </div>
      <div style={{ fontSize: 14, marginTop: 4 }}>We&rsquo;ll match you to live hospital openings and inferred gaps.</div>
      <button
        type="button"
        onClick={onSet}
        style={{
          marginTop: 16, background: ACCENT, color: '#fff', border: 'none', borderRadius: 11,
          padding: '11px 18px', fontFamily: fonts.body, fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}
      >
        Set my specialty
      </button>
    </div>
  );
}

function CardSkeletons({ columns }: { columns: 1 | 2 }) {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: columns === 2 ? 'repeat(2,1fr)' : '1fr',
        gap: 14, marginTop: 22,
      }}
    >
      {['s1', 's2', 's3', 's4'].map((sk) => (
        <div
          key={sk}
          style={{ background: neutral.surface, border: `1px solid ${neutral.borderCard}`, borderRadius: 18, padding: 20 }}
        >
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-3 h-6 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-4 h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 22, background: semantic.dangerBg, border: `1px solid ${semantic.danger}33`,
        borderRadius: 18, padding: 24, color: semantic.danger,
        display: 'flex', alignItems: 'center', gap: 10, fontFamily: fonts.body, fontWeight: 600, fontSize: 14,
      }}
    >
      <WarningCircle weight="fill" size={20} />
      Couldn&rsquo;t load opportunities — {message}
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1', background: neutral.surface, border: `1px dashed ${neutral.borderDashed}`,
        borderRadius: 20, padding: 40, textAlign: 'center', color: neutral.textFaint2,
      }}
    >
      {icon}
      <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 16, color: neutral.textMuted, marginTop: 10 }}>{title}</div>
      <div style={{ fontSize: 14, marginTop: 4 }}>{body}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIVE OPENINGS — postings ranked by sub-specialty fit; apply → applications
// ---------------------------------------------------------------------------

function LiveOpenings({
  specialty,
  sub,
  years,
  appliedIds,
  onApplied,
  onCount,
}: {
  specialty: string;
  sub: string | null;
  years: number | null;
  appliedIds: Set<string>;
  onApplied: (postingId: string, on: boolean) => void;
  onCount: (count: number) => void;
}) {
  const { data, loading, error, refetch } = usePostings({ discipline: specialty });
  // Owner email → identify the clinician's own-account postings (authored as a
  // hospital on the same account); they're slightly de-prioritised (prototype
  // p.mine → score -3) so they don't crowd out genuinely external openings.
  const { data: me } = useMe();
  const myEmail = me?.email ?? null;

  // Rank by sub-specialty fit, then urgency, then own-posting penalty
  // (prototype postingsRanked score: subMatch*100 + urgency(20/10) + mine(-3)).
  const ranked = useMemo(() => {
    const rows = data ?? [];
    return [...rows]
      .map((p) => {
        const subMatch = !!(sub && p.sub === sub);
        const mine = !!(myEmail && p.user_email && p.user_email === myEmail);
        const score =
          (subMatch ? 100 : 0) +
          (p.urgency === 'high' ? 20 : p.urgency === 'medium' ? 10 : 0) +
          (mine ? -3 : 0);
        return { p, subMatch, score };
      })
      .sort((a, b) => b.score - a.score);
  }, [data, sub, myEmail]);

  // Report the ranked posting count up so the header subcopy can render the
  // dynamic "N open roles…" line (prototype cSubFinal).
  useEffect(() => {
    onCount(ranked.length);
  }, [ranked.length, onCount]);

  if (loading) return <CardSkeletons columns={2} />;
  if (error) return <ErrorState message={error} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, marginTop: 22 }}>
      {ranked.map(({ p, subMatch }) => (
        <PostingCard
          key={p.posting_id}
          posting={p}
          subMatch={subMatch}
          hasSub={!!sub}
          applied={appliedIds.has(p.posting_id)}
          onApply={() => {
            void (async () => {
              const willApply = !appliedIds.has(p.posting_id);
              onApplied(p.posting_id, willApply); // optimistic
              try {
                const res = await applyToPosting({
                  posting_id: p.posting_id,
                  specialty,
                  sub: sub ?? undefined,
                  years_experience: years ?? undefined,
                });
                onApplied(p.posting_id, res.applied);
              } catch {
                onApplied(p.posting_id, !willApply); // revert
              }
              refetch();
            })();
          }}
        />
      ))}
      {ranked.length === 0 && (
        <EmptyState
          icon={<Megaphone size={32} color={neutral.placeholder} />}
          title={`No hospitals are hiring ${specialty} yet`}
          body="Switch to “Inferred gaps” to see facilities whose records suggest a need."
        />
      )}
    </div>
  );
}

function PostingCard({
  posting,
  subMatch,
  hasSub,
  applied,
  onApply,
}: {
  posting: Posting;
  subMatch: boolean;
  hasSub: boolean;
  applied: boolean;
  onApply: () => void;
}) {
  const um = urgMeta(posting.urgency);
  const accent = subMatch ? ACCENT : neutral.placeholder;
  const applicants = posting.applicants ?? 0;
  const applicantsText =
    applicants > 0 ? `${applicants} clinician${applicants === 1 ? '' : 's'} interested` : 'Open role · be the first';
  const fit = subMatch
    ? { label: 'Strong sub-specialty fit', fg: semantic.success, bg: semantic.successBg }
    : hasSub
      ? { label: 'Specialty fit · different sub', fg: semantic.warn, bg: semantic.warnBg }
      : { label: 'Specialty fit', fg: semantic.success, bg: semantic.successBg };

  return (
    <div
      style={{
        background: neutral.surface, border: `1px solid ${neutral.borderCard}`, borderLeft: `4px solid ${accent}`,
        borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(43,39,34,.04)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <Pill fg={um.fg} bg={um.bg}>
          <um.Icon weight="fill" size={12} />
          {um.label}
        </Pill>
        <Pill fg={fit.fg} bg={fit.bg}>
          <GitBranch weight="fill" size={12} />
          {fit.label}
        </Pill>
      </div>
      <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 18, color: neutral.ink, marginTop: 10 }}>
        {posting.discipline}
        {posting.sub && (
          <>
            {' · '}
            <span style={{ color: ACCENT }}>{posting.sub}</span>
          </>
        )}
      </div>
      <div style={{ fontSize: 13, color: neutral.textFaint2, fontWeight: 500, marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Buildings weight="fill" size={13} />
        {posting.hospital ?? 'Hospital'} · {posting.city}
      </div>
      {posting.driver && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 7, marginTop: 13, background: semantic.goldSurface,
            border: `1px solid ${semantic.goldSurfaceBorder}`, borderRadius: 10, padding: '9px 12px',
            fontSize: 13, color: semantic.warn,
          }}
        >
          <Pulse weight="fill" size={14} />
          Driven by {posting.driver}
        </div>
      )}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14,
          paddingTop: 13, borderTop: `1px solid ${neutral.divider2}`, gap: 10,
        }}
      >
        <span style={{ fontSize: 12.5, color: neutral.textDisabled, fontWeight: 500 }}>{applicantsText}</span>
        <button
          type="button"
          onClick={onApply}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 11, padding: '9px 15px',
            fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
            ...(applied
              ? { background: semantic.successBg, color: semantic.success, border: `1px solid ${role.clinician.border}` }
              : { background: ACCENT, color: '#fff', border: 'none' }),
          }}
        >
          {applied ? <CheckCircle weight="fill" size={15} /> : <PaperPlaneTilt weight="fill" size={15} />}
          {applied ? 'Interest sent' : 'Express interest'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FACILITY VIEW — "Inferred gaps" (needs) | "Offers it" (specialties)
// ---------------------------------------------------------------------------

function FacilityView({
  mode,
  specialty,
  savedIds,
  onSaved,
  onOpen,
}: {
  mode: Exclude<Mode, 'posted'>;
  specialty: string;
  savedIds: Set<string>;
  onSaved: (facilityId: string, on: boolean) => void;
  onOpen: (facilityId: string) => void;
}) {
  // "Offers it" → facilities listing the specialty. "Inferred gaps" → we fetch a
  // broad slice and keep those whose `needs` include the specialty (the server
  // can't filter by needs, so it's done client-side, matching the prototype).
  const offers = mode === 'has';
  const { data, loading, error } = useSearchFacilities(
    offers ? { specialty, limit: 60 } : { limit: 200 },
  );

  // District-level signals that *escalate* an inferred gap: modeled demand for
  // the discipline (district_demand) and care-desert rank (gold_district_supply_need).
  const { data: demand } = useDistrictDemand(
    mode === 'need' ? { discipline: specialty, limit: 400 } : undefined,
  );
  const { data: desertRows } = useDeserts(mode === 'need' ? { limit: 400 } : undefined);

  const demandByDistrict = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of demand ?? []) m.set(d.nfhs_district, d.demand_score);
    return m;
  }, [demand]);
  const driverByDistrict = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of demand ?? []) m.set(d.nfhs_district, d.top_driver);
    return m;
  }, [demand]);
  const desertRankByDistrict = useMemo(() => {
    const m = new Map<string, number>();
    // desert_rank is NULL for unknown-supply districts (0 mapped facilities) — skip them.
    for (const r of desertRows ?? []) if (r.desert_rank != null) m.set(r.nfhs_district, r.desert_rank);
    return m;
  }, [desertRows]);

  const facilities = useMemo(() => {
    const rows = data ?? [];
    if (offers) return rows.filter((f) => f.specialties.includes(specialty));
    // Inferred gaps: facility's FDR record names the specialty as an unmet need.
    const gaps = rows.filter((f) => (f.needs ?? []).includes(specialty));
    // Rank worst-first: highest district demand, then worst desert rank.
    return gaps.sort((a, b) => {
      const da = demandByDistrict.get(a.district ?? '') ?? 0;
      const db = demandByDistrict.get(b.district ?? '') ?? 0;
      if (db !== da) return db - da;
      const ra = desertRankByDistrict.get(a.district ?? '') ?? 9999;
      const rb = desertRankByDistrict.get(b.district ?? '') ?? 9999;
      return ra - rb;
    });
  }, [data, offers, specialty, demandByDistrict, desertRankByDistrict]);

  return (
    <div className="max-md:!grid-cols-1" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 24, alignItems: 'start', marginTop: 22 }}>
      {/* LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading && <CardSkeletons columns={1} />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && facilities.length === 0 && (
          <EmptyState
            icon={
              offers ? <CheckCircle size={32} color={neutral.placeholder} /> : <Target size={32} color={neutral.placeholder} />
            }
            title={offers ? `No facilities list ${specialty} yet` : `No recorded ${specialty} gaps in range`}
            body={
              offers
                ? 'Try “Inferred gaps” to see where the discipline is missing.'
                : 'Switch to “Live openings” to see hospitals actively recruiting.'
            }
          />
        )}
        {!loading &&
          !error &&
          facilities.map((f) => (
            <OpportunityCard
              key={f.id}
              facility={f}
              mode={mode}
              specialty={specialty}
              demandScore={demandByDistrict.get(f.district ?? '')}
              topDriver={driverByDistrict.get(f.district ?? '') ?? null}
              saved={savedIds.has(f.id)}
              onOpen={() => onOpen(f.id)}
              onSave={() => {
                void (async () => {
                  const willSave = !savedIds.has(f.id);
                  onSaved(f.id, willSave); // optimistic
                  try {
                    const res = await saveShortlist(f.id, willSave);
                    onSaved(f.id, res.saved);
                  } catch {
                    onSaved(f.id, !willSave); // revert
                  }
                })();
              }}
            />
          ))}
      </div>

      {/* MAP placeholder plate (prototype clinicianPins region) */}
      <MapPlate mode={mode} specialty={specialty} count={facilities.length} />
    </div>
  );
}

function OpportunityCard({
  facility: f,
  mode,
  specialty,
  demandScore,
  topDriver,
  saved,
  onOpen,
  onSave,
}: {
  facility: FacilityRow;
  mode: Exclude<Mode, 'posted'>;
  specialty: string;
  demandScore: number | undefined;
  topDriver: string | null;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const ts = trustState(f.trust);
  const av = AVATAR[ts];
  const conf = f.conf ?? 0;

  // Opportunity badge + reason chips (prototype clinicianList).
  type Reason = { Icon: typeof MinusCircle; color: string; text: string };
  const reasons: Reason[] = [];
  let opp: { label: string; fg: string; bg: string; Icon: typeof Fire };

  // district_demand tags the 3 proxy disciplines (Orthopedics, Ophthalmology,
  // Trauma) by prefixing top_driver with '(proxy) ' — their burden is modeled
  // from a tobacco/alcohol risk proxy, not an NFHS-grounded prevalence. Detect
  // it so we can (a) strip the raw token from the chip and (b) flag the demand
  // as an estimate, keeping the inferred-gap honest about its basis.
  const isProxyDemand = !!topDriver && topDriver.startsWith('(proxy)');
  const cleanDriver = isProxyDemand ? topDriver.replace(/^\(proxy\)\s*/, '') : topDriver;

  if (mode === 'need') {
    reasons.push({ Icon: MinusCircle, color: semantic.danger, text: `No ${specialty} on staff` });
    reasons.push({
      Icon: UsersThree,
      color: neutral.textFaint,
      text: `${f.beds ? `${f.beds} beds · ` : ''}${f.city ?? '—'} catchment`,
    });
    if (demandScore != null) {
      reasons.push({ Icon: Pulse, color: semantic.warn, text: `District demand ${Math.round(demandScore)}${cleanDriver ? ` · ${cleanDriver}` : ''}` });
    } else {
      reasons.push({ Icon: Gauge, color: semantic.warn, text: `${conf}% record confidence` });
    }
    // High need when demand is high OR the record is unverified / large facility.
    const high = (demandScore != null && demandScore >= 70) || f.trust !== 'verified' || (f.beds != null && f.beds >= 200);
    opp = high
      ? { label: 'High need', fg: semantic.danger, bg: semantic.dangerBg, Icon: Fire }
      : { label: 'Confirmed gap', fg: semantic.warn, bg: semantic.warnBg, Icon: Target };
  } else {
    reasons.push({ Icon: CheckCircle, color: semantic.success, text: `Already offers ${specialty}` });
    reasons.push({ Icon: Buildings, color: neutral.textFaint, text: f.type ?? 'Facility' });
    reasons.push({ Icon: Gauge, color: semantic.success, text: `${conf}% confidence` });
    opp = { label: 'Active service', fg: semantic.success, bg: semantic.successBg, Icon: CheckCircle };
  }

  return (
    <div style={{ background: neutral.surface, border: `1px solid ${neutral.borderCard}`, borderRadius: 20, padding: '20px 22px', boxShadow: '0 1px 2px rgba(43,39,34,.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 42, height: 42, borderRadius: 12, background: av.bg, color: av.fg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: fonts.display, fontWeight: 700, fontSize: 17, flexShrink: 0,
            }}
          >
            {(f.name || '?').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 17, color: neutral.ink, lineHeight: 1.2 }}>{f.name}</div>
            <div style={{ fontSize: 13, color: neutral.textFaint2, fontWeight: 500, marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Buildings size={13} />
              {f.type ?? 'Facility'} · {f.city ?? '—'}
            </div>
          </div>
        </div>
        <Pill fg={opp.fg} bg={opp.bg}>
          <opp.Icon weight="fill" size={12} />
          {opp.label}
        </Pill>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 15 }}>
        {reasons.map((r) => (
          <span
            key={r.text}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F7F2EA',
              border: `1px solid ${neutral.border2}`, borderRadius: 999, padding: '6px 11px',
              fontFamily: fonts.body, fontWeight: 500, fontSize: 12.5, color: neutral.textMuted,
            }}
          >
            <r.Icon weight="fill" size={13} color={r.color} />
            {r.text}
          </span>
        ))}
        {/* Proxy-estimate flag — the demand for this discipline is modeled from a
            risk proxy (tobacco/alcohol), not NFHS-grounded prevalence. Surface it
            so the inferred gap stays honest about its basis. */}
        {mode === 'need' && demandScore != null && isProxyDemand && (
          <span
            title="District demand for this discipline is a modeled proxy estimate (tobacco/alcohol risk), not an NFHS-grounded prevalence."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, background: semantic.goldSurface,
              border: `1px solid ${semantic.goldSurfaceBorder}`, borderRadius: 999, padding: '6px 11px',
              fontFamily: fonts.body, fontWeight: 600, fontSize: 12.5, color: semantic.warn,
            }}
          >
            <Sparkle weight="fill" size={13} color={semantic.warn} />
            Proxy estimate
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 16, borderTop: `1px solid ${neutral.divider2}` }}>
        <button
          type="button"
          onClick={onOpen}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: ACCENT, padding: 0 }}
        >
          Facility &amp; evidence
          <ArrowRight weight="bold" size={14} />
        </button>
        <button
          type="button"
          onClick={onSave}
          aria-pressed={saved}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 11, padding: '9px 14px',
            fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
            ...(saved
              ? { background: semantic.successBg, color: semantic.success, border: `1px solid ${role.clinician.border}` }
              : { background: '#fff', color: neutral.textSoft, border: `1px solid ${neutral.border}` }),
          }}
        >
          <BookmarkSimple weight={saved ? 'fill' : 'regular'} size={17} />
          {saved ? 'On list' : 'Add to outreach'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map plate — sticky right rail. The prototype plots facility pins on a grid;
// without live geo wiring here we render the matching plate + caption so the
// region reads identically and stays honest about inferred-from-record gaps.
// ---------------------------------------------------------------------------

function MapPlate({ mode, specialty, count }: { mode: Exclude<Mode, 'posted'>; specialty: string; count: number }) {
  const isGap = mode === 'need';
  return (
    <div style={{ position: 'sticky', top: 88 }}>
      <div
        style={{
          position: 'relative', height: 520, borderRadius: 22, overflow: 'hidden',
          border: `1px solid ${neutral.border}`, background: '#EFF1EC',
          backgroundImage: 'linear-gradient(#E2E6DD 1px,transparent 1px),linear-gradient(90deg,#E2E6DD 1px,transparent 1px)',
          backgroundSize: '34px 34px', boxShadow: '0 1px 2px rgba(43,39,34,.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ color: neutral.placeholder, fontFamily: fonts.body, fontWeight: 600, fontSize: 13 }}>
          {count} {count === 1 ? 'facility' : 'facilities'} mapped
        </span>
        <div style={{ position: 'absolute', left: 16, top: 16, background: 'rgba(255,255,255,.92)', border: `1px solid ${neutral.border}`, borderRadius: 12, padding: '10px 13px', maxWidth: 230 }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 13, color: neutral.ink }}>
            {isGap ? 'Gap map' : 'Service map'}
          </div>
          <div style={{ fontSize: 12, color: neutral.textSoft, marginTop: 3, lineHeight: 1.4 }}>
            {isGap
              ? `Red pins flag facilities with no ${specialty} on record.`
              : `Green pins already offer ${specialty}.`}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 16, bottom: 16, background: 'rgba(255,255,255,.92)', border: `1px solid ${neutral.border}`, borderRadius: 12, padding: '10px 13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: neutral.textMuted }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: isGap ? semantic.danger : semantic.success }} />
            {isGap ? 'Service gap' : 'Active service'}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: neutral.textDisabled, margin: '12px 4px 0', lineHeight: 1.5 }}>
        Gaps are inferred from each facility&rsquo;s listed services in the FDR record — absence of evidence, shown honestly.
        Confirm current staffing with the facility before committing.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pill (status / fit / opportunity badges)
// ---------------------------------------------------------------------------

function Pill({ fg, bg, children }: { fg: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color: fg,
        borderRadius: 999, padding: '4px 10px', fontFamily: fonts.body, fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
