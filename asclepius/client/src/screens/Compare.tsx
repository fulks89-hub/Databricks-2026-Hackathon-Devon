import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ArrowLeft, ArrowRight, X, ArrowsLeftRight, Scales } from '@phosphor-icons/react';
import { useFacilityDetail, type FacilityRow } from '@/lib/api';
import { fonts, neutral, role as roleTheme, trust as trustTheme } from '@/components/asclepius/theme';
import { normalizeTrust, dqOf } from './registryShared';

/* ============================================================================
   Compare (/compare) — side-by-side of up to 3 facilities. The ids come from
   the URL (?ids=a,b,c — the CompareTray builds this link). Each column reads
   one facility via useFacilityDetail. Matches Asclepius.dc.html §Compare.
   ============================================================================ */

const CLINICIAN = roleTheme.clinician.base;

function trustPillStyle(t: ReturnType<typeof normalizeTrust>): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: trustTheme[t].bg,
    color: trustTheme[t].fg,
    borderRadius: 999,
    padding: '4px 10px',
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: 12,
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-[9px]" style={{ borderBottom: `1px solid ${neutral.divider3}` }}>
      <span style={{ fontSize: 12.5, color: neutral.textFaint2 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}

/* ---- one compare column (resolves its own facility by id) ----------------- */
function CompareColumn({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { data, loading, error } = useFacilityDetail(id);
  const navigate = useNavigate();

  if (loading) {
    return <Skeleton className="h-[460px] min-w-[260px] flex-1 rounded-[18px]" />;
  }

  if (error || !data) {
    return (
      <div
        className="flex min-w-[260px] flex-1 flex-col items-start justify-between rounded-[18px] p-[18px]"
        style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}
      >
        <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: '#B2503C' }}>
          {error ? 'Couldn’t load this facility' : 'Facility not found'}
        </div>
        <div style={{ fontSize: 12.5, color: neutral.textFaint2, marginTop: 4 }}>id: {id}</div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5"
          style={{ border: `1px solid ${neutral.border}`, background: '#fff', color: '#8A8174', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600, fontSize: 12 }}
        >
          <X size={12} /> Remove
        </button>
      </div>
    );
  }

  const f: FacilityRow = data;
  const t = normalizeTrust(f.trust);
  const dq = dqOf(f);
  const specs = (f.specialties ?? []).join(', ') || '—';

  return (
    <div className="flex min-w-[260px] flex-1 flex-col overflow-hidden rounded-[18px]" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, boxShadow: '0 1px 2px rgba(43,39,34,.04)' }}>
      {/* header */}
      <div className="flex items-start justify-between gap-2 px-[18px] py-4" style={{ borderBottom: `1px solid ${neutral.divider2}` }}>
        <div>
          <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 16, color: neutral.ink, lineHeight: 1.2 }}>{f.name}</div>
          <div style={{ fontSize: 12.5, color: neutral.textFaint2, fontWeight: 500, marginTop: 2 }}>
            {[f.city, f.state].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove from compare"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
          style={{ border: `1px solid ${neutral.border}`, background: '#fff', color: '#8A8174', cursor: 'pointer' }}
        >
          <X size={13} />
        </button>
      </div>

      {/* attribute rows */}
      <div className="px-[18px] pb-3.5 pt-1.5">
        <Row label="Type">
          <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: neutral.text }}>{f.type ?? '—'}</span>
        </Row>
        <Row label="Trust">
          <span style={trustPillStyle(t)}>{trustTheme[t].label}</span>
        </Row>
        <Row label="Confidence">
          <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.text }}>{f.conf != null ? `${f.conf}%` : 'unknown'}</span>
        </Row>
        <Row label="Capacity">
          <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: neutral.text }}>{f.beds != null ? `${f.beds} beds` : 'unknown'}</span>
        </Row>
        <Row label="Established">
          <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: neutral.text }}>{f.year ?? 'unknown'}</span>
        </Row>
        <Row label="Data quality">
          <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.text }}>{dq.score}/100</span>
        </Row>
        <div className="py-2.5 pb-1">
          <span className="mb-1 block" style={{ fontSize: 12.5, color: neutral.textFaint2 }}>Services</span>
          <span style={{ fontSize: 12.5, color: neutral.textMuted, fontWeight: 500, lineHeight: 1.5 }}>{specs}</span>
        </div>
        <button
          type="button"
          onClick={() => void navigate(`/facility/${f.id}`)}
          className="mt-2 inline-flex items-center gap-1.5 bg-transparent p-0"
          style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, color: CLINICIAN, border: 'none', cursor: 'pointer' }}
        >
          Open
          <ArrowRight weight="bold" size={14} />
        </button>
      </div>
    </div>
  );
}

export function Compare() {
  const [params, setParams] = useSearchParams();

  // ids come from ?ids=a,b,c (the CompareTray link). Cap at 3, dedupe.
  const ids = useMemo(() => {
    const raw = params.get('ids') ?? '';
    return Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 3);
  }, [params]);

  function removeId(id: string) {
    const next = ids.filter((x) => x !== id);
    if (next.length === 0) {
      setParams({}, { replace: true });
    } else {
      setParams({ ids: next.join(',') }, { replace: true });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1140px] px-[30px] pb-[70px] pt-6" style={{ animation: 'ascFade .45s ease both' }}>
      <Button asChild variant="ghost" className="mb-1.5 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/registry">
          <ArrowLeft weight="bold" size={15} />
          Back
        </Link>
      </Button>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', margin: '0 0 18px', color: neutral.ink }}>
        Compare facilities
      </h2>

      {ids.length === 0 ? (
        <div
          className="rounded-[18px] px-10 py-14 text-center"
          style={{ background: '#fff', border: `1px dashed ${neutral.borderDashed}`, color: neutral.textFaint2 }}
        >
          <Scales size={40} style={{ color: neutral.placeholder }} />
          <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 18, color: neutral.textMuted, marginTop: 12 }}>Nothing to compare yet</div>
          <div className="mx-auto mt-1.5 max-w-[30em]" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
            Add up to three facilities from the registry or your matches, then bring them here side-by-side to weigh trust, capacity and data quality.
          </div>
          <Button asChild variant="outline" className="mt-[18px] rounded-[12px] font-bold">
            <Link to="/registry">
              <ArrowsLeftRight weight="bold" size={15} />
              Browse the registry
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {ids.map((id) => (
            <CompareColumn key={id} id={id} onRemove={() => removeId(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Compare;
