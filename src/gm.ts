// General MIDI program names (0-based), grouped.
export const GM_GROUPS: { name: string; programs: string[] }[] = [
  { name: 'Piano', programs: ['Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet'] },
  { name: 'Chromatic Percussion', programs: ['Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer'] },
  { name: 'Orgel', programs: ['Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion'] },
  { name: 'Gitarre', programs: ['Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics'] },
  { name: 'Bass', programs: ['Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2'] },
  { name: 'Streicher', programs: ['Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani'] },
  { name: 'Ensemble', programs: ['String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit'] },
  { name: 'Blech', programs: ['Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2'] },
  { name: 'Rohrblatt', programs: ['Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet'] },
  { name: 'Flöte', programs: ['Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina'] },
  { name: 'Synth Lead', programs: ['Lead Square', 'Lead Sawtooth', 'Lead Calliope', 'Lead Chiff', 'Lead Charang', 'Lead Voice', 'Lead Fifths', 'Lead Bass + Lead'] },
  { name: 'Synth Pad', programs: ['Pad New Age', 'Pad Warm', 'Pad Polysynth', 'Pad Choir', 'Pad Bowed', 'Pad Metallic', 'Pad Halo', 'Pad Sweep'] },
  { name: 'Synth FX', programs: ['FX Rain', 'FX Soundtrack', 'FX Crystal', 'FX Atmosphere', 'FX Brightness', 'FX Goblins', 'FX Echoes', 'FX Sci-fi'] },
  { name: 'Ethnisch', programs: ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai'] },
  { name: 'Percussiv', programs: ['Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal'] },
  { name: 'Effekte', programs: ['Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'] },
];

export function gmName(program: number): string {
  const g = GM_GROUPS[Math.floor(program / 8)];
  return g ? g.programs[program % 8] : `Programm ${program}`;
}
