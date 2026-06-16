import { MapPin } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { neutral } from './theme';

export interface CoordSourceBadgeProps {
  /** facilities.coord_source (also detail parsed[].src) — rendered as "via {source}". */
  source: string;
  className?: string;
}

/**
 * "via {source}" pill for the geocoding provenance of a facility's coordinates.
 * Appears in the "How we read this record" block. Binds to facilities.coord_source.
 */
export function CoordSourceBadge({ source, className }: CoordSourceBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded text-[11px] font-medium', className)}
      style={{ padding: '2px 6px', color: neutral.textFaint, background: neutral.surfaceWarm, border: `1px solid ${neutral.border}`, borderRadius: 5 }}
    >
      <MapPin weight="bold" size={11} />
      <span>via {source}</span>
    </span>
  );
}
