// Impressum and privacy policy, shown in the app (#impressum, #datenschutz) and linked from the landing page.
// Texts are German on purpose (Austrian law). Fill in LEGAL before going public.
import { md } from './band/md';

export const LEGAL = {
  name: 'Benjamin Auer',
  address: '[Straße Hausnummer], [PLZ Ort], Österreich',
  email: '[E-Mail-Adresse]',
  updated: '14. Oktober 2026',
};

const AI_NOTE = `**Hinweis zur Entstehung:** Diese App wurde zu 100 % mit künstlicher Intelligenz erstellt – Code, Texte und Gestaltung stammen von einem KI-Assistenten (Claude von Anthropic), gesteuert und geprüft von ${LEGAL.name}. In der App selbst werden deine Daten **nicht** an eine KI geschickt.`;

const IMPRESSUM = `## Impressum

Angaben nach § 5 E-Commerce-Gesetz und § 25 Mediengesetz.

**${LEGAL.name}**
${LEGAL.address}
E-Mail: ${LEGAL.email}

**Unternehmensgegenstand:** Entwicklung und Betrieb der Software Stagecraft (Tabwriter)

**Grundlegende Richtung:** Informationen über die App Stagecraft und Bereitstellung der App.

${AI_NOTE}

**Haftung:** Die App wird ohne Gewähr bereitgestellt. Bitte sichere wichtige Daten regelmäßig (Band → Band-Datei speichern). Für Inhalte externer Links sind ausschließlich deren Betreiber verantwortlich.

**Quellcode und Lizenzen:** Der Quellcode ist unter der MIT-Lizenz auf GitHub veröffentlicht. Verwendete Open-Source-Komponenten findest du unter „Über Stagecraft“.

**Kontakt und Feedback:** ${LEGAL.email} oder über den Feedback-Knopf in der App.`;

const DATENSCHUTZ = `## Datenschutzerklärung

Stand: ${LEGAL.updated}

### Kurz gesagt

- Ohne Account bleibt **alles auf deinem Gerät**. Es werden keine Daten an uns übertragen.
- Es gibt **keine Werbung, kein Tracking, keine Analyse-Tools** und keine Cookies zu Marketingzwecken.
- Mit Account werden deine Banddaten in der EU (Irland) gespeichert, damit du sie teilen kannst. Du kannst sie jederzeit herunterladen oder löschen.

${AI_NOTE}

### Verantwortlich

${LEGAL.name}, ${LEGAL.address}, ${LEGAL.email}

### Daten auf deinem Gerät

Die App speichert Noten, Bibliothek, Einstellungen, Banddaten und Dateien (z.B. Sprachmemos) im Speicher deines Browsers bzw. der Desktop-App (IndexedDB, Local Storage). Diese Daten verlassen dein Gerät nicht, solange du keinen Account verwendest. Diese Speicherung ist für die Funktion der App unbedingt nötig; deshalb ist dafür keine Einwilligung und kein Cookie-Banner erforderlich (§ 165 Abs. 3 TKG 2021). Du löschst sie, indem du die Website-Daten im Browser löschst bzw. die App deinstallierst.

### Aufruf der Website (Hosting)

Die Website wird über **Cloudflare** (Cloudflare, Inc., USA) ausgeliefert. Dabei verarbeitet Cloudflare technisch notwendige Verbindungsdaten wie IP-Adresse, Zeitpunkt und Browserkennung, um die Seite auszuliefern und vor Angriffen zu schützen. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare ist nach dem EU-US Data Privacy Framework zertifiziert.

### Account und Cloud (optional)

Wenn du dich anmeldest, speichern wir bei **Supabase** (Supabase, Inc.; Server in der EU, Irland):

- deine E-Mail-Adresse und deinen Anzeigenamen,
- die Bands, in denen du bist, und deine Rolle,
- die Banddaten, die du in die Cloud übernimmst (Songs, Setlists, Gigs, Proben, Kontakte, Crew …), und hochgeladene Dateien,
- Einladungen, die du erstellst oder annimmst.

Zweck ist, dir Login, Abgleich zwischen Geräten und das Teilen mit deiner Band zu ermöglichen (Art. 6 Abs. 1 lit. b DSGVO, Vertrag). Für den Anmeldecode schicken wir dir eine E-Mail. Die Daten bleiben gespeichert, bis du sie löschst oder deinen Account löschst (Account-Menü → „Account & Daten“).

**Daten anderer Personen:** Banddaten können Namen, Telefonnummern oder Adressen von Bandmitgliedern, Crew und Veranstaltern enthalten. Bitte trage nur Daten ein, die du dafür verwenden darfst. Mitglieder einer Band sehen die Banddaten dieser Band.

### Feedback

Der Feedback-Knopf öffnet GitHub (GitHub, Inc., USA) mit einem vorausgefüllten Formular. Was du dort absendest, ist öffentlich sichtbar und unterliegt der Datenschutzerklärung von GitHub. Ob Version und System mitgeschickt werden, entscheidest du selbst.

### Eingebundene Inhalte

Spotify-Player in einem Song werden erst geladen, wenn du auf „Player laden“ tippst. Erst dann erhält Spotify (Spotify AB, Schweden) deine IP-Adresse und Browserdaten. Andere Links (YouTube, Bandcamp …) öffnen sich nur, wenn du sie anklickst.

Schriften und Klänge sind in der App enthalten und werden nicht von fremden Servern geladen.

### Deine Rechte

Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Download und Löschung kannst du direkt in der App erledigen (Account-Menü → „Account & Daten“). Für alles andere schreib an ${LEGAL.email}.

Du kannst dich außerdem bei der Österreichischen Datenschutzbehörde beschweren: [www.dsb.gv.at](https://www.dsb.gv.at).`;

let open: HTMLElement | null = null;

/** full-screen sheet with the text; closes with Esc or the button */
export function openLegal(kind: 'impressum' | 'datenschutz') {
  open?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay legalOverlay';
  const card = document.createElement('div');
  card.className = 'card legal';
  card.innerHTML = `<div class="legalBody">${md(kind === 'impressum' ? IMPRESSUM : DATENSCHUTZ)}</div>`;
  const row = document.createElement('div');
  row.className = 'row';
  const other = document.createElement('button');
  other.className = 'btn';
  other.textContent = kind === 'impressum' ? 'Datenschutz' : 'Impressum';
  other.onclick = () => openLegal(kind === 'impressum' ? 'datenschutz' : 'impressum');
  const close = document.createElement('button');
  close.className = 'btn primary';
  close.textContent = 'Schließen';
  const done = () => {
    ov.remove();
    open = null;
    document.removeEventListener('keydown', key, true);
    if (/^#(impressum|datenschutz)$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      done();
    }
  };
  close.onclick = done;
  ov.onclick = (e) => { if (e.target === ov) done(); };
  row.append(other, Object.assign(document.createElement('span'), { className: 'spacer' }), close);
  card.appendChild(row);
  ov.appendChild(card);
  document.body.appendChild(ov);
  document.addEventListener('keydown', key, true);
  open = ov;
}

/** #impressum / #datenschutz in the address opens the page (links from the landing page) */
export function legalFromHash() {
  const m = location.hash.match(/^#(impressum|datenschutz)$/);
  if (m) openLegal(m[1] as 'impressum' | 'datenschutz');
}
