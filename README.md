# Stagecraft

From the first idea to the stage: write and arrange songs, plan stage and gear, build setlists and organize gigs – in one app. Everything before the DAW, and everything after the rehearsal room.

The song editor inside Stagecraft is **Tabwriter**: a modern, keyboard-driven tab editor in the spirit of Guitar Pro 5 that opens and saves `.gp5` files.

Runs as a native macOS app (Tauri) and as a web app (works offline, installable as a PWA). The web app also runs on Windows and Linux.

**Web:** landing page at [faulterrorfailure92.github.io/Tabwriter](https://faulterrorfailure92.github.io/Tabwriter/), the app at [/app/](https://faulterrorfailure92.github.io/Tabwriter/app/).

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

- **Song profile:** phase (idea → writing → arrangement → production → released → live), album, to-dos, sounds and patches per part (e.g. Helix), linked score file.
- **Idea library:** riffs from the editor selection, voice memos (record or import), text ideas with syllable count, tags and search.
- **Stage & tech:** signal chain per member, stage plan in metres (drag or exact X/Y), suggested input list and cables, monitor mixes, parts list by owner, packing list, rider.
- **Setlists:** drag & drop, breaks, total length, duplicate as a variant.
- **Gigs:** date, venue, schedule, setlist, lineup, contacts, notes; fee, costs and payout per person; day sheet and rider as PDF.

### Files and export

- **Open:** GP3/4/5, GP (7), GPX, MusicXML, `.tabw`.
- **Save:** `.tabw` (song with arrangement and versions) or `.gp5`.
- **Export:** `.gp5`, `.gp`, MIDI, WAV, PDF/print, parts (one track per page + lead sheet, ⇧⌘P).
- **Reaper:** ZIP with one MIDI file per track, click track (WAV), tempo map and section markers.
- **Band file:** `.stagecraft` (members, songs, setlists, gigs, gear, ideas including voice memos).
- Data stays local: library, autosave with recovery and band data live in the browser/app storage.

## Quick start

Requirements: Node.js 22+. For the desktop app you also need Rust 1.90+ (`rustup update stable`).

```bash
npm install
npm run dev            # web app at http://localhost:1420
npm run tauri dev      # macOS app (development)
npm run tauri build    # .app / .dmg
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

**macOS release:** push a tag (`git tag v1.0.0 && git push --tags`). `.github/workflows/release.yml` builds a signed and notarized app and publishes it as a GitHub release, including the update feed. Before your first release:
- Add your Apple certificate and notarization credentials as repository secrets.
- Run `npx tauri signer generate` and put the public key in `src-tauri/tauri.conf.json`.
- Replace `REPLACE_OWNER/REPLACE_REPO` with your repository.

The bundle identifier stays `at.benni.tabwriter` so existing local data is kept.

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
  band/            Stagecraft: model, members/songs/setlists/gigs UI, ideas, stage & tech, rider
  tauri.ts         native menu, file associations, updater
  i18n*.ts         German (keys) / English
landing/           landing page for GitHub Pages
tests/             smoke tests (Playwright)
src-tauri/         Tauri 2 shell (Rust)
public/            fonts, soundfont, icons, licenses
```

## Built with

- [alphaTab](https://alphatab.net): notation rendering, playback, and file import (MPL-2.0)
- [Tauri 2](https://tauri.app) and [Vite](https://vite.dev) + TypeScript
- Bravura music font (SIL OFL) and the Sonivox GM soundfont (Apache 2.0)

Third-party license texts are in `public/licenses/`.

## Roadmap

- Sync via Nextcloud/WebDAV and a read-only link for the band
- MIDI input in the macOS app (native plugin)
- Larger optional soundfont
- Song folder as library (e.g. iCloud)
- DAW plugin (VST3/CLAP)

## License

[MIT](LICENSE) © 2026 Benjamin Auer

Bundled third-party components keep their own licenses (see above).
