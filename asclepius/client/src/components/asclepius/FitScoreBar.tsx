import { CaretDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { fitMeta, fonts, neutral } from './theme';
import type { FitReason } from './types';

export interface FitScoreBarProps {
  /** Patient fit score 0-100 (clamped 22..98 server-side). */
  fit: number;
  /** "Why this score" breakdown — one row per scoring source. */
  breakdown: FitReason[];
  /** Whether the breakdown is expanded. */
  open: boolean;
  onToggle: () => void;
  className?: string;
}

const SRC_LABEL: Record<FitReason['src'], string> = {
  capability: 'Capability',
  'trust + confidence': 'Trust + confidence',
  location: 'Location',
};

/**
 * Patient fit score bar with an expandable "Why this score" breakdown.
 * fit + breakdown are computed client-side (specialties ∩ needs, trust/conf,
 * haversine distance). Tier label/color from fitMeta().
 */
export function FitScoreBar({ fit, breakdown, open, onToggle, className }: FitScoreBarProps) {
  const meta = fitMeta(fit);
  const pct = Math.max(0, Math.min(100, fit));
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, fontWeight: fonts.weight.semibold, color: meta.color }}>{meta.label}</span>
        <span style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 14, color: meta.color }}>{Math.round(fit)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: neutral.track, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 999 }} />
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 self-start cursor-pointer"
        style={{ fontSize: 12, fontWeight: fonts.weight.medium, color: neutral.textSoft }}
      >
        Why this score
        <CaretDown weight="bold" size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }} />
      </button>
      {open && (
        <ul className="m-0 mt-0.5 flex list-none flex-col gap-1 p-0">
          {breakdown.map((b) => (
            <li
              key={`${b.src}:${b.label}:${b.pts}`}
              className="flex items-center justify-between"
              style={{ fontSize: 12, color: neutral.textMuted }}
            >
              <span className="flex items-center gap-1.5">
                <span>{b.label}</span>
                <span
                  style={{ fontSize: 10, padding: '1px 5px', borderRadius: 5, color: neutral.textFaint, background: neutral.surfaceWarm, border: `1px solid ${neutral.border}` }}
                >
                  {SRC_LABEL[b.src]}
                </span>
              </span>
              <span style={{ fontWeight: fonts.weight.semibold, color: neutral.textStrong }}>+{b.pts}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
