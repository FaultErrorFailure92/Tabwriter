// Detects browsers/devices Stagecraft can't serve well. Returns a message or null.
import { t } from './i18n';

export function checkBrowser(): string | null {
  const w = window as any;
  const missing: string[] = [];
  if (!(w.AudioContext || w.webkitAudioContext)) missing.push('Web Audio');
  if (!w.Worker) missing.push('Web Worker');
  if (!w.indexedDB) missing.push('IndexedDB');
  if (!w.WebAssembly && !w.Promise) missing.push('ES2020');
  if (missing.length) {
    return t('Dein Browser unterstützt nicht alles, was Stagecraft braucht ({x}). Bitte nutze eine aktuelle Version von Chrome, Edge, Firefox oder Safari.', { x: missing.join(', ') });
  }
  const touchOnly = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches;
  if (touchOnly || window.innerWidth < 700) {
    return t('Stagecraft ist für Computer mit Tastatur gemacht. Auf Handy und Tablet ist die Bedienung eingeschränkt.');
  }
  return null;
}
