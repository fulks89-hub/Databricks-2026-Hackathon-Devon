// Hospital · Coverage (/hospital/coverage) — demand-vs-coverage by discipline.
//
// Combines the real district_demand (useDistrictDemand) for the city's district
// with nearby facilities' listed services (useSearchFacilities by city) and the
// device-local roster to score each discipline. Renders a DemandCoverageBar per
// discipline, surfaces the top-3 weak points (with "Post opening" → createPosting),
// shows "Your open roles" from the real postings API, and the worst-desert
// context from useDeserts / useDistrictDemand. Mirrors the prototype isHCoverage.

import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router';
import {
  Pulse,
  WarningDiamond,
  Target,
  GitBranch,
  Megaphone,
  CheckCircle,
  FirstAid,
  ArrowLeft,
  ArrowRight,
  FileText,
  User,
  X,
  Info,
} from '@phosphor-icons/react';
import { Card, CardContent, Skeleton } from '@databricks/appkit-ui/react';
import {
  useDistrictDemand,
  useSearchFacilities,
  useDeserts,
  usePostings,
  createPosting,
  type Posting,
} from '@/lib/api';
import { DemandCoverageBar, KpiTile, fonts, neutral, role } from '@/components/asclepius';
import {
  DISCIPLINES,
  HOSPITAL_STATE,
  CITY_DISTRICT,
  loadCity,
  loadRoster,
  indexDemand,
  computeCoverageRows,
  subNeedFor,
  driversFor,
  isProxyDemand,
  isProxyDriver,
  stripProxy,
  type CoverageRow,
} from './hospitalData';

const HOSP = role.hospital.base;

/** Low-emphasis "proxy estimate" marker — flags demand/drivers derived from a
 * proxy signal (district_demand.top_driver begins "(proxy)") so a modelled
 * figure is never read as directly observed. */
function ProxyBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span
      title="Derived from a proxy signal, not a directly observed driver — treat as an estimate."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: neutral.surfaceWarm,
        color: neutral.textFaint,
        border: `1px solid ${neutral.border}`,
        borderRadius: 5,
        padding: '2px 7px',
        font: `600 10.5px ${fonts.body}`,
        ...style,
      }}
    >
      <Info weight="fill" size={11} />
      proxy estimate
    </span>
  );
}

export function HospitalCoverage() {
  const city = loadCity();
  const roster = loadRoster();
  const district = CITY_DISTRICT[city];

  const { data: demandRows, loading: demandLoading } = useDistrictDemand({
    district,
    state: HOSPITAL_STATE,
  });
  // Nearby facilities = facilities in the same city (proxy for the prototype's
  // 170 km radius; the real registry is keyed by city/district not lat/lng here).
  const { data: facilities, loading: facLoading } = useSearchFacilities({ state: HOSPITAL_STATE, district, limit: 200 });
  const { data: desertRows } = useDeserts({ state: HOSPITAL_STATE, limit: 60 });
  const { data: myPostingsRaw, loading: postingsLoading, refetch: refetchPostings } = usePostings({ mine: true });

  const [posting, setPosting] = useState<string | null>(null);

  const demand = useMemo(() => indexDemand(demandRows), [demandRows]);

  // Facilities offering each discipline (specialties[] contains the discipline).
  const facCountByDiscipline = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of DISCIPLINES) {
      const n = (facilities ?? []).filter((f) => (f.specialties ?? []).includes(d)).length;
      m.set(d, n);
    }
    return m;
  }, [facilities]);

  const rows: CoverageRow[] = useMemo(
    () => computeCoverageRows(city, roster, demand, facCountByDiscipline),
    [city, roster, demand, facCountByDiscipline],
  );

  const drivers = useMemo(() => driversFor(city, demand), [city, demand]);
  const weak = rows.filter((r) => r.gap >= 10);
  const focusSpec = (weak[0] ?? rows[0])?.discipline ?? 'Cardiology';

  // My open roles for this city (real postings API, mine=1).
  const myPostings = useMemo(
    () => (myPostingsRaw ?? []).filter((p: Posting) => p.city === city),
    [myPostingsRaw, city],
  );
  const postedSet = useMemo(
    () => new Set(myPostings.map((p) => p.discipline)),
    [myPostings],
  );

  // Desert context for the city's district (worst-deserts ranking).
  const cityDesert = useMemo(
    () => (desertRows ?? []).find((d) => d.nfhs_district === district),
    [desertRows, district],
  );

  const postOpening = useCallback(
    async (discipline: string) => {
      setPosting(discipline);
      try {
        const sub = subNeedFor(city, discipline, demand);
        const driver = drivers[0] ?? 'Local disease burden';
        await createPosting({
          city,
          discipline,
          sub,
          driver,
          urgency: 'high',
          hospital: `${city} District Hospital`,
        });
        refetchPostings();
      } finally {
        setPosting(null);
      }
    },
    [city, demand, drivers, refetchPostings],
  );

  const loading = demandLoading || facLoading;

  return (
    <div style={{ flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto', padding: '30px 30px 70px', animation: 'ascFade .45s ease both' }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', margin: 0, color: neutral.ink }}>
        Coverage around {city} · 170 km
      </h2>
      <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>
        How your staffing and nearby facilities stack up against local disease burden.
      </p>

      {/* Demand drivers banner */}
      <div style={{ marginTop: 18, background: role.hospital.tint2, border: '1px solid #DDE6EF', borderRadius: 18, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: role.hospital.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Pulse weight="fill" color={HOSP} size={22} />
          </span>
          <div>
            <div style={{ font: `700 14px ${fonts.body}`, color: neutral.ink }}>What&apos;s driving demand in {city}</div>
            <div style={{ fontSize: 12.5, color: neutral.textSoft }}>Burden indices weight each discipline&apos;s expected need</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto' }}>
          {loading && drivers.length === 0 ? (
            <Skeleton style={{ height: 32, width: 220, borderRadius: 999 }} />
          ) : (
            drivers.map((d) => (
              <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #D6E0EC', borderRadius: 999, padding: '7px 13px', font: `600 13px ${fonts.body}`, color: '#2E558C' }}>
                <WarningDiamond weight="fill" color="#B2503C" />
                {stripProxy(d)}
                {isProxyDriver(d) && <ProxyBadge style={{ marginLeft: 1 }} />}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="max-md:!grid-cols-1" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,.75fr)', gap: 24, alignItems: 'start', marginTop: 20 }}>
        {/* Bars */}
        <Card style={{ border: `1px solid ${neutral.borderCard}`, borderRadius: 20 }}>
          <CardContent style={{ padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ font: `700 15px ${fonts.body}`, color: neutral.ink }}>Demand vs coverage by discipline</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `600 11.5px ${fonts.body}`, color: neutral.textFaint }}>
                  <span style={{ width: 16, height: 8, borderRadius: 3, background: 'repeating-linear-gradient(90deg,#CDBFA9,#CDBFA9 4px,transparent 4px,transparent 8px)' }} />
                  Demand
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `600 11.5px ${fonts.body}`, color: neutral.textFaint }}>
                  <span style={{ width: 16, height: 8, borderRadius: 3, background: HOSP }} />
                  Your coverage
                </span>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((sk) => (
                  <div key={sk} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton style={{ height: 14, width: '40%' }} />
                    <Skeleton style={{ height: 12, width: '100%', borderRadius: 999 }} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {rows.map((r) => {
                  const proxy = isProxyDemand(r.discipline, demand);
                  return (
                    <div key={r.discipline} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <DemandCoverageBar
                        name={r.discipline}
                        demand={r.demand}
                        coverage={r.coverage}
                        status={r.status}
                        overlapText={`${r.facCount} nearby · ${r.roster} on staff`}
                      />
                      {proxy && <ProxyBadge style={{ alignSelf: 'flex-start' }} />}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div style={{ position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Facility map plate (coverage of the focus discipline) */}
          <div style={{ position: 'relative', height: 300, borderRadius: 20, overflow: 'hidden', border: '1px solid #DDE6EF', background: '#EFF3F8', backgroundImage: 'linear-gradient(#E1E8F1 1px,transparent 1px),linear-gradient(90deg,#E1E8F1 1px,transparent 1px)', backgroundSize: '30px 30px' }}>
            {(facilities ?? []).slice(0, 18).map((f, i) => {
              const has = (f.specialties ?? []).includes(focusSpec);
              const sz = has ? 32 : 24;
              // Deterministic scatter from the index (no lat/lng on these rows).
              const x = 12 + ((i * 37) % 76);
              const y = 14 + ((i * 53) % 72);
              return (
                <span
                  key={f.id}
                  title={f.name}
                  style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', width: sz, height: sz, borderRadius: '50%', background: has ? '#2E7D67' : '#C2B6A2', border: '3px solid #fff', boxShadow: '0 4px 10px rgba(43,39,34,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}
                >
                  <FirstAid weight="fill" color="#fff" size={sz * 0.46} />
                </span>
              );
            })}
            <div style={{ position: 'absolute', left: 14, top: 14, background: 'rgba(255,255,255,.93)', border: '1px solid #D6E0EC', borderRadius: 11, padding: '9px 12px' }}>
              <div style={{ font: `700 12.5px ${fonts.display}`, color: neutral.ink }}>{focusSpec} coverage</div>
              <div style={{ display: 'flex', gap: 11, marginTop: 5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `600 11px ${fonts.body}`, color: neutral.textMuted }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2E7D67' }} />
                  Offers it
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `600 11px ${fonts.body}`, color: neutral.textMuted }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#C2B6A2' }} />
                  Doesn&apos;t
                </span>
              </div>
            </div>
          </div>

          {/* Desert / need context */}
          {cityDesert && (
            <KpiTile
              value={cityDesert.desert_rank != null ? `#${cityDesert.desert_rank}` : 'n/a'}
              label={`${district} care-desert rank in ${HOSPITAL_STATE}`}
              hint={
                cityDesert.desert_score != null
                  ? `${cityDesert.facility_count} facilities · desert score ${Math.round(cityDesert.desert_score)}`
                  : `${cityDesert.facility_count} mapped facilities · insufficient supply data`
              }
              accent="danger"
            />
          )}

          {/* Weak points */}
          <Card style={{ border: `1px solid ${neutral.borderCard}`, borderRadius: 20 }}>
            <CardContent style={{ padding: 20 }}>
              <div style={{ font: `700 14px ${fonts.body}`, color: neutral.ink, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
                <Target weight="fill" color="#B2503C" />
                Your weak points
              </div>
              {loading ? (
                <Skeleton style={{ height: 90, width: '100%', borderRadius: 14 }} />
              ) : weak.length === 0 ? (
                <div style={{ fontSize: 13, color: neutral.textSoft, padding: '6px 0' }}>
                  No critical gaps for {city} with your current roster. Adjust headcount on the roster step to re-check.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {weak.slice(0, 3).map((w) => {
                    const sub = subNeedFor(city, w.discipline, demand);
                    const posted = postedSet.has(w.discipline);
                    const appCount = myPostings.find((p) => p.discipline === w.discipline)?.applicants ?? 0;
                    const postLabel = posted
                      ? appCount > 0
                        ? `${appCount} clinician${appCount === 1 ? '' : 's'} interested`
                        : 'Posted · withdraw'
                      : 'Post opening for clinicians';
                    return (
                      <div key={w.discipline} style={{ border: '1px solid #F0E1DC', background: '#FCF6F4', borderRadius: 14, padding: '13px 15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ font: `700 15px ${fonts.body}`, color: neutral.ink }}>{w.discipline}</span>
                            {isProxyDemand(w.discipline, demand) && <ProxyBadge />}
                          </span>
                          <span style={{ font: `700 12px ${fonts.body}`, color: '#B2503C', background: '#F6E2DC', borderRadius: 999, padding: '3px 9px' }}>
                            gap {Math.round(w.gap)}
                          </span>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, background: '#E4EFEA', color: '#2E7D67', borderRadius: 7, padding: '3px 9px', font: `600 12px ${fonts.body}` }}>
                          <GitBranch weight="fill" />
                          Needs {sub}
                        </div>
                        <div style={{ fontSize: 12.5, color: neutral.textFaint, marginTop: 6, lineHeight: 1.4 }}>
                          {w.facCount} nearby · {w.roster} on staff
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                          <Link
                            to={`/hospital/recruiter?spec=${encodeURIComponent(w.discipline)}`}
                            style={{ marginTop: 11, display: 'inline-flex', alignItems: 'center', gap: 7, background: HOSP, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 13px', font: `600 13px ${fonts.body}`, cursor: 'pointer', textDecoration: 'none' }}
                          >
                            Find free agents
                            <ArrowRight weight="bold" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => void postOpening(w.discipline)}
                            disabled={posting === w.discipline}
                            style={{
                              marginTop: 11,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 7,
                              background: posted ? '#E4EFEA' : '#fff',
                              color: posted ? '#2E7D67' : HOSP,
                              border: `1px solid ${posted ? '#CFE3DB' : '#CCDAEC'}`,
                              borderRadius: 10,
                              padding: '8px 13px',
                              font: `600 13px ${fonts.body}`,
                              cursor: posting === w.discipline ? 'wait' : 'pointer',
                              opacity: posting === w.discipline ? 0.7 : 1,
                            }}
                          >
                            {posted ? <CheckCircle weight="fill" /> : <Megaphone weight="fill" />}
                            {postLabel}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Your open roles */}
          {myPostings.length > 0 && (
            <Card style={{ border: '1px solid #DDE6EF', borderRadius: 20 }}>
              <CardContent style={{ padding: 20 }}>
                <div style={{ font: `700 14px ${fonts.body}`, color: neutral.ink, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
                  <Megaphone weight="fill" color={HOSP} />
                  Your open roles
                </div>
                {postingsLoading ? (
                  <Skeleton style={{ height: 48, width: '100%', borderRadius: 12 }} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {myPostings.map((p) => {
                      const appCount = p.applicants ?? 0;
                      return (
                        <div key={p.posting_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #E6EDF5', borderRadius: 12, padding: '11px 13px' }}>
                          <div>
                            <div style={{ font: `700 14px ${fonts.body}`, color: neutral.ink }}>
                              {p.discipline} · <span style={{ color: '#2E7D67' }}>{p.sub}</span>
                            </div>
                            <div style={{ fontSize: 12, color: neutral.textFaint, marginTop: 2 }}>
                              {appCount === 0 ? 'No interest yet' : `${appCount} clinician${appCount === 1 ? '' : 's'} interested`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '4px 10px', font: `600 12px ${fonts.body}`, background: appCount > 0 ? '#E4EFEA' : neutral.divider2, color: appCount > 0 ? '#2E7D67' : neutral.textDisabled }}>
                              <User weight="fill" />
                              {appCount}
                            </span>
                            <button
                              type="button"
                              onClick={() => void postOpening(p.discipline)}
                              title="Withdraw opening"
                              aria-label="Withdraw opening"
                              style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${neutral.border}`, background: '#fff', color: '#8A8174', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <X />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Link
          to="/hospital/roster"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'none', border: '1.5px solid #DCE3EC', borderRadius: 14, padding: '14px 20px', font: `600 15px ${fonts.body}`, color: neutral.textSoft, cursor: 'pointer', textDecoration: 'none' }}
        >
          <ArrowLeft weight="bold" />
          Edit roster
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            to="/report"
            className="asc-noprint"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: '#fff', color: HOSP, border: '1.5px solid #CCDAEC', borderRadius: 14, padding: '15px 22px', font: `700 15px ${fonts.body}`, cursor: 'pointer', textDecoration: 'none' }}
          >
            <FileText weight="fill" />
            Board report
          </Link>
          <Link
            to="/hospital/recruiter"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: HOSP, color: '#fff', border: 'none', borderRadius: 14, padding: '15px 26px', font: `700 16px ${fonts.body}`, cursor: 'pointer', boxShadow: '0 12px 26px -10px rgba(59,111,176,.6)', textDecoration: 'none' }}
          >
            Recruit for the gaps
            <ArrowRight weight="bold" />
          </Link>
        </div>
      </div>
      <p style={{ fontSize: 12, color: neutral.textDisabled, margin: '16px 4px 0', lineHeight: 1.5 }}>
        Coverage combines nearby facilities&apos; listed services (from the FDR record) with your own roster. Demand indices
        are illustrative disease-burden weights — confirm against district health data before acting.
      </p>
    </div>
  );
}

export default HospitalCoverage;
