// MIDI input (Web MIDI): notes played within a short window form one beat, then the cursor moves on.
type Handler = (pitches: number[]) => void;

let access: MIDIAccess | null = null;
let onChord: Handler = () => {};
let held = new Set<number>();
let pending: number[] = [];
let timer = 0;

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

function onMessage(e: MIDIMessageEvent) {
  const d = e.data;
  if (!d || d.length < 3) return;
  const cmd = d[0] & 0xf0;
  const note = d[1];
  const vel = d[2];
  if (cmd === 0x90 && vel > 0) {
    held.add(note);
    pending.push(note);
    clearTimeout(timer);
    timer = window.setTimeout(flush, 60);
  } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
    held.delete(note);
  }
}

function flush() {
  if (!pending.length) return;
  const p = pending;
  pending = [];
  onChord(p);
}

/** start listening on all inputs; returns the input names (empty = none found) */
export async function startMidi(handler: Handler): Promise<string[]> {
  onChord = handler;
  if (!midiSupported()) throw new Error('Web MIDI wird hier nicht unterstützt');
  access = await navigator.requestMIDIAccess();
  const names: string[] = [];
  const hook = () => {
    names.length = 0;
    access!.inputs.forEach((inp) => {
      inp.onmidimessage = onMessage;
      names.push(inp.name ?? 'MIDI');
    });
  };
  hook();
  access.onstatechange = hook;
  return names;
}

export function stopMidi() {
  if (!access) return;
  access.inputs.forEach((inp) => (inp.onmidimessage = null));
  access.onstatechange = null;
  access = null;
  held = new Set();
  pending = [];
}
