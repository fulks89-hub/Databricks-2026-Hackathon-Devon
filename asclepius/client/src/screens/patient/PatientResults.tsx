import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  MapPinLine,
  FirstAid,
  WarningCircle,
  ArrowRight,
} from '@phosphor-icons/react';
import { Skeleton, Button } from '@databricks/appkit-ui/react';
import {
  useSearchFacilities,
  useShortlist,
  saveShortlist,
  removeShortlist,
  type FacilityRow,
} from '@/lib/api';
import { FacilityCard, fonts, neutral, role } from '@/components/asclepius';
import {
  usePatientFlow,
  rankFacilities,
  fitBreakdown,
  reasonChips,
  pickEvidenceQuote,
  toCardRow,
  completenessOf,
  normalizeTrust,
  CITY_LL,
  type ScoredFacility,
} from './patientFlow';

const ACCENT = role.patient.base;

// Pull a generous page of facilities and rank client-side. The patient may pick
// several needs, but useSearchFacilities filters by a single `specialty`, so we
// fetch broadly (optionally state-scoped) and reproduce the prototype's
// multi-need coverage scoring across the full set.
const FETCH_LIMIT = 400;

export default function PatientResults() {
  const navigate = useNavigate();
  const flow = usePatientFlow();
  const { origin, radius, needSpecs, needLabels, originState, setRadius } = flow;

  // Scope the fetch to the origin's state when known (case-insensitive on the
  // server); omit `state` for unmapped origins so we never return zero. Still
  // rank client-side so multi-need coverage works across the scoped set.
  const { data, loading, error, refetch } = useSearchFacilities({ limit: FETCH_LIMIT, state: originState });
  const { data: shortlist } = useShortlist();

  // Optimistic shortlist set (server is the source of truth; we toggle locally
  // for snappy UX, then call the write fn). Seeded from the persisted shortlist
  // once it loads so already-saved facilities show "Saved" on first paint and
  // toggling them removes rather than re-adds. After the user interacts we stop
  // re-seeding so an optimistic edit is never clobbered by a stale refetch.
  //
  // The displayed saved-set is DERIVED at render time from the persisted
  // shortlist merged with `overrides` — a map of the user's explicit local
  // toggles (id → saved?). This needs no effect and no ref: the persisted
  // shortlist drives the baseline, and any facility the user has touched is
  // pinned to their last intent, so an in-flight refetch can never clobber it.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const savedIds = useMemo(() => {
    const ids = new Set<string>((shortlist ?? []).map((s) => s.facility_id));
    for (const [id, isSaved] of overrides) {
      if (isSaved) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [shortlist, overrides]);
  const [whyOpenId, setWhyOpenId] = useState<string | null>(null);

  const scored = useMemo<ScoredFacility[]>(
    () => (data ? rankFacilities(data, needSpecs, origin, radius) : []),
    [data, needSpecs, origin, radius],
  );

  const toggleSave = useCallback(
    async (f: FacilityRow) => {
      const isSaved = savedIds.has(f.id);
      const want = !isSaved;
      // Optimistically pin the user's intent for this facility.
      setOverrides((prev) => new Map(prev).set(f.id, want));
      try {
        if (isSaved) await removeShortlist(f.id);
        else await saveShortlist(f.id, true);
      } catch {
        // Roll back to the previous intent on failure.
        setOverrides((prev) => new Map(prev).set(f.id, isSaved));
      }
    },
    [savedIds],
  );

  const headline = `${scored.length} ${scored.length === 1 ? 'facility' : 'facilities'} within reach`;
  const sub =
    (needLabels.length ? `${needLabels.join(' · ')} · ` : '') +
    `Ranked by fit, evidence strength and distance from ${origin}.`;

  return (
    <div
      className="mx-auto w-full"
      style={{ flex: 1, maxWidth: 1240, padding: '30px 30px 70px', animation: 'ascFade .45s ease both' }}
    >
      {/* Header + inline radius slider */}
      <div className="flex flex-wrap items-end justify-between" style={{ gap: 14 }}>
        <div>
          <h2
            style={{
              fontFamily: fonts.display,
              fontWeight: fonts.weight.bold,
              fontSize: 30,
              letterSpacing: '-.02em',
              margin: 0,
              color: neutral.ink,
            }}
          >
            {loading ? 'Finding facilities near you…' : headline}
          </h2>
          <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>{sub}</p>
        </div>
        <div
          className="flex items-center"
          style={{
            gap: 14,
            background: neutral.surface,
            border: `1px solid ${neutral.borderCard}`,
            borderRadius: 14,
            padding: '11px 16px',
          }}
        >
          <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 13, color: neutral.textSoft, whiteSpace: 'nowrap' }}>
            Radius
          </span>
          <input
            type="range"
            min={50}
            max={650}
            step={25}
            value={radius}
            onChange={(e) => setRadius(parseInt(e.target.value, 10))}
            aria-label="Travel radius in kilometres"
            style={{ width: 150 }}
          />
          <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, color: ACCENT, whiteSpace: 'nowrap' }}>
            {radius} km
          </span>
        </div>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 24, alignItems: 'start', marginTop: 22 }}
        className="max-md:!grid-cols-1"
      >
        {/* ---- LIST ---- */}
        <div className="flex flex-col" style={{ gap: 14 }}>
          {loading && (
            <>
              {['s1', 's2', 's3'].map((k) => (
                <div
                  key={k}
                  style={{ background: neutral.surface, border: `1px solid ${neutral.borderCard}`, borderRadius: 20, padding: 16 }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-[42px] w-[42px] rounded-xl" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="mt-2 h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-[18px] w-[18px] rounded" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-28 rounded-full" />
                    <Skeleton className="h-6 w-32 rounded-full" />
                  </div>
                  <div style={{ borderTop: `1px solid ${neutral.divider2}`, paddingTop: 14 }}>
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && error && (
            <div
              style={{ background: neutral.surface, border: `1px dashed ${neutral.borderDashed}`, borderRadius: 20, padding: 32, textAlign: 'center' }}
            >
              <WarningCircle weight="fill" size={34} color={ACCENT} />
              <div style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 16, color: neutral.textMuted, marginTop: 10 }}>
                Couldn&rsquo;t load facilities
              </div>
              <div style={{ fontSize: 14, color: neutral.textFaint, marginTop: 4 }}>{error}</div>
              <Button onClick={refetch} className="mt-4 rounded-[11px] font-semibold" style={{ background: ACCENT, color: '#fff' }}>
                Try again
              </Button>
            </div>
          )}

          {!loading &&
            !error &&
            scored.map((s) => {
              const card = toCardRow(s.f);
              const evidence = pickEvidenceQuote(s.f, s.matched);
              return (
                <div key={s.f.id} className="flex flex-col">
                  <FacilityCard
                    facility={card}
                    role="patient"
                    dataPoints={completenessOf(s.f)}
                    fit={s.fit}
                    whyBreakdown={fitBreakdown(s, needSpecs, origin, radius)}
                    whyOpen={whyOpenId === s.f.id}
                    onToggleWhy={() => setWhyOpenId((cur) => (cur === s.f.id ? null : s.f.id))}
                    reasons={reasonChips(s, needSpecs, origin)}
                    evidence={evidence}
                    saved={savedIds.has(s.f.id)}
                    onSave={() => void toggleSave(s.f)}
                    onOpen={() => void navigate(`/facility/${encodeURIComponent(s.f.id)}`)}
                  />
                  <CardFooterLink
                    onOpen={() => void navigate(`/facility/${encodeURIComponent(s.f.id)}`)}
                  />
                </div>
              );
            })}

          {!loading && !error && scored.length === 0 && (
            <div
              style={{ background: neutral.surface, border: `1px dashed ${neutral.borderDashed}`, borderRadius: 20, padding: 40, textAlign: 'center', color: neutral.textFaint2 }}
            >
              <MapPinLine size={34} color={neutral.placeholder} />
              <div style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 16, color: neutral.textMuted, marginTop: 10 }}>
                No facilities within {radius} km
              </div>
              <div style={{ fontSize: 14, marginTop: 4 }}>Try widening your travel radius above.</div>
            </div>
          )}
        </div>

        {/* ---- MAP ---- */}
        <div style={{ position: 'sticky', top: 88 }} className="max-md:!static">
          <RadiusMap origin={origin} radius={radius} scored={scored} onOpen={(id) => void navigate(`/facility/${encodeURIComponent(id)}`)} />
          <p style={{ fontSize: 12, color: neutral.textDisabled, margin: '12px 4px 0', lineHeight: 1.5 }}>
            Asclepius surfaces claims parsed from public facility records (FDR demo data). Confidence reflects evidence
            strength &mdash; always confirm critical-care availability by phone before travelling.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Per-result card footer — "View evidence & details →" only.
   Mirrors the prototype's in-card footer row (Asclepius.dc.html L325-328):
   a bordered footer divider with the orange evidence link on the left. The
   Save affordance lives inside the shared FacilityCard, so this footer carries
   the View link alone. (No Refer button — that belongs to clinician flows.)
   --------------------------------------------------------------------------- */
function CardFooterLink({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ borderTop: `1px solid ${neutral.divider2}`, padding: '14px 16px 0' }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center cursor-pointer"
        style={{ gap: 8, background: 'none', border: 'none', fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, color: ACCENT, padding: 0 }}
      >
        View evidence &amp; details
        <ArrowRight weight="bold" size={15} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Radius map — concentric rings + "you" origin + trust-colored facility pins.
   Pin placement projects each facility's lat/lng (or city centroid) relative to
   the origin, scaled by the radius. Mirrors the prototype patientPins layout.
   --------------------------------------------------------------------------- */
function RadiusMap({
  origin,
  radius,
  scored,
  onOpen,
}: {
  origin: string;
  radius: number;
  scored: ScoredFacility[];
  onOpen: (id: string) => void;
}) {
  const o = CITY_LL[origin];

  const pins = scored.slice(0, 40).flatMap((s) => {
    const lat = s.f.lat ?? (s.f.city ? CITY_LL[s.f.city]?.[0] : undefined);
    const lng = s.f.lng ?? (s.f.city ? CITY_LL[s.f.city]?.[1] : undefined);
    // Honesty: facilities the list flags as "Distance approximate" (distApprox —
    // no real lat/lng and no CITY_LL-known city) have no real position, so we
    // must NOT plant a pin at a fabricated location. Omit them from the map; the
    // origin + real-coord pins still render. If we somehow lack a usable origin
    // or projected coords too, skip rather than invent a placement.
    if (s.distApprox || !o || lat == null || lng == null) return [];
    // Scale ~1.1 deg ≈ radius edge; clamp into the plate.
    const degSpan = Math.max(0.5, radius / 110); // ~110 km per degree
    let x = 50 + ((lng - o[1]) / degSpan) * 44;
    let y = 50 - ((lat - o[0]) / degSpan) * 44;
    x = Math.max(5, Math.min(95, x));
    y = Math.max(6, Math.min(92, y));
    const t = normalizeTrust(s.f.trust);
    const bg = t === 'verified' ? role.clinician.base : t === 'review' ? '#B07A1E' : '#A99C88';
    const sz = s.fit >= 70 ? 30 : 26;
    return [{ id: s.f.id, name: s.f.name, x, y, bg, sz }];
  });

  return (
    <div
      style={{
        position: 'relative',
        height: 520,
        borderRadius: 22,
        overflow: 'hidden',
        border: `1px solid ${neutral.border}`,
        background: neutral.bgSunken,
        backgroundImage:
          'linear-gradient(#E8E0D3 1px,transparent 1px),linear-gradient(90deg,#E8E0D3 1px,transparent 1px)',
        backgroundSize: '34px 34px',
        boxShadow: '0 1px 2px rgba(43,39,34,.04)',
      }}
    >
      {/* concentric radius rings */}
      {[88, 58, 28].map((w, i) => (
        <div
          key={w}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `${w}%`,
            paddingBottom: `${w}%`,
            border: `1.5px dashed ${['#CFC3B0', '#D4C9B7', '#D9CEBD'][i]}`,
            borderRadius: '50%',
            transform: 'translate(-50%,-50%)',
          }}
        />
      ))}

      {/* origin "you" dot + pulse */}
      <div
        style={{ position: 'absolute', left: '50%', top: '50%', width: 16, height: 16, borderRadius: '50%', background: ACCENT, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 4px #fff,0 0 0 6px #E0714C55', zIndex: 6 }}
      />
      <div
        style={{ position: 'absolute', left: '50%', top: '50%', width: 16, height: 16, borderRadius: '50%', background: '#E0714C55', transform: 'translate(-50%,-50%)', animation: 'ascPulse 2.6s ease-out infinite' }}
      />
      <div
        style={{ position: 'absolute', left: '50%', top: 'calc(50% + 16px)', transform: 'translateX(-50%)', fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 11, color: role.patient.press, background: 'rgba(255,255,255,.85)', padding: '2px 8px', borderRadius: 7, zIndex: 6 }}
      >
        You · {origin}
      </div>

      {/* facility pins */}
      {pins.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.id)}
          title={p.name}
          className="flex items-center justify-center cursor-pointer"
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: 'translate(-50%,-50%)',
            width: p.sz,
            height: p.sz,
            borderRadius: '50%',
            background: p.bg,
            border: '3px solid #fff',
            boxShadow: '0 4px 10px rgba(43,39,34,.3)',
            zIndex: 5,
            padding: 0,
          }}
        >
          <FirstAid weight="fill" size={Math.round(p.sz * 0.46)} color="#fff" />
        </button>
      ))}

      {/* legend */}
      <div
        style={{ position: 'absolute', left: 16, bottom: 16, background: 'rgba(255,255,255,.92)', border: `1px solid ${neutral.border}`, borderRadius: 12, padding: '10px 13px', backdropFilter: 'blur(6px)' }}
      >
        {[
          { c: role.clinician.base, l: 'Verified' },
          { c: '#B07A1E', l: 'Needs review' },
          { c: '#A99C88', l: 'Unverified' },
        ].map((row, i) => (
          <div key={row.l} className="flex items-center" style={{ gap: 7, fontFamily: fonts.body, fontWeight: fonts.weight.semibold, fontSize: 12, color: neutral.textMuted, marginBottom: i < 2 ? 5 : 0 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: row.c }} />
            {row.l}
          </div>
        ))}
      </div>

      {/* radius chip */}
      <div
        style={{ position: 'absolute', right: 16, top: 16, background: 'rgba(255,255,255,.92)', border: `1px solid ${neutral.border}`, borderRadius: 10, padding: '7px 12px', fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 12, color: neutral.ink }}
      >
        {radius} km radius
      </div>
    </div>
  );
}
