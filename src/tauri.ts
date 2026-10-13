// Desktop (Tauri) integration: native menu, close guard, files opened from Finder, updates.
import { t } from './i18n';

export const T = (): any => (window as any).__TAURI__ ?? null;
export const isDesktop = () => !!T();
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export type Action =
  | 'about' | 'prefs' | 'updates' | 'quit'
  | 'new' | 'open' | 'library' | 'save' | 'saveas' | 'export-gp' | 'export-gp5' | 'export-midi' | 'export-wav' | 'print' | 'meta'
  | 'undo' | 'redo' | 'paste-insert' | 'select-all'
  | 'multi' | 'panel' | 'sidebar' | 'overview' | 'zoom-in' | 'zoom-out' | 'zoom-reset'
  | 'play' | 'stop' | 'loop' | 'metronome' | 'transpose'
  | 'help' | 'onboarding' | 'demo' | 'band';

export async function setupMenu(run: (a: Action) => void) {
  const tt = T();
  if (!tt?.menu) return;
  const { Menu, Submenu, MenuItem, PredefinedMenuItem } = tt.menu;
  // if an accelerator is not understood by the platform, fall back to an item without one
  const item = async (id: Action, text: string, accelerator?: string) => {
    try {
      return await MenuItem.new({ id, text, accelerator, action: () => run(id) });
    } catch {
      return MenuItem.new({ id, text, action: () => run(id) });
    }
  };
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' });
  const pre = (name: string, text?: string) => PredefinedMenuItem.new({ item: name, text });

  const app = await Submenu.new({
    text: 'Tabwriter',
    items: await Promise.all([
      item('about', t('Über Tabwriter')),
      sep(),
      item('prefs', t('Einstellungen …'), 'CmdOrCtrl+,'),
      item('updates', t('Nach Updates suchen …')),
      sep(),
      pre('Services'),
      sep(),
      pre('Hide', t('Tabwriter ausblenden')),
      pre('HideOthers', t('Andere ausblenden')),
      pre('ShowAll', t('Alle einblenden')),
      sep(),
      item('quit', t('Tabwriter beenden'), 'CmdOrCtrl+Q'),
    ]),
  });
  const exportMenu = await Submenu.new({
    text: t('Exportieren'),
    items: await Promise.all([
      item('export-gp5', t('Guitar Pro 5 (.gp5) …')),
      item('export-gp', t('Guitar Pro 7 (.gp) …')),
      item('export-midi', t('MIDI …')),
      item('export-wav', t('Audio (WAV) …')),
    ]),
  });
  const file = await Submenu.new({
    text: t('Ablage'),
    items: await Promise.all([
      item('new', t('Neu'), 'CmdOrCtrl+N'),
      item('open', t('Öffnen …'), 'CmdOrCtrl+O'),
      item('library', t('Bibliothek'), 'CmdOrCtrl+Shift+L'),
      item('band', t('Band …'), 'CmdOrCtrl+Shift+G'),
      sep(),
      item('save', t('Speichern'), 'CmdOrCtrl+S'),
      item('saveas', t('Speichern unter …'), 'CmdOrCtrl+Shift+S'),
      Promise.resolve(exportMenu),
      sep(),
      item('print', t('Drucken / PDF …'), 'CmdOrCtrl+P'),
      item('meta', t('Song-Infos …')),
      sep(),
      pre('CloseWindow', t('Fenster schließen')),
    ]),
  });
  const edit = await Submenu.new({
    text: t('Bearbeiten'),
    items: await Promise.all([
      item('undo', t('Rückgängig'), 'CmdOrCtrl+Z'),
      item('redo', t('Wiederholen'), 'CmdOrCtrl+Shift+Z'),
      sep(),
      pre('Cut', t('Ausschneiden')),
      pre('Copy', t('Kopieren')),
      pre('Paste', t('Einfügen')),
      item('paste-insert', t('Takte einfügen'), 'CmdOrCtrl+Shift+V'),
      item('select-all', t('Alles auswählen'), 'CmdOrCtrl+A'),
      sep(),
      item('transpose', t('Transponieren …'), 'CmdOrCtrl+T'),
    ]),
  });
  const view = await Submenu.new({
    text: t('Ansicht'),
    items: await Promise.all([
      item('sidebar', t('Spuren ein-/ausblenden'), 'Ctrl+CmdOrCtrl+S'),
      item('multi', t('Alle Spuren / eine Spur'), 'CmdOrCtrl+E'),
      item('panel', t('Spur-Einstellungen'), 'CmdOrCtrl+I'),
      item('overview', t('Übersicht'), 'CmdOrCtrl+B'),
      sep(),
      item('zoom-in', t('Vergrößern'), 'CmdOrCtrl+='),
      item('zoom-out', t('Verkleinern'), 'CmdOrCtrl+-'),
      item('zoom-reset', t('Originalgröße'), 'CmdOrCtrl+0'),
      sep(),
      pre('Fullscreen', t('Vollbild')),
    ]),
  });
  const play = await Submenu.new({
    text: t('Wiedergabe'),
    items: await Promise.all([
      item('play', t('Abspielen / Pause (Leertaste)')),
      item('stop', t('Stop (Esc)')),
      sep(),
      item('loop', t('Schleife'), 'CmdOrCtrl+L'),
      item('metronome', t('Metronom'), 'CmdOrCtrl+K'),
    ]),
  });
  const win = await Submenu.new({
    text: t('Fenster'),
    items: await Promise.all([pre('Minimize', t('Im Dock ablegen')), pre('Maximize', t('Zoomen'))]),
  });
  const help = await Submenu.new({
    text: t('Hilfe'),
    items: await Promise.all([
      item('help', t('Tastenkürzel')),
      item('onboarding', t('Erste Schritte')),
      item('demo', t('Demo-Song öffnen')),
    ]),
  });
  const menu = await Menu.new({ items: [app, file, edit, view, play, win, help] });
  await menu.setAsAppMenu();
}

/** ask before closing the window with unsaved changes */
export function guardClose(isDirty: () => boolean, confirm: () => Promise<boolean>, beforeClose: () => Promise<void> | void) {
  const tt = T();
  const w = tt?.window?.getCurrentWindow?.();
  if (!w) return;
  w.onCloseRequested(async (e: any) => {
    if (!isDirty()) {
      await beforeClose();
      return;
    }
    e.preventDefault();
    if (await confirm()) {
      await beforeClose();
      await w.destroy();
    }
  });
}

export async function closeWindow() {
  await T()?.window?.getCurrentWindow?.().close();
}

/** files opened via Finder / command line */
export async function onOpenFiles(cb: (paths: string[]) => void) {
  const tt = T();
  if (!tt?.core) return;
  const take = async () => {
    try {
      const list: string[] = await tt.core.invoke('take_pending_files');
      if (list.length) cb(list);
    } catch {
      /* ignore */
    }
  };
  await tt.event?.listen?.('open-files', () => take());
  await take();
}

export interface UpdateInfo {
  version: string;
  notes?: string;
  install: (progress: (f: number) => void) => Promise<void>;
}

export async function checkUpdate(): Promise<UpdateInfo | null> {
  const tt = T();
  if (!tt?.updater?.check) return null;
  try {
    const u = await tt.updater.check();
    if (!u) return null;
    return {
      version: u.version,
      notes: u.body,
      install: async (progress) => {
        let total = 0;
        let got = 0;
        await u.downloadAndInstall((ev: any) => {
          if (ev.event === 'Started') total = ev.data?.contentLength ?? 0;
          if (ev.event === 'Progress') {
            got += ev.data?.chunkLength ?? 0;
            if (total) progress(got / total);
          }
        });
        await tt.process?.relaunch?.();
      },
    };
  } catch {
    return null; // not configured / offline
  }
}

/** native window appearance (also drives the sidebar vibrancy material) */
export async function setWindowTheme(theme: 'light' | 'dark' | null) {
  try {
    await T()?.window?.getCurrentWindow?.().setTheme(theme);
  } catch {
    /* not available */
  }
}
