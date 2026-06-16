// Hospital · Roster (/hospital/roster) — StepRail 1/3.
//
// Pick the hospital city + per-discipline headcount via − / + steppers, import a
// sample CSV roster, and snapshot the city+roster as a named what-if scenario you
// can reload and compare. Mirrors the prototype's isHRoster screen.
//
// Persistence: the api.ts contract exposes NO roster/scenario write endpoints
// (only postings/applications/notifications/accounts), so roster + scenarios
// persist device-local via hospitalData.ts (the prototype's "saved on this
// device" model). Demand for the scenario gap count comes from the real
// useDistrictDemand(...) rows for the city's district, with a seed fallback.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  MapPin,
  UsersThree,
  UploadSimple,
  Stack,
  FloppyDisk,
  Scales,
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  Trash,
  IdentificationCard,
  Plus,
} from '@phosphor-icons/react';
import { Card, CardContent, Button, Input, Skeleton } from '@databricks/appkit-ui/react';
import { useDistrictDemand } from '@/lib/api';
import { fonts, neutral, role } from '@/components/asclepius';
import {
  DISCIPLINES,
  HOSPITAL_CITIES,
  HOSPITAL_STATE,
  CITY_DISTRICT,
  SAMPLE_ROSTER,
  type Roster,
  type Scenario,
  type RosterMember,
  loadRoster,
  saveRoster,
  loadCity,
  saveCity,
  loadScenarios,
  saveScenarios,
  loadRegistrations,
  saveRegistrations,
  rosterTotal,
  scenarioGaps,
  indexDemand,
  demandFor,
} from './hospitalData';

const HOSP = role.hospital.base; // #3B6FB0

export function HospitalRoster() {
  const navigate = useNavigate();
  const [city, setCity] = useState<string>(() => loadCity());
  const [roster, setRoster] = useState<Roster>(() => loadRoster());
  const [scenarios, setScenarios] = useState<Scenario[]>(() => loadScenarios());
  const [scenarioName, setScenarioName] = useState('');

  // Registered doctors on staff, captured by NMC / IMR registration number.
  const [members, setMembers] = useState<RosterMember[]>(() => loadRegistrations());
  const [regInput, setRegInput] = useState('');
  const [regDiscipline, setRegDiscipline] = useState('');

  // Real modelled demand for this city's district (seed fallback in hospitalData).
  const district = CITY_DISTRICT[city];
  const { data: demandRows, loading: demandLoading, error: demandError } = useDistrictDemand({
    district,
    state: HOSPITAL_STATE,
  });
  const demand = useMemo(() => indexDemand(demandRows), [demandRows]);

  // --- mutations (all device-local) ---
  const pickCity = (c: string) => {
    setCity(c);
    saveCity(c);
  };
  const adjust = (d: string, delta: number) => {
    setRoster((prev) => {
      const cur = prev[d] || 0;
      const next = Math.max(0, Math.min(30, cur + delta));
      const updated = { ...prev, [d]: next };
      saveRoster(updated);
      return updated;
    });
  };
  const importRoster = () => {
    setRoster(SAMPLE_ROSTER);
    saveRoster(SAMPLE_ROSTER);
  };
  // Add a doctor to the roster by registration number (dedup case-insensitively).
  const addMember = () => {
    const regNo = regInput.trim();
    if (!regNo) return;
    if (members.some((m) => m.regNo.toLowerCase() === regNo.toLowerCase())) {
      setRegInput('');
      return;
    }
    const updated: RosterMember[] = [{ regNo, discipline: regDiscipline }, ...members];
    setMembers(updated);
    saveRegistrations(updated);
    setRegInput('');
  };
  const removeMember = (regNo: string) => {
    const updated = members.filter((m) => m.regNo !== regNo);
    setMembers(updated);
    saveRegistrations(updated);
  };
  const saveScenario = () => {
    const name = scenarioName.trim() || `${city} — ${rosterTotal(roster)} staff`;
    const next: Scenario = {
      id: 'sc_' + Date.now(),
      name,
      city,
      roster: { ...roster },
      gaps: scenarioGaps(city, roster, demand),
    };
    const updated = [next, ...scenarios];
    setScenarios(updated);
    saveScenarios(updated);
    setScenarioName('');
  };
  const loadScenario = (sc: Scenario) => {
    setCity(sc.city);
    saveCity(sc.city);
    setRoster({ ...sc.roster });
    saveRoster({ ...sc.roster });
  };
  const removeScenario = (id: string) => {
    const updated = scenarios.filter((s) => s.id !== id);
    setScenarios(updated);
    saveScenarios(updated);
  };

  // --- scenario compare (two latest), mirrors scenCmp ---
  const scenCmp = useMemo(() => {
    if (scenarios.length < 2) return null;
    const A = scenarios[0];
    const B = scenarios[1];
    const rows = DISCIPLINES.filter(
      (d) => demandFor(A.city, d, demand) >= 60 || (A.roster[d] || 0) > 0 || (B.roster[d] || 0) > 0,
    ).map((d) => {
      const dem = demandFor(A.city, d, demand);
      const a = A.roster[d] || 0;
      const b = B.roster[d] || 0;
      const delta = b - a;
      const valColor = (n: number) => (n > 0 ? neutral.text : dem >= 70 ? '#B2503C' : neutral.textFaint);
      return {
        name: d,
        a,
        b,
        aColor: valColor(a),
        bColor: valColor(b),
        deltaText: (delta > 0 ? '+' : '') + delta,
        deltaColor: delta > 0 ? '#2E7D67' : delta < 0 ? '#B2503C' : neutral.textDisabled,
      };
    });
    return { aName: A.name, bName: B.name, rows };
  }, [scenarios, demand]);

  const total = rosterTotal(roster);

  return (
    <div
      style={{
        flex: 1,
        maxWidth: 940,
        width: '100%',
        margin: '0 auto',
        padding: '46px 40px 80px',
        animation: 'ascFade .45s ease both',
      }}
    >
      <div style={{ font: `600 13px ${fonts.body}`, color: HOSP, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        Step 1 of 3
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 40, letterSpacing: '-.025em', margin: '8px 0 0', color: neutral.ink }}>
        Your hospital roster
      </h2>
      <p style={{ fontSize: 17, color: neutral.textMuted, margin: '10px 0 0', maxWidth: '38em' }}>
        Pick your location and tell us who&apos;s on staff. We weigh it against the diseases driving demand around you — then
        find free agents for the gaps.
      </p>

      {/* Location + roster card */}
      <Card style={{ marginTop: 28, border: `1px solid ${neutral.borderCard}`, borderRadius: 22 }}>
        <CardContent style={{ padding: 26 }}>
          <div style={{ font: `700 14px ${fonts.body}`, color: neutral.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin weight="fill" color={HOSP} />
            Your hospital&apos;s location · {HOSPITAL_STATE}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {HOSPITAL_CITIES.map((c) => {
              const sel = city === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickCity(c)}
                  style={{
                    border: `1px solid ${sel ? HOSP : neutral.border}`,
                    background: sel ? role.hospital.tint : neutral.surface,
                    color: sel ? HOSP : neutral.textMuted,
                    borderRadius: 999,
                    padding: '8px 15px',
                    font: `${sel ? 600 : 500} 13.5px ${fonts.body}`,
                    cursor: 'pointer',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: neutral.divider, margin: '24px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div style={{ font: `700 14px ${fonts.body}`, color: neutral.text, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UsersThree weight="fill" color={HOSP} />
              Disciplines on staff
              <span style={{ fontWeight: 500, color: neutral.textDisabled, fontSize: 13 }}>— tap − / + to set headcount</span>
            </div>
            <button
              type="button"
              onClick={importRoster}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: role.hospital.tint,
                color: HOSP,
                border: `1px solid ${role.hospital.border}`,
                borderRadius: 11,
                padding: '9px 14px',
                font: `600 13.5px ${fonts.body}`,
                cursor: 'pointer',
              }}
            >
              <UploadSimple weight="fill" />
              Import roster (CSV)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
            {DISCIPLINES.map((d) => {
              const n = roster[d] || 0;
              const on = n > 0;
              return (
                <div
                  key={d}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '11px 14px',
                    borderRadius: 13,
                    border: `1px solid ${on ? '#DDE6EF' : '#EFE8DD'}`,
                    background: on ? role.hospital.tint2 : '#FBF8F3',
                  }}
                >
                  <span style={{ font: `600 14.5px ${fonts.body}`, color: neutral.text }}>{d}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => adjust(d, -1)}
                      aria-label={`Decrease ${d}`}
                      style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #D6E0EC', background: '#fff', color: HOSP, fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      −
                    </button>
                    <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, color: on ? neutral.ink : '#C2B6A2', minWidth: 20, textAlign: 'center' }}>
                      {n}
                    </span>
                    <button
                      type="button"
                      onClick={() => adjust(d, 1)}
                      aria-label={`Increase ${d}`}
                      style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #D6E0EC', background: HOSP, color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: neutral.textFaint2 }}>
            {total} clinical staff on roster
            {demandError ? ' · using illustrative burden weights' : ''}
          </div>
        </CardContent>
      </Card>

      {/* Registered doctors on staff — captured by NMC / IMR registration number */}
      <Card style={{ marginTop: 18, border: `1px solid ${neutral.borderCard}`, borderRadius: 22 }}>
        <CardContent style={{ padding: 24 }}>
          <div style={{ font: `700 14px ${fonts.body}`, color: neutral.text, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <IdentificationCard weight="fill" color={HOSP} />
            Registered doctors on staff
            <span style={{ fontWeight: 500, color: neutral.textDisabled, fontSize: 13 }}>— add by NMC registration no.</span>
          </div>
          <div style={{ fontSize: 13, color: neutral.textFaint, marginBottom: 13 }}>
            Enter each doctor&apos;s Indian Medical Register (IMR) number, and optionally tag their discipline. Saved on this device.
          </div>

          {/* optional discipline tag (single-select; click again to clear) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {DISCIPLINES.map((d) => {
              const sel = regDiscipline === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRegDiscipline((cur) => (cur === d ? '' : d))}
                  style={{
                    border: `1px solid ${sel ? HOSP : neutral.border}`,
                    background: sel ? role.hospital.tint : neutral.surface,
                    color: sel ? HOSP : neutral.textMuted,
                    borderRadius: 999,
                    padding: '6px 12px',
                    font: `${sel ? 600 : 500} 12.5px ${fonts.body}`,
                    cursor: 'pointer',
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <Input
              value={regInput}
              onChange={(e) => setRegInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addMember();
              }}
              placeholder="e.g. 4447 — IMR registration no."
              style={{ flex: 1, background: neutral.surfaceWarm }}
            />
            <Button
              type="button"
              onClick={addMember}
              disabled={!regInput.trim()}
              style={{ background: HOSP, color: '#fff', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Plus weight="bold" />
              Add
            </Button>
          </div>

          {members.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {members.map((m) => (
                <div
                  key={m.regNo}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #E6EDF5', borderRadius: 12, padding: '10px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <IdentificationCard weight="fill" size={18} color={HOSP} />
                    <span style={{ font: `700 14.5px ${fonts.body}`, color: neutral.ink }}>{m.regNo}</span>
                    {m.discipline && (
                      <span style={{ background: role.hospital.tint, color: HOSP, borderRadius: 999, padding: '3px 10px', font: `600 12px ${fonts.body}` }}>
                        {m.discipline}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(m.regNo)}
                    aria-label={`Remove ${m.regNo}`}
                    style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${neutral.border}`, background: '#fff', color: '#8A8174', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Trash />
                  </button>
                </div>
              ))}
              <div style={{ marginTop: 4, fontSize: 12, color: neutral.textFaint2 }}>
                {members.length} registered doctor{members.length === 1 ? '' : 's'} on roster
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save as scenario */}
      <Card style={{ marginTop: 18, border: `1px solid ${neutral.borderCard}`, borderRadius: 22 }}>
        <CardContent style={{ padding: 24 }}>
          <div style={{ font: `700 14px ${fonts.body}`, color: neutral.text, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Stack weight="fill" color={HOSP} />
            Save this as a scenario
          </div>
          <div style={{ fontSize: 13, color: neutral.textFaint, marginBottom: 13 }}>
            Snapshot this city + roster as a named what-if you can reload and compare.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder="e.g. Latur — add 2 cardiologists"
              style={{ flex: 1, background: neutral.surfaceWarm }}
            />
            <Button
              type="button"
              onClick={saveScenario}
              style={{ background: HOSP, color: '#fff', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <FloppyDisk weight="fill" />
              Save
            </Button>
          </div>

          {scenarios.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {scenarios.map((sc) => (
                <div
                  key={sc.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #E6EDF5', borderRadius: 12, padding: '11px 14px' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: `700 14.5px ${fonts.body}`, color: neutral.ink }}>{sc.name}</div>
                    <div style={{ fontSize: 12, color: neutral.textFaint, marginTop: 1 }}>
                      {sc.city} · {rosterTotal(sc.roster)} staff · {sc.gaps} high-burden gap{sc.gaps === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => loadScenario(sc)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: role.hospital.tint, color: HOSP, border: `1px solid ${role.hospital.border}`, borderRadius: 10, padding: '8px 13px', font: `600 13px ${fonts.body}`, cursor: 'pointer' }}
                    >
                      <ArrowCounterClockwise weight="bold" />
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => removeScenario(sc.id)}
                      aria-label="Remove scenario"
                      style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${neutral.border}`, background: '#fff', color: '#8A8174', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Trash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenario compare (two latest) */}
      {scenCmp && (
        <Card style={{ marginTop: 18, border: `1px solid ${neutral.borderCard}`, borderRadius: 22 }}>
          <CardContent style={{ padding: 24 }}>
            <div style={{ font: `700 14px ${fonts.body}`, color: neutral.text, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
              <Scales weight="fill" color={HOSP} />
              Compare your two latest scenarios
            </div>
            <div style={{ border: `1px solid ${neutral.divider2}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr .55fr .55fr .5fr', background: neutral.surfaceWarm, borderBottom: `1px solid ${neutral.divider2}`, padding: '10px 14px', font: `700 11.5px ${fonts.body}`, color: neutral.textFaint }}>
                <span>Discipline</span>
                <span style={{ textAlign: 'center' }}>{scenCmp.aName}</span>
                <span style={{ textAlign: 'center' }}>{scenCmp.bName}</span>
                <span style={{ textAlign: 'center' }}>Δ</span>
              </div>
              {scenCmp.rows.map((r) => (
                <div
                  key={r.name}
                  style={{ display: 'grid', gridTemplateColumns: '1.4fr .55fr .55fr .5fr', padding: '9px 14px', borderBottom: `1px solid ${neutral.divider3}`, alignItems: 'center' }}
                >
                  <span style={{ font: `600 13px ${fonts.body}`, color: neutral.text }}>{r.name}</span>
                  <span style={{ textAlign: 'center', font: `700 13.5px ${fonts.body}`, color: r.aColor }}>{r.a}</span>
                  <span style={{ textAlign: 'center', font: `700 13.5px ${fonts.body}`, color: r.bColor }}>{r.b}</span>
                  <span style={{ textAlign: 'center', font: `700 13px ${fonts.body}`, color: r.deltaColor }}>{r.deltaText}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {demandLoading && (
        <div style={{ marginTop: 16 }}>
          <Skeleton style={{ height: 14, width: 240 }} />
        </div>
      )}

      {/* Footer nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
        <button
          type="button"
          onClick={() => void navigate('/')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'none', border: '1.5px solid #DCE3EC', borderRadius: 14, padding: '15px 22px', font: `600 15px ${fonts.body}`, color: neutral.textSoft, cursor: 'pointer' }}
        >
          <ArrowLeft weight="bold" />
          Back
        </button>
        <Link
          to="/hospital/coverage"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: HOSP, color: '#fff', border: 'none', borderRadius: 14, padding: '16px 28px', font: `700 16px ${fonts.body}`, cursor: 'pointer', boxShadow: '0 12px 26px -10px rgba(59,111,176,.6)', textDecoration: 'none' }}
        >
          Analyse coverage
          <ArrowRight weight="bold" />
        </Link>
      </div>
    </div>
  );
}

export default HospitalRoster;
