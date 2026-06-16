# Asclepius Design System

Extracted from the design handoff prototype (`Asclepius.dc.html`, 2,759 lines, all styling as inline literals — no CSS-variable layer). This document lifts every design token into a portable `tokens.css` + `theme.ts` pair, inventories the reusable components the 17 screens share, and gives a per-screen component tree bound to the read views/write tables in `workspace.app_state`.

> **Data-layer contract.** The rebuilt app reads ONLY `app_state.*` views (never raw v2/v3) via SQL warehouse `5465d8c2d7be7f58`, profile `team`. All persistence ("saved on this device" in the prototype's `localStorage`) becomes writes to the OLTP tables (`shortlist`, `notes`, `reviews`, `overrides`, `dup_decisions`, `roster`, `pipeline`, `postings`, `applications`, `referrals`, `scenarios`, `saved_searches`, `notifications`, `accounts`). The prototype's hardcoded `FAC`/`AGENTS`/`BURDEN`/`STATE_STRENGTH`/`HEALTH` objects are replaced by the real views — see each component's binding notes.

---

## 1. Tokens

### Token provenance (where each literal lives in the source)

| Group | Source location |
|---|---|
| Neutrals / surfaces | `body`, card `background:#fff`, borders `#ECE4D8`/`#E7DFD2`, ink `#241F1A`/`#2B2722` |
| Role accents | Landing CTAs + `accentRole`, `rolePill`, `mkSteps` (`#E0714C` patient / `#2E7D67` clinician / `#3B6FB0` hospital) |
| Trust states | `trustMeta()` (verified/review/unverified) + map legend pins (`#2E7D67`/`#B07A1E`/`#A99C88`) |
| Claim / confidence states | `claimMeta()`, `cMeta()`, `fitMeta()`, `urgMeta()`, `statusMeta()` |
| Atlas ramps | `atlasColor()` (greens), `healthColor()` (reds), legend gradient |
| Radii / shadows | repeated inline `border-radius` + `box-shadow` literals |
| Fonts | `<helmet>` Google Fonts link (Bricolage Grotesque, Hanken Grotesk) + Phosphor icon CSS |
| Motion | `<style>` `@keyframes` block (`ascFade`/`ascPop`/`ascPulse`/`ascToast`/`ascSpin`) |

### `tokens.css`

```css
/* Asclepius design tokens — lifted from the inline literals in Asclepius.dc.html.
   Load once at the app root. Every component reads var(--asc-*). */
:root {
  /* ---- Typography ---- */
  --asc-font-display: 'Bricolage Grotesque', system-ui, sans-serif; /* headings, numerals, logo */
  --asc-font-body:    'Hanken Grotesk', system-ui, sans-serif;       /* everything else */
  /* Phosphor icon families loaded via CSS: ph (regular), ph-bold, ph-fill */
  --asc-fw-regular: 400;
  --asc-fw-medium:  500;
  --asc-fw-semibold:600;
  --asc-fw-bold:    700;
  --asc-fw-extra:   800; /* Bricolage opsz axis 12..96 */

  /* ---- Neutrals / surfaces ---- */
  --asc-bg:            #FAF6F0; /* app canvas */
  --asc-bg-sunken:     #F2ECE3; /* map plates */
  --asc-surface:       #FFFFFF; /* cards */
  --asc-surface-warm:  #FCFAF6; /* detail sidebar, inputs */
  --asc-surface-warm2: #FDFBF8; /* claim rows */
  --asc-ink:           #241F1A; /* primary headings */
  --asc-ink-body:      #2B2722; /* body default */
  --asc-text:          #3A3026; /* labels */
  --asc-text-strong:   #4A4034;
  --asc-text-muted:    #5C5347; /* paragraphs */
  --asc-text-soft:     #6E665B; /* secondary */
  --asc-text-faint:    #857B6C;
  --asc-text-faint2:   #938A7C; /* meta */
  --asc-text-disabled: #A79D8E; /* captions, placeholders */
  --asc-placeholder:   #C9BCA8; /* empty-state icons */

  /* ---- Borders / dividers ---- */
  --asc-border:        #E7DFD2; /* default control border */
  --asc-border-card:   #ECE4D8; /* card border */
  --asc-border-2:      #EDE5D9;
  --asc-divider:       #EEE7DC; /* hairline */
  --asc-divider-2:     #F0EAE0; /* row separators */
  --asc-divider-3:     #F5EFE6;
  --asc-border-dashed: #DCD2C2; /* empty-state dashed */
  --asc-track:         #F0EAE0; /* progress-bar track */

  /* ---- Role accents ---- */
  --asc-patient:        #E0714C;
  --asc-patient-press:  #C0552F;
  --asc-patient-deep:   #B2503C;
  --asc-patient-tint:   #FBE8E0; /* soft bg */
  --asc-patient-tint2:  #FCF1EB;
  --asc-patient-band:   #FCF7F3; /* detail header band */
  --asc-patient-border: #F1D0C4;

  --asc-clinician:        #2E7D67;
  --asc-clinician-tint:   #E4EFEA;
  --asc-clinician-tint2:  #F4F8F5; /* detail band, assistant header */
  --asc-clinician-border: #CFE3DB;

  --asc-hospital:        #3B6FB0;
  --asc-hospital-press:  #2E558C;
  --asc-hospital-tint:   #E3ECF6;
  --asc-hospital-tint2:  #F7FAFD;
  --asc-hospital-border: #CCDAEC;

  /* ---- Trust states (trustMeta) ---- */
  --asc-trust-verified:        #2E7D67;
  --asc-trust-verified-bg:     #E4EFEA;
  --asc-trust-review:          #9A6A12;
  --asc-trust-review-bg:       #F6EBD6;
  --asc-trust-unverified:      #857B6C;
  --asc-trust-unverified-bg:   #EEE9DF;
  /* map-pin variants of trust (saturated for plates) */
  --asc-pin-verified:   #2E7D67;
  --asc-pin-review:     #B07A1E;
  --asc-pin-unverified: #A99C88;

  /* ---- Claim / evidence states (claimMeta) ---- */
  --asc-claim-verified:    #2E7D67; --asc-claim-verified-bg:  #E4EFEA;
  --asc-claim-claimed:     #9A6A12; --asc-claim-claimed-bg:   #F6EBD6;
  --asc-claim-noevidence:  #B2503C; --asc-claim-noevidence-bg:#F6E2DC;

  /* ---- Status / urgency / referral semantics ---- */
  --asc-danger:        #B2503C; --asc-danger-bg:  #F6E2DC;
  --asc-warn:          #9A6A12; --asc-warn-bg:    #F6EBD6;
  --asc-warn-amber:    #B07A1E; /* freshness chevrons */
  --asc-warn-dot:      #D7A93E; /* caveat icons */
  --asc-success:       #2E7D67; --asc-success-bg: #E4EFEA;
  --asc-info:          #3B6FB0; --asc-info-bg:    #E3ECF6;
  --asc-accent-gold:   #C99A2E; /* lightbulb */
  --asc-fit-good:      #5B8C3E; /* "Good match" tier */
  --asc-gold-deep:     #B07A1E;
  --asc-gold-surface:  #FBF6EE; --asc-gold-surface-border: #EFE3CF; /* "why" panels, evidence callouts */
  --asc-evidence-bg:   #FCF8F2; --asc-evidence-rule: #E0714C; /* quote left-rule */

  /* ---- Atlas / choropleth ramps ---- */
  --asc-atlas-cov-lo:  rgb(234,243,238); /* coverage ramp c1 → */
  --asc-atlas-cov-hi:  rgb(18,78,61);    /* → c2  (gamma 0.8) */
  --asc-atlas-health-lo: rgb(252,239,231); /* prevalence ramp c1 → */
  --asc-atlas-health-hi: rgb(140,45,26);   /* → c2  (gamma 0.85) */
  --asc-atlas-stroke:  #FCF8F2; /* state outline */
  --asc-atlas-stroke-hover: #241F1A;
  --asc-atlas-marker:  #E0714C; /* facility dots */

  /* ---- Map plate grid ---- */
  --asc-grid-warm:  #E7DFD2;
  --asc-grid-warm2: #E8E0D3;
  --asc-grid-clin:  #E2E6DD;
  --asc-grid-hosp:  #E1E8F1;
  --asc-grid-ring:  #CFC3B0; /* radius rings (dashed) */

  /* ---- Dark surfaces (trays/toasts/cmd) ---- */
  --asc-dark:        #241F1A; --asc-on-dark:#FFFFFF;
  --asc-dark-muted:  #B9AE9C;
  --asc-dark-undo:   #7FD0B6; /* undo affordance */
  --asc-scrim:       rgba(36,31,26,.42); /* modal backdrop */
  --asc-scrim-light: rgba(36,31,26,.40);

  /* ---- Radii ---- */
  --asc-r-xs:  5px;   /* field-source tags */
  --asc-r-sm:  9px;   /* small buttons */
  --asc-r-md:  11px;  /* chrome buttons, inputs */
  --asc-r-lg:  13px;  /* primary buttons */
  --asc-r-xl:  16px;  /* tiles */
  --asc-r-2xl: 18px;  /* panels */
  --asc-r-3xl: 20px;  /* cards */
  --asc-r-4xl: 22px;  /* large cards / modals */
  --asc-r-5xl: 24px;  /* detail card */
  --asc-r-pill:999px;
  --asc-r-circle:50%;

  /* ---- Shadows ---- */
  --asc-shadow-hair:   0 1px 2px rgba(43,39,34,.04);                                  /* resting card */
  --asc-shadow-card:   0 1px 2px rgba(43,39,34,.04), 0 18px 40px -28px rgba(43,39,34,.3); /* raised card */
  --asc-shadow-detail: 0 1px 2px rgba(43,39,34,.04), 0 24px 50px -34px rgba(43,39,34,.32);
  --asc-shadow-modal:  0 34px 80px -28px rgba(0,0,0,.55);
  --asc-shadow-cmdk:   0 34px 80px -24px rgba(0,0,0,.5);
  --asc-shadow-pop:    0 18px 40px -16px rgba(0,0,0,.5);   /* trays */
  --asc-shadow-notif:  0 28px 64px -22px rgba(43,39,34,.45);
  --asc-shadow-assist: 0 30px 68px -22px rgba(43,39,34,.5);
  --asc-shadow-float:  0 14px 32px -10px rgba(46,125,103,.7); /* FAB (clinician green) */
  --asc-shadow-cta-patient:   0 12px 26px -10px rgba(224,113,76,.7);
  --asc-shadow-cta-clinician: 0 12px 26px -10px rgba(46,125,103,.65);
  --asc-shadow-cta-hospital:  0 12px 26px -10px rgba(59,111,176,.6);
  --asc-shadow-logo:   0 4px 12px -4px rgba(46,125,103,.6);

  /* ---- Blur ---- */
  --asc-blur-bar:   blur(14px);  /* sticky top bar */
  --asc-blur-glass: blur(6px);   /* map overlays */
  --asc-blur-modal: blur(2px);   /* scrim */

  /* ---- Z-index ---- */
  --asc-z-tray: 90; --asc-z-undo: 91; --asc-z-assistant: 95; --asc-z-fab: 96;
  --asc-z-notif: 97; --asc-z-modal: 98; --asc-z-cmdk: 99; --asc-z-bar: 60;

  /* ---- Selection / range ---- */
  --asc-selection: #E0714C33;
  --asc-range-track: #E7DFD2;
}

/* Motion keyframes (verbatim, with ascToast translate() typo corrected to translate()) */
@keyframes ascFade  { from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:translateY(0); } }
@keyframes ascPop   { from{ opacity:0; transform:scale(.96); }       to{ opacity:1; transform:scale(1); } }
@keyframes ascPulse { 0%{ transform:scale(1); opacity:.5; } 70%{ transform:scale(2.4); opacity:0; } 100%{ opacity:0; } }
@keyframes ascToast { from{ opacity:0; transform:translate(-50%,14px); } to{ opacity:1; transform:translateX(-50%); } }
@keyframes ascSpin  { to{ transform:rotate(360deg); } }

/* Globals lifted from the prototype <style> */
* { box-sizing:border-box; }
body { background:var(--asc-bg); color:var(--asc-ink-body); font-family:var(--asc-font-body); -webkit-font-smoothing:antialiased; }
::selection { background:var(--asc-selection); }
input[type=range]{ -webkit-appearance:none; appearance:none; height:6px; border-radius:var(--asc-r-pill); background:var(--asc-range-track); outline:none; }
input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:22px; height:22px; border-radius:50%; background:var(--asc-patient); border:3px solid #fff; box-shadow:0 2px 6px rgba(43,39,34,.25); cursor:pointer; }
::-webkit-scrollbar{ width:10px; height:10px; }
::-webkit-scrollbar-thumb{ background:#E2D9CA; border-radius:var(--asc-r-pill); border:3px solid var(--asc-bg); }
@media print { .asc-noprint{ display:none !important; } body{ background:#fff !important; } }
```

### `theme.ts`

```ts
// Asclepius theme object — the TS twin of tokens.css. Import into AppKit components.
// Color helpers (atlasColor/healthColor) are reproduced so choropleths render identically.

export const fonts = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, extra: 800 },
} as const;

export const neutral = {
  bg: '#FAF6F0', bgSunken: '#F2ECE3', surface: '#FFFFFF', surfaceWarm: '#FCFAF6',
  surfaceWarm2: '#FDFBF8', ink: '#241F1A', inkBody: '#2B2722', text: '#3A3026',
  textStrong: '#4A4034', textMuted: '#5C5347', textSoft: '#6E665B', textFaint: '#857B6C',
  textFaint2: '#938A7C', textDisabled: '#A79D8E', placeholder: '#C9BCA8',
  border: '#E7DFD2', borderCard: '#ECE4D8', border2: '#EDE5D9', divider: '#EEE7DC',
  divider2: '#F0EAE0', divider3: '#F5EFE6', borderDashed: '#DCD2C2', track: '#F0EAE0',
} as const;

export const role = {
  patient:   { base: '#E0714C', press: '#C0552F', deep: '#B2503C', tint: '#FBE8E0', tint2: '#FCF1EB', band: '#FCF7F3', border: '#F1D0C4' },
  clinician: { base: '#2E7D67', tint: '#E4EFEA', tint2: '#F4F8F5', border: '#CFE3DB' },
  hospital:  { base: '#3B6FB0', press: '#2E558C', tint: '#E3ECF6', tint2: '#F7FAFD', border: '#CCDAEC' },
} as const;

// Trust states — mirror of trustMeta(t)
export const trust = {
  verified:   { label: 'Verified',     fg: '#2E7D67', bg: '#E4EFEA', icon: 'ph-fill ph-seal-check', pin: '#2E7D67' },
  review:     { label: 'Needs review', fg: '#9A6A12', bg: '#F6EBD6', icon: 'ph-fill ph-warning',    pin: '#B07A1E' },
  unverified: { label: 'Unverified',   fg: '#857B6C', bg: '#EEE9DF', icon: 'ph-fill ph-question',   pin: '#A99C88' },
} as const;
export type TrustState = keyof typeof trust;

// Claim states — mirror of claimMeta(s)
export const claim = {
  verified: { label: 'Verified',    fg: '#2E7D67', bg: '#E4EFEA', icon: 'ph-fill ph-check-circle' },
  review:   { label: 'Claimed',     fg: '#9A6A12', bg: '#F6EBD6', icon: 'ph-fill ph-warning-circle' },
  unverified:{ label: 'No evidence', fg: '#B2503C', bg: '#F6E2DC', icon: 'ph-fill ph-x-circle' },
} as const;

// Confidence tier for a 0–100 conf integer (from detail sel.confColor)
export const confColor = (c: number) => (c >= 80 ? role.clinician.base : c >= 60 ? '#9A6A12' : '#B2503C');

// Fit tiers — mirror of fitMeta(fit)
export const fit = (f: number) =>
  f >= 78 ? { label: 'Strong match', color: '#2E7D67' }
  : f >= 58 ? { label: 'Good match',   color: '#5B8C3E' }
  : f >= 42 ? { label: 'Fair match',   color: '#9A6A12' }
  : { label: 'Limited match', color: '#857B6C' };

// Urgency (postings/referrals) — mirror of urgMeta(u)
export const urgency = {
  high:   { label: 'Urgent', fg: '#B2503C', bg: '#F6E2DC', icon: 'ph-fill ph-fire' },
  medium: { label: 'Active', fg: '#9A6A12', bg: '#F6EBD6', icon: 'ph-fill ph-clock' },
  low:    { label: 'Open',   fg: '#2E7D67', bg: '#E4EFEA', icon: 'ph-fill ph-circle' },
} as const;

// Referral status — mirror of statusMeta(st)
export const referralStatus = {
  sent:      { label: 'Sent',      fg: '#9A6A12', bg: '#F6EBD6' },
  accepted:  { label: 'Accepted',  fg: '#3B6FB0', bg: '#E3ECF6' },
  completed: { label: 'Completed', fg: '#2E7D67', bg: '#E4EFEA' },
} as const;

// Coverage-row status — mirror of hospital coverage gap thresholds
export const coverageStatus = {
  critical: { label: 'Critical gap', fg: '#B2503C', bg: '#F6E2DC' }, // gap >= 30
  thin:     { label: 'Thin',         fg: '#9A6A12', bg: '#F6EBD6' }, // gap >= 10
  overlap:  { label: 'Overlap',      fg: '#3B6FB0', bg: '#E3ECF6' }, // coverage-demand >= 28 & >=2 nearby
  covered:  { label: 'Covered',      fg: '#2E7D67', bg: '#E4EFEA' },
} as const;

export const semantic = {
  danger: '#B2503C', dangerBg: '#F6E2DC', warn: '#9A6A12', warnBg: '#F6EBD6',
  warnAmber: '#B07A1E', warnDot: '#D7A93E', success: '#2E7D67', successBg: '#E4EFEA',
  info: '#3B6FB0', infoBg: '#E3ECF6', gold: '#C99A2E', fitGood: '#5B8C3E',
  goldSurface: '#FBF6EE', goldSurfaceBorder: '#EFE3CF', evidenceBg: '#FCF8F2', evidenceRule: '#E0714C',
} as const;

// Atlas ramps. valueToColor(v) where v is 0–100.
const lerp = (a: number[], b: number[], t: number, i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
export const atlasColor = (v: number) => { // coverage (green), gamma 0.8
  let t = Math.max(0, Math.min(1, v / 100)); t = Math.pow(t, 0.8);
  const c1 = [234, 243, 238], c2 = [18, 78, 61];
  return `rgb(${lerp(c1, c2, t, 0)},${lerp(c1, c2, t, 1)},${lerp(c1, c2, t, 2)})`;
};
export const healthColor = (v: number) => { // prevalence (red), gamma 0.85
  let t = Math.max(0, Math.min(1, v / 100)); t = Math.pow(t, 0.85);
  const c1 = [252, 239, 231], c2 = [140, 45, 26];
  return `rgb(${lerp(c1, c2, t, 0)},${lerp(c1, c2, t, 1)},${lerp(c1, c2, t, 2)})`;
};
export const atlas = { stroke: '#FCF8F2', strokeHover: '#241F1A', marker: '#E0714C' } as const;

export const dq = (score: number) => (score >= 75 ? '#2E7D67' : score >= 50 ? '#9A6A12' : '#B2503C');
export const fieldCoverageBar = (pct: number) => (pct >= 75 ? '#2E7D67' : pct >= 45 ? '#9A6A12' : '#B2503C');

export const radius = { xs:5, sm:9, md:11, lg:13, xl:16, '2xl':18, '3xl':20, '4xl':22, '5xl':24, pill:999 } as const;

export const shadow = {
  hair: '0 1px 2px rgba(43,39,34,.04)',
  card: '0 1px 2px rgba(43,39,34,.04), 0 18px 40px -28px rgba(43,39,34,.3)',
  detail: '0 1px 2px rgba(43,39,34,.04), 0 24px 50px -34px rgba(43,39,34,.32)',
  modal: '0 34px 80px -28px rgba(0,0,0,.55)', cmdk: '0 34px 80px -24px rgba(0,0,0,.5)',
  pop: '0 18px 40px -16px rgba(0,0,0,.5)', notif: '0 28px 64px -22px rgba(43,39,34,.45)',
  assistant: '0 30px 68px -22px rgba(43,39,34,.5)', float: '0 14px 32px -10px rgba(46,125,103,.7)',
  ctaPatient: '0 12px 26px -10px rgba(224,113,76,.7)', ctaClinician: '0 12px 26px -10px rgba(46,125,103,.65)',
  ctaHospital: '0 12px 26px -10px rgba(59,111,176,.6)', logo: '0 4px 12px -4px rgba(46,125,103,.6)',
} as const;

export const z = { tray:90, undo:91, assistant:95, fab:96, notif:97, modal:98, cmdk:99, bar:60 } as const;

export const motion = {
  fade: 'ascFade .45s ease both', pop: 'ascPop .2s ease both', toast: 'ascToast .25s ease both',
  spin: 'ascSpin 1s linear infinite', pulse: 'ascPulse 2.6s ease-out infinite',
} as const;

export const theme = {
  fonts, neutral, role, trust, claim, urgency, referralStatus, coverageStatus, semantic,
  atlas, radius, shadow, z, motion, confColor, fit, atlasColor, healthColor, dq, fieldCoverageBar,
} as const;
export type AscTheme = typeof theme;
```

---

## 2. Shared component inventory

Each component lists its props and the `app_state` field/shape it binds to. "Write" = the OLTP table it mutates. Components are theme-driven; pass the active `role` so accents/labels switch (patient `#E0714C`, clinician `#2E7D67`, hospital `#3B6FB0`).

### Atoms / display

| Component | Props | Binds to (app_state) |
|---|---|---|
| **TrustBadge** | `trust: 'verified'\|'review'\|'unverified'`, `conf?: number`, `size?: 'sm'\|'md'` | `facilities.trust` (+ optional `facilities.conf` for the "· 91% confidence" suffix). Colors from `theme.trust`. |
| **ConfidenceChip** | `level: 'high'\|'medium'\|'low'\|'none'`, `label?` | derived from `facilities.trust`/`conf` per field (detail `parsed[].conf` → `cMeta()`). |
| **FacilityAvatar** | `initial: string`, `trust` | `facilities.name[0]` + `facilities.trust` → `avatar()` bg/fg. |
| **FitScoreBar** (w/ "Why this score") | `fit: number`, `breakdown: {label,pts,src}[]`, `open: boolean`, `onToggle` | computed client-side from `facilities.specialties` ∩ patient needs, `facilities.trust`/`conf`, and haversine(`pincode.lat/lng`). `src` tags = `capability` / `trust + confidence` / `location`. |
| **DemandCoverageBar** | `name`, `demand: number`, `coverage: number`, `status`, `overlapText` | demand ← `district_demand.demand_score` (by `nfhs_district`+`discipline`); coverage ← nearby `facilities` offering the discipline + `roster` headcount. Status thresholds in `theme.coverageStatus`. |
| **KpiTile** | `value: string\|number`, `label: string`, `accent?: 'ink'\|'patient'\|'hospital'\|'danger'` | Board Report stats + Atlas/data-quality numerals. Bricolage display font. Sources: `roster` (total staff), report `gaps.length`, `pipeline` count, `gold_district_supply_need.facility_count`, `state_coverage.coverage_index`. |
| **CoordSourceBadge** | `source: string` | `facilities.coord_source` ("via {source}" pill in the "How we read this record" block; also `parsed[].src`). |
| **EvidenceQuote** | `text: string`, `sourceLabel?: string` | `facilities.evidence` (FDR `description` field), left-rule `--asc-evidence-rule`. |
| **RawFieldRow** | `label: string`, `text: string` | `facilities.description/capability/procedure/equipment` (raw free text → "extracted to structure"). |
| **DataQualityScore** | `score: number /100`, `issues: {t}[]` | computed by `dqOf()` from `facilities.data_quality_flag`, missing `beds`/`year`, `possible_entity_dup`, claim/`overrides`/`reviews` state. |

### Composite cards / rows

| Component | Props | Binds to (app_state) |
|---|---|---|
| **FacilityCard** | `facility`, `role`, `reasons: Reason[]`, `fit?`, `opp?`, `saved`, `onOpen`, `onSave`, `whyBreakdown?` | one `facilities` row. Save toggles **shortlist** write. Renders TrustBadge + FitScoreBar (patient) or opportunity badge (clinician). Used in Patient Results, Clinician Opportunities, Saved, Registry Browse. |
| **ClaimRow** (confirm/dispute) | `label`, `status: claim`, `userMark?: 'confirmed'\|'disputed'`, `onConfirm`, `onDispute` | `facilities.claims[].text/status`. Confirm/dispute → **reviews** write (`reviews[id].claims[label] = decision`). |
| **AgentCard** (free agent) | `agent`, `matchesWeak`, `subMatch`, `subMatchLabel`, `tags`, `inPipe`, `onRecruit` | `accounts` rows where `role='doctor'` (the prototype's `_baseAgents` seed becomes seeded `accounts`). Recruit → **pipeline** write + **notifications** ("reached out"). |
| **PostingCard** (live opening) | `posting`, `urgency`, `fit`, `applied`, `applicantsText`, `onApply` | `postings` row (`discipline,sub,hospital,city,driver,urgency,mine`). Apply → **applications** write + **notifications** ("interest"). |
| **WeakPointCard** | `name`, `sub`, `gap`, `meta`, `posted`, `applicants`, `onFind`, `onPost` | top-3 of DemandCoverage rows. `onPost` → **postings** write (mine=true); `sub` ← `district_demand.top_driver`-derived sub need. |
| **DistrictPanel** | `name`, `value`, `rank?`, `metrics: {label,val}[]` | `gold_district_supply_need` (desert_score/desert_rank/facility_count) + `district_health` (7 NFHS cols) + `district_demand`. Drives Atlas hover + best/desert lists. |
| **ScenarioRow / ScenarioCompareTable** | `scenario`, `onLoad`, `onRemove`; compare: `aName,bName,rows[]` | **scenarios** table (`city`, `roster` snapshot, `gaps`). Compare diffs two latest scenarios' roster vs `district_demand`. |
| **ReferralRow** | `referral`, `statusLabel`, `canAdvance`, `onAdvance`, `onRemove`, `onOpen` | **referrals** table; status order sent→accepted→completed. |
| **DupePairCard** | `a`, `b`, `decision`, `onMerge`, `onDistinct` | `facilities.possible_entity_dup` (+ `id_valid`); decision → **dup_decisions** write. |
| **SavedSearchChip** | `name`, `sub`, `matchCount`, `onRun`, `onRemove` | **saved_searches** table; matchCount recomputed against `facilities` filters. |
| **NotificationRow** | `text`, `icon`, `read`, `timeAgo`, `onClick` | **notifications** table (`type,color,bg,icon,text,agentId?,nav?`). |

### Navigation / overlays / shell

| Component | Props | Binds to (app_state) |
|---|---|---|
| **TopBar / AppShell** | `role`, `loggedIn`, `account`, `savedCount`, `unreadCount`, `steps?`, `lang` | `accounts` (current), **shortlist** count, **notifications** unread; `steps` from role + current screen. Hidden on Landing. |
| **PersonaSwitcher** | `role`, `onPatient`, `onClinician`, `onHospital`, `onSwitch` | sets `role` in app state (no table). Landing role cards + top-bar "switch role" + rolePill. |
| **StepRail** | `steps: {label,state}[]` | derived nav state (patient 3-step / clinician 2-step / hospital 3-step). Accent follows role. |
| **TrustLegend** | `items: {color,label}[]` | static map legend (verified/review/unverified pins). |
| **AtlasChoropleth** | `geo`, `valueOf(state)`, `colorOf(v)`, `markers`, `hover`, `onHover`, `layer: 'coverage'\|'health'` | SVG paths from `india-geo.js`; coverage ← `state_coverage.coverage_index` / `state_health`; health layer ← `state_health`/`district_health`; markers ← `facilities.lat/lng` (`coord_source`-aware). |
| **CommandPalette** (⌘K) | `query`, `commands: {label,sub,icon,onPick}[]`, `onQuery` | nav commands + facility jump list (`facilities.name/city/state`). |
| **CompareTray** | `count`, `onCompare`, `onClear` | client `compareIds` (max 3); resolves to `facilities` rows on Compare screen. |
| **NotificationsBell + NotificationsPanel** | `unreadCount`, `open`, `items`, `onToggle`, `onClear` | **notifications** table. Opening marks all read (write). |
| **AIAssistantPanel** | `messages`, `input`, `busy`, `presets`, `actions`, `onSend`, `onVoice` | reads grounding context built from `facilities`/`accounts`(agents)/`postings`/`state_coverage`; "Do it for you" actions mutate **postings**/**shortlist**/**scenarios**. Calls `window.claude.complete`, falls back to `localAnswer`. |
| **AIRecruiterPanel** | `recruiterMsg: {title,body,agents[]}`, `chips` | same agent/demand data, hospital-scoped; recommends `accounts(role=doctor)` for weak disciplines. |
| **PersonaSwitcher/AuthForm** | `mode: 'signup'\|'login'`, `role`, `draft`, `err`, chip lists, `onCreate`, `onLogin` | **accounts** table (DEC-001 — no password; keyed by email). Signup as doctor also makes the row a recruitable free agent. |
| **Modals**: PipelineModal, ShareModal (QR), ReferralModal, AgentModal | per-modal props (see trees) | **pipeline**, **shortlist** (share via `#s=ids`), **referrals**, **pipeline** respectively. |
| **Toast / UndoBar** | `message`; undo: `label`, `onUndo` | transient; undo restores prior table state (7s window). |
| **Chip / ChipRow** | `selected`, `accent`, `label`, `onPick` | generic selector (origins, specialties, subs, filters). `chipStyle(sel,accent)` / `miniChip(sel,accent)`. |
| **RangeSlider** | `min,max,step,value,onInput`, `accent` | patient radius (`pRadius`), clinician years (`cExp`). Thumb tinted by role. |
| **RosterStepper** | `discipline`, `count`, `onInc`, `onDec` | **roster** table (`roster[discipline] = n`, 0–30). |

---

## 3. Per-screen component tree (17 screens)

Screen flags are the `is*` booleans in `renderVals()`. Tree notation: `Screen → Region → Component(binding)`.

**1. Landing** (`isLanding`, 3 hero variants via `heroStyle`)
- LandingNav → Logo, PersonaSwitcher buttons (Atlas/Registry/Auth)
- HeroSwitcher (`heroTabs`) → Hero0 split | Hero1 centered (3 role cards) | Hero2 editorial (stat band = KpiTile ×3)
- Hero visual: decorative MapPlate with TrustLegend pins + floating FacilityCard preview
- Bindings: read-only; CTAs set `role` + screen. Stat numerals are static copy (NOT live `facilities` counts — see inconsistency #4).

**2. Patient · Location** (`isPLoc`) — StepRail(1/3)
- Card → ChipRow `originChips` (`ORIGINS` → should bind `pincode`/`facilities.city`) + RangeSlider `pRadius` (50–650)
- Footer → primary "Next" CTA (patient accent)

**3. Patient · Needs** (`isPNeeds`) — StepRail(2/3)
- NeedCardGrid `needCards` (8 needs → `ref_needs` need→specialty) ; UrgencyChips (`pUrgency`)
- Back / "See matches" CTA

**4. Patient · Results** (`isPResults`) — StepRail(3/3)
- Header: `resultHeadline`/`resultSub` + inline RangeSlider(radius)
- Left list → **FacilityCard** ×N (`patientList`) each with TrustBadge + **FitScoreBar**("Why this score" → `breakdown`) + reason chips + Save(**shortlist**)
- EmptyState (`patientEmpty`)
- Right (sticky) → MapPlate radius rings + facility pins (`patientPins`, trust-colored) + TrustLegend
- Bindings: `facilities` within radius (haversine via `pincode.lat/lng`), ranked by need-match/trust/proximity.

**5. Clinician · Profile** (`isCProfile`) — StepRail(1/2)
- Card → ChipRow `specChips` (`ref_disciplines`/9) → conditional ChipRow `subChips` (`ref_sub_specialties` by discipline) → RangeSlider `cExp` (0–35, green)
- Bindings: writes to local clinician state; on auth-signup persists to **accounts**.

**6. Clinician · Opportunities** (`isCOpps`)
- Header + ModeTabs (`cModeTabs`: Live openings / Inferred gaps / Offers it)
- `cNoSpec` empty → prompt
- **Posted view** (`cPosted`) → PostingCard grid (`postingsList` ← **postings**, apply → **applications**) + empty state
- **Facility view** (`cFacilityView`) → Left **FacilityCard** ×N (`clinicianList`, opportunity badge) + Right MapPlate gap/service pins (`clinicianPins`)
- Bindings: `postings`/`applications`; gaps from `facilities.needs` vs `cSpecialty`.

**7. Facility Detail** (`isDetail`) — shared by all roles, `sel`
- HeaderBand (role-tinted) → FacilityAvatar, name/type/city, **TrustBadge**(+conf)
- Main col:
  - WhySurfaced reason chips
  - Claimed capabilities → **ClaimRow** ×N (`sel.claims`, confirm/dispute → **reviews**)
  - "How we read this record" → **RawFieldRow** ×N (`facilities` raw text) + **CoordSourceBadge**/**ConfidenceChip** per `parsed` field
  - **EvidenceQuote** (collapsible, `facilities.evidence`)
  - Record-quality caveats (`flagsFor()` from `data_quality_flag`/missing fields)
- Sidebar:
  - At-a-glance KPIs (beds/year/distance/conf — `facilities.beds/year`, `overrides`)
  - Reported service gaps (`facilities.needs`)
  - Save(**shortlist**) / Refer(**referrals** modal) / **CompareTray** add / Directions (`lat/lng`)
  - Private note → textarea → **notes** write
  - Record freshness (decay) + Call-to-confirm (tel/WhatsApp) → call-confirm → **reviews**(via='call')
  - Review & fix (Verify/Site-visit → **reviews**; missing year/beds inline inputs → **overrides**)

**8. Hospital · Roster** (`isHRoster`) — StepRail(1/3)
- LocationChips `hCityChips` + ImportRoster (CSV)
- RosterStepperGrid `rosterRows` (9 disciplines → **roster** write)
- SaveScenario input + ScenarioRow list (**scenarios**) + ScenarioCompareTable (`scenCmp`)

**9. Hospital · Coverage** (`isHCoverage`)
- DemandDriversBar (`hDrivers` ← `district_demand.top_driver`)
- Left → **DemandCoverageBar** ×9 (`coverageRows`)
- Right (sticky) → MapPlate focus pins (`hospitalPins`) + **WeakPointCard** ×3 (`weakPoints`, Find-agents / Post-opening→**postings**) + "Your open roles" (`myPostings` ← **postings**/**applications**)
- Footer → Board report / "Recruit for the gaps"

**10. Hospital · Recruiter** (`isHAgents`)
- AgentSpecChips (`agentSpecChips`) + pipeline button (**pipeline** count)
- Left → **AgentCard** ×N (`agentList` ← `accounts(role=doctor)`, recruit → **pipeline**)
- Right (sticky) → **AIRecruiterPanel** (`recruiterMsg` + `chatChips`)

**11. Auth** (`isAuth`) — **AuthForm**
- Tabs signup/login; role tabs (patient/doctor/hospital_admin)
- Signup → name/email + city chips + (doctor: spec/sub/years/availability/relocate/telehealth) | (hospital: hospital name) → Create(**accounts**, DEC-001 no password)
- Login → email-only lookup in **accounts**

**12. Compare** (`isCompare`) — horizontally scrollable
- CompareColumn ×2–3 (`compareView`) → name/loc, **TrustBadge**, conf, beds, year, **DataQualityScore**, services, Open/Remove
- Bindings: `facilities` rows for `compareIds`.

**13. Board Report** (`isReport`) — print-optimized (`.asc-noprint` chrome)
- Header (city/date) + **KpiTile** ×3 (roster total, gaps, **pipeline**)
- DiseaseBurden callout (`report.drivers` ← `district_demand`)
- PriorityGapsTable (`report.gaps` → recommended hire from `accounts(role=doctor)`)

**14. Registry** (`isRegistry`) — tabs browse/quality/dupes
- **Browse** (`isBrowse`) → SearchInput + filter ChipRows (State/Type/Trust) + SaveSearch(**saved_searches**)/Voice + **SavedSearchChip** list + **FacilityCard** grid (`regBrowse`, ≤60) + empty
- **Data quality** (`isQuality`) → readiness **KpiTile** + FieldCoverage bars (`dqFields` ← `REGFIELDS` canon vs `facilities` presence) + review queue (**DataQualityScore** rows) + Export fix-list CSV
- **Duplicates** (`isDupes`) → **DupePairCard** ×N (`dupPairs` ← `possible_entity_dup`, → **dup_decisions**) + empty
- Bindings: full `facilities` (10,077 rows) via `app_state.facilities`.

**15. Atlas** (`isAtlas`) — LayerTabs coverage/health
- Left → **AtlasChoropleth** (`atlasMap`) + legend gradient + facility markers; loading state
- Right (sticky) → LayerTabs + DisciplineChips (`atlasDiscChips`) + hover **DistrictPanel** + Best list + Deserts list (`atlasBest`/`atlasDeserts`)
- Bindings: coverage ← `state_coverage.coverage_index` + per-discipline modifier; health ← `state_health`/`district_health`; deserts ← `gold_district_supply_need.desert_score/rank`.

**16. Saved** (`isSaved`)
- Header + Share/QR (**ShareModal**, link = `#s=`+shortlist ids)
- Empty state | **FacilityCard** list (`savedList` ← **shortlist** + **notes**)
- "Referrals you've sent" → **ReferralRow** ×N (`referralsView` ← **referrals**)

**17. (Global overlays, present on every shelled screen)**
- **CommandPalette** (`cmdkOpen`, ⌘K), **CompareTray** (`hasCompare`), **UndoBar** (`undoShow`), **Toast** (`toastShown`), **NotificationsPanel** (`notifOpen`), **AIAssistantPanel** + FAB (`chatOpen`), modals: **PipelineModal**, **ShareModal**, **ReferralModal**, **AgentModal**.

> The 17 named screens = Landing, Patient Location/Needs/Results (3), Clinician Profile/Opportunities (2), Facility Detail, Hospital Roster/Coverage/Recruiter (3), Auth, Compare, Board Report, Registry, Atlas, Saved.

---

## 4. Summary

- **Tokens: 134** distinct CSS custom properties in `tokens.css` (≈110 colors/surfaces + 11 radii + 13 shadows + blur/z/selection), plus **5 motion keyframes** and **10 color-function helpers** in `theme.ts` (`confColor`, `fit`, `atlasColor`, `healthColor`, `dq`, `fieldCoverageBar`, + the trust/claim/urgency/referral/coverage status maps). All lifted from inline literals — the source had zero `var()` usage.
- **Components: 41** reusable pieces — 10 atoms, 13 composite cards/rows, 18 navigation/overlay/shell — covering every one of the 17 screens with no per-screen bespoke styling beyond accent swaps.

### Design-token inconsistencies to fix on rebuild

1. **`ascToast` keyframe typo (bug).** Source line 34 reads `transform:transl(0,14px) translateX(-50%)` — `transl(...)` is not a valid CSS function, so the toast's enter-from offset silently does nothing. Corrected to `translate(-50%,14px)` in `tokens.css`. **Fix on rebuild.**
2. **Two near-identical "review/warn" golds used interchangeably.** Trust-review text is `#9A6A12` but the map pin + freshness chevrons use `#B07A1E`, and caveat dots use `#D7A93E`. Three golds for one semantic state — collapse to a single `--asc-warn` scale (e.g. `#9A6A12` text / `#B07A1E` icon / `#D7A93E` accent) with documented roles.
3. **Patient "deep" vs "press" reds overlap.** `#C0552F` (patient-press, used for `pOrigin` label, hero badge), `#B2503C` (danger / patient-deep) and the base `#E0714C` all appear as "patient red." `#B2503C` doubles as the global danger color — keep danger distinct from the patient accent ramp to avoid a destructive action reading as "patient."
4. **Landing hero stats are hardcoded copy, not data.** "10,000 facility records", "8 verified facilities", "47,169 facilities" are literal strings while the real registry is **10,077 rows**. Bind these to `count(app_state.facilities)` / `state_coverage` on rebuild so the marketing numerals can't drift from the dataset.
5. **Duplicated keys in the `sel` object literal (detail screen).** `bedsLabel`/`bedsColor`/`yearLabel`/`yearColor` are each assigned twice (lines ~2244 then ~2246); the first pair is dead. Harmless in JS (last wins) but the override-aware second pair is the intended one — drop the first on rebuild.
6. **Avatar/trust tint mismatch.** Avatar bg for unverified uses `#EEE9DF` (matches trustMeta bg) but trust **chip** unverified bg is also `#EEE9DF` while the *pin* is `#A99C88` — fine, but the "soft neutral" `#EEE9DF` and divider `#EEE7DC` differ by 2 hex digits and are easily confused; alias them explicitly.
7. **Range-thumb is hardwired patient orange** (`tokens.css` thumb `#E0714C`) even on clinician/hospital sliders where `accent-color:#2E7D67` is applied inline. The webkit thumb ignores `accent-color`, so clinician/hospital sliders show a clinician green track-fill but an orange thumb. Tokenize the thumb per role.
8. **Radius scale has 9 steps for a 5px–24px range** (5/9/11/13/16/18/20/22/24) — several are visually indistinguishable (11 vs 13, 18 vs 20 vs 22). Consider consolidating to ~5 steps on rebuild to reduce drift.
9. **Confidence thresholds duplicated in 3 places** with slightly different cutoffs: `confColor` (≥80/≥60), `fitMeta` (≥78/≥58/≥42), `dq` (≥75/≥50). Centralize the band edges so "high/medium/low" means one thing app-wide.
```
