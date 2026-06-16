import { User, Stethoscope, Hospital } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { role, roleLabel, type Role } from './theme';

const ICON: Record<Role, typeof User> = {
  patient: User,
  clinician: Stethoscope,
  hospital: Hospital,
};

export interface RoleBadgeProps {
  /** Active role — drives accent color, icon, and label. */
  role: Role;
  /** Override the default role label ("Patient" / "Clinician" / "Hospital"). */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Role pill (patient #E0714C / clinician #2E7D67 / hospital #3B6FB0) — the
 * prototype's rolePill. Tints to the active role accent.
 */
export function RoleBadge({ role: r, label, size = 'md', className }: RoleBadgeProps) {
  const accent = role[r].base;
  const tint = role[r].tint;
  const Icon = ICON[r];
  const sm = size === 'sm';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full font-semibold', sm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]', className)}
      style={{ color: accent, background: tint }}
    >
      <Icon weight="fill" size={sm ? 13 : 15} />
      <span>{label ?? roleLabel[r]}</span>
    </span>
  );
}
