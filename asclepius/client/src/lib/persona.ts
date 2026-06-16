import { useSyncExternalStore } from 'react';

/* ============================================================================
   Active persona — a sticky, persisted choice.

   The app has no real auth (DEC-001: passwordless, self-selected personas), so
   "who you are" is a deliberately-chosen persona, not credentials. It's chosen
   on the landing (or by entering a persona flow) and PERSISTS across every
   screen — including shared ones like Atlas/Registry where the URL carries no
   persona — so the top nav can always show the right persona pill + its item
   (Saved / Pipeline / Outreach), and the Data Readiness Desk stays planner-only.

   Persisted to localStorage; reactive via useSyncExternalStore so nav chrome and
   route guards update the instant it changes.
   ============================================================================ */

export type Persona = 'patient' | 'clinician' | 'hospital' | 'planner';

const KEY = 'asc.persona';
const EVT = 'asc:persona';
const VALID: readonly string[] = ['patient', 'clinician', 'hospital', 'planner'];

function read(): Persona | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && VALID.includes(v) ? (v as Persona) : null;
  } catch {
    return null;
  }
}

/** Read the active persona once (non-reactive — fine inside event handlers). */
export function getPersona(): Persona | null {
  return read();
}

/** Set (or clear) the active persona and notify subscribers in this tab. */
export function setPersona(p: Persona | null): void {
  try {
    if (p) localStorage.setItem(KEY, p);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode / SSR) — ignore */
  }
  // The native `storage` event only fires in OTHER tabs, so dispatch our own
  // for the current tab's subscribers.
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Reactive active persona (null until one is chosen). */
export function usePersona(): Persona | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/* --- planner convenience (Readiness is planner-only) ----------------------- */

/** Non-reactive: is the visitor acting as a Medical Planner? */
export function isPlanner(): boolean {
  return read() === 'planner';
}

/** Reactive: true when the active persona is Medical Planner. */
export function usePlanner(): boolean {
  return usePersona() === 'planner';
}
