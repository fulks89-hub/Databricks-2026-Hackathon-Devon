// Board Report (/report) — printable coverage & recruitment plan.
//
// A print-optimised summary (window.print; the .asc-noprint chrome is hidden by
// the @media print rule in index.css) of the hospital's roster total, unfilled
// high-burden disciplines, pipeline count, local disease burden, and a priority-
// gaps table with a recommended hire from the free-agent pool. Mirrors isReport.
//
// Gaps = disciplines with demand ≥ 60 and nobody on staff, worst-demand first
// (the prototype's report.gaps filter). Demand comes from the real
// useDistrictDemand(...) rows for the city's district, with a seed fallback.

import { useMemo } from 'react';
import { Link } from 'react-router';
import { Heartbeat, Pulse, Printer, ArrowLeft, Info } from '@phosphor-icons/react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { useDistrictDemand } from '@/lib/api';
import { fonts, neutral } from '@/components/asclepius';
import {
  DISCIPLINES,
  HOSPITAL_STATE,
  CITY_DISTRICT,
  SEED_AGENTS,
  loadCity,
  loadRoster,
  loadPipeline,
  loadScenarios,
  rosterTotal,
  indexDemand,
  demandFor,
  subNeedFor,
  driversFor,
  isProxyDemand,
  isProxyDriver,
  stripProxy,
} from './hospitalData';

const HOSP = '#3B6FB0';

/** Low-emphasis "proxy estimate" marker for proxy-derived demand/drivers. */
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
        padding: '1px 6px',
        font: `600 10px ${fonts.body}`,
        ...style,
      }}
    >
      <Info weight="fill" size={10} />
      proxy estimate
    </span>
  );
}

export function BoardReport() {
  const city = loadCity();
  const roster = loadRoster();
  const pipeline = loadPipeline();
  const scenarios = loadScenarios();
  const district = CITY_DISTRICT[city];

  const { data: demandRows, loading } = useDistrictDemand({ district, state: HOSPITAL_STATE });
  const demand = useMemo(() => indexDemand(demandRows), [demandRows]);

  const totalStaff = rosterTotal(roster);
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const driverList = useMemo(() => driversFor(city, demand), [city, demand]);
  const drivers = useMemo(() => driverList.map(stripProxy).join('; '), [driverList]);
  const hasProxyDriver = useMemo(() => driverList.some(isProxyDriver), [driverList]);

  // Priority gaps: demand ≥ 60 & nobody on staff, sorted worst-demand first.
  const gaps = useMemo(() => {
    return DISCIPLINES.map((d) => ({
      discipline: d,
      demand: demandFor(city, d, demand),
      sub: subNeedFor(city, d, demand),
      have: roster[d] || 0,
    }))
      .filter((x) => x.demand >= 60 && x.have === 0)
      .sort((a, b) => b.demand - a.demand)
      .map((g) => {
        // Recommended hire: an agent whose sub matches the specific need, else
        // any agent in the discipline, else "none in pool".
        const exact = SEED_AGENTS.find((a) => a.spec === g.discipline && a.subs.includes(g.sub));
        const any = SEED_AGENTS.find((a) => a.spec === g.discipline);
        const rec = (exact ?? any)?.name ?? '— none in pool';
        return { ...g, rec };
      });
  }, [city, roster, demand]);

  return (
    <div style={{ flex: 1, width: '100%', background: '#fff' }}>
      {/* Print chrome (hidden when printing) */}
      <div className="asc-noprint" style={{ maxWidth: 820, margin: '0 auto', padding: '20px 40px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link
          to="/hospital/coverage"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', font: `600 14px ${fonts.body}`, color: neutral.textSoft, padding: '6px 0', textDecoration: 'none' }}
        >
          <ArrowLeft weight="bold" />
          Back
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: HOSP, color: '#fff', border: 'none', borderRadius: 11, padding: '11px 18px', font: `700 14px ${fonts.body}`, cursor: 'pointer' }}
        >
          <Printer weight="fill" />
          Print / Save PDF
        </button>
      </div>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '30px 40px 70px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, borderBottom: `2px solid ${neutral.ink}`, paddingBottom: 16 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: '#2E7D67', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Heartbeat weight="fill" color="#fff" size={21} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, color: neutral.ink }}>Coverage &amp; recruitment plan</div>
            <div style={{ fontSize: 13, color: neutral.textSoft }}>{city} district · prepared {date}</div>
          </div>
        </div>

        {/* KPI band */}
        <div style={{ display: 'flex', gap: 30, marginTop: 22 }}>
          <div>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, color: neutral.ink }}>{totalStaff}</div>
            <div style={{ fontSize: 12.5, color: neutral.textSoft }}>clinical staff on roster</div>
          </div>
          <div style={{ width: 1, background: neutral.borderCard }} />
          <div>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, color: '#B2503C' }}>
              {loading ? '—' : gaps.length}
            </div>
            <div style={{ fontSize: 12.5, color: neutral.textSoft }}>unfilled high-burden disciplines</div>
          </div>
          <div style={{ width: 1, background: neutral.borderCard }} />
          <div>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, color: HOSP }}>{pipeline.length}</div>
            <div style={{ fontSize: 12.5, color: neutral.textSoft }}>candidates in pipeline</div>
          </div>
        </div>

        {/* Disease burden callout */}
        <div style={{ marginTop: 20, background: '#FBF6EE', border: '1px solid #EFE3CF', borderRadius: 12, padding: '13px 16px', fontSize: 13.5, color: '#9A6A12', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Pulse weight="fill" />
          Local disease burden: {loading && !drivers ? '…' : drivers || 'no modelled drivers for this district'}
          {hasProxyDriver && <ProxyBadge />}
        </div>

        {/* Priority gaps table */}
        <div style={{ font: `700 13px ${fonts.body}`, color: neutral.textFaint2, textTransform: 'uppercase', letterSpacing: '.06em', margin: '26px 0 12px' }}>
          Priority gaps &amp; recommended hires
        </div>
        <div style={{ border: `1px solid ${neutral.borderCard}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr .6fr 1.2fr', background: neutral.surfaceWarm, borderBottom: `1px solid ${neutral.borderCard}`, padding: '11px 16px', font: `700 11.5px ${fonts.body}`, color: neutral.textFaint, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <span>Discipline</span>
            <span>Specific need</span>
            <span>Demand</span>
            <span>Recommended hire</span>
          </div>
          {loading ? (
            <div style={{ padding: 16 }}>
              <Skeleton style={{ height: 16, width: '100%', marginBottom: 10 }} />
              <Skeleton style={{ height: 16, width: '100%' }} />
            </div>
          ) : gaps.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 13.5, color: neutral.textSoft }}>
              No unfilled high-burden disciplines for {city} with the current roster — coverage is on track.
            </div>
          ) : (
            gaps.map((g) => (
              <div key={g.discipline} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr .6fr 1.2fr', padding: '12px 16px', borderBottom: `1px solid ${neutral.divider3}`, alignItems: 'center' }}>
                <span style={{ font: `700 14px ${fonts.body}`, color: neutral.ink }}>{g.discipline}</span>
                <span style={{ fontSize: 13, color: neutral.textMuted }}>{g.sub}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ font: `700 13px ${fonts.body}`, color: '#B2503C' }}>{g.demand}</span>
                  {isProxyDemand(g.discipline, demand) && <ProxyBadge />}
                </span>
                <span style={{ fontSize: 13, color: '#2E7D67', fontWeight: 600 }}>{g.rec}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 24, fontSize: 11.5, color: neutral.textDisabled, lineHeight: 1.5 }}>
          Generated by Asclepius from the facility registry and modelled local disease burden. Figures are demo estimates —
          confirm against district health data before acting. {scenarios.length} saved scenario(s) on file.
        </div>
      </div>
    </div>
  );
}

export default BoardReport;
