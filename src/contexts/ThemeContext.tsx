import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
export type AccentColor = 'green' | 'yellow' | 'purple' | 'orange' | 'blue' | 'pink';

const VALID_ACCENTS: AccentColor[] = ['green', 'yellow', 'purple', 'orange', 'blue', 'pink'];

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  accentColor: AccentColor;
  setAccentColor: (c: AccentColor) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  accentColor: 'green',
  setAccentColor: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('logmax-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    const saved = localStorage.getItem('logmax-accent') as AccentColor;
    return VALID_ACCENTS.includes(saved) ? saved : 'green';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('logmax-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor);
    localStorage.setItem('logmax-accent', accentColor);
  }, [accentColor]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const setAccentColor = (c: AccentColor) => setAccentColorState(c);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
