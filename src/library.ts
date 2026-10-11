// Recently edited songs: metadata in localStorage, file bytes cached in IndexedDB.
import { t as tr, currentLang } from './i18n';

export interface RecentEntry {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  path?: string; // real file path (Tauri)
  time: number;
  tracks: string[];
}

const KEY = 'tabwriter.recent';
const MAX = 40;

export function listRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    return list.sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

function writeList(list: RecentEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked */
  }
}

export async function addRecent(e: Omit<RecentEntry, 'id' | 'time'>, bytes: Uint8Array): Promise<RecentEntry> {
  const list = listRecent();
  const id = e.path ? `p:${e.path}` : `n:${e.fileName}`;
  const entry: RecentEntry = { ...e, id, time: Date.now() };
  const rest = list.filter((x) => x.id !== id);
  writeList([entry, ...rest]);
  // drop cache of entries that fell off the list
  for (const old of rest.slice(MAX - 1)) void dbDelete(old.id);
  await dbPut(id, bytes);
  return entry;
}

export async function removeRecent(id: string) {
  writeList(listRecent().filter((x) => x.id !== id));
  await dbDelete(id);
}

export async function cachedBytes(id: string): Promise<Uint8Array | null> {
  return dbGet(id);
}

// ---------- tiny IndexedDB wrapper ----------
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tabwriter', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(id: string, bytes: unknown) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put(bytes, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function dbGet<T = Uint8Array>(id: string): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const req = d.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => res((req.result as T) ?? null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export async function dbDelete(id: string) {
  try {
    const d = await db();
    d.transaction('files', 'readwrite').objectStore('files').delete(id);
  } catch {
    /* ignore */
  }
}

export function relTime(t: number): string {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return tr('gerade eben');
  if (d < 3600) return tr('vor {n} min', { n: Math.floor(d / 60) });
  if (d < 86400) return tr('vor {n} h', { n: Math.floor(d / 3600) });
  if (d < 86400 * 7) {
    const days = Math.floor(d / 86400);
    return days === 1 ? tr('gestern') : tr('vor {n} Tagen', { n: days });
  }
  return new Date(t).toLocaleDateString(currentLang() === 'de' ? 'de-AT' : 'en-GB');
}
