import { CheckCircle, WarningCircle, XCircle, Question } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { confidence, type ConfidenceLevel } from './theme';

const ICON: Record<ConfidenceLevel, typeof CheckCircle> = {
  high: CheckCircle,
  medium: WarningCircle,
  low: XCircle,
  none: Question,
};

export interface ConfidenceChipProps {
  /** Confidence tier, derived from facilities.conf / detail parsed[].conf via cMeta(). */
  level: ConfidenceLevel;
  /** Override the default tier label (e.g. show the raw "72%" or a field name). */
  label?: string;
  className?: string;
}

/**
 * Per-field confidence indicator (high/medium/low/none). Used on the detail
 * screen's parsed fields and as an uncertainty marker next to a value.
 */
export function ConfidenceChip({ level, label, className }: ConfidenceChipProps) {
  const meta = confidence[level];
  const Icon = ICON[level];
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={{ color: meta.fg, background: meta.bg }}
    >
      <Icon weight="fill" size={12} />
      <span>{label ?? meta.label}</span>
    </span>
  );
}
