/*
 * Life RPG — test della sincronizzazione tra dispositivi (sync.js)
 * Registri degli XP, lapidi delle eliminazioni, unione di due elenchi e compensazione degli XP.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SYNC, GAME } = require('./carica');
const { MAX_XP, blank } = GAME;
const { TOMB_MS, normLedger, normDel, pruneDel, normRaw, rawOf, clampXp, shownXp, nextRaw, effOf, addEff, stampLedger, canon, mergeItems, mergeReport } = SYNC;

const xp = o => Object.assign(blank(), o);
const sig = canon;   // come nell'app: la firma del contenuto
const NOW = Date.UTC(2026, 5, 1);

test('registro degli XP per dispositivo: pulizia', () => {
  assert.equal(normLedger(null), null);
  assert.equal(normLedger({}), null);
  assert.deepEqual(normLedger({ abcd: { Vigore: 10, Animo: 0, Legami: 2.5, Xx: 3 }, 'NO!': { Vigore: 1 }, ab: { Vigore: 1 } }), { abcd: { Vigore: 10 } });
  assert.deepEqual(normLedger({ abcd: { Vigore: -40 } }), { abcd: { Vigore: -40 } }, 'anche negativi (penalità)');
  assert.equal(normLedger({ abcd: { Vigore: MAX_XP + 1 } }), null);
  const many = {};
  for (let i = 0; i < 20; i++) many['dev' + String(i).padStart(2, '0')] = { Vigore: 1 };
  assert.equal(Object.keys(normLedger(many)).length, 16, 'al massimo 16 dispositivi');
});

test('lapidi: pulizia e scadenza dopo 90 giorni', () => {
  assert.deepEqual(normDel({ m1: 5, m2: { t: 7, z: 3, c: { abcd: { Vigore: 2 } } }, 'x y': 1, m3: { t: -1 }, m4: 'boh' }),
    { m1: { t: 5 }, m2: { t: 7, z: 3, c: { abcd: { Vigore: 2 } } } });
  const del = { vecchia: { t: NOW - TOMB_MS - 1 }, giusta: { t: NOW - TOMB_MS }, nuova: { t: NOW } };
  assert.deepEqual(Object.keys(pruneDel(del, NOW)).sort(), ['giusta', 'nuova']);
});

test('totale grezzo e XP mostrati', () => {
  assert.deepEqual(normRaw({ Vigore: -30.4, Animo: 20 * MAX_XP, Legami: 'x' }), xp({ Vigore: -30, Animo: 10 * MAX_XP }));
  assert.deepEqual(rawOf({ xr: { Vigore: -5 } }), xp({ Vigore: -5 }), 'con il totale grezzo');
  assert.deepEqual(rawOf({ xp: { Vigore: 12 } }), xp({ Vigore: 12 }), 'documenti vecchi: solo xp');
  assert.equal(clampXp(-3), 0);
  assert.equal(clampXp(MAX_XP + 9), MAX_XP);
  assert.deepEqual(shownXp(xp({ Vigore: 10, Animo: 5 }), xp({ Vigore: -30, Animo: 7 })), xp({ Vigore: 0, Animo: 12 }), 'mai sotto zero');
  assert.deepEqual(nextRaw(xp({ Vigore: 10 }), xp({ Vigore: -30 }), false), xp({ Vigore: -20 }), 'il grezzo può andare sotto zero');
  assert.deepEqual(nextRaw(xp({ Vigore: 10 }), xp({ Vigore: -30 }), true, xp({ Vigore: 3 })), xp({ Vigore: 3 }));
});

test('effetto di una missione e registro aggiornato', () => {
  assert.deepEqual(effOf({ done: { applied: xp({ Vigore: 8 }) } }), { Vigore: 8 });
  assert.deepEqual(effOf({ failed: { applied: xp({ Animo: 4 }) } }), { Animo: -4 });
  assert.deepEqual(effOf({ done: null, failed: null }), {});
  assert.deepEqual(addEff({ Vigore: 1 }, { Vigore: 2, Animo: 3 }, -1), { Vigore: -1, Animo: -3 });
  // completata su questo dispositivo, poi annullata: il registro torna vuoto
  let c = stampLedger(null, {}, { Vigore: 8 }, 'abcd');
  assert.deepEqual(c, { abcd: { Vigore: 8 } });
  c = stampLedger(c, { Vigore: 8 }, {}, 'abcd');
  assert.equal(c, null);
  // le voci degli altri dispositivi restano
  assert.deepEqual(stampLedger({ zzzz: { Vigore: 5 } }, {}, { Animo: 2 }, 'abcd'), { zzzz: { Vigore: 5 }, abcd: { Animo: 2 } });
});

test('confronto del contenuto: ordine delle chiavi, "u", "c" e campi vuoti non contano', () => {
  assert.equal(canon({ b: 1, a: [1, { y: 2, x: null }], u: 5, c: { q: 1 } }), canon({ a: [1, { y: 2 }], b: 1, u: 99 }));
  assert.notEqual(canon({ a: 1 }), canon({ a: 2 }));
});

test('unione di due elenchi: vince la modifica più recente, a parità l\'account', () => {
  const L = [{ id: 'a', v: 'mio', u: 20 }, { id: 'b', v: 'mio', u: 10 }, { id: 'c', v: 'solo mio', u: 1 }];
  const R = [{ id: 'a', v: 'account', u: 10 }, { id: 'b', v: 'account', u: 10 }, { id: 'd', v: 'solo account', u: 1 }];
  const { items, info } = mergeItems(L, {}, R, {}, sig, NOW);
  const byId = Object.fromEntries(items.map(x => [x.id, x.v]));
  assert.deepEqual(byId, { a: 'mio', b: 'account', c: 'solo mio', d: 'solo account' });
  assert.equal(info.get('a').same, false);
});

test('unione: eliminazioni e modifiche', () => {
  // eliminata sull'account dopo l'ultima modifica: sparisce
  const t = k => NOW - 1000 + k;   // istanti di pochi secondi fa (le lapidi più vecchie di 90 giorni si scartano)
  let res = mergeItems([{ id: 'a', u: t(10) }], {}, [], { a: { t: t(20) } }, sig, NOW);
  assert.deepEqual(res.items, []);
  assert.ok(res.del.a);
  // modificata qui dopo l'eliminazione: resta, e la lapide si toglie
  res = mergeItems([{ id: 'a', u: t(30) }], {}, [], { a: { t: t(20) } }, sig, NOW);
  assert.deepEqual(res.items.map(x => x.id), ['a']);
  assert.equal(res.del.a, undefined);
  // tra due lapidi vince la più recente
  res = mergeItems([], { a: { t: t(5) } }, [], { a: { t: t(9) } }, sig, NOW);
  assert.equal(res.del.a.t, t(9));
  // una lapide più vecchia di 90 giorni non serve più
  res = mergeItems([], {}, [], { a: { t: NOW - TOMB_MS - 1 } }, sig, NOW);
  assert.equal(res.del.a, undefined);
});

test('report: cosa cambia su questo dispositivo', () => {
  const L = [{ id: 'a', v: 1, u: 5 }, { id: 'b', v: 1, u: 50 }];
  const R = [{ id: 'a', v: 2, u: 9 }, { id: 'b', v: 2, u: 10 }, { id: 'c', v: 1, u: 1 }];
  const rep = mergeReport(L, {}, R, {}, sig, null, NOW);
  assert.equal(rep.changed, true, 'a e c cambiano qui');
  assert.equal(rep.dirty, true, 'b è più recente qui: l\'account va riscritto');
  const same = mergeReport([{ id: 'a', v: 1, u: 3 }], {}, [{ id: 'a', v: 1, u: 8 }], {}, sig, null, NOW);
  assert.equal(same.changed, true, 'stesso contenuto: si prende la versione dell\'account');
  assert.equal(same.dirty, false);
  const gone = mergeReport([{ id: 'a', u: NOW - 9 }], {}, [], { a: { t: NOW - 1 } }, sig, null, NOW);
  assert.deepEqual(gone.gone, ['a']);
});

test('compensazione: una missione completata su due dispositivi offline non conta due volte', () => {
  // telefono (abcd) e computer (wxyz) completano la stessa missione senza rete: +8 Vigore ciascuno.
  // Il computer scrive per primo; quando il telefono si ricollega la sua versione perde,
  // e deve togliere i suoi 8 XP (il registro vincente non gli riconosce niente).
  const mine = { id: 'm', done: { applied: xp({ Vigore: 8 }) }, u: 5, c: { abcd: { Vigore: 8 } } };
  const acct = { id: 'm', done: { applied: xp({ Vigore: 8 }) }, u: 9, c: { wxyz: { Vigore: 8 } } };
  let rep = mergeReport([mine], {}, [acct], {}, sig, 'abcd', NOW);
  assert.deepEqual(rep.comp, { Vigore: -8 });
  // se il registro vincente riconosce già il telefono, non si toglie niente
  rep = mergeReport([mine], {}, [{ ...acct, c: { abcd: { Vigore: 8 } } }], {}, sig, 'abcd', NOW);
  assert.deepEqual(rep.comp, {});
  // epoche diverse (backup importato): nessuna compensazione
  rep = mergeReport([mine], {}, [{ ...acct, z: 2 }], {}, sig, 'abcd', NOW);
  assert.deepEqual(rep.comp, {});
});

test('compensazione: eliminata altrove dopo che qui l\'avevi completata', () => {
  const mine = { id: 'm', done: { applied: xp({ Vigore: 8 }) }, u: NOW - 9, c: { abcd: { Vigore: 8 } } };
  const rep = mergeReport([mine], {}, [], { m: { t: NOW - 1 } }, sig, 'abcd', NOW);
  assert.deepEqual(rep.gone, ['m']);
  assert.deepEqual(rep.comp, { Vigore: -8 }, 'la lapide non ti riconosce gli XP: si tolgono');
  const kept = mergeReport([mine], {}, [], { m: { t: NOW - 1, c: { abcd: { Vigore: 8 } } } }, sig, 'abcd', NOW);
  assert.deepEqual(kept.comp, {}, 'la lapide li riconosce: restano');
});
