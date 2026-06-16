import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatCircleDots,
  PaperPlaneTilt,
  Sparkle,
  X,
  CircleNotch,
  ArrowRight,
  ArrowBendDownRight,
  Quotes,
  CheckCircle,
  WarningCircle,
  XCircle,
  Microphone,
} from '@phosphor-icons/react';
import { Button, Input } from '@databricks/appkit-ui/react';
import { useLang } from '@/lib/i18n';
import {
  askAssistant,
  saveShortlist,
  createReferral,
  createPosting,
  type AssistantPersona,
  type AssistantCitation,
  type AssistantUncertainty,
  type AssistantSuggestedAction,
  type AssistantMode,
} from '@/lib/api';
import { confidence, neutral, role as roleTokens, fonts } from './theme';

/* ============================================================================
   ChatAssistant — floating, persona-aware, cited AI assistant widget.

   A bottom-right round green FAB opens a panel grounded in the Asclepius data.
   Every assistant turn carries server-guarded citations (rendered as inline
   [facility • field] chips), a per-message confidence chip (uncertainty band +
   score), and confirmable action chips wired to the existing write fns
   (saveShortlist / createReferral / createPosting). The server owns retrieval,
   the FM call and the citation guard — this component only renders + confirms.

   Look mirrors design-import/Asclepius.dc.html (the chat panel ~1393-1428 and
   the toggle FAB ~1430): 384px panel, clinician-green header, scrollable bubble
   list, a footer input + send. Mounted globally in App.tsx (every route but
   Landing); the active persona is passed in from roleFromPath.
   ============================================================================ */

const PERSONA_LABEL: Record<AssistantPersona, string> = {
  patient: 'Patient',
  clinician: 'Clinician',
  hospital: 'Hospital',
  planner: 'Planner',
};

/** Persona-tuned opening line + suggested prompts (EN only for v1). */
const PERSONA_INTRO: Record<AssistantPersona, { greeting: string; presets: string[] }> = {
  patient: {
    greeting:
      "Hi — I'm grounded in the Asclepius facility data. Tell me where you are and what you need, and I'll find trusted, cited care. I never diagnose.",
    presets: ['Cardiology hospital near Pune', 'Where can I get a maternity check-up?', 'Find a verified eye clinic'],
  },
  clinician: {
    greeting:
      "Hi — I'm grounded in the Asclepius facility + coverage data. Ask me where your discipline is needed most, and I'll cite the source for every claim.",
    presets: [
      'Where is cardiology coverage thinnest?',
      'Districts that need pediatricians',
      'Hospitals lacking trauma care',
    ],
  },
  hospital: {
    greeting:
      "Hi — I'm grounded in the Asclepius coverage data. Ask about your gaps and local demand, and I can draft a recruiting posting for you to confirm.",
    presets: ['What disciplines are we missing nearby?', 'Coverage gaps in my district', 'Help me post an opening'],
  },
  planner: {
    greeting:
      "Hi — I'm grounded in the Asclepius readiness layer. Ask me to rank facilities by data completeness, data confidence, or number of gaps, and I'll pull the exact records that need fixing first.",
    presets: [
      'Top 10 facilities with the most missing data',
      'Lowest data-quality facilities',
      'Which facilities have the most gaps?',
    ],
  },
};

/** Map the server uncertainty band to the shared ConfidenceChip palette. */
const BAND_META: Record<AssistantUncertainty['band'], { fg: string; bg: string; Icon: typeof CheckCircle }> = {
  high: { fg: confidence.high.fg, bg: confidence.high.bg, Icon: CheckCircle },
  medium: { fg: confidence.medium.fg, bg: confidence.medium.bg, Icon: WarningCircle },
  low: { fg: confidence.low.fg, bg: confidence.low.bg, Icon: XCircle },
};

/** A rendered chat message — stable `id` keys the list (never the array index). */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: AssistantCitation[];
  uncertainty: AssistantUncertainty | null;
  mode: AssistantMode | null;
  actions: ConfirmableAction[];
}

/** A suggested action plus its confirm state (one per assistant message). */
interface ConfirmableAction {
  id: string;
  action: AssistantSuggestedAction;
  status: 'idle' | 'running' | 'done' | 'error';
}

/** Read a string field off the validated action payload (lint-safe, no any). */
function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

export interface ChatAssistantProps {
  /** Active persona, derived from the route in App.tsx (defaults to patient). */
  persona: AssistantPersona;
}

export function ChatAssistant({ persona }: ChatAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { speechLang } = useLang();

  // Stable unique ids for list keys — an incrementing counter ref so we never
  // key by array index (deploy-gate lint rule).
  const idCounter = useRef(0);
  const nextId = useCallback((prefix: string) => {
    idCounter.current += 1;
    return `${prefix}-${String(idCounter.current)}`;
  }, []);

  // Auto-scroll the message list to the newest turn.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // Open the assistant from anywhere — the ⌘K command palette dispatches this.
  useEffect(() => {
    const openFromEvent = () => setOpen(true);
    window.addEventListener('asc:open-assistant', openFromEvent);
    return () => window.removeEventListener('asc:open-assistant', openFromEvent);
  }, []);

  const intro = PERSONA_INTRO[persona];
  const accent = roleTokens.clinician.base; // the assistant chrome is always green

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setError(null);
      setInput('');

      const userMsg: ChatMessage = {
        id: nextId('u'),
        role: 'user',
        content: trimmed,
        citations: [],
        uncertainty: null,
        mode: null,
        actions: [],
      };
      // Snapshot history (prior turns) BEFORE appending this user turn.
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);

      try {
        const res = await askAssistant({
          persona,
          message: trimmed,
          history,
        });
        const assistantMsg: ChatMessage = {
          id: nextId('a'),
          role: 'assistant',
          content: res.answer || 'I could not find source text to support an answer.',
          citations: res.citations,
          uncertainty: res.uncertainty,
          mode: res.mode,
          actions: res.suggestedActions.map((action) => ({
            id: nextId('act'),
            action,
            status: 'idle',
          })),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'The assistant is unavailable.');
      } finally {
        setBusy(false);
      }
    },
    [persona, busy, messages, nextId]
  );

  // Execute one validated action via the matching write fn, on user confirm.
  const confirmAction = useCallback(async (messageId: string, actionId: string) => {
    let target: ConfirmableAction | undefined;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          actions: m.actions.map((a) => {
            if (a.id !== actionId) return a;
            target = a;
            return { ...a, status: 'running' };
          }),
        };
      })
    );
    if (!target) return;
    const { action } = target;

    const finish = (status: ConfirmableAction['status']) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                actions: m.actions.map((a) => (a.id === actionId ? { ...a, status } : a)),
              }
            : m
        )
      );
    };

    try {
      const p = action.payload;
      if (action.type === 'shortlist') {
        const facilityId = payloadString(p, 'facility_id');
        if (!facilityId) throw new Error('Missing facility for shortlist.');
        await saveShortlist(facilityId, true);
      } else if (action.type === 'refer') {
        await createReferral({
          facility_id: payloadString(p, 'facility_id'),
          facility_name: payloadString(p, 'facility_name'),
          city: payloadString(p, 'city'),
          state: payloadString(p, 'state'),
          reason: payloadString(p, 'reason'),
          urgency: payloadString(p, 'urgency'),
          patient: payloadString(p, 'patient'),
        });
      } else {
        // post_opening
        const city = payloadString(p, 'city');
        const discipline = payloadString(p, 'discipline');
        if (!city || !discipline) {
          throw new Error('Missing city or discipline for the opening.');
        }
        await createPosting({
          city,
          discipline,
          hospital: payloadString(p, 'hospital'),
          sub: payloadString(p, 'sub'),
          driver: payloadString(p, 'driver'),
          urgency: payloadString(p, 'urgency'),
        });
      }
      finish('done');
    } catch {
      finish('error');
    }
  }, []);

  const onSend = useCallback(() => {
    void send(input);
  }, [input, send]);

  // Web Speech dictation → input box (best effort; gracefully no-ops if the
  // browser lacks the API). Language follows the EN/हिं toggle (en-IN / hi-IN).
  const startVoice = useCallback(() => {
    type SREvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
    type SRInstance = {
      lang: string;
      onresult: ((e: SREvent) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
    };
    const Ctor = (window as Window & { webkitSpeechRecognition?: new () => SRInstance }).webkitSpeechRecognition;
    if (!Ctor) {
      setError('Voice input needs Chrome, Edge or Safari.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = speechLang;
      rec.onresult = (e) => {
        const transcript = e.results[0]?.[0]?.transcript;
        if (transcript) setInput(transcript);
      };
      rec.onerror = () => setError('Could not hear that — try again.');
      rec.start();
    } catch {
      setError('Voice input is unavailable.');
    }
  }, [speechLang]);

  const chatEmpty = messages.length === 0;

  return (
    <>
      {/* ---------------------------------------------------------------- panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Asclepius Assistant"
          className="fixed z-[95] flex flex-col overflow-hidden"
          style={{
            bottom: 92,
            right: 24,
            width: 384,
            maxWidth: 'calc(100vw - 32px)',
            height: 544,
            maxHeight: 'calc(100vh - 132px)',
            background: neutral.surface,
            border: `1px solid ${neutral.border}`,
            borderRadius: 20,
            boxShadow: 'var(--asc-shadow-assist)',
            animation: 'ascPop .2s ease both',
          }}
        >
          {/* header */}
          <div
            className="flex shrink-0 items-center gap-[11px] px-4 py-3.5"
            style={{
              background: 'var(--asc-clinician-tint2)',
              borderBottom: '1px solid #E6EDE9',
            }}
          >
            <span
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: accent }}
            >
              <Sparkle weight="fill" size={19} color="#fff" />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="flex items-center gap-[7px]"
                style={{
                  fontFamily: fonts.body,
                  fontWeight: 700,
                  fontSize: 15,
                  color: neutral.ink,
                }}
              >
                Asclepius Assistant
                <span
                  className="rounded-[5px] px-[5px] py-0.5"
                  style={{
                    fontFamily: fonts.body,
                    fontWeight: 700,
                    fontSize: 9.5,
                    letterSpacing: '.06em',
                    background: roleTokens.clinician.tint,
                    color: accent,
                  }}
                >
                  AI
                </span>
              </div>
              <div style={{ fontSize: 12, color: neutral.textFaint }}>
                {PERSONA_LABEL[persona]} · grounded in {persona === 'planner' ? 'readiness data' : 'facility data'}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
              style={{
                border: '1px solid #DCE6E0',
                background: neutral.surface,
                color: neutral.textSoft,
                cursor: 'pointer',
              }}
            >
              <X weight="bold" size={15} />
            </button>
          </div>

          {/* scrollable message list */}
          <div ref={scrollRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
            {chatEmpty && (
              <>
                <div
                  className="rounded-[14px] px-[15px] py-[13px]"
                  style={{
                    background: '#F4F2EC',
                    fontFamily: fonts.body,
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: neutral.text,
                  }}
                >
                  {intro.greeting}
                </div>
                <div className="mt-0.5 flex flex-col gap-2">
                  {intro.presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        void send(preset);
                      }}
                      className="flex items-center gap-2 rounded-[12px] px-[13px] py-2.5 text-left"
                      style={{
                        background: neutral.surface,
                        border: '1px solid #DCE6E0',
                        fontFamily: fonts.body,
                        fontWeight: 600,
                        fontSize: 13.5,
                        color: accent,
                        cursor: 'pointer',
                      }}
                    >
                      <ArrowBendDownRight weight="fill" size={15} color="#9CC3B5" />
                      {preset}
                    </button>
                  ))}
                </div>
              </>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div
                    className="max-w-[85%] px-[14px] py-2.5"
                    style={{
                      background: accent,
                      color: '#fff',
                      borderRadius: '14px 14px 4px 14px',
                      fontFamily: fonts.body,
                      fontWeight: 500,
                      fontSize: 13.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col items-start gap-2">
                  <div
                    className="max-w-[92%] px-[14px] py-2.5"
                    style={{
                      background: '#F4F2EC',
                      color: neutral.text,
                      borderRadius: '14px 14px 14px 4px',
                      fontFamily: fonts.body,
                      fontWeight: 500,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>

                  {/* inline [facility • field] citation chips */}
                  {m.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.citations.map((c, i) => (
                        <span
                          key={`${m.id}-cite-${String(i)}-${c.facility_id}-${c.field}`}
                          title={c.quote}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: 'var(--asc-clinician-tint2)',
                            color: accent,
                            border: `1px solid ${roleTokens.clinician.border}`,
                          }}
                        >
                          <Quotes weight="fill" size={11} />
                          {c.facility_name} · {c.field}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* confidence signal — only when meaningful: a green "grounded
                      in data" badge for structured answers, a band chip only when
                      real citations anchored, and nothing on clarify/insufficient
                      (so there is no perpetual "Low confidence · 0"). */}
                  {m.mode === 'data' ? (
                    <DataGroundedBadge />
                  ) : m.mode === 'grounded' && m.citations.length > 0 && m.uncertainty ? (
                    <ConfidenceBand uncertainty={m.uncertainty} />
                  ) : null}

                  {/* confirmable action chips */}
                  {m.actions.length > 0 && (
                    <div className="flex w-full flex-col gap-[7px]">
                      <div
                        className="pl-0.5 uppercase"
                        style={{
                          fontFamily: fonts.body,
                          fontWeight: 700,
                          fontSize: 10.5,
                          letterSpacing: '.06em',
                          color: neutral.textDisabled,
                        }}
                      >
                        Do it for you
                      </div>
                      {m.actions.map((a) => (
                        <ActionChip
                          key={a.id}
                          confirmable={a}
                          accent={accent}
                          onConfirm={() => {
                            void confirmAction(m.id, a.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {busy && (
              <div className="flex justify-start">
                <div
                  className="inline-flex items-center gap-2 px-[14px] py-2.5"
                  style={{
                    background: '#F4F2EC',
                    color: neutral.textFaint,
                    borderRadius: '14px 14px 14px 4px',
                    fontFamily: fonts.body,
                    fontWeight: 500,
                    fontSize: 13.5,
                  }}
                >
                  <CircleNotch weight="bold" size={15} style={{ animation: 'ascSpin 1s linear infinite' }} />
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <div
                className="rounded-[12px] px-[13px] py-2.5"
                style={{
                  background: confidence.low.bg,
                  color: confidence.low.fg,
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  fontSize: 12.5,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* footer input + send */}
          <div
            className="flex shrink-0 items-center gap-2 px-3.5 py-3"
            style={{ borderTop: '1px solid var(--asc-border-card)' }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Ask about the data…"
              aria-label="Message the assistant"
              disabled={busy}
              className="h-[42px] flex-1"
              style={{ background: neutral.surfaceWarm }}
            />
            <button
              type="button"
              onClick={startVoice}
              disabled={busy}
              aria-label="Voice input"
              title="Voice input"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px]"
              style={{ background: neutral.surface, color: accent, border: '1px solid #DCE6E0', cursor: 'pointer' }}
            >
              <Microphone weight="fill" size={18} />
            </button>
            <Button
              type="button"
              onClick={onSend}
              disabled={busy || !input.trim()}
              aria-label="Send message"
              className="h-[42px] w-[42px] shrink-0 rounded-[12px] p-0"
              style={{ background: accent, color: '#fff' }}
            >
              <PaperPlaneTilt weight="fill" size={18} />
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ FAB */}
      <button
        type="button"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed z-[96] flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          bottom: 24,
          right: 24,
          background: accent,
          color: '#fff',
          border: 'none',
          boxShadow: 'var(--asc-shadow-float)',
          cursor: 'pointer',
        }}
      >
        {open ? <X weight="bold" size={24} /> : <ChatCircleDots weight="fill" size={26} />}
      </button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* A calm "grounded in readiness data" badge for structured data answers        */
/* (mode='data'): the numbers are exact DB values, so we confirm the source     */
/* rather than show a numeric confidence.                                       */
/* -------------------------------------------------------------------------- */
function DataGroundedBadge() {
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: confidence.high.fg, background: confidence.high.bg }}
      title="Computed directly from the live readiness.data_readiness table."
    >
      <CheckCircle weight="fill" size={12} />
      Grounded in readiness data
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The per-message confidence band chip (band only — no numeric score).         */
/* -------------------------------------------------------------------------- */
function ConfidenceBand({ uncertainty }: { uncertainty: AssistantUncertainty }) {
  const meta = BAND_META[uncertainty.band];
  const Icon = meta.Icon;
  return (
    <div className="flex flex-col gap-1">
      <span
        className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ color: meta.fg, background: meta.bg }}
        title={uncertainty.caveats.join(' ')}
      >
        <Icon weight="fill" size={12} />
        {uncertainty.band.charAt(0).toUpperCase() + uncertainty.band.slice(1)} confidence
      </span>
      {uncertainty.caveats.length > 0 && (
        <span className="pl-0.5 text-[10.5px] leading-[1.4]" style={{ color: neutral.textFaint2, maxWidth: 280 }}>
          {uncertainty.caveats[0]}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A single confirmable action chip (label + Confirm → write fn).              */
/* -------------------------------------------------------------------------- */
function ActionChip({
  confirmable,
  accent,
  onConfirm,
}: {
  confirmable: ConfirmableAction;
  accent: string;
  onConfirm: () => void;
}) {
  const { action, status } = confirmable;
  const done = status === 'done';
  const running = status === 'running';
  const failed = status === 'error';

  return (
    <button
      type="button"
      disabled={running || done}
      onClick={onConfirm}
      className="flex items-center gap-[9px] rounded-[12px] px-[13px] py-[11px] text-left"
      style={{
        background: done ? roleTokens.clinician.tint : accent,
        color: done ? accent : '#fff',
        border: 'none',
        fontFamily: fonts.body,
        fontWeight: 700,
        fontSize: 13.5,
        cursor: running || done ? 'default' : 'pointer',
        opacity: running ? 0.85 : 1,
      }}
    >
      {done ? (
        <CheckCircle weight="fill" size={16} />
      ) : running ? (
        <CircleNotch weight="bold" size={16} style={{ animation: 'ascSpin 1s linear infinite' }} />
      ) : (
        <Sparkle weight="fill" size={16} />
      )}
      <span className="flex-1">{done ? 'Done' : failed ? 'Retry — that didn’t work' : `Confirm: ${action.label}`}</span>
      {!done && !running && <ArrowRight weight="bold" size={15} style={{ opacity: 0.7 }} />}
    </button>
  );
}
