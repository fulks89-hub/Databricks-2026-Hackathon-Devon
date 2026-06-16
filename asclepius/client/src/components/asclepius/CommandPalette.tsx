// Asclepius ⌘K command palette — global "jump to a screen, action or facility"
// overlay. Mirrors the prototype (Asclepius.dc.html §COMMAND PALETTE, lines
// 1432-1452 + the cmds list ~2597-2610): a scrim + centered 560px card with a
// magnifier input (ESC chip), and a scrollable list of nav targets and facility
// matches. Opened by the global ⌘K / Ctrl+K listener in App.tsx; ESC or a scrim
// click closes it. Facility rows come from the live registry via useSearchFacilities.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  MagnifyingGlass,
  ArrowElbowDownLeft,
  House,
  User,
  Stethoscope,
  Buildings,
  MapTrifold,
  Database,
  Gauge,
  BookmarkSimple,
  ChatCircleDots,
  FirstAid,
} from '@phosphor-icons/react';
import { useSearchFacilities } from '@/lib/api';
import { fonts, neutral, role } from './theme';
import { useLang } from '@/lib/i18n';

interface Command {
  id: string;
  label: string;
  sub: string;
  Icon: typeof House;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset + focus each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Defer focus to the next frame so the input is mounted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Live facility search (only meaningful once the user types ≥2 chars).
  const q = query.trim();
  const { data: facilities } = useSearchFacilities(q.length >= 2 ? { q, limit: 6 } : undefined);

  const go = (path: string) => () => {
    onClose();
    void navigate(path);
  };

  const navCommands = useMemo<Command[]>(
    () => [
      { id: 'home', label: 'Home / role select', sub: 'Go to', Icon: House, run: go('/') },
      { id: 'patient', label: 'Patient — find care', sub: 'Go to', Icon: User, run: go('/patient/location') },
      { id: 'clinician', label: 'Clinician — opportunities', sub: 'Go to', Icon: Stethoscope, run: go('/clinician/profile') },
      { id: 'hospital', label: 'Hospital — coverage & recruiting', sub: 'Go to', Icon: Buildings, run: go('/hospital/roster') },
      { id: 'atlas', label: 'Coverage Atlas', sub: 'Go to', Icon: MapTrifold, run: go('/atlas') },
      { id: 'registry', label: 'Facility registry', sub: 'Go to', Icon: Database, run: go('/registry') },
      { id: 'quality', label: 'Data quality desk', sub: 'Go to', Icon: Gauge, run: go('/registry') },
      { id: 'saved', label: 'Saved & referrals', sub: 'Go to', Icon: BookmarkSimple, run: go('/saved') },
      {
        id: 'assistant',
        label: 'Open assistant',
        sub: 'Go to',
        Icon: ChatCircleDots,
        run: () => {
          onClose();
          try {
            window.dispatchEvent(new CustomEvent('asc:open-assistant'));
          } catch {
            /* no-op outside the browser */
          }
        },
      },
    ],
    // navigate is stable; go() closes over it + onClose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose, navigate]
  );

  const commands = useMemo<Command[]>(() => {
    const ql = q.toLowerCase();
    const navMatches = ql
      ? navCommands.filter((c) => c.label.toLowerCase().includes(ql) || c.sub.toLowerCase().includes(ql))
      : navCommands;
    const facilityMatches: Command[] =
      q.length >= 2 && facilities
        ? facilities.map((f) => ({
            id: `fac-${f.id}`,
            label: f.name,
            sub: [f.city, f.state].filter(Boolean).join(', ') || 'Facility',
            Icon: FirstAid,
            run: go(`/facility/${f.id}`),
          }))
        : [];
    return [...navMatches, ...facilityMatches].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, facilities, navCommands]);

  // Keep the highlight in range as the result set shrinks/grows while typing.
  useEffect(() => {
    setActive((a) => (a >= commands.length ? Math.max(0, commands.length - 1) : a));
  }, [commands.length]);

  // Scroll the highlighted row into view as the user arrows through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  return (
    <div
      className="asc-noprint"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((a) => (commands.length === 0 ? 0 : (a + 1) % commands.length));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((a) => (commands.length === 0 ? 0 : (a - 1 + commands.length) % commands.length));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          commands[active]?.run();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99, // --asc-z-cmdk
        background: 'var(--asc-scrim)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '14vh 24px 24px',
        animation: 'ascFade .15s ease both',
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '100%',
          background: neutral.surface,
          borderRadius: 18,
          boxShadow: 'var(--asc-shadow-cmdk)',
          overflow: 'hidden',
          animation: 'ascPop .15s ease both',
        }}
      >
        {/* search row */}
        <div
          className="flex items-center gap-[11px] px-[18px] py-[15px]"
          style={{ borderBottom: `1px solid ${neutral.borderCard}` }}
        >
          <MagnifyingGlass size={20} color={neutral.textFaint2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t('Jump to a screen, action or facility…')}
            aria-label="Search commands and facilities"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'none',
              fontFamily: fonts.body,
              fontSize: 16,
              color: neutral.ink,
            }}
          />
          <span
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: 11,
              color: neutral.textDisabled,
              border: `1px solid ${neutral.border}`,
              borderRadius: 6,
              padding: '3px 7px',
            }}
          >
            ESC
          </span>
        </div>

        {/* results */}
        <div ref={listRef} style={{ maxHeight: '50vh', overflowY: 'auto', padding: 8 }}>
          {commands.length === 0 ? (
            <div
              className="text-center"
              style={{ padding: '28px 20px', fontFamily: fonts.body, fontSize: 13.5, color: neutral.textFaint2 }}
            >
              No matches for “{query}”.
            </div>
          ) : (
            commands.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                data-idx={idx}
                onClick={c.run}
                onMouseMove={() => setActive(idx)}
                className="asc-cmdk-row flex w-full items-center gap-3 text-left"
                style={{
                  background: idx === active ? '#F7F2EA' : 'none',
                  border: 'none',
                  borderRadius: 11,
                  padding: '11px 13px',
                  cursor: 'pointer',
                }}
              >
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{ width: 34, height: 34, borderRadius: 9, background: '#F4F2EC' }}
                >
                  <c.Icon weight="fill" size={17} color={role.clinician.base} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate"
                    style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 14.5, color: neutral.ink }}
                  >
                    {c.label}
                  </span>
                  <span className="block truncate" style={{ fontSize: 12, color: neutral.textFaint2 }}>
                    {c.sub}
                  </span>
                </span>
                <ArrowElbowDownLeft
                  weight="bold"
                  size={15}
                  color={idx === active ? role.clinician.base : neutral.placeholder}
                />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
