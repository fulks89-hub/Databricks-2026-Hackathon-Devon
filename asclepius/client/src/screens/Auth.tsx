import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Input, Button } from '@databricks/appkit-ui/react';
import {
  ArrowLeft,
  User,
  Stethoscope,
  Buildings,
  MapPinArea,
  SuitcaseSimple,
  VideoCamera,
  WarningCircle,
  UserCirclePlus,
  SignIn,
  ShieldCheck,
  IdentificationCard,
} from '@phosphor-icons/react';
import { createAccount, loginByEmail, type RoleInput, type Account } from '@/lib/api';
import { fonts, neutral, role as roleTheme } from '@/components/asclepius/theme';

/* ============================================================================
   Auth (/auth) — DEC-001 passwordless sign-up / log-in. Role picker
   (patient / doctor / hospital_admin), display name + email + city, plus
   doctor fields. No password field; "demo profiles only" guardrail copy.
   createAccount / loginByEmail. Matches Asclepius.dc.html §Auth.
   ============================================================================ */

const CLINICIAN = roleTheme.clinician.base;

type AuthRole = 'patient' | 'doctor' | 'hospital_admin';
type Mode = 'signup' | 'login';

const ROLE_TABS: { key: AuthRole; label: string; Icon: typeof User }[] = [
  { key: 'patient', label: 'Patient', Icon: User },
  { key: 'doctor', label: 'Doctor', Icon: Stethoscope },
  { key: 'hospital_admin', label: 'Hospital admin', Icon: Buildings },
];

const CITIES = ['Pune', 'Mumbai', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Sangli', 'Latur', 'Nagpur'];
const SPECIALTIES = ['Cardiology', 'Obstetrics', 'Orthopedics', 'Oncology', 'Pediatrics', 'Ophthalmology', 'Nephrology', 'General Medicine'];
const AVAILABILITY = ['Full-time', 'Locum', 'Telehealth', 'Visiting'];

// The route a created/loaded profile lands on, by role.
const HOME: Record<AuthRole, string> = {
  patient: '/patient/location',
  doctor: '/clinician/profile',
  hospital_admin: '/hospital/roster',
};

interface Draft {
  displayName: string;
  email: string;
  city: string;
  specialty: string;
  sub: string;
  years: string;
  registrationNo: string;
  availability: string;
  relocate: boolean;
  telehealth: boolean;
  hospitalCity: string;
}

const EMPTY_DRAFT: Draft = {
  displayName: '',
  email: '',
  city: '',
  specialty: '',
  sub: '',
  years: '',
  registrationNo: '',
  availability: 'Full-time',
  relocate: false,
  telehealth: false,
  hospitalCity: '',
};

/* ---- pill chip (selectable) ----------------------------------------------- */
function Chip({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="inline-flex items-center gap-2 rounded-full px-[17px] py-[11px]"
      style={{
        fontFamily: fonts.body,
        fontWeight: selected ? 600 : 500,
        fontSize: 14.5,
        cursor: 'pointer',
        border: `1.5px solid ${selected ? CLINICIAN : neutral.border}`,
        background: selected ? `${CLINICIAN}18` : '#fff',
        color: selected ? CLINICIAN : neutral.textStrong,
        transition: 'all .15s',
      }}
    >
      {label}
    </button>
  );
}

function FieldLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-[7px] flex items-center gap-2" style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.text }}>
      {icon}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { background: '#FCFAF6', borderColor: neutral.border, fontSize: 14, color: neutral.text };

export function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signup');
  const [authRole, setAuthRole] = useState<AuthRole>('patient');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const showDoctor = authRole === 'doctor';
  const showHospital = authRole === 'hospital_admin';

  function landFor(acc: Account | null, fallback: AuthRole) {
    const r = (acc?.role as AuthRole) || fallback;
    void navigate(HOME[r] ?? HOME.patient);
  }

  async function handleCreate() {
    setErr('');
    const email = draft.email.trim().toLowerCase();
    const name = draft.displayName.trim();
    if (!email || !/.+@.+/.test(email)) {
      setErr('Enter a valid email.');
      return;
    }
    if (!name) {
      setErr('Add a display name.');
      return;
    }
    if (authRole === 'doctor' && !draft.specialty) {
      setErr('Pick a specialty.');
      return;
    }
    setBusy(true);
    try {
      const { account } = await createAccount({
        email,
        display_name: name,
        role: authRole as RoleInput,
        city: draft.city || undefined,
        specialty: showDoctor ? draft.specialty || undefined : undefined,
        sub_specialty: showDoctor ? draft.sub || undefined : undefined,
        years_experience: showDoctor && draft.years ? parseInt(draft.years, 10) : undefined,
        availability: showDoctor ? draft.availability || undefined : undefined,
        relocate: showDoctor ? draft.relocate : undefined,
        telehealth: showDoctor ? draft.telehealth : undefined,
        registration_no: showDoctor ? draft.registrationNo.trim() || undefined : undefined,
        hospital_city: showHospital ? draft.hospitalCity || draft.city || undefined : undefined,
      });
      landFor(account, authRole);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create your profile.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setErr('');
    const email = draft.email.trim().toLowerCase();
    if (!email || !/.+@.+/.test(email)) {
      setErr('Enter the email you signed up with.');
      return;
    }
    setBusy(true);
    try {
      const { account } = await loginByEmail(email);
      landFor(account, authRole);
    } catch {
      setErr('No profile for that email — sign up first.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[660px] px-10 pb-20 pt-10" style={{ animation: 'ascFade .45s ease both' }}>
      <Button asChild variant="ghost" className="mb-1.5 h-auto px-0 py-1.5" style={{ color: neutral.textSoft }}>
        <Link to="/">
          <ArrowLeft weight="bold" size={15} />
          Back
        </Link>
      </Button>

      {/* signup / login segmented control */}
      <div className="mb-[18px] inline-flex gap-1 rounded-[12px] p-[5px]" style={{ background: '#F1EBE1' }}>
        {(['signup', 'login'] as Mode[]).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setErr(''); }}
              className="rounded-[9px] px-[18px] py-[9px]"
              style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none', background: active ? '#fff' : 'transparent', color: active ? CLINICIAN : neutral.textFaint, boxShadow: active ? '0 2px 6px rgba(43,39,34,.1)' : 'none' }}
            >
              {m === 'signup' ? 'Sign up' : 'Log in'}
            </button>
          );
        })}
      </div>

      {mode === 'signup' ? (
        <>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, letterSpacing: '-.025em', margin: 0, color: neutral.ink }}>
            Create your profile
          </h2>
          <p style={{ fontSize: 16, color: neutral.textMuted, margin: '8px 0 0' }}>
            No password — your profile saves to this device and loads back when you log in by email.
          </p>

          <div
            className="mt-[22px] rounded-[22px] p-[26px]"
            style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 40px -28px rgba(43,39,34,.3)' }}
          >
            {/* role picker */}
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 13, color: neutral.text, marginBottom: 11 }}>{"I'm a…"}</div>
            <div className="flex flex-wrap gap-[9px]">
              {ROLE_TABS.map(({ key, label, Icon }) => {
                const active = authRole === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setAuthRole(key); setErr(''); }}
                    className="inline-flex items-center gap-[7px] rounded-[11px] px-3.5 py-2.5"
                    style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', border: `1.5px solid ${active ? CLINICIAN : neutral.border}`, background: active ? CLINICIAN : '#fff', color: active ? '#fff' : neutral.textMuted }}
                  >
                    <Icon weight="fill" size={15} />
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="my-5 h-px" style={{ background: neutral.divider }} />

            {/* name + email */}
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <FieldLabel>Display name</FieldLabel>
                <Input value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="e.g. Dr. Mehra" style={inputStyle} />
              </div>
              <div>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="demo@asclepius.app" style={inputStyle} />
              </div>
            </div>

            {/* city */}
            <div className="mt-[18px]">
              <FieldLabel>Your city / location</FieldLabel>
              <div className="flex flex-wrap gap-[9px]">
                {CITIES.map((c) => (
                  <Chip key={c} label={c} selected={draft.city === c} onPick={() => set('city', c)} />
                ))}
              </div>
            </div>

            {/* doctor fields */}
            {showDoctor && (
              <>
                <div className="mt-[18px]">
                  <FieldLabel icon={<Stethoscope weight="fill" size={14} style={{ color: CLINICIAN }} />}>Specialty</FieldLabel>
                  <div className="flex flex-wrap gap-[9px]">
                    {SPECIALTIES.map((s) => (
                      <Chip key={s} label={s} selected={draft.specialty === s} onPick={() => set('specialty', s)} />
                    ))}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-[1.4fr_.6fr] gap-3.5">
                  <div>
                    <FieldLabel>Sub-specialty (optional)</FieldLabel>
                    <Input value={draft.sub} onChange={(e) => set('sub', e.target.value)} placeholder="e.g. Heart failure" style={inputStyle} />
                  </div>
                  <div>
                    <FieldLabel>Years</FieldLabel>
                    <Input type="number" value={draft.years} onChange={(e) => set('years', e.target.value)} placeholder="8" style={inputStyle} />
                  </div>
                </div>
                <div className="mt-4">
                  <FieldLabel icon={<IdentificationCard weight="fill" size={14} style={{ color: CLINICIAN }} />}>
                    NMC registration number (optional)
                  </FieldLabel>
                  <Input
                    value={draft.registrationNo}
                    onChange={(e) => set('registrationNo', e.target.value)}
                    placeholder="e.g. 4447 — your Indian Medical Register no."
                    style={inputStyle}
                  />
                  <div className="mt-1.5" style={{ fontSize: 11.5, color: neutral.textDisabled, lineHeight: 1.5 }}>
                    Your number on the Indian Medical Register (IMR). Optional — shown on your free-agent listing so hospitals can look you up.
                  </div>
                </div>
                <div className="mt-4">
                  <FieldLabel>Availability</FieldLabel>
                  <div className="flex flex-wrap gap-[9px]">
                    {AVAILABILITY.map((a) => (
                      <Chip key={a} label={a} selected={draft.availability === a} onPick={() => set('availability', a)} />
                    ))}
                  </div>
                </div>
                <div className="mt-3.5 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => set('relocate', !draft.relocate)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-[11px] p-[11px]"
                    style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', border: `1.5px solid ${draft.relocate ? CLINICIAN : neutral.border}`, background: draft.relocate ? roleTheme.clinician.tint : '#fff', color: draft.relocate ? CLINICIAN : neutral.textMuted }}
                  >
                    <SuitcaseSimple weight="fill" size={16} />
                    Open to relocate
                  </button>
                  <button
                    type="button"
                    onClick={() => set('telehealth', !draft.telehealth)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-[11px] p-[11px]"
                    style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', border: `1.5px solid ${draft.telehealth ? CLINICIAN : neutral.border}`, background: draft.telehealth ? roleTheme.clinician.tint : '#fff', color: draft.telehealth ? CLINICIAN : neutral.textMuted }}
                  >
                    <VideoCamera weight="fill" size={16} />
                    Telehealth
                  </button>
                </div>
                <div
                  className="mt-3.5 flex items-center gap-2 rounded-[11px] px-3.5 py-[11px]"
                  style={{ background: roleTheme.clinician.tint, fontSize: 12.5, color: CLINICIAN, fontWeight: 600 }}
                >
                  <MapPinArea weight="fill" size={15} />
                  Signing up lists you as a recruitable free agent on the hospital map.
                </div>
              </>
            )}

            {/* hospital fields */}
            {showHospital && (
              <div className="mt-[18px]">
                <FieldLabel>Hospital name (optional)</FieldLabel>
                <Input value={draft.hospitalCity} onChange={(e) => set('hospitalCity', e.target.value)} placeholder="e.g. Latur District Hospital" style={inputStyle} />
              </div>
            )}

            {err && (
              <div className="mt-4 flex items-center gap-1.5" style={{ color: '#B2503C', fontFamily: fonts.body, fontWeight: 600, fontSize: 13 }}>
                <WarningCircle weight="fill" size={15} />
                {err}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-[13px] p-[15px]"
              style={{ background: CLINICIAN, color: '#fff', border: 'none', fontFamily: fonts.body, fontWeight: 700, fontSize: 16, cursor: busy ? 'default' : 'pointer', boxShadow: '0 12px 26px -10px rgba(46,125,103,.6)', opacity: busy ? 0.7 : 1 }}
            >
              <UserCirclePlus weight="fill" size={18} />
              {busy ? 'Creating…' : 'Create profile'}
            </button>
            <div className="mt-[11px] flex items-center justify-center gap-1.5 text-center" style={{ fontSize: 11.5, color: neutral.textDisabled, lineHeight: 1.5 }}>
              <ShieldCheck size={13} />
              Demo profiles only — no passwords, no real personal or medical data. Saved on this device.
            </div>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, letterSpacing: '-.025em', margin: 0, color: neutral.ink }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 16, color: neutral.textMuted, margin: '8px 0 0' }}>
            Enter the email you signed up with — your profile loads straight back. No password.
          </p>
          <div className="mt-[22px] rounded-[22px] p-[26px]" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, boxShadow: '0 1px 2px rgba(43,39,34,.04)' }}>
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="demo@asclepius.app"
              style={{ ...inputStyle, fontSize: 15 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleLogin();
              }}
            />
            {err && (
              <div className="mt-3.5 flex items-center gap-1.5" style={{ color: '#B2503C', fontFamily: fonts.body, fontWeight: 600, fontSize: 13 }}>
                <WarningCircle weight="fill" size={15} />
                {err}
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={busy}
              className="mt-[18px] flex w-full items-center justify-center gap-2.5 rounded-[13px] p-[15px]"
              style={{ background: CLINICIAN, color: '#fff', border: 'none', fontFamily: fonts.body, fontWeight: 700, fontSize: 16, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
            >
              <SignIn weight="fill" size={18} />
              {busy ? 'Logging in…' : 'Log in'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setErr(''); }}
              className="mt-3 block w-full text-center"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600, fontSize: 13.5, color: CLINICIAN }}
            >
              No profile yet? Sign up
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Auth;
