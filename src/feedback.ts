// Feedback: a short dialog that opens a prefilled GitHub issue (no account data leaves the app by itself).
import { t } from './i18n';
import { isTauri } from './io';
import { wizard, wizField, wizInput, choices, toggle } from './band/kit';
import { el } from './band/dom';

declare const __APP_VERSION__: string;
export const REPO = 'FaultErrorFailure92/Tabwriter';

/** open a link in the system browser (desktop app) or a new tab (web) */
export async function openExternal(url: string) {
  const tt = (window as any).__TAURI__;
  if (tt?.core?.invoke) {
    try {
      await tt.core.invoke('plugin:opener|open_url', { url });
      return;
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
      return;
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** desktop app: links with target=_blank go to the system browser */
export function routeExternalLinks() {
  if (!isTauri()) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !/^(https?:|mailto:|tel:)/.test(a.href)) return;
    e.preventDefault();
    void openExternal(a.href);
  }, true);
}

type Kind = 'bug' | 'idea' | 'question';

export async function openFeedback(area: string, flash: (m: string) => void) {
  const r = await wizard<{ kind: Kind; title: string; text: string; info: boolean }>({
    title: t('Feedback'),
    state: { kind: 'bug', title: '', text: '', info: true },
    finish: t('Auf GitHub öffnen'),
    steps: [{
      title: t('Was möchtest du uns sagen?'),
      text: t('Es öffnet sich ein vorausgefülltes Issue auf GitHub. Dort meldest du dich an und schickst es ab.'),
      ok: (s) => !!s.title.trim(),
      body: (box, s, redraw) => {
        choices<Kind>(box, [
          { k: 'bug', icon: 'question', label: t('Fehler melden'), sub: t('Etwas funktioniert nicht wie erwartet') },
          { k: 'idea', icon: 'sparkles', label: t('Idee / Wunsch'), sub: t('Neue Funktion oder Verbesserung') },
          { k: 'question', icon: 'comment', label: t('Frage'), sub: t('Wie geht …?') },
        ], s.kind, (k) => (s.kind = k));
        wizField(box, t('Titel'), wizInput(s.title, t('Kurz in einem Satz'), (v) => { s.title = v; redraw(); }));
        const ta = el('textarea', 'pInput notes');
        ta.placeholder = t('Was hast du gemacht, was ist passiert, was hättest du erwartet?');
        ta.oninput = () => (s.text = ta.value);
        wizField(box, t('Beschreibung'), ta);
        const row = el('label', 'wizToggle', `<span>${t('Version, System und Bereich mitschicken')}</span>`);
        row.prepend(toggle(s.info, (v) => (s.info = v)));
        box.appendChild(row);
      },
    }],
  });
  if (!r) return;
  const label = { bug: 'bug', idea: 'enhancement', question: 'question' }[r.kind];
  const info = r.info
    ? `\n\n---\n- Version: ${__APP_VERSION__}\n- ${isTauri() ? 'macOS-App' : 'Web'}: ${navigator.userAgent}\n- ${t('Bereich')}: ${area}\n- ${t('Sprache')}: ${navigator.language}`
    : '';
  const body = (r.text.trim() || '') + info;
  const url = `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title: r.title.trim(), body: body.slice(0, 5000), labels: label })}`;
  await openExternal(url);
  flash(t('GitHub wird geöffnet …'));
}
