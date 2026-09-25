/*
 * Life RPG — missioni condivise con un amico
 * ---------------------------------------------------------------
 * Chi crea una missione può invitare un amico. Se l'amico accetta, la missione è di tutti e due:
 * - è superata quando la completate entrambi (gli XP arrivano a tutti e due in quel momento);
 * - fallisce per entrambi se uno dei due abbandona, oppure se alla scadenza non l'avete completata tutti e due;
 * - XP, penalità e scadenza li decide solo chi l'ha creata, che può modificarla quando vuole;
 *   se cambia XP, penalità o scadenza, l'amico sceglie "Accetta" oppure "Esci" (uscire così non è un fallimento).
 *
 * Come funziona:
 * - su Firebase c'è un documento condiviso, shared/{sid}, che leggono e scrivono solo i due giocatori
 *   (le regole di sicurezza controllano chi può cambiare cosa, e che nessuno completi dopo la scadenza);
 * - ognuno dei due ha anche una missione normale nel suo elenco, con sid (il documento) e sh (il ruolo:
 *   'o' = l'hai creata tu, 'g' = sei l'invitato). Così XP, penalità, calendario e sincronizzazione tra i tuoi
 *   dispositivi funzionano come per tutte le altre missioni;
 * - l'esito (superata, fallita) non lo scrive nessuno: ogni app lo ricava dal documento, allo stesso modo;
 * - la scadenza è un istante preciso (dueAt), valido per tutti e due anche con fusi orari diversi:
 *   ognuno la vede nella sua ora.
 *
 * Qui c'è la logica; le schede delle missioni le disegna missions-ui.js, che chiede qui le informazioni.
 *
 * Uso (in index.js):  const SH = window.LIFE_RPG_SHARED.create(D, S);
 */
(() => {
  'use strict';
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

    /* ---------- documenti condivisi: copia in memoria (sul dispositivo non si salva: lsSet la ignora) ---------- */
    // docs: { sid: dati del documento + _srv (ultima volta che il server l'ha confermato) + _pw (scritture in attesa) }
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
    const roleOf = d => (d.owner === me() ? 'o' : 'g');
    const partnerName = d => (roleOf(d) === 'o' ? d.guestName : d.ownerName) || T('fr.noname');

    /* ---------- l'esito, ricavato dal documento ---------- */
    // 'invite' (non ancora accettata), 'open', 'done', 'failed', 'release' (scaduta mentre l'amico doveva
    // ancora accettare una modifica: esce senza fallire), 'wait' (scaduta: si aspetta la conferma del server)
    const isPending = d => d.joined && d.gAcc !== d.ver;
    // margine per gli orologi dei dispositivi non perfettamente giusti: il fallimento per scadenza si decide
    // solo con dati del server arrivati almeno 2 minuti dopo la scadenza (secondo l'orologio di qui)
    const CLOCK_SKEW = 120000;
    const bothDone = d => d.oDone != null && d.gDone != null;
    function outcome(d, now = Date.now()) {
      if (!d.joined) return 'invite';
      if (d.left) return 'failed';
      if (bothDone(d) && !isPending(d)) return 'done';
      if (d.dueAt != null && now >= d.dueAt) {
        if (isPending(d)) return 'release';
        // il fallimento per scadenza si decide solo con dati del server arrivati dopo la scadenza:
        // un completamento dell'amico fatto in tempo potrebbe non essere ancora arrivato qui
        return (d._srv || 0) >= d.dueAt + CLOCK_SKEW && !d._pw ? 'failed' : 'wait';
      }
      return 'open';
    }
    const isFinal = d => { const o = outcome(d); return o === 'done' || o === 'failed' || o === 'release'; };

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
    // i campi della missione che arrivano dal documento (per l'invitato)
    function missionFields(d) {
      const rewards = normalizeRewards(d.rewards);
      return {
        title: String(d.title || '').slice(0, 60), desc: String(d.desc || '').slice(0, 500),
        rewards, penalty: normalizeRewards(d.penalty), stars: normalizeStars(rewards, d.stars),
        ...localDue(d.dueAt), ...localFrom(d.fromAt),
      };
    }
    const RULE_KEYS = ['rewards', 'penalty', 'dueAt'];   // cambiandoli, l'amico deve accettare di nuovo
    // confronto che non dipende dall'ordine delle chiavi: Firebase restituisce le mappe (rewards, penalty...)
    // con le chiavi in ordine alfabetico, mentre qui sono nell'ordine delle statistiche
    const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
    const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

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

    /* ---------- ascolto ---------- */
    function start() {
      if (!online() || listening) return;
      if (uidOf !== me()) loadCache(me());
      listening = true; serverSeen = false;
      unsub = S.fbDb.collection('shared').where('members', 'array-contains', me())
        .onSnapshot({ includeMetadataChanges: true }, onSnap, e => { console.warn('shared listen', e); listening = false; unsub = null; });
    }
    function reset() {
      if (unsub) { try { unsub(); } catch (e) { /* ignora */ } }
      unsub = null; listening = false; serverSeen = false;
      docs = {}; uidOf = ''; leaving.clear();
      try { localStorage.removeItem(LS_SHARED); } catch (e) { /* ignora */ }
    }
    function onSnap(qs) {
      const fromServer = !qs.metadata.fromCache, now = Date.now();
      const seen = new Set();
      qs.docs.forEach(x => {
        const prev = docs[x.id];
        const d = { ...x.data() };
        d._pw = x.metadata.hasPendingWrites;
        d._srv = fromServer ? now : (prev ? prev._srv || 0 : 0);
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
    // il documento non c'è più: la missione torna solo tua (se l'avevi creata tu) oppure sparisce (se eri l'invitato)
    function gone(sid) {
      const L = S.missions.find(m => m.sid === sid);
      if (!L || L.done || L.failed) return;   // le missioni finite restano nella cronologia, con la loro etichetta
      if (L.sh === 'o') { delete L.sid; delete L.sh; delete L.shn; touchMonth(monthOf(L)); }
      else dropLocal(L);
    }
    // Una missione ancora aperta collegata a un documento che qui non è mai arrivato (per esempio arrivata da un altro
    // dispositivo dopo che il documento era stato eliminato) resterebbe bloccata: non si completa, non fallisce e
    // non si elimina. Si chiede al server: se il documento non c'è davvero, la si sistema come per gone().
    function checkOrphans() {
      if (!serverSeen || !uidOf || uidOf !== me()) return;
      S.missions.forEach(m => { if (m.sid && !m.done && !m.failed && !docs[m.sid]) verifyMissing(m.sid); });
    }
    function verifyMissing(sid) {
      if (!online() || (fetching[sid] && Date.now() - fetching[sid] < 30000)) return;
      fetching[sid] = Date.now();
      ref(sid).get({ source: 'server' }).then(x => {
        if (x.exists || docs[sid]) return;   // c'è: arriva con l'ascolto
        gone(sid);
        MUI().renderMissionViews();
      }).catch(e => console.warn('shared check', e));
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
    function evaluate() {
      if (!uidOf || uidOf !== me()) return;
      const now = Date.now();
      checkOrphans();
      Object.entries(docs).forEach(([sid, d]) => {
        const role = roleOf(d);
        let L = S.missions.find(m => m.sid === sid);
        const out = outcome(d, now);
        // Chi ha creata la missione ce l'ha già nel suo elenco: se qui non c'è ancora (per esempio su un altro
        // dispositivo, prima che arrivi la sincronizzazione) non si fa niente e si aspetta.
        if (role === 'o' && !L) return;
        if (out === 'invite') {
          if (role === 'o') {
            // l'amico è uscito o ha rifiutato, l'invito è scaduto, oppure la missione è già finita da sola: l'invito non serve più
            const expired = d.dueAt != null && now >= d.dueAt;
            if (!d.guest || L.done || L.failed || expired) {
              if (!L.done && !L.failed && !d.guest) {
                if (d.oDone != null && !MUI().grantShared(L)) return;   // la tua parte vale (si riprova se ora non si può)
                MUI().missionMsg(T('sh.msg.released', { title: L.title }), '');
              }
              delete L.sid; delete L.sh; delete L.shn; touchMonth(monthOf(L));
              deleteDoc(sid);
            }
          } else if (L && !L.done && !L.failed) dropLocal(L);   // accettazione non andata a buon fine
          return;
        }
        if (out === 'wait') { refetch(sid, d); return; }
        if (out === 'release') {
          if (role === 'g') { if (L && !L.done && !L.failed) { dropLocal(L); MUI().missionMsg(T('sh.msg.exit.late', { title: L.title }), ''); } }
          else {
            if (!L.done && !L.failed && d.oDone != null && !MUI().grantShared(L)) return;
            if (!L.done && !L.failed) MUI().missionMsg(T('sh.msg.released', { title: L.title }), '');
            delete L.sid; delete L.sh; delete L.shn; touchMonth(monthOf(L));
            deleteDoc(sid);
          }
          return;
        }
        const seenKey = role === 'o' ? 'seenO' : 'seenG';
        // l'invitato riceve la missione nel suo elenco (anche già finita, se non l'aveva ancora vista)
        if (!L && (out === 'open' || !d[seenKey])) L = addLocal(sid, d, role);
        if (!L) return;
        if (role === 'g' && !L.done && !L.failed) syncContent(L, d);
        // il nome dell'amico resta nella missione: serve all'etichetta quando il documento non ci sarà più
        const pn = String((role === 'o' ? d.guestName : d.ownerName) || '').trim().slice(0, 30);
        if (d.joined && pn && L.shn !== pn) { L.shn = pn; touchMonth(monthOf(L)); }
        if (out === 'done' && !L.done && !L.failed) {
          if (d._pw) return;   // aspetta che il server confermi
          if (!MUI().grantShared(L)) return;
        } else if (out === 'failed' && !L.done && !L.failed) {
          if (d._pw) return;
          // perché è fallita: qualcuno ha abbandonato, oppure alla scadenza mancava la tua parte, quella dell'amico o entrambe
          const myDone = role === 'o' ? d.oDone != null : d.gDone != null;
          const partnerDone = role === 'o' ? d.gDone != null : d.oDone != null;
          const kind = d.left ? (d.left === me() ? 'me' : 'friend') : myDone ? 'theirs' : partnerDone ? 'mine' : 'both';
          if (!MUI().failShared(L, kind, partnerName(d))) return;
        }
        // esito applicato qui: lo si segna; quando l'hanno segnato entrambi, il documento si elimina
        if ((out === 'done' || out === 'failed') && !d._pw) {
          if (!d[seenKey]) { if (online()) update(sid, { [seenKey]: true }).catch(e => console.warn('shared seen', e)); }
          else if (d.seenO && d.seenG) deleteDoc(sid);
        }
      });
    }
    // "created" decide in quale documento mensile finisce la missione: lo si ricava dal documento condiviso,
    // così tutti i tuoi dispositivi la mettono nello stesso mese (con todayStr() due dispositivi a cavallo
    // della fine del mese creerebbero due copie con lo stesso id in due mesi diversi)
    const createdOf = d => (Number.isFinite(d.created) && d.created > 0 ? isoDate(new Date(d.created)) : todayStr());
    function addLocal(sid, d, role) {
      const m = { id: sid, ...missionFields(d), created: createdOf(d), done: null, failed: null, sid, sh: role };
      const pn = String((role === 'o' ? d.guestName : d.ownerName) || '').trim().slice(0, 30);
      if (pn) m.shn = pn;
      if (S.missions.some(x => x.id === sid)) return null;
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
    // La chiamano tutti e due i giocatori, e a ogni aggiornamento: si prova una volta sola alla volta.
    // Se l'altro l'ha già eliminato, il server rifiuta: non importa, il documento sparisce comunque con l'ascolto.
    function deleteDoc(sid) {
      if (!online() || leaving.has(sid)) return;
      leaving.add(sid);
      ref(sid).delete()
        .then(() => { leaving.delete(sid); if (docs[sid]) { delete docs[sid]; gone(sid); saveCache(); MUI().renderMissionViews(); } })
        .catch(e => { leaving.delete(sid); console.warn('shared delete', e && e.code, e); });
    }
    // dopo la scadenza si chiede al server lo stato vero (al massimo ogni 30 secondi per documento)
    function refetch(sid, d) {
      if (!online() || (fetching[sid] && Date.now() - fetching[sid] < 30000)) return;
      fetching[sid] = Date.now();
      ref(sid).get({ source: 'server' }).then(x => {
        if (!x.exists) { delete docs[sid]; gone(sid); }
        else docs[sid] = { ...x.data(), _pw: false, _srv: Date.now() };
        saveCache(); evaluate(); MUI().renderMissionViews();
      }).catch(e => console.warn('shared fetch', e));
    }

    /* ---------- quello che serve alle schede delle missioni ---------- */
    // informazioni per disegnare la scheda di una missione condivisa (null se non lo è, o non si sa ancora)
    function info(m) {
      const d = docOf(m);
      if (!d) return null;
      const role = roleOf(d), out = outcome(d);
      const myDone = role === 'o' ? d.oDone != null : d.gDone != null;
      const partnerDone = role === 'o' ? d.gDone != null : d.oDone != null;
      let ownerWhen = '';
      if (role === 'g' && d.oDue && d.tz && d.tz !== myTz()) {
        ownerWhen = T('sh.ownertime', { when: MUI().fmtDay(d.oDue) + (d.oDueTime ? T('time.at', { time: d.oDueTime }) : ''), name: d.ownerName || T('fr.noname') });
      }
      return {
        role, out, name: partnerName(d), joined: !!d.joined, invited: !d.joined && role === 'o' && !!d.guest,
        myDone, partnerDone, pending: role === 'g' && isPending(d), ownerWhen,
      };
    }
    // la missione è "tenuta" dalla condivisione: le penalità normali non la toccano (decide l'esito condiviso).
    // Vale anche se il documento non è ancora arrivato; non vale per un invito non ancora accettato.
    function holds(m) {
      if (!m.sid) return false;
      const d = docOf(m);
      return !d || !!d.joined;
    }
    const joined = m => { const d = docOf(m); return !!(d && d.joined); };
    // "Invita" compare solo a chi ha fatto l'accesso, su una missione normale ancora da fare
    function canInvite(m) {
      return !!S.fbUser && !m.sid && !m.rid && !m.done && !m.failed && !MISSIONS.isLate(m);
    }
    // chi l'ha creata può modificarla, ma non dopo la scadenza (se è già condivisa) né quando è finita
    function editBlock(m) {
      if (!m.sid) return '';
      if (m.sh === 'g') return T('sh.err.guest');
      const d = docOf(m);
      if (!d) return T('sh.err.offline');   // senza il documento la modifica non arriverebbe all'amico
      if (isFinal(d)) return T('sh.err.final');
      if (d.joined && d.dueAt != null && Date.now() >= d.dueAt) return T('sh.err.late');
      if (!online()) return T('sh.err.offline');
      return '';
    }
    // dopo una modifica di chi l'ha creata: il documento prende i valori nuovi (e, se cambiano le regole, una versione nuova)
    function afterEdit(m) {
      const d = docOf(m);
      if (!d || roleOf(d) !== 'o' || !online()) return;
      if (d.dueAt != null && Date.now() >= d.dueAt) return;   // invito scaduto: si annulla da solo, non serve aggiornarlo
      const f = fieldsOf(m);
      const rulesChanged = RULE_KEYS.some(k => !same(f[k], d[k]));
      const data = { ...f, ownerName: myName(), ver: rulesChanged ? d.ver + 1 : d.ver };
      write(() => update(m.sid, data));
      if (rulesChanged && d.joined) MUI().missionMsg(T('sh.msg.changed', { name: partnerName(d) }), '');
    }
    // eliminare una missione condivisa: un invito si annulla; se l'amico ha già accettato, si può solo abbandonare
    // checkOnly: solo il controllo (al primo tocco su "Elimina"), senza annullare ancora l'invito
    function beforeDelete(m, checkOnly) {
      const d = docOf(m);
      if (!m.sid) return '';
      if (!d && !m.done && !m.failed) return T('sh.err.offline');
      if (d && d.joined && !isFinal(d)) return T('sh.err.delete');
      if (!checkOnly && d && !d.joined && roleOf(d) === 'o') deleteDoc(m.sid);
      return '';
    }
    const myName = () => String((S.settings && S.settings.name) || '').trim().slice(0, 30);

    /* ---------- azioni sulle schede ---------- */
    const byId = id => S.missions.find(x => x.id === id);
    async function completePart(id) {
      const m = byId(id), d = docOf(m);
      if (!m || !d || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      const key = roleOf(d) === 'o' ? 'oDone' : 'gDone';
      const ok = await write(() => update(m.sid, { [key]: Date.now() }));
      if (!ok) return;
      sfx('save');
      const partnerDone = roleOf(d) === 'o' ? d.gDone != null : d.oDone != null;
      if (!partnerDone) MUI().missionMsg(T('sh.msg.part', { title: m.title, name: partnerName(d) }), 'good');
    }
    async function undoPart(id) {
      const m = byId(id), d = docOf(m);
      if (!m || !d || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      const key = roleOf(d) === 'o' ? 'oDone' : 'gDone';
      if (await write(() => update(m.sid, { [key]: null }))) { sfx('sub'); MUI().missionMsg(T('sh.msg.unpart', { title: m.title }), ''); }
    }
    async function abandon(id) {
      const m = byId(id), d = docOf(m);
      if (!m || !d || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      if (await write(() => update(m.sid, { left: me() }))) sfx('del');
    }
    async function acceptChange(id) {
      const m = byId(id), d = docOf(m);
      // senza rete Firebase non conferma finché la connessione non torna: la scelta resterebbe "sospesa"
      if (!m || !d || !online() || !navigator.onLine) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      if (await acceptVersion(m.sid, { gAcc: d.ver }, d.ver)) { sfx('ok'); MUI().missionMsg(T('sh.msg.accepted.change', { title: m.title }), 'good'); }
    }
    // Accettare vale solo per l'ultima versione della missione (lo controllano le regole di Firebase).
    // Se chi l'ha creata l'ha appena modificata e qui non era ancora arrivato, Firebase rifiuta:
    // si chiede al server la versione attuale e, se è cambiata, lo si dice chiaramente (e la scheda si aggiorna).
    async function acceptVersion(sid, data, ver) {
      try { await update(sid, data); return true; }
      catch (e) {
        console.warn('shared', e);
        let why = errKey(e);
        try {
          const x = await ref(sid).get({ source: 'server' });
          // diagnosi: chi scrive, cosa manda e com'è il documento sul server in quel momento
          const auth = window.firebase && firebase.auth && firebase.auth().currentUser;
          console.warn('shared diag', JSON.stringify({
            code: e && e.code, me: me(), authUid: auth ? auth.uid : null, sid, sent: data,
            server: x.exists ? x.data() : null,
          }, null, 1));
          if (x.exists) {
            if (x.data().ver !== ver) why = 'sh.msg.stale';
            docs[sid] = { ...x.data(), _pw: false, _srv: Date.now() };
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
    const leaveData = d => ({ guest: '', guestName: '', members: [d.owner], joined: false, gAcc: 0, gDone: null });
    async function exitChange(id) {
      const m = byId(id), d = docOf(m);
      // senza rete Firebase non conferma finché la connessione non torna: la scelta resterebbe "sospesa"
      if (!m || !d || !online() || !navigator.onLine) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      const sid = m.sid;
      leaving.add(sid);
      const ok = await acceptVersion(sid, leaveData(d), d.ver);
      leaving.delete(sid);
      if (!ok) return;
      delete docs[sid]; saveCache();
      if (S.missions.includes(m)) dropLocal(m);
      sfx('close');
      MUI().missionMsg(T('sh.msg.exit', { title: m.title }), '');
      MUI().renderMissionViews();
    }
    async function cancelInvite(id) {
      const m = byId(id);
      if (!m || !m.sid) return;
      const sid = m.sid;
      if (!online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      leaving.add(sid);
      const ok = await write(() => ref(sid).delete());
      leaving.delete(sid);
      if (!ok) return;
      delete docs[sid]; saveCache();
      delete m.sid; delete m.sh; delete m.shn;
      touchMonth(monthOf(m));
      sfx('close');
      MUI().renderMissionViews();
    }

    /* ---------- inviti ricevuti ---------- */
    function invites() {
      if (!uidOf || uidOf !== me()) return [];
      const now = Date.now();
      return Object.entries(docs)
        .filter(([, d]) => !d.joined && d.guest === me() && roleOf(d) === 'g' && !(d.dueAt != null && now >= d.dueAt))
        .map(([sid, d]) => ({ sid, from: d.ownerName || T('fr.noname'), m: { id: sid, ...missionFields(d), created: todayStr(), done: null, failed: null } }));
    }
    async function acceptInvite(sid) {
      const d = docs[sid];
      if (!d || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      if (!(await acceptVersion(sid, { joined: true, gAcc: d.ver, guestName: myName() }, d.ver))) return;
      sfx('ok');
      MUI().missionMsg(T('sh.msg.joined', { title: d.title }), 'good');
    }
    async function declineInvite(sid) {
      const d = docs[sid];
      if (!d || !online()) { MUI().missionMsg(T('sh.err.offline'), 'bad', true); sfx('err'); return; }
      leaving.add(sid);
      try { await update(sid, leaveData(d)); leaving.delete(sid); }
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

    /* ---------- finestra "Invita un amico" ---------- */
    const shmodal = $('shmodal');
    let inviteFor = '';
    function shMsg(t, kind) { const e = $('sh-msg'); e.textContent = t || ''; e.className = 'msg' + (kind ? ' ' + kind : ''); }
    async function openInvite(id) {
      inviteFor = id;
      const list = $('sh-list');
      list.textContent = '';
      shMsg('');
      openModal(shmodal, $('sh-close'));
      if (!S.fbUser) { shMsg(T('sh.pick.noacc')); return; }
      if (!S.dbRef) { shMsg(T('fr.connecting')); await fbConnect(); if (!S.dbRef) { shMsg(T('fr.offline'), 'bad'); return; } }
      shMsg(T('fr.msg.wait'));
      try { await loadFriendsList(); } catch (e) { console.warn('shared friends', e); }
      if (shmodal.hidden || inviteFor !== id) return;
      const friends = friendsList();
      shMsg(friends.length ? '' : T('sh.pick.none'));
      friends.forEach(f => {
        const b = mk('button', 'fr-friend');
        b.type = 'button';
        b.append(mk('span', 'fr-who', f.name || T('fr.noname')), mk('span', 'fr-lv', f.level != null ? T('lv') + ' ' + f.level : ''));
        b.setAttribute('aria-label', T('sh.pick.aria', { name: f.name || T('fr.noname') }));
        b.addEventListener('click', () => sendInvite(id, f));
        list.appendChild(b);
      });
    }
    async function sendInvite(id, f) {
      const m = byId(id);
      if (!m || !canInvite(m)) { shMsg(T('sh.err.cannot'), 'bad'); sfx('err'); return; }
      // senza rete Firebase non conferma la scrittura finché la connessione non torna: meglio dirlo subito
      if (!navigator.onLine) { shMsg(T('fr.offline'), 'bad'); sfx('err'); return; }
      const sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const now = Date.now();
      const data = {
        owner: me(), ownerName: myName(), guest: f.uid, guestName: String(f.name || '').slice(0, 30), members: [me(), f.uid], joined: false,
        ...fieldsOf(m), ver: 1, gAcc: 0, oDone: null, gDone: null, left: '', seenO: false, seenG: false, created: now, updated: now,
      };
      shMsg(T('fr.msg.wait'));
      // la missione si collega al documento PRIMA di scriverlo: l'aggiornamento in diretta arriva già durante la scrittura
      m.sid = sid; m.sh = 'o';
      docs[sid] = { ...data, _pw: true, _srv: 0 };
      try { await ref(sid).set(data); }
      catch (e) {
        console.warn('shared invite', e);
        delete m.sid; delete m.sh; delete docs[sid];
        shMsg(T('sh.msg.err'), 'bad'); sfx('err'); return;
      }
      saveCache();
      touchMonth(monthOf(m));
      if (!shmodal.hidden) closeModal();   // se nel frattempo l'hai chiusa (o ne hai aperta un'altra) non si tocca niente
      sfx('ok');
      MUI().missionMsg(T('sh.msg.sent', { name: f.name || T('fr.noname') }), 'good');
      MUI().renderMissionViews();
    }
    $('sh-close').addEventListener('click', closeModal);
    shmodal.addEventListener('click', e => { if (e.target === shmodal) closeModal(); });

    return {
      start, reset, evaluate, info, holds, joined, canInvite, editBlock, afterEdit, beforeDelete,
      completePart, undoPart, abandon, acceptChange, exitChange, cancelInvite, openInvite,
      invites, acceptInvite, declineInvite,
      // per le prove
      outcome, localDue, localFrom,
    };
  }
  window.LIFE_RPG_SHARED = { create };
})();
