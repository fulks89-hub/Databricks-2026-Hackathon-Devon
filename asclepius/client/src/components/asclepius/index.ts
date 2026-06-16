// Asclepius shared component library — presentational (props-driven, no data
// fetching) building blocks for the 17 screens. See docs/DESIGN_SYSTEM.md §2.

// Design tokens (typed twin of tokens.css) + app_state row-shape types.
export * from './theme';
export type { Claim, Discipline, FacilityRow, FitReason } from './types';

// Atoms / display
export { TrustBadge, type TrustBadgeProps } from './TrustBadge';
export { ConfidenceChip, type ConfidenceChipProps } from './ConfidenceChip';
export { CoordSourceBadge, type CoordSourceBadgeProps } from './CoordSourceBadge';
export { RoleBadge, type RoleBadgeProps } from './RoleBadge';
export { KpiTile, type KpiTileProps, type KpiAccent } from './KpiTile';
export { EvidenceQuote, type EvidenceQuoteProps } from './EvidenceQuote';
export { FacilityAvatar, type FacilityAvatarProps } from './FacilityAvatar';
export { DisciplineChips, type DisciplineChipsProps } from './DisciplineChips';
export { FitScoreBar, type FitScoreBarProps } from './FitScoreBar';
export { DemandCoverageBar, type DemandCoverageBarProps } from './DemandCoverageBar';

// Composite cards / rows
export { ClaimRow, type ClaimRowProps, type ClaimUserMark } from './ClaimRow';
export { FacilityCard, type FacilityCardProps, type FacilityCardReason } from './FacilityCard';
export { PersonaCard, type PersonaCardProps } from './PersonaCard';

// Floating AI assistant widget (mounted globally in App.tsx)
export { ChatAssistant, type ChatAssistantProps } from './ChatAssistant';

// Cross-cutting shell overlays (mounted in App.tsx): ⌘K command palette + the
// top-bar notifications dropdown.
export { CommandPalette, type CommandPaletteProps } from './CommandPalette';
export { NotificationsPanel, type NotificationsPanelProps } from './NotificationsPanel';
