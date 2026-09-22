// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Tiny dependency-free i18n for the renderer. Keys ARE the English source
// string (so an untranslated key renders as English automatically); catalogs
// are flat JSON of key -> translation. Interpolation uses `:name` tokens;
// pluralization uses Laravel-style `singular|plural` forms selected per locale
// via Intl.PluralRules. The chosen locale is persisted to localStorage and
// mirrored onto <html lang>. No external dependencies — this app ships to npm.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import it from './locales/it.json';
import nl from './locales/nl.json';
import pt from './locales/pt.json';

type Catalog = Record<string, string>;

const CATALOGS: Record<string, Catalog> = { en, de, fr, es, it, nl, pt };

// Endonyms shown in the language picker.
export const LOCALES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
};

export type Locale = keyof typeof LOCALES;

const STORAGE_KEY = 'locale';

/** Persisted choice → browser language → English, restricted to shipped locales. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in CATALOGS) return saved as Locale;
  } catch {
    /* private mode / disabled storage */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return (nav in CATALOGS ? nav : 'en') as Locale;
}

export type TVars = Record<string, string | number>;

function interpolate(str: string, vars?: TVars): string {
  if (!vars) return str;
  return str.replace(/:([a-zA-Z][a-zA-Z0-9]*)/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Look up a key in the locale (falling back to English source), then apply
 *  pluralization (on `count`) and `:token` interpolation. */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  let msg = CATALOGS[locale]?.[key] ?? key;

  if (msg.includes('|') && vars && typeof vars.count === 'number') {
    const forms = msg.split('|');
    let idx = forms.length - 1;
    try {
      idx = new Intl.PluralRules(locale).select(vars.count) === 'one' ? 0 : forms.length - 1;
    } catch {
      idx = vars.count === 1 ? 0 : forms.length - 1;
    }
    msg = forms[idx] ?? forms[forms.length - 1];
  }

  return interpolate(msg, vars);
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: TVars) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key, vars) => translate('en', key, vars),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    setLocaleState(l);
  }, []);

  const t = useCallback((key: string, vars?: TVars) => translate(locale, key, vars), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

/** Translation function bound to the active locale. */
export function useT(): (key: string, vars?: TVars) => string {
  return useContext(I18nContext).t;
}

/** [locale, setLocale] for the language picker. */
export function useLocale(): readonly [Locale, (l: Locale) => void] {
  const { locale, setLocale } = useContext(I18nContext);
  return [locale, setLocale] as const;
}
