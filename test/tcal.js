/*
 * Life RPG — test dei periodi del calendario (routine settimanali e mensili con cal)
 * Settimane: dal primo giorno della settimana scelto (wk); mesi: dal 1° all'ultimo giorno. Un periodo già cominciato
 * quando la routine parte (o cambia) non conta: si parte dal primo intero. Le routine di prima passano ai periodi del
 * calendario alla fine del periodo in corso (calMigrate).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSIONS: M, GAME, at } = require('./carica');
const { blank } = GAME;

const xp = o => Object.assign(blank(), o);
const now = (t, ds, time = '12:00') => t.mock.timers.enable({ apis: ['Date'], now: at(ds, time) });
function openApp(routines, missions, ds) { return M.routineDay(routines, missions, ds, at(ds, '00:05')).missions; }
const occ = (missions, r, ds) => missions.find(m => m.id === M.occId(r, ds));
const complete = (r, m, ds) => M.applyComplete(xp({}), m, r, 1, at(ds));
// mercoledì 7 ottobre 2026
const sett = o => M.normalizeRoutines([{ id: 'r1', title: 'Palestra', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  freq: 'w', n: 1, start: '2026-10-07', streakDate: '2026-10-06', cal: 1, wk: 1, ...o }])[0];
const mese = o => M.normalizeRoutines([{ id: 'r2', title: 'Bollette', rewards: { Animo: 10 }, penalty: { Animo: 5 },
  freq: 'm', n: 1, start: '2026-10-07', streakDate: '2026-10-06', cal: 1, ...o }])[0];

test('dati: cal e wk si tengono solo per settimanali e mensili', () => {
  assert.deepEqual([sett().cal, sett().wk], [1, 1]);
  assert.deepEqual([sett({ wk: 0 }).wk, sett({ wk: 9 }).wk], [0, 1], 'domenica; valore rotto: lunedì');
  assert.deepEqual([mese().cal, mese().wk], [1, undefined]);
  const d = M.normalizeRoutines([{ id: 'r3', title: 'Corsa', rewards: { Vigore: 4 }, days: [1], start: '2026-10-07', cal: 1, wk: 1 }])[0];
  assert.deepEqual([d.cal, d.wk], [undefined, undefined], 'ogni giorno: niente');
});

test('settimane del calendario: da lunedì o da domenica, e si parte dalla prima settimana intera', () => {
  const r = sett();
  assert.deepEqual(M.periodAt(r, '2026-10-08'), null, 'la settimana in cui parte (da lunedì 5) è già cominciata: non conta');
  assert.deepEqual(M.periodAt(r, '2026-10-14'), { s: '2026-10-12', e: '2026-10-18' });
  assert.deepEqual(M.nextPeriod(r, '2026-10-07', '2026-12-31'), { s: '2026-10-12', e: '2026-10-18' });
  const b = sett({ wk: 0 });   // da domenica (Brasile)
  assert.deepEqual(M.nextPeriod(b, '2026-10-07', '2026-12-31'), { s: '2026-10-11', e: '2026-10-17' });
  const l = sett({ start: '2026-10-12', streakDate: '2026-10-11' });   // parte proprio di lunedì
  assert.deepEqual(M.periodAt(l, '2026-10-12'), { s: '2026-10-12', e: '2026-10-18' }, 'parte dal suo primo giorno');
});

test('mesi del calendario: dal 1° all\'ultimo giorno (anche febbraio)', () => {
  const r = mese();
  assert.equal(M.periodAt(r, '2026-10-20'), null, 'ottobre è già cominciato');
  assert.deepEqual(M.nextPeriod(r, '2026-10-07', '2027-12-31'), { s: '2026-11-01', e: '2026-11-30' });
  assert.deepEqual(M.periodAt(r, '2027-02-10'), { s: '2027-02-01', e: '2027-02-28' });
  assert.deepEqual(M.periodAt(mese({ start: '2026-10-01', streakDate: '2026-09-30' }), '2026-10-31'), { s: '2026-10-01', e: '2026-10-31' });
});

test('settimane del calendario: volte, serie e Calendario', t => {
  const r = sett();
  let list = openApp([r], [], '2026-10-08');
  assert.equal(list.length, 0, 'fino a domenica non c\'è niente da fare');
  assert.deepEqual(M.plannedRoutines([r], '2026-10-18', new Set()).map(x => x.id), ['r1'], 'nel Calendario: domenica 18');
  list = openApp([r], list, '2026-10-12');
  let m = occ(list, r, '2026-10-12');
  assert.deepEqual([m.ps, m.due], ['2026-10-12', '2026-10-18']);
  now(t, '2026-10-15');
  complete(r, m, '2026-10-15');
  t.mock.timers.reset();
  list = openApp([r], list, '2026-10-19');
  m = occ(list, r, '2026-10-19');
  now(t, '2026-10-20');
  complete(r, m, '2026-10-20');
  assert.deepEqual([r.streak, r.brks], [2, []]);
});

test('routine di prima: passa alle settimane del calendario alla fine del periodo in corso, senza sovrapposizioni', t => {
  // settimanale di prima, da venerdì 2 ottobre (settimane da venerdì a giovedì)
  const r = M.normalizeRoutines([{ id: 'r1', title: 'Palestra', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
    freq: 'w', n: 1, start: '2026-10-02', streakDate: '2026-10-01' }])[0];
  let list = openApp([r], [], '2026-10-03');
  now(t, '2026-10-03');
  complete(r, occ(list, r, '2026-10-02'), '2026-10-03');   // settimana 2-8 ottobre
  assert.ok(M.calMigrate(r, 1, '2026-10-03'));
  assert.deepEqual([r.nx.at, r.nx.cal, r.nx.wk, r.nx.pk], ['2026-10-09', 1, 1, '2026-10-02'], 'dal giorno dopo la fine della settimana in corso');
  assert.ok(!M.calMigrate(r, 1, '2026-10-03'), 'una volta sola');
  t.mock.timers.reset();
  for (const ds of ['2026-10-09', '2026-10-10', '2026-10-11']) list = openApp([r], list, ds);
  assert.deepEqual([r.cal, r.wk, r.at, r.nx], [1, 1, '2026-10-09', undefined]);
  assert.equal(list.length, 1, 'venerdì-domenica: nessuna volta nuova (nessuna sovrapposizione)');
  list = openApp([r], list, '2026-10-12');
  const m = occ(list, r, '2026-10-12');
  assert.deepEqual([m.ps, m.due], ['2026-10-12', '2026-10-18'], 'da lunedì, le settimane del calendario');
  assert.deepEqual([r.streak, r.brks], [1, []], 'i giorni in mezzo non interrompono la serie');
  now(t, '2026-10-13');
  complete(r, m, '2026-10-13');
  assert.equal(r.streak, 2);
});

test('routine di prima non ancora iniziata: passa subito; di gruppo o giornaliera: no', () => {
  const r = M.normalizeRoutines([{ id: 'r1', title: 'Bollette', rewards: { Animo: 10 }, freq: 'm', start: '2026-11-15' }])[0];
  assert.ok(M.calMigrate(r, 1, '2026-10-05'));
  assert.deepEqual([r.cal, r.nx], [1, undefined]);
  assert.deepEqual(M.nextPeriod(r, r.start, '2027-12-31'), { s: '2026-12-01', e: '2026-12-31' });
  const g = M.normalizeRoutines([{ id: 'r2', title: 'Bollette', rewards: { Animo: 10 }, freq: 'm', start: '2026-09-15', sr: 'qabcdefg', sh: 'o' }])[0];
  assert.ok(!M.calMigrate(g, 1, '2026-10-05'));
  const d = M.normalizeRoutines([{ id: 'r3', title: 'Corsa', rewards: { Vigore: 4 }, days: [1], start: '2026-09-15' }])[0];
  assert.ok(!M.calMigrate(d, 1, '2026-10-05'));
});

test('cambiare il primo giorno della settimana di una routine: vale dalla settimana dopo', () => {
  const r = sett({ start: '2026-10-12', streakDate: '2026-10-11' });
  const at = M.planChange(r, { freq: 'w', n: 1, days: [], cal: 1, wk: 0 }, '2026-10-14');
  assert.equal(at, '2026-10-19');
  const f = M.foldedCopy(r);
  assert.deepEqual(M.nextPeriod(f, '2026-10-19', '2026-12-31'), { s: '2026-10-25', e: '2026-10-31' }, 'la prima settimana intera da domenica');
});

test('primo periodo per il modulo', () => {
  assert.deepEqual(M.firstCalPeriod('w', 1, '2026-10-07'), { s: '2026-10-12', e: '2026-10-18' });
  assert.deepEqual(M.firstCalPeriod('w', 0, '2026-10-11'), { s: '2026-10-11', e: '2026-10-17' });
  assert.deepEqual(M.firstCalPeriod('m', 1, '2026-10-07'), { s: '2026-11-01', e: '2026-11-30' });
});

test('saltare una settimana del calendario', () => {
  const r = sett();
  assert.deepEqual(M.periodStarting(r, '2026-10-19'), { s: '2026-10-19', e: '2026-10-25' });
  assert.ok(M.applySkip(r, '2026-10-19'));
  assert.deepEqual(M.nextPeriod(r, '2026-10-13', '2026-12-31'), { s: '2026-10-26', e: '2026-11-01' }, 'la 12-18 è già passata dall\'inizio; la 19-25 saltata');
  assert.deepEqual(M.skippedOn([r], '2026-10-25').map(x => x.p), [{ s: '2026-10-19', e: '2026-10-25' }]);
});
