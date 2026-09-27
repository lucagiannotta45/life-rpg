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
 * - le azioni su una missione: completare, annullare il completamento, fallire (XP, serie e record insieme);
 * - routine: ogni giorno (in certi giorni della settimana), ogni settimana o ogni mese, N volte per periodo;
 *   creazione delle "volte" di ogni periodo, contatore, serie e bonus, saltare una volta;
 *   cambi delle regole (tutto tranne titolo e descrizione) che valgono dal periodo successivo;
 * - impegni: nelle missioni le modifiche (tranne titolo e descrizione) valgono dal giorno dopo, e una missione con
 *   penalità (o una routine con una volta in corso) si elimina dal giorno dopo (vedi "impegni", più sotto);
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
    const MAX_BRKS = 30;         // periodi mancati ricordati per routine (per ridare la serie se li recuperi)
    const MAX_SKIPS = 120;       // volte saltate ricordate per routine (le più vecchie di KEEP_DAYS si tolgono comunque)
    const MAX_TIMES = 999;       // volte per periodo: non è un limite per chi gioca, serve solo a scartare i dati rovinati
    const MAX_EVERY = 100000;    // bonus "ogni N di fila": come la serie (oltre non scatterebbe mai); solo contro i dati rovinati
    const FREQS = ['d', 'w', 'm'];   // frequenza di una routine: ogni giorno, ogni settimana, ogni mese
    const GRACE_MS = 15 * 60000;     // appena creata (15 minuti), una missione o una routine si corregge subito

    /* ---------- date ---------- */
    const pad2 = n => String(n).padStart(2, '0');
    const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const todayStr = () => isoDate(new Date());
    const addDaysStr = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return isoDate(d); };
    // giorni da a a b (b - a); Math.round perché con l'ora legale un giorno può durare 23 o 25 ore
    const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
    // k mesi dopo ds, con lo stesso numero del giorno; se quel mese è più corto, il suo ultimo giorno
    // (dal 31 gennaio: 28 febbraio, 31 marzo, 30 aprile: il giorno di partenza non si perde)
    function addMonthsStr(ds, k) {
      const [y, m, d] = ds.split('-').map(Number);
      const t = new Date(y, m - 1 + k, 1);
      t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
      return isoDate(t);
    }
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
        // volta di una routine da più volte per periodo: n = quante ne servono, p = i giorni in cui ne hai segnata una
        // (le ricompense arrivano solo con l'ultima). ps = il primo giorno del periodo (routine settimanali e mensili:
        // la volta si può fare dal primo giorno e scade l'ultimo, cioè "due")
        if (it.rid) {
          const n = Number(m.n);
          if (Number.isInteger(n) && n >= 2 && n <= MAX_TIMES) { it.n = n; it.p = (Array.isArray(m.p) ? m.p : []).filter(validDate).slice(0, n); }
          if (validDate(m.ps)) it.ps = m.ps;
        }
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
        // shd = una tua modifica (l'hai creata tu) che il documento condiviso non ha ancora confermato: si riprova (shared.js)
        if (it.sid && it.sh === 'o' && m.shd) it.shd = 1;
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
        // ct = l'istante in cui l'hai creata (per i 15 minuti in cui si corregge subito)
        const mct = Number(m.ct);
        if (!it.rid && Number.isFinite(mct) && mct > 0) it.ct = Math.floor(mct);
        // nx = le modifiche che valgono dal giorno at (XP, stelle, penalità, date); del = il giorno da cui sparisce
        // (eliminata quando c'era un impegno in corso). Solo le missioni tue, non le volte delle routine né le condivise
        if (!it.rid && !it.sid && m.nx && typeof m.nx === 'object' && validDate(m.nx.at)) {
          const x = m.nx, rw = normalizeRewards(x.rewards);
          if (Object.values(rw).some(v => v > 0)) {
            const due = validDate(x.due) ? x.due : null, from = validDate(x.from) ? x.from : null;
            it.nx = { at: x.at, rewards: rw, penalty: normalizeRewards(x.penalty), stars: normalizeStars(rw, x.stars),
              due, dueTime: due && validTime(x.dueTime) ? x.dueTime : null, from, fromTime: from && validTime(x.fromTime) ? x.fromTime : null };
          }
        }
        if (!it.rid && !it.sid && validDate(m.del)) it.del = m.del;
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
          // sk: missione condivisa saltata ("Salta": niente XP e niente penalità): finita, ma non completata
          if (m.done.sk) it.done.sk = 1;
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
    // volte saltate: d = il primo giorno del periodo (per le routine di ogni giorno: il giorno), p = le volte già
    // segnate quando l'hai saltata (per ridartele se annulli il salto)
    function normSkips(a) {
      if (!Array.isArray(a)) return [];
      const seen = new Set();
      return a.filter(x => x && validDate(x.d) && !seen.has(x.d) && seen.add(x.d))
        .map(x => {
          const o = { d: x.d };
          const p = Array.isArray(x.p) ? x.p.filter(validDate).slice(0, MAX_TIMES) : [];
          if (p.length) o.p = p;
          return o;
        }).sort((x, y) => x.d.localeCompare(y.d)).slice(-MAX_SKIPS);
    }
    // periodi del calendario (solo settimanali e mensili): { cal: 1, wk } oppure {} (wk solo per le settimanali: 0-6,
    // i numeri di Date.getDay, 1 = lunedì se manca)
    function calOf(freq, x) {
      if (freq === 'd' || !x || x.cal !== 1) return {};
      if (freq !== 'w') return { cal: 1 };
      const wk = Number(x.wk);
      return { cal: 1, wk: Number.isInteger(wk) && wk >= 0 && wk <= 6 ? wk : 1 };
    }
    const normDays = a => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const normTimes = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_TIMES) : 1; };
    // bonus della serie: { every, xp } oppure null
    const normBonus = b => (b && Number.isInteger(b.every) && b.every >= 2 && b.every <= MAX_EVERY && Number.isInteger(b.xp) && b.xp >= 1 && b.xp <= MAX_XP
      ? { every: b.every, xp: b.xp } : null);
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
        const freq = FREQS.includes(r.freq) ? r.freq : 'd';
        const times = normTimes(r.n);
        // i giorni della settimana valgono solo per le routine di ogni giorno
        const days = freq === 'd' ? normDays(r.days) : [];
        if (freq === 'd' && !days.length) continue;
        const bonus = normBonus(r.bonus);
        seen.add(id);
        out.push({
          id, title,
          desc: typeof r.desc === 'string' ? r.desc.trim().slice(0, 500) : '',
          rewards, penalty: normalizeRewards(r.penalty), freq, n: times, days,
          // l'ora vale solo per una volta al giorno: con più volte (o per settimana, per mese) si scade a fine periodo
          time: freq === 'd' && times === 1 && validTime(r.time) ? r.time : null,
          start: r.start,
          streak: nn(r.streak, 100000), streakDate: validDate(r.streakDate) ? r.streakDate : '', best: nn(r.best, 100000),
          bonus, stars: normalizeStars(rewards, r.stars),
          made: validDate(r.made) ? r.made : '',   // fin qui le missioni della routine sono già state create
          // i giorni mancati che hanno interrotto la serie: d = il giorno, n = la serie che c'era prima (serve per ridarla se lo recuperi)
          brks: normBrks(r.brks),
        });
        const ru = Number(r.u);
        if (Number.isFinite(ru) && ru > 0) out[out.length - 1].u = Math.floor(ru);   // istante dell'ultima modifica
        // ct = quando l'hai creata (15 minuti per correggerla subito); del = il giorno da cui sparisce (eliminata con una
        // volta in corso: quella resta, le prossime non arrivano più)
        const rct = Number(r.ct);
        if (Number.isFinite(rct) && rct > 0) out[out.length - 1].ct = Math.floor(rct);
        if (validDate(r.del)) out[out.length - 1].del = r.del;
        // routine di gruppo (vedi shared-routines.js): sr = il documento condiviso, sh = il tuo ruolo ('o' = l'hai creata,
        // 'g' = sei stato invitato), shn = i nomi degli altri, tz = il fuso del gruppo (quello di chi l'ha creata),
        // gs / gsd / gbest = serie di gruppo, giorno dell'ultima volta "tutti insieme" e record
        const it = out[out.length - 1];
        // at = da quando valgono frequenza, volte e giorni di adesso (i periodi si contano da qui); senza, dall'inizio.
        // Può anche venire prima dell'inizio: chi entra in una routine di gruppo inizia dopo, ma i periodi sono quelli
        // del gruppo. pk = il primo giorno dell'ultimo periodo prima di at (serve alla serie di gruppo per restare di fila)
        // cal = periodi del calendario (settimane da wk, il primo giorno della settimana; mesi dal 1° all'ultimo giorno).
        // Senza (routine di prima): i periodi si contano dal primo giorno della routine, come prima
        Object.assign(it, calOf(freq, r));
        if (validDate(r.at) && r.at !== r.start) it.at = r.at;
        if (it.at && validDate(r.pk) && r.pk < it.at) it.pk = r.pk;
        // nx = un cambio delle regole che vale dal periodo successivo (at = il suo primo giorno): frequenza, volte, giorni,
        // ora e periodi del calendario e, se ci sono, ricompense, penalità, stelle e bonus nuovi (i cambi di prima non li
        // hanno: per loro restano quelli di adesso)
        const nx = r.nx;
        if (nx && validDate(nx.at) && nx.at > (it.at || r.start) && FREQS.includes(nx.freq)) {
          const nd = nx.freq === 'd' ? normDays(nx.days) : [];
          const nn = normTimes(nx.n);
          if (nx.freq !== 'd' || nd.length) {
            it.nx = { at: nx.at, freq: nx.freq, n: nn, days: nd, time: nx.freq === 'd' && nn === 1 && validTime(nx.time) ? nx.time : null, ...calOf(nx.freq, nx) };
            if (validDate(nx.pk) && nx.pk < nx.at) it.nx.pk = nx.pk;
            const nrw = normalizeRewards(nx.rewards);
            if (nx.rewards && Object.values(nrw).some(v => v > 0)) {
              Object.assign(it.nx, { rewards: nrw, penalty: normalizeRewards(nx.penalty), stars: normalizeStars(nrw, nx.stars), bonus: normBonus(nx.bonus) });
            }
          }
        }
        if (typeof r.sr === 'string' && /^q[a-z0-9]{6,11}$/.test(r.sr)) {
          it.sr = r.sr; it.sh = r.sh === 'g' ? 'g' : 'o';
          const names = (Array.isArray(r.shn) ? r.shn : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 30)).slice(0, 3);
          if (names.length) it.shn = names;
          if (typeof r.tz === 'string' && r.tz && r.tz.length <= 64) it.tz = r.tz;
          // srd = una tua modifica che il documento del gruppo non ha ancora confermato (si riprova, vedi shared-routines.js)
          if (it.sh === 'o' && r.srd) it.srd = 1;
        }
        // serie e record di gruppo: solo finché la routine è di gruppo. Finito il gruppo si tolgono (la routine torna
        // normale; un gruppo nuovo riparte da zero, senza ereditare la serie di quello di prima)
        if (it.sr && validDate(r.gsd)) { it.gs = nn(r.gs, 100000); it.gsd = r.gsd; }
        if (it.sr && nn(r.gbest, 100000)) it.gbest = nn(r.gbest, 100000);
        if (r.gc) it.gc = 1;   // aggiunta a Google Calendar (vedi le missioni)
        // volte saltate (routine di gruppo: sono una copia di quelle segnate nel documento del gruppo)
        const sk = normSkips(r.skip);
        if (sk.length) it.skip = sk;
        // routine di gruppo: i periodi saltati da tutti (non contano per la serie di gruppo, come se non ci fossero)
        const gx = it.sr && Array.isArray(r.gx) ? [...new Set(r.gx.filter(validDate))].sort().slice(-MAX_SKIPS) : [];
        if (gx.length) it.gx = gx;
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
    // (settimanali e mensili: prima del primo giorno del periodo). Una volta di una routine di gruppo (gd) si crea solo
    // quando il suo periodo è iniziato nel fuso del gruppo: si può fare subito, anche se qui è ancora il giorno prima.
    const notYet = m => !m.done && !m.failed && (m.rid ? !m.gd && !!(m.ps || m.due) && (m.ps || m.due) > todayStr() : !!m.from && Date.now() < startMs(m));
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
      // period: le volte delle routine settimanali e mensili in corso (si fanno in qualunque giorno del periodo)
      const groups = { late: [], routine: [], period: [], today: [], soon: [], later: [], nodate: [] };
      todo.forEach(m => {
        const key = (m.rid && m.re) || m.due || m.from;   // recuperata: conta il giorno entro cui completarla
        if (!key) groups.nodate.push(m);
        else if (isLate(m)) groups.late.push(m);
        else if (m.ps && !m.re) groups.period.push(m);
        // routine di gruppo di ogni giorno: è la volta del giorno del gruppo, anche se qui la scadenza cade domani
        else if (m.rid && m.gd && !m.re) groups.routine.push(m);
        else if (key === today) (m.rid ? groups.routine : groups.today).push(m);
        else if (key <= soonEnd) groups.soon.push(m);
        else groups.later.push(m);
      });
      return { todo, failed, done, groups };
    }
    // il giorno in cui una missione da fare sta nel Calendario: la scadenza (o l'inizio); una volta di routine ripresa
    // con "Annulla penalità" nel giorno in cui va recuperata (non in quello, passato, in cui scadeva)
    const todoDay = m => (m.rid && m.re ? m.re : m.due || m.from);
    // le missioni di un giorno del calendario (da fare, fallite, completate)
    function dayLists(missions, ds) {
      const byTime = (a, b) => dueKey(a).localeCompare(dueKey(b)) || a.title.localeCompare(b.title);
      // (le routine settimanali e mensili stanno nel giorno della scadenza, l'ultimo del periodo, come le missioni)
      const todo = missions.filter(m => !m.done && !m.failed && todoDay(m) === ds).sort(byTime);
      const failed = missions.filter(m => !m.done && m.failed && m.due === ds).sort(byTime);
      const byDone = (a, b) => b.done.t - a.done.t || a.title.localeCompare(b.title);   // le più recenti in alto
      const done = missions.filter(m => m.done && !m.done.sk && m.done.date === ds).sort(byDone);
      const skipped = missions.filter(m => m.done && m.done.sk && m.done.date === ds).sort(byDone);   // condivise saltate
      return { todo, failed, done, skipped };
    }
    // i pallini del calendario: quante missioni da fare, fallite e completate per ogni giorno.
    // Una routine da più volte conta ogni volta segnata nel suo giorno; settimanali e mensili sono "da fare" (o
    // "fallita") nel giorno della scadenza, l'ultimo del periodo, come una missione con scadenza.
    function calendarMarks(missions) {
      const todo = {}, done = {}, fail = {}, skip = {};
      missions.forEach(m => {
        if (m.p) m.p.forEach(d => { done[d] = (done[d] || 0) + 1; });
        if (m.done && m.done.sk) skip[m.done.date] = (skip[m.done.date] || 0) + 1;   // condivisa saltata
        else if (m.done) { if (!m.p) done[m.done.date] = (done[m.done.date] || 0) + 1; }
        else if (m.due && m.failed) fail[m.due] = (fail[m.due] || 0) + 1;
        else if (todoDay(m)) { const k = todoDay(m); todo[k] = (todo[k] || 0) + 1; }
      });
      return { todo, done, fail, skip };
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
    // Una routine si ripete per PERIODI: ogni giorno (freq 'd', solo nei giorni della settimana scelti), ogni settimana
    // ('w') oppure ogni mese ('m'). Settimane e mesi sono quelli del calendario (cal: la settimana dal giorno wk, il mese
    // dal 1° all'ultimo giorno; si parte dal primo periodo intero). Le routine di prima, senza cal, contano 7 giorni o un
    // mese dal loro primo giorno (o dall'ultimo cambio, "at"), finché calMigrate non le porta al calendario. In ogni
    // periodo c'è una "volta" (una missione), da fare n volte: le ricompense arrivano solo quando le hai fatte tutte, la
    // penalità si paga per ogni volta mancante. La serie conta i periodi completati di fila.
    // Le regole (tutto tranne titolo e descrizione) cambiano solo dal periodo successivo: vedi planChange.
    const WD_ALL = [1, 2, 3, 4, 5, 6, 0];   // giorni nel modulo, lunedì per primo (numeri di Date.getDay)
    const isDaily = r => !r.freq || r.freq === 'd';
    const anchorOf = r => r.at || r.start;   // da qui si contano i periodi
    // quel giorno una routine di ogni giorno c'è (per settimanali e mensili: mai, non hanno giorni precisi)
    // una volta saltata (vedi applySkip): quel periodo non c'è, come un giorno non scelto
    const isSkipped = (r, s) => !!r.skip && r.skip.some(x => x.d === s);
    // quel giorno è tra i giorni scelti, anche se è stato saltato
    const dayPlanned = (r, d) => isDaily(r) && d >= r.start && d >= anchorOf(r) && r.days.includes(parseDate(d).getDay());
    const dayCounts = (r, d) => dayPlanned(r, d) && !isSkipped(r, d);
    // il periodo che contiene il giorno ds: { s: primo giorno, e: ultimo }. null prima dell'inizio e,
    // per le routine di ogni giorno, nei giorni in cui non c'è
    // Periodi del calendario (cal): la settimana (da wk) o il mese che contengono ds, senza guardare l'inizio
    function gridAt(r, ds) {
      if (r.freq === 'w') { const s = weekStart(ds, Number.isInteger(r.wk) ? r.wk : 1); return { s, e: addDaysStr(s, 6) }; }
      const s = ds.slice(0, 8) + '01';
      return { s, e: addDaysStr(addMonthsStr(s, 1), -1) };
    }
    function periodAt(r, ds) {
      const a = anchorOf(r);
      if (ds < a) return null;
      // del calendario: un periodo già cominciato all'inizio (o al cambio) non c'è; si parte dal primo intero
      if (r.cal && !isDaily(r)) { const g = gridAt(r, ds); return g.s >= a ? g : null; }
      if (r.freq === 'w') {
        const s = addDaysStr(a, Math.floor(daysBetween(a, ds) / 7) * 7);
        return { s, e: addDaysStr(s, 6) };
      }
      if (r.freq === 'm') {
        const [ay, am] = a.split('-').map(Number), [y, m] = ds.split('-').map(Number);
        let k = (y - ay) * 12 + (m - am);
        if (addMonthsStr(a, k) > ds) k--;
        return { s: addMonthsStr(a, k), e: addDaysStr(addMonthsStr(a, k + 1), -1) };
      }
      return dayCounts(r, ds) ? { s: ds, e: ds } : null;
    }
    // il primo periodo che inizia da ds in poi (senza andare oltre il giorno "until"); null se non c'è
    function nextPeriod(r, ds, until) {
      if (ds < anchorOf(r)) ds = anchorOf(r);
      if (isDaily(r)) {
        for (let i = 0; i < 800 && ds <= until; i++, ds = addDaysStr(ds, 1)) if (dayCounts(r, ds)) return { s: ds, e: ds };
        return null;
      }
      if (r.cal) {
        let g = gridAt(r, ds);
        if (g.s < ds) g = gridAt(r, addDaysStr(g.e, 1));
        for (let i = 0; i < 400 && g.s <= until && isSkipped(r, g.s); i++) g = gridAt(r, addDaysStr(g.e, 1));
        return g.s <= until ? g : null;
      }
      const p = periodAt(r, ds);
      let q = p.s >= ds ? p : periodAt(r, addDaysStr(p.e, 1));
      for (let i = 0; i < 400 && q.s <= until && isSkipped(r, q.s); i++) q = periodAt(r, addDaysStr(q.e, 1));   // saltati: si passa oltre
      return q.s <= until && !isSkipped(r, q.s) ? q : null;
    }
    // il periodo di una volta: occKey = il suo primo giorno (lo stesso dell'id), occEnd = l'ultimo, entro cui farla.
    // gd = il giorno del gruppo (routine di gruppo, nel fuso di chi l'ha creata): per settimanali e mensili è l'ultimo.
    const occKey = m => m.ps || m.gd || m.due;
    const occEnd = m => m.gd || m.due;
    const occId = (r, d) => r.id + '-' + d.replace(/-/g, '');   // id della "volta" di una routine nel periodo che inizia il giorno d
    const routineOf = (routines, m) => (m && m.rid ? routines.find(r => r.id === m.rid) || null : null);
    // quante volte mancano per completarla (0 = fatta)
    const missingOf = m => (m.done ? 0 : Math.max(1, (m.n || 1) - (m.p ? m.p.length : 0)));
    // il giorno da cui varrebbe un cambio fatto oggi: il giorno dopo la fine del periodo in corso (ogni giorno: domani);
    // per una routine non ancora iniziata, il suo primo giorno (il cambio vale subito)
    function changeAt(r, today) {
      if (r.start > today) return r.start;
      const p = isDaily(r) ? null : periodAt(r, today);   // (del calendario, prima del primo periodo intero: nessuno in corso)
      return addDaysStr(p ? p.e : today, 1);
    }
    // le regole di una routine (o di un cambio in attesa) che non riguardano i giorni: ricompense, penalità, stelle e bonus.
    // Un cambio di prima (senza ricompense) lascia quelle della routine (fb)
    const valsOf = (x, fb) => {
      const v = x && x.rewards ? x : fb;
      return { rewards: v.rewards, penalty: v.penalty, stars: v.stars || null, bonus: v.bonus || null };
    };
    const valKey = v => JSON.stringify([v.rewards, v.penalty, v.stars || null, v.bonus || null]);
    const sameShape = (a, b) => (a.freq || 'd') === (b.freq || 'd') && (a.n || 1) === (b.n || 1) && a.days.join() === b.days.join()
      && (a.time || null) === (b.time || null)
      && (a.cal || 0) === (b.cal || 0) && (Number.isInteger(a.wk) ? a.wk : null) === (Number.isInteger(b.wk) ? b.wk : null);
    // mette le regole (to = la routine o una sua copia): frequenza, volte, giorni, ora, periodi del calendario e, se x le
    // ha, ricompense, penalità, stelle e bonus
    function applyShape(to, x) {
      Object.assign(to, { freq: x.freq, n: x.n, days: x.days, time: x.freq === 'd' && x.n === 1 ? x.time || null : null });
      delete to.cal; delete to.wk;
      Object.assign(to, calOf(x.freq, x));
      if (x.rewards) {
        Object.assign(to, { rewards: { ...x.rewards }, penalty: { ...x.penalty }, stars: x.stars ? { ...x.stars } : null,
          bonus: x.bonus ? { ...x.bonus } : null });
      }
    }
    // Il cambio in attesa di r cosa cambia: shape = frequenza, volte, giorni, ora o periodi; vals = ricompense, penalità,
    // stelle o bonus. (Per le schede: dire che cosa cambierà.)
    const nxParts = r => (r && r.nx ? { shape: !sameShape(r.nx, r), vals: valKey(valsOf(r.nx, r)) !== valKey(valsOf(r, r)) } : null);
    // Cambiare le regole (tutto tranne titolo e descrizione): vale dal giorno dopo la fine del periodo in corso (per una
    // routine di ogni giorno: da domani), così nessuna volta cambia regole a metà: né i giorni, né l'ora, né quanto vale o
    // quanto costa mancarla. La serie resta. Una routine non ancora iniziata (o now = true) cambia subito.
    // c = { freq, n, days, time, cal, wk, rewards, penalty, stars, bonus }: ricompense, penalità, stelle e bonus che
    // mancano restano quelli di adesso. today = il giorno di oggi della routine (routineToday). L'ora vale solo per una
    // volta al giorno. Se le regole restano le stesse non c'è nessun cambio in attesa (uno di prima si toglie). Anche le
    // stelle sono regole: cambiano dal periodo successivo con tutto il resto, anche da sole.
    // Cambia la routine; restituisce il giorno da cui vale il cambio.
    function planChange(r, c, today, now = false) {
      const next = { freq: FREQS.includes(c.freq) ? c.freq : 'd', n: normTimes(c.n) };
      next.days = next.freq === 'd' ? normDays(c.days) : [];
      next.time = next.freq === 'd' && next.n === 1 && validTime(c.time) ? c.time : null;
      Object.assign(next, calOf(next.freq, c));
      const rewards = c.rewards !== undefined ? normalizeRewards(c.rewards) : { ...r.rewards };
      next.rewards = Object.values(rewards).some(v => v > 0) ? rewards : { ...r.rewards };
      next.penalty = c.penalty !== undefined ? normalizeRewards(c.penalty) : { ...r.penalty };
      next.stars = normalizeStars(next.rewards, c.stars !== undefined ? c.stars : r.stars);
      next.bonus = normBonus(c.bonus !== undefined ? c.bonus : r.bonus);
      delete r.nx;
      if (now || r.start > today) {
        applyShape(r, next);
        return now && r.start <= today ? today : r.start;
      }
      if (sameShape(next, r) && valKey(next) === valKey(valsOf(r, r))) return today;
      r.nx = { at: changeAt(r, today), ...next };
      // l'ultimo periodo con le regole di adesso (per la serie di gruppo: il periodo nuovo viene subito dopo di lui)
      const pc = isDaily(r) ? null : periodAt(r, today);
      const pk = isDaily(r) ? (dayCounts(r, today) ? today : prevDay(r, today)) : pc ? pc.s : prevDay(r, today);
      if (pk) r.nx.pk = pk;
      return r.nx.at;
    }
    // oggi è un giorno della routine e, con l'ora "time", la sua volta sarebbe già scaduta (routine di gruppo: nel suo fuso)
    function timePassedToday(r, time, today, now = Date.now()) {
      if (!isDaily(r) || !dayCounts(r, today)) return false;
      return (r.tz ? groupDueMs({ ...r, time }, today) : dueEndMs({ due: today, dueTime: time })) <= now;
    }
    // la routine come sarà dopo il cambio in attesa (una copia; la routine non cambia)
    function foldedCopy(r) {
      const { at, pk } = r.nx;
      const c = { ...r, at };
      applyShape(c, r.nx);
      delete c.nx; delete c.pk;
      if (pk) c.pk = pk;
      return c;
    }
    // Le regole di una routine in quel giorno, per confrontare due copie (la tua e quella del gruppo): frequenza, volte,
    // giorni, ora, da dove si contano i periodi, ricompense, penalità, stelle, bonus e il cambio in attesa. Un cambio già
    // arrivato conta come fatto, così una copia che l'ha già applicato e una che non ancora risultano uguali.
    function shapeOf(r, day) {
      const y = r.nx && r.nx.at <= day ? foldedCopy(r) : r;
      const cw = z => ({ c: z.cal || 0, w: Number.isInteger(z.wk) ? z.wk : null });
      const x = y.nx ? { at: y.nx.at, f: y.nx.freq, n: y.nx.n, d: y.nx.days.join(), t: y.nx.time || null, ...cw(y.nx), v: valKey(valsOf(y.nx, y)) } : null;
      return JSON.stringify({ f: y.freq || 'd', n: y.n || 1, d: y.days.join(), t: y.time || null, a: anchorOf(y), ...cw(y), v: valKey(valsOf(y, y)), x });
    }
    // il cambio arriva al suo primo giorno: da lì si contano i periodi nuovi, con le regole nuove (le volte già create
    // restano con quelle di prima)
    function foldChange(r) {
      const { at, pk } = r.nx;
      r.at = at;
      applyShape(r, r.nx);
      if (pk) r.pk = pk; else delete r.pk;
      delete r.nx;
    }
    // completando una volta di una routine: la serie cresce solo se la completi entro la fine del suo periodo;
    // ogni "every" periodi di fila arriva il bonus. Non cambia niente: restituisce la serie nuova (rs) e il bonus.
    // Volta recuperata con la serie ridata (rj): la serie si allunga di 1 dove si trovava quel periodo (join = true).
    function streakStep(rt, m, today) {
      let rs = null;
      const bonus = {};
      const day = occKey(m), end = occEnd(m);
      if (rt && day && m.re && m.rj !== undefined) {
        const cur = !(rt.brks || []).some(b => b.d > day);   // nessun altro periodo mancato dopo: si allunga la serie di adesso
        const n = cur ? (rt.streak || 0) + 1 : 0;
        if (cur && rt.bonus && !rt.sr && n % rt.bonus.every === 0) STATS.forEach(s => { if (m.rewards[s.key] > 0) bonus[s.key] = rt.bonus.xp; });
        return { rs, bonus, join: true, n };
      }
      if (rt && day && today <= (m.re && m.re > end ? m.re : end) && day > (rt.streakDate || '')) {
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
    // La serie è fatta di pezzi separati dai periodi mancati (rt.brks, con il primo giorno del periodo). Aggiunge delta al
    // pezzo che viene dopo "day": il prossimo periodo mancato (la sua n) oppure, se non ce ne sono, la serie di adesso.
    // Cambia la routine; restituisce true se è cambiata la serie di adesso.
    // Il record (best) sale solo con upBest: cioè completando, non recuperando (la serie ridata non è ancora "guadagnata").
    function streakShift(rt, day, delta, upBest) {
      if (!rt || !delta) return false;
      const next = (rt.brks || []).find(b => b.d > day);
      if (next) { next.n = Math.max(0, next.n + delta); return false; }
      rt.streak = Math.max(0, (rt.streak || 0) + delta);
      if (upBest) rt.best = Math.max(rt.best || 0, rt.streak);
      return true;
    }
    // la volta recuperata è fallita di nuovo: la serie ridata si toglie e il periodo torna tra quelli mancati (cambia la routine)
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

    // Volte fatte di una routine da più volte (m.n): si scrive il numero (k), da 0 a m.n; ogni volta ha il suo giorno
    // in m.p (quelle nuove: oggi; togliendone si tolgono le ultime). Niente XP: arrivano con "Completa". Restituisce il numero.
    function applySetCount(m, k, now = Date.now()) {
      if (!m.n || m.done || m.failed) return m.p ? m.p.length : 0;
      if (!m.p) m.p = [];
      const want = Math.max(0, Math.min(m.n, Math.floor(Number(k) || 0)));
      while (m.p.length < want) m.p.push(isoDate(new Date(now)));
      m.p.length = want;
      return want;
    }
    const fullCount = m => !m.n || (m.p ? m.p.length : 0) >= m.n;
    // Completare: XP (con l'eventuale bonus della serie), serie e record. t = l'istante da salvare (ordina le completate).
    // Una routine da più volte si completa solo con tutte le volte fatte (applySetCount): prima non cambia niente
    // (partial = true). Restituisce { applied, bonus, n, routineChanged, count, need }; n = la serie da mostrare.
    function applyComplete(xp, m, rt, t = Date.now(), now = Date.now()) {
      const need = m.n || 1;
      if (!fullCount(m)) return { applied: normalizeRewards(null), bonus: {}, n: 0, routineChanged: false, count: m.p ? m.p.length : 0, need, partial: true };
      const { rs, bonus, join, n } = streakStep(rt, m, routineToday(rt, now));
      const applied = gainXp(xp, m.rewards, bonus);
      m.done = { date: isoDate(new Date(now)), t, applied };
      delete m.nx;   // completata con le regole di adesso: le modifiche in attesa non servono più
      let routineChanged = false;
      if (join) {
        // volta recuperata: la serie ridata si allunga di 1, come se l'avessi completata in tempo
        m.done.rj = 1;
        const pb = rt.best || 0;
        if (streakShift(rt, occKey(m), 1, true)) m.done.pb = pb;   // il record di prima, per annullare
        routineChanged = true;
      } else if (rs) {
        m.done.rs = rs;
        rt.streak = rs.n; rt.streakDate = occKey(m); rt.best = Math.max(rt.best || 0, rs.n);
        routineChanged = true;
      }
      return { applied, bonus, n: rs ? rs.n : join ? n : 0, routineChanged, count: need, need };
    }
    // Annullare un completamento: gli XP tornano indietro, la serie e il record tornano com'erano. Le volte fatte restano
    // (si può completare di nuovo, o cambiare il numero). Restituisce { removed, routineChanged }.
    function applyUndo(xp, m, rt) {
      const removed = undoXp(xp, m.done.applied);
      const { rs, rj, pb } = m.done;
      m.done = null;
      let routineChanged = false;
      if (rj && rt) {   // volta recuperata: toglie il +1 (e il record torna com'era, se l'aveva alzato lei)
        const was = rt.streak || 0;
        if (streakShift(rt, occKey(m), -1) && Number.isInteger(pb) && rt.best === was) rt.best = pb;
        routineChanged = true;
      } else routineChanged = streakUndo(rt, rs, occKey(m));
      return { removed, routineChanged };
    }
    // Fallire: si perdono gli XP della penalità, una volta per ogni volta mancante (pay = false: nessuna perdita, per
    // esempio se ha abbandonato un amico). Una volta di routine recuperata che fallisce di nuovo perde la serie ridata.
    // Restituisce { removed, routineChanged, missing }.
    function applyFail(xp, m, rt, date, t, pay = true) {
      const missing = missingOf(m);
      const pen = {};
      STATS.forEach(s => { pen[s.key] = (m.penalty[s.key] || 0) * missing; });
      const removed = pay ? penaltyXp(xp, pen) : normalizeRewards(null);
      m.failed = { date, t, applied: removed };
      delete m.nx;   // fallita con le regole di adesso (le modifiche in attesa arrivavano troppo tardi)
      let routineChanged = false;
      if (m.re) {
        if (m.rj !== undefined && rt) { streakLose(rt, occKey(m), m.rj); routineChanged = true; }
        delete m.re; delete m.rj;
      }
      return { removed, routineChanged, missing };
    }
    // (Le versioni di prima avevano "Annulla penalità" e "Riprogramma", che riprendevano una volta fallita: non ci sono
    // più. Le volte già riprese allora, con re e rj, si leggono ancora: valgono fino alla fine del loro giorno, e
    // completarle riattacca la serie come allora; vedi streakStep e applyFail.)

    // la volta di una routine nel periodo p ({ s, e }), con le regole della routine r; here = il fuso di questo dispositivo
    function makeOcc(r, p, here = hereTz()) {
      const occ = { id: occId(r, p.s), title: r.title, desc: r.desc, rewards: { ...r.rewards }, penalty: { ...r.penalty },
        due: p.e, dueTime: r.time, created: p.s, done: null, failed: null, rid: r.id, stars: r.stars };
      if (r.n > 1) { occ.n = r.n; occ.p = []; }
      if (!isDaily(r)) occ.ps = p.s;
      if (r.sr && r.tz) {
        occ.gd = p.e;
        if (r.tz !== here) Object.assign(occ, localDue(groupDueMs(r, p.e)));   // la scadenza del gruppo, nella tua ora
      }
      return occ;
    }
    /* ---------- saltare una volta ---------- */
    // Saltare una volta di una routine (la lezione non c'è, sei in trasferta…), dal Calendario: quel periodo non conta,
    // come un giorno non scelto. Niente XP, niente penalità, la serie resta com'è (non cresce e non si interrompe).
    // Si salta la volta in corso (finché non è scaduta) o una futura. Anche nelle routine di gruppo: lì il salto va anche
    // nel documento del gruppo (lo scrive shared-routines.js) e per quel periodo non conti per la serie di gruppo.
    // Ogni volta si indica con il primo giorno del suo periodo (s): per le routine di ogni giorno è il giorno stesso.
    // La routine si ricorda i salti in r.skip; dayCounts e nextPeriod li trattano come periodi che non ci sono.

    // la routine con le regole che valgono nel giorno ds (con il cambio in attesa, se in quel giorno è già arrivato)
    const rulesOn = (r, ds) => (r.nx && r.nx.at <= ds ? foldedCopy(r) : r);
    // il periodo che inizia il giorno s, anche se saltato; null se non c'è
    function periodStarting(r, s) {
      const y = rulesOn(r, s);
      if (isDaily(y)) return dayPlanned(y, s) ? { s, e: s } : null;
      if (s < anchorOf(y) || s < y.start) return null;
      const p = periodAt(y, s);
      return p && p.s === s ? p : null;
    }
    // il periodo (non saltato) che nel Calendario sta nel giorno ds: ogni giorno, quel giorno; settimanali e mensili,
    // l'ultimo giorno del periodo (il giorno della scadenza, come le volte già create). null se non c'è
    function plannedPeriod(r, ds) {
      if (r.del && ds >= r.del) return null;   // eliminata: da quel giorno niente più volte (il giorno è dopo un periodo intero)
      const y = rulesOn(r, ds);
      if (isDaily(y)) return dayCounts(y, ds) ? { s: ds, e: ds } : null;
      if (ds < anchorOf(y)) return null;
      const p = periodAt(y, ds);
      return p && p.e === ds && p.s >= y.start && !isSkipped(y, p.s) ? p : null;
    }
    // (routine di gruppo: in più serve il documento del gruppo, con la connessione: lo controlla shared-routines.js)
    const canSkipRoutine = r => !!r;
    // la volta già creata si può saltare: da fare, non recuperata (dopo una penalità annullata) e non ancora scaduta
    const canSkipOcc = (r, m) => canSkipRoutine(r) && !!m && m.rid === r.id && !m.done && !m.failed && !m.re && !isLate(m);
    // Salta la volta del periodo che inizia il giorno s (m = la sua volta, se esiste già: chi chiama la toglie
    // dall'elenco). Le volte già segnate si ricordano, per ridartele se annulli. Cambia la routine; true se è cambiata.
    function applySkip(r, s, m) {
      if (!canSkipRoutine(r) || !validDate(s) || isSkipped(r, s)) return false;   // (di gruppo: chi chiama lo scrive anche nel documento)
      const x = { d: s };
      if (m && m.p && m.p.length) x.p = m.p.slice();
      r.skip = (r.skip || []).concat(x).sort((a, b) => a.d.localeCompare(b.d)).slice(-MAX_SKIPS);
      return true;
    }
    // Annullare un salto: si può finché la volta non sarebbe già scaduta. Restituisce null se non si può; altrimenti
    // { occ }: la volta da rimettere nell'elenco (con le volte già segnate), oppure null se il periodo non è ancora iniziato
    // (arriverà da sola il suo giorno). Non cambia niente: per annullare davvero, applyUnskip.
    function unskipPlan(r, s, today = routineToday(r), here = hereTz()) {
      const x = r && r.skip ? r.skip.find(y => y.d === s) : null;
      const p = x && periodStarting(r, s);
      if (!p) return null;
      if (s > today) return { occ: null };
      const occ = makeOcc(rulesOn(r, s), p, here);
      if (occ.n && x.p) occ.p = x.p.slice(0, occ.n);
      return isLate(occ) ? null : { occ };
    }
    function applyUnskip(r, s) {
      if (!r || !r.skip) return false;
      const before = r.skip.length;
      r.skip = r.skip.filter(x => x.d !== s);
      const changed = r.skip.length !== before;
      if (!r.skip.length) delete r.skip;
      return changed;
    }
    // le volte saltate che nel Calendario stanno nel giorno ds: [{ r, p, x }] (p = il periodo, x = il salto)
    function skippedOn(routines, ds) {
      const out = [];
      routines.forEach(r => (r.skip || []).forEach(x => { const p = periodStarting(r, x.d); if (p && p.e === ds) out.push({ r, p, x }); }));
      return out;
    }
    // i pallini delle volte saltate: quante per giorno (nel giorno della scadenza, come le altre)
    function skipMarks(routines) {
      const out = {};
      routines.forEach(r => (r.skip || []).forEach(x => { const p = periodStarting(r, x.d); if (p) out[p.e] = (out[p.e] || 0) + 1; }));
      return out;
    }
    // Il "giro di oggi" delle routine: crea le volte dei periodi iniziati (anche quelli saltati dall'ultima apertura),
    // interrompe le serie non rispettate, applica i cambi arrivati al loro primo giorno e pulisce le volte che non servono più.
    // Cambia le routine ricevute e aggiunge le volte nuove all'elenco delle missioni; restituisce:
    //   missions (l'elenco dopo la pulizia), changed (missioni cambiate), routinesChanged, months (mesi da salvare).
    // gone = gli id delle missioni eliminate (le lapidi): una volta eliminata non si ricrea mai, anche se "made" è tornato
    // indietro (per esempio entrando di nuovo in un gruppo). Così una volta completata, eliminata e ricreata non dà gli XP
    // due volte.
    function routineDay(routines, missions, today0, nowMs = Date.now(), gone = null) {
      const months = new Set();
      if (!routines.length && !missions.some(m => m.rid)) return { missions, changed: false, routinesChanged: false, months };
      let changed = false, routinesChanged = false;
      const here = hereTz();
      routines.forEach(r => {
        // routine di gruppo: i giorni sono quelli del fuso del gruppo
        const zoned = !!(r.sr && r.tz);
        const today = zoned ? zoneDay(nowMs, r.tz) : today0;
        const keep = addDaysStr(today, -KEEP_DAYS);
        const oldest = addDaysStr(today, -(KEEP_DAYS - 1));   // un giorno dentro il confine della pulizia, per sicurezza
        const existing = new Set(missions.filter(mm => mm.rid === r.id).map(mm => mm.id));
        // un passo del giro: chiude i periodi finiti entro closeThrough e crea quelli iniziati entro createUntil
        const run = (createUntil, closeThrough) => {
          // la serie si interrompe se un periodo già finito non è stato completato in tempo.
          // streakDate: fin qui i periodi sono già stati contati. Ogni giorno: ieri. Settimanali e mensili: il primo
          // giorno dell'ultimo periodo finito (lo stesso che scrive completandolo: così annullare quel completamento
          // riporta indietro la serie anche dopo la fine del periodo, come per le routine di ogni giorno)
          let mark = closeThrough;
          if (!isDaily(r)) {
            mark = '';
            if (closeThrough >= anchorOf(r)) {
              let lc = periodAt(r, closeThrough);
              if (lc && lc.e > closeThrough) lc = lc.s > anchorOf(r) ? periodAt(r, addDaysStr(lc.s, -1)) : null;
              if (lc) mark = lc.s;
            }
          }
          if (mark && (r.streakDate || '') < mark) {
            if (!r.brks) r.brks = [];
            let p = nextPeriod(r, r.streakDate ? addDaysStr(r.streakDate, 1) : r.start, closeThrough);
            for (let guard = 0; p && p.e <= closeThrough && guard < 800; guard++, p = nextPeriod(r, addDaysStr(p.e, 1), closeThrough)) {
              // ogni periodo mancato si ricorda con la serie che c'era prima: se lo recuperi, la serie torna
              if (p.s >= keep && !r.brks.some(b => b.d === p.s)) r.brks.push({ d: p.s, n: r.streak || 0 });
              r.streak = 0;
            }
            r.brks = r.brks.filter(b => b.d >= keep).sort((x, y) => x.d.localeCompare(y.d)).slice(-MAX_BRKS);
            r.streakDate = mark;
            routinesChanged = true;
          }
          // le volte dei periodi iniziati dall'ultima apertura: ogni periodo conta, con o senza penalità (chi non ha
          // messo una penalità perde comunque la serie, ma non XP). Si parte dal giorno dopo "made": un periodo già
          // fatto non si ricrea mai, anche se la sua missione è stata tolta (dalla pulizia dei 60 giorni o eliminata
          // da te). Senza "made" (routine di prima): al massimo gli ultimi 60 giorni, così le volte vecchie già tolte
          // non tornano a fallire.
          const from = r.made ? addDaysStr(r.made, 1) : (r.start > oldest ? r.start : oldest);
          let p = nextPeriod(r, from, createUntil);
          for (let guard = 0; p && guard < 3660; guard++, p = nextPeriod(r, addDaysStr(p.e, 1), createUntil)) {
            const id = occId(r, p.s);
            if (existing.has(id) || (gone && gone.has(id)) || missions.length >= MAX_MISSIONS) continue;
            if (r.del && p.s >= r.del) continue;   // eliminata: dal giorno "del" non arrivano altre volte
            const occ = makeOcc(r, p, here);
            missions.push(occ);
            existing.add(id);
            months.add(p.s.slice(0, 7));
            changed = true;
          }
          if (r.start <= createUntil && (r.made || '') < createUntil) { r.made = createUntil; routinesChanged = true; }
        };
        // un cambio arrivato al suo primo giorno: prima si finiscono i periodi con le regole di prima, poi valgono le nuove
        if (r.nx && r.nx.at <= today) {
          const last = addDaysStr(r.nx.at, -1);
          run(last, last);
          foldChange(r);
          routinesChanged = true;
        }
        run(today, addDaysStr(today, -1));
        // i salti più vecchi della cronologia non servono più
        if (r.skip && r.skip.some(x => x.d < keep)) {
          r.skip = r.skip.filter(x => x.d >= keep);
          if (!r.skip.length) delete r.skip;
          routinesChanged = true;
        }
      });
      // pulizia: volte di prima dell'inizio (ancora da fare), cronologia vecchia
      const keepFrom = addDaysStr(today0, -KEEP_DAYS);
      missions = missions.filter(m => {
        if (!m.rid) return true;
        const r = routineOf(routines, m);
        let drop = false;
        const day = occKey(m);
        if (!m.done && !m.failed) drop = !!r && day < r.start;
        else drop = (m.done || m.failed).date < keepFrom;
        if (drop) { months.add(monthOf(m)); changed = true; }
        return !drop;
      });
      return { missions, changed, routinesChanged, months };
    }
    /* ---------- serie di gruppo ---------- */
    // I periodi "tutti insieme" di fila. Il periodo prima di uno è quello che finisce il giorno prima; subito dopo un
    // cambio di frequenza (at) è l'ultimo con le regole di prima (pk).
    // il periodo previsto più vicino prima di ds (dopo l'inizio); '' se non c'è
    // (i periodi saltati da tutti, gx, non ci sono; i tuoi salti personali sì: per il gruppo il periodo c'era)
    const groupSkipped = (r, s) => !!r.gx && r.gx.includes(s);
    function prevDay(r, ds) {
      if (isDaily(r)) {
        let d = addDaysStr(ds, -1);
        for (let i = 0; i < 400 && d >= r.start && d >= anchorOf(r); i++, d = addDaysStr(d, -1)) if (dayPlanned(r, d) && !groupSkipped(r, d)) return d;
      } else {
        let p = periodAt(r, addDaysStr(ds, -1));
        for (let i = 0; i < 400 && p && p.s >= r.start && groupSkipped(r, p.s); i++) p = periodAt(r, addDaysStr(p.s, -1));
        if (p && p.s >= r.start) return p.s;
      }
      return r.at && r.pk && ds >= r.at && r.pk >= r.start ? r.pk : '';
    }
    // l'ultimo periodo già chiuso (scadenza passata) a quell'istante
    function lastClosedDay(r, now) {
      const today = zoneDay(now, r.tz);
      if (!isDaily(r)) {
        const p = periodAt(r, today);
        if (!p) return prevDay(r, today);   // (del calendario, prima del primo periodo intero)
        return groupDueMs(r, p.e) <= now && !groupSkipped(r, p.s) ? p.s : prevDay(r, p.s);
      }
      let d = today;
      for (let i = 0; i < 400 && d >= r.start && d >= anchorOf(r); i++, d = addDaysStr(d, -1)) if (dayPlanned(r, d) && !groupSkipped(r, d) && groupDueMs(r, d) <= now) return d;
      return r.at && r.pk && today >= r.at && r.pk >= r.start ? r.pk : '';
    }
    // la serie di gruppo che si vede adesso: 0 se dopo l'ultimo periodo "tutti insieme" un periodo previsto è finito senza
    function groupStreakNow(r, now = Date.now()) {
      if (!r.gsd || !r.gs) return 0;
      const last = r.tz ? lastClosedDay(r, now) : '';
      return !last || r.gsd >= last ? r.gs : 0;
    }
    // un periodo "tutti insieme" in più (quello che inizia il giorno ds): serie nuova e bonus (se la serie arriva a un
    // multiplo di bonus.every). Non cambia niente: restituisce { n, bonus }.
    function groupStep(r, ds) {
      const n = r.gsd && r.gsd === prevDay(r, ds) ? (r.gs || 0) + 1 : 1;
      const bonus = {};
      if (r.bonus && n % r.bonus.every === 0) STATS.forEach(s => { if (r.rewards[s.key] > 0) bonus[s.key] = r.bonus.xp; });
      return { n, bonus };
    }
    // i periodi di una routine che iniziano fra from e until (compresi), anche a cavallo di un cambio in attesa:
    // [{ s, e, t }], t = le regole di quel periodo (la routine, oppure la sua copia dopo il cambio)
    function groupPeriods(r, from, until) {
      const out = [];
      const seg = (x, a, b) => {
        for (let p = nextPeriod(x, a, b), g = 0; p && g < 800; g++, p = nextPeriod(x, addDaysStr(p.e, 1), b)) out.push({ s: p.s, e: p.e, t: x });
      };
      if (r.nx && r.nx.at <= until) {
        if (from < r.nx.at) seg(r, from, addDaysStr(r.nx.at, -1));
        const f = foldedCopy(r);
        seg(f, from > f.at ? from : f.at, until);
      } else seg(r, from, until);
      return out;
    }

    // Routine settimanali e mensili di prima (periodi contati dal loro primo giorno): passano ai periodi del calendario
    // (wk = il primo giorno della settimana) alla fine del periodo in corso, come un cambio di frequenza. I giorni fra la
    // fine di quel periodo e il primo periodo intero del calendario non hanno volte (niente da fare, la serie resta).
    // Non le routine di gruppo (le regole le decide chi l'ha creata) e non con un cambio già in attesa.
    // Cambia la routine; true se è cambiata.
    function calMigrate(r, wk, today = routineToday(r)) {
      if (!r || isDaily(r) || r.cal || r.sr || r.nx) return false;
      planChange(r, { freq: r.freq, n: r.n, days: [], time: null, cal: 1, wk }, today);
      return true;
    }
    // il primo periodo di una routine settimanale o mensile del calendario che parte il giorno from (per il modulo)
    function firstCalPeriod(freq, wk, from) {
      const t = { freq, n: 1, days: [], start: from, ...calOf(freq, { cal: 1, wk }) };
      return nextPeriod(t, from, addDaysStr(from, 400));
    }
    // routine previste nei giorni futuri (non sono ancora missioni: compaiono quando inizia il loro periodo).
    // Ogni giorno: nei giorni scelti. Settimanali e mensili: nell'ultimo giorno del periodo, come le volte già create
    // (plannedPeriod). Le volte saltate non ci sono. ids: gli id delle missioni che esistono già
    function plannedRoutines(routines, ds, ids) {
      if (ds <= todayStr()) return [];
      return routines.filter(r => { const p = plannedPeriod(r, ds); return !!p && !ids.has(occId(r, p.s)); });
    }

    /* ---------- impegni: modifiche ed eliminazioni dal giorno dopo ---------- */
    // Una missione con una scadenza (e magari una penalità) è un impegno preso a mente lucida: il gioco non lo lascia
    // sciogliere con un tocco all'ultimo momento. Quindi, come per le routine (dal periodo successivo):
    // - le modifiche a XP, stelle, penalità e date valgono dal giorno dopo; titolo e descrizione subito. Così la
    //   scadenza si può ancora rimandare, ma almeno un giorno prima; il giorno della scadenza resta com'è;
    // - una missione con penalità (o una routine con una volta in corso che ha una penalità) si elimina dal giorno dopo:
    //   fino ad allora si può ancora completare, e se scade la penalità si paga;
    // - nessun impegno ancora da sciogliere: una missione non ancora disponibile, o creata da meno di 15 minuti (per
    //   correggere un errore), cambia e si elimina subito. Anche una senza penalità si elimina subito.
    // Le missioni condivise hanno le loro regole (shared.js): le modifiche le accettano gli amici, e c'è "Salta".
    const inGrace = (x, now = Date.now()) => !!x && Number.isFinite(x.ct) && now - x.ct >= 0 && now - x.ct < GRACE_MS;
    const hasPenalty = x => !!x && !!x.penalty && Object.values(x.penalty).some(v => v > 0);
    // le modifiche a questa missione aspettano il giorno dopo?
    const missionLocked = (m, now = Date.now()) => !!m && !m.rid && !m.sid && !m.done && !m.failed && !notYet(m) && !inGrace(m, now);
    // le regole di una missione che cambiano solo dal giorno dopo, per confrontarle
    const MISSION_RULES = ['rewards', 'penalty', 'stars', 'due', 'dueTime', 'from', 'fromTime'];
    const missionRulesKey = x => JSON.stringify(MISSION_RULES.map(k => x[k] === undefined ? null : x[k]));
    // Modificare XP, stelle, penalità o date (c = { rewards, penalty, stars, due, dueTime, from, fromTime }): subito
    // se la missione non è bloccata (missionLocked), altrimenti dal giorno dopo (nx). Tornare alle regole di adesso
    // toglie la modifica in attesa. Cambia la missione; restituisce il giorno da cui vale.
    function missionNext(c) {
      const rewards = normalizeRewards(c.rewards);
      return { rewards, penalty: normalizeRewards(c.penalty), stars: normalizeStars(rewards, c.stars),
        due: c.due || null, dueTime: c.due ? c.dueTime || null : null, from: c.from || null, fromTime: c.from ? c.fromTime || null : null };
    }
    // c cambia XP, stelle, penalità o date rispetto a come la missione è adesso?
    const missionSameRules = (m, c) => missionRulesKey(missionNext(c)) === missionRulesKey(m);
    function planMissionChange(m, c, today = todayStr(), now = Date.now()) {
      const next = missionNext(c);
      delete m.nx;
      if (!missionLocked(m, now)) { Object.assign(m, next); return today; }
      if (missionRulesKey(next) === missionRulesKey(m)) return today;
      m.nx = { at: addDaysStr(today, 1), ...next };
      return m.nx.at;
    }
    // le missioni con una modifica arrivata al suo giorno la prendono (se non sono già scadute: una missione scaduta
    // fallisce con le regole di prima). Una finita la perde. Cambia le missioni; restituisce le missioni cambiate.
    function applyMissionChanges(missions, today = todayStr()) {
      const changed = [];
      missions.forEach(m => {
        if (!m.nx) return;
        if (m.done || m.failed) { delete m.nx; changed.push(m); return; }
        if (m.nx.at > today || isLate(m)) return;
        const { at, ...next } = m.nx;
        Object.assign(m, next);
        delete m.nx;
        changed.push(m);
      });
      return changed;
    }
    // eliminarla adesso non scioglie nessun impegno (altrimenti sparisce dal giorno dopo)
    const missionDelNow = (m, now = Date.now()) => !missionLocked(m, now) || !hasPenalty(m);
    // le missioni eliminate il cui giorno è arrivato (se non sono scadute: prima si paga la penalità)
    const deletedDue = (missions, today = todayStr()) => missions.filter(m => m.del && m.del <= today && (m.done || m.failed || !isLate(m)));
    // una routine si elimina subito se non ha una volta in corso con una penalità (o se l'hai appena creata)
    function routineDelNow(r, missions, now = Date.now()) {
      if (!r || !hasPenalty(r) || inGrace(r, now)) return true;
      return !missions.some(m => m.rid === r.id && !m.done && !m.failed && !notYet(m));
    }
    // eliminarla dal giorno dopo la fine del periodo in corso: le volte già create restano, altre non ne arrivano
    function scheduleRoutineDelete(r, today = routineToday(r)) {
      delete r.nx;
      r.del = changeAt(r, today);
      return r.del;
    }
    // le routine eliminate il cui giorno è arrivato, senza più volte da fare (quelle rimaste finiscono prima)
    const routinesGone = (routines, missions, today = todayStr()) => routines.filter(r => r.del && r.del <= today
      && !missions.some(m => m.rid === r.id && !m.done && !m.failed));

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
    // per una routine: un evento che si ripete, a partire dal primo giorno previsto
    // Routine di gruppo: giorni e ora sono quelli del fuso del gruppo (r.tz), quindi lo si dice a Google Calendar (ctz),
    // che mette l'evento all'ora giusta nel fuso di chi lo aggiunge (per esempio 18:00 in Italia = 13:00 in Brasile).
    // Settimanali e mensili: null (non stanno in giorni precisi, niente evento nel calendario).
    function gcalRoutineUrl(r) {
      if (!isDaily(r)) return null;
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
      MAX_PER_MONTH, MAX_MISSIONS, MAX_ROUTINES, KEEP_DAYS, MAX_TIMES, MAX_EVERY, FREQS,
      pad2, isoDate, parseDate, todayStr, addDaysStr, daysBetween, addMonthsStr, monthOf, validDate, validTime,
      normalizeRewards, REWARD_WEIGHT, REWARD_BASE, rewardTotal, rewardMatch, normalizeStars,
      normalizeMissions, normalizeRoutines,
      startMs, dueEndMs, isLate, dueKey, notYet, nextChange,
      missionLists, dayLists, calendarMarks, lateMissions,
      gainXp, undoXp, penaltyXp,
      WD_ALL, isDaily, anchorOf, dayCounts, periodAt, nextPeriod, occKey, occEnd, missingOf, changeAt, planChange,
      occId, routineOf, streakStep, streakUndo, streakShift, streakLose, routineDay,
      applySetCount, fullCount, applyComplete, applyUndo, applyFail, plannedRoutines,
      calOf, gridAt, calMigrate, firstCalPeriod,
      timePassedToday, MAX_SKIPS, rulesOn, isSkipped, dayPlanned, makeOcc, periodStarting, plannedPeriod, canSkipRoutine, canSkipOcc, applySkip,
      unskipPlan, applyUnskip, skippedOn, skipMarks,
      hereTz, zoneDay, zoneMs, groupDueMs, localDue, routineToday, prevDay, lastClosedDay, groupStreakNow, groupStep,
      foldedCopy, shapeOf, groupPeriods, nxParts,
      gcalUrl, gcalRoutineUrl,
      regionFirstDay, localeFirstDay, WEEK_PREFS, firstDayOf, weekOrder, weekStart, calOffset,
      GRACE_MS, inGrace, hasPenalty, missionLocked, missionSameRules, planMissionChange, applyMissionChanges, missionDelNow, deletedDue,
      routineDelNow, scheduleRoutineDelete, routinesGone,
    };
  }
  window.LIFE_RPG_MISSIONS = { create };
})();