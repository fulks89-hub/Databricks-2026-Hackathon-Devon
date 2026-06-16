import { CheckCircle, WarningCircle, XCircle, ThumbsUp, ThumbsDown } from '@phosphor-icons/react';
import { Button } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { claim, fonts, neutral, semantic, type ClaimStatus } from './theme';

const ICON: Record<ClaimStatus, typeof CheckCircle> = {
  verified: CheckCircle,
  claimed: WarningCircle,
  'no-evidence': XCircle,
};

export type ClaimUserMark = 'confirmed' | 'disputed';

export interface ClaimRowProps {
  /** facilities.claims[].text — the claimed capability. */
  label: string;
  /** facilities.claims[].status — verified / claimed / no-evidence. */
  status: ClaimStatus;
  /** The caller's prior decision for this claim (from the reviews table), if any. */
  userMark?: ClaimUserMark;
  /** Confirm handler -> reviews write (claim_decision='confirmed'). */
  onConfirm: () => void;
  /** Dispute handler -> reviews write (claim_decision='disputed'). */
  onDispute: () => void;
  className?: string;
}

/**
 * One claimed-capability row with a status badge and confirm/dispute actions.
 * Binds to facilities.claims[]; confirm/dispute drive the reviews table.
 */
export function ClaimRow({ label, status, userMark, onConfirm, onDispute, className }: ClaimRowProps) {
  const meta = claim[status];
  const Icon = ICON[status];
  return (
    <div
      className={cn('flex items-center justify-between gap-3', className)}
      style={{ background: neutral.surfaceWarm2, border: `1px solid ${neutral.divider2}`, borderRadius: 11, padding: '10px 12px' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon weight="fill" size={16} color={meta.fg} />
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 14, fontWeight: fonts.weight.medium, color: neutral.text }}>
            {label}
          </div>
          <span style={{ fontSize: 11, fontWeight: fonts.weight.semibold, color: meta.fg }}>{meta.label}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant={userMark === 'confirmed' ? 'default' : 'outline'}
          size="sm"
          onClick={onConfirm}
          aria-pressed={userMark === 'confirmed'}
          style={userMark === 'confirmed' ? { background: semantic.success, borderColor: semantic.success } : { color: semantic.success, borderColor: neutral.border }}
        >
          <ThumbsUp weight={userMark === 'confirmed' ? 'fill' : 'regular'} size={14} />
          Confirm
        </Button>
        <Button
          type="button"
          variant={userMark === 'disputed' ? 'default' : 'outline'}
          size="sm"
          onClick={onDispute}
          aria-pressed={userMark === 'disputed'}
          style={userMark === 'disputed' ? { background: semantic.danger, borderColor: semantic.danger } : { color: semantic.danger, borderColor: neutral.border }}
        >
          <ThumbsDown weight={userMark === 'disputed' ? 'fill' : 'regular'} size={14} />
          Dispute
        </Button>
      </div>
    </div>
  );
}
