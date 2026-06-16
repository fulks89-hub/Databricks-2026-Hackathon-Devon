import { Link } from 'react-router';
import { MapPin, MapPinArea, ArrowRight } from '@phosphor-icons/react';
import { fonts, neutral, role } from '@/components/asclepius';
import {
  ORIGINS,
  RADIUS_MIN,
  RADIUS_MAX,
  RADIUS_STEP,
  usePatientFlow,
  flowQuery,
} from './patientFlow';

const ACCENT = role.patient.base;

/**
 * Patient · Location (route /patient/location) — Step 1 of 3.
 * Origin-city chips + a travel-radius slider (50–650 km). Selection persists in
 * the URL (?origin=&radius=) so it carries into Needs → Results.
 * Matches the prototype (Asclepius.dc.html isPLoc block).
 */
export default function PatientLocation() {
  const flow = usePatientFlow();
  const { origin, radius, setOrigin, setRadius } = flow;

  return (
    <div
      className="mx-auto w-full"
      style={{ flex: 1, maxWidth: 900, padding: '46px 40px 80px', animation: 'ascFade .45s ease both' }}
    >
      <div
        style={{
          fontFamily: fonts.body,
          fontWeight: fonts.weight.semibold,
          fontSize: 13,
          color: ACCENT,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
        }}
      >
        Step 1 of 3
      </div>
      <h2
        style={{
          fontFamily: fonts.display,
          fontWeight: fonts.weight.bold,
          fontSize: 40,
          letterSpacing: '-.025em',
          margin: '8px 0 0',
          color: neutral.ink,
        }}
      >
        Where are you?
      </h2>
      <p style={{ fontSize: 17, color: neutral.textMuted, margin: '10px 0 0', maxWidth: '34em' }}>
        Pick the city you&rsquo;d travel from. We&rsquo;ll search outward and show how far each facility really is.
      </p>

      <div
        style={{
          marginTop: 30,
          background: neutral.surface,
          border: `1px solid ${neutral.borderCard}`,
          borderRadius: 22,
          padding: 28,
          boxShadow: '0 1px 2px rgba(43,39,34,.04),0 18px 40px -28px rgba(43,39,34,.3)',
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontWeight: fonts.weight.bold,
            fontSize: 14,
            color: neutral.text,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <MapPin weight="fill" size={16} color={ACCENT} />
          Your city &middot; India
        </div>

        <div className="flex flex-wrap" style={{ gap: 10 }}>
          {ORIGINS.map((c) => {
            const sel = origin === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setOrigin(c)}
                aria-pressed={sel}
                className="cursor-pointer transition-colors"
                style={{
                  borderRadius: 999,
                  padding: '11px 17px',
                  fontFamily: fonts.body,
                  fontWeight: sel ? fonts.weight.semibold : fonts.weight.medium,
                  fontSize: 14.5,
                  border: `1.5px solid ${sel ? ACCENT : neutral.border}`,
                  background: sel ? `${ACCENT}18` : neutral.surface,
                  color: sel ? ACCENT : neutral.text,
                }}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div style={{ height: 1, background: neutral.divider, margin: '26px 0' }} />

        <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
          <div
            style={{
              fontFamily: fonts.body,
              fontWeight: fonts.weight.bold,
              fontSize: 14,
              color: neutral.text,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MapPinArea weight="fill" size={16} color={ACCENT} />
            How far can you travel?
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 22, color: ACCENT }}>
            {radius} km
          </div>
        </div>
        <input
          type="range"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={RADIUS_STEP}
          value={radius}
          onChange={(e) => setRadius(parseInt(e.target.value, 10))}
          aria-label="Travel radius in kilometres"
          style={{ width: '100%', marginTop: 8 }}
        />
        <div
          className="flex justify-between"
          style={{ fontSize: 12, color: neutral.textDisabled, fontWeight: fonts.weight.medium, marginTop: 6 }}
        >
          <span>{RADIUS_MIN} km</span>
          <span>{RADIUS_MAX} km</span>
        </div>
      </div>

      <div className="flex justify-end" style={{ marginTop: 28 }}>
        <Link
          to={`/patient/needs${flowQuery(flow)}`}
          className="inline-flex items-center cursor-pointer"
          style={{
            gap: 10,
            background: ACCENT,
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            padding: '16px 28px',
            fontFamily: fonts.body,
            fontWeight: fonts.weight.bold,
            fontSize: 16,
            boxShadow: '0 12px 26px -10px rgba(224,113,76,.7)',
          }}
        >
          Next: your needs
          <ArrowRight weight="bold" size={18} />
        </Link>
      </div>
    </div>
  );
}
