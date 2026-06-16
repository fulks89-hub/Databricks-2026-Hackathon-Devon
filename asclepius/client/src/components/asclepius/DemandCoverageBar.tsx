import { cn } from '@/lib/utils';
import { coverageStatus, fonts, neutral, semantic, type CoverageStatus } from './theme';

export interface DemandCoverageBarProps {
  /** Discipline / district name for this row. */
  name: string;
  /** district_demand.demand_score (0-100). */
  demand: number;
  /** Computed coverage (nearby facilities offering the discipline + roster headcount). */
  coverage: number;
  /** Gap-derived status — thresholds in theme.coverageStatus. */
  status: CoverageStatus;
  /** Optional overlap / context note (e.g. "2 nearby facilities overlap"). */
  overlapText?: string;
  className?: string;
}

/**
 * Demand-vs-coverage bar for one discipline in a district. Demand comes from
 * district_demand.demand_score; coverage from nearby facilities + roster.
 * Status (critical/thin/overlap/covered) from theme.coverageStatus.
 */
export function DemandCoverageBar({ name, demand, coverage, status, overlapText, className }: DemandCoverageBarProps) {
  const meta = coverageStatus[status];
  const demandPct = Math.max(0, Math.min(100, demand));
  const coveragePct = Math.max(0, Math.min(100, coverage));
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 14, fontWeight: fonts.weight.semibold, color: neutral.text }}>{name}</span>
        <span
          className="inline-flex items-center rounded-full"
          style={{ padding: '2px 8px', fontSize: 11, fontWeight: fonts.weight.semibold, color: meta.fg, background: meta.bg }}
        >
          {meta.label}
        </span>
      </div>
      {/* Coverage fill over a demand track. */}
      <div style={{ position: 'relative', height: 8, borderRadius: 999, background: neutral.track, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${demandPct}%`, background: semantic.warnBg }} />
        <div style={{ position: 'absolute', inset: 0, width: `${coveragePct}%`, background: meta.fg, borderRadius: 999 }} />
      </div>
      <div className="flex items-center justify-between" style={{ fontSize: 11, color: neutral.textFaint2 }}>
        <span>Demand {Math.round(demand)}</span>
        <span>Coverage {Math.round(coverage)}</span>
      </div>
      {overlapText && <div style={{ fontSize: 11, color: meta.fg }}>{overlapText}</div>}
    </div>
  );
}
