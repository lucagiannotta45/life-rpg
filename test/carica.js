/*
 * Life RPG — test: caricamento delle regole
 * ---------------------------------------------------------------
 * I file delle regole (game.js, sync.js, missions.js, i18n.js) sono scritti per il browser:
 * si registrano su "window". Qui si crea un "window" finto e si caricano in Node, così i test
 * li provano da soli, senza pagina, senza account e senza rete.
 *
 * Il fuso orario è fissato su quello italiano, così le date dei test (e l'ora legale)
 * danno lo stesso risultato su qualsiasi computer.
 *
 * Come si lanciano i test (serve Node 20 o più recente), dalla cartella del progetto:
 *   node --test
 */
'use strict';
process.env.TZ = 'Europe/Rome';
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global.window || {};
['i18n.js', 'game.js', 'sync.js', 'missions.js'].forEach(f => require(path.join(ROOT, f)));

const { I18N, LANGS } = window.LIFE_RPG_I18N;
// traduzioni come nell'app, in italiano: {nome} → valore
const T = (key, vars = {}) => {
  let s = key in I18N.it ? I18N.it[key] : key;
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
};
const GAME = window.LIFE_RPG_GAME.create(T);
const SYNC = window.LIFE_RPG_SYNC.create(GAME);
const MISSIONS = window.LIFE_RPG_MISSIONS.create(GAME, SYNC);

// un istante preciso, in ora italiana: at('2026-03-10', '18:30')
const at = (ds, time = '12:00') => new Date(ds + 'T' + time + ':00').getTime();

module.exports = { T, I18N, LANGS, GAME, SYNC, MISSIONS, at };
