# Stagecraft

From the first idea to the stage: write and arrange songs, plan stage and gear, build setlists and organize gigs – in one app. Everything before the DAW, and everything after the rehearsal room.

The song editor inside Stagecraft is **Tabwriter**: a modern, keyboard-driven tab editor in the spirit of Guitar Pro 5 that opens and saves `.gp5` files.

Runs as a web app (works offline, installable as a PWA) and as a desktop app for macOS, Windows and Linux ([stagecraft-desktop](https://github.com/FaultErrorFailure92/stagecraft-desktop)).

## Opening the app

| Where | How |
| --- | --- |
| **Web** | [faulterrorfailure92.github.io/Tabwriter/app/](https://faulterrorfailure92.github.io/Tabwriter/app/) – landing page one level up. After renaming the repo to `stagecraft` the address becomes `faulterrorfailure92.github.io/stagecraft/app/`. Installable as an app from the browser (PWA). |
| **Desktop** (macOS, Windows, Linux) | Download from the [stagecraft-desktop releases](https://github.com/FaultErrorFailure92/stagecraft-desktop/releases), or run it from source there with `npm run setup` once and then `npm run dev`. |
| **Local development** | `npm run dev` in this repo → [localhost:1420](http://localhost:1420) |

Tabwriter and the band features work without an account. Signing in is only needed to share a band.

## The workflow

The home screen follows the way a song actually goes (⌘1–5 jumps to a step, ⇧⌘L back to the overview):

1. **Band** – members, roles, contacts
2. **Songs** – write and arrange in Tabwriter, song profile and lifecycle, idea library
3. **Stage & tech** – gear and signal chains, stage plan, inputs, cables, parts list
4. **Setlists** – songs and breaks, total length, variants
5. **Gigs** – schedule, lineup, contacts, rider, fee and settlement

## Features

### Songs (Tabwriter)

- **Keyboard entry like GP5:** frets, note values, rests, dots, triplets and effects (hammer-on, slide, bend, palm mute, …). Drums are entered on lanes.
- **Two voices per track** (`Q`), **chord names** (`C`, suggested from the notes) and **lyrics** (`⇧L`, syllable by syllable).
- **Fretboard** (⌘J): click to enter notes, scale helper (major, minor, pentatonic, blues, modes), chord library with diagrams.
- **MIDI input** from a keyboard or MIDI guitar (web version in Chrome/Edge).
- **Multiple tracks:** guitar, bass, drums and synth (General MIDI); solo/mute, volume, pan, tunings.
- **Playback:** loop, metronome, count-in, speed control.
- **Editing:** selection, copy/cut/paste, undo/redo, transpose, automatic bar reflow.
- **Structure:** repeats, alternate endings, Segno/Coda/Fine, D.C./D.S., sections.
- **Arrangement:** parts as blocks on a timeline (⌘B, block icon). Linked copies follow each other, blocks can repeat, carry comments, mute tracks or take a track from another part. Drag to reorder.
- **Versions** (⌥⌘S): save the current state with a comment, compare, restore.
- **Lead sheet & rehearsal mode** (⇧⌘E): sections, chords and lyrics; tempo, part loop, large text, stage view.

### Band

- **Band:** members with photo and instruments, logo, contact, social media and streaming links, crew and helpers.
- **Songs:** album, BPM, key, tuning, lyrics, linked score file, recordings and links, ideas (riffs, voice memos, text), band-wide to-do board.
- **Stage & tech:** signal chain per member, stage plan in metres with 45° rotation, input list, cables, monitor mixes, parts and packing list, technical rider and stage plot (Markdown texts).
- **Setlists:** drag & drop, breaks, dividers, notes, columns (BPM, key, tuning, length), time target with a warning at ±20 %, new setlist from a template, print/PDF.
- **Gigs:** schedule, setlist, lineup, crew, contracts and receipts, photo links, presale tracking (incl. import of the old Excel workbook), fee and payout, tours with totals.
- **Calendar:** gigs, rehearsals and days members are not available; `.ics` export.
- **Accounts (optional):** sign in with an e-mail code, move a band to the cloud, invite members and guests by link, roles admin / member / guest. Syncing the band data itself is the next step.

### Files and export

- **Open:** GP3/4/5, GP (7), GPX, MusicXML, `.tabw`.
- **Save:** `.tabw` (song with arrangement and versions) or `.gp5`.
- **Export:** `.gp5`, `.gp`, MIDI, WAV, PDF/print, parts (one track per page + lead sheet, ⇧⌘P).
- **Reaper:** ZIP with one MIDI file per track, click track (WAV), tempo map and section markers.
- **Band file:** `.stagecraft` (members, songs, setlists, gigs, gear, ideas including voice memos).
- Data stays local: library, autosave with recovery and band data live in the browser/app storage. The cloud only holds accounts, bands, roles and invites for now.

## Quick start

Requirements: Node.js 22+. The desktop apps (macOS, Windows, Linux) live in [stagecraft-desktop](https://github.com/FaultErrorFailure92/stagecraft-desktop), which includes this repo as a submodule.

```bash
npm install
npm run dev            # web app at http://localhost:1420
npm run build          # web build into dist/
npm run build:pages    # GitHub Pages: landing page in dist/, app in dist/app/
npm test               # smoke tests (first time: npx playwright install chromium)
```

## Keyboard basics

| Key | Action |
|---|---|
| `0`–`9` | Enter fret |
| `←` `→` / `↑` `↓` | Previous/next beat / string |
| `+` / `−` | Longer / shorter note value |
| `Space` | Play / pause |
| `C` / `⇧L` / `Q` | Chord / lyrics / switch voice |
| `⌘B` | Overview and arrangement |
| `⌘E` / `⇧⌘E` | All tracks / lead sheet |
| `⌘J` | Fretboard |
| `⌘L` / `⌘K` | Loop / metronome |
| `⌥⌘S` | Versions |
| `⇧⌘L` / `⌘1`–`⌘5` | Overview / workflow steps |
| `?` | All shortcuts |

On Windows and Linux, use `Ctrl` instead of `⌘`.

## Deployment

**Web (GitHub Pages):** push to `main`. The workflow in `.github/workflows/web.yml` runs `npm run build:pages`: the landing page (`landing/`) goes to the site root, the app to `/app/`. One-time setup: in the repo, go to *Settings → Pages → Source* and choose **GitHub Actions**. Netlify and Cloudflare Pages work too (see `netlify.toml` and `public/_headers`).

**Desktop releases:** built in [stagecraft-desktop](https://github.com/FaultErrorFailure92/stagecraft-desktop).

**Backend (Supabase):** project in the EU (Ireland). URL and publishable key are in `src/cloud/cloud.ts` (public by design; access is enforced by row level security). The database schema lives in `supabase/migrations/` and is applied in that order. One-time setup in the Supabase dashboard:
- *Authentication → Emails → Magic Link*: the template must contain `{{ .Token }}`, so users get a 6-digit code instead of a link.
- Before inviting people outside the Supabase team: set up a custom SMTP sender (the built-in one only mails team members and only a few messages per hour).

## Project structure

```
src/
  main.ts          UI, keyboard, inspector, home, dialogs, playback, lead sheet, fretboard panel
  editor.ts        cursor, input, voices, chords/lyrics, selection/clipboard, bar operations, undo
  model.ts         score/track creation, presets, drum lanes
  arrangement.ts   parts and blocks, linked copies, track references
  overview.ts      tracks × bars overview with arrangement row
  leadsheet.ts     lead sheet rendering
  chords.ts        chord detection, chord/lyric helpers
  fretboard.ts     fretboard, scales, chord shapes
  versions.ts      song versions and diff
  reaper.ts, zip.ts   Reaper export (MIDI, click, markers)
  midiin.ts        MIDI input (Web MIDI)
  gp5writer.ts     GP5 (v5.00) writer incl. chords, lyrics, two voices
  midi.ts, wav.ts, print.ts   exports and printing
  library.ts       recent files + autosave (IndexedDB)
  band/            Stagecraft: model, band/songs/setlists/gigs UI, ideas, stage & tech, rider, calendar, tours, account UI
  cloud/           Supabase client: sign-in, bands in the cloud, roles, invites (loaded only when used)
  tauri.ts         desktop bridge: native menu, file associations, updater (used when running inside stagecraft-desktop)
  i18n*.ts         German (keys) / English
landing/           landing page for GitHub Pages
tests/             smoke tests (Playwright)
public/            fonts, soundfont, icons, licenses
supabase/          database migrations (tables, roles, row level security)
```

## Built with

- [alphaTab](https://alphatab.net): notation rendering, playback, and file import (MPL-2.0)
- [Vite](https://vite.dev) + TypeScript
- Bravura music font (SIL OFL) and the Sonivox GM soundfont (Apache 2.0)

Third-party license texts are in `public/licenses/`.

## Roadmap

- Sync of band data between devices and members (Supabase)
- Subscription and free licenses, custom domain and hosting on Cloudflare Pages
- MIDI input in the macOS app (native plugin)
- Larger optional soundfont
- Song folder as library (e.g. iCloud)
- DAW plugin (VST3/CLAP)

## License

[MIT](LICENSE) © 2026 Benjamin Auer

Bundled third-party components keep their own licenses (see above).
