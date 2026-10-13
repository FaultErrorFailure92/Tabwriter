// File open/save. Browser implementation; Tauri version is plugged in via window.__TAURI__.

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  handle?: unknown;
}

type TauriApi = {
  dialog: {
    open(o: unknown): Promise<string | null>;
    save(o: unknown): Promise<string | null>;
  };
  fs: {
    readFile(p: string): Promise<Uint8Array>;
    writeFile(p: string, d: Uint8Array): Promise<void>;
  };
};

function tauri(): TauriApi | null {
  return ((window as any).__TAURI__ as TauriApi) ?? null;
}

const FILTERS = [{ name: 'Songs', extensions: ['tabw', 'gp5', 'gp4', 'gp3', 'gp', 'gpx', 'xml', 'musicxml'] }];

export async function pickFile(input: HTMLInputElement): Promise<OpenedFile | null> {
  const t = tauri();
  if (t) {
    const path = await t.dialog.open({ multiple: false, filters: FILTERS });
    if (!path) return null;
    const bytes = await t.fs.readFile(path);
    return { name: path.split(/[\\/]/).pop() ?? path, bytes, handle: path };
  }
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

export async function readDropped(f: File): Promise<OpenedFile> {
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export interface FileType {
  desc: string;
  ext: string;
  mime: string;
}
export const GP7: FileType = { desc: 'Guitar Pro 7', ext: 'gp', mime: 'application/octet-stream' };
export const MIDI: FileType = { desc: 'MIDI', ext: 'mid', mime: 'audio/midi' };
export const GP5: FileType = { desc: 'Guitar Pro 5', ext: 'gp5', mime: 'application/octet-stream' };
export const TABW: FileType = { desc: 'Tabwriter', ext: 'tabw', mime: 'application/json' };
export const WAV: FileType = { desc: 'WAV Audio', ext: 'wav', mime: 'audio/wav' };

export interface SaveResult {
  handle: unknown; // path (Tauri) or FileSystemFileHandle (Chrome) for later silent saves
  path?: string;
  name: string;
}

export function isTauri() {
  return !!tauri();
}

export async function readPath(path: string): Promise<Uint8Array> {
  const t = tauri();
  if (!t) throw new Error('Nur in der App verfügbar');
  return t.fs.readFile(path);
}

/** Saves bytes. Returns null when the user cancelled. */
export async function saveFile(name: string, bytes: Uint8Array, handle?: unknown, type: FileType = GP7): Promise<SaveResult | null> {
  const t = tauri();
  if (t) {
    let path = typeof handle === 'string' ? handle : null;
    if (!path) {
      path = await t.dialog.save({ defaultPath: name, filters: [{ name: type.desc, extensions: [type.ext] }] });
      if (!path) return null;
    }
    await t.fs.writeFile(path, bytes);
    return { handle: path, path, name: path.split(/[\\/]/).pop() ?? name };
  }
  const w = window as any;
  if (w.showSaveFilePicker) {
    try {
      const h = handle ?? (await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: type.desc, accept: { [type.mime]: ['.' + type.ext] } }],
      }));
      const ws = await h.createWritable();
      await ws.write(bytes);
      await ws.close();
      return { handle: h, name: h.name ?? name };
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: type.mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { handle: null, name };
}
