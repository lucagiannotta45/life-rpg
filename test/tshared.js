/*
 * Life RPG — test delle missioni condivise (shared.js): "Salta" (nel codice: withdraw)
 * Chi si ritira (prima della scadenza, senza aver fatto la sua parte) esce senza XP e senza penalità; la missione
 * continua per gli altri. Se si ritira chi l'ha creata la missione resta com'è (non la modifica più nessuno).
 * Quando resta una persona sola, la missione diventa una sua missione normale.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { MISSIONS: M, GAME, T } = require('./carica');
require(path.join(__dirname, '..', 'shared.js'));

const LS = 'liferpg:shared:v1';
const SID = 'sabc12345';
const DUE = Date.now() + 3 * 86400000;   // fra tre giorni

// il documento di una missione condivisa: chi l'ha creata (uO) e gli amici in g (members nello stesso ordine)
const baseDoc = (g, extra) => ({
  v: 2, owner: 'uO', ownerName: 'Anna', members: ['uO'].concat(Object.keys(g)), g,
  title: 'Trasloco', desc: '', rewards: { Vigore: 10 }, penalty: { Vigore: 5 }, stars: null,
  dueAt: DUE, fromAt: null, tz: 'Europe/Rome', oDue: null, oDueTime: null, oFrom: null, oFromTime: null,
  ver: 1, oDone: null, left: '', seenO: false, created: Date.now(), updated: Date.now(), ...extra,
});
const guest = (n, o) => ({ n, j: true, a: 1, d: null, s: false, ...o });

// un elemento della pagina finto: qualunque metodo non fa niente
// (non è "thenable": then e i simboli non ci sono)
const fakeEl = () => new Proxy({}, {
  get: (o, k) => (k in o ? o[k] : typeof k === 'symbol' || k === 'then' ? undefined : () => fakeEl()),
  set: (o, k, v) => { o[k] = v; return true; },
});
// dopo ogni test: via i timer (scadenze) e i dati
const worlds = [];
test.afterEach(() => { worlds.splice(0).forEach(w => w.SH.reset()); });
// un Firebase finto: niente ascolto dal server, le scritture finiscono in "writes"
function fakeWorld(uid, doc, missions) {
  const store = { [LS]: JSON.stringify({ uid, docs: { [SID]: doc } }) };
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  const writes = [], msgs = [], deleted = [];
  const ctl = { fail: null };   // ctl.fail = { code }: la prossima scrittura il server la rifiuta con quell'errore
  const ref = id => ({
    update: data => {
      if (ctl.fail) { const e = ctl.fail; ctl.fail = null; return Promise.reject(e); }
      writes.push({ id, data }); return Promise.resolve();
    },
    set: data => { writes.push({ id, set: data }); return Promise.resolve(); },
    delete: () => { deleted.push(id); return Promise.resolve(); },
    get: () => Promise.resolve({ exists: true, data: () => doc }),
  });
  global.window.firebase = { firestore: { FieldValue: {
    serverTimestamp: () => 'ORA_DEL_SERVER', delete: () => 'TOGLI', arrayUnion: (...a) => ({ union: a }), arrayRemove: (...a) => ({ remove: a }),
  } } };
  const S = {
    fbUser: { uid }, dbRef: {}, routines: [], missions: missions || [], settings: { name: uid === 'uO' ? 'Anna' : 'Io' },
    fbDb: { collection: () => ({ where: () => ({ onSnapshot: () => () => {} }), doc: ref }) },
  };
  const D = {
    T, MISSIONS: M, GAME, $: () => fakeEl(), mk: () => fakeEl(), sfx() {}, openModal() {}, closeModal() {}, touchMonth() {},
    tombMissions() {}, lsSet: (k, v) => localStorage.setItem(k, v), friendsList: () => [], loadFriendsList() {}, fbConnect() {},
    MUI: {
      missionMsg: (text) => msgs.push(text), renderMissionViews() {}, grantShared: () => true, failShared: () => true,
      fmtDay: d => d, completeMission() {},
    },
  };
  const SH = window.LIFE_RPG_SHARED.create(D, S);
  SH.start();
  const W = { SH, S, writes, msgs, deleted, ctl };
  worlds.push(W);
  return W;
}
// la tua copia della missione (come nell'elenco)
const myCopy = role => ({ id: SID, title: 'Trasloco', desc: '', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  due: '2030-01-01', created: '2026-10-01', done: null, failed: null, sid: SID, sh: role });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

test('invitato: salta, esce dal documento con il suo nome in wd, e la missione resta nella sua cronologia come saltata', async () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca') });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  assert.equal(W.SH.info(W.S.missions[0]).canWithdraw, true);
  await W.SH.withdraw(SID);
  const w = W.writes.at(-1).data;
  assert.deepEqual([w['g.uG'], w.members, w['wd.uG']], ['TOGLI', { remove: ['uG'] }, 'Io']);
  const m = W.S.missions[0];
  assert.deepEqual([!!m.done, m.done.sk, m.done.applied.Vigore], [true, 1, 0], 'finita come saltata, niente XP');
  assert.equal(m.sid, SID, 'con l\'etichetta della condivisione');
  const cal = M.calendarMarks(W.S.missions);
  assert.deepEqual([cal.skip[m.done.date], cal.done[m.done.date]], [1, undefined], 'nel calendario: saltata, non completata');
  const day = M.dayLists(W.S.missions, m.done.date);
  assert.deepEqual([day.skipped.length, day.done.length], [1, 0]);
});

test('invitato: dopo aver fatto la sua parte non si ritira più', () => {
  const doc = baseDoc({ uG: guest('Io', { d: Date.now() }), uH: guest('Luca') });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  assert.equal(W.SH.canWithdrawIn(doc), false);
});

test('chi l\'ha creata: si ritira, resta nel documento con ow; chi è dentro e gli inviti senza risposta restano', async () => {
  const doc = baseDoc({ uG: guest('Marco'), uH: guest('Luca', { j: false, a: 0 }) });
  const W = fakeWorld('uO', doc, [myCopy('o')]);
  assert.equal(W.SH.info(W.S.missions[0]).canWithdraw, true);
  await W.SH.withdraw(SID);
  const w = W.writes.at(-1).data;
  assert.deepEqual(Object.keys(w).sort(), ['ow', 'updated'], 'solo ow: nessuno viene tolto');
  assert.equal(w.ow, 'ORA_DEL_SERVER', 'con l\'ora del server (da lì si contano le 24 ore degli inviti)');
  assert.equal(W.S.missions[0].done.sk, 1, 'nella sua cronologia: saltata');
});

test('invito a una missione da cui chi l\'ha creata si è ritirato: l\'invitato lo sa prima di scegliere', () => {
  const doc = baseDoc({ uG: guest('Marco'), uL: guest('Io', { j: false, a: 0 }) }, { ow: true });
  const W = fakeWorld('uL', doc, []);
  const [x] = W.SH.invites();
  assert.deepEqual([x.frozen, x.from, x.inside], [true, 'Anna', 'Marco']);
});

test('chi l\'ha creata si è ritirato, resta un amico ma c\'è un invito in attesa: la missione resta condivisa', async () => {
  const doc = baseDoc({ uG: guest('Io'), uL: guest('Luca', { j: false, a: 0 }) }, { ow: true });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  await flush();
  assert.equal(W.S.missions[0].sid, SID, 'si aspetta la risposta di Luca');
  assert.deepEqual(W.deleted, []);
});

test('chi l\'ha creata si è ritirato: la missione resta com\'è e la finiscono gli altri', () => {
  const doc = baseDoc({ uG: guest('Io', { d: Date.now() }), uH: guest('Luca', { d: Date.now() }) }, { ow: true });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  const i = W.SH.info(W.S.missions[0]);
  assert.deepEqual([i.frozen, i.withdrawnNames, i.name], [true, 'Anna', 'Luca'], 'Anna non partecipa più; con Luca');
  assert.equal(W.SH.outcome(doc), 'done', 'la parte di chi si è ritirato non serve');
  const doc2 = baseDoc({ uG: guest('Io', { d: Date.now() }), uH: guest('Luca') }, { ow: true });
  assert.equal(W.SH.outcome(doc2), 'open', 'manca ancora Luca');
});

test('gli amici che si sono ritirati si vedono sulla scheda degli altri', () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca') }, { wd: { uM: 'Marco' } });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  const i = W.SH.info(W.S.missions[0]);
  assert.deepEqual([i.withdrawnNames, i.withdrawnCount, i.frozen], ['Marco', 1, false]);
});

test('resta solo un invitato (chi l\'ha creata si è ritirato): la missione diventa sua e il documento si elimina', async () => {
  const doc = baseDoc({ uG: guest('Io') }, { ow: true, wd: { uH: 'Luca' } });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  await flush();
  const m = W.S.missions[0];
  assert.deepEqual([m.sid, m.sh, m.done, m.failed], [undefined, undefined, null, null], 'una sua missione normale, ancora da fare');
  assert.deepEqual(W.deleted, [SID]);
  assert.ok(W.msgs.some(x => /solo tua/.test(x)));
});

test('resta solo chi l\'ha creata (gli amici si sono ritirati tutti): la missione torna sua', async () => {
  const doc = baseDoc({}, { wd: { uG: 'Marco' } });
  const W = fakeWorld('uO', doc, [myCopy('o')]);
  W.SH.evaluate();
  await flush();
  assert.equal(W.S.missions[0].sid, undefined);
  assert.deepEqual(W.deleted, [SID]);
});

test('chi l\'ha creata si è ritirato e non è rimasto nessuno: elimina il documento rimasto', async () => {
  const doc = baseDoc({}, { ow: true });
  const W = fakeWorld('uO', doc, []);
  W.SH.evaluate();
  await flush();
  assert.deepEqual(W.deleted, [SID]);
});

test('chi l\'ha creata e si è ritirato non modifica più la missione né invita altri', () => {
  const doc = baseDoc({ uG: guest('Marco') }, { ow: true });
  const W = fakeWorld('uO', doc, [myCopy('o')]);
  const m = W.S.missions[0];
  assert.ok(W.SH.editBlock(m), 'modifica bloccata');
  assert.equal(W.SH.canInvite(m), false);
  assert.equal(W.SH.canWithdrawIn(doc), false, 'già ritirato');
});

test('fallita: chi si è ritirato non compare tra chi non ha fatto la sua parte', () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca', { d: Date.now() }) }, { ow: true, dueAt: Date.now() - 600000, _srv: Date.now() });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  assert.equal(W.SH.outcome(doc), 'failed');
  assert.deepEqual(W.SH.failInfo(doc), { kind: 'mine', name: 'Luca' }, 'manca solo la mia parte; Anna non c\'entra');
});

/* ---------- inviti di una missione da cui chi l'ha creata si è ritirato: scadono dopo 24 ore ---------- */
const HOUR = 3600000;
test('inviti dopo il ritiro di chi l\'ha creata: validi per 24 ore, poi scadono', () => {
  const recent = baseDoc({ uG: guest('Marco'), uL: guest('Io', { j: false, a: 0 }) }, { ow: Date.now() - 23 * HOUR });
  const W1 = fakeWorld('uL', recent, []);
  assert.equal(W1.SH.invites().length, 1, 'dopo 23 ore l\'invito c\'è ancora');
  const old = baseDoc({ uG: guest('Marco'), uL: guest('Io', { j: false, a: 0 }) }, { ow: Date.now() - 25 * HOUR });
  const W2 = fakeWorld('uL', old, []);
  assert.equal(W2.SH.invites().length, 0, 'dopo 25 ore è scaduto');
  assert.equal(W2.SH.invitesExpired(old), true);
});

test('resta un solo amico e l\'invito in attesa è scaduto: la missione diventa sua', async () => {
  const doc = baseDoc({ uG: guest('Io'), uL: guest('Luca', { j: false, a: 0 }) }, { ow: Date.now() - 25 * HOUR });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  await flush();
  assert.equal(W.S.missions[0].sid, undefined, 'non si aspetta più Luca');
  assert.deepEqual(W.deleted, [SID]);
});

test('resta un solo amico e l\'invito in attesa è di meno di 24 ore fa: si aspetta ancora', async () => {
  const doc = baseDoc({ uG: guest('Io'), uL: guest('Luca', { j: false, a: 0 }) }, { ow: Date.now() - 2 * HOUR });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  await flush();
  assert.equal(W.S.missions[0].sid, SID);
  assert.deepEqual(W.deleted, []);
});

test('ritiro appena fatto (ora del server come arriva da Firebase): l\'invito vale', () => {
  const doc = baseDoc({ uG: guest('Marco'), uL: guest('Io', { j: false, a: 0 }) }, { ow: { toMillis: () => Date.now() } });
  const W = fakeWorld('uL', doc, []);
  assert.equal(W.SH.invites().length, 1);
});

test('avviso: quando qualcuno salta, gli altri lo sanno una volta sola', () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca') }, { wd: { uM: 'Marco' } });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  W.SH.evaluate();
  assert.deepEqual(W.msgs.filter(x => /Marco/.test(x)).length, 1);
  assert.match(W.msgs[0], /Marco ha saltato Trasloco/);
});

test('avviso: se salta chi l\'ha creata, gli altri sanno che la missione resta com\'è', () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca') }, { ow: Date.now() });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  W.SH.evaluate();
  assert.ok(W.msgs.some(x => /Anna ha saltato Trasloco: la missione resta/.test(x)));
});

test('dati: una missione condivisa saltata resta saltata quando si salva e si rilegge', () => {
  const m = M.normalizeMissions([{ ...myCopy('g'), done: { date: '2026-10-05', t: 1, applied: {}, sk: 1 } }])[0];
  assert.equal(m.done.sk, 1);
});

test('chi ha saltato si può invitare di nuovo: accettando, il salto si annulla e la missione torna da fare', () => {
  // chi l'ha creata vede Luca (che aveva saltato) tra gli amici da invitare
  const doc0 = baseDoc({ uG: guest('Marco') }, { wd: { uH: 'Luca' } });
  const W0 = fakeWorld('uO', doc0, [myCopy('o')]);
  assert.deepEqual(W0.SH.notInvitable(doc0), ['uG']);
  // Luca ha accettato il nuovo invito: la sua missione "saltata" torna da fare
  const doc = baseDoc({ uG: guest('Marco'), uH: guest('Io', { a: 2 }) }, { ver: 2, wd: { uH: 'Io' } });
  const mine = { ...myCopy('g'), done: { date: '2026-10-01', t: 1, applied: { Vigore: 0 }, sk: 1 } };
  const W = fakeWorld('uH', doc, [mine]);
  W.SH.evaluate();
  const m = W.S.missions[0];
  assert.deepEqual([m.done, m.sid, m.sh], [null, SID, 'g']);
  assert.ok(W.msgs.some(x => /di nuovo dentro/.test(x)));
  const W2 = fakeWorld('uG', doc, [myCopy('g')]);
  assert.equal(W2.SH.info(W2.S.missions[0]).withdrawnCount, 0, 'per Marco Luca non risulta più tra chi ha saltato');
});

test('invitare altri amici non fa riaccettare niente a chi è già dentro', async () => {
  const doc = baseDoc({ uG: guest('Marco') });
  const W = fakeWorld('uO', doc, [myCopy('o')]);
  await W.SH.sendMission(W.S.missions[0], [{ uid: 'uL', name: 'Lia' }]);
  const w = W.writes.at(-1).data;
  assert.equal('ver' in w, false, 'la versione non cambia: Marco resta dentro con le regole di prima');
  assert.deepEqual(w.members, { union: ['uL'] });
  assert.equal(w['g.uL'].j, false);
});

/* ---------- la modifica di chi l'ha creata vale solo se arriva nel documento ---------- */
test('chi l\'ha creata: la modifica resta "da mandare" finché il server non la conferma', async () => {
  const W = fakeWorld('uO', baseDoc({ uG: guest('Io') }), [myCopy('o')]);
  const L = W.S.missions[0];
  Object.assign(L, { title: 'Trasloco grande', rewards: M.normalizeRewards({ Vigore: 20 }) });
  W.SH.afterEdit(L);
  assert.equal(L.shd, 1);
  assert.deepEqual([W.writes[0].data.title, W.writes[0].data.ver], ['Trasloco grande', 2], 'XP cambiati: versione nuova');
  await flush();
  assert.equal(L.shd, undefined, 'confermata');
  // riletta dal salvataggio, una modifica ancora da mandare resta tale
  const [again] = M.normalizeMissions([{ ...L, shd: 1 }]);
  assert.equal(again.shd, 1);
});

test('chi l\'ha creata: se il server rifiuta la modifica, la missione torna com\'è nel documento', async () => {
  const W = fakeWorld('uO', baseDoc({ uG: guest('Io') }), [myCopy('o')]);
  const L = W.S.missions[0];
  Object.assign(L, { title: 'Trasloco grande', rewards: M.normalizeRewards({ Vigore: 20 }) });
  W.ctl.fail = { code: 'permission-denied' };
  W.SH.afterEdit(L);
  await flush();
  assert.deepEqual([L.title, L.rewards.Vigore, L.shd], ['Trasloco', 10, undefined]);
  assert.ok(W.msgs.some(x => x.includes('Trasloco') && x.includes('com\'era')), 'un messaggio lo dice');
});

test('chi l\'ha creata: con un errore di rete la modifica resta e si riprova (non prima di 30 secondi)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const W = fakeWorld('uO', baseDoc({ uG: guest('Io') }), [myCopy('o')]);
  const L = W.S.missions[0];
  L.title = 'Trasloco grande';
  W.ctl.fail = { code: 'unavailable' };
  W.SH.afterEdit(L);
  await flush();
  assert.deepEqual([L.title, L.shd, W.writes.length], ['Trasloco grande', 1, 0], 'la modifica resta, da mandare');
  W.SH.evaluate();
  await flush();
  assert.equal(W.writes.length, 0, 'troppo presto per riprovare');
  t.mock.timers.tick(31000);
  W.SH.evaluate();
  await flush();
  assert.deepEqual([W.writes.length, W.writes[0].data.title, L.shd], [1, 'Trasloco grande', undefined], 'riprovata e confermata');
});

/* ---------- le modifiche di chi l'ha creata valgono dal giorno dopo, per tutti ---------- */
const DAY = 86400000;
test('chi l\'ha creata: XP e scadenza nuovi vanno nel documento come cambio in attesa (da domani); oggi restano quelli di prima', () => {
  const W = fakeWorld('uO', baseDoc({ uG: guest('Io') }), [myCopy('o')]);
  const L = W.S.missions[0];
  assert.equal(M.missionLocked(L), true);
  M.planMissionChange(L, { rewards: { Vigore: 20 }, penalty: L.penalty, stars: null, due: '2030-01-05', dueTime: null, from: null, fromTime: null });
  W.SH.afterEdit(L);
  const w = W.writes[0].data;
  const tomorrow = M.parseDate(M.addDaysStr(M.todayStr(), 1)).getTime();
  assert.deepEqual([w.nx.at, w.nx.rewards.Vigore, w.nx.oDue, w.rewards.Vigore, w.ver], [tomorrow, 20, '2030-01-05', 10, 2],
    'da mezzanotte; oggi 10 XP; gli amici riaccettano');
  assert.equal(L.rewards.Vigore, 10, 'anche nella tua missione, fino a domani');
});

test('chi l\'ha creata: con il cambio già arrivato, cambiare solo il titolo non riscrive le regole (niente da riaccettare)', () => {
  // (come li scrive l'app: tutte le statistiche, scadenza a fine giornata)
  const due = '2030-01-05', dueAt = M.dueEndMs({ due, dueTime: null });
  const nx = { at: Date.now() - 60000, rewards: M.normalizeRewards({ Vigore: 20 }), penalty: M.normalizeRewards({ Vigore: 5 }), stars: null,
    dueAt, fromAt: null, oDue: due, oDueTime: null, oFrom: null, oFromTime: null };
  const W = fakeWorld('uO', baseDoc({ uG: guest('Io') }, { nx }), [myCopy('o')]);
  const L = W.S.missions[0];
  // la tua missione l'ha già preso (a mezzanotte): come il documento, adesso
  Object.assign(L, { due, dueTime: null, rewards: M.normalizeRewards({ Vigore: 20 }), penalty: M.normalizeRewards({ Vigore: 5 }) });
  L.title = 'Trasloco grande';
  W.SH.afterEdit(L);
  const w = W.writes[0].data;
  assert.equal(w.title, 'Trasloco grande');
  assert.deepEqual(['rewards', 'penalty', 'dueAt', 'nx', 'fromAt'].filter(k => k in w), [], 'le regole non si riscrivono');
  assert.equal(w.ver, 1);
});

test('invitato: le regole nuove arrivano insieme per tutti, all\'istante del cambio', () => {
  const later = { at: Date.now() + DAY, rewards: { Vigore: 20 }, penalty: { Vigore: 5 }, stars: null, dueAt: DUE + DAY, fromAt: null,
    oDue: null, oDueTime: null, oFrom: null, oFromTime: null };
  const W = fakeWorld('uG', baseDoc({ uG: guest('Io') }, { nx: later }), [myCopy('g')]);
  W.SH.evaluate();
  const L = W.S.missions[0];
  assert.equal(L.rewards.Vigore, 10, 'prima del cambio: le regole di adesso');
  const nm = W.SH.info(L).nextM;
  assert.equal(nm.rewards.Vigore, 20, 'la scheda sa che cosa cambia da domani');
  const now = { ...later, at: Date.now() - 1000 };
  const W2 = fakeWorld('uG', baseDoc({ uG: guest('Io') }, { nx: now }), [myCopy('g')]);
  W2.SH.evaluate();
  const L2 = W2.S.missions[0];
  assert.deepEqual([L2.rewards.Vigore, L2.due, L2.dueTime], [20, W2.SH.localDue(DUE + DAY).due, W2.SH.localDue(DUE + DAY).dueTime],
    'dopo: XP e scadenza nuovi');
  assert.equal(W2.SH.info(L2).nextM, null);
});

test('la scadenza che vale: rimandata dal cambio già arrivato; ma una missione scaduta prima del cambio resta scaduta', () => {
  const W = fakeWorld('uG', baseDoc({ uG: guest('Io') }), [myCopy('g')]);
  const nx = at => ({ at, rewards: { Vigore: 10 }, penalty: { Vigore: 5 }, stars: null, dueAt: Date.now() + DAY, fromAt: null });
  const t0 = Date.now();
  // scadeva un'ora fa, ma il cambio (arrivato due ore fa, prima della scadenza) l'ha rimandata a domani: è ancora aperta
  const moved = baseDoc({ uG: guest('Io') }, { dueAt: t0 - 3600000, nx: nx(t0 - 7200000), _srv: t0 });
  assert.equal(W.SH.outcome(W.SH.eff(moved)), 'open');
  // scadeva prima che il cambio arrivasse: finisce con le regole di prima (qui: nessuno ha fatto la sua parte)
  const late = baseDoc({ uG: guest('Io') }, { dueAt: t0 - 7200000, nx: nx(t0 - 3600000), _srv: t0 });
  assert.equal(W.SH.eff(late).dueAt, t0 - 7200000, 'il cambio non arriva');
  assert.equal(W.SH.outcome(W.SH.eff(late)), 'failed');
});
