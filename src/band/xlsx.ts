// Minimal .xlsx reader: unzip (DecompressionStream) + shared strings + cell values.
// Returns cached values only (no formula evaluation) – enough to import our own sheets.

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** zip entries by name (central directory) */
async function unzip(buf: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no zip');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    out.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = buf.subarray(start, start + size);
      return method === 0 ? raw : inflate(raw);
    });
    p += 46 + nl + xl + cl;
  }
  return out;
}

const xml = (b: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml');
const tags = (n: Document | Element, tag: string) => Array.from(n.getElementsByTagNameNS('*', tag));

function colIndex(ref: string): number {
  let c = 0;
  for (const ch of ref.replace(/\d+$/, '')) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}

export async function readXlsx(buf: Uint8Array): Promise<Sheet[]> {
  const z = await unzip(buf);
  const get = async (p: string) => {
    const f = z.get(p);
    return f ? xml(await f()) : null;
  };
  const ss = await get('xl/sharedStrings.xml');
  const strings = ss ? tags(ss, 'si').map((si) => tags(si, 't').map((x) => x.textContent ?? '').join('')) : [];
  const wb = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('no workbook');
  const target = new Map(tags(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const sheets: Sheet[] = [];
  for (const s of tags(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target.get(rid) ?? '';
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path;
    const doc = await get(path);
    const rows: Cell[][] = [];
    if (doc) {
      for (const r of tags(doc, 'row')) {
        const ri = Number(r.getAttribute('r')) - 1;
        const row: Cell[] = (rows[ri] = []);
        for (const c of tags(r, 'c')) {
          const type = c.getAttribute('t');
          const v = tags(c, 'v')[0]?.textContent ?? null;
          let val: Cell = null;
          if (type === 's' && v != null) val = strings[Number(v)] ?? '';
          else if (type === 'inlineStr') val = tags(c, 't').map((x) => x.textContent ?? '').join('');
          else if (type === 'str' || type === 'b' || type === 'e') val = v;
          else if (v != null) val = Number(v);
          row[colIndex(c.getAttribute('r') ?? 'A')] = val;
        }
      }
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: s.getAttribute('name') ?? '', rows });
  }
  return sheets;
}

/** Excel date serial -> "YYYY-MM-DD" */
export function excelDate(v: Cell): string {
  if (typeof v === 'number' && v > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return '';
}
