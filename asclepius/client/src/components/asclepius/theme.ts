// Asclepius theme — the typed twin of the design-system tokens, lifted from
// docs/DESIGN_SYSTEM.md (every literal originates in Asclepius.dc.html).
// These components are presentational: they read these tokens via inline
// `style` so they render correctly even before tokens.css is wired into the
// app root. Layout/spacing still comes from Tailwind classes + AppKit primitives.

export const fonts = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, extra: 800 },
} as const;

export const neutral = {
  bg: '#FAF6F0',
  bgSunken: '#F2ECE3',
  surface: '#FFFFFF',
  surfaceWarm: '#FCFAF6',
  surfaceWarm2: '#FDFBF8',
  ink: '#241F1A',
  inkBody: '#2B2722',
  text: '#3A3026',
  textStrong: '#4A4034',
  textMuted: '#5C5347',
  textSoft: '#6E665B',
  textFaint: '#857B6C',
  textFaint2: '#938A7C',
  textDisabled: '#A79D8E',
  placeholder: '#C9BCA8',
  border: '#E7DFD2',
  borderCard: '#ECE4D8',
  border2: '#EDE5D9',
  divider: '#EEE7DC',
  divider2: '#F0EAE0',
  divider3: '#F5EFE6',
  borderDashed: '#DCD2C2',
  track: '#F0EAE0',
} as const;

// Role accents — patient / clinician / hospital. Pass the active role so accents switch.
export const role = {
  patient: { base: '#E0714C', press: '#C0552F', deep: '#B2503C', tint: '#FBE8E0', tint2: '#FCF1EB', band: '#FCF7F3', border: '#F1D0C4' },
  clinician: { base: '#2E7D67', tint: '#E4EFEA', tint2: '#F4F8F5', band: '#F4F8F5', border: '#CFE3DB' },
  hospital: { base: '#3B6FB0', press: '#2E558C', tint: '#E3ECF6', tint2: '#F7FAFD', band: '#F7FAFD', border: '#CCDAEC' },
} as const;

export type Role = keyof typeof role;

export const roleAccent = (r: Role) => role[r].base;
export const roleTint = (r: Role) => role[r].tint;
export const roleBand = (r: Role): string => role[r].band;
export const roleBorder = (r: Role) => role[r].border;
export const roleLabel: Record<Role, string> = {
  patient: 'Patient',
  clinician: 'Clinician',
  hospital: 'Hospital',
};

// ---- Trust states — mirror of trustMeta(t). Keys match facilities.trust.
export const trust = {
  verified: { label: 'Verified', fg: '#2E7D67', bg: '#E4EFEA', pin: '#2E7D67' },
  review: { label: 'Needs review', fg: '#9A6A12', bg: '#F6EBD6', pin: '#B07A1E' },
  unverified: { label: 'Unverified', fg: '#857B6C', bg: '#EEE9DF', pin: '#A99C88' },
} as const;
export type TrustState = keyof typeof trust;

// ---- Claim / evidence states — mirror of claimMeta(s). Keys match facilities.claims[].status.
export const claim = {
  verified: { label: 'Verified', fg: '#2E7D67', bg: '#E4EFEA' },
  claimed: { label: 'Claimed', fg: '#9A6A12', bg: '#F6EBD6' },
  'no-evidence': { label: 'No evidence', fg: '#B2503C', bg: '#F6E2DC' },
} as const;
export type ClaimStatus = keyof typeof claim;

// ---- Confidence tiers — derived from a 0-100 conf integer.
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';
export const confColor = (c: number) => (c >= 80 ? role.clinician.base : c >= 60 ? '#9A6A12' : '#B2503C');
export const confLevel = (c: number | null | undefined): ConfidenceLevel => {
  if (c == null) return 'none';
  return c >= 80 ? 'high' : c >= 60 ? 'medium' : 'low';
};
export const confidence: Record<ConfidenceLevel, { label: string; fg: string; bg: string }> = {
  high: { label: 'High confidence', fg: '#2E7D67', bg: '#E4EFEA' },
  medium: { label: 'Medium confidence', fg: '#9A6A12', bg: '#F6EBD6' },
  low: { label: 'Low confidence', fg: '#B2503C', bg: '#F6E2DC' },
  none: { label: 'Unknown', fg: '#857B6C', bg: '#EEE9DF' },
};

// ---- Fit tiers — mirror of fitMeta(fit).
export const fitMeta = (f: number) =>
  f >= 78
    ? { label: 'Strong match', color: '#2E7D67' }
    : f >= 58
      ? { label: 'Good match', color: '#5B8C3E' }
      : f >= 42
        ? { label: 'Fair match', color: '#9A6A12' }
        : { label: 'Limited match', color: '#857B6C' };

// ---- Coverage-row status — mirror of hospital coverage gap thresholds.
export const coverageStatus = {
  critical: { label: 'Critical gap', fg: '#B2503C', bg: '#F6E2DC' },
  thin: { label: 'Thin', fg: '#9A6A12', bg: '#F6EBD6' },
  overlap: { label: 'Overlap', fg: '#3B6FB0', bg: '#E3ECF6' },
  covered: { label: 'Covered', fg: '#2E7D67', bg: '#E4EFEA' },
} as const;
export type CoverageStatus = keyof typeof coverageStatus;

export const semantic = {
  danger: '#B2503C',
  dangerBg: '#F6E2DC',
  warn: '#9A6A12',
  warnBg: '#F6EBD6',
  warnAmber: '#B07A1E',
  warnDot: '#D7A93E',
  success: '#2E7D67',
  successBg: '#E4EFEA',
  info: '#3B6FB0',
  infoBg: '#E3ECF6',
  gold: '#C99A2E',
  fitGood: '#5B8C3E',
  goldSurface: '#FBF6EE',
  goldSurfaceBorder: '#EFE3CF',
  evidenceBg: '#FCF8F2',
  evidenceRule: '#E0714C',
} as const;

// ---- Atlas / choropleth ramps — valueToColor(v) where v is 0–100.
// Lifted verbatim from Asclepius.dc.html (atlasColor / healthColor) so the
// choropleth shades identically to the design prototype.
const lerpChannel = (a: number[], b: number[], t: number, i: number) =>
  Math.round(a[i] + (b[i] - a[i]) * t);

/** Coverage ramp (green), gamma 0.8 — darker = stronger care coverage. */
export const atlasColor = (v: number): string => {
  let t = Math.max(0, Math.min(1, v / 100));
  t = Math.pow(t, 0.8);
  const c1 = [234, 243, 238];
  const c2 = [18, 78, 61];
  return `rgb(${lerpChannel(c1, c2, t, 0)},${lerpChannel(c1, c2, t, 1)},${lerpChannel(c1, c2, t, 2)})`;
};

/** Prevalence ramp (red), gamma 0.85 — darker = condition more concentrated. */
export const healthColor = (v: number): string => {
  let t = Math.max(0, Math.min(1, v / 100));
  t = Math.pow(t, 0.85);
  const c1 = [252, 239, 231];
  const c2 = [140, 45, 26];
  return `rgb(${lerpChannel(c1, c2, t, 0)},${lerpChannel(c1, c2, t, 1)},${lerpChannel(c1, c2, t, 2)})`;
};

/** Static atlas chrome — state outline + hover stroke + facility marker. */
export const atlas = { stroke: '#FCF8F2', strokeHover: '#241F1A', marker: '#E0714C' } as const;

export const radius = { xs: 5, sm: 9, md: 11, lg: 13, xl: 16, '2xl': 18, '3xl': 20, '4xl': 22, '5xl': 24, pill: 999 } as const;

export const shadow = {
  hair: '0 1px 2px rgba(43,39,34,.04)',
  card: '0 1px 2px rgba(43,39,34,.04), 0 18px 40px -28px rgba(43,39,34,.3)',
  detail: '0 1px 2px rgba(43,39,34,.04), 0 24px 50px -34px rgba(43,39,34,.32)',
} as const;

// avatar() bg/fg from facilities.trust — used by FacilityAvatar.
export const avatarStyle = (t: TrustState) => ({ bg: trust[t].bg, fg: trust[t].fg });

export const theme = {
  fonts,
  neutral,
  role,
  trust,
  claim,
  confidence,
  coverageStatus,
  semantic,
  radius,
  shadow,
  confColor,
  confLevel,
  fitMeta,
  atlasColor,
  healthColor,
  atlas,
} as const;
export type AscTheme = typeof theme;
