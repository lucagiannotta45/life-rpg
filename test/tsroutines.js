/*
 * Life RPG — test delle routine di gruppo (shared-routines.js) con settimane, mesi e più volte per periodo
 * Il vero shared-routines.js gira con un Firebase finto: i documenti arrivano dalla copia salvata (localStorage),
 * come all'apertura dell'app, e le scritture si registrano invece di andare al server. Così si prova quello che
 * fa l'app di un invitato e di chi ha creata la routine, senza rete e senza account.
 * (Le regole di Firebase, firestore.rules, qui non si provano: servirebbe l'emulatore di Firebase.)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { MISSIONS: M, T, at } = require('./carica');
require(path.join(__dirname, '..', 'shared-routines.js'));

const LS = 'liferpg:sroutines:v1';
const ID = 'qabc1234';

// un Firebase finto: niente ascolto dal server, le scritture finiscono in \"writes\"
function fakeWorld(uid, doc) {
  const store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  store[LS] = JSON.stringify({ uid, docs: { [ID]: doc } });
  const writes = [];
  const ref = id => ({
    update: data => { writes.push({ id, data }); return Promise.resolve(); },
    set: data => { writes.push({ id, set: data }); return Promise.resolve(); },
    delete: () => Promise.resolve(),
    get: () => Promise.resolve({ exists: true, data: () => doc }),
  });
  global.window.firebase = { firestore: { FieldValue: {
    serverTimestamp: () => 'ORA_DEL_SERVER', delete: () => 'TOGLI', arrayUnion: (...a) => a, arrayRemove: (...a) => a,
  } } };
  const S = {
    fbUser: { uid }, dbRef: {}, routines: [], missions: [],
    fbDb: { collection: () => ({ where: () => ({ onSnapshot: () => () => {} }), doc: ref }) },
  };
  const bonuses = [];
  const saves = { n: 0 };   // quante volte l'app salverebbe le routine
  const D = {
    T, MISSIONS: M, sfx() {}, touchMonth() {}, lsSet: (k, v) => localStorage.setItem(k, v), saveRoutinesLocal() { saves.n++; },
    MUI: {
      syncRoutines: () => { const res = M.routineDay(S.routines, S.missions, M.todayStr()); S.missions = res.missions; return res.changed; },
      renderMissionViews() {}, renderRoutines() {}, missionMsg() {}, rmodal: null,
      groupBonus: (m, bonus, n) => { bonuses.push({ id: m.id, bonus, n }); m.done.gb = n; return true; },
    },
    SH: { joinNames: l => l.join(', '), myName: () => 'Io' },
  };
  const SR = window.LIFE_RPG_SHARED_ROUTINES.create(D, S);
  SR.start();
  return { SR, S, writes, bonuses, saves };
}

// una routine di gruppo da 3 volte a settimana, creata da Anna (uO) venerdì 25 settembre 2026; io sono uG
const baseDoc = extra => ({
  v: 1, owner: 'uO', ownerName: 'Anna', members: ['uO', 'uG'],
  g: { uG: { n: 'Io', j: true, a: 1, since: '2026-09-25' } },
  // (ricompense e penalità come le scrive l'app: con tutte le statistiche)
  title: 'Palestra', desc: '', rewards: M.normalizeRewards({ Vigore: 10 }), penalty: M.normalizeRewards({ Vigore: 2 }), stars: null,
  days: [], time: null, start: '2026-09-25', bonus: { every: 2, xp: 5 }, tz: 'Europe/Rome',
  ver: 1, k: {}, lk: '', created: 1, updated: 1, freq: 'w', n: 3, ...extra,
});
const now = (t, ds, time = '12:00') => t.mock.timers.enable({ apis: ['Date'], now: at(ds, time) });

test('invitato: entrando a metà settimana conta dalla settimana dopo, con le settimane del gruppo', t => {
  now(t, '2026-09-30');
  const { SR, S } = fakeWorld('uG', baseDoc({ g: { uG: { n: 'Io', j: true, a: 1, since: '2026-09-30' } } }));
  SR.evaluate();
  const r = S.routines[0];
  assert.deepEqual([r.id, r.sh, r.freq, r.n, r.start, r.at], [ID, 'g', 'w', 3, '2026-10-02', '2026-09-25']);
  assert.equal(S.missions.length, 0, 'questa settimana non tocca a me');
  t.mock.timers.setTime(at('2026-10-02', '08:00'));
  SR.evaluate();
  D_sync(S);
  const m = S.missions[0];
  assert.deepEqual([m.id, m.ps, m.due, m.gd, m.n], [ID + '-20261002', '2026-10-02', '2026-10-08', '2026-10-08', 3]);
});
// il \"giro di oggi\" come lo fa l'app
function D_sync(S) { const res = M.routineDay(S.routines, S.missions, M.todayStr()); S.missions = res.missions; }

test('invitato: la mia parte si segna solo con "Completa", sul primo giorno della settimana', t => {
  now(t, '2026-09-26');
  const { SR, S, writes } = fakeWorld('uG', baseDoc());
  SR.evaluate();
  D_sync(S);
  const r = S.routines[0], m = S.missions[0];
  const x = M.normalizeRewards(null);
  M.applySetCount(m, 2);
  assert.equal(writes.length, 0, 'scrivere il numero non tocca il gruppo');
  M.applySetCount(m, 3);
  const res = M.applyComplete(x, m, r, 1);
  if (!res.partial) SR.markPart(r, m, true);   // come fa l'app (grant): solo quando la completi
  assert.equal(writes.length, 1, 'una sola scrittura, con "Completa"');
  assert.deepEqual(writes[0].data['k.20260925.uG'], 'ORA_DEL_SERVER');
  assert.equal(writes[0].data.lk, '20260925');
});

test('serie di gruppo: settimane completate da tutti in tempo, con il bonus ogni 2', t => {
  now(t, '2026-10-12');
  const k = {
    20260925: { uO: at('2026-09-26'), uG: at('2026-10-01', '23:00') },
    20261002: { uO: at('2026-10-03'), uG: at('2026-10-08', '20:00') },
    20261009: { uO: at('2026-10-10') },   // manca la mia (è ancora in corso)
  };
  const { SR, S, bonuses } = fakeWorld('uG', baseDoc({ k }));
  SR.evaluate();
  const r = S.routines[0];
  assert.deepEqual([r.gs, r.gsd, r.gbest], [2, '2026-10-02', 2]);
  assert.equal(bonuses.length, 0, 'bonus solo per una volta completata qui (le volte vecchie non ci sono)');
  assert.equal(M.groupStreakNow(r), 2);
  const info = SR.occInfo({ id: ID + '-20261009', rid: ID, ps: '2026-10-09', gd: '2026-10-15', due: '2026-10-15' });
  assert.deepEqual([info.inGroup, info.together, info.doneCount], [true, false, 1], 'Anna ha già completato la settimana');
});

test('serie di gruppo: una parte arrivata dopo la fine della settimana non conta', t => {
  now(t, '2026-10-12');
  const k = { 20260925: { uO: at('2026-09-26'), uG: at('2026-10-02', '00:30') } };
  const { SR, S } = fakeWorld('uG', baseDoc({ k }));
  SR.evaluate();
  assert.equal(S.routines[0].gs, undefined);
});

test('serie di gruppo: il bonus arriva sulla volta completata della settimana che lo fa scattare', t => {
  now(t, '2026-10-08', '21:00');
  const k = {
    20260925: { uO: at('2026-09-26'), uG: at('2026-09-27') },
    20261002: { uO: at('2026-10-03'), uG: at('2026-10-08', '20:00') },
  };
  const { SR, S, bonuses } = fakeWorld('uG', baseDoc({ k }));
  SR.evaluate();
  D_sync(S);
  const m = S.missions.find(x => x.id === ID + '-20261002');
  m.p = ['2026-10-04', '2026-10-06', '2026-10-08'];
  m.done = { date: '2026-10-08', t: 1, applied: M.normalizeRewards({ Vigore: 10 }) };
  const r = S.routines[0];
  delete r.gs; delete r.gsd;
  SR.evaluate();
  assert.deepEqual(bonuses.map(b => [b.id, b.n, b.bonus.Vigore]), [[ID + '-20261002', 2, 5]]);
});

test('cambio di frequenza del gruppo: arriva a tutti lo stesso giorno, senza riassegnare di continuo', t => {
  now(t, '2026-09-28');
  const nx = { at: '2026-10-02', freq: 'm', n: 1, days: [], time: null, pk: '2026-09-25' };
  const { SR, S, saves } = fakeWorld('uG', baseDoc({ nx, ver: 2, g: { uG: { n: 'Io', j: true, a: 2, since: '2026-09-25' } } }));
  SR.evaluate();
  const r = S.routines[0];
  assert.deepEqual(r.nx, nx, 'il cambio in attesa arriva anche a me');
  t.mock.timers.setTime(at('2026-10-02', '08:00'));
  D_sync(S);
  assert.deepEqual([r.freq, r.n, r.at, r.pk, r.nx], ['m', 1, '2026-10-02', '2026-09-25', undefined]);
  const before = JSON.stringify(r), saved = saves.n;
  SR.evaluate();
  SR.evaluate();
  assert.equal(JSON.stringify(r), before, 'il documento ha ancora il cambio \"in attesa\": per me è già fatto, niente cambia');
  assert.equal(saves.n, saved, 'e niente da salvare');
  assert.ok(S.missions.some(m => m.id === ID + '-20261002' && m.due === '2026-11-01'), 'il primo mese');
});

test('chi l\'ha creata: cambiare il titolo non fa riaccettare niente, cambiare la frequenza sì', t => {
  now(t, '2026-10-05');
  const nx = { at: '2026-10-02', freq: 'm', n: 1, days: [], time: null, pk: '2026-09-25' };
  const doc = baseDoc({ nx, ver: 2, g: { uG: { n: 'Io', j: true, a: 2, since: '2026-09-25' } } });
  const { SR, S, writes } = fakeWorld('uO', doc);
  // la mia routine ha già applicato il cambio (il documento no)
  const r = M.normalizeRoutines([{ id: 'r1', title: 'Palestra', rewards: { Vigore: 10 }, penalty: { Vigore: 2 }, freq: 'm', n: 1,
    start: '2026-09-25', at: '2026-10-02', pk: '2026-09-25', bonus: { every: 2, xp: 5 }, sr: ID, sh: 'o', tz: 'Europe/Rome' }])[0];
  S.routines.push(r);
  r.title = 'Palestra e piscina';
  SR.afterEdit(r);
  assert.equal(writes.length, 1);
  const w = writes[0].data;
  assert.equal(w.title, 'Palestra e piscina');
  assert.deepEqual(['freq', 'n', 'days', 'time', 'at', 'pk', 'nx'].filter(k => k in w), [], 'le regole uguali non si riscrivono');
  assert.equal(w.ver, 2, 'nessuna versione nuova');
  M.planChange(r, { freq: 'w', n: 2 }, '2026-10-05');
  SR.afterEdit(r);
  const w2 = writes[1].data;
  assert.deepEqual([w2.freq, w2.at, w2.nx.freq, w2.nx.at, w2.ver], ['m', '2026-10-02', 'w', '2026-11-02', 3]);
});

test('chi l\'ha creata: un gruppo nuovo di una routine di ogni giorno, una volta, non scrive i campi nuovi', async t => {
  now(t, '2026-10-05');
  const r = M.normalizeRoutines([{ id: 'r2', title: 'Corsa', rewards: { Vigore: 4 }, days: [1, 3], start: '2026-10-05' }])[0];
  // sendInvite non è esportato: si passa da openInvite, con una scelta degli amici finta che invia subito
  const SHfake = { pickFriends: o => o.send([{ uid: 'uF', name: 'Marco' }]), joinNames: l => l.join(', '), myName: () => 'Anna' };
  const W = fakeWorldWithSH('uO', SHfake);
  W.S.routines.push(r);
  await W.SR.openInvite(r.id);
  const created = W.writes.find(x => x.set);
  assert.ok(created, 'documento creato');
  assert.deepEqual(['freq', 'n', 'at', 'pk', 'nx', 'pause'].filter(k => k in created.set), [], 'senza i campi nuovi e senza la pausa');
  const r3 = M.normalizeRoutines([{ id: 'r3', title: 'Bollette', rewards: { Vigore: 4 }, freq: 'm', start: '2026-10-05' }])[0];
  W.S.routines.push(r3);
  await W.SR.openInvite(r3.id);
  const c3 = W.writes.filter(x => x.set)[1].set;
  assert.deepEqual([c3.freq, c3.n, c3.days], ['m', 1, []]);
});
// come fakeWorld, ma con un SH scelto dal test (per gli inviti)
function fakeWorldWithSH(uid, SH) {
  const w = fakeWorld(uid, baseDoc());
  const D = {
    T, MISSIONS: M, sfx() {}, touchMonth() {}, lsSet: (k, v) => localStorage.setItem(k, v), saveRoutinesLocal() {},
    MUI: { syncRoutines: () => false, renderMissionViews() {}, renderRoutines() {}, missionMsg() {}, rmodal: null, groupBonus: () => true },
    SH,
  };
  const SR = window.LIFE_RPG_SHARED_ROUTINES.create(D, w.S);
  SR.start();
  return { SR, S: w.S, writes: w.writes };
}
