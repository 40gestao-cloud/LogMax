import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
export type AccentColor = 'green' | 'yellow' | 'purple' | 'orange' | 'blue' | 'pink' | 'red' | 'acessivel';

const VALID_ACCENTS: AccentColor[] = ['green', 'yellow', 'purple', 'orange', 'blue', 'pink', 'red', 'acessivel'];

const ACCENT_HEX: Record<AccentColor, string> = {
  green:  '#10B981',
  yellow: '#FACC15',
  purple: '#A855F7',
  orange: '#F97316',
  blue:   '#3B82F6',
  pink:   '#EC4899',
  red:    '#EF4444',
  // Acessibilidade: laranja principal (theme-color do browser/PWA segue o
  // accent visível em botões). Os ícones recebem azul claro via CSS.
  acessivel: '#F97316',
};

// Brilho da tela — 50% a 150% (100 = neutro). Aplicado via
// `filter: brightness(X)` no <body>, que multiplica a luminância dos
// pixels (mesma matemática do brilho de SO em celular/computador). Cores
// continuam vivas, só ficam mais escuras (<100) ou mais claras (>100).
// Removemos automaticamente o filter em 100% para zerar custo de composição.
export const BRIGHTNESS_MIN = 50;
export const BRIGHTNESS_MAX = 150;
export const BRIGHTNESS_STEP = 10;

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  accentColor: AccentColor;
  setAccentColor: (c: AccentColor) => void;
  brightness: number;
  setBrightness: (n: number) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  accentColor: 'green',
  setAccentColor: () => {},
  brightness: 100,
  setBrightness: () => {},
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

  const [brightness, setBrightnessState] = useState<number>(() => {
    const raw = Number(localStorage.getItem('logmax-brightness'));
    if (!Number.isFinite(raw) || raw < BRIGHTNESS_MIN || raw > BRIGHTNESS_MAX) return 100;
    return Math.round(raw);
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('logmax-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor);
    localStorage.setItem('logmax-accent', accentColor);
    // /simulador-pagamento tem identidade própria (azul fixo) — não sobrescrever.
    if (window.location.pathname === '/simulador-pagamento') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', ACCENT_HEX[accentColor]);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem('logmax-brightness', String(brightness));
    // filter:brightness no body — body não é o scroller (o scroll vive em
    // <main>), então a "armadilha" de position:fixed virando relativo ao
    // ancestral filtrado não afeta nada visualmente: body cobre o viewport
    // inteiro com `bg-base` e h-screen.
    if (brightness === 100) {
      document.body.style.removeProperty('filter');
    } else {
      document.body.style.filter = `brightness(${brightness / 100})`;
    }
  }, [brightness]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const setAccentColor = (c: AccentColor) => setAccentColorState(c);
  const setBrightness = (n: number) =>
    setBrightnessState(Math.max(BRIGHTNESS_MIN, Math.min(BRIGHTNESS_MAX, Math.round(n))));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accentColor, setAccentColor, brightness, setBrightness }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
