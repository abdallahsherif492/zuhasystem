"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useBusiness } from "./BusinessContext";
import { supabase } from "@/lib/supabase";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

type Language = "en" | "ar";
type Direction = "ltr" | "rtl";
type Translations = Record<string, string>;

export const DEFAULT_LANGUAGE: Language = "ar";
export const DEFAULT_DIRECTION: Direction = "ltr";

interface LanguageContextType {
  language: Language;
  direction: Direction;
  t: (key: string) => string;
  /** What the business set, shown as the default a personal choice overrides. */
  businessLanguage: Language;
  businessDirection: Direction;
  /** True once this person has chosen for themselves. */
  isPersonal: boolean;
  /** Save a personal choice. Pass null for either to go back to the default. */
  setPreference: (next: { language: Language | null; direction: Direction | null }) => Promise<void>;
}

const dictionaries: Record<Language, Translations> = { en, ar };

const LanguageContext = createContext<LanguageContextType>({
  language: DEFAULT_LANGUAGE,
  direction: DEFAULT_DIRECTION,
  t: (key: string) => key,
  businessLanguage: DEFAULT_LANGUAGE,
  businessDirection: DEFAULT_DIRECTION,
  isPersonal: false,
  setPreference: async () => {},
});

export const useLanguage = () => useContext(LanguageContext);

/** Remembered locally as well so a reload paints in the right language before
 *  the preference has come back from the database. */
const CACHE_KEY = "ecx.locale";

function readCache(): { language?: Language; direction?: Direction } {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * Interface language and layout direction.
 *
 * These used to come from businesses.theme_config, which meant one setting for
 * everyone in a business: on a team where the accountant reads English and the
 * moderators read Arabic, somebody was always working in the wrong language and
 * fixing it broke it for the others.
 *
 * A person's own choice wins. The business value is what they start on, and
 * clearing the personal choice returns them to it, so a tenant can still set a
 * sensible default for everyone it adds.
 */
export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const { activeBusiness, currentUser } = useBusiness();

  const businessLanguage = (activeBusiness?.theme_config?.language as Language) || DEFAULT_LANGUAGE;
  const businessDirection = (activeBusiness?.theme_config?.direction as Direction) || DEFAULT_DIRECTION;

  const [personal, setPersonal] = useState<{ language: Language | null; direction: Direction | null }>({
    language: null,
    direction: null,
  });

  // Paint from the cache immediately; the database is the authority but it
  // arrives a round trip later and a language flip mid-render is jarring.
  useEffect(() => {
    const c = readCache();
    if (c.language || c.direction) {
      setPersonal({ language: c.language ?? null, direction: c.direction ?? null });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.id) return;
    (async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("language, direction")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (cancelled) return;
      // A missing table (the migration has not run yet) must not take the app
      // down or wipe a cached choice — it just means no personal override.
      if (!error && data) {
        setPersonal({
          language: (data.language as Language) ?? null,
          direction: (data.direction as Direction) ?? null,
        });
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch { /* private mode */ }
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const language = personal.language ?? businessLanguage;
  const direction = personal.direction ?? businessDirection;

  useEffect(() => {
    // Direction is set independently of the language, so an Arabic dashboard
    // can still be laid out left to right.
    document.documentElement.dir = direction;
    document.documentElement.lang = language;
  }, [language, direction]);

  const setPreference = useCallback(async (next: { language: Language | null; direction: Direction | null }) => {
    setPersonal(next);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch { /* private mode */ }
    if (!currentUser?.id) return;
    const { error } = await supabase
      .from("user_preferences")
      .upsert({
        user_id: currentUser.id,
        language: next.language,
        direction: next.direction,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (error) throw error;
  }, [currentUser?.id]);

  const t = useCallback((key: string): string => {
    const dict = dictionaries[language];
    return dict[key] || key;
  }, [language]);

  return (
    <LanguageContext.Provider
      value={{
        language, direction, t,
        businessLanguage, businessDirection,
        isPersonal: personal.language !== null || personal.direction !== null,
        setPreference,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};
