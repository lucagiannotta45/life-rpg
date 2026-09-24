/*
 * Life RPG — regole della sincronizzazione tra dispositivi
 * ---------------------------------------------------------------
 * Qui ci sono solo i CALCOLI: ricevono dati e restituiscono dati, senza toccare
 * la pagina, i salvataggi o la rete. Chi li usa (index.js) tiene lo stato e scrive
 * nell'account. Così queste regole si possono provare da sole (test/tsync.js).
 *
 * Come restano d'accordo più dispositivi collegati allo stesso account:
 * - ogni missione e ogni routine ha "u", l'istante dell'ultima modifica: in un conflitto
 *   vince la più recente; a parità vince la versione dell'account;
 * - una missione o routine eliminata lascia una "lapide" { t, c, z } per 90 giorni,
 *   così un dispositivo rimasto indietro non la fa ricomparire;
 * - ogni missione porta un registro "c": { idDispositivo: { statistica: XP } }, cioè quanti XP
 *   ha dato o tolto ciascun dispositivo con quella missione. Se la tua versione perde il
 *   confronto, si guarda quanto il registro vincente ti riconosce e si annulla la differenza:
 *   così una missione non conta mai due volte (per esempio completata su due dispositivi offline);
 * - "z" è l'epoca: cambia quando i dati vengono sostituiti per intero (backup importato,
 *   scelta "questo dispositivo"); tra epoche diverse non si compensa nulla, perché in quei casi
 *   gli XP vengono scritti per intero;
 * - gli XP dell'account hanno anche un totale "grezzo" (xr) non tagliato fra 0 e 100.000:
 *   due penalità arrivate insieme possono portarlo sotto zero per un momento, e il taglio
 *   perderebbe l'informazione che serve per correggerlo.
 *
 * Uso (in index.js):  const SYNC = window.LIFE_RPG_SYNC.create(GAME);
 */
(() => {
  'use strict';
  function create(G) {
    const { STATS, MAX_XP, blank, normalize } = G;
    const TOMB_MS = 90 * 86400000;

    // registro degli XP per dispositivo: { idDispositivo: { statistica: numero } }, al massimo 16 dispositivi
    function normLedger(o) {
      if (!o || typeof o !== 'object') return null;
      const out = {};
      let n = 0;
      for (const [dev, e] of Object.entries(o)) {
        if (n >= 16 || !/^[a-z0-9]{4,12}$/.test(dev) || !e || typeof e !== 'object') continue;
        const v = {};
        STATS.forEach(s => { const x = Number(e[s.key]); if (Number.isInteger(x) && x && Math.abs(x) <= MAX_XP) v[s.key] = x; });
        if (Object.keys(v).length) { out[dev] = v; n++; }
      }
      return n ? out : null;
    }

    // lapidi: { id: { t: istante, c: registro della missione eliminata, z: epoca } }
    function normDel(o) {
      const out = {};
      if (o && typeof o === 'object') for (const [id, v] of Object.entries(o)) {
        const t = Number(v && typeof v === 'object' ? v.t : v);
        if (!/^[\w-]{1,40}$/.test(id) || !Number.isFinite(t) || t <= 0) continue;
        const x = { t: Math.floor(t) };
        const led = v && typeof v === 'object' ? normLedger(v.c) : null;
        if (led) x.c = led;
        if (v && Number(v.z) > 0) x.z = Math.floor(Number(v.z));
        out[id] = x;
      }
      return out;
    }
    // lapidi più vecchie di 90 giorni: non servono più
    function pruneDel(del, now = Date.now()) {
      const lim = now - TOMB_MS, out = {};
      for (const [id, x] of Object.entries(del)) if (x.t >= lim) out[id] = x;
      return out;
    }

    // totale grezzo: interi, anche negativi, entro un margine largo
    function normRaw(o) {
      const out = blank();
      if (o && typeof o === 'object') STATS.forEach(s => { const n = Number(o[s.key]); if (Number.isFinite(n)) out[s.key] = Math.max(-10 * MAX_XP, Math.min(10 * MAX_XP, Math.round(n))); });
      return out;
    }
    // totale grezzo di un documento dell'account (le versioni precedenti hanno solo xp)
    const rawOf = d => (d && d.xr && typeof d.xr === 'object') ? normRaw(d.xr) : normalize(d && d.xp);
    const clampXp = v => Math.min(MAX_XP, Math.max(0, Math.round(v)));
    // XP da mostrare: totale dell'account + ciò che questo dispositivo non ha ancora mandato, tagliato fra 0 e 100.000
    const shownXp = (base, pend) => Object.fromEntries(STATS.map(s => [s.key, clampXp((base ? base[s.key] : 0) + pend[s.key])]));
    // nuovo totale grezzo da scrivere: quello dell'account + ciò che si manda (oppure, se "abs", i valori così come sono)
    const nextRaw = (raw, send, abs, xs) => Object.fromEntries(STATS.map(s => [s.key, abs ? xs[s.key] : raw[s.key] + send[s.key]]));

    // "effetto" di una missione sugli XP: + quelli ricevuti completandola, - quelli persi con la penalità (solo valori diversi da 0)
    const effOf = m => {
      const src = m && (m.done || m.failed), e = {};
      if (src) STATS.forEach(s => { const v = src.applied[s.key] || 0; if (v) e[s.key] = m.done ? v : -v; });
      return e;
    };
    const addEff = (acc, e, sign) => { for (const k in e) acc[k] = (acc[k] || 0) + sign * e[k]; return acc; };

    // registro aggiornato di una missione cambiata su questo dispositivo: alla voce "dev" si aggiunge
    // di quanto è cambiato l'effetto rispetto alla versione precedente (prevEff). Restituisce il registro o null.
    function stampLedger(ledger, prevEff, newEff, dev) {
      const d = addEff(addEff({}, newEff, 1), prevEff || {}, -1);
      const c = JSON.parse(JSON.stringify(ledger || {}));
      if (STATS.some(s => d[s.key])) {
        const mine = c[dev] || {};
        STATS.forEach(s => { const v = (mine[s.key] || 0) + (d[s.key] || 0); if (v) mine[s.key] = v; else delete mine[s.key]; });
        if (Object.keys(mine).length) c[dev] = mine; else delete c[dev];
      }
      return Object.keys(c).length ? c : null;
    }

    // confronto "stesso contenuto": chiavi in ordine, senza "u" e "c" e senza campi vuoti
    function canon(v) {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort().filter(k => v[k] != null && k !== 'u' && k !== 'c').map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
      }
      return JSON.stringify(v);
    }

    // unisce due elenchi (missioni o routine) elemento per elemento.
    // L/lDel: questo dispositivo; R/rDel: l'account; sig: firma del contenuto.
    // Per ogni id "info" dice: l (tua versione), r (dell'account), w (vincitore, null = eliminata), same (contenuto uguale).
    function mergeItems(L, lDel, R, rDel, sig, now) {
      const lm = new Map(L.map(x => [x.id, x])), rm = new Map(R.map(x => [x.id, x]));
      const del = { ...rDel };
      for (const [id, x] of Object.entries(lDel)) if (!del[id] || del[id].t < x.t) del[id] = x;
      const items = [], info = new Map();
      for (const id of new Set([...lm.keys(), ...rm.keys()])) {
        const l = lm.get(id), r = rm.get(id);
        let w, same = false;
        if (l && r) {
          same = sig(l) === sig(r);
          w = same ? r : ((l.u || 0) > (r.u || 0) ? l : r);   // a parità vince l'account
        } else w = l || r;
        if (del[id] && del[id].t >= (w.u || 0)) w = null;        // eliminata dopo l'ultima modifica
        else if (del[id]) delete del[id];                        // modificata dopo l'eliminazione: resta, la lapide si toglie
        if (w) items.push(w);
        info.set(id, { l, r, w, same });
      }
      return { items, del: pruneDel(del, now), info };
    }

    // come mergeItems, e in più dice cosa deve fare questo dispositivo:
    // changed: il tuo elenco cambia; dirty: l'account non ha ancora qualcosa di tuo (va riscritto);
    // gone: id tuoi che spariscono; comp: XP da aggiungere (o togliere) qui perché una tua versione ha perso
    // (solo se "dev" è dato, cioè per le missioni).
    function mergeReport(L, lDel, R, rDel, sig, dev, now) {
      const res = mergeItems(L, lDel, R, rDel, sig, now);
      const comp = {}, gone = [];
      let changed = false, dirty = false;
      res.info.forEach(({ l, w, same }, id) => {
        if (l && w !== l) {
          changed = true;
          if (!w) gone.push(id);
          if (dev) {
            const win = w || res.del[id] || {};                 // vincitore: un'altra versione, oppure la lapide
            if ((win.z || 0) === (l.z || 0)) {                  // stessa epoca
              addEff(comp, (win.c && win.c[dev]) || {}, 1);
              addEff(comp, (l.c && l.c[dev]) || {}, -1);
            }
          }
        }
        if (!l && w) changed = true;
        if (w && w === l && !same) dirty = true;               // la tua versione ha vinto: l'account non ce l'ha ancora
      });
      for (const [id, x] of Object.entries(lDel)) {
        if (!(rDel[id] && rDel[id].t >= x.t) && res.del[id]) dirty = true;
        // una TUA lapide che perde (contro una lapide più recente o una versione modificata dopo) vale come una tua
        // versione che perde: per esempio la stessa missione completata ed eliminata su due dispositivi offline
        const i = res.info.get(id);
        if (!dev || (i && i.l)) continue;
        const wt = res.del[id];
        if (wt && wt.t === x.t) continue;                       // ha vinto la tua lapide
        const win = (i && i.w) || wt;
        if (!win || (win.z || 0) !== (x.z || 0)) continue;
        addEff(comp, (win.c && win.c[dev]) || {}, 1);
        addEff(comp, (x.c && x.c[dev]) || {}, -1);
      }
      STATS.forEach(s => { if (!comp[s.key]) delete comp[s.key]; });
      return { ...res, comp, changed, dirty, gone };
    }

    return {
      TOMB_MS, normLedger, normDel, pruneDel, normRaw, rawOf, clampXp, shownXp, nextRaw,
      effOf, addEff, stampLedger, canon, mergeItems, mergeReport,
    };
  }
  window.LIFE_RPG_SYNC = { create };
})();
