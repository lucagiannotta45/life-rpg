/*
 * Life RPG — test delle missioni condivise (shared.js): "Ritirati"
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
  const ref = id => ({
    update: data => { writes.push({ id, data }); return Promise.resolve(); },
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
  const W = { SH, S, writes, msgs, deleted };
  worlds.push(W);
  return W;
}
// la tua copia della missione (come nell'elenco)
const myCopy = role => ({ id: SID, title: 'Trasloco', desc: '', rewards: { Vigore: 10 }, penalty: { Vigore: 5 },
  due: '2030-01-01', created: '2026-10-01', done: null, failed: null, sid: SID, sh: role });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

test('invitato: si ritira, esce dal documento con il suo nome in wd, e la missione sparisce dal suo elenco', async () => {
  const doc = baseDoc({ uG: guest('Io'), uH: guest('Luca') });
  const W = fakeWorld('uG', doc, [myCopy('g')]);
  assert.equal(W.SH.info(W.S.missions[0]).canWithdraw, true);
  await W.SH.withdraw(SID);
  const w = W.writes.at(-1).data;
  assert.deepEqual([w['g.uG'], w.members, w['wd.uG']], ['TOGLI', { remove: ['uG'] }, 'Io']);
  assert.equal(W.S.missions.length, 0, 'niente XP e niente penalità: la missione non c\'è più');
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
  assert.equal(W.S.missions.length, 0);
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
