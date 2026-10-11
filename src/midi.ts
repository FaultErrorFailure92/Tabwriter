// MIDI export (SMF type 1, one MIDI track per song track, with track names).
import * as alphaTab from '@coderline/alphatab';

export function exportMidi(score: alphaTab.model.Score, settings: alphaTab.Settings): Uint8Array {
  const mf = new alphaTab.midi.MidiFile();
  mf.format = alphaTab.midi.MidiFileFormat.MultiTrack;
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(mf, true);
  new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
  const bin = mf.toBinary();
  return addTrackNames(bin, score.tracks.map((t) => t.name || `Spur ${t.index + 1}`));
}

/** insert a "Track Name" meta event at the start of every MTrk chunk */
function addTrackNames(bin: Uint8Array, names: string[]): Uint8Array {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const headerLen = 8 + view.getUint32(4);
  const parts: Uint8Array[] = [bin.slice(0, headerLen)];
  let pos = headerLen;
  let idx = 0;
  const enc = new TextEncoder();
  while (pos + 8 <= bin.length) {
    const len = view.getUint32(pos + 4);
    const body = bin.slice(pos + 8, pos + 8 + len);
    const name = names[idx];
    if (name !== undefined) {
      const text = enc.encode(name).slice(0, 127);
      const meta = new Uint8Array([0x00, 0xff, 0x03, text.length, ...text]);
      const head = new Uint8Array(8);
      head.set([0x4d, 0x54, 0x72, 0x6b]);
      new DataView(head.buffer).setUint32(4, len + meta.length);
      parts.push(head, meta, body);
    } else {
      parts.push(bin.slice(pos, pos + 8 + len));
    }
    pos += 8 + len;
    idx++;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
