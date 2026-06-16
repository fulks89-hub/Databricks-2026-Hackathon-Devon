// Asclepius i18n — the EN / हिं toggle shown in the top bar of every app screen.
//
// The toggle drives TWO things:
//   1. `t()` — for shell chrome that opts in explicitly (top-bar nav, auth pill,
//      command palette, notifications, assistant voice language).
//   2. A whole-page DOM translation layer (below) that, while the language is
//      Hindi, walks the rendered DOM and translates every known UI string in
//      place — text nodes AND key attributes (placeholder / title / aria-label /
//      alt). A MutationObserver keeps newly-rendered content (route changes,
//      async data, portals/overlays) translated too. This is what makes the
//      *entire* page switch language, not just the chrome — screens never have
//      to thread `t()` through every label.
//
// Translations live in `./i18n.dictionary` (a large generated EN→HI map plus a
// small set of `{n}`-templated patterns for strings that interpolate counts).
// The choice persists to localStorage and drives <html lang>, so the toggle is
// a real, durable language switch.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { HI_EXACT, HI_PATTERNS } from './i18n.dictionary';

export type Lang = 'en' | 'hi';

const STORAGE_KEY = 'asclepius_lang';

// Hand-tuned shell-chrome strings. These take priority over the generated
// dictionary (curated phrasing for the most-seen chrome). Missing keys fall back
// to the key itself, so untranslated chrome renders English (never blank).
const STRINGS: Record<Lang, Record<string, string>> = {
  en: {},
  hi: {
    Atlas: 'एटलस',
    Planner: 'प्लानर',
    Registry: 'रजिस्ट्री',
    Saved: 'सहेजे गए',
    Notifications: 'सूचनाएँ',
    'Clear all': 'सभी साफ़ करें',
    'Sign up / Log in': 'साइन अप / लॉग इन',
    'Sign in': 'साइन इन',
    'Switch role': 'भूमिका बदलें',
    'Choose persona': 'भूमिका चुनें',
    Patient: 'मरीज़',
    Clinician: 'चिकित्सक',
    Hospital: 'अस्पताल',
    'Log out': 'लॉग आउट',
    'Jump to a screen, action or facility…': 'किसी स्क्रीन, क्रिया या सुविधा पर जाएँ…',
    'No notifications yet': 'अभी तक कोई सूचना नहीं',
    "You'll be alerted when a hospital reaches out, an agent shows interest, or a matching free agent appears nearby.":
      'जब कोई अस्पताल संपर्क करेगा, कोई चिकित्सक रुचि दिखाएगा, या कोई उपयुक्त फ़्री-एजेंट पास में मिलेगा, तब आपको सूचित किया जाएगा।',
  },
};

/* ===========================================================================
   Whole-page DOM translation layer.
   Pure DOM (no React) so it can translate the entire document subtree —
   including portaled overlays React renders outside the app root.
   =========================================================================== */

// Merged EN→HI for exact (whole-string) matches. Curated chrome wins over the
// generated dictionary. Used in both directions (HI→EN for restore).
const FWD = new Map<string, string>(Object.entries({ ...HI_EXACT, ...STRINGS.hi }));
const REV = new Map<string, string>();
for (const [en, hi] of FWD) if (!REV.has(hi)) REV.set(hi, en);

// `{n}`-templated patterns capture interpolated numbers/counts/percentages so a
// string like "278 fully clean" matches the template "{n} fully clean". Numbers
// are not translated — they are carried across verbatim.
function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withCaptures = escaped.replace(/\\\{n\\\}/g, '([\\d.,]+)');
  return new RegExp('^' + withCaptures + '$');
}
function fillTemplate(template: string, match: RegExpMatchArray): string {
  let i = 0;
  return template.replace(/\{n\}/g, () => match[++i] ?? '');
}
const FWD_PATTERNS = HI_PATTERNS.map(([en, hi]) => ({ re: templateToRegex(en), tpl: hi }));
const REV_PATTERNS = HI_PATTERNS.map(([en, hi]) => ({ re: templateToRegex(hi), tpl: en }));

// Translate a single trimmed string toward the target language. Returns null
// when nothing in the dictionary matches (caller leaves the text untouched, so
// live data — facility names, ids, free numbers — is never mangled).
function translateString(core: string, toHi: boolean): string | null {
  const exact = (toHi ? FWD : REV).get(core);
  if (exact !== undefined) return exact;
  for (const p of toHi ? FWD_PATTERNS : REV_PATTERNS) {
    const m = core.match(p.re);
    if (m) return fillTemplate(p.tpl, m);
  }
  return null;
}

// Subtrees whose text is code/data, never UI copy.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
// Visible-text-bearing attributes worth translating.
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

function translateTextNode(node: Text, toHi: boolean): void {
  const raw = node.nodeValue;
  if (raw === null) return;
  const core = raw.trim();
  if (core.length === 0) return;
  const out = translateString(core, toHi);
  if (out === null || out === core) return;
  const lead = raw.slice(0, raw.length - raw.trimStart().length);
  const tail = raw.slice(raw.trimEnd().length);
  node.nodeValue = lead + out + tail;
}

function translateAttrs(el: Element, toHi: boolean): void {
  for (const attr of TEXT_ATTRS) {
    const raw = el.getAttribute(attr);
    if (raw === null) continue;
    const core = raw.trim();
    if (core.length === 0) continue;
    const out = translateString(core, toHi);
    if (out !== null && out !== core) el.setAttribute(attr, out);
  }
}

// Translate a node and its entire subtree (text nodes + element attributes).
function walkAndTranslate(root: Node, toHi: boolean): void {
  if (root instanceof Text) {
    translateTextNode(root, toHi);
    return;
  }
  if (!(root instanceof Element)) {
    root.childNodes.forEach((child) => walkAndTranslate(child, toHi));
    return;
  }
  if (SKIP_TAGS.has(root.tagName)) return;
  translateAttrs(root, toHi);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n: Node): number {
      if (n instanceof Element && SKIP_TAGS.has(n.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = walker.nextNode();
  while (n !== null) {
    if (n instanceof Text) translateTextNode(n, toHi);
    else if (n instanceof Element) translateAttrs(n, toHi);
    n = walker.nextNode();
  }
}

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Translate a shell string; unknown keys return the source string unchanged. */
  t: (key: string) => string;
  /** Web-Speech BCP-47 tag for STT/TTS (hi-IN / en-IN). */
  speechLang: string;
  label: string;
}

const LangContext = createContext<LangContextValue | null>(null);

function readInitial(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  // Persist the choice + set <html lang>.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage may be unavailable (private mode) — toggle still works in-session */
    }
    try {
      document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
    } catch {
      /* SSR/no-document guard */
    }
  }, [lang]);

  // Whole-page translation. While Hindi is active, translate the current DOM and
  // keep observing for newly-rendered content. On English, restore in place
  // (HI→EN) and stop observing — React already renders English at the source.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.body;
    const toHi = lang === 'hi';
    const options: MutationObserverInit = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TEXT_ATTRS,
    };
    const observer = new MutationObserver((records) => {
      // Disconnect while we mutate so our own writes don't re-trigger the observer.
      observer.disconnect();
      try {
        for (const rec of records) {
          if (rec.type === 'characterData') {
            if (rec.target instanceof Text) translateTextNode(rec.target, toHi);
          } else if (rec.type === 'attributes') {
            if (rec.target instanceof Element) translateAttrs(rec.target, toHi);
          } else {
            rec.addedNodes.forEach((node) => walkAndTranslate(node, toHi));
          }
        }
      } finally {
        observer.observe(root, options);
      }
    });

    walkAndTranslate(root, toHi);
    if (toHi) observer.observe(root, options);
    return () => observer.disconnect();
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggle = useCallback(() => setLangState((l) => (l === 'hi' ? 'en' : 'hi')), []);
  const t = useCallback(
    (key: string) => (lang === 'hi' ? (STRINGS.hi[key] ?? HI_EXACT[key] ?? key) : key),
    [lang]
  );

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang,
      toggle,
      t,
      speechLang: lang === 'hi' ? 'hi-IN' : 'en-IN',
      label: lang === 'hi' ? 'हिं' : 'EN',
    }),
    [lang, setLang, toggle, t]
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** Access the language context. Falls back to an EN no-op outside a provider. */
export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (ctx) return ctx;
  return {
    lang: 'en',
    setLang: () => undefined,
    toggle: () => undefined,
    t: (key: string) => key,
    speechLang: 'en-IN',
    label: 'EN',
  };
}
