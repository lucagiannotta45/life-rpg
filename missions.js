/*
 * Life RPG — regole delle missioni, delle routine e del calendario
 * ---------------------------------------------------------------
 * Qui ci sono solo i CALCOLI: ricevono dati e restituiscono dati, senza toccare
 * la pagina, i salvataggi o la rete. Chi li usa (index.js) tiene l'elenco delle
 * missioni e delle routine, salva, disegna e suona. Così queste regole si possono
 * provare da sole (test/tmissions.js).
 *
 * Contenuto:
 * - date "AAAA-MM-GG" (sempre con l'orologio e il fuso del dispositivo);
 * - stelle di Durata e Difficoltà → totale di XP della missione;
 * - controllo dei dati salvati (missioni e routine arrivate da localStorage, dall'account o da un backup);
 * - quando una missione è disponibile, quando scade, in che ordine e in che gruppo compare;
 * - XP guadagnati, tolti e persi (completare, annullare, penalità);
 * - routine: in quali giorni contano, creazione delle "volte" di ogni giorno, serie e bonus;
 * - calendario: pallini dei giorni e routine previste;
 * - collegamenti "Aggiungi a Google Calendar".
 *
 * Alcune funzioni cambiano gli oggetti che ricevono (per esempio gli XP o una routine), come faceva
 * il codice di prima: il commento di ognuna lo dice.
 *
 * Uso (in index.js):  const MISSIONS = window.LIFE_RPG_MISSIONS.create(GAME, SYNC);
 */
(() => {
  'use strict';
  function create(G, S) {
    const { STATS, MAX_XP } = G;
    const { normLedger } = S;

    /* ---------- limiti ---------- */
    const MAX_PER_MONTH = 200;   // missioni create in un mese
    const MAX_MISSIONS = 2000;   // missioni in tutto
    const MAX_ROUTINES = 30;
    const KEEP_DAYS = 60;        // le routine completate o fallite più vecchie si tolgono dalla cronologia

    /* ---------- date ---------- */
    const pad2 = n => String(n).padStart(2, '0');
    const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const todayStr = () => isoDate(new Date());
    const addDaysStr = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return isoDate(d); };
    const monthOf = m => m.created.slice(0, 7);   // il mese di creazione: le missioni si salvano un documento per mese
    function validDate(s) {
      if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const [y, m, d] = s.split('-').map(Number);
      const t = new Date(y, m - 1, d);
      return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
    }
    const validTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

    /* ---------- stelle e XP della missione ---------- */
    function normalizeRewards(o) {
      const r = {};
      for (const s of STATS) {
        const n = Number(o && o[s.key]);
        r[s.key] = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_XP) : 0;
      }
      return r;
    }
    // Il totale di XP che si possono assegnare dipende da due valutazioni a stelle (1-5): la Durata e la Difficoltà.
    // I pesi non sono lineari (1,2,3,5,8): ogni stella in più pesa un po' di più della precedente.
    const REWARD_WEIGHT = [0, 1, 2, 3, 5, 8];
    const REWARD_BASE = 4;
    const rewardTotal = (d, f) => REWARD_WEIGHT[d] * REWARD_WEIGHT[f] * REWARD_BASE;
    // trova una coppia (durata, difficoltà) che dia questo totale: serve solo per le missioni create prima di questo sistema,
    // che non hanno "stars" salvato. Con lo stesso totale possono esistere più coppie valide (per esempio 4x3 e 3x4 fanno
    // entrambe 60): qui si sceglie la prima trovata, ma se la missione ha già un campo "stars" quello vince sempre.
    const rewardMatch = total => {
      for (let d = 1; d <= 5; d++) for (let f = 1; f <= 5; f++) if (rewardTotal(d, f) === total) return [d, f];
      return null;
    };
    // le stelle scelte davvero, salvate insieme alla missione; valide solo se il totale che danno combacia ancora con gli XP
    function normalizeStars(rewards, st) {
      if (!st || typeof st !== 'object') return null;
      const d = Number(st.d), f = Number(st.f);
      if (!Number.isInteger(d) || !Number.isInteger(f) || d < 1 || d > 5 || f < 1 || f > 5) return null;
      const sum = STATS.reduce((t, s) => t + (rewards[s.key] || 0), 0);
      return rewardTotal(d, f) === sum ? { d, f } : null;
    }

    /* ---------- controllo dei dati salvati ---------- */
    // tiene solo missioni valide, con i campi giusti; quelle rovinate o doppie si scartano
    function normalizeMissions(arr) {
      if (!Array.isArray(arr)) return [];
      const out = [], seen = new Set();
      for (const m of arr) {
        if (!m || typeof m !== 'object') continue;
        const id = typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? m.id : null;
        const title = typeof m.title === 'string' ? m.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
        if (!id || seen.has(id) || !title || !validDate(m.created)) continue;
        const rewards = normalizeRewards(m.rewards);
        if (!Object.values(rewards).some(v => v > 0)) continue;
        const it = {
          id, title,
          desc: typeof m.desc === 'string' ? m.desc.trim().slice(0, 500) : '',
          rewards, penalty: normalizeRewards(m.penalty), due: validDate(m.due) ? m.due : null,
          from: validDate(m.from) ? m.from : null,   // disponibile dal: prima non si può completare
          fromTime: validDate(m.from) && validTime(m.fromTime) ? m.fromTime : null,
          dueTime: validDate(m.due) && validTime(m.dueTime) ? m.dueTime : null,
          created: m.created, done: null, failed: null, stars: normalizeStars(rewards, m.stars),
        };
        if (typeof m.rid === 'string' && /^\w{1,12}$/.test(m.rid)) it.rid = m.rid;
        // missione condivisa con un amico (vedi shared.js): sid = il documento condiviso, sh = il tuo ruolo
        // ('o' = l'hai creata tu, 'g' = sei stato invitato)
        if (!it.rid && typeof m.sid === 'string' && /^[\w-]{1,40}$/.test(m.sid)) { it.sid = m.sid; it.sh = m.sh === 'g' ? 'g' : 'o'; }
        // shn = il nome dell'amico, salvato quando la missione finisce: il documento condiviso poi si elimina
        if (it.sid && typeof m.shn === 'string' && m.shn.trim()) it.shn = m.shn.trim().slice(0, 30);
        // sincronizzazione (vedi sync.js): u = istante dell'ultima modifica,
        // c = XP prodotti da ciascun dispositivo con questa missione, z = epoca (cambia con un backup importato)
        const mu = Number(m.u);
        if (Number.isFinite(mu) && mu > 0) it.u = Math.floor(mu);
        const led = normLedger(m.c);
        if (led) it.c = led;
        const mz = Number(m.z);
        if (Number.isFinite(mz) && mz > 0) it.z = Math.floor(mz);
        if (m.failed && typeof m.failed === 'object' && validDate(m.failed.date)) {
          it.failed = {
            date: m.failed.date,
            t: Number.isFinite(Number(m.failed.t)) ? Number(m.failed.t) : 0,
            applied: normalizeRewards(m.failed.applied),
          };
        }
        if (m.done && typeof m.done === 'object' && validDate(m.done.date)) {
          it.done = {
            date: m.done.date,
            t: Number.isFinite(Number(m.done.t)) ? Number(m.done.t) : 0,
            applied: normalizeRewards(m.done.applied),
          };
          const rs = m.done.rs;
          if (rs && Number.isInteger(rs.prev) && rs.prev >= 0 && Number.isInteger(rs.n) && rs.n > 0) {
            it.done.rs = { prev: rs.prev, prevDate: validDate(rs.prevDate) ? rs.prevDate : '', n: rs.n };
          }
        }
        seen.add(id);
        out.push(it);
        if (out.length >= MAX_MISSIONS) break;
      }
      return out;
    }
    function normalizeRoutines(arr) {
      if (!Array.isArray(arr)) return [];
      const out = [], seen = new Set();
      const nn = (v, max) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0; };
      for (const r of arr) {
        if (!r || typeof r !== 'object') continue;
        const id = typeof r.id === 'string' && /^\w{1,12}$/.test(r.id) ? r.id : null;
        const title = typeof r.title === 'string' ? r.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
        if (!id || seen.has(id) || !title || !validDate(r.start)) continue;
        const rewards = normalizeRewards(r.rewards);
        if (!Object.values(rewards).some(v => v > 0)) continue;
        const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
        if (!days.length) continue;
        const b = r.bonus;
        const bonus = b && Number.isInteger(b.every) && b.every >= 2 && b.every <= 365 && Number.isInteger(b.xp) && b.xp >= 1 && b.xp <= MAX_XP
          ? { every: b.every, xp: b.xp } : null;
        const pz = r.pause;
        seen.add(id);
        out.push({
          id, title,
          desc: typeof r.desc === 'string' ? r.desc.trim().slice(0, 500) : '',
          rewards, penalty: normalizeRewards(r.penalty), days,
          time: validTime(r.time) ? r.time : null,
          start: r.start,
          pause: pz && validDate(pz.from) && validDate(pz.until) && pz.from <= pz.until ? { from: pz.from, until: pz.until } : null,
          streak: nn(r.streak, 100000), streakDate: validDate(r.streakDate) ? r.streakDate : '', best: nn(r.best, 100000),
          bonus, stars: normalizeStars(rewards, r.stars),
          made: validDate(r.made) ? r.made : '',   // fin qui le missioni della routine sono già state create
        });
        const ru = Number(r.u);
        if (Number.isFinite(ru) && ru > 0) out[out.length - 1].u = Math.floor(ru);   // istante dell'ultima modifica
        if (out.length >= MAX_ROUTINES) break;
      }
      return out;
    }

    /* ---------- disponibilità e scadenza ---------- */
    // istante (in millisecondi) da cui la missione si può completare (senza ora: da mezzanotte)
    function startMs(m) {
      if (!m.from) return -Infinity;
      const d = parseDate(m.from);
      if (m.fromTime) { const [hh, mm] = m.fromTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); }
      return d.getTime();
    }
    // istante dopo il quale la missione è scaduta, con l'orologio del dispositivo:
    // alla fine dell'ora scelta (minuto compreso) oppure, senza ora, alla fine del giorno
    function dueEndMs(m) {
      if (!m.due) return Infinity;
      const d = parseDate(m.due);
      if (m.dueTime) { const [hh, mm] = m.dueTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); return d.getTime() + 60000; }
      d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    const isLate = m => !m.done && Date.now() >= dueEndMs(m);
    const dueKey = m => (m.due || m.from || '9999-99-99') + ' ' + (m.dueTime || '99:99');
    // non ancora completabile: una missione prima della sua disponibilità (giorno e ora), una routine prima del suo giorno
    const notYet = m => !m.done && !m.failed && (m.rid ? !!m.due && m.due > todayStr() : !!m.from && Date.now() < startMs(m));
    // il prossimo istante in cui una missione cambia stato (diventa disponibile o scade); Infinity se nessuna
    function nextChange(missions, now) {
      return missions.reduce((mn, m) => {
        if (m.done || m.failed) return mn;
        const st = startMs(m);
        if (st > now) mn = Math.min(mn, st);   // diventa disponibile
        if (!m.due) return mn;
        const e = dueEndMs(m);
        return e > now ? Math.min(mn, e) : mn;   // scade
      }, Infinity);
    }

    /* ---------- elenchi ---------- */
    // le tre liste della scheda Missioni, già in ordine, e le "da fare" divise per gruppi di scadenza
    function missionLists(missions) {
      const pending = missions.filter(m => !m.done);
      const todo = pending.filter(m => !m.failed).sort((a, b) =>
        dueKey(a).localeCompare(dueKey(b)) || a.created.localeCompare(b.created) || a.title.localeCompare(b.title));
      const failed = pending.filter(m => m.failed).sort((a, b) =>
        b.failed.date.localeCompare(a.failed.date) || dueKey(b).localeCompare(dueKey(a)) || a.title.localeCompare(b.title));
      const done = missions.filter(m => m.done).sort((a, b) =>
        b.done.date.localeCompare(a.done.date) || b.done.t - a.done.t);
      const today = todayStr();
      const soon = parseDate(today); soon.setDate(soon.getDate() + 7);
      const soonEnd = isoDate(soon);
      const groups = { late: [], routine: [], today: [], soon: [], later: [], nodate: [] };
      todo.forEach(m => {
        const key = m.due || m.from;
        if (!key) groups.nodate.push(m);
        else if (isLate(m)) groups.late.push(m);
        else if (key === today) (m.rid ? groups.routine : groups.today).push(m);
        else if (key <= soonEnd) groups.soon.push(m);
        else groups.later.push(m);
      });
      return { todo, failed, done, groups };
    }
    // le missioni di un giorno del calendario (da fare, fallite, completate)
    function dayLists(missions, ds) {
      const byTime = (a, b) => dueKey(a).localeCompare(dueKey(b)) || a.title.localeCompare(b.title);
      const todo = missions.filter(m => !m.done && !m.failed && (m.due || m.from) === ds).sort(byTime);
      const failed = missions.filter(m => !m.done && m.failed && m.due === ds).sort(byTime);
      const done = missions.filter(m => m.done && m.done.date === ds).sort((a, b) => b.done.t - a.done.t || a.title.localeCompare(b.title));   // le più recenti in alto
      return { todo, failed, done };
    }
    // i pallini del calendario: quante missioni da fare, fallite e completate per ogni giorno
    function calendarMarks(missions) {
      const todo = {}, done = {}, fail = {};
      missions.forEach(m => {
        if (m.done) done[m.done.date] = (done[m.done.date] || 0) + 1;
        else if (m.due && m.failed) fail[m.due] = (fail[m.due] || 0) + 1;
        else if (m.due || m.from) { const k = m.due || m.from; todo[k] = (todo[k] || 0) + 1; }
      });
      return { todo, done, fail };
    }
    // le missioni scadute ma non ancora segnate come fallite, nell'ordine in cui si applicano le penalità
    const lateMissions = missions => missions
      .filter(m => !m.done && !m.failed && m.due && isLate(m))
      .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.created.localeCompare(b.created));

    /* ---------- XP (cambiano l'oggetto xp ricevuto) ---------- */
    // completare (o togliere una penalità): aggiunge gli XP, senza superare il massimo; restituisce quanto è stato aggiunto davvero
    function gainXp(xp, map, extra = {}) {
      const applied = {};
      STATS.forEach(s => {
        const b = xp[s.key];
        xp[s.key] = Math.min(MAX_XP, b + (map[s.key] || 0) + (extra[s.key] || 0));
        applied[s.key] = xp[s.key] - b;
      });
      return applied;
    }
    // annullare un completamento: toglie quello che era stato aggiunto, senza scendere sotto zero
    function undoXp(xp, applied) {
      const removed = {};
      STATS.forEach(s => {
        const b = xp[s.key];
        xp[s.key] = Math.max(0, b - (applied[s.key] || 0));
        removed[s.key] = b - xp[s.key];
      });
      return removed;
    }
    // penalità: si perde al massimo quello che si ha
    function penaltyXp(xp, penalty) {
      const removed = {};
      STATS.forEach(s => {
        const r = Math.min(xp[s.key], penalty[s.key] || 0);
        xp[s.key] -= r;
        removed[s.key] = r;
      });
      return removed;
    }

    /* ---------- routine ---------- */
    const WD_ALL = [1, 2, 3, 4, 5, 6, 0];   // giorni nel modulo, lunedì per primo (numeri di Date.getDay)
    const inPause = (r, d) => !!r.pause && r.pause.from <= d && d <= r.pause.until;
    const dayCounts = (r, d) => d >= r.start && r.days.includes(parseDate(d).getDay()) && !inPause(r, d);   // quel giorno la routine c'è
    const occId = (r, d) => r.id + '-' + d.replace(/-/g, '');   // id della "volta" di una routine in un giorno
    const routineOf = (routines, m) => (m && m.rid ? routines.find(r => r.id === m.rid) || null : null);
    // completando una volta di una routine: la serie cresce solo se la completi entro il giorno previsto;
    // ogni "every" volte di fila arriva il bonus. Non cambia niente: restituisce la serie nuova (rs) e il bonus.
    function streakStep(rt, m, today) {
      let rs = null;
      const bonus = {};
      if (rt && m.due && today <= m.due && m.due > (rt.streakDate || '')) {
        const n = (rt.streak || 0) + 1;
        rs = { prev: rt.streak || 0, prevDate: rt.streakDate || '', n };
        if (rt.bonus && n % rt.bonus.every === 0) STATS.forEach(s => { if (m.rewards[s.key] > 0) bonus[s.key] = rt.bonus.xp; });
      }
      return { rs, bonus };
    }
    // annullando quella volta, la serie torna com'era prima (cambia la routine); true se è cambiata
    function streakUndo(rt, rs, due) {
      if (!rs || !rt || rt.streakDate !== due) return false;
      rt.streak = rs.prev;
      rt.streakDate = rs.prevDate || addDaysStr(due, -1);
      return true;
    }
    // Il "giro di oggi" delle routine: crea le volte di oggi (e quelle saltate dall'ultima apertura), interrompe le serie
    // non rispettate, toglie le pause finite e pulisce le volte che non servono più.
    // Cambia le routine ricevute e aggiunge le volte nuove all'elenco delle missioni; restituisce:
    //   missions (l'elenco dopo la pulizia), changed (missioni cambiate), routinesChanged, months (mesi da salvare).
    function routineDay(routines, missions, today) {
      const months = new Set();
      if (!routines.length && !missions.some(m => m.rid)) return { missions, changed: false, routinesChanged: false, months };
      const yesterday = addDaysStr(today, -1);
      let changed = false, routinesChanged = false;
      routines.forEach(r => {
        // la serie si interrompe se un giorno previsto (già passato) non è stato completato in tempo
        if ((r.streakDate || '') < yesterday) {
          let d = r.streakDate ? addDaysStr(r.streakDate, 1) : r.start;
          for (let guard = 0; d <= yesterday && guard < 800; guard++, d = addDaysStr(d, 1)) {
            if (r.streak && dayCounts(r, d)) r.streak = 0;
          }
          r.streakDate = yesterday;
          routinesChanged = true;
        }
        if (r.pause && r.pause.until < today) { r.pause = null; routinesChanged = true; }
        // le volte di oggi e quelle saltate dall'ultima apertura: ogni giorno previsto conta,
        // con o senza penalità (chi non ha messo una penalità perde comunque la serie, ma non XP).
        // Si parte dal giorno dopo "made": un giorno già fatto non si ricrea mai, anche se la sua missione
        // è stata tolta (dalla pulizia dei 60 giorni o eliminata da te). Senza "made" (routine di prima):
        // al massimo gli ultimi 60 giorni, così le volte vecchie già tolte non tornano a fallire.
        const existing = new Set(missions.filter(mm => mm.rid === r.id).map(mm => mm.id));
        const oldest = addDaysStr(today, -(KEEP_DAYS - 1));   // un giorno dentro il confine della pulizia, per sicurezza
        const from = r.made ? addDaysStr(r.made, 1) : (r.start > oldest ? r.start : oldest);
        for (let d = from, guard = 0; d <= today && guard < 3660; guard++, d = addDaysStr(d, 1)) {
          if (!dayCounts(r, d)) continue;
          const id = occId(r, d);
          if (existing.has(id) || missions.length >= MAX_MISSIONS) continue;
          missions.push({ id, title: r.title, desc: r.desc, rewards: { ...r.rewards }, penalty: { ...r.penalty },
            due: d, dueTime: r.time, created: d, done: null, failed: null, rid: r.id, stars: r.stars });
          existing.add(id);
          months.add(d.slice(0, 7));
          changed = true;
        }
        if (r.start <= today && r.made !== today) { r.made = today; routinesChanged = true; }
      });
      // pulizia: volte saltate senza penalità, volte in pausa, cronologia vecchia
      const keepFrom = addDaysStr(today, -KEEP_DAYS);
      missions = missions.filter(m => {
        if (!m.rid) return true;
        const r = routineOf(routines, m);
        let drop = false;
        if (!m.done && !m.failed) drop = !!r && (inPause(r, m.due) || m.due < r.start);
        else drop = (m.done || m.failed).date < keepFrom;
        if (drop) { months.add(monthOf(m)); changed = true; }
        return !drop;
      });
      return { missions, changed, routinesChanged, months };
    }
    // routine previste nei giorni futuri (non sono ancora missioni: compaiono il giorno stesso)
    // ids: gli id delle missioni che esistono già
    function plannedRoutines(routines, ds, ids) {
      if (ds <= todayStr()) return [];
      return routines.filter(r => dayCounts(r, ds) && !ids.has(occId(r, ds)));
    }

    /* ---------- Google Calendar ---------- */
    const d8 = ds => ds.replace(/-/g, '');
    // l'evento dura mezz'ora dall'ora scelta; senza ora è un evento di tutto il giorno
    function gcalDates(ds, time) {
      if (time) {
        const [hh, mm] = time.split(':').map(Number);
        const e = parseDate(ds); e.setHours(hh, mm + 30, 0, 0);
        return d8(ds) + 'T' + pad2(hh) + pad2(mm) + '00/' + d8(isoDate(e)) + 'T' + pad2(e.getHours()) + pad2(e.getMinutes()) + '00';
      }
      return d8(ds) + '/' + d8(addDaysStr(ds, 1));
    }
    // collegamento "Aggiungi a Google Calendar" per una missione con scadenza
    function gcalUrl(m) {
      let u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(m.title) + '&dates=' + gcalDates(m.due, m.dueTime);
      if (m.desc) u += '&details=' + encodeURIComponent(m.desc);
      return u;
    }
    // per una routine: un evento che si ripete, a partire dal primo giorno previsto (dopo un'eventuale pausa)
    function gcalRoutineUrl(r) {
      let d = todayStr();
      for (let i = 0; i < 400 && !dayCounts(r, d); i++) d = addDaysStr(d, 1);
      if (!dayCounts(r, d)) { d = todayStr(); for (let i = 0; i < 7 && !r.days.includes(parseDate(d).getDay()); i++) d = addDaysStr(d, 1); }
      const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const rule = r.days.length === 7 ? 'RRULE:FREQ=DAILY' : 'RRULE:FREQ=WEEKLY;BYDAY=' + WD_ALL.filter(x => r.days.includes(x)).map(x => BY[x]).join(',');
      let u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(r.title) + '&dates=' + gcalDates(d, r.time) + '&recur=' + encodeURIComponent(rule);
      if (r.desc) u += '&details=' + encodeURIComponent(r.desc);
      return u;
    }

    return {
      MAX_PER_MONTH, MAX_MISSIONS, MAX_ROUTINES, KEEP_DAYS,
      pad2, isoDate, parseDate, todayStr, addDaysStr, monthOf, validDate, validTime,
      normalizeRewards, REWARD_WEIGHT, REWARD_BASE, rewardTotal, rewardMatch, normalizeStars,
      normalizeMissions, normalizeRoutines,
      startMs, dueEndMs, isLate, dueKey, notYet, nextChange,
      missionLists, dayLists, calendarMarks, lateMissions,
      gainXp, undoXp, penaltyXp,
      WD_ALL, inPause, dayCounts, occId, routineOf, streakStep, streakUndo, routineDay, plannedRoutines,
      gcalUrl, gcalRoutineUrl,
    };
  }
  window.LIFE_RPG_MISSIONS = { create };
})();
