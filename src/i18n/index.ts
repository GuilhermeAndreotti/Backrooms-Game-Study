/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tiny i18n layer: pt-BR (the source language), en-US and es.
 *
 *   t("menu.play")                     -> current language's string
 *   t("hud.players", { n: 3 })         -> "{n}" placeholders are filled in
 *   useLanguage()                      -> [lang, setLang], re-renders on change
 *
 * Game code outside React (engine, map) calls t() at the moment it needs the
 * text, so it always reflects the language chosen right now.
 */

import { useSyncExternalStore } from "react";
import { ptBR, MessageKey } from "./pt-BR";
import { enUS } from "./en-US";
import { es } from "./es";

export type Language = "pt-BR" | "en-US" | "es";
export type { MessageKey };

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "pt-BR", label: "Português (BR)" },
  { id: "en-US", label: "English (US)" },
  { id: "es", label: "Español" },
];

const DICTIONARIES: Record<Language, Record<string, string>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  es,
};

const STORAGE_KEY = "backrooms_language";

function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "pt-BR" || saved === "en-US" || saved === "es") return saved;
  } catch { /* storage blocked: fall through to the browser language */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "pt-BR").toLowerCase();
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("en")) return "en-US";
  return "pt-BR";
}

let current: Language = detectLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language) {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  try { document.documentElement.lang = lang; } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/** Translates a key. Unknown keys (or keys missing in a language) fall back to pt-BR, then to the key itself. */
export function t(key: MessageKey | (string & {}), vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[current][key] ?? ptBR[key as MessageKey] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Locale tag for Date/Number formatting. */
export function localeTag(): string {
  return current === "en-US" ? "en-US" : current === "es" ? "es-ES" : "pt-BR";
}

/** React hook: current language + setter; components re-render when it changes. */
export function useLanguage(): [Language, (lang: Language) => void] {
  const lang = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getLanguage,
    getLanguage
  );
  return [lang, setLanguage];
}

try { document.documentElement.lang = current; } catch { /* ignore */ }
