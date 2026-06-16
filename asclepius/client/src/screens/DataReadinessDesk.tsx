import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Input, Button, Skeleton } from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  ArrowRight,
  Database,
  Gauge,
  MapTrifold,
  ListChecks,
  Phone,
  EnvelopeSimple,
  Globe,
  FacebookLogo,
  WarningOctagon,
  Copy,
  SealQuestion,
  MapPinLine,
  AddressBook,
  Stack,
  Star,
  PencilSimple,
  Flag,
  XCircle,
  CheckCircle,
  Lightning,
  CaretDown,
} from '@phosphor-icons/react';
import {
  useReadinessSummary,
  useReadinessGaps,
  useReadinessDistricts,
  useReadinessSparseFields,
  useReadinessFacility,
  saveReadinessAction,
  type ReadinessGapRow,
  type ReadinessDistrictRow,
} from '@/lib/api';
import { KpiTile, ConfidenceChip, EvidenceQuote } from '@/components/asclepius';
import type { ConfidenceLevel } from '@/components/asclepius/theme';
import { fonts, neutral, role as roleTheme, semantic } from '@/components/asclepius/theme';

/* ============================================================================
   Data Readiness Desk (/readiness) — Track 4.
   "What must be fixed before this dataset can be trusted for planning?"
   Reads readiness.{readiness_gap_items,data_readiness,gold_district_supply_need}
   (Lakebase). A non-technical reviewer picks a gap section, gets a rule-based
   suggested next step per record, and patches/flags/dismisses with buttons that
   persist to app.{user_review_actions,overrides,notes,dup_decisions}.
   Signature view: data-poor vs real gaps (district roll-up x corrected desert).
   ============================================================================ */

const HOSP = roleTheme.hospital.base;
const CLIN = roleTheme.clinician.base;

type DeskView = 'queue' | 'districts';

// gap_type → presentation (label, accent, icon).
const GAP_META: Record<string, { label: string; color: string; Icon: typeof Gauge }> = {
  corrupted: { label: 'Corrupted', color: '#8B2E1F', Icon: WarningOctagon },
  flagged_quality: { label: 'Flagged quality', color: '#B2503C', Icon: WarningOctagon },
  possible_duplicate: { label: 'Possible duplicate', color: '#9A6A12', Icon: Copy },
  unverified_claims: { label: 'Unverified claims', color: '#857B6C', Icon: SealQuestion },
  missing_coords: { label: 'Missing coordinates', color: '#3B6FB0', Icon: MapPinLine },
  missing_contact: { label: 'Missing contact', color: '#2E7D67', Icon: AddressBook },
  sparse_fields: { label: 'Sparse fields', color: '#857B6C', Icon: Stack },
};
const GAP_ORDER = [
  'corrupted',
  'flagged_quality',
  'possible_duplicate',
  'unverified_claims',
  'missing_coords',
  'missing_contact',
  'sparse_fields',
];

// Friendly display labels for the dynamic sparse-field facets the pipeline emits
// (the chip list itself comes from /api/data/readiness/sparse-fields, so new
// fields appear automatically). Unknown tokens fall back to a Title-cased label.
const SPARSE_FIELD_LABELS: Record<string, string> = {
  capability: 'Capability',
  procedure: 'Procedure',
  equipment: 'Equipment',
  beds: 'Beds / capacity',
  year: 'Year established',
  specialties: 'Specialties',
};
const sparseFieldLabel = (f: string): string =>
  SPARSE_FIELD_LABELS[f] ?? f.charAt(0).toUpperCase() + f.slice(1);

function gapMeta(t: string) {
  return GAP_META[t] ?? { label: t, color: neutral.textMuted, Icon: Gauge };
}

function confLevel(dc: number): ConfidenceLevel {
  if (dc >= 0.8) return 'high';
  if (dc >= 0.6) return 'medium';
  if (dc >= 0.4) return 'low';
  return 'none';
}

// Reach-out affordance for the best contact channel.
function channelAffordance(channel: string | null, value: string | null) {
  if (!value) return null;
  switch (channel) {
    case 'phone':
      return { href: `tel:${value}`, label: value, Icon: Phone };
    case 'email':
      return { href: `mailto:${value}`, label: value, Icon: EnvelopeSimple };
    case 'website':
      return { href: value.startsWith('http') ? value : `https://${value}`, label: 'Open website', Icon: Globe };
    case 'facebook':
      return { href: value.startsWith('http') ? value : `https://${value}`, label: 'Open page', Icon: FacebookLogo };
    default:
      return null;
  }
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: neutral.textMuted, bg: '#F1ECE3' },
  patched: { label: 'Patched', color: '#2E7D67', bg: '#E4EFEA' },
  flagged: { label: 'Flagged', color: '#9A6A12', bg: '#F6EBD6' },
  dismissed: { label: 'Dismissed', color: neutral.textFaint2, bg: '#EEE9DF' },
};

const DISTRICT_LABEL: Record<string, { label: string; color: string; bg: string; blurb: string }> = {
  real_gap: { label: 'Real gap', color: '#B2503C', bg: '#F6E2DC', blurb: 'Low supply, trustworthy data — act.' },
  data_poor: { label: 'Data-poor', color: '#9A6A12', bg: '#F6EBD6', blurb: 'Low supply but low-confidence data — investigate first.' },
  unknown_supply: { label: 'Unknown supply', color: '#857B6C', bg: '#EEE9DF', blurb: '0 mapped facilities — join gap, not a proven desert.' },
  adequate: { label: 'Adequate', color: '#2E7D67', bg: '#E4EFEA', blurb: 'No supply emergency on current data.' },
};

/* ---- corrupted / column-shifted name detection ----------------------------
   A few dozen FDR rows are column-shifted, so their `facility_name` holds a
   JSON array, a coordinates blob, or a run-on specialty token instead of a real
   name. Surface those as a clear flag rather than printing the garbage. */
function looksCorruptedName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (/^[[{"']/.test(n)) return true; // starts with [ { " '
  if (/"coordinates"|"type"\s*:/i.test(n)) return true; // coordinates / geo struct
  // single run-on token (no spaces), all letters, long → a leaked specialty
  // token e.g. "internalmedicine" / "cataractAndAnteriorSegmentSurgery".
  if (!/\s/.test(n) && /^[A-Za-z]+$/.test(n) && n.length >= 14) return true;
  return false;
}
const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 8)}…` : id);

/* ---- segmented view tabs -------------------------------------------------- */
function ViewTabs({ view, onView }: { view: DeskView; onView: (v: DeskView) => void }) {
  const TABS: { key: DeskView; label: string; Icon: typeof ListChecks }[] = [
    { key: 'queue', label: 'Work queue', Icon: ListChecks },
    { key: 'districts', label: 'Data-poor vs real gaps', Icon: MapTrifold },
  ];
  return (
    <div className="flex gap-1 rounded-[13px] p-[5px]" style={{ background: '#F1EBE1' }}>
      {TABS.map(({ key, label, Icon }) => {
        const active = view === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onView(key)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-[15px] py-[9px]"
            style={{
              fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', border: 'none',
              background: active ? '#fff' : 'transparent', color: active ? HOSP : neutral.textFaint,
              boxShadow: active ? '0 2px 6px rgba(43,39,34,.1)' : 'none',
            }}
          >
            <Icon weight="fill" size={15} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ---- lazily-fetched cited claim evidence (unverified_claims cards) ---------
   Mounted ONLY when a card is expanded, so we fetch one facility's bundle on
   demand (no N requests up front). Calls useReadinessFacility at its own top
   level — never inside the queue's .map() — to respect rules-of-hooks. The
   server already orders evidence corroboration='none' first, so the first row
   with a non-empty snippet is the most-relevant uncorroborated claim text. */
function ClaimEvidence({ uniqueId }: { uniqueId: string }) {
  const { data, loading } = useReadinessFacility(uniqueId);
  if (loading) {
    return <Skeleton className="mt-2.5 h-[72px] rounded-[11px]" />;
  }
  const snippet = (data?.evidence ?? [])
    .map((e) => (e.evidence_snippet ?? '').trim())
    .find((s) => s.length > 0);
  if (!snippet) {
    return (
      <div className="mt-2.5" style={{ fontSize: 12, color: neutral.textFaint2, fontStyle: 'italic' }}>
        No cited claim text available.
      </div>
    );
  }
  return (
    <div className="mt-2.5">
      <EvidenceQuote text={snippet} sourceLabel="Facility-reported claim · not yet corroborated" />
    </div>
  );
}

/* ---- one record card in the reviewer queue -------------------------------- */
function GapCard({
  row,
  status,
  onAction,
}: {
  row: ReadinessGapRow;
  status: string;
  onAction: (input: { action: 'patch' | 'flag' | 'dismiss'; field?: string; new_value?: string }) => void;
}) {
  const navigate = useNavigate();
  const meta = gapMeta(row.gap_type);
  const corrupted = looksCorruptedName(row.facility_name);
  const chan = channelAffordance(row.contact_channel, row.contact_value);
  const firstField = (row.missing_fields ?? '').split(',')[0]?.trim() || 'field';
  const [patching, setPatching] = useState(false);
  const [field, setField] = useState(firstField);
  const [value, setValue] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const st = STATUS_META[status] ?? STATUS_META.open;
  const resolved = status === 'patched' || status === 'dismissed';

  return (
    <div
      className="rounded-[16px] p-[15px]"
      style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, opacity: resolved ? 0.72 : 1 }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-[11px]">
          <span
            className="flex shrink-0 items-center justify-center rounded-[10px]"
            style={{ width: 36, height: 36, background: `${meta.color}1a`, color: meta.color }}
          >
            <meta.Icon weight="fill" size={18} />
          </span>
          <div className="min-w-0">
            {corrupted ? (
              <div className="flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: '#9A6A12' }}>
                <WarningOctagon weight="fill" size={14} style={{ flexShrink: 0 }} />
                <span className="truncate">Unreadable name — column-shifted record</span>
              </div>
            ) : (
              <div className="truncate" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>
                {row.facility_name}
              </div>
            )}
            <div style={{ fontSize: 12, color: neutral.textFaint2, fontWeight: 500 }}>
              {corrupted
                ? `id ${shortId(row.unique_id)} · name field holds non-name data`
                : [row.district, row.state].filter(Boolean).join(', ') || '—'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ConfidenceChip level={confLevel(row.data_confidence)} label={`${Math.round(row.data_confidence * 100)}% data conf`} />
          {row.high_leverage && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{ background: '#FBE8E0', color: '#C0552F', fontFamily: fonts.body, fontWeight: 700, fontSize: 11 }}
            >
              <Star weight="fill" size={11} /> High-leverage
            </span>
          )}
        </div>
      </div>

      {/* cited field + suggested action */}
      <div className="mt-3 rounded-[12px] p-3" style={{ background: '#FBF8F3', border: `1px solid ${neutral.divider2}` }}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-[5px] rounded-full px-[9px] py-1"
            style={{ background: `${meta.color}1a`, color: meta.color, fontFamily: fonts.body, fontWeight: 700, fontSize: 11.5 }}
          >
            <meta.Icon weight="fill" size={12} /> {meta.label}
          </span>
          <span style={{ fontSize: 12, color: neutral.textFaint2 }}>cites</span>
          <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, color: neutral.textMuted }}>
            {row.missing_fields ?? '—'}
          </span>
        </div>
        <div className="mt-2 flex items-start gap-1.5" style={{ fontSize: 13.5, color: neutral.text, lineHeight: 1.45 }}>
          <Lightning weight="fill" size={15} style={{ color: semantic.warn, marginTop: 2, flexShrink: 0 }} />
          <span><b style={{ fontWeight: 700 }}>Suggested:</b> {row.suggested_action}</span>
        </div>

        {/* unverified-claims: reveal the verbatim cited facility text (lazy fetch) */}
        {row.gap_type === 'unverified_claims' && (
          <>
            <button
              type="button"
              onClick={() => setEvidenceOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-1 bg-transparent p-0"
              style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, color: meta.color, border: 'none', cursor: 'pointer' }}
            >
              <CaretDown weight="bold" size={12} style={{ transform: evidenceOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }} />
              {evidenceOpen ? 'Hide cited evidence' : 'Show cited evidence'}
            </button>
            {evidenceOpen && <ClaimEvidence uniqueId={row.unique_id} />}
          </>
        )}
      </div>

      {/* reach-out + actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chan && (
          <a
            href={chan.href}
            target={row.contact_channel === 'website' || row.contact_channel === 'facebook' ? '_blank' : undefined}
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
            style={{ background: roleTheme.clinician.tint, color: CLIN, border: `1px solid ${roleTheme.clinician.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}
          >
            <chan.Icon weight="fill" size={14} /> {chan.label.length > 26 ? `${chan.label.slice(0, 26)}…` : chan.label}
          </a>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="rounded-full px-2.5 py-1"
            style={{ background: st.bg, color: st.color, fontFamily: fonts.body, fontWeight: 700, fontSize: 11.5 }}
          >
            {st.label}
          </span>
          {row.gap_type === 'possible_duplicate' && (
            <button type="button" onClick={() => onAction({ action: 'patch', field: 'possible_entity_dup', new_value: 'merged' })}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
              style={{ background: '#fff', color: HOSP, border: `1px solid ${roleTheme.hospital.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              Merge
            </button>
          )}
          {row.gap_type !== 'possible_duplicate' && (
            <button type="button" onClick={() => setPatching((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
              style={{ background: '#fff', color: HOSP, border: `1px solid ${roleTheme.hospital.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              <PencilSimple weight="fill" size={14} /> Patch
            </button>
          )}
          <button type="button" onClick={() => onAction({ action: 'flag' })}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
            style={{ background: '#fff', color: '#9A6A12', border: '1px solid #E7D9B6', fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
            <Flag weight="fill" size={14} /> Flag
          </button>
          <button type="button" onClick={() => onAction({ action: 'dismiss' })}
            title="Dismiss — not an issue"
            className="inline-flex items-center justify-center rounded-[10px]"
            style={{ width: 34, height: 34, background: '#fff', color: neutral.textFaint2, border: `1px solid ${neutral.border}`, cursor: 'pointer' }}>
            <XCircle weight="fill" size={16} />
          </button>
        </div>
      </div>

      {/* inline patch editor (cites the field being changed) */}
      {patching && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[12px] p-3" style={{ background: '#FCFAF6', border: `1px dashed ${neutral.border2}` }}>
          <div className="flex flex-col gap-1">
            <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 11, color: neutral.textDisabled, textTransform: 'uppercase', letterSpacing: '.05em' }}>Field</span>
            <Input value={field} onChange={(e) => setField(e.target.value)} className="h-9 w-[180px]" style={{ fontSize: 13 }} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 11, color: neutral.textDisabled, textTransform: 'uppercase', letterSpacing: '.05em' }}>New value (cited patch)</span>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. confirmed phone, geocoded lat/lng…" className="h-9" style={{ fontSize: 13 }} />
          </div>
          <Button
            onClick={() => { onAction({ action: 'patch', field: field.trim(), new_value: value.trim() }); setPatching(false); setValue(''); }}
            disabled={!field.trim() || !value.trim()}
            className="h-9"
            style={{ background: HOSP, color: '#fff' }}
          >
            Save patch
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void navigate(`/facility/${row.unique_id}`)}
        className="mt-2.5 inline-flex items-center gap-1.5 bg-transparent p-0"
        style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, color: neutral.textSoft, border: 'none', cursor: 'pointer' }}
      >
        Open full record & evidence <ArrowRight weight="bold" size={13} />
      </button>
    </div>
  );
}

/* ---- district roll-up card (data-poor vs real gap) ------------------------ */
function DistrictRow({ d }: { d: ReadinessDistrictRow }) {
  const lab = DISTRICT_LABEL[d.gap_label] ?? DISTRICT_LABEL.adequate;
  return (
    <div className="flex items-center gap-3 rounded-[14px] p-[14px]" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>{d.district}</span>
          <span style={{ fontSize: 12, color: neutral.textFaint2 }}>{d.state}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1" style={{ fontSize: 12, color: neutral.textMuted }}>
          <span>{d.facility_count ?? 0} mapped facilities</span>
          <span>desert {d.desert_score != null ? Math.round(d.desert_score) : '—'}</span>
          {d.avg_confidence != null ? (
            <span className="inline-flex items-center gap-1">
              data conf
              <ConfidenceChip level={confLevel(d.avg_confidence)} label={`${Math.round(d.avg_confidence * 100)}%`} />
            </span>
          ) : (
            <span style={{ color: '#9A6A12', fontWeight: 600 }}>no mapped facilities — supply unknown</span>
          )}
        </div>
      </div>
      <span
        className="shrink-0 rounded-full px-3 py-1.5 text-center"
        style={{ background: lab.bg, color: lab.color, fontFamily: fonts.body, fontWeight: 700, fontSize: 12, maxWidth: 220 }}
        title={lab.blurb}
      >
        {lab.label}
      </span>
    </div>
  );
}

export function DataReadinessDesk() {
  const [view, setView] = useState<DeskView>('queue');
  const [section, setSection] = useState<string>('all');
  // Sparse-field sub-filter (OR-matched; only applied on the sparse_fields section).
  const [sparseFields, setSparseFields] = useState<string[]>([]);
  const [highOnly, setHighOnly] = useState(false);
  const [q, setQ] = useState('');
  const [districtFilter, setDistrictFilter] = useState<string>('real_gap');
  // Optimistic action overlay: gap_id -> new status.
  const [acted, setActed] = useState<Record<string, string>>({});

  const summary = useReadinessSummary();
  const gaps = useReadinessGaps({
    gap_type: section === 'all' ? undefined : section,
    q: q.trim() || undefined,
    high_leverage: highOnly || undefined,
    fields: section === 'sparse_fields' && sparseFields.length ? sparseFields.join(',') : undefined,
    limit: 80,
  });
  const districts = useReadinessDistricts(150);
  const sparseFacets = useReadinessSparseFields();

  // Switching sections resets the sparse-field sub-filter so it never silently
  // narrows another section's queue.
  const pickSection = (gt: string) => {
    setSection(gt);
    setSparseFields([]);
  };
  const toggleSparseField = (k: string) =>
    setSparseFields((prev) => (prev.includes(k) ? prev.filter((f) => f !== k) : [...prev, k]));

  const byGap = useMemo(() => {
    const m: Record<string, { n: number; high_leverage: number }> = {};
    for (const g of summary.data?.by_gap ?? []) m[g.gap_type] = { n: g.n, high_leverage: g.high_leverage };
    return m;
  }, [summary.data]);

  async function runAction(
    row: ReadinessGapRow,
    input: { action: 'patch' | 'flag' | 'dismiss'; field?: string; new_value?: string },
  ) {
    const optimistic = input.action === 'patch' ? 'patched' : input.action === 'flag' ? 'flagged' : 'dismissed';
    setActed((p) => ({ ...p, [row.gap_id]: optimistic }));
    try {
      await saveReadinessAction({
        action: input.action,
        unique_id: row.unique_id,
        gap_id: row.gap_id,
        gap_type: row.gap_type,
        field: input.field,
        new_value: input.new_value,
        issue_description: input.action === 'flag' ? `${row.gap_type}: ${row.missing_fields ?? ''}` : undefined,
      });
    } catch {
      // revert on failure
      setActed((p) => {
        const next = { ...p };
        delete next[row.gap_id];
        return next;
      });
    }
  }

  const s = summary.data?.summary;
  const districtRows = districts.data ?? [];
  const realGaps = districtRows.filter((d) => d.gap_label === 'real_gap').length;
  const dataPoor = districtRows.filter((d) => d.gap_label === 'data_poor').length;
  const unknown = districtRows.filter((d) => d.gap_label === 'unknown_supply').length;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-[30px] pb-20 pt-6" style={{ animation: 'ascFade .45s ease both' }}>
      <Button asChild variant="ghost" className="mb-1 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/"><ArrowLeft weight="bold" size={15} /> Back</Link>
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', color: neutral.ink, margin: 0 }}>
            Data Readiness Desk
          </h2>
          <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>
            What must be fixed before this dataset can be trusted for planning? Work the queue, then separate data-poor districts from real gaps.
          </p>
        </div>
        <ViewTabs view={view} onView={setView} />
      </div>

      {/* KPI row */}
      <div className="mt-5 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {summary.loading || !s ? (
          ['k1', 'k2', 'k3', 'k4'].map((k) => <Skeleton key={k} className="h-[86px] rounded-[16px]" />)
        ) : (
          <>
            <KpiTile value={s.total_facilities.toLocaleString()} label="Facilities" hint={`${s.clean_facilities.toLocaleString()} fully clean`} accent="hospital" />
            <KpiTile value={s.total_gaps.toLocaleString()} label="Open gaps in queue" accent="ink" />
            <KpiTile value={s.high_leverage.toLocaleString()} label="High-leverage gaps" hint="join-gap + reachable flags" accent="danger" />
            <KpiTile value={`${Math.round((s.avg_confidence ?? 0) * 100)}%`} label="Avg data confidence" accent="clinician" />
          </>
        )}
      </div>

      {view === 'queue' ? (
        <>
          {/* section selector */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <SectionChip label="All gaps" count={s?.total_gaps} active={section === 'all'} color={neutral.ink} onPick={() => pickSection('all')} />
            {GAP_ORDER.map((gt) => {
              const meta = gapMeta(gt);
              return (
                <SectionChip
                  key={gt}
                  label={meta.label}
                  count={byGap[gt]?.n}
                  active={section === gt}
                  color={meta.color}
                  onPick={() => pickSection(gt)}
                />
              );
            })}
          </div>

          {section === 'sparse_fields' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, color: neutral.textFaint2 }}>
                Filter by sparse field
              </span>
              {(sparseFacets.data ?? []).map(({ field, n }) => {
                const active = sparseFields.includes(field);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => toggleSparseField(field)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                    style={{
                      fontFamily: fonts.body,
                      fontWeight: active ? 700 : 600,
                      fontSize: 12.5,
                      cursor: 'pointer',
                      border: `1px solid ${active ? HOSP : neutral.border}`,
                      background: active ? `${HOSP}1a` : '#fff',
                      color: active ? HOSP : neutral.textMuted,
                    }}
                  >
                    {sparseFieldLabel(field)}
                    <span style={{ fontWeight: 700, fontSize: 11.5, color: active ? HOSP : neutral.textFaint2 }}>
                      {n.toLocaleString()}
                    </span>
                  </button>
                );
              })}
              {sparseFields.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSparseFields([])}
                  className="inline-flex items-center rounded-full px-2.5 py-1.5"
                  style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: neutral.textFaint2 }}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <div className="flex flex-1 items-center gap-2 rounded-[12px] px-3 py-1.5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, minWidth: 220 }}>
              <Database size={15} style={{ color: neutral.textFaint2 }} />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by facility name…" className="border-none bg-transparent px-0 shadow-none focus-visible:ring-0" style={{ fontSize: 14 }} />
            </div>
            <button
              type="button"
              onClick={() => setHighOnly((h) => !h)}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
              style={{
                background: highOnly ? '#FBE8E0' : '#fff', color: highOnly ? '#C0552F' : neutral.textMuted,
                border: `1px solid ${highOnly ? '#F0C8B8' : neutral.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              <Star weight="fill" size={14} /> High-leverage only
            </button>
          </div>

          {/* queue */}
          {gaps.error ? (
            <div className="mt-4" style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>Couldn’t load the queue — {gaps.error}</div>
          ) : gaps.loading ? (
            <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              {['g1', 'g2', 'g3', 'g4'].map((k) => <Skeleton key={k} className="h-[210px] rounded-[16px]" />)}
            </div>
          ) : (gaps.data ?? []).length === 0 ? (
            <div className="mt-5 rounded-[18px] p-10 text-center" style={{ background: '#fff', border: `1px dashed ${neutral.borderDashed ?? neutral.border}` }}>
              <CheckCircle weight="fill" size={30} style={{ color: '#9CC3B5' }} />
              <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 16, color: neutral.textMuted, marginTop: 8 }}>No gaps in this section</div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              {(gaps.data ?? []).map((row) => (
                <GapCard
                  key={row.gap_id}
                  row={row}
                  status={acted[row.gap_id] ?? row.status ?? 'open'}
                  onAction={(input) => void runAction(row, input)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* district legend — click a card to filter the list below */}
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <LegendCard kind="real_gap" count={realGaps} active={districtFilter === 'real_gap'} onPick={() => setDistrictFilter('real_gap')} />
            <LegendCard kind="data_poor" count={dataPoor} active={districtFilter === 'data_poor'} onPick={() => setDistrictFilter('data_poor')} />
            <LegendCard kind="unknown_supply" count={unknown} active={districtFilter === 'unknown_supply'} onPick={() => setDistrictFilter('unknown_supply')} />
          </div>
          <p className="mt-3 px-1" style={{ fontSize: 13, color: neutral.textSoft }}>
            District readiness = average facility data-confidence, crossed with the corrected desert score. A <b>real gap</b> is low supply on
            data we trust; a <b>data-poor</b> district looks empty mainly because its records are weak; an <b>unknown-supply</b> district has
            <b> zero mapped facilities</b> — a pincode/crosswalk gap the naive map mistook for a desert. Fix the data before you act.
          </p>

          {districts.error ? (
            <div className="mt-4" style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>Couldn’t load districts — {districts.error}</div>
          ) : districts.loading ? (
            <div className="mt-4 flex flex-col gap-2.5">
              {['d1', 'd2', 'd3', 'd4', 'd5'].map((k) => <Skeleton key={k} className="h-[66px] rounded-[14px]" />)}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5">
              {districtRows.filter((d) => d.gap_label === districtFilter).slice(0, 60).map((d) => (
                <DistrictRow key={`${d.state}::${d.district}`} d={d} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="mt-6 flex items-center gap-1.5 px-1" style={{ fontSize: 12, color: neutral.textDisabled }}>
        <Database size={13} />
        Reading readiness.* (Lakebase) · patches → app.overrides, flags → app.user_review_actions, dedupe → app.dup_decisions. Every action cites the field it changes.
      </p>
    </div>
  );
}

/* ---- helper chips --------------------------------------------------------- */
function SectionChip({ label, count, active, color, onPick }: { label: string; count?: number; active: boolean; color: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
      style={{
        fontFamily: fonts.body, fontWeight: active ? 700 : 600, fontSize: 12.5, cursor: 'pointer',
        border: `1px solid ${active ? color : neutral.border}`, background: active ? `${color}1a` : '#fff', color: active ? color : neutral.textMuted,
      }}
    >
      {label}
      {count != null && (
        <span style={{ fontWeight: 700, fontSize: 11.5, color: active ? color : neutral.textFaint2 }}>{count.toLocaleString()}</span>
      )}
    </button>
  );
}

function LegendCard({ kind, count, active, onPick }: { kind: string; count: number; active: boolean; onPick: () => void }) {
  const lab = DISTRICT_LABEL[kind];
  return (
    <button
      type="button"
      onClick={onPick}
      className="rounded-[14px] p-4 text-left"
      style={{
        background: active ? lab.bg : '#fff',
        border: `1.5px solid ${active ? lab.color : neutral.borderCard}`,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full px-2.5 py-1" style={{ background: lab.bg, color: lab.color, fontFamily: fonts.body, fontWeight: 700, fontSize: 12 }}>{lab.label}</span>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, color: lab.color }}>{count}</span>
      </div>
      <p style={{ fontSize: 12.5, color: neutral.textMuted, margin: '8px 0 0', lineHeight: 1.45 }}>{lab.blurb}</p>
    </button>
  );
}

export default DataReadinessDesk;
