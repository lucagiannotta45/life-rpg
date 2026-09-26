/*
 * Life RPG — routine di gruppo con gli amici (fino a 3)
 * ---------------------------------------------------------------
 * "Ognuno la sua, la serie insieme":
 * - ogni volta della routine è tua: gli XP arrivano subito quando la completi, e la penalità la paghi solo tu
 *   se non la fai (esattamente come una routine normale). Un amico che salta non ti toglie niente;
 * - in più c'è la SERIE DI GRUPPO: i giorni di fila in cui l'avete fatta tutti. Il bonus della routine, in una
 *   routine di gruppo, arriva ogni N giorni di fila "tutti insieme" (non con la serie personale);
 * - il giorno è uno solo per tutti: quello di chi l'ha creata (il suo fuso orario). Chi è altrove vede la
 *   scadenza nella sua ora;
 * - chi l'ha creata decide tutto (titolo, giorni, ora, XP, penalità, pausa, bonus). Se cambia XP, penalità, giorni
 *   o ora, gli amici vanno "in sospeso": continuano con le regole di prima, non contano per il gruppo finché non
 *   scelgono "Accetta" oppure "Esci";
 * - si può uscire quando si vuole, senza penalità: la routine resta tua, come routine normale. Se chi l'ha creata
 *   scioglie il gruppo (o elimina la routine), anche agli amici la routine resta, come routine normale.
 *
 * Come funziona:
 * - su Firebase c'è un documento sroutines/{id}, che leggono e scrivono solo i partecipanti (le regole controllano
 *   chi può cambiare cosa). Gli amici sono in g: { uid: { n: nome, j: ha accettato, a: versione accettata,
 *   since: giorno del gruppo da cui partecipa } }. Le parti fatte sono in k: { AAAAMMGG: { uid: ora del server } }:
 *   l'ora la mette il server (serverTimestamp), così ognuno può controllare se è arrivata entro la scadenza;
 * - ognuno ha la routine nel suo elenco, con sr (il documento) e sh (il ruolo: 'o' = l'hai creata, 'g' = invitato).
 *   Per gli invitati l'id della routine è l'id del documento: così due dispositivi dello stesso giocatore creano
 *   la stessa routine (e le stesse volte), non due copie;
 * - la serie di gruppo non la scrive nessuno: ogni app la ricava dal documento, un giorno alla volta, e la salva
 *   nella sua routine (gs = serie, gsd = ultimo giorno "tutti insieme", gbest = record).
 *
 * Uso (in index.js):  const SR = window.LIFE_RPG_SHARED_ROUTINES.create(D, S);
 */
(() => {
  'use strict';
  const MAX_GUESTS = 3;
  function create(D, S) {
    const { T, MISSIONS, sfx, touchMonth, lsSet, saveRoutinesLocal } = D;
    const {
      todayStr, addDaysStr, monthOf, normalizeRoutines, zoneDay, groupDueMs, localDue, hereTz, dayCounts, occId,
      groupStep, MAX_ROUTINES, KEEP_DAYS,
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
    // chi partecipa quel giorno: chi l'ha creata, e gli amici dentro con le regole attuali, dal loro primo giorno
    const partsOf = (d, day) => [d.owner].concat(guests(d).filter(x => isActive(d, x) && x.since && x.since <= day).map(x => x.uid));
    // il modello della routine (lo decide chi l'ha creata), controllato come una routine salvata
    function tplOf(d) {
      const r = normalizeRoutines([{ id: 'x', title: d.title, desc: d.desc, rewards: d.rewards, penalty: d.penalty, days: d.days,
        time: d.time, start: d.start, pause: d.pause, bonus: d.bonus, stars: d.stars }])[0];
      if (!r) return null;
      const tz = typeof d.tz === 'string' && d.tz ? d.tz : hereTz();
      return { title: r.title, desc: r.desc, rewards: r.rewards, penalty: r.penalty, days: r.days, time: r.time,
        start: r.start, pause: r.pause, bonus: r.bonus, stars: r.stars, tz };
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
    // quel giorno l'avete fatta tutti, in tempo (servono almeno due partecipanti)
    function together(d, t, day) {
      const parts = partsOf(d, day);
      if (parts.length < 2) return false;
      const end = groupDueMs(t, day);
      return parts.every(u => { const at = partAt(d, day, u); return at != null && at <= end; });
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
    function unlink(r) {
      delete r.sr; delete r.sh; delete r.shn; delete r.tz;
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
        } else {
          const mine = d.g[me()];
          if (!mine.j) return;   // invito: lo mostra invites()
          if (!r) { r = addLocal(id, d); if (!r) return; changed = true; }
          if (!isPend(d, mine) && syncTemplate(r, d)) changed = true;
        }
        const names = [d.owner].concat(joinedOf(d).map(x => x.uid)).filter(u => u !== me()).map(u => nameOf(d, u).slice(0, 30)).slice(0, MAX_GUESTS);
        if (!same(r.shn || [], names)) { if (names.length) r.shn = names; else delete r.shn; changed = true; }
        if (groupEval(r, d)) changed = true;
        if (role === 'o') prune(id, d);
      });
      if (changed) { saveRoutinesLocal(); if (MUI().syncRoutines()) MUI().renderMissionViews(); }
    }
    // l'invitato riceve la routine nel suo elenco (id = id del documento)
    function addLocal(id, d) {
      const t = tplOf(d);
      if (!t) return null;
      const since = d.g[me()].since || zoneDay(Date.now(), t.tz);
      const start = t.start > since ? t.start : since;
      let r = S.routines.find(x => x.id === id);   // una tua copia di prima (eri uscito): si ricollega
      if (!r) {
        if (S.routines.length >= MAX_ROUTINES) return null;
        r = { id, streak: 0, streakDate: addDaysStr(start, -1), best: 0, made: '' };
        S.routines.push(r);
      }
      Object.assign(r, { title: t.title, desc: t.desc, rewards: t.rewards, penalty: t.penalty, days: t.days, time: t.time,
        pause: t.pause, bonus: t.bonus, stars: t.stars, start, sr: id, sh: 'g', tz: t.tz });
      if (r.made && r.made >= todayStr()) r.made = addDaysStr(todayStr(), -1);   // se oggi è un giorno previsto, compare subito
      return r;
    }
    // l'invitato (con le regole attuali) prende il modello del documento; le volte ancora da fare si aggiornano
    const TPL_KEYS = ['title', 'desc', 'rewards', 'penalty', 'days', 'time', 'pause', 'bonus', 'stars', 'tz'];
    function syncTemplate(r, d) {
      const t = tplOf(d);
      if (!t) return false;
      const since = d.g[me()].since || r.start;
      const start = t.start > since ? t.start : since;
      if (TPL_KEYS.every(k => same(r[k] === undefined ? null : r[k], t[k])) && r.start === start) return false;
      const daysChanged = !same(r.days, t.days) || r.start !== start;
      TPL_KEYS.forEach(k => { r[k] = t[k]; });
      if (r.start !== start) { r.start = start; r.streak = 0; r.streakDate = addDaysStr(start, -1); }
      if (daysChanged && r.made && r.made >= todayStr()) r.made = addDaysStr(todayStr(), -1);
      refreshOpen(r);
      return true;
    }
    // le volte ancora da fare prendono i valori nuovi della routine (ora compresa, dal giorno del gruppo di oggi)
    function refreshOpen(r) {
      const months = new Set();
      const today = zoneDay(Date.now(), r.tz || hereTz());
      const here = hereTz();
      S.missions.forEach(m => {
        if (m.rid !== r.id || m.done || m.failed) return;
        Object.assign(m, { title: r.title, desc: r.desc, rewards: { ...r.rewards }, penalty: { ...r.penalty }, stars: r.stars });
        const day = m.gd || m.due;
        if (day >= today) Object.assign(m, !r.tz || r.tz === here ? { due: day, dueTime: r.time } : localDue(groupDueMs(r, day)));
        months.add(monthOf(m));
      });
      months.forEach(touchMonth);
    }
    // serie di gruppo: i giorni "tutti insieme" dopo l'ultimo già contato, uno alla volta; true se è cambiata
    function groupEval(r, d) {
      const t = tplOf(d);
      if (!t) return false;
      const now = Date.now();
      const today = zoneDay(now, t.tz);
      const oldest = addDaysStr(today, -KEEP_DAYS);
      let day = r.gsd && r.gsd >= oldest ? addDaysStr(r.gsd, 1) : (t.start > oldest ? t.start : oldest);
      let changed = false;
      for (let guard = 0; day <= today && guard < 400; guard++, day = addDaysStr(day, 1)) {
        if (!dayCounts(t, day) || !partsOf(d, day).includes(me()) || !together(d, t, day)) continue;
        const { n, bonus } = groupStep({ ...t, gs: r.gs, gsd: r.gsd }, day);
        const m = S.missions.find(x => x.id === occId(r, day));
        const hasBonus = Object.keys(bonus).length > 0 && m && m.done && !m.done.gb;
        // il bonus si dà solo quando non c'è una finestra aperta: si riprova più tardi (la serie aspetta con lui)
        if (hasBonus && !MUI().groupBonus(m, bonus, n)) break;
        r.gs = n; r.gsd = day; r.gbest = Math.max(r.gbest || 0, n);
        changed = true;
        if (!hasBonus && day === today) msg('sr.msg.together', { title: r.title, n }, 'good');
      }
      return changed;
    }
    // i giorni vecchi si tolgono dal documento, uno per volta (lo fa solo chi l'ha creata)
    const pruning = new Set();
    function prune(id, d) {
      if (!online() || pruning.has(id) || !d.k) return;
      const limit = keyOf(addDaysStr(todayStr(), -(KEEP_DAYS + 2)));
      const old = Object.keys(d.k).filter(k => /^\d{8}$/.test(k) && k < limit).sort()[0];
      if (!old) return;
      pruning.add(id);
      ref(id).update({ ['k.' + old]: FV().delete(), lk: old, updated: Date.now() })
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
      const day = m.gd || m.due;
      const parts = partsOf(d, day);
      const mine = roleOf(d) === 'g' ? d.g[me()] : null;
      const others = parts.filter(u => u !== me());
      return {
        pending: isPend(d, mine),
        inGroup: parts.includes(me()) && parts.length > 1,
        together: together(d, t, day),
        doneNames: joinNames(others.filter(u => partSeen(d, day, u)).map(u => nameOf(d, u))),
        doneCount: others.filter(u => partSeen(d, day, u)).length,
        missingNames: joinNames(others.filter(u => !partSeen(d, day, u)).map(u => nameOf(d, u))),
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
      return {
        title: r.title, desc: r.desc || '', rewards: { ...r.rewards }, penalty: { ...r.penalty },
        stars: r.stars ? { d: r.stars.d, f: r.stars.f } : null, days: r.days.slice(), time: r.time || null,
        start: r.start, pause: r.pause ? { from: r.pause.from, until: r.pause.until } : null,
        bonus: r.bonus ? { every: r.bonus.every, xp: r.bonus.xp } : null, tz: r.tz || hereTz(),
      };
    }
    const RULE_KEYS = ['rewards', 'penalty', 'days', 'time'];   // cambiandoli, gli amici devono accettare di nuovo
    const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
    const sameK = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

    // la tua parte di oggi: la si segna (on) o la si toglie (annullando) nel documento; gli XP sono già tuoi
    function markPart(r, m, on) {
      const d = docOfR(r);
      if (!d || !isDoc(d) || !online()) return;
      const day = m.gd || m.due;
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
    // chi l'ha creata cambia la routine: il documento prende i valori nuovi (e, se cambiano le regole, una versione nuova)
    function afterEdit(r) {
      const d = docOfR(r);
      if (!d || !isDoc(d) || roleOf(d) !== 'o' || !online()) return;
      const f = fieldsOf(r);
      const rulesChanged = RULE_KEYS.some(k => !sameK(f[k], d[k]));
      write(() => update(r.sr, { ...f, ownerName: myName(), ver: rulesChanged ? d.ver + 1 : d.ver }));
      const j = joinedOf(d);
      if (rulesChanged && j.length) msg('sh.msg.changed', { name: joinNames(j.map(x => noname(x.n))) });
    }

    /* ---------- inviti ---------- */
    function openInvite(rid) {
      const byR = () => S.routines.find(x => x.id === rid);
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
        const data = {
          v: 1, owner: me(), ownerName: myName(), members: [me()].concat(chosen.map(f => f.uid)),
          g: Object.fromEntries(chosen.map(f => [f.uid, guestEntry(f)])),
          ...fieldsOf(r), ver: 1, k: {}, lk: '', created: now, updated: now,
        };
        r.sr = id; r.sh = 'o';
        docs[id] = { ...data, _pw: true };
        try { await ref(id).set(data); }
        catch (e) { delete r.sr; delete r.sh; delete r.tz; delete docs[id]; throw e; }
        saveCache();
        // le volte già create (di oggi) appartengono ora al giorno del gruppo
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
    async function acceptInvite(id) {
      const d = docs[id];
      if (!ready(d)) return;
      if (!S.routines.some(r => r.id === id) && S.routines.length >= MAX_ROUTINES) { msg('mf.err.routines', { max: MAX_ROUTINES }, 'bad', true); sfx('err'); return; }
      const t = tplOf(d);
      const since = zoneDay(Date.now(), t ? t.tz : hereTz());
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
      sfx('close');
      paint();
    }
    async function acceptChange(rid) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!ready(d)) return;
      if (await guestWrite(r.sr, { [gPath('a')]: d.ver }, d.ver)) { sfx('ok'); msg('sh.msg.accepted.change', { title: r.title }, 'good'); }
    }
    // l'invitato esce: la routine resta sua (come routine normale, con le regole che aveva)
    async function exit(rid) {
      const r = S.routines.find(x => x.id === rid), d = docOfR(r);
      if (!r || !ready(d)) return false;
      const id = r.sr;
      leaving.add(id);
      const ok = await guestWrite(id, leaveData(), d.ver);
      leaving.delete(id);
      if (!ok) return false;
      delete docs[id]; saveCache();
      unlink(r);
      sfx('close');
      msg('sr.msg.exit', { title: r.title });
      paint();
      return true;
    }
    // chi l'ha creata scioglie il gruppo: il documento si elimina, la routine resta a tutti come routine normale
    async function dissolve(rid) {
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
      sfx('close');
      paint();
      return true;
    }
    // prima di eliminare una routine di gruppo: chi l'ha creata scioglie il gruppo, l'invitato esce
    async function beforeDelete(r) {
      if (!r || !r.sr) return true;
      return r.sh === 'g' ? exit(r.id) : dissolve(r.id);
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
      sfx('close');
      paint();
    }

    return {
      start, reset, evaluate, info, occInfo, streakNow, canInvite, editBlock, canUndo, markPart, afterEdit,
      openInvite, invites, acceptInvite, declineInvite, acceptChange, exit, dissolve, beforeDelete, cancelInvite,
      // per le prove
      together, partsOf, tplOf,
    };
  }
  window.LIFE_RPG_SHARED_ROUTINES = { create, MAX_GUESTS };
})();
