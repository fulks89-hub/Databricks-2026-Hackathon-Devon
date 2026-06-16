import { MapPin, Buildings, BookmarkSimple, Lightbulb, Gauge } from '@phosphor-icons/react';
import { Card, CardContent, Button } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import { fonts, neutral, role, semantic, type Role } from './theme';
import type { FacilityRow, FitReason } from './types';
import { FacilityAvatar } from './FacilityAvatar';
import { TrustBadge } from './TrustBadge';
import { DisciplineChips } from './DisciplineChips';
import { FitScoreBar } from './FitScoreBar';
import { EvidenceQuote } from './EvidenceQuote';

export interface FacilityCardReason {
  /** A short "why this surfaced" reason chip. */
  text: string;
}

export interface FacilityCardProps {
  /** One app_state.facilities row. */
  facility: FacilityRow;
  /** Active role — drives accent and which secondary affordance shows. */
  role: Role;
  /** "Why this surfaced" reason chips. */
  reasons?: FacilityCardReason[];
  /**
   * Verbatim cited facility text backing the match (a claim or the FDR
   * description). When present, an EvidenceQuote renders after the reason chips
   * so the patient sees the actual words, not just a computed score. Never
   * fabricated by the card — the caller passes exact source text or nothing.
   */
  evidence?: { text: string; source?: string };
  /**
   * Record completeness 0–100. When provided (patient-facing cards), the card
   * shows a neutral "{n} out of 100 data points have information" pill in place
   * of the TrustBadge — patients get an honest data-completeness signal rather
   * than the "Needs review" trust tier, which reads as alarming out of context.
   */
  dataPoints?: number;
  /** Patient fit score (renders the FitScoreBar when present). */
  fit?: number;
  /** Breakdown for the FitScoreBar "why this score" panel. */
  whyBreakdown?: FitReason[];
  /** Whether the fit breakdown is expanded. */
  whyOpen?: boolean;
  /** Toggle the fit breakdown. */
  onToggleWhy?: () => void;
  /** Clinician opportunity badge text (shown instead of fit for clinicians). */
  opp?: string;
  /** Whether this facility is on the shortlist. */
  saved?: boolean;
  /** Open the facility detail. */
  onOpen: () => void;
  /** Toggle the shortlist (shortlist write). */
  onSave: () => void;
  className?: string;
}

/**
 * The shared facility result card. Takes one facilities-view row plus role
 * context. Renders TrustBadge + specialties + distance/location, and either a
 * patient FitScoreBar (with "why this score") or a clinician opportunity badge.
 * Save toggles the shortlist table. Used in Patient Results, Clinician
 * Opportunities, Saved, and Registry Browse.
 */
export function FacilityCard({
  facility,
  role: r,
  reasons,
  evidence,
  dataPoints,
  fit,
  whyBreakdown,
  whyOpen = false,
  onToggleWhy,
  opp,
  saved = false,
  onOpen,
  onSave,
  className,
}: FacilityCardProps) {
  const accent = role[r].base;
  const showFit = fit != null && whyBreakdown != null && typeof onToggleWhy === 'function';

  return (
    <Card className={cn('transition-shadow hover:shadow-md', className)} style={{ borderColor: neutral.borderCard, borderRadius: 20 }}>
      <CardContent className="flex flex-col gap-3" style={{ padding: 16 }}>
        <div className="flex items-start gap-3">
          <FacilityAvatar initial={facility.name} trust={facility.trust} />
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left cursor-pointer">
            <div className="truncate" style={{ fontFamily: fonts.display, fontWeight: fonts.weight.bold, fontSize: 16, color: neutral.ink }}>
              {facility.name}
            </div>
            <div className="mt-0.5 flex items-center gap-2" style={{ fontSize: 13, color: neutral.textSoft }}>
              <span className="inline-flex items-center gap-1">
                <Buildings weight="bold" size={13} />
                {facility.type}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin weight="bold" size={13} />
                {facility.city}, {facility.state}
              </span>
            </div>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onSave}
            aria-pressed={saved}
            aria-label={saved ? 'Remove from saved' : 'Save'}
            style={{ color: saved ? accent : neutral.textFaint }}
          >
            <BookmarkSimple weight={saved ? 'fill' : 'regular'} size={18} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dataPoints != null ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ color: neutral.textMuted, background: neutral.bgSunken, border: `1px solid ${neutral.border}` }}
              title="How much of this facility's record is filled in"
            >
              <Gauge weight="fill" size={13} />
              {`${dataPoints} out of 100 data points have information`}
            </span>
          ) : (
            <TrustBadge trust={facility.trust} conf={facility.conf} size="sm" />
          )}
        </div>

        {facility.specialties.length > 0 && (
          <DisciplineChips disciplines={facility.specialties.slice(0, 6)} accent={r} size="sm" />
        )}

        {reasons && reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <span
                key={reason.text}
                className="inline-flex items-center gap-1 rounded-full"
                style={{ padding: '2px 8px', fontSize: 11, color: semantic.gold, background: semantic.goldSurface, border: `1px solid ${semantic.goldSurfaceBorder}` }}
              >
                <Lightbulb weight="fill" size={11} />
                {reason.text}
              </span>
            ))}
          </div>
        )}

        {evidence && <EvidenceQuote text={evidence.text} sourceLabel={evidence.source} />}

        {showFit && <FitScoreBar fit={fit} breakdown={whyBreakdown} open={whyOpen} onToggle={onToggleWhy} />}

        {opp && !showFit && (
          <span
            className="inline-flex w-fit items-center gap-1 rounded-full"
            style={{ padding: '3px 10px', fontSize: 12, fontWeight: fonts.weight.semibold, color: role.clinician.base, background: role.clinician.tint }}
          >
            {opp}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
