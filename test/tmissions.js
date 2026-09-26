/*
 * Life RPG — test delle regole di missioni e routine (missions.js)
 * Date, stelle e XP, dati salvati, scadenze, elenchi, routine (giorni, serie, bonus, recuperi),
 * routine settimanali e mensili e da più volte (periodi, contatore, penalità per volta mancante, cambi di frequenza),
 * serie di gruppo, fusi orari delle routine di gruppo, Google Calendar.
 *
 * L'ora "di adesso" si fissa con t.mock.timers: così i test non dipendono da quando li lanci.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSIONS: M, GAME, LANGS, at } = require('./carica');
const { MAX_XP, blank } = GAME;

const xp = o => Object.assign(blank(), o);
const now = (t, ds, time) => t.mock.timers.enable({ apis: ['Date'], now: at(ds, time) });
// una missione valida, con i campi che servono al test
const mis = o => M.normalizeMissions([{ id: 'm1', title: 'Prova', rewards: { Vigore: 10 }, created: '2026-03-01', ...o }])[0];
// una routine di tutti i giorni dal 1° marzo, con i campi che servono al test
const rou = o => M.normalizeRoutines([{ id: 'r1', title: 'Corsa', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  days: [0, 1, 2, 3, 4, 5, 6], start: '2026-03-01', streakDate: '2026-02-28', ...o }])[0];
// una routine da 3 volte a settimana da venerdì 25 settembre 2026 (le settimane vanno da venerdì a giovedì)
const rouP = o => M.normalizeRoutines([{ id: 'r1', title: 'Palestra', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  freq: 'w', n: 3, start: '2026-09-25', streakDate: '2026-09-24', ...o }])[0];

/* ---------- aiuti per le routine: usano le stesse funzioni dei pulsanti dell'app (applyComplete, applyUndo...) ---------- */
// il "giro di oggi" all'apertura dell'app
function openApp(routines, missions, ds) { return M.routineDay(routines, missions, ds, at(ds, '00:05')).missions; }
const occ = (missions, r, ds) => missions.find(m => m.id === M.occId(r, ds));
const complete = (rt, m, ds, x = xp({})) => M.applyComplete(x, m, rt, 1, at(ds)).bonus;   // completata quel giorno
const undo = (rt, m, x = xp({})) => M.applyUndo(x, m, rt);
const fail = (rt, m, ds, x = xp({})) => M.applyFail(x, m, rt, ds, 1);                     // scaduta
const recover = (rt, m, ds, x = xp({})) => M.applyRevert(x, m, rt, at(ds));               // "Annulla penalità" / "Riprogramma"
// giorni di fila dal 1° marzo: 'd' = completata in tempo, 'x' = saltata. Restituisce routine, missioni e il giorno dopo.
function play(plan, extra) {
  const r = rou(extra);
  let missions = [], ds = '2026-03-01';
  for (const c of plan) {
    missions = openApp([r], missions, ds);
    const m = occ(missions, r, ds);
    if (c === 'd') complete(r, m, ds); else fail(r, m, ds);
    ds = M.addDaysStr(ds, 1);
  }
  missions = openApp([r], missions, ds);
  return { r, missions, ds };
}

/* ---------- date ---------- */
test('date: giorni, mesi, anni e ora legale', () => {
  assert.equal(M.addDaysStr('2026-01-31', 1), '2026-02-01');
  assert.equal(M.addDaysStr('2026-12-31', 1), '2027-01-01');
  assert.equal(M.addDaysStr('2026-03-01', -1), '2026-02-28');
  assert.equal(M.addDaysStr('2026-03-28', 2), '2026-03-30', 'attraverso il cambio dell\'ora');
  assert.equal(M.addDaysStr('2026-10-24', 2), '2026-10-26');
  assert.ok(M.validDate('2028-02-29'));
  assert.ok(!M.validDate('2026-02-29'));
  assert.ok(!M.validDate('2026-13-01'));
  assert.ok(!M.validDate('26-01-01'));
  assert.ok(M.validTime('00:00') && M.validTime('23:59'));
  assert.ok(!M.validTime('24:00') && !M.validTime('9:00'));
});

/* ---------- stelle e XP ---------- */
test('stelle: totale di XP della missione', () => {
  assert.equal(M.rewardTotal(1, 1), 4);
  assert.equal(M.rewardTotal(5, 5), 256);
  assert.equal(M.rewardTotal(4, 3), M.rewardTotal(3, 4));
  assert.deepEqual(M.rewardMatch(60), [3, 4]);
  assert.equal(M.rewardMatch(7), null);
  assert.deepEqual(M.normalizeStars(xp({ Vigore: 60 }), { d: 4, f: 3 }), { d: 4, f: 3 });
  assert.equal(M.normalizeStars(xp({ Vigore: 61 }), { d: 4, f: 3 }), null, 'il totale non combacia più');
  assert.equal(M.normalizeStars(xp({ Vigore: 4 }), { d: 0, f: 1 }), null);
});

test('XP: completare, annullare, penalità', () => {
  const x = xp({ Vigore: MAX_XP - 5, Animo: 3 });
  const applied = M.gainXp(x, xp({ Vigore: 10, Animo: 4 }), { Animo: 2 });
  assert.deepEqual([x.Vigore, x.Animo], [MAX_XP, 9], 'mai oltre il massimo; con il bonus');
  assert.deepEqual([applied.Vigore, applied.Animo], [5, 6], 'restituisce quanto è stato aggiunto davvero');
  x.Animo = 2;
  const removed = M.undoXp(x, applied);
  assert.deepEqual([x.Vigore, x.Animo, removed.Animo], [MAX_XP - 5, 0, 2], 'annullando non si scende sotto zero');
  const y = xp({ Vigore: 3 });
  assert.equal(M.penaltyXp(y, xp({ Vigore: 10 })).Vigore, 3, 'la penalità toglie al massimo quello che hai');
  assert.equal(y.Vigore, 0);
});

/* ---------- dati salvati ---------- */
test('missioni salvate: si scartano quelle rovinate o doppie', () => {
  const list = M.normalizeMissions([
    { id: 'a', title: '  Leggere   un libro ', rewards: { Vigore: 4 }, created: '2026-03-01', due: '2026-03-05', dueTime: '18:00' },
    { id: 'a', title: 'Doppia', rewards: { Vigore: 4 }, created: '2026-03-01' },
    { id: 'b', title: '', rewards: { Vigore: 4 }, created: '2026-03-01' },
    { id: 'c', title: 'Niente XP', rewards: {}, created: '2026-03-01' },
    { id: 'd e', title: 'Id sbagliato', rewards: { Vigore: 4 }, created: '2026-03-01' },
    { id: 'f', title: 'Ora senza data', rewards: { Vigore: 4 }, created: '2026-03-01', dueTime: '18:00' },
    null, 'x',
  ]);
  assert.deepEqual(list.map(m => m.id), ['a', 'f']);
  assert.equal(list[0].title, 'Leggere un libro');
  assert.equal(list[0].dueTime, '18:00');
  assert.equal(list[1].dueTime, null);
});

test('missioni salvate: campi delle routine, delle condivise e di Google Calendar', () => {
  const r = mis({ rid: 'r1', due: '2026-03-05', re: '2026-03-06', rj: 5, gd: '2026-03-05', gc: 1, sid: 's1',
    done: { date: '2026-03-06', applied: { Vigore: 10 }, rj: 1, pb: 4, rs: { prev: 1, prevDate: '', n: 2, pb: 3 } } });
  assert.equal(r.re, '2026-03-06');
  assert.equal(r.rj, 5);
  assert.equal(r.done.rj, 1);
  assert.equal(r.done.pb, 4);
  assert.deepEqual(r.done.rs, { prev: 1, prevDate: '', n: 2, pb: 3 });
  assert.equal(r.sid, undefined, 'una routine non è una missione condivisa');
  assert.equal(r.gc, undefined, 'per le routine il segno di Google Calendar sta sulla routine');
  const plain = mis({ re: '2026-03-06', rj: 5, gc: 1, sid: 's1', sh: 'g' });
  assert.equal(plain.re, undefined, 're e rj valgono solo per le routine');
  assert.equal(plain.rj, undefined);
  assert.equal(plain.gc, 1);
  assert.deepEqual([plain.sid, plain.sh], ['s1', 'g']);
  assert.equal(mis({ rid: 'r1', rj: 5 }).rj, undefined, 'rj senza re non vale');
});

test('routine salvate: giorni, bonus, giorni mancati', () => {
  const [r] = M.normalizeRoutines([{ id: 'r1', title: 'Corsa', rewards: { Vigore: 10 }, days: [3, 1, 1, 9, 'x'], start: '2026-03-01',
    bonus: { every: 1, xp: 5 }, pause: { from: '2026-03-10', until: '2026-03-15' }, gc: true,
    brks: [{ d: '2026-03-09', n: 2 }, { d: '2026-03-03', n: 5 }, { d: '2026-03-03', n: 1 }, { d: 'boh', n: 1 }, { d: '2026-03-04', n: -1 }] }]);
  assert.deepEqual(r.days, [1, 3]);
  assert.equal(r.bonus, null, 'un bonus ogni 1 volta non vale');
  assert.deepEqual(rou({ bonus: { every: 1000, xp: 5 } }).bonus, { every: 1000, xp: 5 }, 'nessun limite pratico verso l\'alto');
  assert.equal(rou({ bonus: { every: 100001, xp: 5 } }).bonus, null, 'solo il tetto contro i dati rovinati');
  assert.equal(r.pause, undefined, 'le pause non ci sono più: una salvata prima si ignora');
  assert.equal(r.gc, 1);
  assert.deepEqual(r.brks, [{ d: '2026-03-03', n: 5 }, { d: '2026-03-09', n: 2 }], 'validi, senza doppioni, in ordine');
  const many = Array.from({ length: 40 }, (_, i) => ({ d: M.addDaysStr('2026-01-01', i), n: i }));
  assert.equal(rou({ brks: many }).brks.length, 30, 'al massimo 30');
  assert.deepEqual(M.normalizeRoutines([{ id: 'r2', title: 'X', rewards: { Vigore: 1 }, days: [], start: '2026-03-01' }]), [], 'senza giorni si scarta');
});

/* ---------- scadenze ---------- */
test('scadenza: alla fine del minuto scelto, oppure a fine giornata', t => {
  assert.equal(M.dueEndMs(mis({ due: '2026-03-05', dueTime: '18:00' })), at('2026-03-05', '18:01'));
  assert.equal(M.dueEndMs(mis({ due: '2026-03-05' })), at('2026-03-06', '00:00'));
  assert.equal(M.dueEndMs(mis({})), Infinity);
  const m = mis({ due: '2026-03-05', dueTime: '18:00' });
  now(t, '2026-03-05', '18:00');
  assert.equal(M.isLate(m), false, 'alle 18:00 si fa ancora in tempo');
  t.mock.timers.setTime(at('2026-03-05', '18:01'));
  assert.equal(M.isLate(m), true);
});

test('scadenza: una routine recuperata vale fino alla fine del giorno del recupero', t => {
  const m = mis({ rid: 'r1', due: '2026-03-05', dueTime: '08:00', re: '2026-03-07' });
  assert.equal(M.dueEndMs(m), at('2026-03-08', '00:00'));
  now(t, '2026-03-07', '23:59');
  assert.equal(M.isLate(m), false);
  assert.equal(M.lateMissions([m]).length, 0);
});

test('disponibilità: prima del giorno (e dell\'ora) di inizio non si completa', t => {
  now(t, '2026-03-05', '09:00');
  assert.equal(M.notYet(mis({ from: '2026-03-05', fromTime: '10:00' })), true);
  assert.equal(M.notYet(mis({ from: '2026-03-05' })), false);
  assert.equal(M.notYet(mis({ rid: 'r1', due: '2026-03-06' })), true, 'una routine di domani');
  assert.equal(M.notYet(mis({ rid: 'r1', due: '2026-03-05' })), false);
  const next = M.nextChange([mis({ from: '2026-03-05', fromTime: '10:00', due: '2026-03-05', dueTime: '12:00' })], Date.now());
  assert.equal(next, at('2026-03-05', '10:00'), 'il prossimo cambiamento: quando diventa disponibile');
});

/* ---------- elenchi ---------- */
test('elenchi: gruppi delle missioni da fare', t => {
  now(t, '2026-03-10', '12:00');
  const L = M.missionLists([
    mis({ id: 'late', due: '2026-03-09' }),
    mis({ id: 'today', due: '2026-03-10' }),
    mis({ id: 'rtoday', rid: 'r1', due: '2026-03-10' }),
    mis({ id: 'rrec', rid: 'r1', due: '2026-03-08', re: '2026-03-10' }),
    mis({ id: 'soon', due: '2026-03-17' }),
    mis({ id: 'later', due: '2026-03-18' }),
    mis({ id: 'nodate' }),
    mis({ id: 'f1', due: '2026-03-08', failed: { date: '2026-03-08', applied: {} } }),
    mis({ id: 'd1', done: { date: '2026-03-09', t: 5, applied: {} } }),
  ]).groups;
  const ids = k => L[k].map(m => m.id).sort();
  assert.deepEqual(ids('late'), ['late']);
  assert.deepEqual(ids('today'), ['today']);
  assert.deepEqual(ids('routine'), ['rrec', 'rtoday'], 'la routine recuperata sta con quelle di oggi');
  assert.deepEqual(ids('soon'), ['soon']);
  assert.deepEqual(ids('later'), ['later']);
  assert.deepEqual(ids('nodate'), ['nodate']);
});

test('elenchi: fallite e completate in ordine, giorni del calendario', t => {
  now(t, '2026-03-10', '12:00');
  const list = [
    mis({ id: 'f1', due: '2026-03-02', failed: { date: '2026-03-03', applied: {} } }),
    mis({ id: 'f2', due: '2026-03-05', failed: { date: '2026-03-06', applied: {} } }),
    mis({ id: 'd1', done: { date: '2026-03-06', t: 1, applied: {} } }),
    mis({ id: 'd2', done: { date: '2026-03-06', t: 9, applied: {} } }),
    mis({ id: 'todo', due: '2026-03-06' }),
  ];
  const L = M.missionLists(list);
  assert.deepEqual(L.failed.map(m => m.id), ['f2', 'f1'], 'le più recenti in alto');
  assert.deepEqual(L.done.map(m => m.id), ['d2', 'd1']);
  const day = M.dayLists(list, '2026-03-06');
  assert.deepEqual([day.todo.map(m => m.id), day.done.map(m => m.id)], [['todo'], ['d2', 'd1']]);
  const marks = M.calendarMarks(list);
  assert.deepEqual([marks.fail['2026-03-02'], marks.done['2026-03-06'], marks.todo['2026-03-06']], [1, 2, 1]);
});

test('penalità: le scadute, in ordine di scadenza', t => {
  now(t, '2026-03-10', '12:00');
  const list = [mis({ id: 'b', due: '2026-03-09' }), mis({ id: 'a', due: '2026-03-08' }), mis({ id: 'c', due: '2026-03-11' }),
    mis({ id: 'd', due: '2026-03-07', failed: { date: '2026-03-08', applied: {} } })];
  assert.deepEqual(M.lateMissions(list).map(m => m.id), ['a', 'b']);
});

/* ---------- routine: giorni e "giro di oggi" ---------- */
test('routine: in quali giorni conta', () => {
  const r = rou({ days: [1, 3] });   // lunedì e mercoledì
  assert.equal(M.dayCounts(r, '2026-03-02'), true, 'lunedì');
  assert.equal(M.dayCounts(r, '2026-03-03'), false, 'martedì');
  assert.equal(M.dayCounts(r, '2026-02-23'), false, 'prima dell\'inizio');
});

test('routine: crea le volte di oggi e di quelle saltate dall\'ultima apertura, una volta sola', () => {
  const r = rou({ made: '2026-03-02' });
  let list = openApp([r], [], '2026-03-05');
  assert.deepEqual(list.map(m => m.due), ['2026-03-03', '2026-03-04', '2026-03-05']);
  assert.equal(r.made, '2026-03-05');
  list = openApp([r], list.filter(m => m.due !== '2026-03-04'), '2026-03-05');
  assert.equal(list.length, 2, 'una volta eliminata non torna');
});

test('routine: la cronologia vecchia si pulisce', () => {
  const old = mis({ id: 'old', rid: 'r1', due: '2026-01-01', done: { date: '2026-01-01', applied: {} } });
  const list = openApp([rou({ made: '2026-03-20' })], [old], '2026-03-20');
  assert.equal(list.find(m => m.id === 'old'), undefined, 'più vecchia di 60 giorni');
});

/* ---------- serie e bonus ---------- */
test('serie: cresce completando in tempo, si interrompe saltando un giorno', () => {
  let { r } = play('ddd');
  assert.deepEqual([r.streak, r.best], [3, 3]);
  ({ r } = play('dddx'));
  assert.deepEqual([r.streak, r.best], [0, 3]);
  assert.deepEqual(r.brks, [{ d: '2026-03-04', n: 3 }], 'si ricorda la serie di prima');
});

test('serie: completare una volta del giorno prima (in ritardo) non la fa crescere', () => {
  const r = rou();
  let list = openApp([r], [], '2026-03-01');
  list = openApp([r], list, '2026-03-02');
  complete(r, occ(list, r, '2026-03-01'), '2026-03-02');
  assert.equal(r.streak, 0);
});

test('bonus: ogni N volte di fila, sulle statistiche della routine', () => {
  const r = rou({ bonus: { every: 3, xp: 7 }, rewards: { Vigore: 10, Animo: 5 } });
  let list = [], ds = '2026-03-01', got = [];
  for (let i = 0; i < 6; i++) { list = openApp([r], list, ds); got.push(complete(r, occ(list, r, ds), ds)); ds = M.addDaysStr(ds, 1); }
  assert.deepEqual(got.map(b => Object.keys(b).length), [0, 0, 2, 0, 0, 2]);
  assert.deepEqual(got[2], { Vigore: 7, Animo: 7 });
});

test('annullare: la serie e il record tornano com\'erano', () => {
  const r = rou();
  let list = openApp([r], [], '2026-03-01');
  const m = occ(list, r, '2026-03-01');
  complete(r, m, '2026-03-01');
  assert.deepEqual([r.streak, r.best], [1, 1]);
  undo(r, m);
  assert.deepEqual([r.streak, r.best], [0, 0]);
  // record più alto della serie: resta
  const r2 = rou({ streak: 3, best: 10 });
  list = openApp([r2], [], '2026-03-01');
  const m2 = occ(list, r2, '2026-03-01');
  complete(r2, m2, '2026-03-01');
  undo(r2, m2);
  assert.deepEqual([r2.streak, r2.best], [3, 10]);
});

/* ---------- azioni: XP insieme a serie e record ---------- */
test('azioni: completare e annullare, con gli XP', () => {
  const x = xp({ Vigore: 100 });
  const r = rou({ bonus: { every: 2, xp: 3 }, streak: 1, best: 1 });
  const list = openApp([r], [], '2026-03-01');
  const m = occ(list, r, '2026-03-01');
  const res = M.applyComplete(x, m, r, 42, at('2026-03-01', '09:00'));
  assert.deepEqual([res.applied.Vigore, res.bonus.Vigore, res.n, res.routineChanged], [13, 3, 2, true], 'ricompensa + bonus della seconda volta di fila');
  assert.deepEqual([x.Vigore, m.done.date, m.done.t], [113, '2026-03-01', 42]);
  const u = M.applyUndo(x, m, r);
  assert.deepEqual([u.removed.Vigore, x.Vigore, m.done, r.streak, r.best], [13, 100, null, 1, 1]);
});

test('azioni: missione normale completata, fallita e riprogrammata', () => {
  const x = xp({ Vigore: 3 });
  const m = mis({ due: '2026-03-05', dueTime: '18:00', penalty: { Vigore: 8 } });
  const f = M.applyFail(x, m, null, '2026-03-06', 7);
  assert.deepEqual([f.removed.Vigore, x.Vigore, m.failed.date], [3, 0, '2026-03-06'], 'si perde al massimo quello che si ha');
  const back = M.applyRevert(x, m, null);
  assert.deepEqual([back.restored.Vigore, x.Vigore, m.failed, m.due, m.dueTime, m.re], [3, 3, null, null, null, undefined],
    'tornano gli XP persi davvero; resta senza scadenza');
  assert.equal(M.applyComplete(x, m, null, 1, at('2026-03-07')).n, 0, 'nessuna serie per le missioni normali');
  assert.equal(x.Vigore, 13);
});

test('azioni: fallire senza perdere XP (per esempio se abbandona un amico)', () => {
  const x = xp({ Vigore: 50 });
  const m = mis({ due: '2026-03-05', penalty: { Vigore: 8 } });
  const { removed } = M.applyFail(x, m, null, '2026-03-06', 1, false);
  assert.deepEqual([removed.Vigore, x.Vigore, !!m.failed], [0, 50, true]);
});

test('azioni: recuperare una routine ridà gli XP e la rende da fare fino a fine giornata', () => {
  const x = xp({ Vigore: 20 });
  const { r, missions, ds } = play('dx');
  const m = occ(missions, r, '2026-03-02');
  m.failed.applied = xp({ Vigore: 5 });   // la penalità che aveva tolto
  const res = M.applyRevert(x, m, r, at(ds, '10:00'));
  assert.deepEqual([res.restored.Vigore, x.Vigore, m.re, m.rj, res.routineChanged], [5, 25, ds, 1, true]);
});

/* ---------- recupero delle routine fallite ---------- */
test('recupero: la serie torna subito, e cresce completando', () => {
  const { r, missions, ds } = play('dddddx');
  assert.equal(r.streak, 0);
  const m = occ(missions, r, '2026-03-06');
  recover(r, m, ds);
  assert.deepEqual([r.streak, r.best, m.rj], [5, 5, 5]);
  complete(r, m, ds);
  assert.deepEqual([r.streak, r.best], [6, 6]);
});

test('recupero: se fallisce di nuovo, la serie torna a zero (e il giorno si può ancora recuperare)', () => {
  const { r, missions, ds } = play('dddddx');
  const m = occ(missions, r, '2026-03-06');
  recover(r, m, ds);
  fail(r, m, ds);
  assert.deepEqual([r.streak, r.best], [0, 5]);
  assert.deepEqual(r.brks, [{ d: '2026-03-06', n: 5 }]);
  assert.equal(m.re, undefined);
  recover(r, m, ds);
  assert.equal(r.streak, 5);
});

test('recupero: due giorni saltati di fila, in qualunque ordine', () => {
  for (const order of [['2026-03-06', '2026-03-07'], ['2026-03-07', '2026-03-06']]) {
    const { r, missions, ds } = play('dddddxx');
    for (const d of order) { const m = occ(missions, r, d); recover(r, m, ds); complete(r, m, ds); }
    assert.equal(r.streak, 7, 'ordine ' + order.join(' poi '));
  }
});

test('recupero: si riattacca alla serie nuova già iniziata', () => {
  const { r, missions, ds } = play('dddddxdd');
  assert.equal(r.streak, 2);
  const m = occ(missions, r, '2026-03-06');
  recover(r, m, ds);
  assert.deepEqual([r.streak, r.best], [7, 5], 'il record sale solo completando');
  complete(r, m, ds);
  assert.deepEqual([r.streak, r.best], [8, 8]);
  undo(r, m);
  assert.deepEqual([r.streak, r.best], [7, 5], 'annullando torna tutto com\'era');
});

test('recupero: lo stesso giorno, prima che la serie si interrompa', () => {
  const r = rou();
  let list = openApp([r], [], '2026-03-01');
  complete(r, occ(list, r, '2026-03-01'), '2026-03-01');
  list = openApp([r], list, '2026-03-02');
  const m = occ(list, r, '2026-03-02');
  fail(r, m, '2026-03-02');
  recover(r, m, '2026-03-02');
  assert.equal(m.rj, undefined, 'niente da ridare: la serie non si era ancora interrotta');
  complete(r, m, '2026-03-02');
  assert.equal(r.streak, 2);
});

test('recupero: dopo un recupero completato la serie continua normalmente', () => {
  let { r, missions, ds } = play('dddddx');
  const m = occ(missions, r, '2026-03-06');
  recover(r, m, ds);
  complete(r, m, ds);
  complete(r, occ(missions, r, ds), ds);   // la volta di oggi
  assert.equal(r.streak, 7);
  missions = openApp([r], missions, M.addDaysStr(ds, 1));
  assert.deepEqual([r.streak, r.brks], [7, []], 'il giorno dopo non si interrompe niente');
});

/* ---------- routine settimanali, mensili e da più volte ---------- */
test('routine salvate: frequenza, volte, giorni e ora', () => {
  const [w, d3, big, bad] = M.normalizeRoutines([
    { id: 'a', title: 'A', rewards: { Vigore: 1 }, freq: 'w', n: 3, days: [1, 2], time: '08:00', start: '2026-09-25' },
    { id: 'b', title: 'B', rewards: { Vigore: 1 }, n: 3, days: [1], time: '08:00', start: '2026-09-25' },
    { id: 'c', title: 'C', rewards: { Vigore: 1 }, freq: 'm', n: 5000, start: '2026-09-25' },
    { id: 'd', title: 'D', rewards: { Vigore: 1 }, freq: 'x', n: -2, days: [1], time: '08:00', start: '2026-09-25' },
  ]);
  assert.deepEqual([w.freq, w.n, w.days, w.time], ['w', 3, [], null], 'settimanale: niente giorni né ora');
  assert.deepEqual([d3.freq, d3.n, d3.days, d3.time], ['d', 3, [1], null], 'più volte al giorno: niente ora');
  assert.equal(big.n, 999, 'nessun limite pratico, solo un tetto contro i dati rovinati');
  assert.deepEqual([bad.freq, bad.n, bad.time], ['d', 1, '08:00'], 'valori non validi: ogni giorno, una volta');
  assert.deepEqual(M.normalizeRoutines([{ id: 'e', title: 'E', rewards: { Vigore: 1 }, freq: 'd', days: [], start: '2026-09-25' }]), [],
    'ogni giorno senza giorni: si scarta');
  const [c] = M.normalizeRoutines([{ id: 'f', title: 'F', rewards: { Vigore: 1 }, days: [1], start: '2026-09-01', at: '2026-09-10',
    nx: { at: '2026-09-30', freq: 'm', n: 2, days: [1] } }]);
  assert.equal(c.at, '2026-09-10');
  assert.deepEqual(c.nx, { at: '2026-09-30', freq: 'm', n: 2, days: [], time: null }, 'cambio in arrivo');
  const [c2] = M.normalizeRoutines([{ id: 'g', title: 'G', rewards: { Vigore: 1 }, days: [1], start: '2026-09-01', at: '2026-09-10',
    nx: { at: '2026-09-05', freq: 'w', n: 2 } }]);
  assert.equal(c2.nx, undefined, 'un cambio che arriverebbe prima delle regole di adesso non vale');
});

test('missioni salvate: contatore e periodo delle volte di una routine', () => {
  const m = mis({ rid: 'r1', due: '2026-10-01', ps: '2026-09-25', n: 3, p: ['2026-09-26', 'boh', '2026-09-27', '2026-09-28', '2026-09-29'] });
  assert.deepEqual([m.n, m.p, m.ps], [3, ['2026-09-26', '2026-09-27', '2026-09-28'], '2026-09-25']);
  const one = mis({ rid: 'r1', due: '2026-10-01', n: 1, p: ['2026-09-26'] });
  assert.deepEqual([one.n, one.p], [undefined, undefined], 'una volta sola: niente contatore');
  const plain = mis({ n: 3, ps: '2026-09-25' });
  assert.deepEqual([plain.n, plain.ps], [undefined, undefined], 'solo per le routine');
});

test('date: mesi con lo stesso giorno, giorni fra due date', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(k => M.addMonthsStr('2026-01-31', k)),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'], 'dal 31: nei mesi corti l\'ultimo giorno, senza perdere il 31');
  assert.equal(M.addMonthsStr('2028-01-31', 1), '2028-02-29', 'anno bisestile');
  assert.equal(M.addMonthsStr('2026-11-15', 2), '2027-01-15', 'a cavallo dell\'anno');
  assert.equal(M.daysBetween('2026-03-28', '2026-03-30'), 2, 'attraverso il cambio dell\'ora');
  assert.equal(M.daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('periodi: settimane di 7 giorni e mesi dal giorno di inizio', () => {
  const w = rouP();
  assert.equal(M.periodAt(w, '2026-09-24'), null, 'prima dell\'inizio');
  assert.deepEqual(M.periodAt(w, '2026-09-25'), { s: '2026-09-25', e: '2026-10-01' }, 'da venerdì a giovedì');
  assert.deepEqual(M.periodAt(w, '2026-10-01'), { s: '2026-09-25', e: '2026-10-01' });
  assert.deepEqual(M.periodAt(w, '2026-10-02'), { s: '2026-10-02', e: '2026-10-08' });
  assert.deepEqual(M.periodAt(w, '2026-10-26'), { s: '2026-10-23', e: '2026-10-29' }, 'con il cambio dell\'ora');
  const m = rouP({ freq: 'm', start: '2026-09-15' });
  assert.deepEqual(M.periodAt(m, '2026-10-14'), { s: '2026-09-15', e: '2026-10-14' });
  assert.deepEqual(M.periodAt(m, '2026-10-15'), { s: '2026-10-15', e: '2026-11-14' });
  const end = rouP({ freq: 'm', start: '2026-01-31' });
  assert.deepEqual(['2026-02-27', '2026-02-28', '2026-03-30', '2026-03-31'].map(d => M.periodAt(end, d).s),
    ['2026-01-31', '2026-02-28', '2026-02-28', '2026-03-31'], 'dal 31: il 28 febbraio, poi di nuovo il 31');
  assert.deepEqual(M.periodAt(end, '2026-02-28'), { s: '2026-02-28', e: '2026-03-30' });
});

test('settimanale: una volta per settimana, da fare in qualunque giorno', t => {
  const r = rouP();
  let list = openApp([r], [], '2026-09-25');
  assert.equal(list.length, 1);
  const m = list[0];
  assert.deepEqual([m.id, m.ps, m.due, m.dueTime, m.n, m.p], ['r1-20260925', '2026-09-25', '2026-10-01', null, 3, []]);
  now(t, '2026-09-30', '12:00');
  assert.equal(M.notYet(m), false, 'si fa in qualunque giorno del periodo');
  assert.equal(M.missionLists(list).groups.period.length, 1, 'nella lista: con i periodi in corso');
  list = openApp([r], list, '2026-10-01');
  assert.equal(list.length, 1, 'fino a giovedì è sempre la stessa');
  list = openApp([r], list, '2026-10-02');
  assert.deepEqual(list.map(x => x.id), ['r1-20260925', 'r1-20261002']);
});

test('più volte: le ricompense arrivano solo con l\'ultima', () => {
  const x = xp({ Vigore: 100 });
  const r = rouP();
  const m = openApp([r], [], '2026-09-25')[0];
  let res = M.applyComplete(x, m, r, 1, at('2026-09-26'));
  assert.deepEqual([res.partial, res.count, res.need, res.applied.Vigore, x.Vigore, m.done, r.streak], [true, 1, 3, 0, 100, null, 0]);
  res = M.applyComplete(x, m, r, 2, at('2026-09-26'));
  assert.deepEqual([res.count, x.Vigore], [2, 100], 'anche due nello stesso giorno');
  res = M.applyUndo(x, m, r);
  assert.deepEqual([res.count, res.removed.Vigore, x.Vigore], [1, 0, 100], 'annullare una volta segnata: niente XP da togliere');
  M.applyComplete(x, m, r, 3, at('2026-09-27'));
  res = M.applyComplete(x, m, r, 4, at('2026-09-28'));
  assert.deepEqual([res.partial, res.count, res.applied.Vigore, x.Vigore, m.done.date, r.streak, r.streakDate],
    [undefined, 3, 10, 110, '2026-09-28', 1, '2026-09-25']);
  assert.deepEqual(m.p, ['2026-09-26', '2026-09-27', '2026-09-28']);
  res = M.applyUndo(x, m, r);
  assert.deepEqual([res.removed.Vigore, x.Vigore, m.done, m.p.length, r.streak], [10, 100, null, 2, 0],
    'annullando l\'ultima: via gli XP e la serie');
});

test('più volte: a fine periodo, penalità per ogni volta mancante e serie interrotta', t => {
  const x = xp({ Vigore: 100 });
  const r = rouP({ streak: 4, best: 4 });
  let list = openApp([r], [], '2026-09-25');
  const m = list[0];
  M.applyComplete(x, m, r, 1, at('2026-09-27'));
  now(t, '2026-10-02', '00:00');
  assert.deepEqual(M.lateMissions(list).map(z => z.id), ['r1-20260925'], 'scaduta a mezzanotte di giovedì');
  const f = M.applyFail(x, m, r, '2026-10-02', 1);
  assert.deepEqual([f.missing, f.removed.Vigore, x.Vigore], [2, 10, 90], '1 su 3: la penalità due volte');
  list = openApp([r], list, '2026-10-02');
  assert.deepEqual([r.streak, r.best, r.brks], [0, 4, [{ d: '2026-09-25', n: 4 }]]);
});

test('settimanale: la serie conta le settimane completate di fila, il bonus ogni N settimane', () => {
  const x = xp({});
  const r = rouP({ n: 1, bonus: { every: 2, xp: 7 } });
  let list = [];
  const got = [];
  for (const ds of ['2026-09-27', '2026-10-08', '2026-10-09']) {   // la seconda proprio all'ultimo giorno
    list = openApp([r], list, ds);
    const m = list.find(z => !z.done && z.ps <= ds);
    got.push(M.applyComplete(x, m, r, 1, at(ds)).bonus);
  }
  assert.deepEqual([r.streak, r.best], [3, 3]);
  assert.deepEqual(got.map(b => b.Vigore || 0), [0, 7, 0]);
  list = openApp([r], list, '2026-10-23');   // saltata la settimana dal 16 al 22
  assert.deepEqual([r.streak, r.brks], [0, [{ d: '2026-10-16', n: 3 }]]);
});

test('settimanale: annullare dopo la fine della settimana riporta indietro la serie', () => {
  const r = rouP({ n: 1 });
  let list = openApp([r], [], '2026-09-25');
  const w1 = list[0];
  complete(r, w1, '2026-09-30');
  list = openApp([r], list, '2026-10-02');
  assert.equal(r.streak, 1);
  undo(r, w1);
  openApp([r], list, '2026-10-03');
  assert.deepEqual([r.streak, r.brks], [0, [{ d: '2026-09-25', n: 0 }]]);
});

test('più volte al giorno: senza ora, la serie conta i giorni completi', () => {
  const r = rou({ n: 2, time: '08:00' });
  let list = openApp([r], [], '2026-03-01');
  let m = occ(list, r, '2026-03-01');
  assert.deepEqual([r.time, m.dueTime, m.n, m.ps], [null, null, 2, undefined]);
  complete(r, m, '2026-03-01');
  assert.equal(r.streak, 0, 'una su due');
  complete(r, m, '2026-03-01');
  assert.equal(r.streak, 1);
  list = openApp([r], list, '2026-03-02');
  m = occ(list, r, '2026-03-02');
  complete(r, m, '2026-03-02');
  list = openApp([r], list, '2026-03-03');
  assert.deepEqual([r.streak, r.brks], [0, [{ d: '2026-03-02', n: 1 }]], 'a metà non basta');
  const marks = M.calendarMarks(list);
  assert.deepEqual([marks.done['2026-03-01'], marks.done['2026-03-02'], marks.todo['2026-03-02']], [2, 1, 1]);
});

test('mensile: nel calendario il giorno della scadenza, e le volte fatte nel loro giorno', t => {
  now(t, '2026-09-20', '12:00');
  const r = rouP({ freq: 'm', n: 2, start: '2026-09-15', streakDate: '2026-09-14' });
  const list = openApp([r], [], '2026-09-20');
  const m = list[0];
  assert.deepEqual([m.ps, m.due], ['2026-09-15', '2026-10-14']);
  M.applyComplete(xp({}), m, r, 1, at('2026-09-20'));
  const marks = M.calendarMarks(list);
  assert.deepEqual([marks.done['2026-09-20'], marks.todo['2026-10-14'], marks.todo['2026-09-20']], [1, 1, undefined]);
  assert.deepEqual(M.dayLists(list, '2026-10-14').todo.map(x => x.id), [m.id], 'da fare nel giorno della scadenza');
  assert.deepEqual(M.plannedRoutines([r], '2026-10-15', new Set()), [], 'i periodi futuri non si mostrano');
  assert.equal(M.gcalRoutineUrl(r), null, 'niente Google Calendar');
  M.applyComplete(xp({}), m, r, 2, at('2026-09-20'));
  assert.equal(M.calendarMarks(list).done['2026-09-20'], 2, 'completata: ogni volta nel suo giorno, non una in più');
});

test('più volte: recuperare un periodo fallito ridà la serie e tiene le volte già segnate', () => {
  const x = xp({ Vigore: 100 });
  const r = rouP({ n: 2 });
  let list = openApp([r], [], '2026-09-25');
  const w1 = list[0];
  M.applyComplete(x, w1, r, 1, at('2026-09-26'));
  M.applyComplete(x, w1, r, 1, at('2026-09-27'));
  list = openApp([r], list, '2026-10-02');
  const w2 = occ(list, r, '2026-10-02');
  M.applyComplete(x, w2, r, 1, at('2026-10-03'));
  list = openApp([r], list, '2026-10-09');
  M.applyFail(x, w2, r, '2026-10-09', 1);
  assert.deepEqual([r.streak, r.brks, x.Vigore], [0, [{ d: '2026-10-02', n: 1 }], 105]);
  M.applyRevert(x, w2, r, at('2026-10-10'));
  assert.deepEqual([w2.re, w2.rj, w2.p.length, r.streak, x.Vigore], ['2026-10-10', 1, 1, 1, 110]);
  const res = M.applyComplete(x, w2, r, 1, at('2026-10-10'));
  assert.deepEqual([res.n, r.streak, !!w2.done], [2, 2, true]);
});

test('cambio di frequenza: vale dal periodo successivo, la serie resta', () => {
  const r = rou();   // ogni giorno, dal 1° marzo
  let list = [];
  for (const ds of ['2026-03-01', '2026-03-02']) { list = openApp([r], list, ds); complete(r, occ(list, r, ds), ds); }
  assert.equal(M.planChange(r, { freq: 'w', n: 2 }, '2026-03-02'), '2026-03-03', 'ogni giorno: da domani');
  assert.deepEqual([r.freq, r.nx.freq], ['d', 'w'], 'per oggi valgono ancora le regole di prima');
  list = openApp([r], list, '2026-03-03');
  assert.deepEqual([r.freq, r.n, r.at, r.days, r.nx], ['w', 2, '2026-03-03', [], undefined]);
  const w = occ(list, r, '2026-03-03');
  assert.deepEqual([w.ps, w.due, w.n], ['2026-03-03', '2026-03-09', 2]);
  assert.equal(list.length, 3, 'nessuna volta giornaliera in più');
  complete(r, w, '2026-03-05');
  complete(r, w, '2026-03-06');
  assert.deepEqual([r.streak, r.best], [3, 3], 'due giorni e poi una settimana: 3 periodi di fila');
  assert.equal(M.planChange(r, { freq: 'm', n: 1 }, '2026-03-07'), '2026-03-10', 'a metà settimana: dalla fine della settimana');
  assert.equal(M.planChange(r, { freq: 'w', n: 2 }, '2026-03-07'), '2026-03-07', 'tornare alle regole di adesso: nessun cambio');
  assert.equal(r.nx, undefined);
  openApp([r], list, '2026-03-10');
  assert.equal(r.streak, 3, 'la settimana era completa: la serie continua');
});

test('cambio di frequenza: l\'ora va con il cambio', () => {
  const r = rou({ n: 3 });   // 3 volte al giorno: senza ora
  assert.equal(M.changeAt(r, '2026-03-05'), '2026-03-06');
  M.planChange(r, { freq: 'd', n: 1, days: r.days, time: '07:00' }, '2026-03-05');
  assert.deepEqual([r.time, r.nx.time], [null, '07:00'], 'oggi ancora 3 volte, senza ora');
  let list = openApp([r], [], '2026-03-05');
  assert.equal(occ(list, r, '2026-03-05').n, 3);
  list = openApp([r], list, '2026-03-06');
  assert.deepEqual([r.n, r.time, occ(list, r, '2026-03-06').dueTime], [1, '07:00', '07:00'], 'da domani: una volta, alle 7');
  const w = rouP();
  assert.equal(M.changeAt(w, '2026-09-28'), '2026-10-02', 'settimanale: dal giorno dopo la fine della settimana');
  assert.equal(M.changeAt(w, '2026-09-20'), '2026-09-25', 'non ancora iniziata: dal primo giorno');
});

test('cambio di frequenza: una routine non ancora iniziata cambia subito', () => {
  const r = rou({ start: '2026-03-10', streakDate: '2026-03-09', time: '07:00' });
  assert.equal(M.planChange(r, { freq: 'd', n: 3, days: [1, 3] }, '2026-03-05'), '2026-03-10');
  assert.deepEqual([r.n, r.days, r.time, r.nx], [3, [1, 3], null, undefined]);
});

/* ---------- serie di gruppo per periodi ---------- */
test('serie di gruppo: settimane "tutti insieme" di fila', t => {
  const r = rouP({ sr: 'qabc1234', tz: 'Europe/Rome', bonus: { every: 2, xp: 9 } });   // settimane da venerdì 25 settembre
  assert.equal(M.prevDay(r, '2026-10-02'), '2026-09-25', 'la settimana prima');
  assert.equal(M.prevDay(r, '2026-09-25'), '', 'la prima non ha una settimana prima');
  Object.assign(r, { gs: 1, gsd: '2026-09-25' });
  const step = M.groupStep(r, '2026-10-02');
  assert.deepEqual([step.n, step.bonus], [2, { Vigore: 9 }]);
  assert.equal(M.groupStep(r, '2026-10-09').n, 1, 'saltata una settimana: si riparte');
  Object.assign(r, { gs: 2, gsd: '2026-10-02' });
  now(t, '2026-10-08', '23:00');
  assert.equal(M.lastClosedDay(r, Date.now()), '2026-09-25');
  assert.equal(M.groupStreakNow(r), 2, 'la settimana del 2 non è ancora finita');
  t.mock.timers.setTime(at('2026-10-16', '12:00'));
  assert.equal(M.lastClosedDay(r, Date.now()), '2026-10-09');
  assert.equal(M.groupStreakNow(r), 0, 'la settimana del 9 è finita senza');
});

test('serie di gruppo: a cavallo di un cambio di frequenza resta di fila', () => {
  const r = rouP({ n: 1 });
  M.planChange(r, { freq: 'm', n: 1 }, '2026-09-28');
  assert.deepEqual([r.nx.at, r.nx.pk], ['2026-10-02', '2026-09-25'], 'l\'ultima settimana prima del cambio');
  const list = M.groupPeriods(r, '2026-09-25', '2026-11-05');
  assert.deepEqual(list.map(p => p.s + '/' + p.e), ['2026-09-25/2026-10-01', '2026-10-02/2026-11-01', '2026-11-02/2026-12-01']);
  assert.equal(list[1].t.freq, 'm');
  const f = list[1].t;
  assert.equal(M.prevDay(f, '2026-10-02'), '2026-09-25', 'il primo mese viene subito dopo l\'ultima settimana');
  assert.equal(M.groupStep({ ...f, gs: 3, gsd: '2026-09-25' }, '2026-10-02').n, 4);
  // dopo il cambio la routine (non la copia) ha le stesse informazioni
  openApp([r], [], '2026-10-02');
  assert.deepEqual([r.freq, r.at, r.pk], ['m', '2026-10-02', '2026-09-25']);
  assert.equal(M.prevDay(r, '2026-10-02'), '2026-09-25');
});

test('regole a confronto: un cambio già arrivato conta come fatto', () => {
  const r = rouP({ n: 1 });
  M.planChange(r, { freq: 'm', n: 2 }, '2026-09-28');
  const doc = JSON.parse(JSON.stringify(r));   // come nel documento del gruppo: il cambio ancora \"in attesa\"
  assert.equal(M.shapeOf(r, '2026-09-28'), M.shapeOf(doc, '2026-09-28'));
  openApp([r], [], '2026-10-02');   // qui il cambio arriva
  assert.equal(r.nx, undefined);
  assert.equal(M.shapeOf(r, '2026-10-02'), M.shapeOf(doc, '2026-10-02'), 'uguali: niente da riassegnare');
  assert.notEqual(M.shapeOf(r, '2026-10-02'), M.shapeOf(rouP({ n: 1 }), '2026-10-02'));
});

test('routine salvate: i periodi del gruppo possono iniziare prima del tuo primo giorno', () => {
  const [g] = M.normalizeRoutines([{ id: 'q1', title: 'G', rewards: { Vigore: 1 }, freq: 'w', start: '2026-10-02', at: '2026-09-25', pk: '2026-09-20' }]);
  assert.deepEqual([g.at, g.pk], ['2026-09-25', '2026-09-20']);
  assert.deepEqual(M.periodAt(g, '2026-10-05'), { s: '2026-10-02', e: '2026-10-08' }, 'le settimane del gruppo');
  const list = openApp([g], [], '2026-09-30');
  assert.equal(list.length, 0, 'prima del tuo primo giorno non c\'è niente da fare');
  const d = rou({ start: '2026-03-05', at: '2026-03-01', days: [1, 3] });
  assert.equal(M.dayCounts(d, '2026-03-02'), false, 'lunedì 2: prima del tuo primo giorno');
  assert.equal(M.dayCounts(d, '2026-03-09'), true);
});

/* ---------- fusi orari (routine di gruppo) ---------- */
test('fusi orari: giorno e istante in un altro fuso', () => {
  const ms = Date.UTC(2026, 5, 10, 23, 30);   // 10 giugno, 23:30 UTC
  assert.equal(M.zoneDay(ms, 'Europe/Rome'), '2026-06-11');
  assert.equal(M.zoneDay(ms, 'America/Sao_Paulo'), '2026-06-10');
  assert.equal(M.zoneMs('2026-06-10', '18:00', 'Europe/Rome'), Date.UTC(2026, 5, 10, 16, 0), 'ora legale: UTC+2');
  assert.equal(M.zoneMs('2026-01-10', '18:00', 'Europe/Rome'), Date.UTC(2026, 0, 10, 17, 0), 'ora solare: UTC+1');
  assert.equal(M.zoneMs('2026-06-10', '13:00', 'America/Sao_Paulo'), Date.UTC(2026, 5, 10, 16, 0));
  assert.equal(M.zoneMs('2026-03-29', '02:30', 'Europe/Rome'), Date.UTC(2026, 2, 29, 1, 30), 'un\'ora che non esiste: la prima dopo');
});

test('fusi orari: la scadenza del gruppo, nell\'ora di questo dispositivo', () => {
  const r = rou({ sr: 'qabc1234', tz: 'America/Sao_Paulo', time: '13:00' });
  const due = M.groupDueMs(r, '2026-06-10');
  assert.equal(due, Date.UTC(2026, 5, 10, 16, 1));
  assert.deepEqual(M.localDue(due), { due: '2026-06-10', dueTime: '18:00' }, 'le 13:00 in Brasile sono le 18:00 in Italia');
  const allDay = rou({ sr: 'qabc1234', tz: 'Europe/Rome' });
  assert.deepEqual(M.localDue(M.groupDueMs(allDay, '2026-06-10')), { due: '2026-06-10', dueTime: null });
});

test('serie di gruppo: giorni "tutti insieme" di fila', t => {
  const r = rou({ sr: 'qabc1234', tz: 'Europe/Rome', days: [1, 3], bonus: { every: 2, xp: 9 } });   // lunedì e mercoledì
  assert.equal(M.groupStep(r, '2026-03-02').n, 1);
  Object.assign(r, { gs: 1, gsd: '2026-03-02' });
  const step = M.groupStep(r, '2026-03-04');
  assert.equal(step.n, 2, 'mercoledì dopo lunedì: di fila');
  assert.deepEqual(step.bonus, { Vigore: 9 });
  assert.equal(M.groupStep(r, '2026-03-09').n, 1, 'saltato mercoledì: si riparte');
  Object.assign(r, { gs: 2, gsd: '2026-03-04' });
  now(t, '2026-03-06', '12:00');
  assert.equal(M.groupStreakNow(r), 2);
  t.mock.timers.setTime(at('2026-03-10', '12:00'));
  assert.equal(M.groupStreakNow(r), 0, 'lunedì 9 è passato senza');
});

test('fusi orari: chi è indietro rispetto al gruppo può fare la sua volta appena inizia il giorno del gruppo', t => {
  // il gruppo è in Giappone (7 ore avanti in ottobre): il suo 2 ottobre inizia alle 17:00 del 1° ottobre in Italia
  now(t, '2026-10-01', '18:00');
  const r = rou({ sr: 'qabc1234', tz: 'Asia/Tokyo', start: '2026-10-02', streakDate: '2026-10-01' });
  const list = M.routineDay([r], [], M.todayStr(), Date.now()).missions;
  assert.equal(list.length, 1, 'la volta del 2 ottobre del gruppo c\'è già');
  const m = list[0];
  assert.deepEqual([m.gd, m.due, m.dueTime], ['2026-10-02', '2026-10-02', '16:59'], 'scade entro le 16:59 del 2 ottobre, ora italiana (la mezzanotte in Giappone)');
  assert.equal(M.notYet(m), false, 'si può completare subito, non solo da mezzanotte');
  assert.deepEqual(M.missionLists(list).groups.routine.map(x => x.id), [m.id], 'e sta tra le routine di oggi, non tra i prossimi giorni');
  const w = rouP({ sr: 'qabc1234', tz: 'Asia/Tokyo', start: '2026-10-02', streakDate: '2026-10-01' });
  const wm = M.routineDay([w], [], M.todayStr(), Date.now()).missions[0];
  assert.deepEqual([wm.ps, wm.gd, wm.due, M.notYet(wm)], ['2026-10-02', '2026-10-08', '2026-10-08', false], 'anche una settimanale');
});

/* ---------- primo giorno della settimana ---------- */
test('settimana: il primo giorno dipende dalla regione', () => {
  // numeri di Date.getDay: 0 = domenica, 1 = lunedì, 6 = sabato, 5 = venerdì
  assert.deepEqual(['IT', 'BR', 'US', 'EG', 'MV', 'DE', 'it', 'XX', ''].map(M.regionFirstDay), [1, 0, 0, 6, 5, 1, 1, 1, 1]);
  for (const useIntl of [true, false]) {
    const got = ['it-IT', 'pt-BR', 'pt', 'en', 'en-GB', 'pt-PT', 'ar-EG', 'es-MX', 'es-ES', '!!'].map(t => M.localeFirstDay(t, useIntl));
    assert.deepEqual(got, [1, 0, 0, 0, 1, 0, 6, 0, 1, 1], useIntl ? 'con Intl' : 'solo tabella (browser senza Intl)');
  }
});

test('settimana: la tabella di riserva dà gli stessi risultati del browser, per ogni regione', t => {
  const probe = new Intl.Locale('und-BR');
  if (typeof probe.getWeekInfo !== 'function' && !probe.weekInfo) { t.skip('questo Node non conosce i dati delle settimane'); return; }
  const names = new Intl.DisplayNames('en', { type: 'region' });
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', diff = [];
  let n = 0;
  for (const a of A) for (const b of A) {
    const r = a + b;
    let known = false;
    try { known = names.of(r) !== r; } catch (e) { /* non è una regione */ }
    if (!known) continue;
    n++;
    if (M.localeFirstDay('und-' + r) !== M.localeFirstDay('und-' + r, false)) diff.push(r);
  }
  assert.ok(n > 200, 'regioni provate: ' + n);
  assert.deepEqual(diff, [], 'regioni in cui la tabella va aggiornata');
});

test('settimana: in automatico segue la lingua dell\'app', () => {
  const byLang = Object.fromEntries(LANGS.map(l => [l.id, M.firstDayOf('auto', l.locale)]));
  assert.deepEqual(byLang, { it: 1, en: 0, 'pt-BR': 0 }, 'italiano: lunedì; inglese e portoghese del Brasile: domenica');
});

test('settimana: la scelta delle impostazioni vince sulla lingua', () => {
  assert.equal(M.firstDayOf(1, 'pt-BR'), 1);
  assert.equal(M.firstDayOf(0, 'it-IT'), 0);
  assert.equal(M.firstDayOf(6, 'it-IT'), 6);
  assert.equal(M.firstDayOf('auto', 'pt-BR'), 0);
  assert.equal(M.firstDayOf('auto', 'it-IT'), 1);
  assert.equal(M.firstDayOf(3, 'it-IT'), 1, 'una scelta non valida vale come automatico');
  assert.deepEqual(M.WEEK_PREFS, ['auto', 1, 0, 6]);
});

test('settimana: ordine dei giorni, inizio della settimana, caselle vuote del calendario', () => {
  assert.deepEqual(M.weekOrder(1), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(M.weekOrder(0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(M.weekOrder(6), [6, 0, 1, 2, 3, 4, 5]);
  // sabato 26 settembre 2026
  assert.equal(M.weekStart('2026-09-26', 1), '2026-09-21');
  assert.equal(M.weekStart('2026-09-26', 0), '2026-09-20');
  assert.equal(M.weekStart('2026-09-26', 6), '2026-09-26');
  assert.equal(M.weekStart('2026-01-01', 1), '2025-12-29', 'a cavallo dell\'anno');
  assert.equal(M.weekStart('2026-03-01', 1), '2026-02-23', 'a cavallo del mese');
  // il 1° settembre 2026 è martedì
  assert.equal(M.calOffset(2026, 8, 1), 1, 'da lunedì: una casella vuota');
  assert.equal(M.calOffset(2026, 8, 0), 2, 'da domenica: due');
  assert.equal(M.calOffset(2026, 8, 6), 3, 'da sabato: tre');
  assert.equal(M.calOffset(2026, 1, 0), 0, 'febbraio 2026 inizia di domenica');
});

/* ---------- calendario e Google Calendar ---------- */
test('calendario: routine previste nei giorni futuri', t => {
  now(t, '2026-03-10', '12:00');
  const r = rou({ days: [3] });   // mercoledì
  assert.deepEqual(M.plannedRoutines([r], '2026-03-11', new Set()).map(x => x.id), ['r1']);
  assert.deepEqual(M.plannedRoutines([r], '2026-03-12', new Set()), []);
  assert.deepEqual(M.plannedRoutines([r], '2026-03-11', new Set([M.occId(r, '2026-03-11')])), [], 'esiste già');
  assert.deepEqual(M.plannedRoutines([r], '2026-03-10', new Set()), [], 'oggi e prima no');
});

test('Google Calendar: missione, routine e routine di gruppo', t => {
  now(t, '2026-03-10', '12:00');
  const u = M.gcalUrl(mis({ title: 'Palestra & sauna', due: '2026-03-12', dueTime: '23:45', desc: 'Braccia' }));
  assert.match(u, /text=Palestra%20%26%20sauna/);
  assert.match(u, /dates=20260312T234500\/20260313T001500/, 'mezz\'ora, anche oltre la mezzanotte');
  assert.match(u, /details=Braccia/);
  assert.match(M.gcalUrl(mis({ due: '2026-03-12' })), /dates=20260312\/20260313/, 'senza ora: tutto il giorno');
  const weekly = M.gcalRoutineUrl(rou({ days: [0, 3, 1], time: '07:00' }));
  assert.match(weekly, /dates=20260311T070000/, 'dal primo giorno previsto: mercoledì 11');
  assert.match(decodeURIComponent(weekly), /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,SU/);
  assert.doesNotMatch(weekly, /ctz=/);
  assert.match(decodeURIComponent(M.gcalRoutineUrl(rou())), /RRULE:FREQ=DAILY/);
  const group = M.gcalRoutineUrl(rou({ sr: 'qabc1234', tz: 'Europe/Rome', time: '18:00' }));
  assert.match(group, /ctz=Europe%2FRome/, 'routine di gruppo: con il fuso del gruppo');
});
