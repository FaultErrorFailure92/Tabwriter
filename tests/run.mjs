// Smoke tests: start the dev server, open the app in Chromium and check the main features.
// Run: npm test   (first time: npx playwright install chromium)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const server = await createServer({ server: { port: 5179, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-AT' });
await ctx.addInitScript(() => {
  localStorage.setItem('tabwriter.prefs', JSON.stringify({ onboarded: true, lang: 'de' }));
  indexedDB.deleteDatabase('tabwriter'); // every test starts empty
  window.print = () => (window.__printed = (window.__printed || 0) + 1);
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
page.on('dialog', (d) => d.accept());

let failed = 0;
async function test(name, fn) {
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.app);
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
};
const demo = async () => {
  await page.evaluate(() => window.app.run('demo'));
  await page.waitForTimeout(800);
};

console.log('Stagecraft / Tabwriter smoke tests');

await test('GP5 roundtrip with chords, lyrics, two voices', async () => {
  await demo();
  const r = await page.evaluate(async () => {
    const e = window.app.editor;
    e.cursor = { track: 0, bar: 0, beat: 0, row: 0 };
    e.setChord('E5');
    e.setLyric('Hal-');
    e.setVoice(1);
    e.cursor.beat = 0;
    e.setFret(3);
    e.setVoice(0);
    const { writeGp5 } = await import('/src/gp5writer.ts');
    const C = await import('/src/chords.ts');
    window.app.loadBytes('t.gp5', writeGp5(e.score));
    const b = window.app.editor.score.tracks[0].staves[0].bars[0];
    return [C.chordOf(b.voices[0].beats[0]), C.lyricOf(b.voices[0].beats[0]), b.voices[1]?.beats[0]?.notes.length ?? 0];
  });
  eq(r, ['E5', 'Hal-', 1], 'chord, lyric, voice 2');
});

await test('Arrangement: linked copies follow edits, .tabw keeps them', async () => {
  await demo();
  const r = await page.evaluate(async () => {
    const A = await import('/src/arrangement.ts');
    const M = await import('/src/model.ts');
    const e = window.app.editor;
    e.enableArrangement(true);
    e.setSection('Refrain', 2);
    e.arrOp((o, a) => A.duplicate(o, a, 1, 1, true));
    e.cursor = { track: 0, bar: 4, beat: 0, row: 0 };
    e.typeDigit(9);
    const f = (i) => window.app.editor.score.tracks[0].staves[0].bars[i].voices[0].beats[0].notes.map((n) => n.fret).join();
    const linked = f(2) === f(4);
    const d = { app: 'tabwriter', version: 1, score: JSON.parse(M.snapshot(e.score)), arrangement: e.arr };
    window.app.loadBytes('t.tabw', new TextEncoder().encode(JSON.stringify(d)));
    return [linked, window.app.editor.arr.blocks.length];
  });
  eq(r, [true, 3], 'linked, blocks after reload');
});

await test('Arrangement: a track can play another part (both ways)', async () => {
  await demo();
  const r = await page.evaluate(async () => {
    const A = await import('/src/arrangement.ts');
    const e = window.app.editor;
    e.enableArrangement(true);
    e.setSection('B', 2);
    const partA = e.arr.blocks[0].part;
    e.arrOp((o, a) => A.setTrackFrom(o, a, 1, 0, partA));
    const f = (bar) => window.app.editor.score.tracks[0].staves[0].bars[bar].voices[0].beats.map((b) => b.notes.map((n) => n.fret).join('.')).join(' ');
    const copied = f(2) === f(0);
    e.cursor = { track: 0, bar: 2, beat: 0, row: 0 };
    e.typeDigit(9);
    const back = f(0) === f(2) && f(0).includes('9');
    const bass = window.app.editor.score.tracks[1].staves[0].bars;
    return [copied, back, JSON.stringify(bass[2].voices[0].beats.length) !== undefined];
  });
  eq(r, [true, true, true], 'copied, edit flows back');
});

await test('Undo / redo keeps arrangement in sync', async () => {
  await demo();
  const r = await page.evaluate(() => {
    const e = window.app.editor;
    e.enableArrangement(true);
    const n = e.score.masterBars.length;
    e.insertBar();
    const grown = e.arr.blocks.reduce((a, b) => a + b.len, 0) === n + 1;
    e.undo();
    return [grown, e.arr.blocks.reduce((a, b) => a + b.len, 0) === n];
  });
  eq(r, [true, true], 'block length after insert / undo');
});

await test('Versions: diff lists changed bars', async () => {
  await demo();
  const r = await page.evaluate(async () => {
    const V = await import('/src/versions.ts');
    const M = await import('/src/model.ts');
    const e = window.app.editor;
    const before = M.snapshot(e.score);
    e.cursor = { track: 0, bar: 2, beat: 0, row: 0 };
    e.typeDigit(9);
    return V.diffScores(before, M.snapshot(e.score)).join(' | ');
  });
  if (!/Takte 3/.test(r)) throw new Error(r);
});

await test('Reaper export: zip with tempo/marker MIDI, tracks and click', async () => {
  await demo();
  const r = await page.evaluate(async () => {
    const R = await import('/src/reaper.ts');
    window.app.editor.setSection('Intro', 0);
    const z = R.reaperZip(window.app.editor.score, window.app.api.settings, 'Demo');
    const txt = new TextDecoder('latin1').decode(z);
    return ['Tempo & Marker.mid', 'Click.wav', '01 '].map((s) => txt.includes(s)).concat(txt.includes('Intro'));
  });
  eq(r, [true, true, true, true], 'zip contents');
});

await test('Band: members, songs, setlist duration, gig settlement', async () => {
  const r = await page.evaluate(async () => {
    const M = await import('/src/band/model.ts');
    const b = M.newBand('Test');
    const m1 = M.newMember();
    const m2 = M.newMember();
    b.members.push(m1, m2);
    const s1 = M.newSong('A');
    s1.duration = 200;
    const s2 = M.newSong('B');
    s2.duration = 100;
    b.songs.push(s1, s2);
    const l = M.newSetlist('Set');
    l.items.push({ id: 'i1', type: 'song', song: s1.id, note: '' }, { id: 'i2', type: 'break', label: 'Pause', duration: 60 }, { id: 'i3', type: 'song', song: s2.id, note: '' });
    b.setlists.push(l);
    const g = M.newGig('2030-01-01');
    g.lineup = [m1.id, m2.id];
    g.money.fee = 500;
    g.money.costs.push({ id: 'c', label: 'Sprit', amount: 100, paidBy: m1.id });
    const s = M.settle(b, g);
    return [M.fmtDur(M.setlistDuration(b, l)), s.net, s.payout.map((p) => p.amount)];
  });
  eq(r, ['6:00', 400, [300, 200]], 'duration, net, payout');
});

await test('Tickets: moves, buyers, tiers and totals', async () => {
  const r = await page.evaluate(async () => {
    const M = await import('/src/band/model.ts');
    const t = M.newTickets();
    t.tiers = [{ from: 0, share: 3 }, { from: 50, share: 5 }];
    t.moves.push(M.newMove('venue', 'band', 100), M.newMove('band', 'm1', 20));
    const b1 = M.newBuyer('m1');
    b1.normal = 3;
    b1.held = 1;
    b1.paid = true;
    const b2 = M.newBuyer('band');
    b2.normal = 50;
    b2.cash = true;
    b2.paid = true;
    t.buyers.push(b1, b2);
    const s = M.ticketStats(t, 'm1');
    const tot = M.ticketTotals(t);
    return [s.received, s.sold, s.available, s.money, M.bandShare(t.tiers, 60), tot.sold, tot.money];
  });
  eq(r, [20, 4, 20, 60, 200, 54, 810], 'stats, share, totals');
});

await test('Tickets: import of the old Excel presale workbook', async () => {
  const bytes = [...readFileSync(new URL('./fixtures/karten-vvk.xlsx', import.meta.url))];
  const r = await page.evaluate(async (bytes) => {
    const X = await import('/src/band/xlsx.ts');
    const I = await import('/src/band/ticketsImport.ts');
    const M = await import('/src/band/model.ts');
    const b = M.newBand('T');
    const anna = M.newMember();
    anna.name = 'Anna';
    b.members.push(anna);
    const g = M.newGig('2030-01-01');
    const res = I.importTicketWorkbook(await X.readXlsx(new Uint8Array(bytes)), b, g);
    const a = M.ticketStats(g.tickets, anna.id);
    const tot = M.ticketTotals(g.tickets);
    return [res.members, res.buyers, res.skipped, g.title, g.date, g.tickets.presale, a.received, a.sold, a.handed, a.paid, a.cash, tot.contingent, tot.doorList, tot.share];
  }, bytes);
  eq(r, [['Ben'], 3, 1, 'Testfest', '2030-05-01', 12, 10, 3, 2, 36, 24, 40, 1, 8], 'import');
});

/** set up a band through the wizard on the start screen */
async function bandWizard(name, members) {
  await page.waitForSelector('.flowSetup');
  await page.click('.flowSetup');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  for (let i = 0; i < members.length; i++) {
    if (i) await page.click('.wizBody .btn.plain');
    const row = (await page.$$('.wizRow'))[i];
    await (await row.$('input')).fill(members[i][0]);
    await (await row.$('select')).selectOption(members[i][1]);
  }
  await page.click('.wizFoot .btn.primary');
  await page.click('.wizFoot .btn.primary');
  await page.waitForSelector('#band:not(.hidden) .bandSw');
}

await test('Tabwriter works without a band', async () => {
  await page.waitForSelector('.flowSetup');
  await page.evaluate(() => window.app.run('demo'));
  await page.waitForTimeout(600);
  const inEditor = await page.evaluate(() => document.getElementById('library').classList.contains('hidden') && document.getElementById('band').classList.contains('hidden'));
  await page.click('#homeBtn');
  const back = await page.evaluate(() => !document.getElementById('library').classList.contains('hidden') && !!document.querySelector('.flowSetup'));
  eq([inEditor, back], [true, true], 'editor, back to start');
});

await test('Band wizard: band shell with overview', async () => {
  await bandWizard('Testband', [['A', 'eg6'], ['B', 'drums']]);
  const r = await page.evaluate(() => [document.querySelector('.bandSw b').textContent, document.querySelector('.bandNav.home.on') !== null, document.querySelectorAll('#band .homeGrid .gigSec').length]);
  eq(r, ['Testband', true, 3], 'name, overview, cards');
});

await test('Stage: input list and cables suggested from gear', async () => {
  await bandWizard('Testband', [['A', 'eg6'], ['B', 'drums']]);
  await page.keyboard.press('Meta+3');
  await page.click('.seg.tabs button:nth-child(3)');
  await page.click('.secTools .tb:not(.add)');
  const ch = await page.$$eval('.bandTable .row.inputs:not(.head)', (x) => x.length);
  if (ch < 8) throw new Error(`only ${ch} inputs`);
});

await test('Gig wizard and presale tab', async () => {
  await bandWizard('Testband', [['A', 'b4']]);
  await page.keyboard.press('Meta+5');
  await page.click('.pageHead .btn.primary');
  await page.fill('.wizBody input[type=text]', 'Club');
  await page.keyboard.press('Enter');
  await page.click('.wizFoot .btn.primary');
  await page.click('.gigSeg button:nth-child(2)');
  await page.waitForSelector('.tkSummary');
  const r = await page.evaluate(() => [document.querySelectorAll('#band .bandItem').length, document.querySelectorAll('.tkSummary .tkTile').length]);
  eq(r, [1, 5], 'one gig, five tiles');
});

await test('Navigation: overview from every page, back to the editor', async () => {
  await bandWizard('Testband', [['A', 'b4']]);
  await page.evaluate(() => window.app.run('demo'));
  await page.waitForTimeout(600);
  await page.click('#homeBtn');
  await page.keyboard.press('Meta+2');
  await page.click('.bandNav.sub');
  const inEditor = await page.evaluate(() => document.getElementById('band').classList.contains('hidden'));
  await page.click('#homeBtn');
  const home = await page.evaluate(() => !!document.querySelector('.bandNav.home.on'));
  eq([inEditor, home], [true, true], 'editor, overview');
});

await test('Tabwriter: track for a band member with the right sound', async () => {
  await bandWizard('Testband', [['Kim', 'b5'], ['Lou', 'drums']]);
  await page.evaluate(() => window.app.run('demo'));
  await page.waitForTimeout(600);
  await page.click('#addTrack');
  const items = await page.$$eval('#trackMenu .menuHead', (x) => x.map((e) => e.textContent));
  await page.click('#trackMenu button:has-text("E-Bass (5 Saiten)")');
  const r = await page.evaluate(() => {
    const tr = window.app.editor.score.tracks.at(-1);
    return [tr.name, tr.playbackInfo.program, tr.staves[0].tuning.length];
  });
  eq([items, r], [['Kim', 'Lou'], ['Kim – E-Bass (5 Saiten)', 33, 5]], 'menu, track');
});

await test('Songs: to-do board moves cards between columns', async () => {
  await bandWizard('Testband', [['A', 'b4']]);
  await page.keyboard.press('Meta+2');
  await page.click('.seg.tabs button:nth-child(2)');
  await page.click('.pageHead .btn.primary');
  await page.fill('.kbCard input', 'Flyer drucken');
  await page.click('.kbCard .tb[data-tip^="Nach"]');
  const r = await page.evaluate(() => [...document.querySelectorAll('.kbCol')].map((c) => c.querySelectorAll('.kbCard').length));
  eq(r, [0, 1, 0], 'card in "In Arbeit"');
});

await test('No uncaught errors', async () => {
  if (errors.length) throw new Error(errors.join('\n'));
});

await browser.close();
await server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
