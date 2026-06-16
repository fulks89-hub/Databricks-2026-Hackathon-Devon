// Asclepius notifications dropdown — opened from the top-bar bell. Mirrors the
// prototype (Asclepius.dc.html §NOTIFICATIONS, lines 1471-1492): a transparent
// click-catcher + a 380px panel pinned under the bell, with a header
// ("Notifications" + "Clear all"), an empty state, and a list of notification
// rows (type-coloured icon tile + text + relative time). Items + clear come
// from the live Lakebase notifications table via the shell's useNotifications().

import {
  Bell,
  BellSlash,
  Handshake,
  PaperPlaneTilt,
  Target,
} from '@phosphor-icons/react';
import { fonts, neutral, role, semantic } from './theme';
import { useLang } from '@/lib/i18n';
import type { Notification } from '@/lib/api';

// type → icon + accent, mirroring the prototype's pushNotif() meta
// (Asclepius.dc.html): reach = "you reached out" (sent message, hospital blue);
// interest = "a clinician is interested" (handshake, clinician green);
// match = "a free agent fits your gap" (target, amber/gold).
function notifMeta(type: string): { Icon: typeof Bell; fg: string; bg: string } {
  switch (type) {
    case 'reach':
      return { Icon: PaperPlaneTilt, fg: role.hospital.base, bg: role.hospital.tint };
    case 'interest':
      return { Icon: Handshake, fg: role.clinician.base, bg: role.clinician.tint };
    case 'match':
      return { Icon: Target, fg: semantic.warn, bg: semantic.warnBg };
    default:
      return { Icon: Bell, fg: neutral.textMuted, bg: '#F4F2EC' };
  }
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
  items: Notification[];
  onClear: () => void;
}

export function NotificationsPanel({ open, onClose, items, onClear }: NotificationsPanelProps) {
  const { t } = useLang();
  if (!open) return null;

  return (
    <div
      className="asc-noprint"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 97, animation: 'ascFade .15s ease both' }}
    >
      <div
        role="dialog"
        aria-label={t('Notifications')}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 62,
          right: 24,
          width: 380,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '70vh',
          background: neutral.surface,
          border: `1px solid ${neutral.border}`,
          borderRadius: 18,
          boxShadow: 'var(--asc-shadow-notif)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'ascPop .18s ease both',
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between gap-2.5 px-[18px] py-[15px]"
          style={{ borderBottom: `1px solid ${neutral.borderCard}` }}
        >
          <span
            className="flex items-center gap-2"
            style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, color: neutral.ink }}
          >
            <Bell weight="fill" size={17} color={role.clinician.base} />
            {t('Notifications')}
          </span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: fonts.body,
                fontWeight: 600,
                fontSize: 12.5,
                color: neutral.textFaint,
              }}
            >
              {t('Clear all')}
            </button>
          )}
        </div>

        {/* list / empty */}
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {items.length === 0 ? (
            <div className="text-center" style={{ padding: '36px 20px', color: neutral.textFaint2 }}>
              <BellSlash size={32} color={neutral.placeholder} />
              <div
                style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 15, color: neutral.textMuted, marginTop: 10 }}
              >
                {t('No notifications yet')}
              </div>
              <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
                {t(
                  "You'll be alerted when a hospital reaches out, an agent shows interest, or a matching free agent appears nearby."
                )}
              </div>
            </div>
          ) : (
            items.map((n) => {
              const meta = notifMeta(n.type);
              return (
                <div
                  key={n.notification_id}
                  className="flex items-start gap-3"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    // Unread rows get a warm highlight (prototype #FBF8F3); read rows
                    // are flat. The shell marks all read on open, so this shows for
                    // notifications that arrive while the panel is already open.
                    background: n.read ? 'transparent' : '#FBF8F3',
                    borderRadius: 12,
                    padding: '12px 13px',
                    marginBottom: 2,
                  }}
                >
                  <span
                    className="flex shrink-0 items-center justify-center"
                    style={{ width: 34, height: 34, borderRadius: 10, background: meta.bg }}
                  >
                    <meta.Icon weight="fill" size={17} color={meta.fg} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block"
                      style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: 13.5, lineHeight: 1.45, color: neutral.text }}
                    >
                      {n.text}
                    </span>
                    <span
                      className="block"
                      style={{ fontSize: 11.5, color: neutral.textDisabled, fontWeight: 600, marginTop: 3 }}
                    >
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsPanel;
