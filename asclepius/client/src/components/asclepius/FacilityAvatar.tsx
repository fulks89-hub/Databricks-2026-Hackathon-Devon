import { cn } from '@/lib/utils';
import { avatarStyle, fonts, type TrustState } from './theme';

export interface FacilityAvatarProps {
  /** facilities.name[0] — the leading initial. */
  initial: string;
  /** facilities.trust — drives the avatar bg/fg via avatar(). */
  trust: TrustState;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const DIM: Record<NonNullable<FacilityAvatarProps['size']>, number> = { sm: 32, md: 40, lg: 52 };

/**
 * Round facility avatar — the leading initial tinted by trust tier.
 * Binds to facilities.name + facilities.trust.
 */
export function FacilityAvatar({ initial, trust, size = 'md', className }: FacilityAvatarProps) {
  const { bg, fg } = avatarStyle(trust);
  const dim = DIM[size];
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full select-none', className)}
      style={{
        width: dim,
        height: dim,
        background: bg,
        color: fg,
        fontFamily: fonts.display,
        fontWeight: fonts.weight.bold,
        fontSize: dim * 0.42,
      }}
      aria-hidden
    >
      {(initial || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
