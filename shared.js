/*
 * Life RPG — missioni condivise con gli amici (fino a 3)
 * ---------------------------------------------------------------
 * Chi crea una missione può invitare fino a 3 amici. Ognuno sceglie da solo se accettare o rifiutare.
 * - La missione è superata quando tutti quelli che l'hanno accettata hanno fatto la loro parte
 *   (gli XP arrivano a tutti in quel momento);
 * - fallisce per tutti se uno abbandona, oppure se alla scadenza anche uno solo non ha fatto la sua parte:
 *   la ricompensa non arriva a nessuno, ma la penalità la paga solo chi ha abbandonato o non ha fatto la sua parte
 *   (chi l'aveva fatta non perde XP; lo decide missions-ui.js con il "perché" di failInfo);
 * - XP, penalità e scadenza li decide solo chi l'ha creata, che può modificarla quando vuole. Se cambia XP,
 *   penalità o scadenza, oppure invita altri amici, chi è dentro va "in sospeso" e sceglie "Accetta" oppure
 *   "Esci" (uscire così non è un fallimento); in sospeso non può fare la sua parte né abbandonare.
 *   Chi è ancora in sospeso quando la missione finisce (scadenza o abbandono di un altro) esce senza penalità;
 * - un invito senza risposta non blocca nessuno: se la missione finisce, o arriva la scadenza, si annulla da solo.
 *
 * Come funziona:
 * - su Firebase c'è un documento condiviso, shared/{sid}, che leggono e scrivono solo i partecipanti
 *   (le regole di sicurezza controllano chi può cambiare cosa, e che nessuno completi dopo la scadenza).
 *   Gli amici sono nella mappa g: { uid: { n: nome, j: ha accettato, a: versione accettata, d: parte fatta, s: esito visto } };
 * - ognuno ha anche una missione normale nel suo elenco, con sid (il documento) e sh (il ruolo:
 *   'o' = l'hai creata tu, 'g' = sei stato invitato). Così XP, penalità, calendario e sincronizzazione tra i tuoi
 *   dispositivi funzionano come per tutte le altre missioni;
 * - l'esito (superata, fallita) non lo scrive nessuno: ogni app lo ricava dal documento, allo stesso modo;
 * - la scadenza è un istante preciso (dueAt), valido per tutti anche con fusi orari diversi: ognuno la vede nella sua ora.
 *
 * Qui c'è la logica; le schede delle missioni le disegna missions-ui.js, che chiede qui le informazioni.
 *
 * Uso (in index.js):  const SH = window.LIFE_RPG_SHARED.create(D, S);
 */
(() => {
  'use strict';
  const MAX_GUESTS = 3;   // amici al massimo per missione (lo stesso limite è nelle regole di Firebase: members fino a 4)
  function create(D, S) {
    const {
      T, MISSIONS, $, mk, sfx, openModal, closeModal, touchMonth, tombMissions, lsSet, friendsList, loadFriendsList, fbConnect,
    } = D;
    const { STATS } = D.GAME;
    const { isoDate, pad2, todayStr, startMs, dueEndMs, monthOf, normalizeRewards, normalizeStars } = MISSIONS;
    const MUI = () => D.MUI;   // missions-ui.js nasce prima di questo file, ma lo si prende sempre al momento dell'uso

    const LS_SHARED = 'liferpg:shared:v1';
    const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
    const me = () => (S.fbUser ? S.fbUser.uid : '');
    const FV = () => window.firebase.firestore.FieldValue;
    const TN = (key, n, vars) => T(key + (n === 1 ? '_one' : '_other'), Object.assign({ n }, vars));

    /* ---------- documenti condivisi: copia in memoria ---------- */
    // docs: { sid: dati del documento + _srv (fino a quando, con l'orologio di qui, il server l'ha di sicuro confermato)
    //        + _pw (scritture in attesa) }
    let docs = {}, uidOf = '', unsub = null, listening = false, serverSeen = false;
    // Documenti che stai togliendo tu (uscendo, rifiutando, eliminando), con la scrittura non ancora confermata.
    // Firebase li toglie subito dall'elenco, prima della risposta del server: se poi la rifiuta, ricompaiono.
    // Trattarli come spariti in quel momento faceva comparire e sparire la missione (o la sua etichetta) di continuo.
    const leaving = new Set();
    function loadCache(uid) {
      docs = {};
      try {
        const raw = JSON.parse(localStorage.getItem(LS_SHARED) || 'null');
        if (raw && raw.uid === uid && raw.docs && typeof raw.docs === 'object') docs = raw.docs;
      } catch (e) { /* copia rovinata: si riparte */ }
      uidOf = uid;
    }
    function saveCache() { lsSet(LS_SHARED, JSON.stringify({ uid: uidOf, docs })); }
    const docOf = m => (m && m.sid && uidOf === me() ? docs[m.sid] || null : null);

    /* ---------- chi c'è nel documento ---------- */
    const isV2 = d => d && d.v === 2 && d.g && typeof d.g === 'object';
    // il tuo ruolo: 'o' (l'hai creata), 'g' (sei invitato), '' (non ne fai parte)
    const roleOf = d => (d.owner === me() ? 'o' : isV2(d) && d.g[me()] ? 'g' : '');
    const noname = n => String(n || '').trim() || T('fr.noname');
    // gli amici, nell'ordine di members
    const guests = d => (d.members || []).slice(1).filter(u => d.g[u]).map(u => ({ uid: u, ...d.g[u] }));
    const isPend = (d, x) => !!x && x.j && x.a !== d.ver;           // ha accettato, ma non l'ultima modifica
    const isActive = (d, x) => !!x && x.j && x.a === d.ver;         // dentro, con le regole attuali
    const joinedOf = d => guests(d).filter(x => x.j);
    // tutti i partecipanti attivi (chi l'ha creata + gli amici dentro con le regole attuali), con "ha fatto la sua parte"
    const actives = d => [{ uid: d.owner, name: noname(d.ownerName), done: d.oDone != null }]
      .concat(guests(d).filter(x => isActive(d, x)).map(x => ({ uid: x.uid, name: noname(x.n), done: x.d != null })));
    const allDone = d => { const j = joinedOf(d); return j.length > 0 && d.oDone != null && j.every(x => x.a === d.ver && x.d != null); };
    const nameOf = (d, uid) => (uid === d.owner ? noname(d.ownerName) : noname(d.g[uid] && d.g[uid].n));
    // "Anna, Marco e Luca" (sep: la congiunzione, " e " oppure " né ")
    function joinNames(list, sep) {
      const a = list.filter(Boolean);
      if (a.length <= 1) return a[0] || '';
      return a.slice(0, -1).join(', ') + (sep || T('sh.and')) + a[a.length - 1];
    }

    /* ---------- l'esito, ricavato dal documento (dal tuo punto di vista) ---------- */
    // 'invite' (nessun amico ha ancora accettato, o tu non hai ancora accettato), 'open', 'done', 'failed',
    // 'release' (esci senza fallire: eri in sospeso quando è finita; oppure, per chi l'ha creata, alla scadenza
    // non è rimasto nessun amico dentro), 'wait' (scaduta: si aspetta la conferma del server)
    /* ---------- l'orologio del server ---------- */
    // Le regole di Firebase usano l'ora del server; il telefono ha la sua, che può essere avanti o indietro.
    // All'avvio si misura la differenza: si scrive l'ora del server (serverTimestamp) in users/{uid}/meta/clock
    // e la si confronta con quella del telefono. clockOff = di quanto il server è avanti; clockErr = margine di errore
    // (metà del tempo di andata e ritorno). Finché non si sa, si usa un margine prudente di 2 minuti.
    let clockOff = null, clockErr = 0, clockAt = 0;
    const serverNow = () => Date.now() + (clockOff || 0);
    const CLOCK_SKEW = 120000;   // margine se la differenza non è ancora stata misurata
    const SETTLE = 1500;         // piccolo margine in più dopo la scadenza
    const LISTEN_LAG = 5000;     // un aggiornamento in diretta può descrivere il server di qualche istante prima
    async function measureClock() {
      if (!online() || (clockAt && Date.now() - clockAt < 3600000)) return;   // al massimo una volta l'ora
      clockAt = Date.now();
      try {
        const r = S.fbDb.collection('users').doc(me()).collection('meta').doc('clock');
        const t0 = Date.now();
        await r.set({ t: FV().serverTimestamp() });
        const t1 = Date.now();
        const x = await r.get({ source: 'server' });
        const srv = x.data().t.toMillis();
        // l'ora del server è stata presa tra t0 e t1 (orologio di qui)
        clockOff = srv - (t0 + t1) / 2;
        clockErr = (t1 - t0) / 2;
        evaluate(); MUI().renderMissionViews();
      } catch (e) { clockAt = 0; console.warn('shared clock', e && e.code, e); }
    }
    // da quando (orologio di qui) i dati del server descrivono di sicuro un momento dopo la scadenza
    const safeAfter = d => (clockOff == null ? d.dueAt + CLOCK_SKEW : d.dueAt - clockOff + clockErr + SETTLE);

    function outcome(d, now = serverNow()) {
      const joined = joinedOf(d);
      if (!joined.length) return 'invite';
      const mine = roleOf(d) === 'g' ? d.g[me()] : null;
      if (mine && !mine.j) return 'invite';
      const iPend = isPend(d, mine);
      if (d.left) return iPend ? 'release' : 'failed';
      if (allDone(d)) return 'done';
      if (d.dueAt != null && now >= d.dueAt) {
        if (iPend) return 'release';
        // dopo la scadenza si decide solo con dati del server arrivati dopo la scadenza:
        // un completamento fatto in tempo da qualcuno potrebbe non essere ancora arrivato qui
        if ((d._srv || 0) < safeAfter(d) || d._pw) return 'wait';
        const act = joined.filter(x => x.a === d.ver);
        if (!act.length) return 'release';   // gli amici erano tutti in sospeso: la missione torna di chi l'ha creata
        return d.oDone != null && act.every(x => x.d != null) ? 'done' : 'failed';
      }
      return 'open';
    }
    const isFinal = d => ['done', 'failed', 'release'].includes(outcome(d));
    // perché è fallita, dal tuo punto di vista: kind per la finestra "Missioni fallite" e i nomi da mostrare
    function failInfo(d) {
      const u = me();
      const others = actives(d).filter(p => p.uid !== u);
      if (d.left) {
        if (d.left === u) return { kind: 'me', name: joinNames(others.map(p => p.name)) };
        return { kind: 'friend', name: nameOf(d, d.left) };
      }
      const iMissing = !actives(d).some(p => p.uid === u && p.done);
      const missing = others.filter(p => !p.done).map(p => p.name);
      if (iMissing && missing.length) return { kind: 'both', name: joinNames(missing, T('sh.nor')) };
      if (iMissing) return { kind: 'mine', name: joinNames(others.map(p => p.name)) };
      return { kind: missing.length > 1 ? 'theirs_many' : 'theirs', name: joinNames(missing) };
    }

    /* ---------- dalla missione al documento (e ritorno) ---------- */
    const hhmm = dt => pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
    // la scadenza (istante) nell'ora di questo dispositivo: senza ora se cade a mezzanotte (fine del giorno)
    function localDue(ms) {
      if (ms == null) return { due: null, dueTime: null };
      const dt = new Date(ms);
      if (dt.getHours() === 0 && dt.getMinutes() === 0) return { due: isoDate(new Date(ms - 1)), dueTime: null };
      const e = new Date(ms - 60000);   // "entro le 18:00" vuol dire fino alla fine del minuto 18:00
      return { due: isoDate(e), dueTime: hhmm(e) };
    }
    function localFrom(ms) {
      if (ms == null) return { from: null, fromTime: null };
      const dt = new Date(ms);
      return { from: isoDate(dt), fromTime: dt.getHours() === 0 && dt.getMinutes() === 0 ? null : hhmm(dt) };
    }
    const intMap = o => Object.fromEntries(STATS.map(s => [s.key, Math.floor(Number(o && o[s.key]) || 0)]));
    // i campi della missione che finiscono nel documento (li scrive solo chi l'ha creata)
    function fieldsOf(m) {
      return {
        title: m.title, desc: m.desc || '', rewards: intMap(m.rewards), penalty: intMap(m.penalty),
        stars: m.stars ? { d: m.stars.d, f: m.stars.f } : null,
        dueAt: m.due ? dueEndMs(m) : null, fromAt: m.from ? startMs(m) : null, tz: myTz(),
        oDue: m.due || null, oDueTime: m.due ? m.dueTime || null : null,
        oFrom: m.from || null, oFromTime: m.from ? m.fromTime || null : null,
      };
    }
    // i campi della missione che arrivano dal documento (per gli invitati)
    function missionFields(d) {
      const rewards = normalizeRewards(d.rewards);
      return {
        title: String(d.title || '').slice(0, 60), desc: String(d.desc || '').slice(0, 500),
        rewards, penalty: normalizeRewards(d.penalty), stars: normalizeStars(rewards, d.stars),
        ...localDue(d.dueAt), ...localFrom(d.fromAt),
      };
    }
    const RULE_KEYS = ['rewards', 'penalty', 'dueAt'];   // cambiandoli, gli amici devono accettare di nuovo
    // confronto che non dipende dall'ordine delle chiavi: Firebase restituisce le mappe (rewards, penalty...)
    // con le chiavi in ordine alfabetico, mentre qui sono nell'ordine delle statistiche
    const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
    const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
    // i nomi degli altri partecipanti (dentro la missione), da salvare nella missione: servono all'etichetta
    // "Condivisa con…" quando il documento non ci sarà più
    const otherNames = d => [d.owner].concat(joinedOf(d).map(x => x.uid)).filter(u => u !== me())
      .map(u => nameOf(d, u).slice(0, 30)).slice(0, MAX_GUESTS);

    /* ---------- scritture ---------- */
    const ref = sid => S.fbDb.collection('shared').doc(sid);
    const online = () => !!(S.fbUser && S.dbRef && S.fbDb);
    // un rifiuto delle regole di Firebase (permission-denied) non è un problema di connessione: lo si dice diversamente
    const errKey = e => (e && e.code === 'permission-denied' ? 'sh.msg.denied' : 'sh.msg.err');
    async function write(job, errText) {
      try { await job(); return true; }
      catch (e) { console.warn('shared', e && e.code, e); MUI().missionMsg(errText || T(errKey(e)), 'bad', true); sfx('err'); return false; }
    }
    const update = (sid, data) => ref(sid).update({ ...data, updated: Date.now() });
    const gPath = (...k) => ['g', me()].concat(k).join('.');   // la tua voce in g: "g.<uid>" o "g.<uid>.d"

    /* ---------- ascolto ---------- */
    function start() {
      if (!online() || listening) return;
      if (uidOf !== me()) loadCache(me());
      listening = true; serverSeen = false;
      measureClock();
      unsub = S.fbDb.collection('shared').where('members', 'array-contains', me())
        .onSnapshot({ includeMetadataChanges: true }, onSnap, e => { console.warn('shared listen', e); listening = false; unsub = null; });
    }
    function reset() {
      if (unsub) { try { unsub(); } catch (e) { /* ignora */ } }
      unsub = null; listening = false; serverSeen = false;
      docs = {}; uidOf = ''; leaving.clear();
      Object.values(refetchT).forEach(clearTimeout); Object.keys(refetchT).forEach(k => delete refetchT[k]);
      clockOff = null; clockErr = 0; clockAt = 0; clearTimeout(dueTimer);
      try { localStorage.removeItem(LS_SHARED); } catch (e) { /* ignora */ }
    }
    function onSnap(qs) {
      const fromServer = !qs.metadata.fromCache, now = Date.now();
      const seen = new Set();
      qs.docs.forEach(x => {
        const prev = docs[x.id];
        const d = { ...x.data() };
        d._pw = x.metadata.hasPendingWrites;
        // dati più nuovi non descrivono mai un momento precedente: _srv può solo crescere
        const before = prev ? prev._srv || 0 : 0;
        d._srv = fromServer ? Math.max(before, now - LISTEN_LAG) : before;
        docs[x.id] = d;
        seen.add(x.id);
      });
      // un documento che il server non manda più: eliminato, oppure non ne fai più parte
      if (fromServer) {
        serverSeen = true;
        Object.keys(docs).forEach(sid => { if (!seen.has(sid) && !leaving.has(sid)) { delete docs[sid]; gone(sid); } });
        checkOrphans();
      }
      saveCache();
      evaluate();
      MUI().renderMissionViews();
    }
    // la missione non è più collegata a un documento condiviso: torna solo tua
    function unlink(L) { delete L.sid; delete L.sh; delete L.shn; touchMonth(monthOf(L)); }
    // il documento non c'è più: la missione torna solo tua (se l'avevi creata tu) oppure sparisce (se eri invitato)
    function gone(sid) {
      const L = S.missions.find(m => m.sid === sid);
      if (!L || L.done || L.failed) return;   // le missioni finite restano nella cronologia, con la loro etichetta
      if (L.sh === 'o') unlink(L);
      else { dropLocal(L); MUI().missionMsg(T('sh.msg.removed', { title: L.title }), ''); }   // per esempio: tolto da chi l'ha creata
    }
    // Una missione ancora aperta collegata a un documento che qui non è mai arrivato (per esempio arrivata da un altro
    // dispositivo dopo che il documento era stato eliminato) resterebbe bloccata: non si completa, non fallisce e
    // non si elimina. Si chiede al server: se il documento non c'è davvero, la si sistema come per gone().
    function checkOrphans() {
      if (!serverSeen || !uidOf || uidOf !== me()) return;
      S.missions.forEach(m => { if (m.sid && !m.done && !m.failed && !docs[m.sid]) verifyMissing(m.sid); });
    }
    // Se il documento c'è ma non ne fai più parte (per esempio ti ha tolto chi l'ha creata), le regole non te lo
    // lasciano leggere: il server risponde "permesso negato", ed è come se per te non ci fosse più.
    const notMine = e => e && e.code === 'permission-denied';
    function verifyMissing(sid) {
      if (!online() || (fetching[sid] && Date.now() - fetching[sid] < 30000)) return;
      fetching[sid] = Date.now();
      ref(sid).get({ source: 'server' }).then(x => {
        if (x.exists || docs[sid]) return;   // c'è: arriva con l'ascolto
        gone(sid);
        MUI().renderMissionViews();
      }).catch(e => {
        if (notMine(e) && !docs[sid]) { gone(sid); MUI().renderMissionViews(); return; }
        console.warn('shared check', e);
      });
    }
    function dropLocal(L) {
      tombMissions([L]);
      S.missions = S.missions.filter(x => x !== L);
      touchMonth(monthOf(L));
    }

    /* ---------- far combaciare le tue missioni con i documenti ---------- */
    // Si chiama a ogni aggiornamento e, con l'app aperta, di continuo (insieme alle penalità).
    // Gli esiti (XP dati o tolti) si applicano solo quando non c'è una finestra aperta: MUI lo controlla.
    let fetching = {};
    const openL = L => L && !L.done && !L.failed;
    function evaluate() {
      if (!uidOf || uidOf !== me()) return;
      const now = serverNow();
      checkOrphans();
      Object.entries(docs).forEach(([sid, d]) => {
        let L = S.missions.find(m => m.sid === sid);
        if (!isV2(d)) return;   // documento non riconosciuto: si ignora
        const role = roleOf(d);
        if (!role) return;
        const out = outcome(d, now);
        // Chi ha creata la missione ce l'ha già nel suo elenco: se qui non c'è ancora (per esempio su un altro
        // dispositivo, prima che arrivi la sincronizzazione) non si fa niente e si aspetta.
        if (role === 'o' && !L) return;
        if (out === 'invite') {
          if (role === 'o') {
            // nessun amico dentro: se non c'è più nessuno invitato (tutti usciti o hanno rifiutato), l'invito è scaduto,
            // oppure la missione è già finita da sola, gli inviti non servono più
            const expired = d.dueAt != null && now >= d.dueAt;
            const none = !guests(d).length;
            if (none || L.done || L.failed || expired) {
              if (openL(L) && none) {
                if (d.oDone != null && !MUI().grantShared(L)) return;   // la tua parte vale (si riprova se ora non si può)
                MUI().missionMsg(T('sh.msg.released', { title: L.title }), '');
              }
              if (L.sid === sid) unlink(L);
              deleteDoc(sid);
            }
          } else if (openL(L)) dropLocal(L);   // non hai (ancora) accettato: l'accettazione non è andata a buon fine
          return;
        }
        if (out === 'wait') { refetch(sid); return; }
        if (out === 'release') {
          if (role === 'g') {
            if (openL(L)) { dropLocal(L); MUI().missionMsg(T(d.left ? 'sh.msg.exit.left' : 'sh.msg.exit.late', { title: L.title }), ''); }
          } else {
            if (openL(L) && d.oDone != null && !MUI().grantShared(L)) return;
            if (openL(L)) MUI().missionMsg(T('sh.msg.released', { title: L.title }), '');
            unlink(L);
            deleteDoc(sid);
          }
          return;
        }
        // gli invitati ricevono la missione nel loro elenco (anche già finita, se non avevano ancora visto l'esito)
        const seenMine = role === 'o' ? d.seenO : !!d.g[me()].s;
        if (!L && (out === 'open' || !seenMine)) L = addLocal(sid, d, role);
        if (!L) return;
        if (role === 'g' && openL(L)) syncContent(L, d);
        // i nomi degli altri restano nella missione: servono all'etichetta quando il documento non ci sarà più
        const names = otherNames(d);
        if (names.length && !same(L.shn, names)) { L.shn = names; touchMonth(monthOf(L)); }
        if (out === 'done' && openL(L)) {
          if (d._pw) return;   // aspetta che il server confermi
          if (!MUI().grantShared(L)) return;
        } else if (out === 'failed' && openL(L)) {
          if (d._pw) return;
          const f = failInfo(d);
          if (!MUI().failShared(L, f.kind, f.name)) return;
        }
        // esito applicato qui: lo si segna; quando l'hanno segnato tutti quelli che dovevano, il documento si elimina
        if ((out === 'done' || out === 'failed') && !d._pw) {
          if (!seenMine) {
            if (online()) update(sid, role === 'o' ? { seenO: true } : { [gPath('s')]: true }).catch(e => console.warn('shared seen', e && e.code, e));
          } else if (d.seenO && guests(d).filter(x => isActive(d, x)).every(x => x.s)) deleteDoc(sid);
        }
      });
      scheduleDue();
    }
    // Allo scoccare della prossima scadenza (ora del server) si ricontrolla subito, invece di aspettare
    // il controllo periodico: così la missione passa a "controllo in corso" e poi all'esito senza ritardi.
    let dueTimer = 0;
    function scheduleDue() {
      clearTimeout(dueTimer);
      const now = serverNow();
      const next = Object.values(docs).reduce((mn, d) => (d.dueAt != null && d.dueAt > now ? Math.min(mn, d.dueAt) : mn), Infinity);
      if (next === Infinity) return;
      dueTimer = setTimeout(() => { evaluate(); MUI().renderMissionViews(); }, Math.min(next - now + 50, 3600000));
    }
    // "created" decide in quale documento mensile finisce la missione: lo si ricava dal documento condiviso,
    // così tutti i tuoi dispositivi la mettono nello stesso mese (con todayStr() due dispositivi a cavallo
    // della fine del mese creerebbero due copie con lo stesso id in due mesi diversi)
    const createdOf = d => (Number.isFinite(d.created) && d.created > 0 ? isoDate(new Date(d.created)) : todayStr());
    function addLocal(sid, d, role) {
      if (role === 'g' && !d.g[me()].j) return null;
      if (S.missions.some(x => x.id === sid)) return null;
      const m = { id: sid, ...missionFields(d), created: createdOf(d), done: null, failed: null, sid, sh: role };
      const names = otherNames(d);
      if (names.length) m.shn = names;
      S.missions.push(m);
      touchMonth(monthOf(m));
      return m;
    }
    function syncContent(L, d) {
      const f = missionFields(d);
      if (Object.keys(f).every(k => same(L[k], f[k]))) return;
      Object.assign(L, f);
      touchMonth(monthOf(L));
    }
    // La chiamano tutti i partecipanti, e a ogni aggiornamento: si prova una volta sola alla volta.
    // Se un altro l'ha già eliminato, il server rifiuta: non importa, il documento sparisce comunque con l'ascolto.
    function deleteDoc(sid) {
      if (!online() || leaving.has(sid)) return;
      leaving.add(sid);
      ref(sid).delete()
        .then(() => { leaving.delete(sid); if (docs[sid]) { delete docs[sid]; gone(sid); saveCache(); MUI().renderMissionViews(); } })
        .catch(e => {
          leaving.delete(sid);
          // un altro partecipante l'ha già eliminato (o non ne fai più parte): è normale, non serve dirlo
          if (!e || (e.code !== 'permission-denied' && e.code !== 'not-found')) console.warn('shared delete', e && e.code, e);
        });
    }
    // Dopo la scadenza si chiede al server lo stato vero: appena i dati descrivono di sicuro un momento dopo la
    // scadenza (safeAfter), poi, se serve ancora, al massimo ogni 5 secondi per documento.
    const refetchT = {};
    function refetch(sid) {
      const d = docs[sid];
      if (!online() || !d || refetchT[sid]) return;
      const at = Math.max(safeAfter(d), (fetching[sid] || 0) + 5000);
      refetchT[sid] = setTimeout(() => { delete refetchT[sid]; fetchNow(sid); }, Math.max(0, at - Date.now()));
    }
    function fetchNow(sid) {
      if (!online()) return;
      const start = Date.now();   // i dati letti descrivono il server almeno da questo momento
      fetching[sid] = start;
      ref(sid).get({ source: 'server' }).then(x => {
        if (!x.exists) { delete docs[sid]; gone(sid); }
        else docs[sid] = { ...x.data(), _pw: false, _srv: Math.max(docs[sid] ? docs[sid]._srv || 0 : 0, start) };
        saveCache(); evaluate(); MUI().renderMissionViews();
      }).catch(e => {
        if (notMine(e)) { delete docs[sid]; gone(sid); saveCache(); MUI().renderMissionViews(); return; }
        console.warn('shared fetch', e);
      });
    }

    /* ---------- quello che serve alle schede delle missioni ---------- */
    // informazioni per disegnare la scheda di una missione condivisa (null se non lo è, o non si sa ancora)
    function info(m) {
      const d = docOf(m);
      if (!d || !isV2(d)) return null;
      const role = roleOf(d);
      if (!role) return null;
      const out = outcome(d);
      const u = me(), mine = role === 'g' ? d.g[u] : null;
      const joined = joinedOf(d);
      const anyJ = joined.length > 0;
      const others = [{ uid: d.owner, name: noname(d.ownerName), done: d.oDone != null, pend: false }]
        .concat(joined.map(x => ({ uid: x.uid, name: noname(x.n), done: x.d != null, pend: isPend(d, x) })))
        .filter(p => p.uid !== u);
      const invitedNames = guests(d).filter(x => !x.j).map(x => noname(x.n));
      let ownerWhen = '';
      if (role === 'g' && d.oDue && d.tz && d.tz !== myTz()) {
        ownerWhen = T('sh.ownertime', { when: MUI().fmtDay(d.oDue) + (d.oDueTime ? T('time.at', { time: d.oDueTime }) : ''), name: noname(d.ownerName) });
      }
      const doneOthers = others.filter(p => p.done && !p.pend).map(p => p.name);
      return {
        role, out, ownerWhen,
        // role 'o': c'è almeno un amico dentro; role 'g': hai accettato
        joined: role === 'o' ? anyJ : !!(mine && mine.j),
        // role 'o': ci sono solo inviti senza risposta
        invited: role === 'o' && !anyJ && invitedNames.length > 0,
        pending: isPend(d, mine),
        myDone: role === 'o' ? d.oDone != null : !!(mine && mine.d != null),
        name: joinNames(others.map(p => p.name)),                          // con chi (dentro la missione)
        invitedNames: joinNames(invitedNames), invitedCount: invitedNames.length,
        // chi manca: chi non ha fatto la sua parte (chi è in sospeso ha una riga sua, "devono ancora accettare…")
        waitingFor: joinNames(others.filter(p => !p.done && !p.pend).map(p => p.name)),
        doneNames: joinNames(doneOthers), doneCount: doneOthers.length,
        pendNames: joinNames(others.filter(p => p.pend).map(p => p.name)),
        // role 'o': quanti si possono togliere (inviti senza risposta + in sospeso)
        removable: role === 'o' ? guests(d).filter(x => !isActive(d, x)).length : 0,
        ownerName: noname(d.ownerName),
      };
    }
    // la missione è "tenuta" dalla condivisione: le penalità normali non la toccano (decide l'esito condiviso).
    // Vale anche se il documento non è ancora arrivato; non vale se ci sono solo inviti senza risposta.
    function holds(m) {
      if (!m.sid) return false;
      const d = docOf(m);
      return !d || joined(m);
    }
    function joined(m) {
      const d = docOf(m);
      if (!d || !isV2(d)) return false;
      const role = roleOf(d);
      return role === 'o' ? joinedOf(d).length > 0 : role === 'g' ? !!d.g[me()].j : false;
    }
    // "Invita" compare solo a chi ha fatto l'accesso: su una missione normale ancora da fare, oppure
    // (per chi l'ha creata) su una condivisa ancora aperta, con meno di 3 amici
    function canInvite(m) {
      if (!S.fbUser || m.rid || m.done || m.failed || MISSIONS.isLate(m)) return false;
      if (!m.sid) return true;
      const d = docOf(m);
      return !!(d && isV2(d) && roleOf(d) === 'o' && ['invite', 'open'].includes(outcome(d)) && guests(d).length < MAX_GUESTS);
    }
    // chi l'ha creata può modificarla, ma non dopo la scadenza (se è già condivisa) né quando è finita
    function editBlock(m) {
      if (!m.sid) return '';
      if (m.sh === 'g') return T('sh.err.guest');
      const d = docOf(m);
      if (!d || !isV2(d)) return T('sh.err.offline');   // senza il documento la modifica non arriverebbe agli amici
      if (isFinal(d)) return T('sh.err.final');
      if (joinedOf(d).length && d.dueAt != null && serverNow() >= d.dueAt) return T('sh.err.late');
      if (!online()) return T('sh.err.offline');
      return '';
    }
    // dopo una modifica di chi l'ha creata: il documento prende i valori nuovi (e, se cambiano le regole, una versione nuova)
    function afterEdit(m) {
      const d = docOf(m);
      if (!d || !isV2(d) || roleOf(d) !== 'o' || !online()) return;
      if (d.dueAt != null && serverNow() >= d.dueAt) return;   // inviti scaduti: si annullano da soli, non serve aggiornarli
      const f = fieldsOf(m);
      const rulesChanged = RULE_KEYS.some(k => !same(f[k], d[k]));
      const data = { ...f, ownerName: myName(), ver: rulesChanged ? d.ver + 1 : d.ver };
      write(() => update(m.sid, data));
      const j = joinedOf(d);
      if (rulesChanged && j.length) MUI().missionMsg(T('sh.msg.changed', { name: joinNames(j.map(x => noname(x.n))) }), '');
    }
    // eliminare una missione condivisa: se qualcuno ha già accettato, si può solo abbandonare.
    // Gli inviti ancora in attesa li annulla release(), prima di togliere la missione (vedi missions-ui.js)
    function beforeDelete(m) {
      const d = docOf(m);
      if (!m.sid) return '';
      if (!d && !m.done && !m.failed) return T('sh.err.offline');
      if (d && isV2(d) && joinedOf(d).length && !isFinal(d)) return T('sh.err.delete');
      return '';
    }
    const myName = () => String((S.settings && S.settings.name) || '').trim().slice(0, 30);
    // Missione con soli inviti in attesa, che chi l'ha creata completa da sola o elimina: prima si elimina il documento
    // sul server, e solo se ci riesce la missione torna solo sua. Se nel frattempo un amico ha accettato, le regole
    // rifiutano l'eliminazione (qualcuno è dentro): la missione resta di gruppo e lo si dice. Prima si faceva il
    // contrario (XP subito, eliminazione dopo) e l'amico appena entrato restava in una missione che nessuno avrebbe
    // più completato, fallendo alla scadenza.
    // true: la missione non è più collegata (o non lo era); false: resta condivisa (il motivo è già stato detto)
    async function release(m) {
      if (!m || !m.sid || m.done || m.failed) return true;   // finita: il documento (se c'è ancora) lo chiude l'esito
      const sid = m.sid, d = docOf(m);
      if (!d) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return false; }   // non si sa ancora a che punto è
      if (!isV2(d) || roleOf(d) !== 'o' || joinedOf(d).length) return false;
      if (!navigator.onLine || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return false; }
      leaving.add(sid);
      try { await ref(sid).delete(); }
      catch (e) {
        console.warn('shared release', e && e.code, e);
        // Il documento resta "in uscita" finché non arriva quello vero dal server: un aggiornamento in diretta
        // calcolato con l'eliminazione ancora in attesa lo darebbe per sparito, e la missione si scollegherebbe.
        ref(sid).get({ source: 'server' }).then(x => {
          leaving.delete(sid);
          if (x.exists) docs[sid] = { ...x.data(), _pw: false, _srv: Math.max(docs[sid] ? docs[sid]._srv || 0 : 0, Date.now() - LISTEN_LAG) };
          saveCache(); evaluate(); MUI().renderMissionViews();
        }).catch(() => { leaving.delete(sid); });
        MUI().missionMsg(T(e && e.code === 'permission-denied' ? 'sh.msg.joined.now' : errKey(e)), 'bad', true);
        sfx('err');
        return false;
      }
      leaving.delete(sid);
      delete docs[sid]; saveCache();
      if (m.sid === sid) unlink(m);
      return true;
    }
    // "Completa" con soli inviti in attesa: gli inviti si annullano e la missione si completa da sola
    async function completeSolo(id) {
      const m = byId(id);
      if (!(await release(m))) { MUI().renderMissionViews(); return; }
      if (S.missions.includes(m) && !m.sid) MUI().completeMission(id);
    }

    /* ---------- azioni sulle schede ---------- */
    const byId = id => S.missions.find(x => x.id === id);
    // la tua parte: chi l'ha creata usa oDone, gli amici la loro voce in g
    const partData = (d, v) => (roleOf(d) === 'o' ? { oDone: v } : { [gPath('d')]: v });
    function ready(m, d) {
      if (!m || !d || !isV2(d) || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return false; }
      return true;
    }
    async function completePart(id) {
      const m = byId(id), d = docOf(m);
      if (!ready(m, d)) return;
      if (!(await write(() => update(m.sid, partData(d, Date.now()))))) return;
      sfx('save');
      const dd = docs[m.sid] || d;
      if (!allDone(dd)) MUI().missionMsg(T('sh.msg.part', { title: m.title }), 'good');
    }
    async function undoPart(id) {
      const m = byId(id), d = docOf(m);
      if (!ready(m, d)) return;
      if (await write(() => update(m.sid, partData(d, null)))) { sfx('sub'); MUI().missionMsg(T('sh.msg.unpart', { title: m.title }), ''); }
    }
    async function abandon(id) {
      const m = byId(id), d = docOf(m);
      if (!ready(m, d)) return;
      if (await write(() => update(m.sid, { left: me() }))) sfx('del');
    }
    async function acceptChange(id) {
      const m = byId(id), d = docOf(m);
      // senza rete Firebase non conferma finché la connessione non torna: la scelta resterebbe "sospesa"
      if (!navigator.onLine || !ready(m, d)) { if (!navigator.onLine) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); } return; }
      if (await guestWrite(m.sid, { [gPath('a')]: d.ver }, d.ver)) { sfx('ok'); MUI().missionMsg(T('sh.msg.accepted.change', { title: m.title }), 'good'); }
    }
    // Le scelte dell'invitato (accettare, uscire) valgono per l'ultima versione della missione.
    // Se chi l'ha creata l'ha appena modificata e qui non era ancora arrivato, Firebase rifiuta:
    // si chiede al server la versione attuale e, se è cambiata, lo si dice chiaramente (e la scheda si aggiorna).
    async function guestWrite(sid, data, ver) {
      try { await update(sid, data); return true; }
      catch (e) {
        console.warn('shared', e && e.code, e);
        let why = errKey(e);
        try {
          const x = await ref(sid).get({ source: 'server' });
          if (x.exists) {
            if (x.data().ver !== ver) why = 'sh.msg.stale';
            docs[sid] = { ...x.data(), _pw: false, _srv: Math.max(docs[sid] ? docs[sid]._srv || 0 : 0, Date.now() - LISTEN_LAG) };
          } else {
            // l'invito non c'è più: chi l'ha creata l'ha annullato, oppure ha completato la missione da solo
            why = 'sh.msg.gone';
            delete docs[sid];
          }
          saveCache();
          MUI().renderMissionViews();
        } catch (e2) { /* senza rete: resta il messaggio generico */ }
        MUI().missionMsg(T(why), 'bad', true);
        sfx('err');
        return false;
      }
    }
    // l'invitato esce dalla missione (dopo una modifica, oppure rifiutando l'invito): nessun fallimento
    const leaveData = () => ({ [gPath()]: FV().delete(), members: FV().arrayRemove(me()) });
    async function exitChange(id) {
      const m = byId(id), d = docOf(m);
      // senza rete Firebase non conferma finché la connessione non torna: la scelta resterebbe "sospesa"
      if (!navigator.onLine || !ready(m, d)) { if (!navigator.onLine) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); } return; }
      const sid = m.sid;
      leaving.add(sid);
      const ok = await guestWrite(sid, leaveData(), d.ver);
      leaving.delete(sid);
      if (!ok) return;
      delete docs[sid]; saveCache();
      if (S.missions.includes(m)) dropLocal(m);
      sfx('close');
      MUI().missionMsg(T('sh.msg.exit', { title: m.title }), '');
      MUI().renderMissionViews();
    }
    // chi l'ha creata toglie chi non ha risposto: gli inviti senza risposta e chi è in sospeso (senza penalità per nessuno).
    // Chi è dentro con le regole attuali resta; se non resta nessuno, la missione torna solo sua.
    async function cancelInvite(id) {
      const m = byId(id), d = docOf(m);
      if (!m || !m.sid) return;
      if (!ready(m, d)) return;
      const sid = m.sid;
      const waiting = guests(d).filter(x => !isActive(d, x)).map(x => x.uid);
      if (!waiting.length) return;
      const removedNames = joinNames(guests(d).filter(x => waiting.includes(x.uid)).map(x => noname(x.n)));
      if (!joinedOf(d).length) {
        // nessuno dentro: il documento non serve più
        leaving.add(sid);
        const ok = await write(() => ref(sid).delete());
        leaving.delete(sid);
        if (!ok) return;
        delete docs[sid]; saveCache();
        unlink(m);
      } else {
        const data = { members: FV().arrayRemove(...waiting) };
        waiting.forEach(u => { data['g.' + u] = FV().delete(); });
        if (!(await write(() => update(sid, data)))) return;
        MUI().missionMsg(T('sh.msg.removed.by', { name: removedNames }), '');
      }
      sfx('close');
      MUI().renderMissionViews();
    }

    /* ---------- inviti ricevuti ---------- */
    function invites() {
      if (!uidOf || uidOf !== me()) return [];
      const now = serverNow();
      return Object.entries(docs)
        .filter(([, d]) => isV2(d) && roleOf(d) === 'g' && !d.g[me()].j && !d.left && !allDone(d) && !(d.dueAt != null && now >= d.dueAt))
        .map(([sid, d]) => ({
          sid, from: noname(d.ownerName),
          // gli altri invitati (dentro o in attesa), per sapere con chi sarà la missione
          others: joinNames(guests(d).filter(x => x.uid !== me()).map(x => noname(x.n))),
          m: { id: sid, ...missionFields(d), created: todayStr(), done: null, failed: null },
        }));
    }
    async function acceptInvite(sid) {
      const d = docs[sid];
      if (!d || !isV2(d) || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      if (!(await guestWrite(sid, { [gPath('j')]: true, [gPath('a')]: d.ver, [gPath('n')]: myName() }, d.ver))) return;
      sfx('ok');
      MUI().missionMsg(T('sh.msg.joined', { title: d.title }), 'good');
    }
    async function declineInvite(sid) {
      const d = docs[sid];
      if (!d || !isV2(d) || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      leaving.add(sid);
      try { await update(sid, leaveData()); leaving.delete(sid); }
      catch (e) {
        leaving.delete(sid);
        // se l'invito nel frattempo è stato annullato, rifiutarlo non serve più: sparisce e basta
        let gone = false;
        try { gone = !(await ref(sid).get({ source: 'server' })).exists; } catch (e2) { /* senza rete */ }
        if (!gone) { console.warn('shared', e && e.code, e); MUI().missionMsg(T(errKey(e)), 'bad', true); sfx('err'); return; }
      }
      delete docs[sid]; saveCache();
      sfx('close');
      MUI().renderMissionViews();
    }

    /* ---------- finestra "Invita amici" (per le missioni e, con shared-routines.js, per le routine) ---------- */
    // pickFriends(t) apre la finestra per un \"bersaglio\" t:
    //   t.id: che cosa (serve solo a capire se nel frattempo è stata aperta per altro)
    //   t.text: il testo in cima; t.full / t.allin: i messaggi \"già pieno\" e \"già tutti dentro\"
    //   t.inside(): gli uid già dentro (o invitati); t.slots(): i posti ancora liberi
    //   t.canSend(): si può ancora invitare?; t.send(chosen): invia, true se è andata bene
    const shmodal = $('shmodal');
    let target = null;
    const picked = new Set();
    function shMsg(t, kind) { const e = $('sh-msg'); e.textContent = t || ''; e.className = 'msg' + (kind ? ' ' + kind : ''); }
    function paintSend() {
      const b = $('sh-send');
      b.textContent = picked.size ? T('sh.send.n', { n: picked.size }) : T('sh.send');
      b.disabled = !picked.size;
    }
    async function pickFriends(t) {
      target = t;
      picked.clear();
      const list = $('sh-list');
      list.textContent = '';
      $('sh-text').textContent = t.text;
      shMsg('');
      $('sh-send').hidden = true;
      openModal(shmodal, $('sh-close'));
      if (!S.fbUser) { shMsg(T('sh.pick.noacc')); return; }
      if (!S.dbRef) { shMsg(T('fr.connecting')); await fbConnect(); if (!S.dbRef) { shMsg(T('fr.offline'), 'bad'); return; } }
      shMsg(T('fr.msg.wait'));
      try { await loadFriendsList(); } catch (e) { console.warn('shared friends', e); }
      if (shmodal.hidden || target !== t) return;
      const inside = t.inside();
      const slots = t.slots();
      const all = friendsList();
      const friends = all.filter(f => !inside.has(f.uid));
      if (!all.length) { shMsg(T('sh.pick.none')); return; }
      if (slots <= 0) { shMsg(t.full); return; }
      if (!friends.length) { shMsg(t.allin); return; }
      shMsg(TN('sh.pick.left', slots));
      friends.forEach(f => {
        const b = mk('button', 'fr-friend');
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.append(mk('span', 'fr-who', f.name || T('fr.noname')), mk('span', 'fr-lv', f.level != null ? T('lv') + ' ' + f.level : ''));
        b.setAttribute('aria-label', T('sh.pick.aria', { name: f.name || T('fr.noname') }));
        b.addEventListener('click', () => {
          if (picked.has(f.uid)) picked.delete(f.uid);
          else if (picked.size >= slots) { shMsg(TN('sh.pick.max', slots), 'bad'); sfx('err'); return; }
          else picked.add(f.uid);
          b.setAttribute('aria-pressed', picked.has(f.uid) ? 'true' : 'false');
          shMsg(TN('sh.pick.left', slots));
          paintSend();
        });
        list.appendChild(b);
      });
      $('sh-send').hidden = false;
      paintSend();
    }
    async function sendInvite() {
      const t = target;
      if (!t) return;
      const chosen = friendsList().filter(f => picked.has(f.uid));
      if (!chosen.length) { shMsg(T('sh.pick.sel'), 'bad'); sfx('err'); return; }
      if (!t.canSend() || chosen.length > t.slots()) { shMsg(T('sh.err.cannot'), 'bad'); sfx('err'); return; }
      // senza rete Firebase non conferma la scrittura finché la connessione non torna: meglio dirlo subito
      if (!navigator.onLine) { shMsg(T('fr.offline'), 'bad'); sfx('err'); return; }
      shMsg(T('fr.msg.wait'));
      $('sh-send').disabled = true;
      let ok = false;
      try { ok = await t.send(chosen); }
      catch (e) { console.warn('shared invite', e && e.code, e); shMsg(T(errKey(e)), 'bad'); sfx('err'); paintSend(); return; }
      if (!ok) { paintSend(); return; }
      if (!shmodal.hidden && target === t) closeModal();   // se nel frattempo l'hai chiusa (o ne hai aperta un'altra) non si tocca niente
      sfx('ok');
      MUI().renderMissionViews();
    }
    // l'amico appena invitato, come lo vuole il documento
    const guestEntry = f => ({ n: String(f.name || '').slice(0, 30), j: false, a: 0, d: null, s: false });

    // \"Invita\" su una missione
    const slotsFor = m => MAX_GUESTS - (m && m.sid && docOf(m) && isV2(docOf(m)) ? guests(docOf(m)).length : 0);
    function openInvite(id) {
      const t = {
        id, text: T('sh.pick.text'), full: T('sh.pick.full'), allin: T('sh.pick.allin'),
        inside: () => { const m = byId(id), d = m && m.sid ? docOf(m) : null; return new Set(d && isV2(d) ? guests(d).map(x => x.uid) : []); },
        slots: () => slotsFor(byId(id)),
        canSend: () => { const m = byId(id); return !!m && canInvite(m); },
        send: chosen => sendMission(byId(id), chosen),
      };
      return pickFriends(t);
    }
    async function sendMission(m, chosen) {
      const names = joinNames(chosen.map(f => f.name || T('fr.noname')));
      if (m.sid) {
        // missione già condivisa: si aggiungono i nuovi amici; vale come modifica (chi è dentro deve riaccettare)
        const d = docOf(m);
        const data = { members: FV().arrayUnion(...chosen.map(f => f.uid)), ver: FV().increment(1) };
        chosen.forEach(f => { data['g.' + f.uid] = guestEntry(f); });
        await update(m.sid, data);
        const j = d ? joinedOf(d) : [];
        if (j.length) MUI().missionMsg(T('sh.msg.changed', { name: joinNames(j.map(x => noname(x.n))) }), '');
      } else {
        const sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const now = Date.now();
        const data = {
          v: 2, owner: me(), ownerName: myName(), members: [me()].concat(chosen.map(f => f.uid)),
          g: Object.fromEntries(chosen.map(f => [f.uid, guestEntry(f)])),
          ...fieldsOf(m), ver: 1, oDone: null, left: '', seenO: false, created: now, updated: now,
        };
        // la missione si collega al documento PRIMA di scriverlo: l'aggiornamento in diretta arriva già durante la scrittura
        m.sid = sid; m.sh = 'o';
        docs[sid] = { ...data, _pw: true, _srv: 0 };
        try { await ref(sid).set(data); }
        catch (e) { delete m.sid; delete m.sh; delete docs[sid]; throw e; }
        saveCache();
        touchMonth(monthOf(m));
      }
      if (!m.sid || docs[m.sid]) MUI().missionMsg(T('sh.msg.sent', { name: names }), 'good');
      return true;
    }
    $('sh-send').addEventListener('click', sendInvite);
    $('sh-close').addEventListener('click', closeModal);
    shmodal.addEventListener('click', e => { if (e.target === shmodal) closeModal(); });

    return {
      start, reset, evaluate, info, holds, joined, canInvite, editBlock, afterEdit, beforeDelete,
      completePart, undoPart, abandon, acceptChange, exitChange, cancelInvite, openInvite, completeSolo, release,
      invites, acceptInvite, declineInvite, joinNames,
      // per shared-routines.js: la finestra "Invita amici" e l'amico come va scritto nel documento
      pickFriends, myName,
      // per le prove
      outcome, localDue, localFrom, failInfo,
    };
  }
  window.LIFE_RPG_SHARED = { create, MAX_GUESTS };
})();
