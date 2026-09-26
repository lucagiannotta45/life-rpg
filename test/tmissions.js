/*
 * Life RPG — test delle regole di missioni e routine (missions.js)
 * Date, stelle e XP, dati salvati, scadenze, elenchi, routine (giorni, serie, bonus, recuperi),
 * fusi orari delle routine di gruppo, Google Calendar.
 *
 * L'ora "di adesso" si fissa con t.mock.timers: così i test non dipendono da quando li lanci.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSIONS: M, GAME, at } = require('./carica');
const { MAX_XP, blank } = GAME;

const xp = o => Object.assign(blank(), o);
const now = (t, ds, time) => t.mock.timers.enable({ apis: ['Date'], now: at(ds, time) });
// una missione valida, con i campi che servono al test
const mis = o => M.normalizeMissions([{ id: 'm1', title: 'Prova', rewards: { Vigore: 10 }, created: '2026-03-01', ...o }])[0];
// una routine di tutti i giorni dal 1° marzo, con i campi che servono al test
const rou = o => M.normalizeRoutines([{ id: 'r1', title: 'Corsa', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  days: [0, 1, 2, 3, 4, 5, 6], start: '2026-03-01', streakDate: '2026-02-28', ...o }])[0];

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

test('routine salvate: giorni, bonus, pausa, giorni mancati', () => {
  const [r] = M.normalizeRoutines([{ id: 'r1', title: 'Corsa', rewards: { Vigore: 10 }, days: [3, 1, 1, 9, 'x'], start: '2026-03-01',
    bonus: { every: 1, xp: 5 }, pause: { from: '2026-03-10', until: '2026-03-05' }, gc: true,
    brks: [{ d: '2026-03-09', n: 2 }, { d: '2026-03-03', n: 5 }, { d: '2026-03-03', n: 1 }, { d: 'boh', n: 1 }, { d: '2026-03-04', n: -1 }] }]);
  assert.deepEqual(r.days, [1, 3]);
  assert.equal(r.bonus, null, 'un bonus ogni 1 volta non vale');
  assert.equal(r.pause, null, 'pausa al contrario');
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
  const r = rou({ days: [1, 3], pause: { from: '2026-03-09', until: '2026-03-15' } });   // lunedì e mercoledì
  assert.equal(M.dayCounts(r, '2026-03-02'), true, 'lunedì');
  assert.equal(M.dayCounts(r, '2026-03-03'), false, 'martedì');
  assert.equal(M.dayCounts(r, '2026-03-09'), false, 'lunedì, ma in pausa');
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

test('routine: la pausa toglie le volte ancora da fare, la cronologia vecchia si pulisce', () => {
  const r = rou({ made: '2026-03-04' });
  let list = openApp([r], [], '2026-03-05');
  r.pause = { from: '2026-03-05', until: '2026-03-06' };
  list = openApp([r], list, '2026-03-05');
  assert.equal(list.length, 0);
  const old = mis({ id: 'old', rid: 'r1', due: '2026-01-01', done: { date: '2026-01-01', applied: {} } });
  list = openApp([rou({ made: '2026-03-20' })], [old], '2026-03-20');
  assert.equal(list.find(m => m.id === 'old'), undefined, 'più vecchia di 60 giorni');
  r.pause = { from: '2026-03-01', until: '2026-03-02' };
  openApp([r], [], '2026-03-05');
  assert.equal(r.pause, null, 'la pausa finita si toglie');
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
