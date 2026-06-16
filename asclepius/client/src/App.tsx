import { createBrowserRouter, RouterProvider, NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import {
  Heartbeat,
  MapTrifold,
  Compass,
  ShieldCheck,
  Database,
  Bell,
  BookmarkSimple,
  UserCirclePlus,
  User,
  Stethoscope,
  Buildings,
  Megaphone,
  UsersThree,
  ArrowRight,
  ArrowsLeftRight,
  MapPinArea,
  SealCheck,
  Quotes,
  FirstAid,
  Translate,
  Sparkle,
  List as ListIcon,
} from '@phosphor-icons/react';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage';
import { ChatAssistant, CommandPalette, NotificationsPanel } from './components/asclepius';
import {
  useShortlist,
  useNotifications,
  useMe,
  markNotificationsRead,
  clearNotifications,
} from './lib/api';
import { LangProvider, useLang } from './lib/i18n';
import { usePersona, setPersona, usePlanner, type Persona } from './lib/persona';

// Real screens (built in parallel under src/screens/). Each is a zero-arg
// component that owns its own data hooks + loading/error/empty states;
// FacilityDetail reads its own :id via useParams.
import PatientLocation from './screens/patient/PatientLocation';
import PatientNeeds from './screens/patient/PatientNeeds';
import PatientResults from './screens/patient/PatientResults';
import ClinicianProfile from './screens/clinician/ClinicianProfile';
import ClinicianOpportunities from './screens/clinician/ClinicianOpportunities';
import HospitalRoster from './screens/hospital/HospitalRoster';
import HospitalCoverage from './screens/hospital/HospitalCoverage';
import HospitalRecruiter from './screens/hospital/HospitalRecruiter';
import BoardReport from './screens/hospital/BoardReport';
import FacilityDetail from './screens/FacilityDetail';
import Atlas from './screens/Atlas';
import MedicalDesertPlanner from './screens/MedicalDesertPlanner';
import Registry from './screens/Registry';
import DataReadinessDesk from './screens/DataReadinessDesk';
import Saved from './screens/Saved';
import Auth from './screens/Auth';
import Compare from './screens/Compare';

/* ============================================================================
   Asclepius — app shell + landing + routing.
   Tokens come from src/index.css (--asc-*). Role accents:
   patient #E0714C · clinician #2E7D67 · hospital #3B6FB0.
   The shell (TopBar) is shown on every screen EXCEPT Landing, which carries
   its own marketing nav (matches the prototype's `showShell` gate).
   ============================================================================ */

type Role = 'patient' | 'clinician' | 'hospital';

const ROLE_META: Record<Role, { label: string; color: string; tint: string; border: string; Icon: typeof User }> = {
  patient: {
    label: 'Patient',
    color: 'var(--asc-patient)',
    tint: 'var(--asc-patient-tint)',
    border: 'var(--asc-patient-border)',
    Icon: User,
  },
  clinician: {
    label: 'Clinician',
    color: 'var(--asc-clinician)',
    tint: 'var(--asc-clinician-tint)',
    border: 'var(--asc-clinician-border)',
    Icon: Stethoscope,
  },
  hospital: {
    label: 'Hospital',
    color: 'var(--asc-hospital)',
    tint: 'var(--asc-hospital-tint)',
    border: 'var(--asc-hospital-border)',
    Icon: Buildings,
  },
};

/* The entry route a persona switch sends the user to. */
const ROLE_HOME: Record<Role, string> = {
  patient: '/patient/location',
  clinician: '/clinician/profile',
  hospital: '/hospital/roster',
};

/* Medical Planner is a 4th, gated persona (not a themed Role): it owns the
   Planner + the Data Readiness Desk. Its accent is the tertiary purple already
   used in the planner's care-tier chips — distinct from the 3 role accents. */
const PLANNER_ACCENT = '#6A3FA0';
const PLANNER_TINT = '#ECE3F6';
const PLANNER_BORDER = '#DCCAEE';
const PLANNER_HOME = '/planner';

/* Where the (clickable) persona pill routes — each persona's home. */
const PERSONA_HOME: Record<Persona, string> = { ...ROLE_HOME, planner: PLANNER_HOME };

/* Persona pill meta — reuses ROLE_META for the 3 roles, adds planner. */
function personaPill(p: Persona): { label: string; color: string; tint: string; Icon: typeof User } {
  if (p === 'planner') return { label: 'Planner', color: PLANNER_ACCENT, tint: PLANNER_TINT, Icon: Compass };
  return ROLE_META[p];
}

/* The persona-specific nav item (the 4th slot). Each persona's "list" lives on
   an existing screen; planner has no list item. */
const PERSONA_ITEM: Record<Persona, { label: string; to: string; color: string; Icon: typeof User } | null> = {
  patient: { label: 'Saved', to: '/saved', color: 'var(--asc-patient)', Icon: BookmarkSimple },
  clinician: { label: 'Outreach', to: '/clinician/opportunities', color: 'var(--asc-clinician)', Icon: Megaphone },
  hospital: { label: 'Pipeline', to: '/hospital/recruiter', color: 'var(--asc-hospital)', Icon: UsersThree },
  planner: null,
};

/* ---------------------------------------------------------------------------
   Logo + wordmark (green tile, white heartbeat, Bricolage wordmark).
   --------------------------------------------------------------------------- */
function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--asc-r-md)',
        background: 'var(--asc-clinician)',
        boxShadow: 'var(--asc-shadow-logo)',
      }}
      className="flex items-center justify-center shrink-0"
    >
      <Heartbeat weight="fill" color="#fff" size={Math.round(size * 0.58)} />
    </span>
  );
}

function Wordmark({ size = 36, textSize = 20 }: { size?: number; textSize?: number }) {
  return (
    <span className="flex items-center gap-[11px]">
      <Logo size={size} />
      <span
        style={{
          fontFamily: 'var(--asc-font-display)',
          fontWeight: 700,
          fontSize: textSize,
          letterSpacing: '-0.02em',
          color: 'var(--asc-ink-body)',
        }}
      >
        Asclepius
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Top nav link (Atlas / Registry / Saved) — chrome buttons.
   --------------------------------------------------------------------------- */
function ChromeNavLink({
  to,
  icon,
  label,
  iconColor,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  iconColor: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `inline-flex items-center gap-2 rounded-[var(--asc-r-md)] px-3.5 py-2 text-sm font-semibold transition-colors border ${
          isActive ? 'bg-[var(--asc-bg-sunken)]' : 'bg-[var(--asc-surface)] hover:bg-[var(--asc-bg-sunken)]'
        }`
      }
      style={{ borderColor: 'var(--asc-border)', color: 'var(--asc-text)', fontFamily: 'var(--asc-font-body)' }}
    >
      <span style={{ color: iconColor }} className="flex">
        {icon}
      </span>
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
          style={{ background: 'var(--asc-patient)' }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

/* ---------------------------------------------------------------------------
   Language toggle (EN / हिं) — mirrors the prototype top-bar `toggleLang`.
   --------------------------------------------------------------------------- */
function LanguageToggle() {
  const { toggle, label } = useLang();
  return (
    <button
      type="button"
      onClick={toggle}
      title="Language"
      className="asc-noprint flex h-[38px] items-center gap-1.5 rounded-[var(--asc-r-md)] border bg-[var(--asc-surface)] px-3 text-[13px] font-bold"
      style={{ borderColor: 'var(--asc-border)', color: 'var(--asc-text)', fontFamily: 'var(--asc-font-body)' }}
    >
      <Translate weight="fill" size={15} color="var(--asc-clinician)" />
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   Account chip (logged-in) / Sign-in button (logged-out). Mirrors the
   prototype: green pill with initial + display name when a profile exists.
   --------------------------------------------------------------------------- */
function AccountControl() {
  const me = useMe();
  const { t } = useLang();
  const account = me.data?.account ?? null;

  if (account) {
    const name = account.display_name ?? account.email;
    const initial = (name || '?').charAt(0).toUpperCase();
    return (
      <Link
        to="/auth"
        className="inline-flex items-center gap-2 rounded-full py-[5px] pl-[5px] pr-3"
        style={{ background: 'var(--asc-clinician-tint)', textDecoration: 'none' }}
        title={account.email}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold text-white"
          style={{ background: 'var(--asc-clinician)', fontFamily: 'var(--asc-font-display)' }}
        >
          {initial}
        </span>
        <span className="text-[12.5px] font-bold" style={{ color: 'var(--asc-clinician)' }}>
          {name}
        </span>
      </Link>
    );
  }

  return (
    <Button asChild variant="outline" className="h-[38px] rounded-[var(--asc-r-md)] font-bold">
      <Link to="/auth">
        <UserCirclePlus weight="fill" size={16} color="var(--asc-clinician)" />
        {t('Sign up / Log in')}
      </Link>
    </Button>
  );
}

/* ---------------------------------------------------------------------------
   Persona pill — shows the active persona to the left of the nav and links to
   that persona's home (the planner reaches the Planner screen through it).
   --------------------------------------------------------------------------- */
function RolePill({ persona }: { persona: Persona }) {
  const m = personaPill(persona);
  const { t } = useLang();
  return (
    <Link
      to={PERSONA_HOME[persona]}
      title={t(m.label)}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold"
      style={{ background: m.tint, color: m.color, textDecoration: 'none' }}
    >
      <m.Icon weight="fill" size={15} />
      {t(m.label)}
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   App shell — sticky translucent top bar. Hidden on Landing.
   --------------------------------------------------------------------------- */
function AppShell({
  persona,
  savedCount,
  unreadCount,
  onBell,
}: {
  persona: Persona | null;
  savedCount: number;
  unreadCount: number;
  onBell: () => void;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useLang();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The persona-specific nav item (Saved / Pipeline / Outreach); planner = none.
  const personaItem = persona ? PERSONA_ITEM[persona] : null;

  const switchRole = () => {
    setMobileOpen(false);
    void navigate('/');
  };

  const bell = (
    <button
      title={t('Notifications')}
      onClick={onBell}
      className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[var(--asc-r-md)] border bg-[var(--asc-surface)]"
      style={{ borderColor: 'var(--asc-border)', color: 'var(--asc-text)' }}
    >
      <Bell weight="fill" size={17} />
      {unreadCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
          style={{ background: 'var(--asc-danger)', border: '2px solid var(--asc-bg)' }}
        >
          {unreadCount}
        </span>
      )}
    </button>
  );

  const switchRoleBtn = (
    <button
      type="button"
      onClick={switchRole}
      title={t('Switch role')}
      aria-label={t('Switch role')}
      className="flex h-[38px] w-[38px] items-center justify-center rounded-[var(--asc-r-md)] border bg-[var(--asc-surface)]"
      style={{ borderColor: 'var(--asc-border)', color: 'var(--asc-text-soft)' }}
    >
      <ArrowsLeftRight weight="bold" size={16} />
    </button>
  );

  return (
    <header
      className="sticky top-0 z-[60] flex items-center gap-[22px] border-b px-4 py-3 md:px-[30px]"
      style={{
        background: 'rgba(250,246,240,.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderColor: 'var(--asc-border-card)',
      }}
    >
      <Link to="/" className="shrink-0">
        <Wordmark />
      </Link>

      {/* Desktop nav — Persona · Atlas · Registry · Notifications · persona item. */}
      <div className="ml-auto hidden items-center gap-2.5 md:flex">
        {persona && <RolePill persona={persona} />}
        <ChromeNavLink
          to="/atlas"
          label={t('Atlas')}
          iconColor="var(--asc-clinician)"
          icon={<MapTrifold weight="fill" size={16} />}
        />
        <ChromeNavLink
          to="/registry"
          label={t('Registry')}
          iconColor="var(--asc-hospital)"
          icon={<Database weight="fill" size={16} />}
        />
        {bell}
        {personaItem && (
          <ChromeNavLink
            to={personaItem.to}
            label={t(personaItem.label)}
            iconColor={personaItem.color}
            icon={<personaItem.Icon weight="fill" size={16} />}
            badge={persona === 'patient' ? savedCount : undefined}
          />
        )}
        <AccountControl />
        <LanguageToggle />
        {switchRoleBtn}
      </div>

      {/* Mobile nav. */}
      {isMobile && (
        <div className="ml-auto flex items-center gap-2">
          {bell}
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <ListIcon size={22} />
          </Button>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>
                  <Wordmark size={30} textSize={18} />
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-2.5">
                {persona && <RolePill persona={persona} />}
                <div className="flex flex-col gap-2" onClick={() => setMobileOpen(false)}>
                  <ChromeNavLink
                    to="/atlas"
                    label={t('Atlas')}
                    iconColor="var(--asc-clinician)"
                    icon={<MapTrifold weight="fill" size={16} />}
                  />
                  <ChromeNavLink
                    to="/registry"
                    label={t('Registry')}
                    iconColor="var(--asc-hospital)"
                    icon={<Database weight="fill" size={16} />}
                  />
                  {personaItem && (
                    <ChromeNavLink
                      to={personaItem.to}
                      label={t(personaItem.label)}
                      iconColor={personaItem.color}
                      icon={<personaItem.Icon weight="fill" size={16} />}
                      badge={persona === 'patient' ? savedCount : undefined}
                    />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <LanguageToggle />
                  <button
                    type="button"
                    onClick={switchRole}
                    className="flex h-[38px] flex-1 items-center justify-center gap-2 rounded-[var(--asc-r-md)] border bg-[var(--asc-surface)] text-sm font-semibold"
                    style={{ borderColor: 'var(--asc-border)', color: 'var(--asc-text-soft)' }}
                  >
                    <ArrowsLeftRight weight="bold" size={15} />
                    {t('Switch role')}
                  </button>
                </div>
                <div className="mt-1" onClick={() => setMobileOpen(false)}>
                  <AccountControl />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}
    </header>
  );
}

/* Derive a role from a persona-prefixed URL. Used to sync the sticky persona
   store when the user enters a persona flow by deep link / navigation. Planner
   is intentionally NOT inferred here — it's granted only by an explicit choice
   (which is what keeps the Readiness Desk planner-only). */
function roleFromPath(pathname: string): Role | null {
  if (pathname.startsWith('/patient')) return 'patient';
  if (pathname.startsWith('/clinician')) return 'clinician';
  if (pathname.startsWith('/hospital')) return 'hospital';
  return null;
}

/* ---------------------------------------------------------------------------
   Layout — wraps the shell + an <Outlet/>. Shell hidden on Landing ('/').
   Owns the live saved/unread badges, the notifications dropdown and the ⌘K
   command palette (cross-cutting overlays from the prototype).
   --------------------------------------------------------------------------- */
function Layout() {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const role = roleFromPath(location.pathname);
  const persona = usePersona();

  // Sticky persona: when the user enters a persona flow by URL, mirror it into
  // the persisted store so the nav reflects it everywhere. Planner is excluded
  // (granted only by explicit choice — that's what gates the Readiness Desk).
  useEffect(() => {
    if (role && role !== persona) setPersona(role);
  }, [role, persona]);

  // The Landing IS the persona chooser, i.e. "no persona selected yet". Clear any
  // stale persisted persona on arrival, so persona-neutral pages reached from here
  // (Atlas / Registry) don't inherit a previous session's Patient pill. Keyed on
  // `isLanding` ONLY (not `persona`): it reacts to landing/leaving, never to the
  // persona changing — so a persona picked on the Landing (which sets it, then
  // navigates straight off the Landing) is never clobbered by this effect.
  useEffect(() => {
    if (isLanding) setPersona(null);
  }, [isLanding]);

  // Live shell state from Lakebase (shortlist count + notifications).
  const shortlist = useShortlist();
  const notifs = useNotifications();
  const savedCount = shortlist.data?.length ?? 0;
  const unread = notifs.data?.unread ?? 0;
  const notifItems = notifs.data?.items ?? [];

  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Global ⌘K / Ctrl+K opens the palette; Escape closes the open overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setCmdkOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onBell = () => {
    setNotifOpen((open) => {
      const next = !open;
      // Opening the panel marks everything read (badge clears).
      if (next && unread > 0) {
        markNotificationsRead()
          .then(() => notifs.refetch())
          .catch(() => undefined);
      }
      return next;
    });
  };

  const onClearNotifs = () => {
    clearNotifications()
      .then(() => notifs.refetch())
      .catch(() => undefined);
    setNotifOpen(false);
  };

  // The chat assistant grounds for all 4 personas; planner uses the structured
  // readiness-data lens. Only `null` (no persona / Landing) falls back to patient.
  const assistantPersona: 'patient' | 'clinician' | 'hospital' | 'planner' =
    persona === 'clinician' || persona === 'hospital' || persona === 'planner'
      ? persona
      : 'patient';

  return (
    <div className="asc-app flex min-h-screen flex-col">
      {!isLanding && <AppShell persona={persona} savedCount={savedCount} unreadCount={unread} onBell={onBell} />}
      <main className="flex-1">
        <Outlet context={{ role }} />
      </main>

      {/* Cross-cutting overlays — every route. */}
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} items={notifItems} onClear={onClearNotifs} />
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
      {/* Global floating AI assistant (persona follows the active persona). */}
      <ChatAssistant persona={assistantPersona} />
    </div>
  );
}

/* ===========================================================================
   LANDING — real screen. Marketing nav + a hero-style switcher (3 variants).
   =========================================================================== */
function PersonaCard({ role, title, blurb, to }: { role: Role; title: string; blurb: string; to: string }) {
  const m = ROLE_META[role];
  const shadow =
    role === 'patient'
      ? 'var(--asc-shadow-cta-patient)'
      : role === 'clinician'
        ? 'var(--asc-shadow-cta-clinician)'
        : 'var(--asc-shadow-cta-hospital)';
  return (
    <Link
      to={to}
      onClick={() => setPersona(role)}
      className="group flex w-full max-w-[300px] flex-col items-start gap-3 rounded-[var(--asc-r-3xl)] border-[1.5px] bg-[var(--asc-surface)] p-6 text-left transition-transform hover:-translate-y-0.5"
      style={{ borderColor: m.border, boxShadow: shadow }}
    >
      <span
        className="flex h-[46px] w-[46px] items-center justify-center rounded-[var(--asc-r-lg)]"
        style={{ background: m.tint }}
      >
        <m.Icon weight="fill" size={24} color={m.color} />
      </span>
      <span style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, fontSize: 19, color: 'var(--asc-ink)' }}>
        {title}
      </span>
      <span className="text-[13.5px] leading-[1.4]" style={{ color: 'var(--asc-text-soft)' }}>
        {blurb}
      </span>
      <span className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: m.color }}>
        Start <ArrowRight weight="bold" size={15} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/* Inline role CTA button — Hero 0 (split) + Hero 2 (editorial) treatments. */
function RoleButton({ role, label, justify }: { role: Role; label: string; justify?: boolean }) {
  const m = ROLE_META[role];
  const solid = role === 'patient';
  return (
    <Link
      to={ROLE_HOME[role]}
      onClick={() => setPersona(role)}
      className={`inline-flex items-center gap-2.5 rounded-[var(--asc-r-lg)] px-[21px] py-[15px] text-[15px] font-bold ${justify ? 'justify-center' : ''}`}
      style={
        solid
          ? {
              background: 'var(--asc-patient)',
              color: '#fff',
              boxShadow: 'var(--asc-shadow-cta-patient)',
              fontFamily: 'var(--asc-font-body)',
            }
          : {
              background: 'var(--asc-surface)',
              color: m.color,
              border: `1.5px solid ${m.color}`,
              fontFamily: 'var(--asc-font-body)',
            }
      }
    >
      <m.Icon weight="fill" size={18} />
      {label}
    </Link>
  );
}

/* Inline Medical Planner CTA — outline treatment in the planner's purple,
   matching the secondary RoleButton shape. Grants the planner persona, then
   routes to the Planner (its home). */
function PlannerButton({ label, justify }: { label: string; justify?: boolean }) {
  return (
    <Link
      to={PLANNER_HOME}
      onClick={() => setPersona('planner')}
      className={`inline-flex items-center gap-2.5 rounded-[var(--asc-r-lg)] px-[21px] py-[15px] text-[15px] font-bold ${justify ? 'justify-center' : ''}`}
      style={{
        background: 'var(--asc-surface)',
        color: PLANNER_ACCENT,
        border: `1.5px solid ${PLANNER_ACCENT}`,
        fontFamily: 'var(--asc-font-body)',
      }}
    >
      <Compass weight="fill" size={18} />
      {label}
    </Link>
  );
}

/* Medical Planner persona card — the 4th card for the centered hero. */
function PlannerCard() {
  return (
    <Link
      to={PLANNER_HOME}
      onClick={() => setPersona('planner')}
      className="group flex w-full max-w-[300px] flex-col items-start gap-3 rounded-[var(--asc-r-3xl)] border-[1.5px] bg-[var(--asc-surface)] p-6 text-left transition-transform hover:-translate-y-0.5"
      style={{ borderColor: PLANNER_BORDER, boxShadow: '0 18px 40px -28px rgba(106,63,160,.35)' }}
    >
      <span
        className="flex h-[46px] w-[46px] items-center justify-center rounded-[var(--asc-r-lg)]"
        style={{ background: PLANNER_TINT }}
      >
        <Compass weight="fill" size={24} color={PLANNER_ACCENT} />
      </span>
      <span style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, fontSize: 19, color: 'var(--asc-ink)' }}>
        I&rsquo;m a medical planner
      </span>
      <span className="text-[13.5px] leading-[1.4]" style={{ color: 'var(--asc-text-soft)' }}>
        Rank districts by need, plan deployments, and ready the data planners rely on.
      </span>
      <span className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: PLANNER_ACCENT }}>
        Start <ArrowRight weight="bold" size={15} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

const PERSONA_BLURBS: Record<Role, { title: string; blurb: string }> = {
  patient: { title: "I'm a patient", blurb: 'Tell us where you are and what you need — get a trusted shortlist.' },
  clinician: { title: "I'm a clinician", blurb: 'Share your specialty — see where your discipline is missing.' },
  hospital: {
    title: "I'm a hospital",
    blurb: 'Map your coverage against local demand — recruit free agents for the gaps.',
  },
};

function LandingNav() {
  return (
    <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-[22px] md:px-10">
      <Wordmark size={38} textSize={22} />
      <div className="flex items-center gap-3">
        <Button
          asChild
          className="hidden rounded-full font-bold text-white sm:inline-flex"
          style={{ background: 'var(--asc-clinician)' }}
        >
          <Link to="/atlas">
            <MapTrifold weight="fill" size={16} />
            Coverage Atlas
          </Link>
        </Button>
        <Button
          asChild
          className="hidden rounded-full font-bold text-white sm:inline-flex"
          style={{ background: 'var(--asc-hospital)' }}
        >
          <Link to="/registry">
            <Database weight="fill" size={16} />
            Registry
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-full font-bold">
          <Link to="/auth">
            <UserCirclePlus weight="fill" size={16} color="var(--asc-clinician)" />
            Sign up / Log in
          </Link>
        </Button>
      </div>
    </div>
  );
}

/* The "Hero style" demo switcher pill (prototype lines 101-108). */
function HeroSwitcher({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="mx-auto -mt-0.5 flex max-w-[1240px] justify-end px-6 pb-2 md:px-10">
      <div
        className="flex items-center gap-1.5 rounded-full border bg-[var(--asc-surface)] p-[5px]"
        style={{ borderColor: 'var(--asc-border)' }}
      >
        <span
          className="pl-3 pr-1 text-[12px] font-semibold"
          style={{ color: 'var(--asc-text-faint2)', fontFamily: 'var(--asc-font-body)' }}
        >
          Hero style
        </span>
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className="rounded-full px-3 py-1 text-[12.5px] font-bold transition-colors"
            style={
              i === value
                ? { background: 'var(--asc-ink)', color: '#fff' }
                : { background: 'transparent', color: 'var(--asc-text-faint2)' }
            }
          >
            {String(i + 1).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Hero 0 — split: hero copy + inline role buttons + stats, decorative map plate. */
function HeroSplit() {
  return (
    <div className="mx-auto grid max-w-[1240px] items-center gap-[54px] px-6 pb-[70px] pt-[30px] md:grid-cols-[1.05fr_.95fr] md:px-10">
      <div style={{ animation: 'ascFade .5s ease both' }}>
        <span
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
          style={{ background: 'var(--asc-clinician-tint)', color: 'var(--asc-clinician)' }}
        >
          <MapPinArea weight="fill" size={15} />
          Built on the FDR India dataset · Maharashtra
        </span>
        <h1
          style={{
            fontFamily: 'var(--asc-font-display)',
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: '-0.03em',
            color: 'var(--asc-ink)',
          }}
          className="mt-[22px] text-[44px] md:text-[58px]"
        >
          Find care you can <span style={{ color: 'var(--asc-patient)' }}>actually</span> trust.
        </h1>
        <p className="mt-5 max-w-[30em] text-[19px] leading-[1.55]" style={{ color: 'var(--asc-text-muted)' }}>
          Asclepius turns ten thousand messy facility records into clear, cited answers — for the patient deciding where
          to go, and the clinician deciding where they&rsquo;re needed most.
        </p>

        <div className="mt-[34px] flex flex-wrap gap-[11px]">
          <RoleButton role="patient" label="I'm a patient" />
          <RoleButton role="clinician" label="I'm a clinician" />
          <RoleButton role="hospital" label="I'm a hospital" />
          <PlannerButton label="I'm a medical planner" />
        </div>

        <div className="mt-9 flex flex-wrap gap-[26px]">
          <StatBlock value="10,077" label="facility records" />
          <Divider />
          <StatBlock value="Every claim" label="cited to source text" />
          <Divider />
          <StatBlock value="Honest" label="about uncertainty" />
        </div>
      </div>

      {/* Decorative map plate w/ trust pins + floating facility preview */}
      <div className="relative hidden md:block" style={{ animation: 'ascPop .6s ease both' }}>
        <div
          className="relative h-[440px] overflow-hidden rounded-[26px] border"
          style={{
            borderColor: 'var(--asc-border)',
            background: 'var(--asc-bg-sunken)',
            backgroundImage:
              'linear-gradient(var(--asc-border) 1px,transparent 1px),linear-gradient(90deg,var(--asc-border) 1px,transparent 1px)',
            backgroundSize: '36px 36px',
            boxShadow: '0 30px 60px -30px rgba(43,39,34,.4)',
          }}
        >
          <Ring size={300} color="var(--asc-placeholder)" />
          <Ring size={190} color="var(--asc-pin-unverified)" />
          <Ring size={84} color="#D6CBB9" />
          {/* origin dot + pulse */}
          <span
            className="absolute left-1/2 top-1/2 z-[3] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: 'var(--asc-patient)', boxShadow: '0 0 0 4px #fff,0 0 0 6px #E0714C55' }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-3.5 w-3.5 rounded-full"
            style={{ background: '#E0714C66', animation: 'ascPulse 2.6s ease-out infinite' }}
          />
          {/* trust pins */}
          <Pin left="30%" top="33%" color="var(--asc-trust-verified)" size={30} />
          <Pin left="68%" top="42%" color="var(--asc-pin-review)" size={26} />
          <Pin left="58%" top="68%" color="var(--asc-trust-verified)" size={26} />
          <Pin left="34%" top="64%" color="var(--asc-pin-unverified)" size={22} bare />
          {/* glass overlay */}
          <div
            className="absolute left-[18px] top-[18px] rounded-[var(--asc-r-md)] border px-3.5 py-2.5"
            style={{
              background: 'rgba(255,255,255,.92)',
              borderColor: 'var(--asc-border)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[.06em]" style={{ color: 'var(--asc-text-faint2)' }}>
              Within 250 km of Pune
            </div>
            <div
              className="mt-0.5"
              style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, fontSize: 15, color: 'var(--asc-ink)' }}
            >
              8 verified facilities
            </div>
          </div>
        </div>

        {/* floating facility preview card */}
        <div
          className="absolute -bottom-4 -right-3.5 w-[226px] rounded-[var(--asc-r-xl)] border bg-[var(--asc-surface)] p-3.5"
          style={{
            borderColor: 'var(--asc-border)',
            boxShadow: '0 18px 40px -18px rgba(43,39,34,.35)',
            animation: 'ascPop .8s ease both',
          }}
        >
          <div className="flex items-center gap-2">
            <SealCheck weight="fill" size={18} color="var(--asc-clinician)" />
            <span className="text-sm font-bold">Nagpur Mission Hospital</span>
          </div>
          <div className="mt-1.5 text-[12.5px] leading-[1.4]" style={{ color: 'var(--asc-text-soft)' }}>
            Cardiology with cath lab · 91% record confidence
          </div>
          <div
            className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold"
            style={{ color: 'var(--asc-clinician)' }}
          >
            <Quotes size={14} />
            Cited to facility description
          </div>
        </div>
      </div>
    </div>
  );
}

/* Hero 1 — centered: badge + headline + 3 PersonaCards. */
function HeroCentered() {
  return (
    <div className="mx-auto max-w-[920px] px-6 pb-[70px] pt-[50px] text-center md:px-10" style={{ animation: 'ascFade .5s ease both' }}>
      <span
        className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
        style={{ background: 'var(--asc-patient-tint)', color: 'var(--asc-patient-press)' }}
      >
        <Sparkle weight="fill" size={15} />
        Apps &amp; Agents for Good · Data+AI Summit 2026
      </span>
      <h1
        className="mt-6 text-[44px] md:text-[66px]"
        style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.035em', color: 'var(--asc-ink)' }}
      >
        The right care,
        <br />
        backed by the evidence.
      </h1>
      <p className="mx-auto mt-5 max-w-[32em] text-[20px] leading-[1.55]" style={{ color: 'var(--asc-text-muted)' }}>
        One workspace where patients find trustworthy facilities nearby — and clinicians find the places that need their
        skills most.
      </p>
      <div className="mt-9 flex flex-wrap justify-center gap-[18px]">
        {(['patient', 'clinician', 'hospital'] as Role[]).map((r) => (
          <PersonaCard key={r} role={r} to={ROLE_HOME[r]} title={PERSONA_BLURBS[r].title} blurb={PERSONA_BLURBS[r].blurb} />
        ))}
        <PlannerCard />
      </div>
    </div>
  );
}

/* Hero 2 — editorial: oversized headline + a stat band with a CTA stack. */
function HeroEditorial() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 pb-[60px] pt-6 md:px-10" style={{ animation: 'ascFade .5s ease both' }}>
      <div className="grid items-end gap-[50px] md:grid-cols-[1.4fr_1fr]">
        <h1
          style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, lineHeight: 0.98, letterSpacing: '-0.04em', color: 'var(--asc-ink)' }}
          className="text-[48px] md:text-[74px]"
        >
          Care is unevenly mapped.
          <br />
          <span style={{ color: 'var(--asc-clinician)' }}>We&rsquo;re fixing the map.</span>
        </h1>
        <p className="mb-2 text-[18px] leading-[1.6]" style={{ color: 'var(--asc-text-muted)' }}>
          Across India, 47,169 facilities are on record — but the data is noisy, claims go unverified, and gaps hide in
          plain sight. Asclepius reads the evidence so people don&rsquo;t have to.
        </p>
      </div>
      <div
        className="mt-[46px] grid gap-0 md:grid-cols-[repeat(3,1fr)_auto]"
        style={{ borderTop: '1px solid #E2D9CA', borderBottom: '1px solid #E2D9CA' }}
      >
        <EditorialStat value="1.1B" label="people in multidimensional poverty" border />
        <EditorialStat value="143M" label="awaiting surgery in LMICs each year" border pad />
        <EditorialStat value="~484" label="people per km² — 8× world average" border pad accent />
        <div className="flex flex-col justify-center gap-3 py-[26px] md:pl-[30px]">
          <RoleButton role="patient" label="Patient" justify />
          <RoleButton role="clinician" label="Clinician" justify />
          <RoleButton role="hospital" label="Hospital" justify />
          <PlannerButton label="Medical planner" justify />
        </div>
      </div>
    </div>
  );
}

function EditorialStat({
  value,
  label,
  border,
  pad,
  accent,
}: {
  value: string;
  label: string;
  border?: boolean;
  pad?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        borderRight: border ? '1px solid #E2D9CA' : undefined,
        padding: pad ? '26px 30px' : '26px 30px 26px 0',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--asc-font-display)',
          fontWeight: 700,
          fontSize: 40,
          letterSpacing: '-0.02em',
          color: accent ? 'var(--asc-patient)' : 'var(--asc-ink)',
        }}
      >
        {value}
      </div>
      <div className="mt-1 text-[14px]" style={{ color: 'var(--asc-text-soft)' }}>
        {label}
      </div>
    </div>
  );
}

function Landing() {
  const [heroStyle, setHeroStyle] = useState(0);
  return (
    <div className="asc-app flex-1" style={{ animation: 'ascFade .5s ease both' }}>
      <LandingNav />
      <HeroSwitcher value={heroStyle} onChange={setHeroStyle} />
      {heroStyle === 0 && <HeroSplit />}
      {heroStyle === 1 && <HeroCentered />}
      {heroStyle === 2 && <HeroEditorial />}
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, fontSize: 26, color: 'var(--asc-ink)' }}>
        {value}
      </div>
      <div className="text-[13px] font-medium" style={{ color: 'var(--asc-text-faint2)' }}>
        {label}
      </div>
    </div>
  );
}
function Divider() {
  return <div className="w-px self-stretch" style={{ background: 'var(--asc-border)' }} />;
}
function Ring({ size, color }: { size: number; color: string }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ width: size, height: size, border: `1.5px dashed ${color}` }}
    />
  );
}
function Pin({
  left,
  top,
  color,
  size,
  bare,
}: {
  left: string;
  top: string;
  color: string;
  size: number;
  bare?: boolean;
}) {
  return (
    <div className="absolute z-[4]" style={{ left, top }}>
      <span
        className="flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: color,
          border: '3px solid #fff',
          boxShadow: '0 4px 10px rgba(43,39,34,.3)',
        }}
      >
        {!bare && <FirstAid weight="fill" color="#fff" size={Math.round(size * 0.46)} />}
      </span>
    </div>
  );
}

/* ===========================================================================
   READINESS GATE — the Data Readiness Desk lets a planner review AND edit
   facility data quality, so it is restricted to the Medical Planner persona.
   Non-planners get a clear, friendly door rather than the desk.
   =========================================================================== */
function PlannersOnly() {
  return (
    <div
      className="mx-auto w-full max-w-[620px] px-6 pb-24 pt-24 text-center"
      style={{ animation: 'ascFade .45s ease both' }}
    >
      <span
        className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-[var(--asc-r-xl)]"
        style={{ background: PLANNER_TINT }}
      >
        <ShieldCheck weight="fill" size={32} color={PLANNER_ACCENT} />
      </span>
      <h1
        className="mt-6 text-[30px]"
        style={{ fontFamily: 'var(--asc-font-display)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--asc-ink)' }}
      >
        The Data Readiness Desk is for planners
      </h1>
      <p className="mx-auto mt-3 max-w-[42em] text-[16px] leading-[1.55]" style={{ color: 'var(--asc-text-muted)' }}>
        Reviewing and editing facility data quality shapes what every other persona sees. Continue as a Medical Planner
        to work the readiness queue.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/readiness"
          onClick={() => setPersona('planner')}
          className="inline-flex items-center gap-2.5 rounded-[var(--asc-r-lg)] px-[21px] py-[14px] text-[15px] font-bold text-white"
          style={{ background: PLANNER_ACCENT, fontFamily: 'var(--asc-font-body)' }}
        >
          <Compass weight="fill" size={18} />
          Continue as a medical planner
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-[var(--asc-r-lg)] px-[21px] py-[14px] text-[15px] font-bold"
          style={{
            background: 'var(--asc-surface)',
            color: 'var(--asc-text)',
            border: '1.5px solid var(--asc-border)',
            fontFamily: 'var(--asc-font-body)',
          }}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

/* Route guard for /readiness — desk for planners, the door for everyone else. */
function ReadinessRoute() {
  const planner = usePlanner();
  return planner ? <DataReadinessDesk /> : <PlannersOnly />;
}

/* ===========================================================================
   ROUTER — all 17 screens + Atlas/Registry/Saved/Auth/Compare/Report + debug.
   =========================================================================== */
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Landing /> },

      // Patient flow (3 steps)
      { path: '/patient/location', element: <PatientLocation /> },
      { path: '/patient/needs', element: <PatientNeeds /> },
      { path: '/patient/results', element: <PatientResults /> },

      // Clinician flow (2 steps)
      { path: '/clinician/profile', element: <ClinicianProfile /> },
      { path: '/clinician/opportunities', element: <ClinicianOpportunities /> },

      // Hospital flow (3 steps)
      { path: '/hospital/roster', element: <HospitalRoster /> },
      { path: '/hospital/coverage', element: <HospitalCoverage /> },
      { path: '/hospital/recruiter', element: <HospitalRecruiter /> },

      // Shared screens
      { path: '/facility/:id', element: <FacilityDetail /> },
      // Coverage Atlas — national + district NFHS-5 / coverage choropleth.
      { path: '/atlas', element: <Atlas /> },
      // Medical Desert Planner — distance-based per-capita scarcity + deploy burden.
      { path: '/planner', element: <MedicalDesertPlanner /> },
      { path: '/registry', element: <Registry /> },
      // Readiness is planner-gated (review + edit of facility data quality).
      { path: '/readiness', element: <ReadinessRoute /> },
      { path: '/saved', element: <Saved /> },
      { path: '/auth', element: <Auth /> },
      { path: '/compare', element: <Compare /> },
      // Board Report is the hospital-facing report screen.
      { path: '/report', element: <BoardReport /> },

      // Hidden data-path proof (Phase 0/1 live read)
      { path: '/debug', element: <AnalyticsPage /> },

      // Fallback → Landing
      { path: '*', element: <Landing /> },
    ],
  },
]);

export default function App() {
  return (
    <LangProvider>
      <RouterProvider router={router} />
    </LangProvider>
  );
}
