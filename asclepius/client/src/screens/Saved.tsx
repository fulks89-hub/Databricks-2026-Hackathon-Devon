import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useNavigate } from 'react-router';
import {
  Skeleton,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@databricks/appkit-ui/react';
import {
  ArrowRight,
  BookmarkSimple,
  ShareNetwork,
  Trash,
  PaperPlaneTilt,
  QrCode,
  Copy,
  SealCheck,
  Warning,
  Question,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import {
  useShortlist,
  useNotes,
  useReferrals,
  facilityDetail,
  removeShortlist,
  updateReferral,
  deleteReferral,
  useFetch,
  type FacilityRow,
  type Referral,
} from '@/lib/api';
import { fonts, neutral, role as roleTheme, trust as trustTheme } from '@/components/asclepius/theme';
import { normalizeTrust } from './registryShared';

/* ============================================================================
   Saved (/saved) — the shortlist with read-only private notes + Share/QR, and a
   "Referrals you've sent" section. Reads useShortlist / useNotes / useReferrals;
   writes removeShortlist, updateReferral, deleteReferral.
   Matches Asclepius.dc.html §Saved.
   ============================================================================ */

const PATIENT = roleTheme.patient.base;
const CLINICIAN = roleTheme.clinician.base;

// Referral status → label + colors (mirror of the prototype's statusMeta).
const REFERRAL_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  sent: { label: 'Sent', fg: '#9A6A12', bg: '#F6EBD6' },
  accepted: { label: 'Accepted', fg: '#3B6FB0', bg: '#E3ECF6' },
  completed: { label: 'Completed', fg: '#2E7D67', bg: '#E4EFEA' },
};
const statusMeta = (st: string) => REFERRAL_STATUS[st] ?? REFERRAL_STATUS.sent;

function trustPillStyle(t: ReturnType<typeof normalizeTrust>): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: trustTheme[t].bg,
    color: trustTheme[t].fg,
    borderRadius: 999,
    padding: '6px 12px',
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: 12.5,
    whiteSpace: 'nowrap',
  };
}

// Trust-tier → leading pill icon (mirror of the prototype's trustMeta `i`).
const TRUST_ICON: Record<ReturnType<typeof normalizeTrust>, Icon> = {
  verified: SealCheck,
  review: Warning,
  unverified: Question,
};

/* ---- one saved-facility card with a read-only note ------------------------ */
function SavedCard({
  facility,
  note,
  onOpen,
  onRemove,
}: {
  facility: FacilityRow;
  note: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = normalizeTrust(facility.trust);
  const TrustIcon = TRUST_ICON[t];
  const hasNote = note.trim().length > 0;

  return (
    <div className="rounded-[20px]" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}`, boxShadow: 'var(--asc-shadow-hair, 0 1px 2px rgba(43,39,34,.04))', padding: '20px 22px' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-[13px]">
          <span
            className="flex shrink-0 items-center justify-center rounded-[12px]"
            style={{ width: 42, height: 42, background: trustTheme[t].bg, color: trustTheme[t].fg, fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}
          >
            {facility.name.charAt(0)}
          </span>
          <div>
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 17, color: neutral.ink, lineHeight: 1.2 }}>{facility.name}</div>
            <div style={{ fontSize: 13, color: neutral.textFaint2, fontWeight: 500, marginTop: 3 }}>
              {facility.type ?? 'Facility'} · {facility.city ?? '—'}
            </div>
          </div>
        </div>
        <span style={trustPillStyle(t)}>
          <TrustIcon weight="fill" size={13} />
          {trustTheme[t].label}
        </span>
      </div>

      {/* read-only note quote when present */}
      {hasNote && (
        <div
          className="mt-3 rounded-[0_10px_10px_0] px-3.5 py-[11px]"
          style={{ background: '#FCF8F2', borderLeft: `3px solid ${PATIENT}`, fontSize: 14, color: neutral.textMuted, lineHeight: 1.5, fontStyle: 'italic' }}
        >
          {note}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t pt-3.5" style={{ borderColor: neutral.divider2 }}>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 bg-transparent p-0"
          style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: PATIENT, border: 'none', cursor: 'pointer' }}
        >
          Open
          <ArrowRight weight="bold" size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-[10px] px-[13px] py-2"
          style={{ background: 'none', border: `1px solid ${neutral.border}`, fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: '#8A8174', cursor: 'pointer' }}
        >
          <Trash size={14} />
          Remove
        </button>
      </div>
    </div>
  );
}

/* ---- one referral row ----------------------------------------------------- */
function ReferralRow({
  referral,
  onAdvance,
  onRemove,
  onOpen,
}: {
  referral: Referral;
  onAdvance: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const sm = statusMeta(referral.status);
  const canAdvance = referral.status !== 'completed';
  const advanceLabel = referral.status === 'sent' ? 'Mark accepted' : 'Mark completed';
  return (
    <div className="rounded-[18px] p-5" style={{ background: '#fff', border: `1px solid ${neutral.borderCard}` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 16, color: neutral.ink }}>{referral.facility_name ?? 'Facility'}</div>
          <div style={{ fontSize: 12.5, color: neutral.textFaint2, fontWeight: 500, marginTop: 2 }}>
            {[referral.city, referral.state].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px]"
          style={{ background: sm.bg, color: sm.fg, fontFamily: fonts.body, fontWeight: 600, fontSize: 12 }}
        >
          {sm.label}
        </span>
      </div>
      {(referral.patient || referral.reason) && (
        <div className="mt-[11px]" style={{ fontSize: 13.5, color: neutral.textMuted, lineHeight: 1.5 }}>
          {referral.patient && <span style={{ fontWeight: 700, color: neutral.text }}>{referral.patient}</span>}
          {referral.patient && referral.reason ? ' — ' : ''}
          {referral.reason}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2.5 border-t pt-3" style={{ borderColor: neutral.divider2 }}>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-[10px] px-[13px] py-2"
          style={{ background: 'none', border: `1px solid ${neutral.border}`, fontFamily: fonts.body, fontWeight: 600, fontSize: 13, color: neutral.textSoft, cursor: 'pointer' }}
        >
          Facility
        </button>
        {canAdvance && (
          <button
            type="button"
            onClick={onAdvance}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-[13px] py-2"
            style={{ background: CLINICIAN, color: '#fff', border: 'none', fontFamily: fonts.body, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            <ArrowRight weight="bold" size={13} />
            {advanceLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove referral"
          className="inline-flex w-[34px] items-center justify-center rounded-[10px] p-2"
          style={{ background: 'none', border: `1px solid ${neutral.border}`, color: '#8A8174', cursor: 'pointer' }}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

export function Saved() {
  const navigate = useNavigate();
  const shortlist = useShortlist();
  const notes = useNotes();
  const referrals = useReferrals();
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Resolve the shortlisted ids to full facility rows. Re-runs when the id set
  // changes (joined into a stable key so the useFetch dep is primitive).
  const ids = useMemo(() => (shortlist.data ?? []).map((s) => s.facility_id), [shortlist.data]);
  const idKey = ids.join(',');
  const facilities = useFetch<FacilityRow[]>(
    async () => {
      if (ids.length === 0) return [];
      const rows = await Promise.all(ids.map((id) => facilityDetail(id)));
      return rows.filter((r): r is FacilityRow => r != null);
    },
    [idKey],
  );

  const noteFor = (id: string) => notes.data?.find((n) => n.facility_id === id)?.text ?? '';

  const loading = shortlist.loading || facilities.loading;
  const error = shortlist.error ?? facilities.error;
  const rows = facilities.data ?? [];
  const savedEmpty = !loading && rows.length === 0;
  const refList = referrals.data ?? [];

  const shareLink = useMemo(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://asclepius.app';
    return `${base}/saved#s=${ids.join(',')}`;
  }, [ids]);

  const savedSub = savedEmpty
    ? 'Saved facilities live here — on this device, with your notes.'
    : `${rows.length} ${rows.length === 1 ? 'facility' : 'facilities'} saved on this device, notes included.`;

  async function handleRemove(facilityId: string) {
    await removeShortlist(facilityId);
    shortlist.refetch();
  }

  async function handleAdvance(r: Referral) {
    const next = r.status === 'sent' ? 'accepted' : 'completed';
    await updateReferral(r.referral_id, next);
    referrals.refetch();
  }

  async function handleRemoveReferral(r: Referral) {
    await deleteReferral(r.referral_id);
    referrals.refetch();
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-10 pb-20 pt-10" style={{ animation: 'ascFade .45s ease both' }}>
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 36, letterSpacing: '-.025em', color: neutral.ink, margin: 0 }}>
            Your saved list
          </h2>
          <p style={{ fontSize: 16, color: neutral.textSoft, margin: '8px 0 0' }}>{savedSub}</p>
        </div>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          disabled={savedEmpty}
          className="inline-flex items-center gap-2 rounded-[11px] px-[15px] py-2.5"
          style={{ background: '#fff', border: `1px solid ${neutral.border}`, fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: neutral.text, cursor: savedEmpty ? 'default' : 'pointer', opacity: savedEmpty ? 0.55 : 1 }}
        >
          <ShareNetwork weight="fill" size={16} style={{ color: PATIENT }} />
          Share / QR
        </button>
      </div>

      {error && (
        <div className="mt-6" style={{ color: '#B2503C', fontWeight: 600, fontSize: 14 }}>
          Couldn’t load your saved list — {error}
        </div>
      )}

      {/* loading skeletons */}
      {loading && (
        <div className="mt-6 flex flex-col gap-3.5">
          {['s1', 's2'].map((sk) => (
            <Skeleton key={sk} className="h-[160px] rounded-[20px]" />
          ))}
        </div>
      )}

      {/* empty state */}
      {savedEmpty && !error && (
        <div
          className="mt-[26px] rounded-[22px] px-10 py-14 text-center"
          style={{ background: '#fff', border: `1px dashed ${neutral.borderDashed}`, color: neutral.textFaint2 }}
        >
          <BookmarkSimple size={40} style={{ color: neutral.placeholder }} />
          <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 18, color: neutral.textMuted, marginTop: 12 }}>Nothing saved yet</div>
          <div className="mx-auto mt-1.5 max-w-[26em]" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
            Save facilities from your matches and they’ll wait here — notes and all — next time you open Asclepius.
          </div>
          <Link
            to="/patient/location"
            className="mt-[18px] inline-flex rounded-[12px]"
            style={{ background: PATIENT, color: '#fff', padding: '13px 22px', fontFamily: fonts.body, fontWeight: 700, fontSize: 15 }}
          >
            Start a search
          </Link>
        </div>
      )}

      {/* saved cards */}
      {!loading && rows.length > 0 && (
        <div className="mt-6 flex flex-col gap-3.5">
          {rows.map((f) => (
            <SavedCard
              key={f.id}
              facility={f}
              note={noteFor(f.id)}
              onOpen={() => void navigate(`/facility/${f.id}`)}
              onRemove={() => void handleRemove(f.id)}
            />
          ))}
        </div>
      )}

      {/* referrals you've sent */}
      {refList.length > 0 && (
        <div className="mt-[34px]">
          <div className="mb-3.5 flex items-center gap-2.5">
            <PaperPlaneTilt weight="fill" size={20} style={{ color: PATIENT }} />
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, margin: 0, color: neutral.ink }}>Referrals you’ve sent</h3>
            <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 12, background: roleTheme.patient.tint, color: roleTheme.patient.press, borderRadius: 999, padding: '3px 10px' }}>
              {refList.length}
            </span>
          </div>
          {referrals.loading ? (
            <Skeleton className="h-[120px] rounded-[18px]" />
          ) : (
            <div className="flex flex-col gap-3">
              {refList.map((r) => (
                <ReferralRow
                  key={r.referral_id}
                  referral={r}
                  onAdvance={() => void handleAdvance(r)}
                  onRemove={() => void handleRemoveReferral(r)}
                  onOpen={() => r.facility_id && void navigate(`/facility/${r.facility_id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* share modal */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ fontFamily: fonts.display, color: neutral.ink }}>
              <ShareNetwork weight="fill" size={18} style={{ color: PATIENT }} />
              Share your shortlist
            </DialogTitle>
          </DialogHeader>
          <div className="text-center">
            <p style={{ fontSize: 13.5, color: neutral.textSoft, margin: '0 0 16px', lineHeight: 1.5 }}>
              Scan to open this shortlist on a phone, or copy the link to send to a patient or family member.
            </p>
            <div
              className="mx-auto flex items-center justify-center overflow-hidden rounded-[12px]"
              style={{ width: 168, height: 168, border: `1px solid ${neutral.borderCard}`, color: neutral.placeholder }}
            >
              <QrCode size={40} />
            </div>
            <div className="mt-[18px] flex gap-2">
              <Input value={shareLink} readOnly className="min-w-0 flex-1" style={{ background: '#FCFAF6', fontSize: 12.5, color: neutral.textSoft }} />
              <button
                type="button"
                onClick={() => void copyShare()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[11px] px-4 py-[11px]"
                style={{ background: PATIENT, color: '#fff', border: 'none', fontFamily: fonts.body, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
              >
                <Copy weight="fill" size={14} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Saved;
