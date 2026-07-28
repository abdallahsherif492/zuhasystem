"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useBusiness } from "./BusinessContext";
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
}

const dictionaries: Record<Language, Translations> = { en, ar };

const LanguageContext = createContext<LanguageContextType>({
  language: DEFAULT_LANGUAGE,
  direction: DEFAULT_DIRECTION,
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const { activeBusiness } = useBusiness();
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [direction, setDirection] = useState<Direction>(DEFAULT_DIRECTION);

    useEffect(() => {
        const currentLang = activeBusiness?.theme_config?.language as Language || DEFAULT_LANGUAGE;
        // Direction is configured independently of the language, so an Arabic
        // dashboard can still be laid out left-to-right.
        const currentDir = activeBusiness?.theme_config?.direction as Direction || DEFAULT_DIRECTION;
        setLanguage(currentLang);
        setDirection(currentDir);

        // Update document dir and lang for actual RTL/LTR layout
        document.documentElement.dir = currentDir;
        document.documentElement.lang = currentLang;
    }, [activeBusiness]);

  const t = (key: string): string => {
    const dict = dictionaries[language];
    return dict[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, direction, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
