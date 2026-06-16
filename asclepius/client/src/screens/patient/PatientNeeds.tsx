import { Link, useNavigate } from 'react-router';
import {
  Heartbeat,
  Baby,
  Bandaids,
  HandHeart,
  Balloon,
  Eye,
  Drop,
  Stethoscope,
  Siren,
  Clock,
  CalendarDots,
  CheckCircle,
  Circle,
  ArrowRight,
  ArrowLeft,
  type Icon,
} from '@phosphor-icons/react';
import { fonts, neutral, role } from '@/components/asclepius';
import { NEEDS, URGENCIES, usePatientFlow, flowQuery } from './patientFlow';

const ACCENT = role.patient.base;

/** Resolve the NEEDS / URGENCIES icon-name strings to Phosphor components. */
const ICONS: Record<string, Icon> = {
  Heartbeat, Baby, Bandaids, HandHeart, Balloon, Eye, Drop, Stethoscope,
  Siren, Clock, CalendarDots,
};

/**
 * Patient · Needs (route /patient/needs) — Step 2 of 3.
 * Symptom/need multi-select cards → specialties + urgency chips. Selection
 * persists in the URL (?needs=&urgency=).
 * Matches the prototype (Asclepius.dc.html isPNeeds block).
 */
export default function PatientNeeds() {
  const navigate = useNavigate();
  const flow = usePatientFlow();
  const { needs, urgency, toggleNeed, setUrgency } = flow;

  const goResults = () => void navigate(`/patient/results${flowQuery(flow)}`);

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
        Step 2 of 3
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
        What do you need help with?
      </h2>
      <p style={{ fontSize: 17, color: neutral.textMuted, margin: '10px 0 0', maxWidth: '34em' }}>
        Pick everything that applies. We&rsquo;ll rank facilities by how many of your needs they cover &mdash; and how sure
        we are about each.
      </p>

      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
        {NEEDS.map((n) => {
          const sel = needs.includes(n.key);
          const NeedIcon = ICONS[n.icon] ?? Stethoscope;
          const CheckIcon = sel ? CheckCircle : Circle;
          return (
            <button
              key={n.key}
              type="button"
              onClick={() => toggleNeed(n.key)}
              aria-pressed={sel}
              className="flex items-center cursor-pointer transition-all"
              style={{
                gap: 13,
                textAlign: 'left',
                padding: '15px 17px',
                borderRadius: 16,
                border: `1.5px solid ${sel ? ACCENT : neutral.borderCard}`,
                background: sel ? role.patient.tint2 : neutral.surface,
              }}
            >
              <span
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: sel ? ACCENT : neutral.divider3,
                  color: sel ? '#fff' : role.patient.press,
                }}
              >
                <NeedIcon weight="fill" size={22} />
              </span>
              <span className="flex flex-col items-start" style={{ gap: 2 }}>
                <span style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 16, color: neutral.inkBody }}>
                  {n.label}
                </span>
                <span style={{ fontSize: 12.5, color: neutral.textFaint2, fontWeight: fonts.weight.medium }}>
                  {n.spec}
                </span>
              </span>
              <CheckIcon
                weight={sel ? 'fill' : 'thin'}
                size={21}
                color={sel ? ACCENT : neutral.borderDashed}
                style={{ marginLeft: 'auto' }}
              />
            </button>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 24,
          background: neutral.surface,
          border: `1px solid ${neutral.borderCard}`,
          borderRadius: 18,
          padding: '20px 22px',
        }}
      >
        <div style={{ fontFamily: fonts.body, fontWeight: fonts.weight.bold, fontSize: 14, color: neutral.text, marginBottom: 13 }}>
          How urgent is it?
        </div>
        <div className="flex" style={{ gap: 10 }}>
          {URGENCIES.map((u) => {
            const sel = urgency === u.key;
            const UrgIcon = ICONS[u.icon] ?? Clock;
            return (
              <button
                key={u.key}
                type="button"
                onClick={() => setUrgency(u.key)}
                aria-pressed={sel}
                className="inline-flex items-center cursor-pointer"
                style={{
                  gap: 8,
                  borderRadius: 11,
                  padding: '10px 15px',
                  fontFamily: fonts.body,
                  fontWeight: fonts.weight.semibold,
                  fontSize: 14,
                  background: sel ? ACCENT : neutral.surface,
                  color: sel ? '#fff' : neutral.textMuted,
                  border: `1.5px solid ${sel ? ACCENT : neutral.border}`,
                }}
              >
                <UrgIcon weight="fill" size={16} />
                {u.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between" style={{ marginTop: 28 }}>
        <Link
          to={`/patient/location${flowQuery(flow)}`}
          className="inline-flex items-center cursor-pointer"
          style={{
            gap: 9,
            background: 'none',
            border: `1.5px solid ${neutral.border}`,
            borderRadius: 14,
            padding: '15px 22px',
            fontFamily: fonts.body,
            fontWeight: fonts.weight.semibold,
            fontSize: 15,
            color: neutral.textSoft,
          }}
        >
          <ArrowLeft weight="bold" size={16} />
          Back
        </Link>
        <button
          type="button"
          onClick={goResults}
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
          See matches
          <ArrowRight weight="bold" size={18} />
        </button>
      </div>
    </div>
  );
}
