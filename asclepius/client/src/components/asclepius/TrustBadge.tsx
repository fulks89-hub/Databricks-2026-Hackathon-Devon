import { SealCheck, Warning, Question } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { trust, type TrustState } from './theme';

const ICON: Record<TrustState, typeof SealCheck> = {
  verified: SealCheck,
  review: Warning,
  unverified: Question,
};

export interface TrustBadgeProps {
  /** facilities.trust */
  trust: TrustState;
  /** facilities.conf — when present, renders the "· 91% confidence" suffix */
  conf?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Trust tier -> color + Phosphor icon + label, with an optional confidence
 * suffix. Binds to facilities.trust (+ facilities.conf). Colors from theme.trust.
 */
export function TrustBadge({ trust: t, conf, size = 'md', className }: TrustBadgeProps) {
  const meta = trust[t];
  const Icon = ICON[t];
  const sm = size === 'sm';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full font-semibold', sm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]', className)}
      style={{ color: meta.fg, background: meta.bg }}
    >
      <Icon weight="fill" size={sm ? 13 : 15} />
      <span>{meta.label}</span>
      {conf != null && <span style={{ opacity: 0.8 }}>· {conf}% confidence</span>}
    </span>
  );
}
