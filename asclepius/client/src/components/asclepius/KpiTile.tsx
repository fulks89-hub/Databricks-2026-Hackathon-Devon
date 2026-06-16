import { cn } from '@/lib/utils';
import { fonts, neutral, role, semantic } from './theme';

export type KpiAccent = 'ink' | 'patient' | 'hospital' | 'clinician' | 'danger';

const ACCENT: Record<KpiAccent, string> = {
  ink: neutral.ink,
  patient: role.patient.base,
  hospital: role.hospital.base,
  clinician: role.clinician.base,
  danger: semantic.danger,
};

export interface KpiTileProps {
  /** The big numeral / value (Bricolage display font). */
  value: string | number;
  /** Caption under the value. */
  label: string;
  /** Optional secondary hint line. */
  hint?: string;
  accent?: KpiAccent;
  className?: string;
}

/**
 * A single KPI tile (Board Report stats, Atlas / data-quality numerals).
 * Sources include roster totals, report gap counts, pipeline count,
 * gold_district_supply_need.facility_count, state_coverage.coverage_index.
 */
export function KpiTile({ value, label, hint, accent = 'ink', className }: KpiTileProps) {
  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      style={{
        background: neutral.surface,
        border: `1px solid ${neutral.borderCard}`,
        borderRadius: 16,
        padding: '16px 18px',
      }}
    >
      <div style={{ fontFamily: fonts.display, fontWeight: fonts.weight.extra, fontSize: 30, lineHeight: 1.05, color: ACCENT[accent] }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: fonts.weight.medium, color: neutral.textSoft }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: neutral.textFaint2 }}>{hint}</div>}
    </div>
  );
}
