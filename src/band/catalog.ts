// Built-in catalog: instruments (with the matching Tabwriter track) and equipment
// categories with icons and common models. Works offline; "Bei Thomann suchen" opens the shop search.
import type { IconName } from '../icons';
import type { GearKind } from './model';

export type TrackKind = 'guitar' | 'bass' | 'drums' | 'synth';

export interface InstrumentPreset {
  id: string;
  label: string;
  icon: IconName;
  gear: GearKind;
  /** the Tabwriter track this instrument gets (GM program, tuning high -> low) */
  track: { kind: TrackKind; program: number; tuning: number[]; name: string };
  models: string[];
}

const STD6 = [64, 59, 55, 50, 45, 40];

export const INSTRUMENTS: InstrumentPreset[] = [
  { id: 'eg6', label: 'E-Gitarre', icon: 'guitar', gear: 'guitar', track: { kind: 'guitar', program: 30, tuning: STD6, name: 'Gitarre' }, models: ['Fender Stratocaster', 'Fender Telecaster', 'Gibson Les Paul', 'Gibson SG', 'PRS Custom 24', 'Ibanez RG', 'ESP LTD EC-1000', 'Schecter Hellraiser'] },
  { id: 'eg7', label: 'E-Gitarre (7 Saiten)', icon: 'guitar', gear: 'guitar', track: { kind: 'guitar', program: 30, tuning: [64, 59, 55, 50, 45, 40, 35], name: 'Gitarre 7' }, models: ['Ibanez RG7', 'Schecter C-7', 'ESP LTD H-7', 'Jackson Soloist 7'] },
  { id: 'ag', label: 'Akustikgitarre', icon: 'guitar', gear: 'guitar', track: { kind: 'guitar', program: 25, tuning: STD6, name: 'Akustik' }, models: ['Martin D-28', 'Taylor 314ce', 'Yamaha FG800', 'Gibson J-45'] },
  { id: 'cg', label: 'Konzertgitarre', icon: 'guitar', gear: 'guitar', track: { kind: 'guitar', program: 24, tuning: STD6, name: 'Nylon' }, models: ['Yamaha C40', 'Cordoba C5'] },
  { id: 'b4', label: 'E-Bass', icon: 'bass', gear: 'bass', track: { kind: 'bass', program: 33, tuning: [43, 38, 33, 28], name: 'Bass' }, models: ['Fender Precision Bass', 'Fender Jazz Bass', 'Music Man StingRay', 'Ibanez SR', 'Sandberg California'] },
  { id: 'b5', label: 'E-Bass (5 Saiten)', icon: 'bass', gear: 'bass', track: { kind: 'bass', program: 33, tuning: [43, 38, 33, 28, 23], name: 'Bass 5' }, models: ['Fender Jazz Bass V', 'Ibanez SR505', 'Music Man StingRay 5'] },
  { id: 'drums', label: 'Schlagzeug', icon: 'drum', gear: 'drums', track: { kind: 'drums', program: 0, tuning: [], name: 'Drums' }, models: ['Pearl Export', 'Tama Superstar', 'Sonor AQ2', 'Roland TD-17 (E-Drums)'] },
  { id: 'vocals', label: 'Gesang', icon: 'mic', gear: 'vocals', track: { kind: 'synth', program: 53, tuning: STD6, name: 'Gesang' }, models: ['Shure SM58', 'Shure Beta 58A', 'Sennheiser e935', 'Neumann KMS 105'] },
  { id: 'keys', label: 'Keyboard / Piano', icon: 'pianokeys', gear: 'keys', track: { kind: 'synth', program: 0, tuning: STD6, name: 'Piano' }, models: ['Nord Stage 4', 'Yamaha CP88', 'Roland RD-88', 'Korg SV-2'] },
  { id: 'synth', label: 'Synthesizer', icon: 'synth', gear: 'keys', track: { kind: 'synth', program: 81, tuning: STD6, name: 'Synth' }, models: ['Moog Subsequent 37', 'Korg Minilogue XD', 'Arturia MiniFreak', 'Nord Lead A1'] },
  { id: 'organ', label: 'Orgel', icon: 'pianokeys', gear: 'keys', track: { kind: 'synth', program: 17, tuning: STD6, name: 'Orgel' }, models: ['Hammond XK-5', 'Nord Electro 6'] },
];

export const instrumentOf = (id: string | undefined) => INSTRUMENTS.find((x) => x.id === id);

/** equipment categories (not instruments): icon + common models for the model field */
export const GEAR_CATALOG: { kind: GearKind; label: string; icon: IconName; models: string[] }[] = [
  { kind: 'effect', label: 'Effekte / Multi-FX', icon: 'pedal', models: ['Line 6 Helix LT', 'Line 6 HX Stomp', 'Fractal FM3', 'Neural DSP Quad Cortex', 'Kemper Player', 'Boss GT-1000', 'Pedalboard'] },
  { kind: 'amp', label: 'Amp / Box', icon: 'amp', models: ['Marshall JCM800', 'Fender Twin Reverb', 'Vox AC30', 'Orange Rockerverb', 'Mesa Boogie Dual Rectifier', 'Kemper Profiler', 'Ampeg SVT', 'Darkglass Microtubes 900', '4x12 Box', '2x12 Box', '8x10 Bass-Box'] },
  { kind: 'di', label: 'DI-Box', icon: 'box', models: ['Radial ProDI', 'Radial J48', 'BSS AR-133', 'Palmer PAN 01'] },
  { kind: 'mic', label: 'Mikrofon', icon: 'mic', models: ['Shure SM57', 'Shure SM58', 'Shure Beta 52A', 'Shure Beta 91A', 'Sennheiser e604', 'Sennheiser e906', 'Sennheiser MD 421', 'AKG C414'] },
  { kind: 'wireless', label: 'Funk', icon: 'radio', models: ['Shure GLXD16+', 'Line 6 Relay G10', 'Sennheiser EW-D', 'Shure BLX24'] },
  { kind: 'iem', label: 'In-Ear', icon: 'headphones', models: ['Shure PSM 300', 'Sennheiser EW IEM G4', 'Behringer P2', 'Shure SE215'] },
  { kind: 'monitor', label: 'Monitor / Wedge', icon: 'speaker', models: ['RCF NX 12-SMA', 'Yamaha DXR12', 'HK Audio PR:O 12'] },
  { kind: 'mixer', label: 'Mischpult', icon: 'sliders', models: ['Behringer X32', 'Behringer XR18', 'Midas M32', 'Allen & Heath QU-16', 'Soundcraft Ui24R'] },
  { kind: 'pa', label: 'PA', icon: 'speaker', models: ['RCF ART 745-A', 'Yamaha DXR15', 'JBL PRX915', 'HK Audio Linear 5'] },
  { kind: 'power', label: 'Strom', icon: 'plug', models: ['Mehrfachsteckdose', 'Kabeltrommel 25 m', 'Power-Conditioner'] },
  { kind: 'other', label: 'Sonstiges', icon: 'box', models: ['Ständer', 'Notenpult', 'Case'] },
];

export function gearIcon(kind: GearKind, preset?: string): IconName {
  const ins = instrumentOf(preset);
  if (ins) return ins.icon;
  return GEAR_CATALOG.find((x) => x.kind === kind)?.icon ?? INSTRUMENTS.find((x) => x.gear === kind)?.icon ?? 'box';
}

export function modelsFor(kind: GearKind, preset?: string): string[] {
  return instrumentOf(preset)?.models ?? GEAR_CATALOG.find((x) => x.kind === kind)?.models ?? INSTRUMENTS.filter((x) => x.gear === kind).flatMap((x) => x.models);
}

export const thomannSearch = (q: string) => `https://www.thomann.de/at/search_dir.html?sw=${encodeURIComponent(q)}`;

/** guess an instrument from a free role text ("Gitarre, Gesang") – for older band files */
export function guessInstruments(role: string): string[] {
  const r = role.toLowerCase();
  const out: string[] = [];
  if (/7.?sait|7.?string/.test(r)) out.push('eg7');
  else if (/akust|acoust|western/.test(r)) out.push('ag');
  else if (/git|guit/.test(r)) out.push('eg6');
  if (/5.?sait|5.?string/.test(r) && /bass/.test(r)) out.push('b5');
  else if (/bass/.test(r)) out.push('b4');
  if (/drum|schlag/.test(r)) out.push('drums');
  if (/key|piano|klavier/.test(r)) out.push('keys');
  if (/synth/.test(r)) out.push('synth');
  if (/orgel|organ/.test(r)) out.push('organ');
  if (/gesang|vocal|voc|voice|sing/.test(r)) out.push('vocals');
  return out;
}
