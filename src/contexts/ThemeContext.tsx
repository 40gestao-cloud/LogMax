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

// Brilho da tela — 50% a 150% (100 = neutro). Browser não expõe API nativa,
// então a percepção de brilho é renderizada por um overlay preto/branco com
// opacidade variável (z-9999, pointer-events: none).
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
  }, [brightness]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const setAccentColor = (c: AccentColor) => setAccentColorState(c);
  const setBrightness = (n: number) =>
    setBrightnessState(Math.max(BRIGHTNESS_MIN, Math.min(BRIGHTNESS_MAX, Math.round(n))));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, accentColor, setAccentColor, brightness, setBrightness }}>
      {children}
      <BrightnessOverlay value={brightness} />
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

// Overlay full-screen sem interação. Abaixo de 100% escurece (preto), acima
// clareia (branco). Opacidade máxima 0.2 em qualquer extremo — o suficiente
// para alterar percepção sem quebrar contraste de leitura nem mascarar a UI.
function BrightnessOverlay({ value }: { value: number }) {
  if (value === 100) return null;
  const isDim    = value < 100;
  const distance = Math.abs(value - 100);            // 0..50
  const opacity  = (distance / 50) * 0.4;            // 0..0.4
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        background: isDim ? 'black' : 'white',
        opacity,
        transition: 'opacity 0.2s ease',
      }}
    />
  );
}
