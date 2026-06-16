// ============================================================================
// Hospital screens — shared domain data + coverage/recruiting math.
//
// The prototype (Asclepius.dc.html) drove the hospital flow off hardcoded
// `DISCIPLINES`, `SUBS`, `BURDEN`, and `_baseAgents` constants plus the
// `demandFor` / `subNeedFor` / coverage / `recruiterResponse` helpers. We port
// those here verbatim so the Roster → Coverage → Recruiter → Board Report flow
// reproduces the prototype's scoring exactly, and bridge them to the real
// Lakebase `useDistrictDemand(...)` rows where available (real demand_score /
// top_driver overrides the seed BURDEN when a city's district is present).
//
// Persistence: the prototype kept roster / scenarios / pipeline in localStorage
// ("saved on this device"). The api.ts contract exposes NO roster/scenario/
// pipeline write endpoints (only postings/applications/notifications/accounts),
// so we keep that same device-local model here via the small typed helpers
// below. Postings persist through the real createPosting / fetchPostings API.
// ============================================================================

import type { DistrictDemandRow } from '@/lib/api';

// ---- The 9 disciplines (DISCIPLINES, prototype line ~1636) -----------------
export const DISCIPLINES = [
  'Cardiology',
  'Nephrology',
  'Oncology',
  'Obstetrics',
  'Pediatrics',
  'Orthopedics',
  'Trauma',
  'Ophthalmology',
  'General Medicine',
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

// ---- Sub-specialties per discipline (SUBS) ---------------------------------
export const SUBS: Record<string, string[]> = {
  Cardiology: ['Heart failure', 'Interventional', 'Electrophysiology', 'Non-invasive / Echo'],
  Nephrology: ['Dialysis / CKD', 'Transplant'],
  Oncology: ['Medical oncology', 'Radiation oncology', 'Surgical oncology'],
  Obstetrics: ['High-risk pregnancy', 'General obstetrics'],
  Pediatrics: ['Neonatology', 'General paediatrics'],
  Orthopedics: ['Trauma & implants', 'Joint replacement', 'Spine'],
  Trauma: ['Emergency / casualty'],
  Ophthalmology: ['Cataract & retina', 'Glaucoma'],
  'General Medicine': ['Internal medicine'],
};

// ---- Maharashtra cities the hospital flow operates on (ORIGINS) -------------
export const HOSPITAL_CITIES = [
  'Pune',
  'Mumbai',
  'Thane',
  'Nashik',
  'Nagpur',
  'Aurangabad',
  'Solapur',
  'Kolhapur',
  'Sangli',
  'Latur',
] as const;

// City → NFHS district name (so we can join the real district_demand rows).
// district_demand is keyed by `nfhs_district`; Maharashtra districts share the
// city's name for these ten, except the renamed Aurangabad → Chh. Sambhajinagar.
export const CITY_DISTRICT: Record<string, string> = {
  Pune: 'Pune',
  Mumbai: 'Mumbai',
  Thane: 'Thane',
  Nashik: 'Nashik',
  Nagpur: 'Nagpur',
  Aurangabad: 'Aurangabad',
  Solapur: 'Solapur',
  Kolhapur: 'Kolhapur',
  Sangli: 'Sangli',
  Latur: 'Latur',
};
export const HOSPITAL_STATE = 'Maharashtra';

// ---- Disease-burden seed (BURDEN) — fallback when no real demand row -------
interface BurdenBoost {
  d: number;
  s: string;
}
interface BurdenEntry {
  boost: Record<string, BurdenBoost>;
  drivers: string[];
}
export const BURDEN: Record<string, BurdenEntry> = {
  Latur: {
    boost: {
      Cardiology: { d: 94, s: 'Heart failure' },
      Nephrology: { d: 86, s: 'Dialysis / CKD' },
      Oncology: { d: 68, s: 'Medical oncology' },
    },
    drivers: ['Heart failure & uncontrolled hypertension', 'Chronic kidney disease — Marathwada belt'],
  },
  Pune: {
    boost: {
      Oncology: { d: 78, s: 'Medical oncology' },
      Cardiology: { d: 66, s: 'Interventional' },
      Orthopedics: { d: 62, s: 'Trauma & implants' },
    },
    drivers: ['Rising urban cancer incidence', 'Road-trauma orthopaedics'],
  },
  Solapur: {
    boost: {
      Trauma: { d: 88, s: 'Emergency / casualty' },
      Cardiology: { d: 76, s: 'Interventional' },
      Orthopedics: { d: 72, s: 'Trauma & implants' },
    },
    drivers: ['Highway trauma corridor', 'Ischaemic heart disease'],
  },
  Nagpur: {
    boost: {
      Oncology: { d: 84, s: 'Radiation oncology' },
      Nephrology: { d: 64, s: 'Dialysis / CKD' },
    },
    drivers: ['Regional cancer referral load', 'Diabetic kidney disease'],
  },
  Mumbai: {
    boost: {
      Cardiology: { d: 80, s: 'Interventional' },
      Oncology: { d: 74, s: 'Medical oncology' },
      Pediatrics: { d: 64, s: 'Neonatology' },
    },
    drivers: ['Dense urban cardiac load', 'Oncology referral hub'],
  },
  Thane: {
    boost: {
      Obstetrics: { d: 82, s: 'High-risk pregnancy' },
      Pediatrics: { d: 80, s: 'Neonatology' },
      Cardiology: { d: 60, s: 'Non-invasive / Echo' },
    },
    drivers: ['High birth volume', 'Neonatal demand'],
  },
  Nashik: {
    boost: {
      Ophthalmology: { d: 76, s: 'Cataract & retina' },
      Cardiology: { d: 62, s: 'Non-invasive / Echo' },
      Obstetrics: { d: 60, s: 'High-risk pregnancy' },
    },
    drivers: ['Cataract surgical backlog', 'Maternal health gaps'],
  },
  Aurangabad: {
    boost: {
      Oncology: { d: 82, s: 'Medical oncology' },
      Nephrology: { d: 78, s: 'Dialysis / CKD' },
    },
    drivers: ['Cancer catchment', 'High CKD prevalence'],
  },
  Kolhapur: {
    boost: {
      Cardiology: { d: 82, s: 'Interventional' },
      Nephrology: { d: 70, s: 'Dialysis / CKD' },
    },
    drivers: ['Cardiac referral load', 'Growing dialysis demand'],
  },
  Sangli: {
    boost: {
      Obstetrics: { d: 76, s: 'High-risk pregnancy' },
      Pediatrics: { d: 74, s: 'Neonatology' },
      Nephrology: { d: 64, s: 'Dialysis / CKD' },
    },
    drivers: ['Rural maternal care', 'Paediatric service gaps'],
  },
};

// ---- Free-agent doctor seed (_baseAgents) ----------------------------------
// Used when the accounts(role=doctor) read API yields no recruitable doctors.
export interface SeedAgent {
  id: string;
  name: string;
  spec: string;
  sub: string;
  subs: string[];
  years: number;
  city: string;
  avail: string;
  relocate: boolean;
  tele: boolean;
  blurb: string;
}
export const SEED_AGENTS: SeedAgent[] = [
  { id: 'a1', name: 'Dr. Aarti Deshmukh', spec: 'Cardiology', sub: 'Interventional · Heart failure', subs: ['Heart failure', 'Interventional'], years: 12, city: 'Pune', avail: 'Full-time', relocate: true, tele: false, blurb: 'Ran a district heart-failure clinic; comfortable standing up cath services from scratch.' },
  { id: 'a2', name: 'Dr. Imran Sheikh', spec: 'Cardiology', sub: 'Electrophysiology', subs: ['Electrophysiology'], years: 9, city: 'Mumbai', avail: 'Locum', relocate: false, tele: true, blurb: 'Available for locum blocks and remote arrhythmia reviews via tele-cardiology.' },
  { id: 'a11', name: 'Dr. Kavya Nair', spec: 'Cardiology', sub: 'Non-invasive · Echo', subs: ['Non-invasive / Echo', 'Heart failure'], years: 5, city: 'Thane', avail: 'Telehealth', relocate: false, tele: true, blurb: 'Tele-echo reporting and OPD support for heart-failure screening programmes.' },
  { id: 'a3', name: 'Dr. Neha Rao', spec: 'Nephrology', sub: 'Dialysis & CKD', subs: ['Dialysis / CKD'], years: 7, city: 'Kolhapur', avail: 'Full-time', relocate: true, tele: false, blurb: 'Set up a 10-chair dialysis unit; keen to work in high-CKD districts.' },
  { id: 'a4', name: 'Dr. Sanjay Gupta', spec: 'Nephrology', sub: 'Transplant follow-up', subs: ['Transplant', 'Dialysis / CKD'], years: 16, city: 'Aurangabad', avail: 'Telehealth', relocate: false, tele: true, blurb: 'Offers tele-nephrology clinics and protocol setup for satellite centres.' },
  { id: 'a5', name: 'Dr. Vikram Patil', spec: 'Oncology', sub: 'Medical oncology', subs: ['Medical oncology'], years: 14, city: 'Nagpur', avail: 'Visiting', relocate: false, tele: true, blurb: 'Runs weekly tumor boards; can support chemotherapy day-care remotely.' },
  { id: 'a6', name: 'Dr. Sunita Joshi', spec: 'Obstetrics', sub: 'High-risk pregnancy', subs: ['High-risk pregnancy'], years: 10, city: 'Nashik', avail: 'Full-time', relocate: true, tele: false, blurb: 'High-risk obstetrics and emergency C-section cover for district settings.' },
  { id: 'a7', name: 'Dr. Rahul Kulkarni', spec: 'Orthopedics', sub: 'Trauma & implants', subs: ['Trauma & implants'], years: 8, city: 'Solapur', avail: 'Locum', relocate: true, tele: false, blurb: 'Trauma surgeon used to high-volume highway-casualty settings.' },
  { id: 'a8', name: 'Dr. Meera Iyer', spec: 'Pediatrics', sub: 'Neonatology (SNCU)', subs: ['Neonatology'], years: 11, city: 'Pune', avail: 'Full-time', relocate: true, tele: false, blurb: 'Neonatologist; can stand up an SNCU and train nursing staff.' },
  { id: 'a9', name: 'Dr. Pooja Shah', spec: 'Ophthalmology', sub: 'Cataract & retina', subs: ['Cataract & retina'], years: 6, city: 'Thane', avail: 'Visiting', relocate: false, tele: false, blurb: 'High-volume cataract surgeon for periodic surgical camps.' },
  { id: 'a10', name: 'Dr. Anil Verma', spec: 'General Medicine', sub: 'Internal medicine', subs: ['Internal medicine'], years: 20, city: 'Latur', avail: 'Full-time', relocate: false, tele: false, blurb: 'Senior physician; can anchor OPD and mentor junior staff.' },
];

// ---- Roster type + device-local persistence (no roster write API) ----------
export type Roster = Record<string, number>;

const ROSTER_KEY = 'asc.hospital.roster';
const PIPELINE_KEY = 'asc.hospital.pipeline';
const SCENARIO_KEY = 'asc.hospital.scenarios';
const CITY_KEY = 'asc.hospital.city';
const REGISTRATIONS_KEY = 'asc.hospital.registrations';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — non-fatal, state stays in-memory for the session */
  }
}

export const loadRoster = (): Roster => readJson<Roster>(ROSTER_KEY, {});
export const saveRoster = (r: Roster): void => writeJson(ROSTER_KEY, r);
export const loadCity = (): string => {
  const c = readJson<string>(CITY_KEY, 'Latur');
  return HOSPITAL_CITIES.includes(c as (typeof HOSPITAL_CITIES)[number]) ? c : 'Latur';
};
export const saveCity = (c: string): void => writeJson(CITY_KEY, c);
export const loadPipeline = (): string[] => readJson<string[]>(PIPELINE_KEY, []);
export const savePipeline = (ids: string[]): void => writeJson(PIPELINE_KEY, ids);

// ---- Registered doctors on the roster (by NMC / IMR registration number) ----
// A named-member list captured alongside the per-discipline headcount steppers.
// Each entry is a doctor's Indian Medical Register number with an optional
// discipline tag. Device-local, same "saved on this device" model as the roster.
export interface RosterMember {
  regNo: string;
  /** Optional discipline tag (one of DISCIPLINES, or '' when unspecified). */
  discipline: string;
}
export const loadRegistrations = (): RosterMember[] =>
  readJson<RosterMember[]>(REGISTRATIONS_KEY, []);
export const saveRegistrations = (members: RosterMember[]): void =>
  writeJson(REGISTRATIONS_KEY, members);

export interface Scenario {
  id: string;
  name: string;
  city: string;
  roster: Roster;
  gaps: number;
}
export const loadScenarios = (): Scenario[] => readJson<Scenario[]>(SCENARIO_KEY, []);
export const saveScenarios = (s: Scenario[]): void => writeJson(SCENARIO_KEY, s);

export const rosterTotal = (r: Roster): number =>
  DISCIPLINES.reduce((sum, d) => sum + (r[d] || 0), 0);

// The prototype's importRoster() sample (20 staff parsed).
export const SAMPLE_ROSTER: Roster = {
  'General Medicine': 7,
  Obstetrics: 4,
  Pediatrics: 3,
  Orthopedics: 2,
  Trauma: 2,
  Ophthalmology: 1,
  Cardiology: 0,
  Nephrology: 0,
  Oncology: 0,
};

// ============================================================================
// Demand / coverage / weak-point math (mirrors the prototype renderVals()).
// `demandRows` are the real useDistrictDemand(...) rows for the city's district;
// when a discipline isn't present there we fall back to the seed BURDEN.
// ============================================================================

/** Index the real district_demand rows by discipline for O(1) lookup. */
export function indexDemand(rows: DistrictDemandRow[] | undefined): Map<string, DistrictDemandRow> {
  const m = new Map<string, DistrictDemandRow>();
  for (const r of rows ?? []) m.set(r.discipline, r);
  return m;
}

/** Proxy marker: modelled driver strings for proxy-derived disciplines
 * (Ortho/Ophthal/Trauma) begin with "(proxy)". We surface a small badge wherever
 * such a demand/driver is shown so the figure is never read as directly observed. */
const PROXY_PREFIX = '(proxy)';

/** Does the real district_demand row for this discipline come from a proxy driver? */
export function isProxyDemand(d: string, demand: Map<string, DistrictDemandRow>): boolean {
  const real = demand.get(d);
  return !!real?.top_driver && real.top_driver.trimStart().startsWith(PROXY_PREFIX);
}

/** Strip the leading "(proxy)" marker from a driver string for display. */
export function stripProxy(driver: string): string {
  const t = driver.trimStart();
  return t.startsWith(PROXY_PREFIX) ? t.slice(PROXY_PREFIX.length).trimStart() : driver;
}

/** Is a driver string proxy-derived (begins with "(proxy)")? */
export function isProxyDriver(driver: string): boolean {
  return driver.trimStart().startsWith(PROXY_PREFIX);
}

/** demandFor(city,d): real demand_score if present, else seed boost, else 42. */
export function demandFor(city: string, d: string, demand: Map<string, DistrictDemandRow>): number {
  const real = demand.get(d);
  if (real && real.demand_score != null) return Math.round(Math.max(0, Math.min(100, real.demand_score)));
  const v = BURDEN[city]?.boost?.[d];
  return v?.d != null ? v.d : 42;
}

/** subNeedFor(city,d): real top_driver-derived sub if present, else seed. */
export function subNeedFor(city: string, d: string, demand: Map<string, DistrictDemandRow>): string {
  const v = BURDEN[city]?.boost?.[d];
  if (v?.s) return v.s;
  const real = demand.get(d);
  if (real?.top_driver) {
    // Map the modelled driver onto the closest sub need, else first sub.
    const subs = SUBS[d] || [];
    const hit = subs.find((s) => real.top_driver!.toLowerCase().includes(s.split(' ')[0].toLowerCase()));
    if (hit) return hit;
  }
  return SUBS[d]?.[0] ?? '';
}

/** The local disease-burden driver strings for the city (real top_driver wins). */
export function driversFor(city: string, demand: Map<string, DistrictDemandRow>): string[] {
  const realDrivers = Array.from(
    new Set(
      Array.from(demand.values())
        .filter((r) => r.demand_score != null && r.demand_score >= 60 && r.top_driver)
        .sort((a, b) => (b.demand_score ?? 0) - (a.demand_score ?? 0))
        .map((r) => r.top_driver as string),
    ),
  );
  if (realDrivers.length) return realDrivers.slice(0, 3);
  return BURDEN[city]?.drivers ?? [];
}

export type CoverageStatusKey = 'critical' | 'thin' | 'overlap' | 'covered';

export interface CoverageRow {
  discipline: string;
  facCount: number;
  roster: number;
  demand: number;
  coverage: number;
  gap: number;
  status: CoverageStatusKey;
}

/**
 * Compute one coverage row per discipline, sorted worst-gap first.
 * coverage = min(100, facCount*28 + (roster>0 ? 18 + roster*7 : 0))   [prototype]
 * Status thresholds: gap≥30 critical, gap≥10 thin, overlap (cov-dem≥28 & fac≥2), else covered.
 */
export function computeCoverageRows(
  city: string,
  roster: Roster,
  demand: Map<string, DistrictDemandRow>,
  facCountByDiscipline: Map<string, number>,
): CoverageRow[] {
  return DISCIPLINES.map((d) => {
    const facCount = facCountByDiscipline.get(d) ?? 0;
    const r = roster[d] || 0;
    const dem = demandFor(city, d, demand);
    const coverage = Math.min(100, facCount * 28 + (r > 0 ? 18 + r * 7 : 0));
    const gap = dem - coverage;
    let status: CoverageStatusKey;
    if (gap >= 30) status = 'critical';
    else if (gap >= 10) status = 'thin';
    else if (coverage - dem >= 28 && facCount >= 2) status = 'overlap';
    else status = 'covered';
    return { discipline: d, facCount, roster: r, demand: dem, coverage, gap, status };
  }).sort((a, b) => b.gap - a.gap);
}

/** Critical-gap count for a roster (demand≥70 & nobody on staff) — scenarioGaps(). */
export function scenarioGaps(city: string, roster: Roster, demand: Map<string, DistrictDemandRow>): number {
  let crit = 0;
  for (const d of DISCIPLINES) {
    if (demandFor(city, d, demand) >= 70 && !((roster[d] || 0) > 0)) crit++;
  }
  return crit;
}

// ---- Recruiter (AIRecruiterPanel) — recruiterResponse() --------------------
export interface RecruiterAgentRef {
  id: string;
  name: string;
  spec: string;
  sub: string;
}
export interface RecruiterMessage {
  title: string;
  body: string;
  agents: RecruiterAgentRef[];
}

export function recruiterResponse(
  key: string | null,
  city: string,
  rows: CoverageRow[],
  agents: SeedAgent[],
  demand: Map<string, DistrictDemandRow>,
): RecruiterMessage {
  const weak = rows.filter((r) => r.gap >= 10);
  const weakSet = new Set(weak.map((r) => r.discipline));
  const top = weak[0];
  const mk = (list: SeedAgent[]): RecruiterAgentRef[] =>
    list.map((a) => ({ id: a.id, name: a.name, spec: a.spec, sub: a.sub }));

  if (key === 'tele') {
    const hit = agents.filter((a) => a.tele && weakSet.has(a.spec));
    const use = hit.length ? hit : agents.filter((a) => a.tele);
    return {
      title: 'Telehealth-ready cover',
      body: 'These clinicians can start remotely while you recruit on-site — tele-clinics, echo reporting and tumor boards count toward coverage today.',
      agents: mk(use.slice(0, 3)),
    };
  }
  if (key === 'relocate') {
    const hit = agents.filter((a) => a.relocate && weakSet.has(a.spec));
    const use = hit.length ? hit : agents.filter((a) => a.relocate);
    return {
      title: 'Open to relocating',
      body: `These specialists said they'd move for the right district posting — the fastest path to permanent on-site cover in ${city}.`,
      agents: mk(use.slice(0, 3)),
    };
  }
  if (key === 'nephro') {
    const hit = agents.filter((a) => a.spec === 'Nephrology');
    return {
      title: 'Kidney-care cover',
      body: `${city} carries a heavy chronic-kidney-disease load, yet dialysis-capable centres nearby are few. Start with these nephrologists.`,
      agents: mk(hit.slice(0, 2)),
    };
  }
  if (!top) {
    return {
      title: "You're well covered",
      body: `No critical gaps right now for ${city}. Adjust your roster and I'll re-check demand against local disease burden.`,
      agents: [],
    };
  }
  const sub = subNeedFor(city, top.discipline, demand);
  const sorted = agents
    .filter((a) => a.spec === top.discipline)
    .sort((x, y) => ((y.subs || []).includes(sub) ? 1 : 0) - ((x.subs || []).includes(sub) ? 1 : 0));
  const driver = driversFor(city, demand)[0] ?? 'Local disease burden';
  return {
    title: `Your sharpest gap: ${top.discipline} — ${sub}`,
    body: `${driver} runs well above the state average in ${city}, so the specific need is ${sub.toLowerCase()}, not just any ${top.discipline.toLowerCase()}. You have ${top.roster || 0} on staff and only ${top.facCount} facilit${top.facCount === 1 ? 'y' : 'ies'} nearby offering it. I'd prioritise these specialists.`,
    agents: mk(sorted.slice(0, 2)),
  };
}

export const CHAT_CHIPS: { key: string; label: string }[] = [
  { key: 'gap', label: 'Cover my biggest gap' },
  { key: 'tele', label: 'Telehealth options' },
  { key: 'relocate', label: 'Open to relocate' },
  { key: 'nephro', label: 'Kidney care' },
];
