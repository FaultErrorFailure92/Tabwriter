// Print / PDF: renders the score into an off-screen container with print styling,
// then opens the system print dialog (which offers "Save as PDF" on macOS).
import * as alphaTab from '@coderline/alphatab';

let area: HTMLElement | null = null;
let printApis: alphaTab.AlphaTabApi[] = [];

function cleanup() {
  printApis.forEach((a) => a.destroy());
  printApis = [];
  area?.remove();
  area = null;
}

function printSettings(base: alphaTab.Settings): alphaTab.Settings {
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
  return s;
}

function renderInto(el: HTMLElement, score: alphaTab.model.Score, tracks: number[], base: alphaTab.Settings): Promise<void> {
  return new Promise((resolve) => {
    const api = new alphaTab.AlphaTabApi(el, printSettings(base));
    printApis.push(api);
    let done = false;
    api.postRenderFinished.on(() => {
      if (done) return;
      done = true;
      resolve();
    });
    api.renderScore(score, tracks);
  });
}

async function finish() {
  await new Promise((r) => setTimeout(r, 200));
  // the off-screen copy stays until the dialog is done (or the next print)
  window.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
  await openPrintDialog();
}

export async function printScore(score: alphaTab.model.Score, tracks: number[], base: alphaTab.Settings): Promise<void> {
  cleanup();
  area = document.createElement('div');
  area.id = 'printArea';
  const inner = document.createElement('div');
  area.appendChild(inner);
  document.body.appendChild(area);
  await renderInto(inner, score, tracks, base);
  await finish();
}

/** several parts in one print job (each starts on a new page), optional HTML (lead sheet) at the end */
export async function printParts(score: alphaTab.model.Score, parts: { title: string; tracks: number[] }[], base: alphaTab.Settings, extra?: { title: string; html: string }): Promise<void> {
  cleanup();
  area = document.createElement('div');
  area.id = 'printArea';
  area.className = 'parts';
  document.body.appendChild(area);
  for (const p of parts) {
    const sec = document.createElement('section');
    sec.className = 'printPart';
    const h = document.createElement('div');
    h.className = 'partLabel';
    h.textContent = p.title;
    const inner = document.createElement('div');
    sec.append(h, inner);
    area.appendChild(sec);
    await renderInto(inner, score, p.tracks, base);
  }
  if (extra) {
    const sec = document.createElement('section');
    sec.className = 'printPart leadPrint';
    sec.innerHTML = `<div class="partLabel">${extra.title.replace(/[&<>]/g, '')}</div>${extra.html}`;
    area.appendChild(sec);
  }
  await finish();
}

export async function openPrintDialog() {
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
