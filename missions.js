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
 * - le azioni su una missione: completare, annullare, fallire, annullare la penalità (XP, serie e record insieme);
 * - routine: in quali giorni contano, creazione delle "volte" di ogni giorno, serie e bonus;
 * - calendario: pallini dei giorni e routine previste; primo giorno della settimana (secondo la lingua dell'app);
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
    const KEEP_DAYS = 60;
    const MAX_BRKS = 30;         // giorni mancati ricordati per routine (per ridare la serie se li recuperi)        // le routine completate o fallite più vecchie si tolgono dalla cronologia

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

    /* ---------- fusi orari (routine di gruppo) ---------- */
    // Una routine di gruppo ha UN giorno per tutti: quello di chi l'ha creata (il suo fuso, tz). Chi è in un altro
    // fuso vede la scadenza nella sua ora. Se il fuso non è valido (o manca) si usa quello di questo dispositivo.
    const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
    const zoneFmt = {};
    function zoneParts(ms, tz) {
      try {
        const f = zoneFmt[tz] || (zoneFmt[tz] = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
        const p = {};
        f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = Number(x.value); });
        return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
      } catch (e) {
        const d = new Date(ms);
        return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
      }
    }
    // il giorno (AAAA-MM-GG) di quell'istante nel fuso tz
    const zoneDay = (ms, tz) => { const p = zoneParts(ms, tz); return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d); };
    // l'istante in cui nel fuso tz è il giorno ds all'ora hh:mm (con l'ora legale: se quell'ora non esiste, la prima dopo)
    function zoneMs(ds, time, tz) {
      const [y, mo, d] = ds.split('-').map(Number);
      const [hh, mm] = (time || '00:00').split(':').map(Number);
      const want = Date.UTC(y, mo - 1, d, hh, mm);
      const offAt = t => { const p = zoneParts(t, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };   // di quanto il fuso è avanti
      let t = want;
      for (let i = 0; i < 3; i++) {
        const next = want - offAt(t);
        if (next === t) return t;
        t = next;
      }
      // Non si ferma: l'ora cade nel salto dell'ora legale (per esempio le 02:30 della notte in cui si passa dalle 02:00
      // alle 03:00) e il calcolo oscilla fra due istanti. Si prende il più tardi, cioè "la prima dopo" (le 03:30), come Date.
      return Math.max(t, want - offAt(t));
    }
    // scadenza di una volta di una routine di gruppo: alla fine del minuto scelto o, senza ora, alla fine del giorno
    const groupDueMs = (r, ds) => (r.time ? zoneMs(ds, r.time, r.tz) + 60000 : zoneMs(addDaysStr(ds, 1), '00:00', r.tz));
    // la scadenza (istante) nell'ora di questo dispositivo: senza ora se cade a mezzanotte (fine del giorno)
    function localDue(ms) {
      const dt = new Date(ms);
      if (dt.getHours() === 0 && dt.getMinutes() === 0) return { due: isoDate(new Date(ms - 1)), dueTime: null };
      const e = new Date(ms - 60000);   // "entro le 18:00" vuol dire fino alla fine del minuto 18:00
      return { due: isoDate(e), dueTime: pad2(e.getHours()) + ':' + pad2(e.getMinutes()) };
    }
    // il "giorno di oggi" di una routine: per quelle di gruppo è il giorno nel fuso del gruppo
    const routineToday = (r, now = Date.now()) => (r && r.tz ? zoneDay(now, r.tz) : isoDate(new Date(now)));

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
        // volta di una routine di gruppo: gd = il giorno del gruppo (nel fuso di chi l'ha creata), che può essere
        // diverso da "due" (la scadenza nell'ora di questo dispositivo) se siete in fusi orari diversi
        if (it.rid && validDate(m.gd)) it.gd = m.gd;
        // volta di una routine recuperata (penalità annullata o riprogrammata): re = il giorno entro cui completarla;
        // rj = la serie che è tornata con il recupero (si toglie di nuovo se la volta fallisce ancora)
        if (it.rid && validDate(m.re)) it.re = m.re;
        // gc = hai premuto "Aggiungi a Google Calendar": eliminandola, l'app ti ricorda di toglierla anche da lì
        if (!it.rid && m.gc) it.gc = 1;
        if (it.re && Number.isInteger(m.rj) && m.rj >= 0 && m.rj <= 100000) it.rj = m.rj;
        // missione condivisa con un amico (vedi shared.js): sid = il documento condiviso, sh = il tuo ruolo
        // ('o' = l'hai creata tu, 'g' = sei stato invitato)
        if (!it.rid && typeof m.sid === 'string' && /^[\w-]{1,40}$/.test(m.sid)) { it.sid = m.sid; it.sh = m.sh === 'g' ? 'g' : 'o'; }
        // shn = i nomi degli altri partecipanti, salvati nella missione: il documento condiviso a un certo punto si elimina
        // (prima c'era un solo nome, come testo: lo si accetta ancora)
        if (it.sid) {
          const names = (Array.isArray(m.shn) ? m.shn : [m.shn]).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 30)).slice(0, 3);
          if (names.length) it.shn = names;
        }
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
            if (Number.isInteger(rs.pb) && rs.pb >= 0) it.done.rs.pb = rs.pb;   // il record di prima (per annullare)
          }
          // routine di gruppo: gb = la serie di gruppo con cui è arrivato il bonus di gruppo (già dentro applied)
          if (it.rid && Number.isInteger(m.done.gb) && m.done.gb > 0) it.done.gb = m.done.gb;
          // volta recuperata completata: ha allungato la serie di 1 (si toglie annullando)
          if (it.rj !== undefined && m.done.rj) {
            it.done.rj = 1;
            if (Number.isInteger(m.done.pb) && m.done.pb >= 0) it.done.pb = m.done.pb;   // il record di prima (per annullare)
          }
        }
        seen.add(id);
        out.push(it);
        if (out.length >= MAX_MISSIONS) break;
      }
      return out;
    }
    function normBrks(a) {
      if (!Array.isArray(a)) return [];
      const seen = new Set();
      return a.filter(b => b && validDate(b.d) && Number.isInteger(b.n) && b.n >= 0 && b.n <= 100000 && !seen.has(b.d) && seen.add(b.d))
        .map(b => ({ d: b.d, n: b.n })).sort((x, y) => x.d.localeCompare(y.d)).slice(-MAX_BRKS);
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
          // i giorni mancati che hanno interrotto la serie: d = il giorno, n = la serie che c'era prima (serve per ridarla se lo recuperi)
          brks: normBrks(r.brks),
        });
        const ru = Number(r.u);
        if (Number.isFinite(ru) && ru > 0) out[out.length - 1].u = Math.floor(ru);   // istante dell'ultima modifica
        // routine di gruppo (vedi shared-routines.js): sr = il documento condiviso, sh = il tuo ruolo ('o' = l'hai creata,
        // 'g' = sei stato invitato), shn = i nomi degli altri, tz = il fuso del gruppo (quello di chi l'ha creata),
        // gs / gsd / gbest = serie di gruppo, giorno dell'ultima volta "tutti insieme" e record
        const it = out[out.length - 1];
        if (typeof r.sr === 'string' && /^q[a-z0-9]{6,11}$/.test(r.sr)) {
          it.sr = r.sr; it.sh = r.sh === 'g' ? 'g' : 'o';
          const names = (Array.isArray(r.shn) ? r.shn : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 30)).slice(0, 3);
          if (names.length) it.shn = names;
          if (typeof r.tz === 'string' && r.tz && r.tz.length <= 64) it.tz = r.tz;
        }
        // la serie di gruppo resta anche quando il gruppo non c'è più (si vede il record)
        if (validDate(r.gsd)) { it.gs = nn(r.gs, 100000); it.gsd = r.gsd; }
        if (nn(r.gbest, 100000)) it.gbest = nn(r.gbest, 100000);
        if (r.gc) it.gc = 1;   // aggiunta a Google Calendar (vedi le missioni)
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
      if (m.rid && m.re) { const e = parseDate(m.re); e.setDate(e.getDate() + 1); return e.getTime(); }   // recuperata: fino alla fine di quel giorno
      if (!m.due) return Infinity;
      const d = parseDate(m.due);
      if (m.dueTime) { const [hh, mm] = m.dueTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); return d.getTime() + 60000; }
      d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    const isLate = m => !m.done && Date.now() >= dueEndMs(m);
    const dueKey = m => (m.rid && m.re && !m.done && !m.failed ? m.re + ' 99:99' : (m.due || m.from || '9999-99-99') + ' ' + (m.dueTime || '99:99'));
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
        const key = (m.rid && m.re) || m.due || m.from;   // recuperata: conta il giorno entro cui completarla
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
    // Volta recuperata con la serie ridata (rj): la serie si allunga di 1 dove si trovava quel giorno (join = true).
    function streakStep(rt, m, today) {
      let rs = null;
      const bonus = {};
      const day = m.gd || m.due;
      if (rt && day && m.re && m.rj !== undefined) {
        const cur = !(rt.brks || []).some(b => b.d > day);   // nessun altro giorno mancato dopo: si allunga la serie di adesso
        const n = cur ? (rt.streak || 0) + 1 : 0;
        if (cur && rt.bonus && !rt.sr && n % rt.bonus.every === 0) STATS.forEach(s => { if (m.rewards[s.key] > 0) bonus[s.key] = rt.bonus.xp; });
        return { rs, bonus, join: true, n };
      }
      if (rt && day && today <= (m.re && m.re > day ? m.re : day) && day > (rt.streakDate || '')) {
        const n = (rt.streak || 0) + 1;
        rs = { prev: rt.streak || 0, prevDate: rt.streakDate || '', n, pb: rt.best || 0 };
        if (rt.bonus && !rt.sr && n % rt.bonus.every === 0) STATS.forEach(s => { if (m.rewards[s.key] > 0) bonus[s.key] = rt.bonus.xp; });
      }
      return { rs, bonus };
    }
    // annullando quella volta, la serie torna com'era prima (cambia la routine); true se è cambiata
    function streakUndo(rt, rs, due) {
      if (!rs || !rt || rt.streakDate !== due) return false;
      rt.streak = rs.prev;
      rt.streakDate = rs.prevDate || addDaysStr(due, -1);
      // il record torna com'era, se era stato questo completamento ad alzarlo
      if (Number.isInteger(rs.pb) && rt.best === rs.n) rt.best = Math.max(rs.pb, rt.streak);
      return true;
    }
    // La serie è fatta di pezzi separati dai giorni mancati (rt.brks). Aggiunge delta al pezzo che viene dopo il giorno
    // "day": il prossimo giorno mancato (la sua n) oppure, se non ce ne sono, la serie di adesso. Cambia la routine;
    // restituisce true se è cambiata la serie di adesso.
    // Il record (best) sale solo con upBest: cioè completando, non recuperando (la serie ridata non è ancora "guadagnata").
    function streakShift(rt, day, delta, upBest) {
      if (!rt || !delta) return false;
      const next = (rt.brks || []).find(b => b.d > day);
      if (next) { next.n = Math.max(0, next.n + delta); return false; }
      rt.streak = Math.max(0, (rt.streak || 0) + delta);
      if (upBest) rt.best = Math.max(rt.best || 0, rt.streak);
      return true;
    }
    // recuperando il giorno mancato "day": la serie di prima si riattacca (cambia la routine). Restituisce la serie
    // ridata (anche 0), oppure null se quel giorno non ha interrotto niente (per esempio: recuperato lo stesso giorno)
    function streakRecover(rt, day) {
      if (!rt || !rt.brks) return null;
      const i = rt.brks.findIndex(b => b.d === day);
      if (i < 0) return null;
      const n = rt.brks[i].n;
      rt.brks.splice(i, 1);
      streakShift(rt, day, n);
      return n;
    }
    // la volta recuperata è fallita di nuovo: la serie ridata si toglie e il giorno torna tra quelli mancati (cambia la routine)
    function streakLose(rt, day, n) {
      if (!rt || !Number.isInteger(n)) return;
      streakShift(rt, day, -n);
      if (!rt.brks) rt.brks = [];
      if (!rt.brks.some(b => b.d === day)) {
        rt.brks.push({ d: day, n });
        rt.brks.sort((x, y) => x.d.localeCompare(y.d));
        if (rt.brks.length > MAX_BRKS) rt.brks.splice(0, rt.brks.length - MAX_BRKS);
      }
    }
    /* ---------- azioni su una missione ---------- */
    // Le usa missions-ui.js quando premi i pulsanti (o scatta una penalità), e le usano i test: così le regole di XP,
    // serie e record sono in un posto solo. Cambiano xp, la missione e la routine (rt, anche null) che ricevono;
    // non salvano e non disegnano niente. routineChanged = la routine è cambiata (va salvata).

    // Completare: XP (con l'eventuale bonus della serie), serie e record. t = l'istante da salvare (ordina le completate).
    // Restituisce { applied, bonus, n, routineChanged }; n = la serie da mostrare nel messaggio.
    function applyComplete(xp, m, rt, t = Date.now(), now = Date.now()) {
      const { rs, bonus, join, n } = streakStep(rt, m, routineToday(rt, now));
      const applied = gainXp(xp, m.rewards, bonus);
      m.done = { date: isoDate(new Date(now)), t, applied };
      let routineChanged = false;
      if (join) {
        // volta recuperata: la serie ridata si allunga di 1, come se l'avessi completata in tempo
        m.done.rj = 1;
        const pb = rt.best || 0;
        if (streakShift(rt, m.gd || m.due, 1, true)) m.done.pb = pb;   // il record di prima, per annullare
        routineChanged = true;
      } else if (rs) {
        m.done.rs = rs;
        rt.streak = rs.n; rt.streakDate = m.gd || m.due; rt.best = Math.max(rt.best || 0, rs.n);
        routineChanged = true;
      }
      return { applied, bonus, n: rs ? rs.n : join ? n : 0, routineChanged };
    }
    // Annullare un completamento: gli XP tornano indietro, la serie e il record tornano com'erano.
    // Restituisce { removed, routineChanged }.
    function applyUndo(xp, m, rt) {
      const removed = undoXp(xp, m.done.applied);
      const { rs, rj, pb } = m.done;
      m.done = null;
      let routineChanged = false;
      if (rj && rt) {   // volta recuperata: toglie il +1 (e il record torna com'era, se l'aveva alzato lei)
        const was = rt.streak || 0;
        if (streakShift(rt, m.gd || m.due, -1) && Number.isInteger(pb) && rt.best === was) rt.best = pb;
        routineChanged = true;
      } else routineChanged = streakUndo(rt, rs, m.gd || m.due);
      return { removed, routineChanged };
    }
    // Fallire: si perdono gli XP della penalità (pay = false: nessuna perdita, per esempio se ha abbandonato un amico).
    // Una volta di routine recuperata che fallisce di nuovo perde la serie ridata. Restituisce { removed, routineChanged }.
    function applyFail(xp, m, rt, date, t, pay = true) {
      const removed = pay ? penaltyXp(xp, m.penalty) : normalizeRewards(null);
      m.failed = { date, t, applied: removed };
      let routineChanged = false;
      if (m.re) {
        if (m.rj !== undefined && rt) { streakLose(rt, m.gd || m.due, m.rj); routineChanged = true; }
        delete m.re; delete m.rj;
      }
      return { removed, routineChanged };
    }
    // Annullare la penalità (o riprogrammare, se non c'era): gli XP persi tornano.
    // Missione: resta senza scadenza (se ne sceglie una nuova). Volta di una routine: resta legata al suo giorno ed è
    // da fare fino alla fine di oggi; se quel giorno aveva interrotto la serie, la serie di prima si riattacca.
    // Restituisce { restored, routineChanged }.
    function applyRevert(xp, m, rt, now = Date.now()) {
      const restored = gainXp(xp, m.failed.applied);
      m.failed = null;
      if (!m.rid) { m.due = null; m.dueTime = null; return { restored, routineChanged: false }; }
      m.re = isoDate(new Date(now));
      delete m.rj;
      const back = streakRecover(rt, m.gd || m.due);
      if (back !== null) m.rj = back;
      return { restored, routineChanged: back !== null };
    }
    // Il "giro di oggi" delle routine: crea le volte di oggi (e quelle saltate dall'ultima apertura), interrompe le serie
    // non rispettate, toglie le pause finite e pulisce le volte che non servono più.
    // Cambia le routine ricevute e aggiunge le volte nuove all'elenco delle missioni; restituisce:
    //   missions (l'elenco dopo la pulizia), changed (missioni cambiate), routinesChanged, months (mesi da salvare).
    function routineDay(routines, missions, today0, nowMs = Date.now()) {
      const months = new Set();
      if (!routines.length && !missions.some(m => m.rid)) return { missions, changed: false, routinesChanged: false, months };
      let changed = false, routinesChanged = false;
      const here = hereTz();
      routines.forEach(r => {
        // routine di gruppo: i giorni sono quelli del fuso del gruppo
        const zoned = !!(r.sr && r.tz);
        const today = zoned ? zoneDay(nowMs, r.tz) : today0;
        const yesterday = addDaysStr(today, -1);
        // la serie si interrompe se un giorno previsto (già passato) non è stato completato in tempo
        if ((r.streakDate || '') < yesterday) {
          let d = r.streakDate ? addDaysStr(r.streakDate, 1) : r.start;
          if (!r.brks) r.brks = [];
          const keep = addDaysStr(today, -KEEP_DAYS);
          for (let guard = 0; d <= yesterday && guard < 800; guard++, d = addDaysStr(d, 1)) {
            if (!dayCounts(r, d)) continue;
            // ogni giorno mancato si ricorda con la serie che c'era prima: se lo recuperi, la serie torna
            if (d >= keep && !r.brks.some(b => b.d === d)) r.brks.push({ d, n: r.streak || 0 });
            r.streak = 0;
          }
          r.brks = r.brks.filter(b => b.d >= keep).sort((x, y) => x.d.localeCompare(y.d)).slice(-MAX_BRKS);
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
          const occ = { id, title: r.title, desc: r.desc, rewards: { ...r.rewards }, penalty: { ...r.penalty },
            due: d, dueTime: r.time, created: d, done: null, failed: null, rid: r.id, stars: r.stars };
          if (zoned) {
            occ.gd = d;
            if (r.tz !== here) Object.assign(occ, localDue(groupDueMs(r, d)));   // la scadenza del gruppo, nella tua ora
          }
          missions.push(occ);
          existing.add(id);
          months.add(d.slice(0, 7));
          changed = true;
        }
        if (r.start <= today && r.made !== today) { r.made = today; routinesChanged = true; }
      });
      // pulizia: volte saltate senza penalità, volte in pausa, cronologia vecchia
      const keepFrom = addDaysStr(today0, -KEEP_DAYS);
      missions = missions.filter(m => {
        if (!m.rid) return true;
        const r = routineOf(routines, m);
        let drop = false;
        const day = m.gd || m.due;
        if (!m.done && !m.failed) drop = !!r && (inPause(r, day) || day < r.start);
        else drop = (m.done || m.failed).date < keepFrom;
        if (drop) { months.add(monthOf(m)); changed = true; }
        return !drop;
      });
      return { missions, changed, routinesChanged, months };
    }
    /* ---------- serie di gruppo ---------- */
    // il giorno previsto più vicino prima di ds (dopo l'inizio, fuori dalle pause); '' se non c'è
    function prevDay(r, ds) {
      let d = addDaysStr(ds, -1);
      for (let i = 0; i < 400 && d >= r.start; i++, d = addDaysStr(d, -1)) if (dayCounts(r, d)) return d;
      return '';
    }
    // l'ultimo giorno previsto già chiuso (scadenza passata) a quell'istante
    function lastClosedDay(r, now) {
      let d = zoneDay(now, r.tz);
      for (let i = 0; i < 400 && d >= r.start; i++, d = addDaysStr(d, -1)) if (dayCounts(r, d) && groupDueMs(r, d) <= now) return d;
      return '';
    }
    // la serie di gruppo che si vede adesso: 0 se dopo l'ultima volta "tutti insieme" un giorno previsto è passato senza
    function groupStreakNow(r, now = Date.now()) {
      if (!r.gsd || !r.gs) return 0;
      const last = r.tz ? lastClosedDay(r, now) : '';
      return !last || r.gsd >= last ? r.gs : 0;
    }
    // un giorno "tutti insieme" in più: serie nuova e bonus (se la serie arriva a un multiplo di bonus.every).
    // Non cambia niente: restituisce { n, bonus }.
    function groupStep(r, ds) {
      const n = r.gsd && r.gsd === prevDay(r, ds) ? (r.gs || 0) + 1 : 1;
      const bonus = {};
      if (r.bonus && n % r.bonus.every === 0) STATS.forEach(s => { if (r.rewards[s.key] > 0) bonus[s.key] = r.bonus.xp; });
      return { n, bonus };
    }

    // routine previste nei giorni futuri (non sono ancora missioni: compaiono il giorno stesso)
    // ids: gli id delle missioni che esistono già
    function plannedRoutines(routines, ds, ids) {
      if (ds <= todayStr()) return [];
      return routines.filter(r => dayCounts(r, ds) && !ids.has(occId(r, ds)));
    }

    /* ---------- primo giorno della settimana ---------- */
    // Non è uguale ovunque: lunedì in Italia e quasi tutta l'Europa, domenica in Brasile, Stati Uniti, Giappone...,
    // sabato in parte del Medio Oriente. I numeri sono quelli di Date.getDay (0 = domenica, 1 = lunedì, 6 = sabato).
    // Il browser di solito lo sa (Intl.Locale); dove non lo sa (per esempio Firefox) si usa questa tabella,
    // presa dai dati internazionali CLDR: le regioni non elencate iniziano di lunedì.
    const WEEK_SUN = new Set(('AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI '
      + 'NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW').split(' '));
    const WEEK_SAT = new Set('AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '));
    const WEEK_FRI = new Set(['MV']);
    const regionFirstDay = region => {
      const r = String(region || '').toUpperCase();
      return WEEK_SUN.has(r) ? 0 : WEEK_SAT.has(r) ? 6 : WEEK_FRI.has(r) ? 5 : 1;
    };
    // il primo giorno della settimana per una lingua ("pt-BR", "it-IT", "en"...); senza regione
    // si prende quella più probabile ("pt" → Brasile, "en" → Stati Uniti). useIntl = false: solo la tabella (per i test)
    function localeFirstDay(tag, useIntl = true) {
      let loc = null;
      try { loc = new Intl.Locale(tag); } catch (e) { return 1; }
      if (useIntl) {
        try {
          const wi = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
          if (wi && Number.isInteger(wi.firstDay) && wi.firstDay >= 1 && wi.firstDay <= 7) return wi.firstDay % 7;
        } catch (e) { /* non disponibile: si usa la tabella */ }
      }
      let region = loc.region;
      if (!region) { try { region = loc.maximize().region; } catch (e) { region = ''; } }
      return regionFirstDay(region);
    }
    // la scelta delle impostazioni: 'auto' (secondo la lingua dell'app, tag) oppure 1, 0, 6 (lunedì, domenica, sabato)
    const WEEK_PREFS = ['auto', 1, 0, 6];
    const firstDayOf = (pref, tag) => (pref === 0 || pref === 1 || pref === 6 ? pref : localeFirstDay(tag));
    // i sette giorni in ordine, dal primo (numeri di Date.getDay)
    const weekOrder = first => Array.from({ length: 7 }, (_, i) => (first + i) % 7);
    // il primo giorno della settimana che contiene ds
    const weekStart = (ds, first) => addDaysStr(ds, -((parseDate(ds).getDay() - first + 7) % 7));
    // calendario: le caselle vuote prima del giorno 1 del mese (m da 0 a 11)
    const calOffset = (y, m, first) => (new Date(y, m, 1).getDay() - first + 7) % 7;

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
    // Routine di gruppo: giorni e ora sono quelli del fuso del gruppo (r.tz), quindi lo si dice a Google Calendar (ctz),
    // che mette l'evento all'ora giusta nel fuso di chi lo aggiunge (per esempio 18:00 in Italia = 13:00 in Brasile).
    function gcalRoutineUrl(r) {
      const zoned = !!(r.sr && r.tz);
      let d = zoned ? zoneDay(Date.now(), r.tz) : todayStr();
      for (let i = 0; i < 400 && !dayCounts(r, d); i++) d = addDaysStr(d, 1);
      if (!dayCounts(r, d)) { d = zoned ? zoneDay(Date.now(), r.tz) : todayStr(); for (let i = 0; i < 7 && !r.days.includes(parseDate(d).getDay()); i++) d = addDaysStr(d, 1); }
      const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const rule = r.days.length === 7 ? 'RRULE:FREQ=DAILY' : 'RRULE:FREQ=WEEKLY;BYDAY=' + WD_ALL.filter(x => r.days.includes(x)).map(x => BY[x]).join(',');
      let u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(r.title) + '&dates=' + gcalDates(d, r.time) + '&recur=' + encodeURIComponent(rule);
      if (zoned) u += '&ctz=' + encodeURIComponent(r.tz);
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
      WD_ALL, inPause, dayCounts, occId, routineOf, streakStep, streakUndo, streakShift, streakRecover, streakLose, routineDay,
      applyComplete, applyUndo, applyFail, applyRevert, plannedRoutines,
      hereTz, zoneDay, zoneMs, groupDueMs, localDue, routineToday, prevDay, lastClosedDay, groupStreakNow, groupStep,
      gcalUrl, gcalRoutineUrl,
      regionFirstDay, localeFirstDay, WEEK_PREFS, firstDayOf, weekOrder, weekStart, calOffset,
    };
  }
  window.LIFE_RPG_MISSIONS = { create };
})();