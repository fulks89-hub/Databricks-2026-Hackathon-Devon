// Asclepius — Facility Detail / Trust Desk (route /facility/:id).
//
// The hero, shared-by-all-roles screen. Reproduces the prototype's detail view
// (Asclepius.dc.html `isDetail`, see docs/DESIGN_SYSTEM.md §3.7):
//   header band · "Why we surfaced this" reason chips · Claimed capabilities
//   (ClaimRow + confirm/dispute → reviews) · "How we read this record" (raw
//   free-text → parsed fields w/ per-field confidence) · Source evidence
//   (EvidenceQuote) · record quality & caveats · sidebar At-a-glance, service
//   gaps, Save / Refer / Compare / Directions, private note, record freshness
//   (decay), Call-to-confirm, Review & fix.
//
// Data: useFacilityDetail(id) → FacilityRow. Writes: saveShortlist /
// removeShortlist, postReview (facility + per-claim), createReferral, addNote.
// All scoring/UX (reasons, parsed-field confidence, dq, freshness, phone,
// caveats, claim status) is the prototype's logic, ported verbatim.

import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Button,
  Skeleton,
  Textarea,
} from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  Sparkle,
  ListChecks,
  Scan,
  ArrowDown,
  Quotes,
  CaretDown,
  CaretUp,
  ShieldWarning,
  WarningCircle,
  MinusCircle,
  BookmarkSimple,
  PaperPlaneTilt,
  Scales,
  NavigationArrow,
  Car,
  NotePencil,
  FloppyDisk,
  ClockCountdown,
  Warning,
  PhoneCall,
  Phone,
  WhatsappLogo,
  SealCheck,
  CheckCircle,
  Flag,
  Info,
  ShieldCheck,
  Gauge,
  XCircle,
  Buildings,
  MapPin,
  FileText,
} from '@phosphor-icons/react';
import {
  useFacilityDetail,
  useFacilityNabh,
  saveShortlist,
  removeShortlist,
  postReview,
  createReferral,
  addNote,
  type FacilityRow,
  type FacilityNabhRow,
  type Claim,
} from '@/lib/api';
import {
  ClaimRow,
  EvidenceQuote,
  TrustBadge,
  ConfidenceChip,
  CoordSourceBadge,
  FacilityAvatar,
  type ClaimStatus,
  type ClaimUserMark,
  type TrustState,
  type ConfidenceLevel,
} from '@/components/asclepius';
import {
  fonts,
  neutral,
  role,
  semantic,
  trust as trustTheme,
} from '@/components/asclepius/theme';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// String → typed-union coercion (the wire columns are plain strings).
// ---------------------------------------------------------------------------

/** facilities.trust → TrustState (default unverified). */
function asTrust(t: string | null | undefined): TrustState {
  return t === 'verified' ? 'verified' : t === 'review' ? 'review' : 'unverified';
}

/** facilities.claims[].status → ClaimStatus (the design's 3 claim tiers). */
function asClaimStatus(s: string | null | undefined): ClaimStatus {
  return s === 'verified' ? 'verified' : s === 'review' ? 'claimed' : 'no-evidence';
}

// ---------------------------------------------------------------------------
// Ported prototype helpers (pure — no app state). Hash-derived demo fields
// (phone / freshness) match the prototype byte-for-byte so the synthetic
// "call to confirm" + decay copy reproduce exactly.
// ---------------------------------------------------------------------------

/** facPhone(f): deterministic synthetic +91 number, hashed off the id. */
function facPhone(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 131 + id.charCodeAt(i)) >>> 0;
  const a = 90000 + (h % 9999);
  const b = String(h % 99999).padStart(5, '0');
  return '+91 ' + a + ' ' + b;
}

interface Freshness {
  monthsOld: number;
  verifiedByUser: boolean;
  label: string;
  decayedConf: number;
  stale: boolean;
  lostPts: number;
}

/** freshness(f): record age + confidence-decay (prototype hash, unverified path). */
function freshnessOf(f: FacilityRow, verifiedByUser: boolean): Freshness {
  if (verifiedByUser) {
    return {
      monthsOld: 0,
      verifiedByUser: true,
      label: 'You verified just now',
      decayedConf: f.conf ?? 0,
      stale: false,
      lostPts: 0,
    };
  }
  let h = 0;
  for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) >>> 0;
  const monthsOld = 2 + (h % 34);
  const lost = Math.min(40, Math.round(monthsOld * 1.2));
  return {
    monthsOld,
    verifiedByUser: false,
    label: 'Last crawled ~' + monthsOld + ' months ago',
    decayedConf: Math.max(20, (f.conf ?? 0) - lost),
    stale: monthsOld >= 18,
    lostPts: lost,
  };
}

/** flagsFor(f): record-quality caveats (prototype copy verbatim). */
function flagsFor(f: FacilityRow): { text: string }[] {
  const out: { text: string }[] = [];
  if (!f.year) out.push({ text: 'Year established missing — only 48% of records carry it' });
  if (!f.beds) out.push({ text: 'Bed capacity unknown — only 25% of records report it' });
  if (asTrust(f.trust) !== 'verified') out.push({ text: 'Capabilities are self-reported and not yet verified' });
  out.push({ text: 'Equipment & services were parsed from free-text, not a structured field' });
  return out;
}

/** dqOf(f).score: record-quality score (0–100), prototype weights. */
function dqScoreOf(f: FacilityRow, facilityConfirmed: boolean, dupResolved: boolean, stale: boolean): number {
  let score = 100;
  const weights: number[] = [];
  if (f.beds == null) weights.push(16);
  if (f.year == null) weights.push(11);
  if (!f.equipment) weights.push(13);
  if (!f.procedure) weights.push(9);
  if (asTrust(f.trust) !== 'verified' && !facilityConfirmed) weights.push(18);
  if (f.possible_entity_dup && !dupResolved) weights.push(22);
  // Stale records lose 9 pts (prototype dqOf: fr.stale && !fr.verifiedByUser).
  // The caller passes fresh.stale, which is already false once user-confirmed.
  if (stale) weights.push(9);
  const unv = (f.claims ?? []).filter((c) => asClaimStatus(c.status) === 'no-evidence').length;
  if (unv > 0) weights.push(7);
  for (const w of weights) score -= w;
  if (facilityConfirmed) score += 12;
  return Math.max(0, Math.min(100, score));
}

const dqColor = (s: number) => (s >= 75 ? semantic.success : s >= 50 ? semantic.warn : semantic.danger);

/** cMeta(conf): per-parsed-field confidence → ConfidenceChip level + label. */
function fieldConf(level: ConfidenceLevel): { level: ConfidenceLevel; label: string } {
  switch (level) {
    case 'high':
      return { level, label: 'high confidence' };
    case 'medium':
      return { level, label: 'medium confidence' };
    case 'low':
      return { level, label: 'low confidence' };
    default:
      return { level: 'none', label: 'not extracted' };
  }
}

const directionsUrl = (f: FacilityRow) =>
  'https://www.google.com/maps/dir/?api=1&destination=' + (f.lat ?? 0) + ',' + (f.lng ?? 0) + '&travelmode=driving';

// Shared section label (uppercase, faint).
function SectionLabel({ icon, children, color, mt }: { icon: React.ReactNode; children: React.ReactNode; color?: string; mt?: number }) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        marginTop: mt,
        fontFamily: fonts.body,
        fontWeight: fonts.weight.bold,
        fontSize: 13,
        color: neutral.textFaint2,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      <span style={{ color: color ?? role.patient.base, display: 'inline-flex' }}>{icon}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error / empty shells.
// ---------------------------------------------------------------------------

function BackLink() {
  return (
    <Link
      to="/saved"
      className="mb-2 inline-flex items-center gap-2"
      style={{ fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 14, color: neutral.textSoft, textDecoration: 'none' }}
    >
      <ArrowLeft weight="bold" size={16} />
      Back to results
    </Link>
  );
}

function DetailShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1080, padding: '24px 30px 80px' }}>
      <BackLink />
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <DetailShell>
      <div
        style={{ background: neutral.surface, border: `1px solid ${neutral.borderCard}`, borderRadius: 24, overflow: 'hidden' }}
      >
        <div style={{ padding: '26px 30px', background: role.patient.band, borderBottom: `1px solid ${neutral.borderCard}` }}>
          <div className="flex items-center gap-4">
            <Skeleton style={{ width: 56, height: 56, borderRadius: 15 }} />
            <div className="flex-1">
              <Skeleton style={{ height: 28, width: '60%', borderRadius: 8 }} />
              <Skeleton className="mt-2" style={{ height: 16, width: '40%', borderRadius: 6 }} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="border-b lg:border-b-0 lg:border-r" style={{ padding: '26px 30px', borderColor: neutral.divider2 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-3" style={{ height: 60, borderRadius: 12 }} />
            ))}
          </div>
          <div style={{ padding: '26px 30px', background: neutral.surfaceWarm }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-3" style={{ height: 44, borderRadius: 12 }} />
            ))}
          </div>
        </div>
      </div>
    </DetailShell>
  );
}

function MessageState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <DetailShell>
      <div
        className="flex flex-col items-center justify-center text-center"
        style={{
          background: neutral.surface,
          border: `1px dashed ${neutral.borderDashed}`,
          borderRadius: 24,
          padding: '64px 30px',
        }}
      >
        <span style={{ color: neutral.placeholder, marginBottom: 12, display: 'inline-flex' }}>{icon}</span>
        <h2 style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 22, color: neutral.ink, margin: 0 }}>{title}</h2>
        <p style={{ fontFamily: fonts.body, fontSize: 15, color: neutral.textMuted, marginTop: 8, maxWidth: '34em' }}>{body}</p>
        <Link to="/registry" className="mt-5">
          <Button variant="outline">Browse the registry</Button>
        </Link>
      </div>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Screen.
// ---------------------------------------------------------------------------

/** Independent NABH accreditation badge — shown in the header when the facility
 *  is a name-corroborated NABH match. Cites the official scope PDF (cert_url). */
function NabhBadge({ nabh }: { nabh: FacilityNabhRow }) {
  const specs = (nabh.verified_specialties ?? '').split(' | ').filter(Boolean);
  const top = specs.slice(0, 4);
  const more = specs.length - top.length;
  const accredited = nabh.status === 'accredited' || nabh.status === 'certified';
  return (
    <div style={{ background: '#E4EFEA', border: '1px solid #2E7D67', borderRadius: 14, padding: '10px 14px', maxWidth: 360 }}>
      <div className="flex items-center gap-1.5" style={{ color: '#2E7D67', fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13 }}>
        <SealCheck weight="fill" size={16} />
        {'NABH-' + (accredited ? 'certified' : (nabh.status ?? 'listed'))}
        {nabh.program_tier ? <span style={{ opacity: 0.7, fontWeight: fonts.weight.medium }}>{' · ' + nabh.program_tier}</span> : null}
      </div>
      {specs.length > 0 ? (
        <div className="mt-1" style={{ fontFamily: fonts.body, fontSize: 12, color: neutral.textSoft }}>
          {'Certified for: ' + top.join(', ') + (more > 0 ? ' +' + more + ' more' : '')}
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ fontSize: 11.5, color: neutral.textMuted, fontFamily: fonts.body }}>
        {nabh.verified_bed_count ? <span>{nabh.verified_bed_count + ' beds'}</span> : null}
        {nabh.accreditation_valid_thru ? <span>{'· valid thru ' + nabh.accreditation_valid_thru}</span> : null}
        {nabh.cert_url ? (
          <a href={nabh.cert_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2E7D67', fontWeight: fonts.weight.semibold }}>
            Scope PDF ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function FacilityDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useFacilityDetail(id);
  const nabh = useFacilityNabh(id);

  // Local "this-session" mirrors of the writes (the reads don't round-trip the
  // owner's own shortlist/review/note state into the FacilityRow). Each write
  // updates the mirror optimistically; refetch() re-reads the public record.
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [facilityMark, setFacilityMark] = useState<'confirmed' | 'site_visit' | null>(null);
  const [claimMarks, setClaimMarks] = useState<Record<string, ClaimUserMark>>({});
  const [callMark, setCallMark] = useState<'confirmed' | 'disputed' | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [referred, setReferred] = useState(false);
  const [referPending, setReferPending] = useState(false);
  const [inCompare, setInCompare] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);

  // ----- writes -----------------------------------------------------------

  const onSave = useCallback(async () => {
    if (!data) return;
    setSavePending(true);
    const next = !saved;
    setSaved(next); // optimistic
    try {
      if (next) await saveShortlist(data.id, true);
      else await removeShortlist(data.id);
    } catch {
      setSaved(!next); // revert
    } finally {
      setSavePending(false);
    }
  }, [data, saved]);

  const reviewClaim = useCallback(
    async (label: string, decision: ClaimUserMark) => {
      if (!data) return;
      setClaimMarks((m) => {
        const next = { ...m };
        if (next[label] === decision) delete next[label];
        else next[label] = decision;
        return next;
      });
      try {
        await postReview({ facility_id: data.id, claim_label: label, claim_status: decision });
      } catch {
        /* keep optimistic mark; the toggle is idempotent on retry */
      }
    },
    [data],
  );

  const reviewFacility = useCallback(
    async (decision: 'confirmed' | 'site_visit', via?: string) => {
      if (!data) return;
      setFacilityMark((cur) => (cur === decision ? null : decision));
      try {
        await postReview({ facility_id: data.id, decision, via });
      } catch {
        /* ignore — mirror already reflects intent */
      }
    },
    [data],
  );

  const onCall = useCallback(
    async (decision: 'confirmed' | 'disputed') => {
      if (!data) return;
      setCallMark((cur) => (cur === decision ? null : decision));
      // A phone confirmation refreshes facility-level trust (via='call').
      try {
        await postReview({ facility_id: data.id, decision: decision === 'confirmed' ? 'confirmed' : 'site_visit', via: 'call' });
        if (decision === 'confirmed') setFacilityMark('confirmed');
      } catch {
        /* ignore */
      }
    },
    [data],
  );

  const onRefer = useCallback(async () => {
    if (!data || referred) return;
    setReferPending(true);
    try {
      await createReferral({
        facility_id: data.id,
        facility_name: data.name,
        city: data.city ?? undefined,
        state: data.state ?? undefined,
      });
      setReferred(true);
    } catch {
      /* leave button active to retry */
    } finally {
      setReferPending(false);
    }
  }, [data, referred]);

  const onNoteBlur = useCallback(async () => {
    if (!data) return;
    const text = note.trim();
    if (!text) return;
    try {
      await addNote(data.id, text);
      setNoteSaved(true);
    } catch {
      setNoteSaved(false);
    }
  }, [data, note]);

  // ----- derived (memoized off the row) -----------------------------------

  const view = useMemo(() => {
    if (!data) return null;
    const f = data;
    const t = asTrust(f.trust);
    const conf = f.conf ?? 0;
    const facilityConfirmed = facilityMark === 'confirmed';
    const fresh = freshnessOf(f, facilityConfirmed || callMark === 'confirmed');

    // "Why we surfaced this" — proximity + capability + trust/confidence.
    // (Shared/registry context has no patient origin, so we surface the
    //  capability + record-confidence signals the prototype shows when no
    //  need-match is in play.)
    const reasons: { icon: React.ReactNode; text: string }[] = [];
    if (f.specialties.length) {
      reasons.push({
        icon: <CheckCircle weight="fill" size={14} color={semantic.success} />,
        text:
          f.specialties.length <= 2
            ? 'Offers ' + f.specialties.join(' & ')
            : 'Lists ' + f.specialties.length + ' clinical specialties',
      });
    } else {
      reasons.push({ icon: <XCircle weight="fill" size={14} color={semantic.danger} />, text: 'No specialties listed in the record' });
    }
    if (f.city) {
      reasons.push({ icon: <NavigationArrow weight="fill" size={14} color={neutral.textFaint} />, text: f.city + (f.state ? ', ' + f.state : '') });
    }
    reasons.push({
      icon:
        t === 'verified' ? (
          <ShieldCheck weight="fill" size={14} color={semantic.success} />
        ) : (
          <ShieldWarning weight="fill" size={14} color={semantic.warn} />
        ),
      text: conf + '% confidence',
    });

    // Parsed fields — raw free-text → structure, with per-field confidence.
    const specConf: ConfidenceLevel = f.specialties.length ? (t === 'verified' ? 'high' : t === 'review' ? 'medium' : 'low') : 'none';
    const equipConf: ConfidenceLevel = f.equipment ? (t === 'verified' ? 'high' : 'medium') : 'none';
    const bedsConf: ConfidenceLevel = f.beds != null ? 'medium' : 'none';
    const yearConf: ConfidenceLevel = f.year != null ? 'medium' : 'none';
    const parsed = [
      { label: 'Specialties', value: f.specialties.join(', ') || '—', src: 'capability', conf: specConf },
      { label: 'Equipment', value: f.equipment || 'not found in text', src: 'description', conf: equipConf },
      { label: 'Bed capacity', value: f.beds != null ? f.beds + ' beds' : 'not found', src: 'description', conf: bedsConf },
      { label: 'Year established', value: f.year != null ? String(f.year) : 'not found', src: 'description', conf: yearConf },
    ].map((p) => {
      const c = fieldConf(p.conf);
      return { label: p.label, value: p.value, src: p.src, found: p.conf !== 'none', confLevel: c.level, confLabel: c.label };
    });

    // Raw free-text fields (only those present).
    const rawFields = (
      [
        ['description', f.description],
        ['capability', f.capability],
        ['procedure', f.procedure],
        ['equipment', f.equipment],
      ] as const
    )
      .filter(([, v]) => !!v)
      .map(([label, text]) => ({ label, text: text as string }));

    const dq = dqScoreOf(f, facilityConfirmed, false, fresh.stale && !fresh.verifiedByUser);
    const phone = facPhone(f.id);
    const telHref = 'tel:' + phone.replace(/[^0-9+]/g, '');
    const waText =
      'Hello, checking via Asclepius — do you currently offer ' +
      f.specialties.slice(0, 3).join(', ') +
      '? Is that service active right now?';
    const waHref = 'https://wa.me/91' + phone.replace(/[^0-9]/g, '').slice(-10) + '?text=' + encodeURIComponent(waText);

    return {
      f,
      t,
      conf,
      reasons,
      parsed,
      rawFields,
      rawCollapsible: rawFields.reduce((n, rf) => n + rf.text.length, 0) > 320,
      claims: f.claims ?? [],
      flags: flagsFor(f),
      dq,
      fresh,
      phone,
      telHref,
      waHref,
      hasDir: f.lat != null && f.lng != null,
      dirUrl: directionsUrl(f),
      needs: f.needs ?? [],
      coordSource: f.coord_source,
    };
  }, [data, facilityMark, callMark]);

  // ----- states -----------------------------------------------------------

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <MessageState
        icon={<WarningCircle weight="fill" size={48} />}
        title="Couldn't load this record"
        body={error}
      />
    );
  }
  if (!view) {
    return (
      <MessageState
        icon={<Buildings weight="fill" size={48} />}
        title="Facility not found"
        body="We couldn't find a record for this id. It may have been merged as a duplicate or removed from the registry."
      />
    );
  }

  const { f, t, conf } = view;

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1080, padding: '24px 30px 80px', animation: 'ascFade .4s ease both' }}>
      <BackLink />

      <div
        style={{
          background: neutral.surface,
          border: `1px solid ${neutral.borderCard}`,
          borderRadius: 24,
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(43,39,34,.04),0 24px 50px -34px rgba(43,39,34,.32)',
        }}
      >
        {/* ---- header band ---- */}
        <div
          className="flex flex-wrap items-start justify-between gap-4"
          style={{ padding: '26px 30px', background: role.patient.band, borderBottom: `1px solid ${neutral.borderCard}` }}
        >
          <div className="flex items-start gap-4">
            <FacilityAvatar initial={f.name.charAt(0)} trust={t} size="lg" className="shrink-0 !rounded-[15px]" />
            <div>
              <h1 style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 27, letterSpacing: '-.02em', margin: 0, color: neutral.ink, lineHeight: 1.1 }}>
                {f.name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2" style={{ fontFamily: fonts.body, fontSize: 14, color: neutral.textSoft, fontWeight: fonts.weight.medium }}>
                <Buildings size={15} />
                {f.type ?? 'Facility'}
                {f.city && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <MapPin size={15} />
                    {f.city}
                    {f.state ? ', ' + f.state : ''}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <TrustBadge trust={t} conf={conf} />
            {nabh.data ? <NabhBadge nabh={nabh.data} /> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* =================== MAIN =================== */}
          <div className="border-b lg:border-b-0 lg:border-r" style={{ padding: '26px 30px', borderColor: neutral.divider2 }}>
            {/* why we surfaced this */}
            <SectionLabel icon={<Sparkle weight="fill" size={14} />}>Why we surfaced this</SectionLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {view.reasons.map((r) => (
                <span
                  key={r.text}
                  className="inline-flex items-center gap-1.5"
                  style={{ background: '#F7F2EA', border: `1px solid ${neutral.border2}`, borderRadius: 999, padding: '7px 12px', fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5, color: neutral.textMuted }}
                >
                  {r.icon}
                  {r.text}
                </span>
              ))}
            </div>

            {/* claimed capabilities → ClaimRow (confirm/dispute → reviews) */}
            <SectionLabel icon={<ListChecks weight="fill" size={14} />} mt={26}>
              Claimed capabilities
            </SectionLabel>
            {view.claims.length ? (
              <div
                className="mt-3 flex flex-col gap-px"
                style={{ border: `1px solid ${neutral.divider2}`, borderRadius: 14, overflow: 'hidden' }}
              >
                {view.claims.map((c: Claim) => {
                  const mark = claimMarks[c.text];
                  return (
                    <div key={c.text}>
                      <ClaimRow
                        label={c.text}
                        status={asClaimStatus(c.status)}
                        userMark={mark}
                        onConfirm={() => void reviewClaim(c.text, 'confirmed')}
                        onDispute={() => void reviewClaim(c.text, 'disputed')}
                      />
                      {mark && (
                        <div style={{ fontSize: 11, fontWeight: fonts.weight.semibold, color: mark === 'confirmed' ? semantic.success : semantic.danger, marginTop: 4, marginLeft: 4 }}>
                          {mark === 'confirmed' ? 'You confirmed this capability' : 'You disputed this capability'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3" style={{ fontSize: 13.5, color: neutral.textFaint, fontStyle: 'italic' }}>
                No structured capability claims were extracted from this record.
              </div>
            )}

            {/* how we read this record */}
            <SectionLabel icon={<Scan weight="fill" size={14} />} mt={26}>
              How we read this record
            </SectionLabel>
            <div className="mt-3" style={{ background: neutral.surfaceWarm, border: `1px solid ${neutral.divider2}`, borderRadius: 14, padding: '15px 16px' }}>
              {view.rawFields.length > 0 && (
                <>
                  <div style={{ fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 11.5, color: neutral.textDisabled, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                    Raw free text (as crawled)
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      maxHeight: view.rawCollapsible && !rawExpanded ? 132 : undefined,
                      overflow: view.rawCollapsible && !rawExpanded ? 'hidden' : undefined,
                    }}
                  >
                    {view.rawFields.map((rf) => (
                      <div key={rf.label} className="mb-2" style={{ lineHeight: 1.5 }}>
                        <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 10.5, color: semantic.info, background: semantic.infoBg, borderRadius: 5, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {rf.label}
                        </span>
                        <span style={{ fontSize: 13, color: neutral.textMuted, fontStyle: 'italic', marginLeft: 7, overflowWrap: 'anywhere' }}>{rf.text}</span>
                      </div>
                    ))}
                    {view.rawCollapsible && !rawExpanded && (
                      <div
                        aria-hidden
                        style={{ position: 'absolute', insetInline: 0, bottom: 0, height: 46, background: `linear-gradient(rgba(252,250,246,0), ${neutral.surfaceWarm})`, pointerEvents: 'none' }}
                      />
                    )}
                  </div>
                  {view.rawCollapsible && (
                    <button
                      type="button"
                      onClick={() => setRawExpanded((v) => !v)}
                      aria-expanded={rawExpanded}
                      className="inline-flex items-center gap-1"
                      style={{ marginTop: 4, fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5, color: semantic.info, background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {rawExpanded ? 'Show less' : 'Show full crawled text'}
                      <ArrowDown weight="bold" size={11} style={{ transform: rawExpanded ? 'rotate(180deg)' : undefined }} />
                    </button>
                  )}
                  <div className="my-3 flex items-center gap-2">
                    <div style={{ height: 1, background: neutral.border2, flex: 1 }} />
                    <span className="inline-flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 10.5, color: '#B9AE9C', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      <ArrowDown weight="bold" size={11} />
                      extracted to structure
                    </span>
                    <div style={{ height: 1, background: neutral.border2, flex: 1 }} />
                  </div>
                </>
              )}
              <div className="flex flex-col gap-2">
                {view.parsed.map((p) => (
                  <div key={p.label} className="flex items-center justify-between gap-2.5">
                    <span className="min-w-0">
                      <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13, color: neutral.ink }}>{p.label}:</span>{' '}
                      <span style={{ fontSize: 13, fontWeight: fonts.weight.medium, color: p.found ? neutral.ink : semantic.danger }}>{p.value}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <CoordSourceBadge source={p.src} />
                      <ConfidenceChip level={p.confLevel} label={p.confLabel} />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* source evidence (collapsible) → EvidenceQuote */}
            <button
              type="button"
              onClick={() => setEvidenceOpen((o) => !o)}
              className="mt-6 flex w-full items-center justify-between gap-2"
              style={{ background: semantic.goldSurface, border: `1px solid ${semantic.goldSurfaceBorder}`, borderRadius: 14, padding: '14px 16px', cursor: 'pointer' }}
              aria-expanded={evidenceOpen}
            >
              <span className="flex items-center gap-2.5" style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, color: semantic.warn }}>
                <Quotes weight="fill" size={18} />
                Source evidence from the record
              </span>
              {evidenceOpen ? <CaretUp weight="bold" size={16} color={semantic.warnAmber} /> : <CaretDown weight="bold" size={16} color={semantic.warnAmber} />}
            </button>
            {evidenceOpen && (
              <div className="mt-2.5">
                {f.evidence || f.description ? (
                  <EvidenceQuote
                    text={(f.evidence || f.description) as string}
                    sourceLabel="Source: facility free-text description (FDR field: description)"
                  />
                ) : (
                  <div className="flex items-center gap-2" style={{ fontSize: 13, color: neutral.textFaint, fontStyle: 'italic', padding: '12px 14px' }}>
                    <FileText size={15} />
                    No free-text description was captured for this record.
                  </div>
                )}
              </div>
            )}

            {/* record quality & caveats */}
            <SectionLabel icon={<ShieldWarning weight="fill" size={14} />} color={semantic.warnAmber} mt={26}>
              Record quality &amp; caveats
            </SectionLabel>
            <div className="mt-3 flex items-center gap-2" style={{ fontSize: 13 }}>
              <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, color: dqColor(view.dq) }}>{view.dq}/100</span>
              <span style={{ color: neutral.textFaint }}>record completeness</span>
              {f.possible_entity_dup && (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: semantic.danger, background: semantic.dangerBg, borderRadius: 999, padding: '2px 9px', fontWeight: fonts.weight.semibold }}>
                  <WarningCircle weight="fill" size={12} /> possible duplicate
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {view.flags.map((fl) => (
                <div key={fl.text} className="flex items-center gap-2.5" style={{ fontSize: 13.5, color: neutral.textSoft, fontWeight: fonts.weight.medium }}>
                  <WarningCircle weight="fill" size={16} color={semantic.warnDot} className="shrink-0" />
                  {fl.text}
                </div>
              ))}
            </div>
          </div>

          {/* =================== SIDEBAR =================== */}
          <div style={{ padding: '26px 30px', background: neutral.surfaceWarm }}>
            <SectionLabel icon={null} color={neutral.textFaint2}>At a glance</SectionLabel>
            <div className="mt-3 flex flex-col">
              <GlanceRow label="Bed capacity" value={f.beds != null ? f.beds + ' beds' : 'Unknown'} valueColor={f.beds != null ? neutral.text : semantic.danger} />
              <GlanceRow label="Year established" value={f.year != null ? String(f.year) : 'Unknown'} valueColor={f.year != null ? neutral.text : semantic.danger} />
              <GlanceRow label="Specialties" value={String(f.specialties.length)} valueColor={neutral.text} />
              <GlanceRow label="Record confidence" value={conf + '%'} valueColor={view.fresh.verifiedByUser ? semantic.success : conf >= 80 ? semantic.success : conf >= 60 ? semantic.warn : semantic.danger} last />
            </div>

            {view.needs.length > 0 && (
              <>
                <SectionLabel icon={null} color={neutral.textFaint2} mt={22}>Reported service gaps</SectionLabel>
                <div className="mt-3 flex flex-wrap gap-2">
                  {view.needs.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1.5" style={{ background: semantic.warnBg, color: semantic.warn, borderRadius: 999, padding: '6px 11px', fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5 }}>
                      <MinusCircle size={14} />
                      {n}
                    </span>
                  ))}
                </div>
              </>
            )}

            <div style={{ height: 1, background: neutral.divider, margin: '22px 0' }} />

            {/* Save → shortlist */}
            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={savePending}
              className="w-full"
              style={
                saved
                  ? { background: role.patient.tint, color: role.patient.press, border: `1px solid ${role.patient.border}`, height: 48, fontSize: 15, fontWeight: fonts.weight.bold }
                  : { background: role.patient.base, color: '#fff', border: 'none', height: 48, fontSize: 15, fontWeight: fonts.weight.bold, boxShadow: '0 10px 22px -10px rgba(224,113,76,.7)' }
              }
            >
              <BookmarkSimple weight={saved ? 'fill' : 'bold'} size={18} />
              {saved ? 'Saved to your list' : 'Save this facility'}
            </Button>

            {/* Refer → referrals */}
            <Button
              type="button"
              variant="outline"
              onClick={() => void onRefer()}
              disabled={referPending || referred}
              className="mt-2.5 w-full"
              style={{ color: role.patient.base, borderColor: role.patient.border, height: 46, fontSize: 14.5, fontWeight: fonts.weight.bold }}
            >
              <PaperPlaneTilt weight="fill" size={18} />
              {referred ? 'Referral sent' : 'Refer a patient here'}
            </Button>

            {/* Add to compare (client-side select) */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setInCompare((c) => !c)}
              className="mt-2.5 w-full"
              style={{ color: neutral.textSoft, borderColor: neutral.border, height: 44, fontSize: 14, fontWeight: fonts.weight.bold }}
            >
              <Scales weight="fill" size={17} />
              {inCompare ? 'In comparison' : 'Add to compare'}
            </Button>

            {/* Directions */}
            {view.hasDir && (
              <>
                <a
                  href={view.dirUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 flex w-full items-center justify-center gap-2.5"
                  style={{ color: semantic.info, border: `1.5px solid ${role.hospital.border}`, borderRadius: 13, padding: 12, fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, textDecoration: 'none' }}
                >
                  <NavigationArrow weight="fill" size={17} />
                  Get directions
                </a>
                <div className="mt-2 flex items-center justify-center gap-1.5" style={{ fontSize: 12, color: neutral.textDisabled }}>
                  <Car size={13} />
                  Opens Google Maps driving directions
                </div>
              </>
            )}

            {/* private note → notes */}
            <div className="mt-5 flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13, color: neutral.text }}>
              <NotePencil weight="fill" size={15} color={role.patient.base} />
              Your private note
            </div>
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteSaved(false);
              }}
              onBlur={() => void onNoteBlur()}
              placeholder="e.g. Called — cardiology OPD open Mon/Wed…"
              className="mt-2.5 w-full"
              style={{ minHeight: 88, resize: 'vertical', borderColor: neutral.border, fontSize: 14, color: neutral.text }}
            />
            <div className="mt-1.5 flex items-center gap-1.5" style={{ fontSize: 11.5, color: neutral.textDisabled }}>
              <FloppyDisk size={13} />
              {noteSaved ? 'Note saved to your account.' : 'Notes & saves persist to your account.'}
            </div>

            <div style={{ height: 1, background: neutral.divider, margin: '20px 0' }} />

            {/* record freshness / decay */}
            <SectionLabel icon={<ClockCountdown weight="fill" size={14} />} color={semantic.warn}>Record freshness</SectionLabel>
            <div className="mt-2.5 flex items-center justify-between gap-2" style={{ fontSize: 13, color: neutral.textSoft }}>
              <span>{view.fresh.label}</span>
              {view.fresh.lostPts > 0 && !view.fresh.verifiedByUser && (
                <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 12, color: semantic.danger }}>
                  confidence −{view.fresh.lostPts} from age
                </span>
              )}
            </div>
            {view.fresh.stale && !view.fresh.verifiedByUser && (
              <div className="mt-2.5 flex items-center gap-1.5" style={{ background: semantic.dangerBg, color: semantic.danger, borderRadius: 9, padding: '8px 11px', fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5 }}>
                <Warning weight="fill" size={14} />
                Ageing record — confirm to refresh confidence.
              </div>
            )}

            {/* call to confirm → reviews(via='call') */}
            <div className="mt-4" style={{ background: role.clinician.tint2, border: '1px solid #DCE9E2', borderRadius: 14, padding: '14px 15px' }}>
              <div className="flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13.5, color: neutral.ink }}>
                <PhoneCall weight="fill" size={15} color={semantic.success} />
                Call to confirm
              </div>
              <div className="mt-1" style={{ fontSize: 13, color: neutral.textMuted, fontVariantNumeric: 'tabular-nums' }}>{view.phone}</div>
              <div className="mt-3 flex gap-2">
                <a href={view.telHref} className="inline-flex flex-1 items-center justify-center gap-1.5" style={{ background: semantic.success, color: '#fff', borderRadius: 10, padding: 9, fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13, textDecoration: 'none' }}>
                  <Phone weight="fill" size={14} />
                  Call
                </a>
                <a href={view.waHref} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center gap-1.5" style={{ background: '#fff', color: semantic.success, border: `1px solid ${role.clinician.border}`, borderRadius: 10, padding: 9, fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13, textDecoration: 'none' }}>
                  <WhatsappLogo weight="fill" size={14} />
                  WhatsApp
                </a>
              </div>
              <div className="mt-3" style={{ fontSize: 11.5, color: neutral.textFaint }}>After the call:</div>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void onCall('confirmed')}
                  className="flex-1"
                  style={{ background: callMark === 'confirmed' ? semantic.success : '#fff', color: callMark === 'confirmed' ? '#fff' : semantic.success, border: `1px solid ${role.clinician.border}`, borderRadius: 9, padding: 8, fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5, cursor: 'pointer' }}
                >
                  Reached — confirmed
                </button>
                <button
                  type="button"
                  onClick={() => void onCall('disputed')}
                  className="flex-1"
                  style={{ background: callMark === 'disputed' ? semantic.danger : '#fff', color: callMark === 'disputed' ? '#fff' : semantic.danger, border: '1px solid #F0D9D2', borderRadius: 9, padding: 8, fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12.5, cursor: 'pointer' }}
                >
                  Doesn&apos;t match
                </button>
              </div>
            </div>

            <div style={{ height: 1, background: neutral.divider, margin: '20px 0' }} />

            {/* review & fix → reviews(facility-level) */}
            <SectionLabel icon={<SealCheck weight="fill" size={14} />} color={semantic.success}>Review &amp; fix this record</SectionLabel>
            <div className="mt-3 flex gap-2.5">
              <button
                type="button"
                onClick={() => void reviewFacility('confirmed')}
                className="flex-1 inline-flex items-center justify-center gap-1.5"
                style={{ borderRadius: 11, padding: 11, fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13.5, cursor: 'pointer', ...(facilityMark === 'confirmed' ? { background: semantic.success, color: '#fff', border: `1px solid ${semantic.success}` } : { background: '#fff', color: semantic.success, border: `1.5px solid ${role.clinician.border}` }) }}
              >
                <CheckCircle weight="fill" size={16} />
                Verify
              </button>
              <button
                type="button"
                onClick={() => void reviewFacility('site_visit')}
                className="flex-1 inline-flex items-center justify-center gap-1.5"
                style={{ borderRadius: 11, padding: 11, fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 13.5, cursor: 'pointer', ...(facilityMark === 'site_visit' ? { background: semantic.danger, color: '#fff', border: `1px solid ${semantic.danger}` } : { background: '#fff', color: semantic.danger, border: '1.5px solid #F0D9D2' }) }}
              >
                <Flag weight="fill" size={16} />
                Site visit
              </button>
            </div>
            {facilityMark && (
              <div
                className="mt-3 flex items-center gap-2"
                style={{ borderRadius: 10, padding: '9px 12px', fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 13, ...(facilityMark === 'confirmed' ? { background: semantic.successBg, color: semantic.success } : { background: semantic.dangerBg, color: semantic.danger }) }}
              >
                <Info weight="fill" size={15} />
                {facilityMark === 'confirmed' ? 'You verified this facility' : 'You flagged this for a site visit'}
              </div>
            )}
            {(f.year == null || f.beds == null) && (
              <div className="mt-3" style={{ fontSize: 12.5, color: neutral.textFaint }}>
                <Gauge size={13} className="mr-1 inline" />
                {[f.year == null ? 'year established' : null, f.beds == null ? 'bed capacity' : null].filter(Boolean).join(' & ')} missing — confirm on a site visit to fill the gap.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* keep refetch reachable for verify/dispute callers that change the public record */}
      <button type="button" onClick={refetch} aria-hidden className="sr-only">refresh</button>
    </div>
  );
}

// Sidebar "At a glance" key/value row.
function GlanceRow({ label, value, valueColor, last }: { label: string; value: string; valueColor: string; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: '11px 0', borderBottom: last ? 'none' : `1px solid ${neutral.divider2}` }}
    >
      <span style={{ fontSize: 14, color: neutral.textSoft }}>{label}</span>
      <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, color: valueColor }}>{value}</span>
    </div>
  );
}

export default FacilityDetail;

// Silence "unused" for theme tokens kept for parity/readability.
void trustTheme;
void cn;
