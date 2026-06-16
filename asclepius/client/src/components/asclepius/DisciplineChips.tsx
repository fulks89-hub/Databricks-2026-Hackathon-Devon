import { cn } from '@/lib/utils';
import { neutral, role, type Role } from './theme';

export interface DisciplineChipsProps {
  /** The disciplines to render (typically the 9 ref_disciplines, or a facility's specialties[]). */
  disciplines: string[];
  /** Currently-selected discipline values. Omit for a read-only (display) chip row. */
  selected?: string[];
  /** Toggle handler — when provided, chips are interactive. */
  onToggle?: (discipline: string) => void;
  /** Role accent for the selected state (defaults to clinician green). */
  accent?: Role;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A row of discipline chips (Cardiology, Nephrology, … General Medicine).
 * Read-only when onToggle is omitted (e.g. FacilityCard specialties), or an
 * interactive selector for Atlas / profile filters when onToggle is passed.
 * Binds to ref_disciplines / facilities.specialties.
 */
export function DisciplineChips({ disciplines, selected, onToggle, accent = 'clinician', size = 'md', className }: DisciplineChipsProps) {
  const accentColor = role[accent].base;
  const accentTint = role[accent].tint;
  const sm = size === 'sm';
  const interactive = typeof onToggle === 'function';

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {disciplines.map((d) => {
        const isSel = selected?.includes(d) ?? false;
        const base = {
          padding: sm ? '2px 8px' : '4px 10px',
          fontSize: sm ? 12 : 13,
          borderRadius: 999,
          fontWeight: 500,
          border: `1px solid ${isSel ? accentColor : neutral.border}`,
          color: isSel ? accentColor : neutral.textSoft,
          background: isSel ? accentTint : neutral.surface,
        } as const;
        if (!interactive) {
          return (
            <span key={d} style={base} className="inline-flex items-center">
              {d}
            </span>
          );
        }
        return (
          <button
            key={d}
            type="button"
            onClick={() => onToggle(d)}
            aria-pressed={isSel}
            style={base}
            className="inline-flex items-center transition-colors cursor-pointer"
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
