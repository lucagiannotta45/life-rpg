/*
 * Life RPG — test delle regole di gioco (game.js)
 * Livelli e XP, titolo del personaggio, pulizia degli XP salvati.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME, I18N, LANGS } = require('./carica');
const { STATS, MAX_LEVEL, MAX_XP, xpForLevel, levelFromXp, fracLevel, overallOf, heroRole, heroClass, normalize, blank } = GAME;

// XP con ogni statistica al livello indicato (in ordine: Vigore, Vitalita, Intelletto, Creativita, Animo, Legami)
const xpAt = (...lv) => Object.fromEntries(STATS.map((s, i) => [s.key, xpForLevel(lv[i] || 0)]));

test('livelli: XP richiesti', () => {
  assert.equal(xpForLevel(0), 0);
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(MAX_LEVEL), MAX_XP);
  for (let l = 1; l <= MAX_LEVEL; l++) assert.ok(xpForLevel(l) > xpForLevel(l - 1), 'crescono sempre (livello ' + l + ')');
});

test('livelli: dagli XP al livello, ai confini', () => {
  assert.equal(levelFromXp(0), 0);
  assert.equal(levelFromXp(99), 0);
  assert.equal(levelFromXp(100), 1);
  for (const l of [2, 10, 37, 99]) {
    assert.equal(levelFromXp(xpForLevel(l) - 1), l - 1);
    assert.equal(levelFromXp(xpForLevel(l)), l);
  }
  assert.equal(levelFromXp(MAX_XP), MAX_LEVEL);
  assert.equal(levelFromXp(MAX_XP * 5), MAX_LEVEL, 'oltre il massimo resta 100');
});

test('livelli: livello con i decimali e livello complessivo', () => {
  assert.equal(fracLevel(0), 0);
  assert.equal(fracLevel(MAX_XP), MAX_LEVEL);
  const mid = (xpForLevel(4) + xpForLevel(5)) / 2;
  assert.ok(Math.abs(fracLevel(mid) - 4.5) < 1e-9);
  assert.equal(overallOf([10, 10, 11, 11, 11, 11]), 10, 'media arrotondata per difetto');
  assert.equal(overallOf([0, 0, 0, 0, 0, 0]), 0);
});

test('XP salvati: pulizia', () => {
  assert.deepEqual(normalize(null), blank());
  assert.deepEqual(normalize('ciao'), blank());
  const n = normalize({ Vigore: 12.9, 'Vitalità': 40, 'Creatività': '7', Animo: -5, Legami: MAX_XP + 1, Sconosciuta: 99, Intelletto: 'x' });
  assert.deepEqual(n, { Vigore: 12, Vitalita: 40, Intelletto: 0, Creativita: 7, Animo: 0, Legami: MAX_XP });
});

test('titolo: equilibrato, in base al livello complessivo', () => {
  assert.deepEqual(heroRole(xpAt(0, 0, 0, 0, 0, 0)), { ns: 'tier', id: 'adventurer', lv: 0 });
  assert.equal(heroRole(xpAt(4, 0, 0, 0, 0, 0)).ns, 'tier', 'sotto il livello 5 non si è specializzati');
  assert.equal(heroRole(xpAt(12, 10, 10, 10, 10, 10)).id, 'hero');
  assert.equal(heroRole(xpAt(30, 30, 30, 30, 30, 30)).id, 'champion');
  assert.equal(heroRole(xpAt(60, 50, 50, 50, 50, 50)).id, 'legend');
  assert.equal(heroRole(xpAt(80, 80, 80, 80, 80, 80)).id, 'demigod');
});

test('titolo: una, due, tre, quattro, cinque statistiche in testa', () => {
  assert.deepEqual(heroRole(xpAt(0, 0, 20, 0, 0, 0)), { ns: 'cls', id: 'Intelletto', lv: 20 });
  assert.deepEqual(heroRole(xpAt(20, 18, 0, 0, 0, 0)), { ns: 'pair', id: 'gladiator', lv: 19 });
  assert.deepEqual(heroRole(xpAt(0, 0, 20, 0, 20, 20)), { ns: 'triple', id: 'counselor', lv: 20 });
  assert.equal(heroRole(xpAt(20, 20, 20, 20, 0, 0)).id, 'pioneer');
  assert.deepEqual(heroRole(xpAt(20, 20, 20, 20, 20, 0)), { ns: 'quint', id: 'ronin', lv: 20 }, 'cinque forti: conta quella che manca');
  // le statistiche "vicine" alla più alta (almeno l'80%) contano insieme
  assert.equal(heroRole(xpAt(20, 16, 0, 0, 0, 0)).ns, 'pair');
  assert.equal(heroRole(xpAt(20, 15, 0, 0, 0, 0)).ns, 'cls');
});

test('titolo: il grado dipende dal livello', () => {
  assert.equal(heroClass(xpAt(0, 0, 10, 0, 0, 0)), I18N.it['grade.apprentice'] + ' ' + I18N.it['cls.Intelletto']);
  assert.equal(heroClass(xpAt(0, 0, 30, 0, 0, 0)), I18N.it['cls.Intelletto'], 'dal 25 al 49 nessun grado');
  assert.equal(heroClass(xpAt(0, 0, 60, 0, 0, 0)), I18N.it['grade.master'] + ' ' + I18N.it['cls.Intelletto']);
  assert.equal(heroClass(xpAt(0, 0, 90, 0, 0, 0)), I18N.it['grade.grandmaster'] + ' ' + I18N.it['cls.Intelletto']);
  assert.equal(heroClass(xpAt(0, 0, 0, 0, 0, 0)), I18N.it['tier.adventurer'], 'gli equilibrati non hanno grado');
});

test('titolo: ogni combinazione ha un nome, in ogni lingua', () => {
  const combos = k => {   // tutte le combinazioni di k statistiche, in ordine di elenco
    const out = [];
    const go = (start, acc) => {
      if (acc.length === k) { out.push(acc.join('+')); return; }
      for (let i = start; i < STATS.length; i++) go(i + 1, [...acc, STATS[i].key]);
    };
    go(0, []);
    return out;
  };
  const groups = [['pair', GAME.PAIRS, 2], ['triple', GAME.TRIPLES, 3], ['quad', GAME.QUADS, 4]];
  for (const [ns, table, k] of groups) {
    assert.deepEqual(Object.keys(table).sort(), combos(k).sort(), ns + ': tutte le combinazioni, nessuna in più');
    for (const id of Object.values(table)) for (const l of LANGS) assert.ok(I18N[l.id][ns + '.' + id], ns + '.' + id + ' in ' + l.id);
  }
  for (const id of Object.values(GAME.QUINTS)) for (const l of LANGS) assert.ok(I18N[l.id]['quint.' + id], 'quint.' + id + ' in ' + l.id);
  for (const [, id] of GAME.TIERS) for (const l of LANGS) assert.ok(I18N[l.id]['tier.' + id], 'tier.' + id + ' in ' + l.id);
  for (const s of STATS) for (const l of LANGS) assert.ok(I18N[l.id]['cls.' + s.key], 'cls.' + s.key + ' in ' + l.id);
});
