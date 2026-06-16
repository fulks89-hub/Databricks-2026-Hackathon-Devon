import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Stethoscope, GitBranch, Medal, ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { Slider } from '@databricks/appkit-ui/react';
import { fonts, neutral, role } from '@/components/asclepius';

/* ============================================================================
   Clinician · Profile  (/clinician/profile) — StepRail 1 of 2.

   "Your practice": pick a specialty (the 9 ref_disciplines via DisciplineChips),
   then a sub-specialty (conditional on a specialty being chosen — sharpens which
   gaps you match), then years-in-practice on a green slider. The selection is
   handed to /clinician/opportunities via router navigation state so the next
   screen can rank postings/gaps without a shared store (matches the prototype's
   cSpecialty / cSub / cExp transition).

   Source of truth: design-import/Asclepius.dc.html §"CLINICIAN: PROFILE"
   (isCProfile) — copy, structure, and the SUBS map are reproduced verbatim.
   ============================================================================ */

const ACCENT = role.clinician.base; // #2E7D67

/**
 * Prototype-styled pill chips (Asclepius.dc.html chipStyle, L1961-1964): large
 * 999px pills — padding 11px 17px, 14.5px Hanken, 1.5px border, selected switches
 * to fontWeight 600 + accent border/text + translucent accent fill (accent+'18').
 * Rendered inline here instead of the shared DisciplineChips (which renders the
 * small/thin pill variant) so the clinician profile matches the design reference.
 */
function ProfileChips({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string | null;
  onToggle: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {options.map((opt) => {
        const sel = selected === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={sel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 999,
              padding: '11px 17px',
              fontFamily: fonts.body,
              fontSize: 14.5,
              fontWeight: sel ? 600 : 500,
              border: `1.5px solid ${sel ? ACCENT : neutral.border}`,
              background: sel ? `${ACCENT}18` : neutral.surface,
              color: sel ? ACCENT : neutral.textStrong,
              cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// The 8 specialties the profile offers (prototype SPECIALTIES getter).
const SPECIALTIES = [
  'Cardiology',
  'Obstetrics',
  'Orthopedics',
  'Oncology',
  'Pediatrics',
  'Ophthalmology',
  'Nephrology',
  'General Medicine',
] as const;

// Sub-specialties per discipline (prototype SUBS getter). Keyed by specialty.
const SUBS: Record<string, string[]> = {
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

/** Router state carried to /clinician/opportunities. */
export interface ClinicianProfileState {
  specialty: string | null;
  sub: string | null;
  years: number;
}

export default function ClinicianProfile() {
  const navigate = useNavigate();
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [years, setYears] = useState<number>(8);

  const subOptions = useMemo(() => (specialty ? SUBS[specialty] ?? [] : []), [specialty]);
  const yearsLabel = years >= 35 ? '35+ yrs' : `${years} yrs`;

  // Picking a (new) specialty resets the sub-specialty so a stale sub from the
  // previous discipline can't carry over (matches the prototype's chip model).
  const pickSpecialty = (d: string) => {
    setSpecialty((cur) => (cur === d ? cur : d));
    if (specialty !== d) setSub(null);
  };
  // Sub-specialty chips toggle off when re-picked (prototype setCSub).
  const pickSub = (s: string) => setSub((cur) => (cur === s ? null : s));

  const goToOpportunities = () => {
    const state: ClinicianProfileState = { specialty, sub, years };
    void navigate('/clinician/opportunities', { state });
  };

  return (
    <div
      className="mx-auto w-full"
      style={{ flex: 1, maxWidth: 900, padding: '46px 40px 80px', animation: 'ascFade .45s ease both' }}
    >
      <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Step 1 of 2
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 40, letterSpacing: '-0.025em', margin: '8px 0 0', color: neutral.ink }}>
        Your practice
      </h2>
      <p style={{ fontSize: 17, color: neutral.textMuted, margin: '10px 0 0', maxWidth: '36em' }}>
        Tell us your specialty. We&rsquo;ll show facilities that already offer it — or the ones whose records show a gap your skills would fill.
      </p>

      <div
        style={{
          marginTop: 28,
          background: neutral.surface,
          border: `1px solid ${neutral.borderCard}`,
          borderRadius: 22,
          padding: 26,
          boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 40px -28px rgba(43,39,34,.3)',
        }}
      >
        {/* Specialty */}
        <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Stethoscope weight="fill" size={16} color={ACCENT} />
          Your specialty
        </div>
        <ProfileChips options={SPECIALTIES} selected={specialty} onToggle={pickSpecialty} />

        {/* Sub-specialty (conditional) */}
        {specialty && subOptions.length > 0 && (
          <>
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.text, margin: '22px 0 13px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch weight="fill" size={16} color={ACCENT} />
              Your sub-specialty
              <span style={{ fontWeight: 500, color: neutral.textDisabled, fontSize: 13 }}>— sharpens which gaps you match</span>
            </div>
            <ProfileChips options={subOptions} selected={sub} onToggle={pickSub} />
          </>
        )}

        <div style={{ height: 1, background: neutral.divider, margin: '24px 0' }} />

        {/* Years in practice */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Medal weight="fill" size={16} color={ACCENT} />
            Years in practice
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, color: ACCENT }}>{yearsLabel}</div>
        </div>
        <Slider
          min={0}
          max={35}
          step={1}
          value={[years]}
          onValueChange={(v: number[]) => setYears(v[0] ?? 0)}
          aria-label="Years in practice"
          className="mt-2"
          style={{ ['--primary' as string]: ACCENT }}
        />
      </div>

      {/* Footer nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
        <button
          type="button"
          onClick={() => void navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 9, background: 'none',
            border: '1.5px solid #DCE6E0', borderRadius: 14, padding: '15px 22px',
            fontFamily: fonts.body, fontWeight: 600, fontSize: 15, color: neutral.textSoft, cursor: 'pointer',
          }}
        >
          <ArrowLeft weight="bold" size={15} />
          Back
        </button>
        <button
          type="button"
          onClick={goToOpportunities}
          disabled={!specialty}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: specialty ? ACCENT : neutral.textDisabled, color: '#fff', border: 'none',
            borderRadius: 14, padding: '16px 28px', fontFamily: fonts.body, fontWeight: 700, fontSize: 16,
            cursor: specialty ? 'pointer' : 'not-allowed',
            boxShadow: specialty ? '0 12px 26px -10px rgba(46,125,103,.65)' : undefined,
          }}
        >
          Find where I&rsquo;m needed
          <ArrowRight weight="bold" size={15} />
        </button>
      </div>
    </div>
  );
}
