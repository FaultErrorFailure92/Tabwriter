// Print / PDF: renders the score into an off-screen container with print styling,
// then opens the system print dialog (which offers "Save as PDF" on macOS).
import * as alphaTab from '@coderline/alphatab';

let area: HTMLElement | null = null;
let printApi: alphaTab.AlphaTabApi | null = null;

function cleanup() {
  printApi?.destroy();
  printApi = null;
  area?.remove();
  area = null;
}

export function printScore(score: alphaTab.model.Score, tracks: number[], base: alphaTab.Settings): Promise<void> {
  cleanup();
  area = document.createElement('div');
  area.id = 'printArea';
  const inner = document.createElement('div');
  area.appendChild(inner);
  document.body.appendChild(area);

  const s = new alphaTab.Settings();
  s.core.engine = 'svg';
  s.core.fontDirectory = base.core.fontDirectory;
  s.core.enableLazyLoading = false;
  s.core.useWorkers = false;
  s.core.logLevel = alphaTab.LogLevel.Warning;
  s.display.layoutMode = alphaTab.LayoutMode.Page;
  s.display.scale = 0.85;
  s.display.staveProfile = base.display.staveProfile;
  s.notation.rhythmMode = base.notation.rhythmMode;
  base.notation.elements.forEach((v, k) => s.notation.elements.set(k, v));
  s.player.playerMode = alphaTab.PlayerMode.Disabled;

  return new Promise((resolve) => {
    printApi = new alphaTab.AlphaTabApi(inner, s);
    let done = false;
    printApi.postRenderFinished.on(() => {
      if (done) return;
      done = true;
      setTimeout(async () => {
        // the off-screen copy stays until the dialog is done (or the next print)
        window.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
        await openPrintDialog();
        resolve();
      }, 200);
    });
    printApi.renderScore(score, tracks);
  });
}

async function openPrintDialog() {
  const t = (window as any).__TAURI__;
  if (t?.core?.invoke) {
    try {
      await t.core.invoke('print_window');
      return;
    } catch {
      /* fall back */
    }
  }
  window.print();
}
