"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useBusiness } from "./BusinessContext";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

type Language = "en" | "ar";
type Translations = Record<string, string>;

interface LanguageContextType {
  language: Language;
  t: (key: string) => string;
}

const dictionaries: Record<Language, Translations> = { en, ar };

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const { activeBusiness } = useBusiness();
  const [language, setLanguage] = useState<Language>("en");

    useEffect(() => {
        const currentLang = activeBusiness?.theme_config?.language as Language || "en";
        setLanguage(currentLang);
        
        // Update document dir and lang for actual RTL/LTR layout
        document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";
        document.documentElement.lang = currentLang;
    }, [activeBusiness]);

  const t = (key: string): string => {
    const dict = dictionaries[language];
    return dict[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
