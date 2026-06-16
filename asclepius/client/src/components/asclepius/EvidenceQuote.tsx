import { Quotes } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { fonts, neutral, semantic } from './theme';

export interface EvidenceQuoteProps {
  /** facilities.evidence (the FDR description field) — the cited source text. */
  text: string;
  /** Optional attribution shown under the quote (e.g. "Source: site crawl"). */
  sourceLabel?: string;
  className?: string;
}

/**
 * A cited evidence quote with the design's terracotta left-rule
 * (--asc-evidence-rule). Binds to facilities.evidence.
 */
export function EvidenceQuote({ text, sourceLabel, className }: EvidenceQuoteProps) {
  return (
    <figure
      className={cn('m-0', className)}
      style={{
        background: semantic.evidenceBg,
        borderLeft: `3px solid ${semantic.evidenceRule}`,
        borderRadius: '0 11px 11px 0',
        padding: '12px 14px',
      }}
    >
      <Quotes weight="fill" size={16} color={semantic.evidenceRule} />
      <blockquote className="m-0 mt-1" style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 1.5, color: neutral.textMuted }}>
        {text}
      </blockquote>
      {sourceLabel && (
        <figcaption className="mt-2" style={{ fontSize: 12, color: neutral.textFaint2 }}>
          {sourceLabel}
        </figcaption>
      )}
    </figure>
  );
}
