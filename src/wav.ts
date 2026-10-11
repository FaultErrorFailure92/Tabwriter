// Render the song to a 16-bit stereo WAV file using alphaTab's offline synthesizer.
import * as alphaTab from '@coderline/alphatab';

export async function renderWav(
  api: alphaTab.AlphaTabApi,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<Uint8Array | null> {
  const opts = new alphaTab.synth.AudioExportOptions();
  opts.sampleRate = 44100;
  opts.masterVolume = 1;
  opts.metronomeVolume = 0;
  const exporter = await api.exportAudio(opts);
  const chunks: Float32Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (isCancelled()) return null;
      const chunk = await exporter.render(1000);
      if (!chunk) break;
      chunks.push(chunk.samples.slice());
      total += chunk.samples.length;
      onProgress(chunk.endTime > 0 ? Math.min(1, chunk.currentTime / chunk.endTime) : 0);
    }
  } finally {
    exporter.destroy();
  }
  return encodeWav(chunks, total, opts.sampleRate);
}

function encodeWav(chunks: Float32Array[], sampleCount: number, sampleRate: number): Uint8Array {
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPerSample, true);
  v.setUint16(32, channels * bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
