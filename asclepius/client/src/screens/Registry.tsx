import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Input,
  Button,
  Skeleton,
} from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  MagnifyingGlass,
  Gauge,
  Copy,
  WarningOctagon,
  WarningCircle,
  DownloadSimple,
  GitMerge,
  Check,
  ArrowRight,
  CheckCircle,
  Database,
  BellSimpleRinging,
  Microphone,
  BookmarkSimple,
  X,
} from '@phosphor-icons/react';
import {
  useSearchFacilities,
  useFacilityKpis,
  type FacilityRow,
} from '@/lib/api';
import { FacilityCard } from '@/components/asclepius';
import { fonts, neutral, role as roleTheme, semantic, trust as trustTheme } from '@/components/asclepius/theme';
import {
  toCardFacility,
  dqOf,
  dqColor,
  coverageColor,
  normalizeTrust,
} from './registryShared';
import { usePlanner } from '@/lib/persona';

/* ============================================================================
   Registry (/registry) — three tabs: Browse · Data quality · Duplicates.
   Reads app_read.facilities via useSearchFacilities; the data-quality queue
   links each record to its Facility detail screen ("Open & fix") where
   confirmations are written. Matches Asclepius.dc.html §Registry.
   ============================================================================ */

const HOSPITAL = roleTheme.hospital.base; // registry chrome accent
const CLINICIAN = roleTheme.clinician.base;

type RegTab = 'browse' | 'quality' | 'dupes';
type TrustFilter = 'All' | 'verified' | 'review' | 'unverified';

// The field-coverage canon (REGFIELDS) — % of records expected to carry each.
const REGFIELDS: { key: keyof FacilityRow; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'capability', label: 'Capability' },
  { key: 'procedure', label: 'Procedure' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'beds', label: 'Capacity' },
  { key: 'year', label: 'Year established' },
];

const TABS: { key: RegTab; label: string; Icon: typeof MagnifyingGlass }[] = [
  { key: 'browse', label: 'Browse', Icon: MagnifyingGlass },
  { key: 'quality', label: 'Data quality', Icon: Gauge },
  { key: 'dupes', label: 'Duplicates', Icon: Copy },
];

/* ---- segmented pill tabs (matches the prototype's #F1EBE1 plate) ---------- */
function TabBar({ tab, onTab }: { tab: RegTab; onTab: (t: RegTab) => void }) {
  return (
    <div className="flex gap-1 rounded-[13px] p-[5px]" style={{ background: '#F1EBE1' }}>
      {TABS.map(({ key, label, Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTab(key)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-[15px] py-[9px]"
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: 13.5,
              cursor: 'pointer',
              border: 'none',
              background: active ? '#fff' : 'transparent',
              color: active ? CLINICIAN : neutral.textFaint,
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

/* ---- small filter chip ---------------------------------------------------- */
function MiniChip({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="rounded-full px-3 py-1.5"
      style={{
        fontFamily: fonts.body,
        fontWeight: selected ? 600 : 500,
        fontSize: 12.5,
        cursor: 'pointer',
        border: `1px solid ${selected ? CLINICIAN : neutral.border}`,
        background: selected ? `${CLINICIAN}1a` : '#fff',
        color: selected ? CLINICIAN : neutral.textMuted,
      }}
    >
      {label}
    </button>
  );
}

function ChipFilterRow({
  label,
  options,
  value,
  onChange,
  display,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  display?: (v: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      <span
        className="uppercase"
        style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 11.5, letterSpacing: '.05em', color: neutral.textDisabled, width: 48 }}
      >
        {label}
      </span>
      {options.map((o) => (
        <MiniChip key={o} label={display ? display(o) : o} selected={value === o} onPick={() => onChange(o)} />
      ))}
    </div>
  );
}

function EmptyState({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
  return (
    <div
      className="mt-[18px] rounded-[18px] p-10 text-center"
      style={{ background: '#fff', border: `1px dashed ${neutral.borderDashed}`, color: neutral.textFaint2 }}
    >
      <span style={{ color, fontSize: 32 }} className="inline-flex">{icon}</span>
      <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 16, color: neutral.textMuted, marginTop: 10 }}>{title}</div>
    </div>
  );
}

export function Registry() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<RegTab>('browse');

  // Data quality + Duplicates are data-steward functions (review/resolve facility
  // records), which belong to the Medical Planner persona that owns the Data
  // Readiness Desk. Patient / Doctor / Hospital personas get the Browse tab only.
  // `activeTab` collapses to Browse the moment the planner persona is dropped, so
  // a non-planner can never land on a hidden tab (e.g. after a persona switch).
  const planner = usePlanner();
  const activeTab: RegTab = planner ? tab : 'browse';

  // Browse filters (Browse tab queries the server; quality/dupes scan a wide page).
  const [q, setQ] = useState('');
  const [state, setState] = useState('All');
  const [type, setType] = useState('All');
  const [trustFilter, setTrustFilter] = useState<TrustFilter>('All');

  // Local dup decisions (Merge / Keep) — overrides table not in the read contract.
  const [dupDecisions, setDupDecisions] = useState<Record<string, 'merged' | 'distinct'>>({});
  // Saved searches (local, this-device only — mirrors the prototype's saved-search chips).
  const [savedSearches, setSavedSearches] = useState<{ id: string; name: string }[]>([]);

  const kpis = useFacilityKpis();

  // Browse: server-side filtered slice (≤60, matches the prototype cap).
  const browse = useSearchFacilities({
    q: q.trim() || undefined,
    state: state === 'All' ? undefined : state,
    specialty: undefined,
    trust: trustFilter === 'All' ? undefined : trustFilter,
    limit: 60,
  });

  // Quality + Duplicates audit over a wide unfiltered page.
  const audit = useSearchFacilities({ limit: 600 });

  const browseRows = useMemo(
    () => (browse.data ?? []).filter((f) => (type === 'All' ? true : f.type === type)),
    [browse.data, type],
  );

  // Distinct chip option lists from the audit page (stable, not the filtered slice).
  const stateOptions = useMemo(
    () => ['All', ...Array.from(new Set((audit.data ?? []).map((f) => f.state).filter((s): s is string => !!s))).sort()],
    [audit.data],
  );
  const typeOptions = useMemo(
    () => ['All', ...Array.from(new Set((audit.data ?? []).map((f) => f.type).filter((t): t is string => !!t)))],
    [audit.data],
  );

  // ---- Data quality derived ----
  const qualityData = useMemo(() => {
    const all = audit.data ?? [];
    if (all.length === 0) return null;
    const fields = REGFIELDS.map((fl) => {
      const present = all.filter((f) => {
        const v = f[fl.key];
        return v != null && v !== '';
      }).length;
      const pct = Math.round((100 * present) / all.length);
      return { label: fl.label, pct };
    });
    const scored = all.map((f) => ({ f, dq: dqOf(f) }));
    const overall = Math.round(scored.reduce((a, b) => a + b.dq.score, 0) / scored.length);
    const queue = scored.filter((x) => x.dq.score < 70).sort((a, b) => a.dq.score - b.dq.score);
    return { fields, overall, queue, queueCount: queue.length };
  }, [audit.data]);

  // ---- Duplicate pairs (possible_entity_dup === true) ----
  const dupRows = useMemo(
    () => (audit.data ?? []).filter((f) => f.possible_entity_dup),
    [audit.data],
  );
  const dupOpenCount = dupRows.filter((f) => !dupDecisions[f.id]).length;

  function saveSearch() {
    const trimmed = q.trim();
    const parts = [
      trimmed,
      state === 'All' ? null : state,
      type === 'All' ? null : type,
      trustFilter === 'All' ? null : trustTheme[normalizeTrust(trustFilter)].label,
    ].filter((p): p is string => !!p);
    const name = parts.length ? parts.join(' · ') : 'All facilities';
    const id = `${name}::${browseRows.length}`;
    setSavedSearches((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, { id, name }]));
  }

  function removeSavedSearch(id: string) {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  }

  function resolveDup(id: string, decision: 'merged' | 'distinct') {
    setDupDecisions((prev) => {
      const next = { ...prev };
      if (next[id] === decision) delete next[id];
      else next[id] = decision;
      return next;
    });
  }

  function exportFixList() {
    const all = audit.data ?? [];
    const header = ['name', 'type', 'city', 'state', 'data_quality', 'issues'];
    const rows: string[][] = [header];
    all
      .map((f) => ({ f, dq: dqOf(f) }))
      .filter((x) => x.dq.score < 70)
      .sort((a, b) => a.dq.score - b.dq.score)
      .forEach((x) => {
        rows.push([
          x.f.name,
          x.f.type ?? '',
          x.f.city ?? '',
          x.f.state ?? '',
          String(x.dq.score),
          x.dq.issues.map((i) => i.t).join('; '),
        ]);
      });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'asclepius-review-list.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* no-op in non-browser contexts */
    }
  }

  const regTotal = kpis.data?.total_facilities ?? (audit.data?.length ?? 0);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-[30px] pb-20 pt-6" style={{ animation: 'ascFade .45s ease both' }}>
      <Button asChild variant="ghost" className="mb-1 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/">
          <ArrowLeft weight="bold" size={15} />
          Back
        </Link>
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', color: neutral.ink, margin: 0 }}>
            Facility registry
          </h2>
          <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>
            {regTotal.toLocaleString()} records across India · {browseRows.length} shown · search, audit quality and resolve duplicates.
          </p>
        </div>
        {planner && <TabBar tab={tab} onTab={setTab} />}
      </div>

      {/* ---------------------------------------------------------------- BROWSE */}
      {activeTab === 'browse' && (
        <>
          <div
            className="mt-5 flex items-center gap-2.5 rounded-[14px] py-1 pl-4 pr-1.5"
            style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}
          >
            <MagnifyingGlass size={18} style={{ color: neutral.textFaint2 }} />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, city, capability…"
              className="flex-1 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
              style={{ fontSize: 15, color: neutral.text }}
            />
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <ChipFilterRow label="State" options={stateOptions} value={state} onChange={setState} />
            <ChipFilterRow label="Type" options={typeOptions} value={type} onChange={setType} />
            <ChipFilterRow
              label="Trust"
              options={['All', 'verified', 'review', 'unverified']}
              value={trustFilter}
              onChange={(v) => setTrustFilter(v as TrustFilter)}
              display={(v) => (v === 'All' ? 'All trust' : trustTheme[normalizeTrust(v)].label)}
            />
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={saveSearch}
              className="inline-flex items-center gap-[7px] rounded-[10px] px-[13px] py-2"
              style={{
                background: roleTheme.clinician.tint,
                color: CLINICIAN,
                border: `1px solid ${roleTheme.clinician.border}`,
                fontFamily: fonts.body,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              <BellSimpleRinging weight="fill" size={15} />
              Save this search
            </button>
            <button
              type="button"
              title="Voice search"
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2"
              style={{
                background: '#fff',
                color: HOSPITAL,
                border: `1px solid ${roleTheme.hospital.border}`,
                fontFamily: fonts.body,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              <Microphone weight="fill" size={15} />
              Voice
            </button>
            {savedSearches.map((ss) => (
              <span
                key={ss.id}
                className="inline-flex items-center gap-[7px] rounded-full py-[5px] pl-3 pr-1.5"
                style={{ background: '#fff', border: `1px solid ${neutral.border}` }}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 bg-transparent p-0"
                  style={{ border: 'none', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600, fontSize: 12.5, color: neutral.text }}
                >
                  <BookmarkSimple weight="fill" size={13} style={{ color: CLINICIAN }} />
                  {ss.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedSearch(ss.id)}
                  className="flex items-center justify-center rounded-md"
                  style={{ width: 20, height: 20, border: 'none', background: '#F4F2EC', color: neutral.textDisabled, cursor: 'pointer' }}
                  aria-label={`Remove saved search ${ss.name}`}
                >
                  <X weight="bold" size={11} />
                </button>
              </span>
            ))}
          </div>

          {browse.error && (
            <div className="mt-4" style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>
              Couldn’t load the registry — {browse.error}
            </div>
          )}

          {browse.loading ? (
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((sk) => (
                <Skeleton key={sk} className="h-[150px] rounded-[16px]" />
              ))}
            </div>
          ) : browseRows.length === 0 ? (
            <EmptyState icon={<MagnifyingGlass />} title="No facilities match those filters" color={neutral.placeholder} />
          ) : (
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {browseRows.map((f) => {
                const dq = dqOf(f);
                return (
                  <FacilityCard
                    key={f.id}
                    facility={toCardFacility(f)}
                    role="hospital"
                    reasons={[{ text: `Data quality ${dq.score}/100` }]}
                    onOpen={() => void navigate(`/facility/${f.id}`)}
                    onSave={() => void navigate(`/facility/${f.id}`)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {/* -------------------------------------------------------- DATA QUALITY */}
      {activeTab === 'quality' && (
        <div className="mt-5 grid grid-cols-1 items-start gap-[22px] md:grid-cols-[.8fr_1.2fr]">
          {/* left: readiness + field coverage */}
          <div className="flex flex-col gap-[18px]">
            {audit.error ? (
              <div
                className="rounded-[18px] p-5"
                style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, color: '#B2503C', fontWeight: 600, fontSize: 14 }}
              >
                Couldn’t load the audit — {audit.error}
              </div>
            ) : audit.loading || !qualityData ? (
              <Skeleton className="h-[150px] rounded-[18px]" />
            ) : (
              <div
                className="rounded-[18px] p-[22px] text-center"
                style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}
              >
                <div
                  className="uppercase"
                  style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, letterSpacing: '.06em', color: neutral.textDisabled }}
                >
                  Registry readiness
                </div>
                <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 54, color: semantic.warn, lineHeight: 1, marginTop: 8 }}>
                  {qualityData.overall}
                </div>
                <div style={{ fontSize: 13, color: neutral.textSoft, marginTop: 4 }}>
                  out of 100 · <span style={{ color: semantic.danger, fontWeight: 700 }}>{qualityData.queueCount}</span> records need review
                </div>
              </div>
            )}
            <div className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
              <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.ink, marginBottom: 14 }}>
                Field coverage
              </div>
              {audit.error ? (
                <div style={{ fontSize: 13, color: neutral.textFaint2 }}>Field coverage unavailable.</div>
              ) : audit.loading || !qualityData ? (
                <div className="flex flex-col gap-3">
                  {['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((sk) => (
                    <Skeleton key={sk} className="h-[30px] rounded-[8px]" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-[13px]">
                  {qualityData.fields.map((d) => (
                    <div key={d.label}>
                      <div className="mb-[5px] flex justify-between">
                        <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: neutral.text }}>{d.label}</span>
                        <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.textMuted }}>{d.pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full" style={{ background: neutral.divider2 }}>
                        <div style={{ height: '100%', width: `${d.pct}%`, borderRadius: 999, background: coverageColor(d.pct) }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* right: worst-first review queue + export */}
          <div className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
            <div className="mb-3.5 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.ink }}>
                <WarningOctagon weight="fill" size={17} style={{ color: '#B2503C' }} />
                Review queue · worst records first
              </div>
              <button
                type="button"
                onClick={exportFixList}
                disabled={audit.loading}
                className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] py-2"
                style={{ background: '#fff', color: HOSPITAL, border: `1px solid ${roleTheme.hospital.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 12.5, cursor: audit.loading ? 'default' : 'pointer' }}
              >
                <DownloadSimple weight="fill" size={15} />
                Export fix-list (CSV)
              </button>
            </div>

            {audit.error && (
              <div style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>Couldn’t load the audit — {audit.error}</div>
            )}

            {audit.loading ? (
              <div className="flex flex-col gap-[11px]">
                {['a1', 'a2', 'a3', 'a4', 'a5'].map((sk) => (
                  <Skeleton key={sk} className="h-[110px] rounded-[14px]" />
                ))}
              </div>
            ) : qualityData && qualityData.queue.length === 0 ? (
              <EmptyState icon={<CheckCircle />} title="Every record passes review" color="#9CC3B5" />
            ) : (
              <div className="flex flex-col gap-[11px]">
                {qualityData?.queue.slice(0, 12).map(({ f, dq }) => (
                  <div key={f.id} className="rounded-[14px] p-[14px]" style={{ border: `1px solid ${neutral.divider2}` }}>
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="flex min-w-0 items-center gap-[11px]">
                        <span
                          className="flex shrink-0 items-center justify-center rounded-[10px]"
                          style={{ width: 36, height: 36, background: trustTheme[normalizeTrust(f.trust)].bg, color: trustTheme[normalizeTrust(f.trust)].fg, fontFamily: fonts.display, fontWeight: 700, fontSize: 14 }}
                        >
                          {f.name.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>{f.name}</div>
                          <div style={{ fontSize: 12, color: neutral.textFaint2, fontWeight: 500 }}>{f.city}, {f.state}</div>
                        </div>
                      </div>
                      <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, color: dqColor(dq.score), whiteSpace: 'nowrap' }}>{dq.score}</span>
                    </div>
                    <div className="mt-[11px] flex flex-wrap gap-1.5">
                      {dq.issues.map((i) => (
                        <span
                          key={i.t}
                          className="inline-flex items-center gap-[5px] rounded-full px-[9px] py-1"
                          style={{ background: '#F6EBD6', color: '#9A6A12', fontFamily: fonts.body, fontWeight: 600, fontSize: 11.5 }}
                        >
                          <WarningCircle weight="fill" size={12} />
                          {i.t}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void navigate(`/facility/${f.id}`)}
                      className="mt-3 inline-flex items-center gap-1.5 bg-transparent p-0"
                      style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: CLINICIAN, border: 'none', cursor: 'pointer' }}
                    >
                      Open &amp; fix
                      <ArrowRight weight="bold" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ DUPLICATES */}
      {activeTab === 'dupes' && (
        <>
          <div className="mt-4 flex items-center gap-1.5" style={{ fontSize: 14, color: neutral.textSoft }}>
            <Copy weight="fill" size={16} style={{ color: HOSPITAL }} />
            <span>
              Entity resolution — the FDR pipeline flagged these as possible duplicates.{' '}
              <span style={{ fontWeight: 700, color: '#B2503C' }}>{dupOpenCount}</span> still need a decision.
            </span>
          </div>

          {audit.error ? (
            <div className="mt-4" style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>
              Couldn’t load the audit — {audit.error}
            </div>
          ) : audit.loading ? (
            <div className="mt-4 flex flex-col gap-3.5">
              {['d1', 'd2', 'd3'].map((sk) => (
                <Skeleton key={sk} className="h-[180px] rounded-[18px]" />
              ))}
            </div>
          ) : dupRows.length === 0 ? (
            <EmptyState icon={<CheckCircle />} title="No duplicate candidates" color="#9CC3B5" />
          ) : (
            <div className="mt-4 flex flex-col gap-3.5">
              {dupRows.map((f) => {
                const dec = dupDecisions[f.id];
                const t = normalizeTrust(f.trust);
                return (
                  <div key={f.id} className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.ink }}>
                        <GitMerge weight="fill" size={15} style={{ color: HOSPITAL }} />
                        Possible duplicate
                      </span>
                      <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 12, color: dec ? CLINICIAN : '#B2503C' }}>
                        {dec === 'merged' ? 'Resolved · duplicate' : dec === 'distinct' ? 'Resolved · distinct' : 'Needs a decision'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3.5">
                      <button
                        type="button"
                        onClick={() => void navigate(`/facility/${f.id}`)}
                        className="rounded-[13px] p-[13px] text-left"
                        style={{ background: '#FBF8F3', border: `1px solid ${neutral.border2}`, cursor: 'pointer' }}
                      >
                        <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>{f.name}</div>
                        <div style={{ fontSize: 12, color: neutral.textFaint2, marginTop: 2 }}>{f.type} · {f.city}, {f.state}</div>
                        <div style={{ fontSize: 12, color: neutral.textMuted, marginTop: 7, lineHeight: 1.5 }}>
                          {trustTheme[t].label} · {f.conf != null ? `${f.conf}%` : 'conf unknown'}
                          <br />
                          {f.beds != null ? `${f.beds} beds` : 'beds unknown'} · {f.year ?? 'year unknown'}
                        </div>
                      </button>
                      <div className="flex items-center justify-center" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, color: '#B9AE9C' }}>vs</div>
                      <button
                        type="button"
                        onClick={() => void navigate(`/facility/${f.id}`)}
                        className="rounded-[13px] p-[13px] text-left"
                        style={{ background: '#FBF8F3', border: `1px solid ${neutral.border2}`, cursor: 'pointer' }}
                      >
                        <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14.5, color: neutral.ink }}>{f.name} (Unit II)</div>
                        <div style={{ fontSize: 12, color: neutral.textFaint2, marginTop: 2 }}>{f.type} · {f.city}, {f.state}</div>
                        <div style={{ fontSize: 12, color: neutral.textMuted, marginTop: 7, lineHeight: 1.5 }}>
                          {trustTheme[t].label} · {f.conf != null ? `${f.conf}%` : 'conf unknown'}
                          <br />
                          {f.beds != null ? `${f.beds} beds` : 'beds unknown'} · {f.year ?? 'year unknown'}
                        </div>
                      </button>
                    </div>
                    <div className="mt-3.5 flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => resolveDup(f.id, 'merged')}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] p-2.5"
                        style={{
                          fontFamily: fonts.body,
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                          background: dec === 'merged' ? HOSPITAL : '#fff',
                          color: dec === 'merged' ? '#fff' : HOSPITAL,
                          border: `1.5px solid ${dec === 'merged' ? HOSPITAL : roleTheme.hospital.border}`,
                        }}
                      >
                        <GitMerge weight="fill" size={14} />
                        Same facility — merge
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveDup(f.id, 'distinct')}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] p-2.5"
                        style={{
                          fontFamily: fonts.body,
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                          background: dec === 'distinct' ? CLINICIAN : '#fff',
                          color: dec === 'distinct' ? '#fff' : CLINICIAN,
                          border: `1.5px solid ${dec === 'distinct' ? CLINICIAN : roleTheme.clinician.border}`,
                        }}
                      >
                        <Check weight="fill" size={14} />
                        Distinct — keep both
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* tiny footer note tying the screen to the dataset (matches the Database accent) */}
      <p className="mt-5 flex items-center gap-1.5 px-1" style={{ fontSize: 12, color: neutral.textDisabled }}>
        <Database size={13} />
        Reading app_read.facilities (Lakebase) · record confirmations persist to your reviews; duplicate decisions stay on this device.
      </p>
    </div>
  );
}

export default Registry;
