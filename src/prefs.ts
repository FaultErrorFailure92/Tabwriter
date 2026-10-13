// User preferences (stored per device).
export type Theme = 'auto' | 'light' | 'dark';
export type LangPref = 'auto' | 'de' | 'en';
export type NotationView = 'both' | 'tab' | 'score';

export interface Prefs {
  lang: LangPref;
  theme: Theme;
  zoom: number; // 0.6 .. 1.6
  notation: NotationView;
  autosave: boolean;
  notePreview: boolean;
  onboarded: boolean;
  countIn: boolean;
  autoReflow: boolean;
  metronome: boolean;
  speed: number;
  leadZoom: number; // lead sheet / rehearsal text size
  fretboard: boolean;
  fbFrets: number;
  fbRoot: number; // -1 = no scale
  fbScale: string;
  fbNames: boolean;
  overview: boolean;
  ovHeight: number;
}

const KEY = 'tabwriter.prefs';
const DEFAULTS: Prefs = {
  lang: 'auto',
  theme: 'auto',
  zoom: 1,
  notation: 'both',
  autosave: true,
  notePreview: true,
  onboarded: false,
  countIn: false,
  autoReflow: true,
  metronome: false,
  speed: 1,
  leadZoom: 1.2,
  fretboard: false,
  fbFrets: 15,
  fbRoot: -1,
  fbScale: 'pentaMin',
  fbNames: true,
  overview: false,
  ovHeight: 200,
};

let current: Prefs = load();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function prefs(): Prefs {
  return current;
}

export function setPrefs(p: Partial<Prefs>) {
  current = { ...current, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
}

export function isDark(): boolean {
  if (current.theme === 'dark') return true;
  if (current.theme === 'light') return false;
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
