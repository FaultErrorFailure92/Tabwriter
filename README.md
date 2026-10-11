# Tabwriter

A modern, minimal tab editor in the spirit of Guitar Pro 5. Write tabs and notation with the keyboard, play them back, and open and save `.gp5` files.

Runs as a native macOS app (Tauri) and as a web app (works offline, installable as a PWA). The web app also runs on Windows and Linux.

## Features

- **Keyboard entry like GP5:** frets, note values, rests, dots, triplets, and effects (hammer-on, slide, bend, palm mute, …). Drums are entered on lanes.
- **Multiple tracks:** guitar, bass, drums, and synth (General MIDI). Solo/mute, volume, pan, and tunings (presets or custom).
- **Playback:** loop, metronome, count-in, and speed control (%).
- **Editing:** selection, copy/cut/paste (beats and whole bars), undo/redo, transpose, and automatic bar reflow.
- **Structure:** repeats, alternate endings, Segno/Coda/Fine, D.C./D.S., and sections with a jump list.
- **Overview panel:** a tracks × bars grid like Guitar Pro (⌘B). Click a cell to jump there, and the panel height can be resized.
- **Files:**
  - Open: GP3/4/5, GP (7), GPX, and MusicXML.
  - Save: `.gp5`.
  - Export: `.gp`, MIDI, WAV, and PDF/print.
- **Library:** recent songs, autosave with recovery, and song info.
- **UI:** a clean macOS look with light/dark mode, zoom, German and English, and onboarding with a demo song.

## Quick start

Requirements: Node.js 22+. For the desktop app you also need Rust 1.90+ (`rustup update stable`).

```bash
npm install
npm run dev            # web app at http://localhost:1420
npm run tauri dev      # macOS app (development)
npm run tauri build    # .app / .dmg
npm run build          # web build into dist/
```

## Keyboard basics

| Key | Action |
|---|---|
| `0`–`9` | Enter fret |
| `←` `→` / `↑` `↓` | Previous/next beat / string |
| `+` / `−` | Longer / shorter note value |
| `Space` | Play / pause |
| `⌘B` | Overview |
| `⌘E` | All tracks / single track |
| `⌘L` / `⌘K` | Loop / metronome |
| `?` | All shortcuts |

On Windows and Linux, use `Ctrl` instead of `⌘`.

## Deployment

**Web (GitHub Pages):** push to `main`. The workflow in `.github/workflows/web.yml` builds the app and deploys it. One-time setup: in the repo, go to *Settings → Pages → Source* and choose **GitHub Actions**. Netlify and Cloudflare Pages work too (see `netlify.toml` and `public/_headers`).

**macOS release:** push a tag (`git tag v1.0.0 && git push --tags`). `.github/workflows/release.yml` builds a signed and notarized app and publishes it as a GitHub release, including the update feed. Before your first release:
- Add your Apple certificate and notarization credentials as repository secrets.
- Run `npx tauri signer generate` and put the public key in `src-tauri/tauri.conf.json`.
- Replace `REPLACE_OWNER/REPLACE_REPO` with your repository.

## Project structure

```
src/
  main.ts         UI, keyboard, inspector, library, dialogs, playback
  editor.ts       cursor, input, effects, selection/clipboard, bar operations
  model.ts        score/track creation, presets, drum lanes
  overview.ts     tracks × bars overview
  gp5writer.ts    GP5 (v5.00) writer
  midi.ts, wav.ts, print.ts   exports
  library.ts      recent files + autosave (IndexedDB)
  tauri.ts        native menu, file associations, updater
  i18n*.ts        German (keys) / English
src-tauri/        Tauri 2 shell (Rust)
public/           fonts, soundfont, icons, licenses
```

## Built with

- [alphaTab](https://alphatab.net): notation rendering, playback, and file import (MPL-2.0)
- [Tauri 2](https://tauri.app) and [Vite](https://vite.dev) + TypeScript
- Bravura music font (SIL OFL) and the Sonivox GM soundfont (Apache 2.0)

Third-party license texts are in `public/licenses/`.

## Roadmap

- Second voice editing
- Chord names and lyrics
- Fretboard view with click input
- Song folder as library (e.g. iCloud)
- MIDI input
- Larger optional soundfont
- Arrangement view (sections as reusable blocks)
- DAW plugin (VST3/CLAP)

## License

[MIT](LICENSE) © 2026 Benjamin Auer

Bundled third-party components keep their own licenses (see above).
