/*
 * Life RPG — test di "Salta" (missions.js: applySkip, unskipPlan, applyUnskip, skippedOn, skipMarks...)
 * Una volta saltata non conta: niente XP, niente penalità, la serie non cresce e non si interrompe.
 * Si salta la volta in corso (finché non è scaduta) o una futura, dal Calendario (le routine di gruppo: test/tsroutines.js).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSIONS: M, GAME, at } = require('./carica');
const { blank } = GAME;

const xp = o => Object.assign(blank(), o);
const now = (t, ds, time) => t.mock.timers.enable({ apis: ['Date'], now: at(ds, time) });
// "Lezione", dal lunedì al venerdì, dal 2 marzo 2026 (lunedì)
const lez = o => M.normalizeRoutines([{ id: 'r1', title: 'Lezione', rewards: { Intelletto: 10 }, penalty: { Intelletto: 5 },
  days: [1, 2, 3, 4, 5], start: '2026-03-02', streakDate: '2026-03-01', ...o }])[0];
// settimanale da 3 volte, da venerdì 25 settembre 2026 (le settimane vanno da venerdì a giovedì)
const pal = o => M.normalizeRoutines([{ id: 'r1', title: 'Palestra', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  freq: 'w', n: 3, start: '2026-09-25', streakDate: '2026-09-24', ...o }])[0];

function openApp(routines, missions, ds) { return M.routineDay(routines, missions, ds, at(ds, '00:05')).missions; }
const occ = (missions, r, ds) => missions.find(m => m.id === M.occId(r, ds));
const complete = (r, m, ds) => M.applyComplete(xp({}), m, r, 1, at(ds));
// "Salta" su una volta già creata, come fa il pulsante: la routine se lo ricorda e la volta resta, segnata come saltata
function skipOcc(r, missions, m) {
  assert.ok(M.canSkipOcc(r, m), 'si può saltare');
  assert.ok(M.applySkip(r, M.occKey(m), m));
  M.markSkipped(m);
  return missions;
}

test('giornaliera: la volta di oggi saltata non interrompe la serie e non la fa crescere', t => {
  const r = lez();
  let list = [];
  for (const ds of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']) {
    now(t, ds, '12:00');
    list = openApp([r], list, ds);
    complete(r, occ(list, r, ds), ds);
    t.mock.timers.reset();
  }
  assert.equal(r.streak, 4);
  now(t, '2026-03-06', '09:00');
  list = openApp([r], list, '2026-03-06');
  list = skipOcc(r, list, occ(list, r, '2026-03-06'));
  t.mock.timers.reset();
  // sabato, domenica, lunedì: nessuna penalità da pagare, la serie è ancora lì
  for (const ds of ['2026-03-07', '2026-03-08', '2026-03-09']) list = openApp([r], list, ds);
  assert.equal(occ(list, r, '2026-03-06').done.sk, 1, 'la volta resta, saltata (niente penalità)');
  assert.equal(occ(list, r, '2026-03-06').failed, null);
  assert.deepEqual([r.streak, r.brks], [4, []], 'serie ferma, nessun periodo mancato');
  now(t, '2026-03-09', '12:00');
  complete(r, occ(list, r, '2026-03-09'), '2026-03-09');
  assert.equal(r.streak, 5, 'lunedì la serie riprende da dove era');
});

test('giornaliera: saltare in anticipo un giorno futuro', t => {
  now(t, '2026-03-02', '12:00');
  const r = lez();
  let list = openApp([r], [], '2026-03-02');
  complete(r, occ(list, r, '2026-03-02'), '2026-03-02');
  assert.deepEqual(M.plannedRoutines([r], '2026-03-04', new Set(list.map(m => m.id))).map(x => x.id), ['r1'], 'prevista');
  assert.ok(M.applySkip(r, '2026-03-04'));
  assert.deepEqual(M.plannedRoutines([r], '2026-03-04', new Set()), [], 'saltata: non è più prevista');
  assert.deepEqual(M.skippedOn([r], '2026-03-04').map(x => x.p), [{ s: '2026-03-04', e: '2026-03-04' }]);
  assert.deepEqual(M.skipMarks([r]), { '2026-03-04': 1 });
  t.mock.timers.reset();
  list = openApp([r], list, '2026-03-03');
  complete(r, occ(list, r, '2026-03-03'), '2026-03-03');
  list = openApp([r], list, '2026-03-04');
  const sk = occ(list, r, '2026-03-04');
  assert.deepEqual([sk.done.sk, sk.done.date, sk.failed], [1, '2026-03-04', null], 'il giorno saltato la volta nasce già saltata');
  assert.deepEqual(M.missionLists(list).skipped.map(m => m.id), [sk.id], 'nella scheda Missioni: tra le saltate');
  assert.ok(!M.missionLists(list).done.includes(sk), 'non tra le completate');
  assert.deepEqual(M.dayLists(list, '2026-03-04').skipped, [], 'nel Calendario la mostra la routine (skippedOn), non due volte');
  list = openApp([r], list, '2026-03-05');
  complete(r, occ(list, r, '2026-03-05'), '2026-03-05');
  assert.deepEqual([r.streak, r.brks], [3, []]);
});

test('settimanale: saltare la settimana in corso (anche a metà delle volte)', t => {
  now(t, '2026-09-26', '12:00');
  const r = pal();
  let list = openApp([r], [], '2026-09-26');
  let m = occ(list, r, '2026-09-25');
  M.applySetCount(m, 3, at('2026-09-26'));
  complete(r, m, '2026-09-26');
  assert.equal(r.streak, 1);
  t.mock.timers.reset();
  now(t, '2026-10-03', '12:00');
  list = openApp([r], list, '2026-10-03');
  m = occ(list, r, '2026-10-02');
  M.applySetCount(m, 1, at('2026-10-03'));
  list = skipOcc(r, list, m);
  assert.deepEqual(r.skip, [{ d: '2026-10-02', p: ['2026-10-03'] }], 'si ricorda le volte già segnate');
  assert.deepEqual(M.skippedOn([r], '2026-10-08').map(x => x.p), [{ s: '2026-10-02', e: '2026-10-08' }], 'nel giorno della scadenza');
  t.mock.timers.reset();
  list = openApp([r], list, '2026-10-09');
  assert.deepEqual([r.streak, r.brks], [1, []], 'la settimana saltata non interrompe la serie');
  now(t, '2026-10-10', '12:00');
  m = occ(list, r, '2026-10-09');
  M.applySetCount(m, 3, at('2026-10-10'));
  complete(r, m, '2026-10-10');
  assert.equal(r.streak, 2);
});

test('settimanali e mensili: nel Calendario il periodo futuro sta nel suo ultimo giorno, e si può saltare', t => {
  now(t, '2026-09-26', '12:00');
  const r = pal();
  const list = openApp([r], [], '2026-09-26');
  const ids = new Set(list.map(m => m.id));
  assert.deepEqual(M.plannedRoutines([r], '2026-10-01', ids), [], 'la settimana in corso esiste già');
  assert.deepEqual(M.plannedRoutines([r], '2026-10-08', ids).map(x => x.id), ['r1'], 'la prossima: giovedì 8');
  assert.deepEqual(M.plannedRoutines([r], '2026-10-05', ids), [], 'non negli altri giorni');
  assert.deepEqual(M.plannedPeriod(r, '2026-10-08'), { s: '2026-10-02', e: '2026-10-08' });
  M.applySkip(r, '2026-10-02');
  assert.deepEqual(M.plannedRoutines([r], '2026-10-08', ids), []);
  assert.deepEqual(M.plannedRoutines([r], '2026-10-15', ids).map(x => x.id), ['r1'], 'quella dopo resta');
  const mo = M.normalizeRoutines([{ id: 'r2', title: 'Bollette', rewards: { Animo: 10 }, freq: 'm', start: '2026-09-15', streakDate: '2026-09-14' }])[0];
  assert.deepEqual(M.plannedRoutines([mo], '2026-11-14', new Set()).map(x => x.id), ['r2'], 'mensile: il 14 novembre');
  assert.deepEqual(M.plannedPeriod(mo, '2026-11-14'), { s: '2026-10-15', e: '2026-11-14' });
  assert.deepEqual(M.plannedRoutines([mo], '2026-10-15', new Set()), []);
});

test('annullare un salto: finché la volta non sarebbe scaduta', t => {
  now(t, '2026-03-02', '07:00');
  const r = lez({ time: '08:30' });
  let list = openApp([r], [], '2026-03-02');
  list = skipOcc(r, list, occ(list, r, '2026-03-02'));
  const plan = M.unskipPlan(r, '2026-03-02');
  assert.equal(plan.occ.id, M.occId(r, '2026-03-02'), 'la volta torna');
  assert.equal(plan.occ.dueTime, '08:30');
  t.mock.timers.reset();
  now(t, '2026-03-02', '09:00');
  assert.equal(M.unskipPlan(r, '2026-03-02'), null, 'dopo le 08:30 sarebbe già scaduta');
  t.mock.timers.reset();
  now(t, '2026-03-02', '07:00');
  assert.ok(M.applyUnskip(r, '2026-03-02'));
  assert.equal(r.skip, undefined);
  // come fa il pulsante: la volta saltata c'è ancora, torna da fare
  const cur = occ(list, r, '2026-03-02');
  assert.equal(cur.done.sk, 1);
  cur.done = null;
  list = openApp([r], list, '2026-03-02');
  assert.equal(list.filter(m => m.rid === 'r1').length, 1, 'una sola volta');
  assert.equal(occ(list, r, '2026-03-02').done, null, 'di nuovo da fare');
});

test('annullare un salto: volte già segnate e giorni futuri', t => {
  now(t, '2026-10-03', '12:00');
  const r = pal({ start: '2026-10-02', streakDate: '2026-10-01' });
  let list = openApp([r], [], '2026-10-03');
  const m = occ(list, r, '2026-10-02');
  M.applySetCount(m, 2, at('2026-10-03'));
  list = skipOcc(r, list, m);
  const plan = M.unskipPlan(r, '2026-10-02');
  assert.deepEqual([plan.occ.n, plan.occ.p], [3, ['2026-10-03', '2026-10-03']], 'con le volte già segnate');
  // futuro: si toglie dall'elenco dei salti e la volta arriverà da sola
  M.applySkip(r, '2026-10-09');
  assert.deepEqual(M.unskipPlan(r, '2026-10-09'), { occ: null });
  M.applyUnskip(r, '2026-10-09');
  t.mock.timers.reset();
  list = openApp([r], list, '2026-10-10');
  assert.ok(occ(list, r, '2026-10-09'), 'la settimana non più saltata arriva');
  assert.equal(M.unskipPlan(r, '2026-10-30'), null, 'niente da annullare');
});

test('cosa non si può saltare', t => {
  now(t, '2026-03-03', '12:00');
  const r = lez();
  let list = openApp([r], [], '2026-03-02');
  list = openApp([r], list, '2026-03-03');
  const done = occ(list, r, '2026-03-03');
  complete(r, done, '2026-03-03');
  assert.ok(!M.canSkipOcc(r, done), 'completata');
  const late = occ(list, r, '2026-03-02');
  assert.ok(!M.canSkipOcc(r, late), 'scaduta');
  M.applyFail(xp({}), late, r, '2026-03-03', 1);
  assert.ok(!M.canSkipOcc(r, late), 'fallita');
  // routine di gruppo: i salti si tengono (sono la copia di quelli del documento del gruppo), con i periodi saltati da tutti
  const g = M.normalizeRoutines([{ id: 'r9', title: 'Studio', rewards: { Intelletto: 10 }, days: [1, 2, 3, 4, 5],
    start: '2026-03-02', sr: 'qabcdefg', sh: 'o', skip: [{ d: '2026-03-04' }], gx: ['2026-03-03', 'rotto', '2026-03-03'] }])[0];
  assert.deepEqual([g.skip, g.gx], [[{ d: '2026-03-04' }], ['2026-03-03']]);
  assert.ok(M.applySkip(r, '2026-03-05'));
  assert.ok(!M.applySkip(r, '2026-03-05'), 'già saltata');
});

test('dati salvati: i salti si controllano e i più vecchi si tolgono', t => {
  const r = lez({ skip: [{ d: '2026-03-04', p: ['2026-03-04', 'x'] }, { d: 'rotto' }, { d: '2026-03-04' }, null, { d: '2026-03-03' }] });
  assert.deepEqual(r.skip, [{ d: '2026-03-03' }, { d: '2026-03-04', p: ['2026-03-04'] }], 'ordinati, senza doppioni né date rotte');
  assert.deepEqual(M.normalizeRoutines([r])[0].skip, r.skip, 'si salvano e si rileggono uguali');
  assert.equal(lez({ skip: [] }).skip, undefined, 'senza salti il campo non c\'è');
  now(t, '2026-06-01', '12:00');
  const res = M.routineDay([r], [], '2026-06-01', at('2026-06-01', '00:05'));
  assert.equal(r.skip, undefined, 'dopo 60 giorni non servono più');
  assert.ok(res.routinesChanged);
});

/* ---------- le volte saltate restano tra le missioni ("Saltate"), e si possono eliminare ---------- */
test('saltata: sta tra le saltate; eliminata con "Seleziona" non torna', t => {
  now(t, '2026-03-02', '09:00');
  const r = lez();
  let list = openApp([r], [], '2026-03-02');
  const m = occ(list, r, '2026-03-02');
  list = skipOcc(r, list, m);
  assert.deepEqual(M.missionLists(list).skipped, [m]);
  assert.deepEqual(M.missionLists(list).done, [], 'non è una completata');
  // eliminata (come fa "Seleziona": la lapide resta tra le missioni eliminate)
  const gone = new Set([m.id]);
  list = list.filter(x => x !== m);
  list = M.routineDay([r], list, '2026-03-02', at('2026-03-02', '09:05'), gone).missions;
  assert.equal(occ(list, r, '2026-03-02'), undefined, 'non torna');
  assert.deepEqual(r.skip.map(x => x.d), ['2026-03-02'], 'il salto resta nella routine (serie e Calendario)');
});

test('saltate prima di questa versione (la volta era stata tolta): non tornano', t => {
  now(t, '2026-03-02', '09:00');
  const r = lez();
  let list = openApp([r], [], '2026-03-02');
  const m = occ(list, r, '2026-03-02');
  M.applySkip(r, '2026-03-02', m);
  const gone = new Set([m.id]);   // allora si toglieva, con la lapide
  list = list.filter(x => x !== m);
  list = M.routineDay([r], list, '2026-03-02', at('2026-03-02', '09:05'), gone).missions;
  assert.equal(occ(list, r, '2026-03-02'), undefined);
});

test('settimanale saltata a metà: le volte già segnate restano, e tornano annullando il salto', t => {
  now(t, '2026-09-26', '12:00');
  const r = pal();
  let list = openApp([r], [], '2026-09-26');
  const m = occ(list, r, '2026-09-25');
  M.applySetCount(m, 1, at('2026-09-26'));
  list = skipOcc(r, list, m);
  assert.deepEqual([m.done.sk, m.p.length], [1, 1]);
  const plan = M.unskipPlan(r, '2026-09-25');
  assert.ok(plan && plan.occ, 'si può ancora annullare');
  M.applyUnskip(r, '2026-09-25');
  m.done = null;   // come fa il pulsante
  assert.deepEqual([m.done, m.p.length, M.missionLists(list).todo.includes(m)], [null, 1, true], 'di nuovo da fare, con la volta già segnata');
});
