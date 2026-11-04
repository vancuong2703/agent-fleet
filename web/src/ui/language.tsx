import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export type Language = 'en' | 'vi';
const LanguageContext = createContext<{ language: Language; setLanguage: (value: Language) => void }>({ language: 'vi', setLanguage() {} });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => { try { return localStorage.getItem('fleet.language') === 'vi' ? 'vi' : 'en'; } catch { return 'en'; } });
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dataset.lang = language; try { localStorage.setItem('fleet.language', language); } catch { /* Optional preference. */ } }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { const context = useContext(LanguageContext); return { ...context, t: (en: string, vi: string) => context.language === 'vi' ? vi : en }; }
