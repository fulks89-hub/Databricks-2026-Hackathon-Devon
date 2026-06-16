// Hospital · Recruiter (/hospital/recruiter) — free-agent matching + AI panel.
//
// Lists free-agent doctors ranked by your weak points and sub-specialty fit, with
// Recruit → recruitment pipeline (device-local, no roster/pipeline write API) and
// a "reached out" notification via the real pushNotification API. The right rail
// is the AI-recruiter panel (recruiterResponse), which recommends specialists for
// your sharpest gap and answers preset asks. Mirrors the prototype isHAgents.
//
// Agent source: the api.ts contract exposes no list-doctors read endpoint, so we
// rank the seeded free-agent pool (SEED_AGENTS) — the prototype's _baseAgents.
// A doctor signing up (POST /api/accounts role=doctor) is flagged recruitable
// server-side; surfacing that list is left to the integration phase.

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  UserList,
  CaretRight,
  GitBranch,
  Target,
  Briefcase,
  SuitcaseSimple,
  VideoCamera,
  PaperPlaneTilt,
  CheckCircle,
  Sparkle,
  LightbulbFilament,
  User,
  ArrowRight,
  ArrowLeft,
  FloppyDisk,
  Info,
} from '@phosphor-icons/react';
import { Card, CardContent, Skeleton } from '@databricks/appkit-ui/react';
import {
  useDistrictDemand,
  useSearchFacilities,
  pushNotification,
} from '@/lib/api';
import { fonts, neutral, role } from '@/components/asclepius';
import {
  DISCIPLINES,
  HOSPITAL_STATE,
  CITY_DISTRICT,
  SEED_AGENTS,
  CHAT_CHIPS,
  type SeedAgent,
  loadCity,
  loadRoster,
  loadPipeline,
  savePipeline,
  indexDemand,
  computeCoverageRows,
  subNeedFor,
  recruiterResponse,
  isProxyDemand,
} from './hospitalData';

const HOSP = role.hospital.base;

/** Low-emphasis "proxy estimate" marker — flags a gap whose demand is derived
 * from a proxy signal (district_demand.top_driver begins "(proxy)"). */
function ProxyBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span
      title="This gap's demand is derived from a proxy signal, not a directly observed driver — treat as an estimate."
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

export function HospitalRecruiter() {
  const [searchParams] = useSearchParams();
  const city = loadCity();
  const roster = loadRoster();
  const district = CITY_DISTRICT[city];

  const [focusSpec, setFocusSpec] = useState<string | null>(() => searchParams.get('spec'));
  const [pipeline, setPipeline] = useState<string[]>(() => loadPipeline());
  const [chatKey, setChatKey] = useState<string | null>(null);
  const [recruiting, setRecruiting] = useState<string | null>(null);

  // Keep focusSpec in sync if the user arrives via a ?spec= deep link change.
  useEffect(() => {
    setFocusSpec(searchParams.get('spec'));
  }, [searchParams]);

  const { data: demandRows, loading: demandLoading } = useDistrictDemand({ district, state: HOSPITAL_STATE });
  const { data: facilities, loading: facLoading } = useSearchFacilities({ state: HOSPITAL_STATE, district, limit: 200 });

  const demand = useMemo(() => indexDemand(demandRows), [demandRows]);

  const facCountByDiscipline = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of DISCIPLINES) {
      m.set(d, (facilities ?? []).filter((f) => (f.specialties ?? []).includes(d)).length);
    }
    return m;
  }, [facilities]);

  const rows = useMemo(
    () => computeCoverageRows(city, roster, demand, facCountByDiscipline),
    [city, roster, demand, facCountByDiscipline],
  );
  const weakSet = useMemo(() => new Set(rows.filter((r) => r.gap >= 10).map((r) => r.discipline)), [rows]);

  // Rank the agent pool: weak-point match (+60), sub fit (+28), demand share,
  // relocate (+8), telehealth (+5). Mirrors the prototype's relevance score.
  const ranked = useMemo(() => {
    return SEED_AGENTS.map((a) => {
      const matchesWeak = weakSet.has(a.spec);
      const neededSub = subNeedFor(city, a.spec, demand);
      const subMatch = !!(neededSub && a.subs.includes(neededSub));
      const dem = rows.find((r) => r.discipline === a.spec)?.demand ?? 42;
      const relevance =
        (matchesWeak ? 60 : 0) + (subMatch ? 28 : 0) + Math.round(dem * 0.3) + (a.relocate ? 8 : 0) + (a.tele ? 5 : 0);
      return { a, matchesWeak, subMatch, neededSub, relevance };
    })
      .filter((x) => (focusSpec ? x.a.spec === focusSpec : true))
      .sort((x, y) => y.relevance - x.relevance);
  }, [weakSet, city, demand, rows, focusSpec]);

  const recruiterMsg = useMemo(
    () => recruiterResponse(chatKey, city, rows, SEED_AGENTS, demand),
    [chatKey, city, rows, demand],
  );

  // Flag the default "sharpest gap" message when that gap's demand is proxy-derived.
  const sharpestGapProxy = useMemo(() => {
    if (chatKey) return false;
    const top = rows.find((r) => r.gap >= 10);
    return !!top && isProxyDemand(top.discipline, demand);
  }, [chatKey, rows, demand]);

  const recruit = useCallback(
    async (agent: SeedAgent) => {
      const has = pipeline.includes(agent.id);
      const next = has ? pipeline.filter((id) => id !== agent.id) : [...pipeline, agent.id];
      setPipeline(next);
      savePipeline(next);
      if (!has) {
        setRecruiting(agent.id);
        try {
          await pushNotification({
            type: 'reach',
            notif_key: `reach_${agent.id}`,
            text: `You reached out to ${agent.name} (${agent.spec}). They've been notified.`,
          });
        } catch {
          /* notification is best-effort — pipeline state already saved */
        } finally {
          setRecruiting(null);
        }
      }
    },
    [pipeline],
  );

  // Spec filter chips: All + each discipline that has a seeded agent.
  const specChips = useMemo(
    () => ['All', ...Array.from(new Set(SEED_AGENTS.map((a) => a.spec)))],
    [],
  );

  const loading = demandLoading || facLoading;
  const title = focusSpec ? `Free agents · ${focusSpec}` : 'Free agents matched to your gaps';
  const sub = `${ranked.length} available ${ranked.length === 1 ? 'clinician' : 'clinicians'}${focusSpec ? '' : ' · prioritised by your weak points'}`;

  const availMeta = (avail: string) =>
    avail === 'Full-time'
      ? { c: '#2E7D67', bg: '#E4EFEA' }
      : avail === 'Locum'
        ? { c: '#9A6A12', bg: '#F6EBD6' }
        : { c: HOSP, bg: role.hospital.tint };

  return (
    <div style={{ flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto', padding: '30px 30px 70px', animation: 'ascFade .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', margin: 0, color: neutral.ink }}>{title}</h2>
          <p style={{ fontSize: 15, color: neutral.textSoft, margin: '6px 0 0' }}>{sub}</p>
        </div>
        <Link
          to="/report"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: role.hospital.tint, color: HOSP, border: `1px solid ${role.hospital.border}`, borderRadius: 12, padding: '10px 15px', font: `700 14px ${fonts.body}`, cursor: 'pointer', textDecoration: 'none' }}
        >
          <UserList weight="fill" />
          {pipeline.length} in pipeline
          <CaretRight weight="bold" size={13} />
        </Link>
      </div>

      {/* Spec filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
        {specChips.map((sp) => {
          const sel = (sp === 'All' && !focusSpec) || focusSpec === sp;
          return (
            <button
              key={sp}
              type="button"
              onClick={() => setFocusSpec(sp === 'All' ? null : sp)}
              style={{
                border: `1.5px solid ${sel ? HOSP : neutral.border}`,
                background: sel ? `${HOSP}18` : neutral.surface,
                color: sel ? HOSP : neutral.textStrong,
                borderRadius: 999,
                padding: '11px 17px',
                font: `${sel ? 600 : 500} 14.5px ${fonts.body}`,
                cursor: 'pointer',
              }}
            >
              {sp}
            </button>
          );
        })}
      </div>

      <div className="max-md:!grid-cols-1" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)', gap: 24, alignItems: 'start', marginTop: 20 }}>
        {/* Agent list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            ['s1', 's2', 's3', 's4'].map((sk) => (
              <Skeleton key={sk} style={{ height: 150, width: '100%', borderRadius: 20 }} />
            ))
          ) : ranked.length === 0 ? (
            <Card style={{ border: `1px solid ${neutral.borderCard}`, borderRadius: 20 }}>
              <CardContent style={{ padding: 28 }}>
                <div style={{ fontSize: 15, color: neutral.textSoft }}>
                  No free agents in the pool match {focusSpec}. Clear the filter to see clinicians for your other gaps.
                </div>
              </CardContent>
            </Card>
          ) : (
            ranked.map(({ a, matchesWeak, subMatch, neededSub }) => {
              const inPipe = pipeline.includes(a.id);
              const am = availMeta(a.avail);
              return (
                <Card key={a.id} style={{ border: `1px solid ${neutral.borderCard}`, borderRadius: 20, boxShadow: '0 1px 2px rgba(43,39,34,.04)' }}>
                  <CardContent style={{ padding: '20px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                        <span style={{ width: 44, height: 44, borderRadius: '50%', background: role.hospital.tint, color: HOSP, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 17px ${fonts.display}`, flexShrink: 0 }}>
                          {a.name.replace('Dr. ', '').charAt(0)}
                        </span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ font: `700 17px ${fonts.body}`, color: neutral.ink }}>{a.name}</span>
                            {subMatch && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#E4EFEA', color: '#2E7D67', borderRadius: 999, padding: '4px 10px', font: `600 11.5px ${fonts.body}` }}>
                                <GitBranch weight="fill" />
                                {neededSub} fit
                              </span>
                            )}
                            {matchesWeak && !subMatch && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F6E2DC', color: '#B2503C', borderRadius: 999, padding: '4px 10px', font: `600 11.5px ${fonts.body}` }}>
                                <Target weight="fill" />
                                Fills a gap
                              </span>
                            )}
                            {matchesWeak && isProxyDemand(a.spec, demand) && <ProxyBadge />}
                          </div>
                          <div style={{ fontSize: 13.5, color: HOSP, fontWeight: 600, marginTop: 2 }}>
                            {a.spec} · <span style={{ color: neutral.textFaint, fontWeight: 500 }}>{a.sub}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: neutral.textDisabled, fontWeight: 500, marginTop: 2 }}>
                            {a.years} yrs · {a.city}
                          </div>
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: 14, color: neutral.textMuted, lineHeight: 1.5, margin: '13px 0 0' }}>{a.blurb}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, paddingTop: 15, borderTop: `1px solid ${neutral.divider2}`, gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: am.bg, color: am.c, borderRadius: 999, padding: '5px 10px', font: `600 12px ${fonts.body}` }}>
                          <Briefcase weight="fill" />
                          {a.avail}
                        </span>
                        {a.relocate && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: neutral.bgSunken, color: neutral.textMuted, borderRadius: 999, padding: '5px 10px', font: `600 12px ${fonts.body}` }}>
                            <SuitcaseSimple weight="fill" />
                            Open to relocate
                          </span>
                        )}
                        {a.tele && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: neutral.bgSunken, color: neutral.textMuted, borderRadius: 999, padding: '5px 10px', font: `600 12px ${fonts.body}` }}>
                            <VideoCamera weight="fill" />
                            Telehealth
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void recruit(a)}
                        disabled={recruiting === a.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 7,
                          background: inPipe ? role.hospital.tint : HOSP,
                          color: inPipe ? HOSP : '#fff',
                          border: inPipe ? '1px solid #C9DBEE' : 'none',
                          borderRadius: 11,
                          padding: '9px 15px',
                          font: `600 13.5px ${fonts.body}`,
                          cursor: recruiting === a.id ? 'wait' : 'pointer',
                          opacity: recruiting === a.id ? 0.7 : 1,
                        }}
                      >
                        {inPipe ? <CheckCircle weight="fill" size={16} /> : <PaperPlaneTilt weight="fill" size={16} />}
                        {inPipe ? 'In pipeline' : 'Recruit'}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* AI recruiter panel */}
        <div style={{ position: 'sticky', top: 88 }}>
          <Card style={{ border: '1px solid #DDE6EF', borderRadius: 22, overflow: 'hidden', boxShadow: '0 1px 2px rgba(43,39,34,.04),0 22px 46px -32px rgba(43,39,34,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 20px', background: role.hospital.tint2, borderBottom: '1px solid #E6EDF5' }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: HOSP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkle weight="fill" color="#fff" size={19} />
              </span>
              <div>
                <div style={{ font: `700 15px ${fonts.body}`, color: neutral.ink, display: 'flex', alignItems: 'center', gap: 7 }}>
                  Asclepius Recruiter
                  <span style={{ font: `700 9.5px ${fonts.body}`, letterSpacing: '.06em', background: role.hospital.tint, color: HOSP, borderRadius: 5, padding: '2px 5px' }}>AI</span>
                </div>
                <div style={{ fontSize: 12, color: neutral.textFaint }}>Recommends free agents for your gaps</div>
              </div>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ background: '#F4F7FB', border: '1px solid #E6EDF5', borderRadius: '4px 16px 16px 16px', padding: '15px 16px' }}>
                <div style={{ font: `700 15px ${fonts.body}`, color: neutral.ink, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <LightbulbFilament weight="fill" color="#C99A2E" />
                  {recruiterMsg.title}
                  {sharpestGapProxy && <ProxyBadge />}
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: neutral.textStrong, margin: 0 }}>{recruiterMsg.body}</p>
                {recruiterMsg.agents.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 13 }}>
                    {recruiterMsg.agents.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setFocusSpec(g.spec)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #D6E0EC', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ width: 30, height: 30, borderRadius: '50%', background: role.hospital.tint, color: HOSP, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <User weight="fill" />
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', font: `700 13.5px ${fonts.body}`, color: neutral.ink }}>{g.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: neutral.textFaint }}>{g.spec} · {g.sub}</span>
                        </span>
                        <ArrowRight weight="bold" color={HOSP} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ font: `600 12px ${fonts.body}`, color: neutral.textDisabled, textTransform: 'uppercase', letterSpacing: '.06em', margin: '16px 0 9px' }}>
                Ask the recruiter
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CHAT_CHIPS.map((c) => {
                  const sel = chatKey === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setChatKey(sel ? null : c.key)}
                      style={{
                        border: `1px solid ${sel ? HOSP : '#D6E0EC'}`,
                        background: sel ? HOSP : '#fff',
                        color: sel ? '#fff' : HOSP,
                        borderRadius: 999,
                        padding: '7px 13px',
                        font: `600 12.5px ${fonts.body}`,
                        cursor: 'pointer',
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '0 4px' }}>
            <Link
              to="/hospital/coverage"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', font: `600 14px ${fonts.body}`, color: neutral.textSoft, padding: 0, textDecoration: 'none' }}
            >
              <ArrowLeft weight="bold" />
              Back to coverage
            </Link>
            <span style={{ fontSize: 12, color: neutral.textDisabled, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FloppyDisk />
              Pipeline saved on this device
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HospitalRecruiter;
