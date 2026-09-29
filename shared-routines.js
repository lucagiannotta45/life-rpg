/*
 * Life RPG — routine di gruppo con gli amici (fino a 3)
 * ---------------------------------------------------------------
 * "Ognuno la sua, la serie insieme":
 * - ogni volta della routine è tua: gli XP arrivano subito quando la completi, e la penalità la paghi solo tu
 *   se non la fai (esattamente come una routine normale). Un amico che salta non ti toglie niente;
 * - in più c'è la SERIE DI GRUPPO: i periodi di fila (giorni, settimane o mesi) in cui l'avete completata tutti.
 *   Il bonus della routine, in una routine di gruppo, arriva ogni N periodi di fila "tutti insieme" (non con la serie
 *   personale). Con più volte per periodo, la tua parte è fatta quando le hai fatte tutte (come le ricompense);
 * - il giorno è uno solo per tutti: quello di chi l'ha creata (il suo fuso orario), e così i periodi (le settimane e i
 *   mesi del calendario di chi l'ha creata; nelle routine di prima, contati dal primo giorno della routine). Chi è
 *   altrove vede la scadenza nella sua ora. Chi entra a metà di una settimana o di un mese conta dal periodo successivo;
 * - chi l'ha creata decide tutto (titolo, descrizione, frequenza, volte, giorni, ora, XP, penalità, bonus). Titolo e
 *   descrizione cambiano subito; tutto il resto dal periodo successivo, per tutti insieme (il cambio in attesa, nx, è nel
 *   documento). Se cambiano le regole (XP, penalità, bonus, frequenza, volte, giorni, ora), gli amici vanno "in sospeso":
 *   continuano con le regole di prima, non contano per il gruppo finché non scelgono "Accetta" oppure "Esci";
 * - la modifica di chi l'ha creata vale solo se arriva nel documento: finché il server non la conferma la routine lo
 *   ricorda (srd) e riprova; se il server la rifiuta, la routine torna com'è nel documento (vedi afterEdit);
 * - si può uscire quando si vuole, senza penalità: la routine resta tua, come routine normale. Se chi l'ha creata
 *   scioglie il gruppo (o elimina la routine), anche agli amici la routine resta, come routine normale.
 *
 * Come funziona:
 * - su Firebase c'è un documento sroutines/{id}, che leggono e scrivono solo i partecipanti (le regole controllano
 *   chi può cambiare cosa). Gli amici sono in g: { uid: { n: nome, j: ha accettato, a: versione accettata,
 *   since: giorno del gruppo da cui partecipa } }. Le parti fatte sono in k: { AAAAMMGG: { uid: ora del server } },
 *   con il primo giorno del periodo: l'ora la mette il server (serverTimestamp), così ognuno può controllare se è
 *   arrivata entro la scadenza (la fine del periodo);
 * - ognuno ha la routine nel suo elenco, con sr (il documento) e sh (il ruolo: 'o' = l'hai creata, 'g' = invitato).
 *   Per gli invitati l'id della routine è l'id del documento: così due dispositivi dello stesso giocatore creano
 *   la stessa routine (e le stesse volte), non due copie;
 * - "Salta" (dal Calendario, per malattia, lutto, lezione annullata…): i salti sono in x: { AAAAMMGG: { uid: ora del
 *   server } }, come le parti fatte. Chi salta non conta per il gruppo in quel periodo: il periodo è "insieme" se nessuno
 *   l'ha mancato e almeno uno l'ha completato (anche se tutti gli altri hanno saltato). Se saltano tutti, il periodo non
 *   c'è: la serie di gruppo non cresce e non si interrompe (gx, nella tua routine). Chi salta non prende il bonus.
 *   La tua routine tiene una copia dei tuoi salti (skip), presa dal documento;
 * - la serie di gruppo non la scrive nessuno: ogni app la ricava dal documento, un giorno alla volta, e la salva
 *   nella sua routine (gs = serie, gsd = ultimo giorno "tutti insieme", gbest = record), finché il gruppo c'è.
 *
 * Uso (in index.js):  const SR = window.LIFE_RPG_SHARED_ROUTINES.create(D, S);
 */
(() => {
  'use strict';
  const MAX_GUESTS = 3;
  function create(D, S) {
    const { T, MISSIONS, sfx, touchMonth, lsSet, saveRoutinesLocal } = D;   // (e D.tombMissions, per le volte saltate altrove)
    const {
      todayStr, addDaysStr, monthOf, normalizeRoutines, zoneDay, groupDueMs, localDue, hereTz, occId,
      groupStep, MAX_ROUTINES, KEEP_DAYS, nextPeriod, occKey, occEnd, shapeOf, groupPeriods, foldedCopy, anchorOf,
    } = MISSIONS;
    const MUI = () => D.MUI, SH = () => D.SH;

    const LS = 'liferpg:sroutines:v1';
    const me = () => (S.fbUser ? S.fbUser.uid : '');
    const FV = () => window.firebase.firestore.FieldValue;
    const online = () => !!(S.fbUser && S.dbRef && S.fbDb);
    const ref = id => S.fbDb.collection('sroutines').doc(id);
    const errKey = e => (e && e.code === 'permission-denied' ? 'sh.msg.denied' : 'sh.msg.err');
    const noname = n => String(n || '').trim() || T('fr.noname');
    const joinNames = (l, sep) => SH().joinNames(l, sep);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const msg = (key, vars, kind, visible) => MUI().missionMsg(T(key, vars), kind || '', !!visible);
    const fail = key => { msg(key, null, 'bad', true); sfx('err'); };

    /* ---------- documenti: copia in memoria ---------- */
    let docs = {}, uidOf = '', unsub = null, listening = false, serverSeen = false;
    const leaving = new Set();   // documenti che stai togliendo tu (uscendo, sciogliendo), scrittura non ancora confermata
    function loadCache(uid) {
      docs = {};
      try {
        const raw = JSON.parse(localStorage.getItem(LS) || 'null');
        if (raw && raw.uid === uid && raw.docs && typeof raw.docs === 'object') docs = raw.docs;
      } catch (e) { /* copia rovinata: si riparte */ }
      uidOf = uid;
    }
    // le ore del server (Timestamp) non si salvano come tali: nella copia diventano millisecondi
    const plain = v => (v && typeof v.toMillis === 'function' ? v.toMillis()
      : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
    function saveCache() { lsSet(LS, JSON.stringify({ uid: uidOf, docs })); }

    /* ---------- chi c'è nel documento ---------- */
    const isDoc = d => !!d && d.v === 1 && !!d.g && typeof d.g === 'object' && Array.isArray(d.members);
    const roleOf = d => (d.owner === me() ? 'o' : d.g[me()] ? 'g' : '');
    const guests = d => d.members.slice(1).filter(u => d.g[u]).map(u => ({ uid: u, ...d.g[u] }));
    const isActive = (d, x) => !!x && x.j && x.a === d.ver;
    const isPend = (d, x) => !!x && x.j && x.a !== d.ver;
    const joinedOf = d => guests(d).filter(x => x.j);
    const nameOf = (d, uid) => (uid === d.owner ? noname(d.ownerName) : noname(d.g[uid] && d.g[uid].n));
    // chi partecipa al periodo che inizia il giorno "day": chi l'ha creata, e gli amici dentro con le regole attuali,
    // dal loro primo giorno (chi entra a metà periodo conta dal successivo)
    const partsOf = (d, day) => [d.owner].concat(guests(d).filter(x => isActive(d, x) && x.since && x.since <= day).map(x => x.uid));
    // il modello della routine (lo decide chi l'ha creata), controllato come una routine salvata
    // (freq, n, at, pk, nx: frequenza, volte, da dove si contano i periodi e cambio in attesa; senza, come prima:
    // ogni giorno, una volta)
    function tplOf(d) {
      const r = normalizeRoutines([{ id: 'x', title: d.title, desc: d.desc, rewards: d.rewards, penalty: d.penalty, days: d.days,
        time: d.time, start: d.start, bonus: d.bonus, stars: d.stars, freq: d.freq, n: d.n, at: d.at, pk: d.pk, nx: d.nx,
        cal: d.cal, wk: d.wk, pp: d.pp }])[0];   // pp: penalità già "del periodo" (senza: documento di prima)
      if (!r) return null;
      const tz = typeof d.tz === 'string' && d.tz ? d.tz : hereTz();
      const t = { title: r.title, desc: r.desc, rewards: r.rewards, penalty: r.penalty, freq: r.freq, n: r.n, days: r.days, time: r.time,
        start: r.start, bonus: r.bonus, stars: r.stars, tz };
      if (r.at) t.at = r.at;
      if (r.pk) t.pk = r.pk;
      if (r.nx) t.nx = r.nx;
      if (r.cal) t.cal = 1;
      if (Number.isInteger(r.wk)) t.wk = r.wk;
      return t;
    }
    const keyOf = ds => ds.replace(/-/g, '');
    const dayOfKey = k => k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8);
    // quando (ora del server) uid ha fatto la sua parte quel giorno: null se non l'ha fatta o non è ancora confermato
    function partAt(d, day, uid) {
      const row = d.k && d.k[keyOf(day)];
      const v = row ? row[uid] : null;
      return typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : null;
    }
    // c'è una parte, anche non ancora confermata dal server (per le schede)
    const partSeen = (d, day, uid) => { const row = d.k && d.k[keyOf(day)]; return !!row && uid in row; };
    // quando (ora del server) uid ha saltato il periodo: null se non l'ha saltato o non è ancora confermato
    function skipAt(d, day, uid) {
      const row = d.x && d.x[keyOf(day)];
      const v = row ? row[uid] : null;
      return typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : null;
    }
    const skipSeen = (d, day, uid) => { const row = d.x && d.x[keyOf(day)]; return !!row && uid in row; };
    // come è andato il periodo per uid: 'done' (completato in tempo), 'skip' (saltato in tempo) o null (mancato, o non ancora)
    function stateOf(d, day, uid, end) {
      const at = partAt(d, day, uid);
      if (at != null && at <= end) return 'done';
      const sk = skipAt(d, day, uid);
      return sk != null && sk <= end ? 'skip' : null;
    }
    // il periodo che inizia il giorno "day" (e finisce il giorno "last") l'avete fatto "insieme": nessuno l'ha mancato
    // (chi ha saltato non conta) e almeno uno l'ha completato in tempo (servono almeno due partecipanti)
    function together(d, t, day, last = day) {
      const parts = partsOf(d, day);
      if (parts.length < 2) return false;
      const end = groupDueMs(t, last);
      const st = parts.map(u => stateOf(d, day, u, end));
      return st.every(x => x) && st.includes('done');
    }
    // l'hanno saltato tutti (in tempo): per la serie di gruppo quel periodo non c'è
    function allSkipped(d, t, day, last = day) {
      const parts = partsOf(d, day);
      const end = groupDueMs(t, last);
      return parts.length > 0 && parts.every(u => stateOf(d, day, u, end) === 'skip');
    }
    const routineBySr = id => S.routines.find(r => r.sr === id) || null;
    const docOfR = r => (r && r.sr && uidOf === me() ? docs[r.sr] || null : null);
    const myName = () => SH().myName();

    /* ---------- ascolto ---------- */
    function start() {
      if (!online() || listening) return;
      if (uidOf !== me()) loadCache(me());
      listening = true; serverSeen = false;
      unsub = S.fbDb.collection('sroutines').where('members', 'array-contains', me())
        .onSnapshot({ includeMetadataChanges: true }, onSnap, e => { console.warn('sroutines listen', e); listening = false; unsub = null; });
    }
    function reset() {
      if (unsub) { try { unsub(); } catch (e) { /* ignora */ } }
      unsub = null; listening = false; serverSeen = false;
      docs = {}; uidOf = ''; leaving.clear();
      try { localStorage.removeItem(LS); } catch (e) { /* ignora */ }
    }
    function onSnap(qs) {
      const fromServer = !qs.metadata.fromCache;
      const seen = new Set();
      qs.docs.forEach(x => {
        docs[x.id] = { ...plain(x.data()), _pw: x.metadata.hasPendingWrites };
        seen.add(x.id);
      });
      if (fromServer) {
        serverSeen = true;
        Object.keys(docs).forEach(id => { if (!seen.has(id) && !leaving.has(id)) { delete docs[id]; gone(id); } });
        checkOrphans();
      }
      saveCache();
      evaluate();
      paint();
    }
    function paint() {
      MUI().renderMissionViews();
      const rm = MUI().rmodal;
      if (rm && !rm.hidden) MUI().renderRoutines();
    }
    // la routine non è più collegata al gruppo: resta tua, come routine normale
    // il gruppo non c'è più: la routine torna normale, senza serie, record e periodi saltati del gruppo
    // (serie e record personali restano: sono tuoi)
    function unlink(r) {
      delete r.sr; delete r.sh; delete r.shn; delete r.tz;
      delete r.gs; delete r.gsd; delete r.gbest; delete r.gx; delete r.srd;
      saveRoutinesLocal();
    }
    // il documento non c'è più (gruppo sciolto, oppure non ne fai più parte): la routine resta tua
    function gone(id) {
      const r = routineBySr(id);
      if (!r) return;
      const wasGuest = r.sh === 'g';
      unlink(r);
      if (wasGuest) msg('sr.msg.gone', { title: r.title });
    }
    // chi l'ha creata è rimasto solo: il documento si elimina e la routine resta sua, come routine normale
    // (serie personale e serie di gruppo raggiunta restano). Lo fa da sola, quindi senza messaggi di errore
    function alone(r, id) {
      if (leaving.has(id) || !online()) return;
      leaving.add(id);
      ref(id).delete()
        .then(() => {
          delete docs[id]; saveCache();
          if (r.sr === id) { unlink(r); msg('sr.msg.alone', { title: r.title }); }
          paint(); MUI().renderMissionViews();
        })
        .catch(e => console.warn('sroutines alone', e && e.code, e))
        .then(() => leaving.delete(id));
    }
    // una routine collegata a un documento che qui non è mai arrivato: si chiede al server se c'è ancora
    const fetching = {};
    function checkOrphans() {
      if (!serverSeen || !uidOf || uidOf !== me()) return;
      S.routines.forEach(r => { if (r.sr && !docs[r.sr]) verifyMissing(r.sr); });
    }
    function verifyMissing(id) {
      if (!online() || (fetching[id] && Date.now() - fetching[id] < 30000)) return;
      fetching[id] = Date.now();
      ref(id).get({ source: 'server' }).then(x => {
        if (x.exists || docs[id]) return;   // c'è: arriva con l'ascolto
        gone(id); paint();
      }).catch(e => {
        if (e && e.code === 'permission-denied' && !docs[id]) { gone(id); paint(); return; }   // non ne fai più parte
        console.warn('sroutines check', e);
      });
    }

    /* ---------- far combaciare le tue routine con i documenti ---------- */
    // Si chiama a ogni aggiornamento e, con l'app aperta, di continuo (insieme alle penalità).
    function evaluate() {
      if (!uidOf || uidOf !== me()) return;
      checkOrphans();
      let changed = false;
      Object.entries(docs).forEach(([id, d]) => {
        if (!isDoc(d)) return;
        const role = roleOf(d);
        if (!role) return;
        let r = routineBySr(id);
        if (role === 'o') {
          if (!r) return;   // su un altro dispositivo, prima che arrivi la sincronizzazione: si aspetta
          // nel gruppo non è rimasto nessuno (hanno rifiutato o sono usciti tutti, e non ci sono inviti in attesa):
          // il gruppo non serve più e la routine torna normale (come fanno le missioni condivise)
          if (!guests(d).length && !d._pw) { alone(r, id); return; }
          retryPush(r, d);   // una tua modifica non ancora confermata dal server
        } else {
          const mine = d.g[me()];
          if (!mine.j) return;   // invito: lo mostra invites()
          if (!r) { r = addLocal(id, d); if (!r) return; changed = true; }
          if (!isPend(d, mine) && syncTemplate(r, d)) changed = true;
        }
        const names = [d.owner].concat(joinedOf(d).map(x => x.uid)).filter(u => u !== me()).map(u => nameOf(d, u).slice(0, 30)).slice(0, MAX_GUESTS);
        if (!same(r.shn || [], names)) { if (names.length) r.shn = names; else delete r.shn; changed = true; }
        if (mirrorSkips(r, d)) changed = true;
        if (groupEval(r, d)) changed = true;
        if (role === 'o') prune(id, d);
      });
      // (le volte saltate o riprese su un altro dispositivo cambiano l'elenco: si ridisegna comunque)
      if (changed) { saveRoutinesLocal(); MUI().syncRoutines(); MUI().renderMissionViews(); }
    }
    // l'invitato riceve la routine nel suo elenco (id = id del documento)
    function addLocal(id, d) {
      const t = tplOf(d);
      if (!t) return null;
      const start = guestStart(t, d.g[me()].since || zoneDay(Date.now(), t.tz));
      let r = S.routines.find(x => x.id === id);   // una tua copia di prima (eri uscito): si ricollega
      if (!r) {
        if (S.routines.length >= MAX_ROUTINES) return null;
        r = { id, streak: 0, streakDate: addDaysStr(start, -1), best: 0, made: '' };
        S.routines.push(r);
      }
      Object.assign(r, { title: t.title, desc: t.desc, rewards: t.rewards, penalty: t.penalty, bonus: t.bonus, stars: t.stars,
        start, sr: id, sh: 'g', tz: t.tz, pp: 1 });   // (la penalità del modello è già "del periodo")
      takeShape(r, t);
      // se oggi (il giorno del gruppo) è un giorno previsto, compare subito (una volta eliminata non torna: vedi routineDay)
      const today = zoneDay(Date.now(), t.tz);
      if (r.made && r.made >= today) r.made = addDaysStr(today, -1);
      return r;
    }
    // il primo giorno dell'invitato: dal giorno in cui è entrato (o dall'inizio della routine, se è dopo); in una routine
    // settimanale o mensile, dal primo periodo che inizia da quel giorno in poi (a metà periodo si conta dal successivo)
    function guestStart(t, since) {
      let start = t.start > since ? t.start : since;
      const x = t.nx && start >= t.nx.at ? foldedCopy(t) : t;
      if (x.freq && x.freq !== 'd') { const p = nextPeriod(x, start, addDaysStr(start, 400)); if (p) start = p.s; }
      return start;
    }
    // frequenza, volte, giorni e ora del gruppo; i periodi si contano da dove li conta il gruppo (at)
    function takeShape(r, t) {
      Object.assign(r, { freq: t.freq || 'd', n: t.n || 1, days: t.days.slice(), time: t.time || null });
      delete r.cal; delete r.wk;
      Object.assign(r, MISSIONS.calOf(r.freq, t));   // periodi del calendario del gruppo (settimane di chi l'ha creata)
      const anchor = t.at || t.start;
      if (anchor !== r.start) r.at = anchor; else delete r.at;
      if (t.pk) r.pk = t.pk; else delete r.pk;
      if (t.nx) r.nx = { ...t.nx, days: t.nx.days.slice() }; else delete r.nx;
    }
    // l'invitato (con le regole attuali) prende il modello del documento; le volte ancora da fare si aggiornano
    // (frequenza, volte, giorni e ora si confrontano con shapeOf: un cambio già arrivato conta come fatto, così non
    // si riassegna di continuo tra chi l'ha già applicato e un documento che lo ha ancora "in attesa")
    // (ricompense, penalità, stelle e bonus sono regole come i giorni: si confrontano con shapeOf, cambio in attesa
    // compreso; titolo, descrizione e fuso si prendono così come sono)
    const META_KEYS = ['title', 'desc', 'tz'];
    const VAL_KEYS = ['rewards', 'penalty', 'stars', 'bonus'];
    function syncTemplate(r, d) {
      const t = tplOf(d);
      if (!t) return false;
      const start = guestStart(t, d.g[me()].since || r.start);
      const today = zoneDay(Date.now(), t.tz);
      const sameShape = shapeOf({ ...r, start }, today) === shapeOf(t, today);
      if (META_KEYS.every(k => same(r[k] === undefined ? null : r[k], t[k])) && r.start === start && sameShape) return false;
      META_KEYS.forEach(k => { r[k] = t[k]; });
      if (r.start !== start) { r.start = start; r.streak = 0; r.streakDate = addDaysStr(start, -1); r.brks = []; }
      if (!sameShape) {
        VAL_KEYS.forEach(k => { r[k] = t[k]; });
        takeShape(r, t);
        // se oggi (il giorno del gruppo) ora è un giorno previsto, compare subito. Una volta già fatta ed eliminata non
        // torna: routineDay non ricrea le volte eliminate
        if (r.made && r.made >= today) r.made = addDaysStr(today, -1);
      }
      refreshOpen(r);
      return true;
    }
    // le volte ancora da fare prendono i valori nuovi della routine (ora compresa, dal giorno del gruppo di oggi).
    // Ricompense, penalità e stelle solo nelle volte dei periodi con le regole di adesso (da anchorOf): una volta nata prima di
    // un cambio resta con le regole con cui è nata
    function refreshOpen(r) {
      const months = new Set();
      const today = zoneDay(Date.now(), r.tz || hereTz());
      const here = hereTz();
      S.missions.forEach(m => {
        if (m.rid !== r.id || m.done || m.failed) return;
        Object.assign(m, { title: r.title, desc: r.desc });
        if (occKey(m) >= anchorOf(r)) Object.assign(m, { rewards: { ...r.rewards }, penalty: { ...r.penalty }, stars: r.stars });
        const day = m.gd || m.due;   // l'ultimo giorno del periodo, nel fuso del gruppo
        const time = m.n || m.ps ? null : r.time;   // l'ora vale solo per le volte da una volta al giorno
        if (day >= today) Object.assign(m, !r.tz || r.tz === here ? { due: day, dueTime: time } : localDue(groupDueMs({ ...r, time }, day)));
        months.add(monthOf(m));
      });
      months.forEach(touchMonth);
    }
    // serie di gruppo: i periodi "tutti insieme" dopo l'ultimo già contato, uno alla volta; true se è cambiata.
    // (Si parte dal periodo dell'ultimo già contato, gsd, che serve solo da "periodo prima"; anche a cavallo di un cambio
    // di frequenza: groupPeriods usa le regole giuste per ogni periodo.)
    function groupEval(r, d) {
      const t = tplOf(d);
      if (!t) return false;
      const now = Date.now();
      const today = zoneDay(now, t.tz);
      const oldest = addDaysStr(today, -KEEP_DAYS);
      const from = r.gsd && r.gsd >= oldest ? r.gsd : (t.start > oldest ? t.start : oldest);
      let changed = false;
      // i periodi già finiti che avete saltato tutti (negli ultimi giorni che il documento ricorda)
      const gx = groupPeriods(t, t.start > oldest ? t.start : oldest, today)
        .filter(p => groupDueMs(p.t, p.e) <= now && allSkipped(d, p.t, p.s, p.e)).map(p => p.s);
      if (!same(r.gx || [], gx)) { if (gx.length) r.gx = gx; else delete r.gx; changed = true; }
      for (const p of groupPeriods(t, from, today)) {
        if (r.gsd && p.s <= r.gsd) continue;
        if (!partsOf(d, p.s).includes(me()) || !together(d, p.t, p.s, p.e)) continue;
        const { n, bonus } = groupStep({ ...p.t, gs: r.gs, gsd: r.gsd, gx: r.gx }, p.s);
        const m = S.missions.find(x => x.id === occId(r, p.s));
        const hasBonus = Object.keys(bonus).length > 0 && m && m.done && !m.done.gb;
        // il bonus si dà solo quando non c'è una finestra aperta: si riprova più tardi (la serie aspetta con lui)
        if (hasBonus && !MUI().groupBonus(m, bonus, n)) break;
        r.gs = n; r.gsd = p.s; r.gbest = Math.max(r.gbest || 0, n);
        changed = true;
        if (!hasBonus && p.s <= today && today <= p.e) {
          const skips = partsOf(d, p.s).some(u => skipSeen(d, p.s, u));   // qualcuno ha saltato: "fatta da chi c'era"
          msg(skips ? 'sr.msg.together.skip' : 'sr.msg.together', { title: r.title, n }, 'good'); sfx('ok');
        }
      }
      return changed;
    }
    // i giorni vecchi si tolgono dal documento, uno per volta (lo fa solo chi l'ha creata)
    const pruning = new Set();
    function prune(id, d) {
      if (!online() || pruning.has(id) || (!d.k && !d.x)) return;
      const limit = keyOf(addDaysStr(todayStr(), -(KEEP_DAYS + 2)));
      const oldOf = m => Object.keys(m || {}).filter(k => /^\d{8}$/.test(k) && k < limit).sort()[0];
      // prima le parti fatte (k), poi i salti (x)
      const f = oldOf(d.k) ? 'k' : oldOf(d.x) ? 'x' : '';
      if (!f) return;
      const old = oldOf(d[f]);
      pruning.add(id);
      ref(id).update({ [f + '.' + old]: FV().delete(), lk: old, updated: Date.now() })
        .catch(e => console.warn('sroutines prune', e && e.code, e))
        .then(() => pruning.delete(id));
    }

    /* ---------- quello che serve alle schede ---------- */
    // una routine (nell'elenco delle routine)
    function info(r) {
      const d = docOfR(r);
      if (!d || !isDoc(d)) return null;
      const role = roleOf(d);
      if (!role) return null;
      const mine = role === 'g' ? d.g[me()] : null;
      const joined = joinedOf(d);
      const others = [{ uid: d.owner, name: noname(d.ownerName), pend: false }]
        .concat(joined.map(x => ({ uid: x.uid, name: noname(x.n), pend: isPend(d, x) }))).filter(p => p.uid !== me());
      const invited = guests(d).filter(x => !x.j).map(x => noname(x.n));
      return {
        role,
        joined: role === 'o' ? joined.length > 0 : !!(mine && mine.j),
        invited: role === 'o' && !joined.length && invited.length > 0,
        pending: isPend(d, mine),
        name: joinNames(others.map(p => p.name)),
        invitedNames: joinNames(invited), invitedCount: invited.length,
        pendNames: joinNames(others.filter(p => p.pend).map(p => p.name)),
        removable: role === 'o' ? guests(d).filter(x => !isActive(d, x)).length : 0,
        ownerName: noname(d.ownerName),
      };
    }
    // una volta della routine (scheda nella lista delle missioni): chi l'ha già fatta oggi
    function occInfo(m) {
      const r = m && m.rid ? S.routines.find(x => x.id === m.rid) : null;
      const d = docOfR(r);
      if (!d || !isDoc(d) || !roleOf(d)) return null;
      const t = tplOf(d);
      if (!t) return null;
      const day = occKey(m);   // il primo giorno del periodo (per le routine di ogni giorno: il giorno)
      const parts = partsOf(d, day);
      const mine = roleOf(d) === 'g' ? d.g[me()] : null;
      const others = parts.filter(u => u !== me());
      const skipped = others.filter(u => skipSeen(d, day, u) && !partSeen(d, day, u));
      return {
        pending: isPend(d, mine),
        inGroup: parts.includes(me()) && parts.length > 1,
        together: together(d, t.nx && day >= t.nx.at ? foldedCopy(t) : t, day, occEnd(m)),
        doneNames: joinNames(others.filter(u => partSeen(d, day, u)).map(u => nameOf(d, u))),
        doneCount: others.filter(u => partSeen(d, day, u)).length,
        missingNames: joinNames(others.filter(u => !partSeen(d, day, u) && !skipped.includes(u)).map(u => nameOf(d, u))),
        // chi ha saltato quel periodo (non conta per il gruppo)
        skipNames: joinNames(skipped.map(u => nameOf(d, u))),
        skipCount: skipped.length,
      };
    }
    // la serie di gruppo di adesso (0 se un giorno previsto è passato senza "tutti insieme")
    const streakNow = r => (r && (r.sr || r.gs) ? MISSIONS.groupStreakNow(r) : 0);
    // "Invita" su una routine: la tua (o creata da te), con meno di 3 amici
    function canInvite(r) {
      if (!S.fbUser || !r || r.sh === 'g') return false;
      if (!r.sr) return true;
      const d = docOfR(r);
      return !!(d && isDoc(d) && roleOf(d) === 'o' && guests(d).length < MAX_GUESTS);
    }
    // chi può modificare la routine: solo chi l'ha creata, con il documento arrivato e la connessione
    function editBlock(r) {
      if (!r || !r.sr) return '';
      if (r.sh === 'g') return T('sr.err.guest');
      const d = docOfR(r);
      if (!d || !isDoc(d) || !online()) return T('sh.err.offline');
      return '';
    }
    // annullare una volta completata: non se quel giorno l'avete già fatta tutti (la serie di gruppo l'ha contata)
    function canUndo(m) {
      const x = occInfo(m);
      return !(x && x.together);
    }

    /* ---------- scritture ---------- */
    const update = (id, data) => ref(id).update({ ...data, updated: Date.now() });
    const gPath = (...k) => ['g', me()].concat(k).join('.');
    async function write(job) {
      try { await job(); return true; }
      catch (e) { console.warn('sroutines', e && e.code, e); fail(errKey(e)); return false; }
    }
    // i campi del modello che finiscono nel documento (li scrive solo chi l'ha creata)
    function fieldsOf(r) {
      const nx = r.nx ? { at: r.nx.at, freq: r.nx.freq, n: r.nx.n, days: r.nx.days.slice(), time: r.nx.time || null } : null;
      if (nx && r.nx.pk) nx.pk = r.nx.pk;
      if (nx && r.nx.cal) { nx.cal = 1; if (Number.isInteger(r.nx.wk)) nx.wk = r.nx.wk; }
      // ricompense, penalità, stelle e bonus nuovi (anche loro dal primo giorno del cambio)
      if (nx && r.nx.rewards) {
        Object.assign(nx, { rewards: { ...r.nx.rewards }, penalty: { ...r.nx.penalty }, stars: r.nx.stars ? { d: r.nx.stars.d, f: r.nx.stars.f } : null,
          bonus: r.nx.bonus ? { every: r.nx.bonus.every, xp: { ...r.nx.bonus.xp } } : null });
      }
      return {
        title: r.title, desc: r.desc || '', rewards: { ...r.rewards }, penalty: { ...r.penalty },
        stars: r.stars ? { d: r.stars.d, f: r.stars.f } : null, days: r.days.slice(), time: r.time || null,
        start: r.start,
        bonus: r.bonus ? { every: r.bonus.every, xp: { ...r.bonus.xp } } : null, tz: r.tz || hereTz(),
        pp: 1,   // la penalità è quella del periodo intero (vedi missions.js, periodPenalty): si scrive sempre con lei
        freq: r.freq || 'd', n: r.n || 1, at: r.at || null, pk: r.pk || null, nx,
        // periodi del calendario (settimane da wk, il primo giorno della settimana di chi l'ha creata)
        cal: r.cal ? 1 : null, wk: r.cal && Number.isInteger(r.wk) ? r.wk : null,
      };
    }
    // le regole della routine: cambiandole, gli amici devono accettare di nuovo (le regole di Firebase lo controllano).
    // SHAPE_KEYS: quelle che shapeOf confronta (con ricompense, penalità, stelle e bonus). Stelle e bonus cambiano
    // insieme al cambio in attesa (nx), quindi fanno riaccettare anche loro
    // (pp va insieme alla penalità: un documento di prima resta tutto "per volta" finché le regole non si riscrivono)
    const SHAPE_KEYS = ['days', 'time', 'freq', 'n', 'at', 'pk', 'nx', 'cal', 'wk', 'rewards', 'penalty', 'stars', 'bonus', 'pp'];
    const RULE_KEYS = ['rewards', 'penalty'].concat(SHAPE_KEYS);
    const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
    const sameK = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

    /* ---------- saltare una volta ---------- */
    // I tuoi salti di una routine di gruppo stanno nel documento (x): la routine ne tiene una copia (skip), che serve
    // a non creare le volte saltate e a tenere ferma la tua serie. Le volte già segnate (p) restano quelle della copia.
    const skipSyncing = new Set();   // routine che stanno ancora mandando i loro salti al documento (appena diventate di gruppo)
    function mirrorSkips(r, d) {
      if (skipSyncing.has(r.id)) return false;
      const days = Object.keys(d.x || {}).filter(k => /^\d{8}$/.test(k) && d.x[k] && me() in d.x[k]).map(dayOfKey).sort();
      const old = r.skip || [];
      const next = days.map(ds => { const o = old.find(x => x.d === ds); return o ? { ...o } : { d: ds }; });
      if (same(old, next)) return false;
      // saltata da un altro tuo dispositivo: anche qui la volta ancora da fare diventa "saltata" (se no fallirebbe qui)
      next.filter(x => !old.some(o => o.d === x.d)).forEach(x => {
        const m = S.missions.find(y => y.id === occId(r, x.d));
        if (!m || m.done || m.failed) return;
        if (m.p && m.p.length) x.p = m.p.slice();
        const when = d.x[keyOf(x.d)] && d.x[keyOf(x.d)][me()];
        MISSIONS.markSkipped(m, typeof when === 'number' ? when : Date.now());
        touchMonth(monthOf(m));
      });
      const gone = old.filter(o => !next.some(x => x.d === o.d));
      if (next.length) r.skip = next; else delete r.skip;
      // salto tolto da un altro dispositivo: la volta del periodo in corso torna da fare (quelle future arriveranno da sole)
      gone.forEach(o => {
        const plan = MISSIONS.unskipPlan({ ...r, skip: [o] }, o.d);
        const m = S.missions.find(y => y.id === occId(r, o.d));
        if (m) {
          if (plan && m.done && m.done.sk) { m.done = null; touchMonth(monthOf(m)); }
          return;
        }
        if (plan && plan.occ) { S.missions.push(plan.occ); touchMonth(monthOf(plan.occ)); }
      });
      return true;
    }
    // si può saltare (o togliere un salto): con il documento arrivato, la connessione e le regole attuali accettate
    function canSkip(r) {
      if (!r || !r.sr) return true;
      const d = docOfR(r);
      if (!d || !isDoc(d) || !online() || !roleOf(d)) return false;
      return roleOf(d) === 'o' || isActive(d, d.g[me()]);
    }
    // si può togliere il salto: non se il gruppo quel periodo l'ha già contato "insieme" (gli altri l'hanno completato
    // e il tuo salto è valso per la serie di gruppo): come per annullare un completamento (canUndo)
    function canUnskip(r, s) {
      if (!r || !r.sr) return true;
      const d = docOfR(r), t = d && isDoc(d) ? tplOf(d) : null;
      const p = MISSIONS.periodStarting(r, s);
      if (!t || !p) return true;
      return !together(d, t.nx && s >= t.nx.at ? foldedCopy(t) : t, s, p.e);
    }
    // segna (on) o toglie il tuo salto del periodo che inizia il giorno s; true se il server l'ha accettato.
    // La copia del documento cambia subito, così nel frattempo la routine non perde il salto.
    function writeSkip(r, s, on) {
      const d = docOfR(r);
      if (!r || !r.sr || !d || !online()) return Promise.resolve(false);
      const key = keyOf(s);
      const row = { ...((d.x || {})[key] || {}) };
      const before = me() in row ? row[me()] : undefined;
      const put = v => {
        const x = { ...(d.x || {}) }, rw = { ...(x[key] || {}) };
        if (v === undefined) delete rw[me()]; else rw[me()] = v;
        x[key] = rw; d.x = x; saveCache();
      };
      put(on ? null : undefined);
      return update(r.sr, { ['x.' + key + '.' + me()]: on ? FV().serverTimestamp() : FV().delete(), lk: key })
        .then(() => true)
        .catch(e => { console.warn('sroutines skip', e && e.code, e); put(before); fail(errKey(e)); return false; });
    }
    // la tua parte di oggi: la si segna (on) o la si toglie (annullando) nel documento; gli XP sono già tuoi
    // (con più volte per periodo si segna solo quando la completi, cioè con l'ultima volta: come le ricompense)
    function markPart(r, m, on) {
      const d = docOfR(r);
      if (!d || !isDoc(d) || !online()) return;
      const day = occKey(m);   // il primo giorno del periodo
      // volta ripresa con "Annulla penalità" (versioni di prima): vale solo per te (XP e serie personale); per il gruppo quel periodo
      // resta mancato, quindi nel documento non si scrive niente (gli amici non la vedono come fatta)
      if (on && m.re) return;
      if (!partsOf(d, day).includes(me())) return;   // in sospeso, o non ancora dentro quel giorno: non conta per il gruppo
      if (!on && !partSeen(d, day, me())) return;
      const key = keyOf(day);
      update(r.sr, { ['k.' + key + '.' + me()]: on ? FV().serverTimestamp() : FV().delete(), lk: key })
        .catch(e => {
          console.warn('sroutines part', e && e.code, e);
          // arrivata troppo tardi (per esempio senza rete fino al giorno dopo): gli XP restano, per il gruppo non conta
          if (on) msg('sr.msg.notcounted', { title: m.title }, 'bad', true);
        });
    }
    // Chi l'ha creata cambia la routine: il documento prende i valori nuovi (e, se cambiano le regole, una versione nuova).
    // La tua routine cambia subito, il documento solo quando il server conferma. Perché le due copie non restino
    // diverse (tu con le regole nuove, gli amici con quelle vecchie):
    // - finché il server non conferma, la routine ha srd = 1 (salvato: vale anche se chiudi l'app prima). evaluate
    //   riprova a mandarla (al massimo ogni 30 secondi). Riprovare è innocuo: se era già arrivata non cambia niente;
    // - se il server la rifiuta (per esempio le regole di Firebase, o il gruppo non c'è più), la routine torna com'è nel
    //   documento e un messaggio lo dice: meglio una modifica persa (da rifare) che due routine diverse senza saperlo;
    // - con un errore di rete (temporaneo) si tiene la modifica e si riprova.
    const pushing = new Set(), pushedAt = {};
    const RETRY_MS = 30000;
    const transient = e => !!e && ['unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted', 'internal', 'cancelled'].includes(e.code);
    function afterEdit(r) {
      if (r.tz) refreshOpen(r);   // le tue volte ancora da fare: scadenza del gruppo, nella tua ora
      const d = docOfR(r);
      if (!d || !isDoc(d) || roleOf(d) !== 'o' || !online()) return;
      r.srd = 1;
      saveRoutinesLocal();
      push(r, d, true);
    }
    // manda la routine al documento (loud: dopo una tua modifica, con il messaggio per gli amici in sospeso)
    function push(r, d, loud) {
      if (pushing.has(r.id)) return;
      const f = fieldsOf(r);
      // regole uguali a quelle del documento (anche se lì il cambio è ancora "in attesa" e qui è già fatto): non si
      // riscrivono, così gli amici non devono riaccettare niente
      const t = tplOf(d), today = zoneDay(Date.now(), f.tz);
      if (t && shapeOf(r, today) === shapeOf(t, today)) SHAPE_KEYS.forEach(k => { delete f[k]; });
      const rulesChanged = RULE_KEYS.some(k => k in f && !sameK(f[k], d[k] === undefined ? null : d[k]));
      const id = r.sr, rid = r.id, sent = JSON.stringify(fieldsOf(r));
      pushing.add(rid); pushedAt[rid] = Date.now();
      let again = false;
      update(id, { ...f, ownerName: myName(), ver: rulesChanged ? d.ver + 1 : d.ver })
        .then(() => {
          const now = S.routines.find(x => x.id === rid);
          if (!now || now.sr !== id) return;
          // confermata. Se nel frattempo l'hai cambiata di nuovo, si manda subito anche quella; altrimenti è tutto arrivato
          if (JSON.stringify(fieldsOf(now)) === sent) { delete now.srd; saveRoutinesLocal(); } else again = true;
          if (loud && rulesChanged) {
            const j = joinedOf(d);
            if (j.length) msg('sh.msg.changed', { name: joinNames(j.map(x => noname(x.n))) });
          }
        })
        .catch(e => {
          console.warn('sroutines edit', e && e.code, e);
          if (transient(e)) return;   // si riprova da evaluate
          rollback(rid, id);
        })
        .then(() => {
          pushing.delete(rid);
          const now = again ? S.routines.find(x => x.id === rid) : null;
          const dd = now && docOfR(now);
          if (dd && isDoc(dd)) push(now, dd, true);
        });
    }
    // una modifica rimasta da mandare (srd): si riprova, se non c'è già una scrittura in corso
    function retryPush(r, d) {
      if (!r.srd || pushing.has(r.id) || d._pw || !online()) return;
      if (pushedAt[r.id] && Date.now() - pushedAt[r.id] < RETRY_MS) return;
      push(r, d, false);
    }
    // il server ha rifiutato la modifica: la routine torna com'è nel documento (titolo, regole, cambio in attesa)
    // (Firebase mostra subito la modifica nel documento, prima che il server risponda, e dopo il rifiuto la toglie:
    // finché il documento ha ancora la scrittura in sospeso, _pw, si aspetta la versione vera, fino a 10 secondi)
    function rollback(rid, id, tries = 0) {
      if (docs[id] && docs[id]._pw && tries < 20) { setTimeout(() => rollback(rid, id, tries + 1), 500); return; }
      const r = S.routines.find(x => x.id === rid), d = docs[id];
      if (!r || r.sr !== id) return;
      delete r.srd;
      const t = d && isDoc(d) ? tplOf(d) : null;
      if (t) {
        META_KEYS.concat(VAL_KEYS).forEach(k => { r[k] = t[k]; });
        if (r.start !== t.start) { r.start = t.start; r.streak = 0; r.streakDate = addDaysStr(t.start, -1); r.brks = []; }
        takeShape(r, t);
        refreshOpen(r);
      }
      saveRoutinesLocal();
      MUI().syncRoutines();
      paint();
      msg('sr.msg.editfail', { title: r.title }, 'bad', true);
      sfx('err');
    }

    /* ---------- inviti ---------- */
    function openInvite(rid) {
      const byR = () => S.routines.find(x => x.id === rid);
      // oltre i limiti di premi, penalità e bonus (missions.js, firestore.rules) gli amici non la riceverebbero
      const r0 = byR();
      if (r0 && !r0.sr && !MISSIONS.groupSafe(r0)) { msg('sh.err.limits', { max: MISSIONS.MAX_REWARD }, 'bad', true); sfx('err'); return Promise.resolve(false); }
      return SH().pickFriends({
        id: 'r:' + rid, text: T('sr.pick.text'), full: T('sr.pick.full'), allin: T('sr.pick.allin'),
        inside: () => { const d = docOfR(byR()); return new Set(d && isDoc(d) ? guests(d).map(x => x.uid) : []); },
        slots: () => { const d = docOfR(byR()); return MAX_GUESTS - (d && isDoc(d) ? guests(d).length : 0); },
        canSend: () => canInvite(byR()),
        send: chosen => sendInvite(byR(), chosen),
      });
    }
    const guestEntry = f => ({ n: String(f.name || '').slice(0, 30), j: false, a: 0, since: '' });
    async function sendInvite(r, chosen) {
      const names = joinNames(chosen.map(f => f.name || T('fr.noname')));
      if (r.sr) {
        // routine già di gruppo: si aggiungono i nuovi amici. Non cambia niente per chi è già dentro (niente sospeso):
        // la serie di gruppo, da domani, conterà anche loro
        const data = { members: FV().arrayUnion(...chosen.map(f => f.uid)) };
        chosen.forEach(f => { data['g.' + f.uid] = guestEntry(f); });
        await update(r.sr, data);
      } else {
        const id = 'q' + Date.now().toString(36).slice(-8) + Math.random().toString(36).slice(2, 5);
        const now = Date.now();
        r.tz = r.tz || hereTz();
        // una routine come quelle di prima (ogni giorno, una volta, senza cambi) non scrive i campi nuovi: così il
        // documento resta uguale a quelli di prima
        const f = fieldsOf(r);
        if (f.freq === 'd' && f.n === 1 && !f.at && !f.pk && !f.nx) ['freq', 'n', 'at', 'pk', 'nx'].forEach(k => { delete f[k]; });
        if (!f.cal) { delete f.cal; delete f.wk; }   // periodi contati dall'inizio (come prima): i campi nuovi non servono
        // Due scritture: prima il documento SENZA amici (le regole ne controllano il contenuto), poi gli inviti (le regole
        // controllano solo gli amici). Insieme superavano il tetto di espressioni valutate di Firebase.
        const base = {
          v: 1, owner: me(), ownerName: myName(), members: [me()], g: {},
          ...f, ver: 1, k: {}, lk: '', created: now, updated: now,
        };
        // il cambio in attesa (nx) ha ricompense, penalità e bonus nuovi: le regole li controllano un'altra volta, e da
        // soli insieme al resto bastano a superare il tetto di espressioni. Non va nella prima scrittura: si manda dopo,
        // come una modifica qualsiasi (push), quando il gruppo c'è già (nessuno ha ancora accettato, quindi la versione
        // che sale a 2 non fa riaccettare niente a nessuno)
        const pendingNx = !!base.nx;
        if (pendingNx) delete base.nx;
        const inv = { members: FV().arrayUnion(...chosen.map(x => x.uid)) };
        chosen.forEach(x => { inv['g.' + x.uid] = guestEntry(x); });
        // la copia di qui ha già gli amici: è come sarà dopo la seconda scrittura
        const data = {
          ...base, members: [me()].concat(chosen.map(x => x.uid)),
          g: Object.fromEntries(chosen.map(x => [x.uid, guestEntry(x)])),
        };
        r.sr = id; r.sh = 'o';
        // i salti della volta in corso e di quelle future passano al documento del gruppo (dopo averlo creato)
        const today = todayStr();
        const sendSkips = (r.skip || []).filter(x => { const p = MISSIONS.periodStarting(r, x.d); return p && p.e >= today; }).map(x => x.d);
        skipSyncing.add(r.id);
        docs[id] = { ...data, _pw: true };
        // le due scritture partono una dopo l'altra senza aspettare la risposta: Firebase le manda in ordine e il documento
        // ha scritture in sospeso (_pw) finché non sono arrivate tutte e due. Così evaluate non vede mai il documento
        // senza amici come "gruppo vuoto" (alone) e non lo scioglie
        const w1 = ref(id).set(base);
        const w2 = update(id, inv);
        const [r1, r2] = await Promise.allSettled([w1, w2]);
        if (r1.status === 'rejected' || r2.status === 'rejected') {
          // se il documento è stato creato ma gli inviti no, lo si toglie (lo può eliminare chi l'ha creata)
          if (r1.status !== 'rejected') { try { await ref(id).delete(); } catch (e2) { console.warn('sroutines cleanup', e2 && e2.code, e2); } }
          skipSyncing.delete(r.id); delete r.sr; delete r.sh; delete r.tz; delete docs[id];
          throw r1.status === 'rejected' ? r1.reason : r2.reason;
        }
        if (pendingNx) {
          r.srd = 1;   // da mandare: se non riesce subito (rete), evaluate riprova
          saveRoutinesLocal();
          if (docs[id]) push(r, docs[id], false);
        }
        saveCache();
        (async () => { for (const ds of sendSkips) await writeSkip(r, ds, true); })()
          .finally(() => { skipSyncing.delete(r.id); evaluate(); });
        // le volte già create (di oggi, o del periodo in corso) appartengono ora al giorno del gruppo (gd = l'ultimo giorno)
        S.missions.forEach(m => { if (m.rid === r.id && !m.gd && m.due) { m.gd = m.due; touchMonth(monthOf(m)); } });
        saveRoutinesLocal();
      }
      msg('sh.msg.sent', { name: names }, 'good');
      paint();
      return true;
    }
    // inviti ricevuti (le schede le disegna missions-ui.js, insieme a quelli delle missioni)
    function invites() {
      if (!uidOf || uidOf !== me()) return [];
      return Object.entries(docs)
        .filter(([, d]) => isDoc(d) && roleOf(d) === 'g' && !d.g[me()].j)
        .map(([id, d]) => ({ id, d, t: tplOf(d) }))
        .filter(x => x.t)
        .map(({ id, d, t }) => ({
          sid: id, kind: 'r', from: noname(d.ownerName),
          others: joinNames(guests(d).filter(x => x.uid !== me()).map(x => noname(x.n))),
          r: t,
        }));
    }
    // le scelte dell'invitato valgono per l'ultima versione: se è appena cambiata, Firebase rifiuta e lo si dice
    async function guestWrite(id, data, ver) {
      try { await update(id, data); return true; }
      catch (e) {
        console.warn('sroutines', e && e.code, e);
        let why = errKey(e);
        try {
          const x = await ref(id).get({ source: 'server' });
          if (x.exists) { if (x.data().ver !== ver) why = 'sh.msg.stale'; docs[id] = { ...plain(x.data()), _pw: false }; }
          else { why = 'sh.msg.gone'; delete docs[id]; }
          saveCache(); paint();
        } catch (e2) { /* senza rete: resta il messaggio generico */ }
        fail(why);
        return false;
      }
    }
    const ready = d => {
      if (!d || !isDoc(d) || !online() || !navigator.onLine) { fail('sh.err.offline'); return false; }
      return true;
    };
    // Da quale giorno del gruppo partecipi, accettando adesso: oggi, ma non se la volta di oggi è già scaduta (routine
    // di ogni giorno con un orario già passato): nascerebbe già fallita per te, e per il gruppo oggi mancheresti tu.
    // Settimanali e mensili partono comunque dal periodo successivo (guestStart).
    function joinDay(t, now) {
      const today = zoneDay(now, t ? t.tz : hereTz());
      if (!t) return today;
      const x = t.nx && today >= t.nx.at ? foldedCopy(t) : t;
      return MISSIONS.isDaily(x) && MISSIONS.dayPlanned(x, today) && groupDueMs(x, today) <= now ? addDaysStr(today, 1) : today;
    }
    async function acceptInvite(id) {
      const d = docs[id];
      if (!ready(d)) return;
      if (!S.routines.some(r => r.id === id) && S.routines.length >= MAX_ROUTINES) { msg('mf.err.routines', { max: MAX_ROUTINES }, 'bad', true); sfx('err'); return; }
      const t = tplOf(d);
      const since = joinDay(t, Date.now());
      if (!(await guestWrite(id, { [gPath('j')]: true, [gPath('a')]: d.ver, [gPath('n')]: myName(), [gPath('since')]: since }, d.ver))) return;
      sfx('ok');
      msg('sr.msg.joined', { title: d.title }, 'good');
    }
    // uscire (o rifiutare): la tua voce sparisce dal documento. Niente penalità per nessuno
    const leaveData = () => ({ [gPath()]: FV().delete(), members: FV().arrayRemove(me()) });
    async function declineInvite(id) {
      const d = docs[id];
      if (!ready(d)) return;
      leaving.add(id);
      const ok = await guestWrite(id, leaveData(), d.ver);
      leaving.delete(id);
      if (!ok) return;
      delete docs[id]; saveCache();
      sfx('leave');
      paint();
    }
    async function acceptChange(rid) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!ready(d)) return;
      if (await guestWrite(r.sr, { [gPath('a')]: d.ver }, d.ver)) { sfx('ok'); msg('sh.msg.accepted.change', { title: r.title }, 'good'); }
    }
    // l'invitato esce: la routine resta sua (come routine normale, con le regole che aveva)
    async function exit(rid, quiet) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!r || !ready(d)) return false;
      const id = r.sr;
      leaving.add(id);
      const ok = await guestWrite(id, leaveData(), d.ver);
      leaving.delete(id);
      if (!ok) return false;
      delete docs[id]; saveCache();
      unlink(r);
      if (!quiet) sfx('leave');
      msg('sr.msg.exit', { title: r.title });
      paint();
      return true;
    }
    // chi l'ha creata scioglie il gruppo: il documento si elimina, la routine resta a tutti come routine normale
    async function dissolve(rid, quiet) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!r || !r.sr) return true;
      if (!ready(d)) return false;
      const id = r.sr;
      leaving.add(id);
      const ok = await write(() => ref(id).delete());
      leaving.delete(id);
      if (!ok) return false;
      delete docs[id]; saveCache();
      unlink(r);
      if (!quiet) sfx('del');
      paint();
      return true;
    }
    // prima di eliminare una routine di gruppo: chi l'ha creata scioglie il gruppo, l'invitato esce
    async function beforeDelete(r) {
      if (!r || !r.sr) return true;
      return r.sh === 'g' ? exit(r.id, true) : dissolve(r.id, true);   // il suono lo fa l'eliminazione
    }
    // chi l'ha creata toglie chi non ha risposto (inviti in attesa e chi è in sospeso), senza penalità per nessuno
    async function cancelInvite(rid) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!ready(d)) return;
      const waiting = guests(d).filter(x => !isActive(d, x)).map(x => x.uid);
      if (!waiting.length) return;
      if (!joinedOf(d).some(x => isActive(d, x))) {
        // non resta nessuno dentro: il gruppo non serve più
        if (!(await dissolve(rid))) return;
      } else {
        const data = { members: FV().arrayRemove(...waiting) };
        waiting.forEach(u => { data['g.' + u] = FV().delete(); });
        if (!(await write(() => update(r.sr, data)))) return;
        msg('sh.msg.removed.by', { name: joinNames(guests(d).filter(x => waiting.includes(x.uid)).map(x => noname(x.n))) });
      }
      sfx('leave');
      paint();
    }

    return {
      start, reset, evaluate, info, occInfo, streakNow, canInvite, editBlock, canUndo, markPart, afterEdit,
      openInvite, invites, acceptInvite, declineInvite, acceptChange, exit, dissolve, beforeDelete, cancelInvite,
      canSkip, canUnskip, writeSkip,
      // per le prove
      together, allSkipped, partsOf, tplOf, joinDay,
    };
  }
  window.LIFE_RPG_SHARED_ROUTINES = { create, MAX_GUESTS };
})();