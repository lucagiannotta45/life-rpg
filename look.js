/*
 * Life RPG — calcoli dei colori
 * ---------------------------------------------------------------
 * Solo calcoli: ricevono colori (codici "#rrggbb") e restituiscono colori o numeri.
 * Non toccano la pagina: chi li usa (index.js e la personalizzazione) applica il risultato.
 * - luminance: quanto è chiaro un colore (0 = nero, 1 = bianco), come lo percepisce l'occhio;
 * - mixHex: mescola due colori (t = 0 → il primo, t = 1 → il secondo);
 * - hslToHex: da tonalità/saturazione/luminosità a codice esadecimale;
 * - winBase / paletteVars: i colori delle finestre ricavati da un solo colore scelto;
 * - readable: un colore di testo leggibile su fondo scuro;
 * - normHex: "abc", "#ABC", " aabbcc " → "#aabbcc" (oppure null se non è un colore).
 *
 * Uso (in index.js):  const LOOK = window.LIFE_RPG_LOOK;
 */
(() => {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
  }
  function hslToHex(hh, ss, ll) {
    ss /= 100; ll /= 100;
    const k = n => (n + hh / 30) % 12, a = ss * Math.min(ll, 1 - ll);
    const f = n => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  // colore di base delle finestre: se troppo chiaro viene scurito per lasciare il testo leggibile
  function winBase(c) {
    let a = c, k = 0;
    while (luminance(a) > 0.2 && k < 24) { a = mixHex(a, '#000000', 0.08); k++; }
    return a;
  }
  // variabili CSS delle finestre ricavate da un solo colore (le usa anche il profilo di un amico)
  function paletteVars(color) {
    const a = winBase(color), dk = mixHex(a, '#000000', 0.70);
    return {
      '--win-a': a,
      '--win-b': mixHex(a, '#000000', 0.45),
      '--win-c': dk,
      '--win-edge': dk,
      '--win-glow': mixHex(a, '#ffffff', 0.45),
      '--ink-soft': mixHex(a, '#ffffff', 0.72),
      '--track': mixHex(a, '#000000', 0.82),
      '--btn': mixHex(a, '#ffffff', 0.06),
    };
  }
  // colore del testo leggibile su fondo scuro: se quello scelto è troppo scuro lo si schiarisce (il bordo resta del colore scelto)
  function readable(hex) {
    let c = HEX.test(hex) ? hex : '#ffffff';
    for (let k = 0; k < 20 && luminance(c) < 0.18; k++) c = mixHex(c, '#ffffff', 0.12);
    return c;
  }
  // accanto a ogni selettore di colore c'è un campo per scrivere il codice esadecimale: questo lo mette in ordine
  function normHex(v) {
    let t = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(ch => ch + ch).join('');
    return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
  }
  window.LIFE_RPG_LOOK = { luminance, mixHex, hslToHex, winBase, paletteVars, readable, normHex };
})();
