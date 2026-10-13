// Small SF-Symbols-like icon set (16×16, stroke = currentColor).
const S = (body: string, size = 16) =>
  `<svg class="ic" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  play: '<path d="M5 3.2v9.6c0 .5.5.8.9.5l7.3-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" stroke="none"/><rect x="9.4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" stroke="none"/>',
  stop: '<rect x="3.8" y="3.8" width="8.4" height="8.4" rx="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  xmark: '<path d="M4 4l8 8M12 4l-8 8"/>',
  sidebarLeft: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M6 2.8v10.4"/><path d="M3.4 5.3h1.2M3.4 7.3h1.2" stroke-width="1.1"/>',
  sidebarRight: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M10 2.8v10.4"/><path d="M11.4 5.3h1.2M11.4 7.3h1.2" stroke-width="1.1"/>',
  oneTrack: '<rect x="2.5" y="4.5" width="11" height="7" rx="1.6"/>',
  allTracks: '<rect x="2.5" y="2.2" width="11" height="3.4" rx="1.1"/><rect x="2.5" y="6.3" width="11" height="3.4" rx="1.1"/><rect x="2.5" y="10.4" width="11" height="3.4" rx="1.1"/>',
  ellipsis: '<circle cx="8" cy="8" r="6.2"/><circle cx="5.3" cy="8" r=".75" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".75" fill="currentColor" stroke="none"/><circle cx="10.7" cy="8" r=".75" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  folder: '<path d="M1.8 4.6c0-.9.7-1.6 1.6-1.6h2.8l1.4 1.5h5c.9 0 1.6.7 1.6 1.6v5.6c0 .9-.7 1.6-1.6 1.6H3.4c-.9 0-1.6-.7-1.6-1.6z"/>',
  docPlus: '<path d="M9.2 1.8H4.6c-.8 0-1.4.6-1.4 1.4v9.6c0 .8.6 1.4 1.4 1.4h6.8c.8 0 1.4-.6 1.4-1.4V5.4z"/><path d="M9.2 1.8v3.6h3.6M8 7.4v4M6 9.4h4"/>',
  doc: '<path d="M9.2 1.8H4.6c-.8 0-1.4.6-1.4 1.4v9.6c0 .8.6 1.4 1.4 1.4h6.8c.8 0 1.4-.6 1.4-1.4V5.4z"/><path d="M9.2 1.8v3.6h3.6"/>',
  save: '<path d="M8 2v7.4M5.2 6.8 8 9.6l2.8-2.8"/><path d="M2.8 10.6v1.6c0 .9.7 1.6 1.6 1.6h7.2c.9 0 1.6-.7 1.6-1.6v-1.6"/>',
  share: '<path d="M8 1.8v8M5.3 4.4 8 1.8l2.7 2.6"/><path d="M5.4 6.6H4.2c-.8 0-1.4.6-1.4 1.4v4.8c0 .8.6 1.4 1.4 1.4h7.6c.8 0 1.4-.6 1.4-1.4V8c0-.8-.6-1.4-1.4-1.4h-1.2"/>',
  printer: '<path d="M4.4 5.6V2.4h7.2v3.2"/><rect x="1.8" y="5.6" width="12.4" height="5.6" rx="1.4"/><path d="M4.4 9.4h7.2v4.2H4.4z"/>',
  waveform: '<path d="M2 8h.01M4.3 5.8v4.4M6.6 3.4v9.2M8.9 5v6M11.2 6.4v3.2M13.5 7.4v1.2"/>',
  pianokeys: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M5.9 2.8v10.4M10.1 2.8v10.4"/><path d="M4.3 2.8v5.4h3.2V2.8M8.5 2.8v5.4h3.2V2.8" fill="currentColor" stroke="none" opacity=".85"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".7" fill="currentColor" stroke="none"/>',
  textInfo: '<path d="M3 3.5h10M3 6.5h10M3 9.5h6.5M3 12.5h4.5"/>',
  keyboard: '<rect x="1.6" y="3.8" width="12.8" height="8.4" rx="1.6"/><path d="M4 6.4h.01M6.7 6.4h.01M9.3 6.4h.01M12 6.4h.01M4 8.6h.01M12 8.6h.01M5.6 10.2h4.8" stroke-width="1.6"/>',
  sparkles: '<path d="M7 2.2l1.1 3 3 1.1-3 1.1L7 10.4 5.9 7.4l-3-1.1 3-1.1zM12 9.6l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  music: '<path d="M6 12.2V3.6l7-1.6v8.4"/><circle cx="4.4" cy="12.2" r="1.7"/><circle cx="11.4" cy="10.4" r="1.7"/>',
  books: '<rect x="2.2" y="2.6" width="3" height="10.8" rx=".8"/><rect x="6.2" y="2.6" width="3" height="10.8" rx=".8"/><path d="m10.6 3.6 2.8-.8 2 10.2-2.8.8z" transform="translate(-1.1 .2)"/>',
  trash: '<path d="M2.8 4.4h10.4M6.2 4.4V2.8h3.6v1.6M4.2 4.4l.6 8.4c0 .6.5 1 1 1h4.4c.5 0 1-.4 1-1l.6-8.4M6.6 7v4.4M9.4 7v4.4"/>',
  eye: '<path d="M1.4 8s2.4-4.6 6.6-4.6S14.6 8 14.6 8s-2.4 4.6-6.6 4.6S1.4 8 1.4 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeSlash: '<path d="M1.4 8s2.4-4.6 6.6-4.6S14.6 8 14.6 8s-2.4 4.6-6.6 4.6S1.4 8 1.4 8z" opacity=".45"/><path d="M2.5 2.5l11 11"/>',
  tuningFork: '<path d="M5 1.8v5.4a3 3 0 0 0 6 0V1.8M8 10.2v4"/>',
  speaker: '<path d="M2.6 6.2h2.2l3.2-2.8v9.2L4.8 9.8H2.6z"/><path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.8a6 6 0 0 1 0 8.4"/>',
  speakerSlash: '<path d="M2.6 6.2h2.2l3.2-2.8v9.2L4.8 9.8H2.6z"/><path d="M10.6 6.2l3.6 3.6M14.2 6.2l-3.6 3.6"/>',
  headphones: '<path d="M2.6 10.4V8a5.4 5.4 0 0 1 10.8 0v2.4"/><rect x="2" y="9.4" width="2.8" height="4" rx="1"/><rect x="11.2" y="9.4" width="2.8" height="4" rx="1"/>',
  guitar: '<path d="M10.6 5.4l3-3M12.2 2.2l1.6 1.6"/><path d="M10.6 5.4 8.3 7.7"/><path d="M8.3 7.7c-.5-1-1.9-1.4-3-.8-.6.3-.8.9-1.6 1.1-.9.2-1.7.6-2 1.5-.6 1.7 1.2 4 3.3 4.4 1.3.2 2.2-.4 2.5-1.3.3-.8.6-1.1 1.2-1.5.9-.6 1-2.2-.4-3.4z"/><circle cx="5.6" cy="10.2" r=".9"/>',
  bass: '<path d="M11.4 4.6l2.4-2.4M12.6 1.6l1.8 1.8"/><path d="M11.4 4.6 8.6 7.4"/><path d="M8.6 7.4c-.6-.7-1.7-.9-2.5-.4-.4.3-.5.8-1.3 1-1.1.2-2.1.9-2.4 2-.4 1.6 1.4 3.6 3.2 3.8 1.2.1 1.9-.5 2.1-1.3.2-.8.5-1.1 1.1-1.5.9-.6 1-2.4-.2-3.6z"/><path d="M6.2 10.6l-1.4-1.4"/>',
  drum: '<ellipse cx="8" cy="6" rx="5.6" ry="2.2"/><path d="M2.4 6v4.4c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2V6"/><path d="M5 1.8l2 3M11 1.8 9 4.8"/>',
  synth: '<rect x="1.8" y="4" width="12.4" height="8.6" rx="1.6"/><path d="M4.4 4v4.4M7 4v4.4M9.6 4v4.4M12 4v4.4" stroke-width="1.6"/><path d="M1.8 8.4h12.4"/>',
  chevronDown: '<path d="M4.6 6.4 8 9.8l3.4-3.4"/>',
  chevronLeft: '<path d="M9.8 4.2 6 8l3.8 3.8"/>',
  chevronRight: '<path d="M6.2 4.2 10 8l-3.8 3.8"/>',
  pencil: '<path d="M10.8 2.6l2.6 2.6L6 12.6l-3.2.6.6-3.2z"/>',
  restore: '<path d="M3.4 8a4.6 4.6 0 1 0 1.4-3.3"/><path d="M2.8 2.6v2.6h2.6"/><path d="M8 5.6V8l1.8 1.2"/>',
  question: '<circle cx="8" cy="8" r="6.2"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.5-1.8 2.6"/><circle cx="8" cy="11.4" r=".7" fill="currentColor" stroke="none"/>',
  bookmark: '<path d="M4.2 2.4h7.6v11.2L8 10.8l-3.8 2.8z"/>',
  loop: '<path d="M3 7.2V6.6A2.6 2.6 0 0 1 5.6 4h7.2M10.8 2l2 2-2 2"/><path d="M13 8.8v.6A2.6 2.6 0 0 1 10.4 12H3.2M5.2 14l-2-2 2-2"/>',
  speed: '<path d="M2.6 11.4a5.6 5.6 0 1 1 10.8 0"/><path d="M8 9.6l2.6-3.2"/><circle cx="8" cy="9.8" r=".9" fill="currentColor" stroke="none"/>',
  transpose: '<path d="M5 13V3M2.6 5.4 5 3l2.4 2.4M11 3v10M8.6 10.6 11 13l2.4-2.4"/>',
  barIcon: '<rect x="2.2" y="3" width="11.6" height="10" rx="1.6"/><path d="M8 3v10M2.2 6.3h11.6M2.2 9.7h11.6" stroke-width="1"/>',
  repeat: '<path d="M4 3v10M6 3v10" /><circle cx="9" cy="6.4" r=".8" fill="currentColor" stroke="none"/><circle cx="9" cy="9.6" r=".8" fill="currentColor" stroke="none"/>',
  select: '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6" stroke-dasharray="2 1.6"/>',
  link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.2 9.1a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>',
  unlink: '<path d="M10.2 8.6l2.6-2.6a2.6 2.6 0 0 0-3.7-3.7L8.3 3.1M5.8 7.4 3.2 10a2.6 2.6 0 0 0 3.7 3.7l.8-.8M2.4 2.4l11.2 11.2"/>',
  comment: '<path d="M2.6 4c0-.8.6-1.4 1.4-1.4h8c.8 0 1.4.6 1.4 1.4v5.6c0 .8-.6 1.4-1.4 1.4H7.2L4.4 13.4V11H4c-.8 0-1.4-.6-1.4-1.4z"/>',
  blocks: '<rect x="1.8" y="4.6" width="3.6" height="6.8" rx="1"/><rect x="6.2" y="4.6" width="3.6" height="6.8" rx="1"/><rect x="10.6" y="4.6" width="3.6" height="6.8" rx="1"/>',
  duplicate: '<rect x="5" y="5" width="8.4" height="8.4" rx="1.6"/><path d="M3.4 10.6h-.2c-.8 0-1.4-.6-1.4-1.4V3.2c0-.8.6-1.4 1.4-1.4h6c.8 0 1.4.6 1.4 1.4v.2"/>',
  arrowLeft: '<path d="M13 8H3.4M7.2 4.2 3.4 8l3.8 3.8"/>',
  arrowRight: '<path d="M3 8h9.6M8.8 4.2 12.6 8l-3.8 3.8"/>',
  chevronUp: '<path d="M4.6 9.6 8 6.2l3.4 3.4"/>',
  calendar: '<rect x="2" y="3.2" width="12" height="10.6" rx="1.8"/><path d="M2 6.6h12M5.2 1.8v2.6M10.8 1.8v2.6"/>',
  list: '<path d="M6 4.2h8M6 8h8M6 11.8h8"/><circle cx="2.8" cy="4.2" r=".8" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="2.8" cy="11.8" r=".8" fill="currentColor" stroke="none"/>',
  people: '<circle cx="6" cy="5.4" r="2.3"/><path d="M1.8 13.4c.3-2.4 2-3.8 4.2-3.8s3.9 1.4 4.2 3.8"/><circle cx="11.3" cy="5.9" r="1.8"/><path d="M11 9.6c1.9 0 3 1.2 3.3 3.4"/>',
  leadSheet: '<rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.6"/><path d="M5 5h2.4M9.4 5H11M5 7.4h6M5 10h2.4M9.4 10H11M5 12.2h6" stroke-width="1.1"/>',
  stagePlan: '<rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.4"/><circle cx="5.4" cy="6.4" r="1.2"/><circle cx="10.6" cy="6.4" r="1.2"/><path d="M4 13.6h8"/>',
  checkmark: '<path d="M3.4 8.4 6.6 11.4 12.6 4.6"/>',
  house: '<path d="M2.4 7.6 8 2.8l5.6 4.8"/><path d="M3.8 6.6v6.6h3V9.8h2.4v3.4h3V6.6"/>',
  mic: '<rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2"/><path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2"/>',
  metronome: '<path d="M5.4 2.4h5.2l2.4 11.2H3z"/><path d="M8 11 11.6 4.2M5.6 11h4.8"/>',
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): string {
  return S(ICONS[name], size);
}

/** replace <i data-icon="name"></i> placeholders in static markup */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const n = el.dataset.icon as IconName;
    if (ICONS[n]) el.innerHTML = icon(n, Number(el.dataset.size) || 16);
  });
}
