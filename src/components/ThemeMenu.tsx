import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Language } from '../../shared';
import { translator } from '../i18n';

type Mode = 'light' | 'dark' | 'system';

// Colors per theme live in styles.css under :root[data-theme="..."]; this list only names them.
const themes = [
  { id: 'minimal', name: 'Minimal', color: '#e5e5e5' },
  { id: 'kanagawa-dragon', name: 'Kanagawa Dragon', color: '#ffa066' },
  { id: 'nord', name: 'Nord', color: '#88c0d0' },
  { id: 'catppuccin', name: 'Catppuccin', color: '#cba6f7' },
  { id: 'tokyo-night', name: 'Tokyo Night', color: '#7aa2f7' }
];
const modes = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor }
] as const;

// Appearance is a per-browser preference; storage can be unavailable (private windows), so every access is guarded.
function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function storedAppearance() {
  return { mode: stored('watchsweeperr-mode', 'dark') as Mode, theme: stored('watchsweeperr-theme', 'minimal') };
}

export function applyAppearance(mode: Mode, theme: string) {
  const light = mode === 'light' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.mode = light ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
}

export function ThemeMenu({ language }: { language: Language }) {
  const t = translator(language);
  const [open, setOpen] = useState(false);
  const [{ mode, theme }, setAppearance] = useState(storedAppearance);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyAppearance(mode, theme);
    try {
      localStorage.setItem('watchsweeperr-mode', mode);
      localStorage.setItem('watchsweeperr-theme', theme);
    } catch {
      // Not saved; the choice still applies until the page is closed.
    }
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => applyAppearance(mode, theme);
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [mode, theme]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="theme-menu" ref={menu}>
      <button className="icon-button theme-toggle" aria-label={t('appearance')} title={t('appearance')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Palette size={17} />
      </button>
      {open && (
        <div className="theme-popover">
          <strong>{t('appearance')}</strong>
          <span className="theme-label">{t('mode')}</span>
          {modes.map(({ id, icon: Icon }) => (
            <button key={id} className="theme-option" aria-pressed={mode === id} onClick={() => setAppearance({ mode: id, theme })}>
              <Icon size={15} />{t(id)}{mode === id && <Check size={15} className="theme-check" />}
            </button>
          ))}
          <span className="theme-label">{t('theme')}</span>
          {themes.map((item) => (
            <button key={item.id} className="theme-option" aria-pressed={theme === item.id} onClick={() => setAppearance({ mode, theme: item.id })}>
              <span className="theme-dot" style={{ background: item.color }} />{item.name}{theme === item.id && <Check size={15} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
