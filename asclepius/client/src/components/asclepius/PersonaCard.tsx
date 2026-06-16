import { User, Stethoscope, Hospital, type Icon } from '@phosphor-icons/react';
import { Card, CardContent } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { fonts, role, roleLabel, type Role } from './theme';

const ICON: Record<Role, Icon> = {
  patient: User,
  clinician: Stethoscope,
  hospital: Hospital,
};

const DEFAULT_BLURB: Record<Role, string> = {
  patient: 'Find verified care near you, matched to your needs.',
  clinician: 'Discover openings and gaps that fit your specialty.',
  hospital: 'See your coverage gaps and recruit for them.',
};

export interface PersonaCardProps {
  /** Which persona this entry card represents — drives the role accent. */
  role: Role;
  /** Card heading (defaults to the role label). */
  title?: string;
  /** Supporting copy under the title. */
  blurb?: string;
  /** Entry action — sets role + screen in app state. */
  onSelect: () => void;
  /** Optional override for the call-to-action label. */
  ctaLabel?: string;
  className?: string;
}

/**
 * Landing-page persona entry card (Patient / Clinician / Hospital), role-accented.
 * Drives PersonaSwitcher — onSelect sets the active role. No table binding.
 */
export function PersonaCard({ role: r, title, blurb, onSelect, ctaLabel, className }: PersonaCardProps) {
  const accent = role[r].base;
  const tint = role[r].tint;
  const border = role[r].border;
  const Glyph = ICON[r];
  return (
    <Card
      className={cn('cursor-pointer transition-shadow hover:shadow-md', className)}
      style={{ borderColor: border, borderRadius: 20 }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <CardContent className="flex flex-col gap-3" style={{ padding: 20 }}>
        <span
          className="inline-flex items-center justify-center rounded-2xl"
          style={{ width: 48, height: 48, background: tint, color: accent }}
        >
          <Glyph weight="fill" size={26} />
        </span>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 19, color: accent }}>
            {title ?? roleLabel[r]}
          </div>
          <p className="m-0 mt-1" style={{ fontSize: 14, lineHeight: 1.45, color: '#5C5347' }}>
            {blurb ?? DEFAULT_BLURB[r]}
          </p>
        </div>
        <span style={{ fontSize: 13, fontWeight: fonts.weight.semibold, color: accent }}>
          {ctaLabel ?? `Continue as ${roleLabel[r].toLowerCase()} →`}
        </span>
      </CardContent>
    </Card>
  );
}
