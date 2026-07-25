import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'dark' | 'light';

const VALID_THEMES: Theme[] = ['dark', 'light'];
export type AccentColor = 'green' | 'yellow' | 'purple' | 'orange' | 'blue' | 'pink' | 'red' | 'acessivel';

const VALID_ACCENTS: AccentColor[] = ['green', 'yellow', 'purple', 'orange', 'blue', 'pink', 'red', 'acessivel'];

const ACCENT_HEX: Record<AccentColor, string> = {
  green:     '#D4AF37',
  yellow:    '#D4AF37',
  purple:    '#D4AF37',
  orange:    '#D4AF37',
  blue:      '#D4AF37',
  pink:      '#D4AF37',
  red:       '#D4AF37',
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
  setTheme: (t: Theme) => void;
  accentColor: AccentColor;
  setAccentColor: (c: AccentColor) => void;
  brightness: number;
  setBrightness: (n: number) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
  accentColor: 'green',
  setAccentColor: () => {},
  brightness: 100,
  setBrightness: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('logmax-theme') as Theme | null;
    return saved && VALID_THEMES.includes(saved) ? saved : 'dark';
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

  // Pula a primeira execução (mount) — não há "troca" pendente, só inicialização.
  // Sem isso, a primeira carga ativa o theme-switching desnecessariamente.
  const firstThemeRun = useRef(true);

  useEffect(() => {
    const root = document.documentElement;
    if (firstThemeRun.current) {
      firstThemeRun.current = false;
      root.setAttribute('data-theme', theme);
      localStorage.setItem('logmax-theme', theme);
      return;
    }
    // Troca real: suprime transições, troca o atributo, libera transições no
    // próximo paint (2 RAFs garantem que o browser aplicou o novo estilo sem
    // animar). Sem isso, body (0.3s) e neu-* (0.2s) faziam o switch parecer
    // lento e desigual.
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    localStorage.setItem('logmax-theme', theme);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('theme-switching');
      });
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor);
    localStorage.setItem('logmax-accent', accentColor);
    // /simulador-pagamento tem identidade própria (azul fixo) — não sobrescrever.
    if (window.location.pathname === '/simulador-pagamento') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = ACCENT_HEX[accentColor];
    if (meta) meta.setAttribute('content', color);
  }, [accentColor, theme]);

  useEffect(() => {
    // Controle de brilho foi removido da UI. filter:brightness no <body>
    // forcava repaint da viewport inteira em cada frame de scroll — causa
    // classica de travamento. Limpa filtro e valor persistido pra qualquer
    // usuario que tenha resquicio no localStorage.
    document.body.style.removeProperty('filter');
    localStorage.removeItem('logmax-brightness');
  }, [brightness]);

  const toggleTheme = () => setThemeState(t => t === 'dark' ? 'light' : 'dark');
  const setTheme = (t: Theme) => setThemeState(t);
  const setAccentColor = (c: AccentColor) => setAccentColorState(c);
  const setBrightness = (n: number) =>
    setBrightnessState(Math.max(BRIGHTNESS_MIN, Math.min(BRIGHTNESS_MAX, Math.round(n))));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, accentColor, setAccentColor, brightness, setBrightness }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
