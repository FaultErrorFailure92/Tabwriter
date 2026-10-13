// Song versions: snapshots with a comment, stored inside the .tabw file.
import { t } from './i18n';
import type { Arrangement } from './arrangement';

export interface Version {
  id: string;
  time: number;
  comment: string;
  score: string; // alphaTab JSON
  arr: Arrangement | null;
}

const strip = (o: unknown) => JSON.stringify(o, (k, v) => (k === 'id' ? undefined : v));

/** short, readable list of what changed from a to b */
export function diffScores(aJson: string, bJson: string): string[] {
  const a = JSON.parse(aJson);
  const b = JSON.parse(bJson);
  const out: string[] = [];
  if ((a.title ?? '') !== (b.title ?? '')) out.push(t('Titel: „{a}“ → „{b}“', { a: a.title ?? '', b: b.title ?? '' }));
  const ta = a.masterbars?.[0]?.tempoautomations?.[0]?.value;
  const tb = b.masterbars?.[0]?.tempoautomations?.[0]?.value;
  if (ta !== tb) out.push(t('Tempo: {a} → {b} bpm', { a: ta ?? '–', b: tb ?? '–' }));
  const na = a.masterbars.length;
  const nb = b.masterbars.length;
  if (na !== nb) out.push(t('Takte: {a} → {b}', { a: na, b: nb }));
  const secA = a.masterbars.map((m: any) => m.section?.text).filter(Boolean).join(' · ');
  const secB = b.masterbars.map((m: any) => m.section?.text).filter(Boolean).join(' · ');
  if (secA !== secB) out.push(t('Abschnitte: {b}', { b: secB || '–' }));
  const names = (o: any) => o.tracks.map((x: any) => x.name);
  const ra = names(a);
  const rb = names(b);
  for (const n of rb) if (!ra.includes(n)) out.push(t('Spur neu: {x}', { x: n }));
  for (const n of ra) if (!rb.includes(n)) out.push(t('Spur entfernt: {x}', { x: n }));
  for (const tr of b.tracks) {
    const old = a.tracks.find((x: any) => x.name === tr.name);
    if (!old) continue;
    const bars = (tr.staves[0]?.bars ?? []).map((x: any) => strip(x.voices));
    const obars = (old.staves[0]?.bars ?? []).map((x: any) => strip(x.voices));
    const kept = lcsKeep(obars, bars);
    const changed = bars.map((_: string, i: number) => i).filter((i: number) => !kept.has(i)).map((i: number) => i + 1);
    if (changed.length) out.push(t('{x}: Takte {b}', { x: tr.name, b: ranges(changed) }));
  }
  return out;
}

/** 1,2,3,5,7,8 -> "1–3, 5, 7–8" */
function ranges(n: number[]): string {
  const r: string[] = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    r.push(i === j ? `${n[i]}` : `${n[i]}–${n[j]}`);
    i = j;
  }
  return r.length > 8 ? r.slice(0, 8).join(', ') + ' …' : r.join(', ');
}

/** indices of b that are unchanged (longest common subsequence with a) */
function lcsKeep(a: string[], b: string[]): Set<number> {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keep.add(j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return keep;
}
