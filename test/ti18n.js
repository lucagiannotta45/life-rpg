/*
 * Life RPG — test delle traduzioni (i18n.js)
 * Ogni lingua deve avere gli stessi testi dell'italiano, con gli stessi segnaposto ({title}, {n}...):
 * un testo dimenticato comparirebbe in italiano, un segnaposto sbagliato mostrerebbe "{title}" sullo schermo.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { I18N, LANGS } = require('./carica');

const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const others = LANGS.filter(l => l.id !== 'it');

test('le lingue dell\'elenco e quelle tradotte coincidono', () => {
  assert.deepEqual(LANGS.map(l => l.id).sort(), Object.keys(I18N).sort());
  for (const l of LANGS) {
    assert.ok(l.name && typeof l.name === 'string', 'nome di ' + l.id);
    assert.doesNotThrow(() => new Intl.DateTimeFormat(l.locale), 'locale valido per ' + l.id);
  }
});

for (const l of others) {
  test(l.id + ': stessi testi dell\'italiano, né uno in più né uno in meno', () => {
    const it = Object.keys(I18N.it), tr = Object.keys(I18N[l.id]);
    assert.deepEqual(it.filter(k => !tr.includes(k)), [], 'mancano in ' + l.id);
    assert.deepEqual(tr.filter(k => !it.includes(k)), [], 'in più in ' + l.id);
  });
  test(l.id + ': stessi segnaposto', () => {
    const bad = Object.keys(I18N.it).filter(k => k in I18N[l.id] && holes(I18N.it[k]) !== holes(I18N[l.id][k]));
    assert.deepEqual(bad, []);
  });
}

test('nessun testo vuoto', () => {
  for (const l of LANGS) {
    const empty = Object.entries(I18N[l.id]).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
    assert.deepEqual(empty, [], 'vuoti in ' + l.id);
  }
});

test('plurali: ogni "_one" ha il suo "_other"', () => {
  for (const l of LANGS) {
    const keys = Object.keys(I18N[l.id]);
    const lonely = keys.filter(k => k.endsWith('_one') && !keys.includes(k.slice(0, -4) + '_other'));
    assert.deepEqual(lonely, [], l.id);
  }
});
