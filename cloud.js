/*
 * Life RPG — account e sincronizzazione (il "motore")
 * ---------------------------------------------------------------
 * Qui c'è tutto quello che collega questo dispositivo al tuo account (Firebase):
 * - scrivere le modifiche nell'account (XP, missioni mese per mese, routine, impostazioni), in transazioni
 *   che uniscono quello che c'è già con quello di questo dispositivo; riprovare dopo un errore;
 * - ascoltare in diretta gli aggiornamenti degli altri dispositivi e unirli ai dati di qui;
 * - caricare Firebase, accedere e uscire, la schermata di accesso (senza account il gioco non si apre);
 * - i dati stanno solo nell'account: sul dispositivo non si salva niente (vedi lsSet in index.js);
 * - il riquadro Account nella scheda Dati delle impostazioni e l'avvio della connessione.
 *
 * Le REGOLE dell'unione (chi vince, lapidi, registro degli XP) sono in sync.js.
 * I DATI restano in index.js, che ne è il proprietario: XP, missioni, routine, impostazioni, lo stato
 * della sincronizzazione (sync) e dell'account. Questo file li legge e li cambia attraverso ST, sempre
 * nella versione di adesso (ST.xp, ST.missions, ST.sync, ST.fbUser...).
 *
 * Uso (in index.js):  const CLOUD = window.LIFE_RPG_CLOUD.create(D, ST);
 */
(() => {
  'use strict';
  function create(D, ST) {
    const {
      T, TN, STATS, levelFromXp, overallOf, blank, normalize, SYNC, normDel, rawOf, clampXp, mergeItems, monthOf,
      normalizeMissions, normalizeRoutines, fmt, saveLocal, hasProgress, defaultSettings, saveSettingsLocal, isDefaultSettings,
      mergeSettings, IMG_NAMES, CLOUD_IMG_MAX, validImg, imgs, imgTouched, saveImgLocal, imagesInit, saveMissionsLocal,
      saveRoutinesLocal, setSaveState, lsSet, blankSync, DEV, absorbLocal, recomputeXp, hasPend, saveSync, missionSig,
      routineSig, seenOf, mSeen, rSeen, sfx, musicSync, $, render, openModal, closeModal, applyImages, cs, paintCustom,
      applyAll, imgQueue, flushImgs, monthQueue, flushMissions, touchMonth, MUI, checkPenalties, renderMissionViews, rmodal,
      renderRoutines, renderInfo, schedulePublish, friendsReset, checkFriendRequests, LS_ACC, sharedStart, sharedReset,
      wipeLocalData, clearDeviceData, discardLocal, syncBusy,
    } = D;

    function stampRoutines() {
      const now = Date.now();
      ST.routines.forEach(r => { const g = routineSig(r); if (rSeen.get(r.id) !== g) { r.u = Math.max(now, (r.u || 0) + 1); rSeen.set(r.id, g); } });
    }
    // missioni o routine eliminate da te: la lapide impedisce che tornino da un altro dispositivo
    function tombMissions(list) {
      const now = Date.now();
      list.forEach(m => {
        const ym = monthOf(m), x = { t: now };
        if (m.c) x.c = m.c;
        if (m.z) x.z = m.z;
        (ST.sync.mDel[ym] = ST.sync.mDel[ym] || {})[m.id] = x;
        mSeen.delete(m.id);
      });
      saveSync();
    }
    function tombRoutine(id) { ST.sync.rDel[id] = { t: Date.now() }; rSeen.delete(id); saveSync(); }

    // porta dentro questo dispositivo il contenuto di un mese dell'account (R, lapidi rDel).
    // Se una tua versione ha perso, si annulla la parte di XP che il registro vincente non ti riconosce.
    function mergeMonth(ym, R, rDel) {
      const L = ST.missions.filter(m => monthOf(m) === ym);
      const res = SYNC.mergeReport(L, ST.sync.mDel[ym] || {}, R, rDel, missionSig, DEV);
      const { comp, changed, dirty } = res;
      if (Object.keys(res.del).length) ST.sync.mDel[ym] = res.del; else delete ST.sync.mDel[ym];
      if (changed) {
        ST.missions = ST.missions.filter(m => monthOf(m) !== ym).concat(res.items);
        L.forEach(m => { if (!res.info.get(m.id).w) mSeen.delete(m.id); });
        res.items.forEach(m => { const i = res.info.get(m.id); if (i.w !== i.l) mSeen.set(m.id, seenOf(m)); });
        saveMissionsLocal();
      }
      const fix = STATS.filter(s => comp[s.key]);
      let xpCh = false;
      if (fix.length) {
        absorbLocal();
        fix.forEach(s => { ST.sync.pend[s.key] += comp[s.key]; });
        xpCh = recomputeXp();
        saveLocal();
      }
      saveSync();
      if (dirty) monthQueue.add(ym);
      return { changed, xpChanged: fix.length > 0 || xpCh };
    }

    // porta dentro le routine dell'account
    function mergeRoutinesIn(R, rDel) {
      const res = SYNC.mergeReport(ST.routines, ST.sync.rDel, R, rDel, routineSig);
      const { changed, dirty, gone } = res;
      ST.sync.rDel = res.del;
      if (changed) {
        ST.routines = res.items;
        rSeen.clear(); ST.routines.forEach(r => rSeen.set(r.id, routineSig(r)));
        ST.routinesApplying = true; saveRoutinesLocal(); ST.routinesApplying = false;
        // routine eliminata su un altro dispositivo: le sue volte ancora da fare spariscono anche qui
        if (gone.length) {
          const drop = ST.missions.filter(m => gone.includes(m.rid) && !m.done && !m.failed);
          if (drop.length) {
            const months = new Set(drop.map(monthOf));
            tombMissions(drop);
            ST.missions = ST.missions.filter(m => !drop.includes(m));
            months.forEach(touchMonth);
          }
        }
      }
      saveSync();
      return { changed, dirty };
    }

    // applica il documento del giocatore arrivato dall'account.
    // sent: ciò che questo dispositivo ha appena scritto (dopo una scrittura riuscita); force: al collegamento
    function applyUserDoc(d, sent, force) {
      const rev = Number(d.rev) || 0;
      let xpChanged = false;
      if (sent || force || rev > ST.sync.rev) {
        absorbLocal();
        // ciò che è appena stato scritto non è più "da mandare"
        if (sent) STATS.forEach(s => { ST.sync.pend[s.key] -= sent.pend[s.key]; });
        ST.sync.xpBase = rawOf(d);
        xpChanged = recomputeXp();
        ST.sync.rev = Math.max(ST.sync.rev, rev);
        saveLocal();
      }
      const rr = mergeRoutinesIn(normalizeRoutines(d.routines), normDel(d.rDel));
      // impostazioni: vince la modifica più recente; a parità (anche dati di versioni precedenti) vince l'account
      const rsAt = Number(d.sAt) || 0;
      let setDirty = false;
      if (d.settings && typeof d.settings === 'object') {
        if (rsAt >= ST.sync.sAt) {
          const s = mergeSettings(d.settings);
          ST.sync.sAt = rsAt;
          if (JSON.stringify(s) !== JSON.stringify(ST.settings)) {
            ST.settings = s;
            saveSettingsLocal();
            applyAll();
            paintCustom();
          }
        } else setDirty = true;
      } else if (!isDefaultSettings() || ST.sync.sAt) setDirty = true;
      saveSync();
      return { xpChanged, routinesChanged: rr.changed, dirty: rr.dirty || setDirty };
    }

    // legge, unisce e riscrive un documento in modo sicuro, in una transazione
    // (se nel frattempo un altro dispositivo lo cambia, si rifà da capo)
    async function txDoc(ref, make) {
      await ST.fbDb.runTransaction(async t => {
        const snap = await t.get(ref);
        t.set(ref, make(snap.exists ? snap.data() : null));
      });
    }

    // se la scrittura non riesce si riprova da soli: subito quando torna la rete, altrimenti dopo un po'
    let retryT = 0, retryMs = 15000, userDirty = false;
    function syncFail(e) {
      console.warn('sync', e);
      const offline = !navigator.onLine || (e && (e.code === 'unavailable' || e.code === 'deadline-exceeded'));
      setSaveState(offline ? 'offline' : 'error');   // senza rete non è un errore: si salva sul dispositivo e si manda dopo
      clearTimeout(retryT);
      retryT = setTimeout(syncKick, retryMs);
      retryMs = Math.min(retryMs * 2, 300000);
    }
    function syncOk() { retryMs = 15000; setSaveState('account'); }
    function syncKick() {
      if (!ST.dbRef) return;
      if (userDirty) flush();
      if (monthQueue.size) flushMissions();
      if (imgQueue.size) flushImgs();
    }

    // documento del giocatore: XP (come differenza), routine e impostazioni
    async function flush() {
      if (!ST.dbRef) return;
      userDirty = true;
      if (ST.writing) { ST.again = true; return; }
      ST.writing = true;
      stampRoutines();
      absorbLocal();
      const sent = { xs: { ...ST.xp }, pend: { ...ST.sync.pend }, abs: ST.xpAbs };
      let out = null;
      try {
        await txDoc(ST.dbRef, cur => {
          const d = cur || {};
          const xr = SYNC.nextRaw(rawOf(d), sent.pend, sent.abs, sent.xs), nx = {};
          STATS.forEach(s => { nx[s.key] = clampXp(xr[s.key]); });
          const rr = mergeItems(ST.routines, ST.sync.rDel, normalizeRoutines(d.routines), normDel(d.rDel), routineSig);
          const rs = d.settings && typeof d.settings === 'object' ? mergeSettings(d.settings) : null, rsAt = Number(d.sAt) || 0;
          const mine = !rs || ST.sync.sAt > rsAt;
          out = { v: 2, rev: (Number(d.rev) || 0) + 1, xp: nx, xr, settings: mine ? ST.settings : rs, sAt: mine ? ST.sync.sAt : rsAt, routines: rr.items, rDel: rr.del };
          return JSON.parse(JSON.stringify(out));
        });
        userDirty = false;
        if (sent.abs && ST.xpAbs === sent.abs) ST.xpAbs = 0;
        const r = applyUserDoc(JSON.parse(JSON.stringify(out)), sent);
        if (r.dirty) ST.again = true;
        syncOk();
        if (r.xpChanged || r.routinesChanged) afterRemote(r.routinesChanged);
      } catch (e) { syncFail(e); }
      ST.writing = false;
      if (ST.deferredUser) { const d = ST.deferredUser; ST.deferredUser = null; onUserSnap(d); }
      if (ST.again) { ST.again = false; flush(); }
    }
    function persist() { saveLocal(); flush(); }

    // dopo un aggiornamento arrivato da un altro dispositivo: si ridisegna ciò che serve
    function afterRemote(missionsToo) {
      render(false);
      if (missionsToo) renderMissionViews();
      if (!rmodal.hidden) renderRoutines();
    }
    function onUserSnap(d) {
      if (ST.writing) { if (!ST.deferredUser || (Number(d.rev) || 0) >= (Number(ST.deferredUser.rev) || 0)) ST.deferredUser = d; return; }
      const r = applyUserDoc(d, null);
      if (r.dirty) flush();
      if (r.xpChanged || r.routinesChanged) afterRemote(r.routinesChanged);
    }

    // aggiornamenti in diretta dall'account: documento del giocatore, missioni, immagini
    let unsubs = [];
    function stopListening() { unsubs.forEach(f => { try { f(); } catch (e) { /* ignora */ } }); unsubs = []; }
    function startListening() {
      stopListening();
      if (!ST.dbRef) return;
      const ref = ST.dbRef;
      const err = e => console.warn('listen', e);
      unsubs.push(ref.onSnapshot(s => {
        if (ST.dbRef !== ref || !s.exists || s.metadata.hasPendingWrites) return;
        onUserSnap(s.data());
      }, err));
      unsubs.push(ref.collection('m').onSnapshot(qs => {
        if (ST.dbRef !== ref) return;
        let any = false, xpAny = false;
        qs.docChanges().forEach(ch => {
          if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites || !/^\d{4}-\d{2}$/.test(ch.doc.id)) return;
          const x = ch.doc.data() || {};
          const r = mergeMonth(ch.doc.id, normalizeMissions(x.items).filter(m => monthOf(m) === ch.doc.id), normDel(x.del));
          any = any || r.changed; xpAny = xpAny || r.xpChanged;
        });
        if (xpAny) persist();
        if (any || xpAny) { render(false); renderMissionViews(); }
        if (monthQueue.size) flushMissions();
      }, err));
      unsubs.push(ref.collection('imgs').onSnapshot(qs => {
        if (ST.dbRef !== ref) return;
        let any = false;
        qs.docChanges().forEach(ch => {
          const n = ch.doc.id;
          if (!IMG_NAMES.includes(n) || imgQueue.has(n) || ch.doc.metadata.hasPendingWrites) return;
          const raw = ch.type === 'removed' ? null : (ch.doc.data() || {}).data;
          const v = validImg(raw) ? raw : null;
          if (!v && imgs[n] && imgs[n].length > CLOUD_IMG_MAX) return;   // immagine troppo grande per l'account: resta questa
          if (imgs[n] !== v) { imgs[n] = v; saveImgLocal(n); any = true; }
        });
        if (any) { applyImages(); if (cs.Vigore) paintCustom(); }
      }, err));
    }

    /* ================= account (Firebase) ================= */
    // Accesso con Google e salvataggio nel database Firestore del progetto "life-rpg".
    // Questi valori non sono segreti: finiscono comunque nel codice pubblico dell'app.
    // Chi può leggere o scrivere cosa lo decidono le regole di sicurezza su Firebase.
    const FIREBASE_CONFIG = {
      apiKey: 'AIzaSyBUytbsbm5MH1lUttO9Cbw8ILAH2DRF1qM',
      authDomain: 'life-rpg-1a118.firebaseapp.com',
      projectId: 'life-rpg-1a118',
      storageBucket: 'life-rpg-1a118.firebasestorage.app',
      messagingSenderId: '742342774863',
      appId: '1:742342774863:web:ee6e00c69eae4da001da3a',
    };
    // l'accesso funziona solo da un indirizzo web (https o localhost), non aprendo il file dal dispositivo
    function fbUsable() { return location.protocol === 'https:' || location.hostname === 'localhost'; }
    // Le librerie Firebase (circa 700 KB) si caricano solo se servono: all'avvio se avevi già fatto l'accesso,
    // altrimenti quando apri le impostazioni (per essere pronte al tocco su "Accedi").
    const LS_SIGNED = 'liferpg:signed';
    function wasSignedIn() {
      try {
        const v = localStorage.getItem(LS_SIGNED);
        return v === '1' || (v === null && !!localStorage.getItem(LS_ACC));   // versione precedente: basta essere stati collegati
      } catch (e) { return false; }
    }
    const markSigned = on => lsSet(LS_SIGNED, on ? '1' : '0');
    let fbLoading = null;
    function loadFirebase() {
      if (window.firebase && window.firebase.apps) return Promise.resolve(true);
      if (!fbUsable()) return Promise.resolve(false);
      if (!fbLoading) {
        // una dopo l'altra: auth e firestore hanno bisogno di app
        fbLoading = ['app', 'auth', 'firestore'].reduce((p, n) => p.then(() => new Promise((res, rej) => {
          const sc = document.createElement('script');
          sc.src = 'firebase/firebase-' + n + '-compat.js';
          sc.onload = res;
          sc.onerror = () => rej(new Error('firebase ' + n));
          document.head.appendChild(sc);
        })), Promise.resolve()).then(() => !!window.firebase, e => { console.warn(e); fbLoading = null; return false; });
      }
      return fbLoading;
    }
    function fbInit() {
      if (ST.fbAuth || !fbUsable() || !window.firebase) return !!ST.fbAuth;
      try {
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
        ST.fbAuth = app.auth();
        ST.fbDb = app.firestore();
        return true;
      } catch (e) { console.warn('firebase', e); return false; }
    }
    // al primo avvio Firebase ritrova da solo l'accesso fatto in precedenza (anche offline)
    function fbFirstUser() { return new Promise(res => { const off = ST.fbAuth.onAuthStateChanged(u => { off(); res(u); }); }); }

    // legge tutto quello che c'è nell'account (documento del giocatore, immagini, missioni per mese)
    async function cloudFetch(ref) {
      const snap = await ref.get();
      const d = snap.exists ? snap.data() : null;
      const isnap = await ref.collection('imgs').get();
      const rImgs = {};
      isnap.docs.forEach(x => { const v = x.data() && x.data().data; if (validImg(v)) rImgs[x.id] = v; });
      const msnap = await ref.collection('m').get();
      const rM = {};
      msnap.docs.forEach(x => {
        if (!/^\d{4}-\d{2}$/.test(x.id)) return;
        const v = x.data() || {};
        rM[x.id] = { items: normalizeMissions(v.items).filter(m => monthOf(m) === x.id), del: normDel(v.del) };
      });
      return { d, rImgs, rM };
    }
    // Dati rimasti sul dispositivo da una versione precedente dell'app (quando si salvava anche lì).
    // LS_ACC dice a quale account appartenevano; vuoto = gioco senza account.
    const linkedUid = () => { try { return localStorage.getItem(LS_ACC) || ''; } catch (e) { return ''; } };
    // la lingua non conta: è una preferenza del dispositivo
    const customSettings = () => JSON.stringify({ ...ST.settings, lang: defaultSettings().lang }) !== JSON.stringify(defaultSettings());
    const deviceHasData = () => hasProgress(ST.xp) || ST.missions.length > 0 || ST.routines.length > 0 || customSettings() || IMG_NAMES.some(n => imgs[n]);

    // carica i dati dall'account (ref = documento del giocatore) e li mette in memoria.
    // Non c'è più nessuna scelta "quali dati tenere": l'account è l'unica fonte. Solo per il passaggio dalle versioni
    // precedenti: i dati dello stesso account rimasti qui si uniscono (possono esserci modifiche non ancora mandate),
    // quelli di un altro account si ignorano, quelli di chi giocava senza account si aggiungono a questo account.
    // Dopo, dal dispositivo si tolgono.
    async function cloudLoad(ref, uid) {
      const r = await cloudFetch(ref);
      const linked = linkedUid();
      if (linked && linked !== uid) discardLocal();
      const guest = !linked && deviceHasData();
      cloudApply(ref, r, linked !== uid, uid, guest);
      clearDeviceData();
    }
    // firstLink: prima volta con questo account in questa sessione (un'immagine che manca nell'account non va tolta)
    // addAll: tutti gli XP di qui si aggiungono a quelli dell'account (progressi fatti senza account, versioni precedenti)
    function cloudApply(ref, r, firstLink, key, addAll) {
      const d = r.d || {};
      const S = normalize(d.xp);
      ST.dbRef = ref;
      setSaveState('account');
      if (ST.sync.key !== key) {
        // i dati di adesso sono il punto di partenza. Se l'account ha già dei progressi, gli XP di qui sono zero
        // (sessione nuova); se l'account è vuoto, o si portano i progressi fatti senza account, sono da mandare.
        const keepAt = ST.settingsTouched ? ST.sync.sAt : 0;
        ST.sync = blankSync(key);
        ST.sync.sAt = keepAt;
        ST.sync.xpBase = hasProgress(S) && !addAll ? { ...ST.xp } : blank();
        absorbLocal();
        STATS.forEach(s => { ST.sync.pend[s.key] = ST.xp[s.key] - ST.sync.xpBase[s.key]; });
      }
      const u = applyUserDoc(d, null, true);
      if (u.dirty) userDirty = true;
      new Set([...Object.keys(r.rM), ...ST.missions.map(monthOf)]).forEach(ym => {
        const x = r.rM[ym] || { items: [], del: {} };
        mergeMonth(ym, x.items, x.del);
      });
      if (hasPend()) userDirty = true;   // XP fatti qui e non ancora nell'account
      if (!r.d) userDirty = true;
      // immagini: l'account è la fonte, tranne quelle modificate in questa sessione
      IMG_NAMES.forEach(n => {
        if (imgTouched.has(n)) { imgQueue.add(n); return; }
        const v = r.rImgs[n] || null;
        // l'account non ha questa immagine, ma c'era sul dispositivo (versione precedente): si carica nell'account
        if (firstLink && !v && imgs[n]) { if (imgs[n].length <= CLOUD_IMG_MAX) imgQueue.add(n); else imgs[n] = null; return; }
        if (imgs[n] !== v) imgs[n] = v;
      });
      applyImages();
      paintCustom();
      if (imgQueue.size) flushImgs();
      renderMissionViews();
      if (monthQueue.size) flushMissions();
      render(true);
      if (userDirty) flush();
      startListening();
      renderInfo();
      paintGate();
      if (ST.fbUser) { schedulePublish(true); checkFriendRequests(); sharedStart(); }
      // da qui le penalità (e l'esito delle missioni condivise) si possono applicare: i dati sono quelli dell'account
      MUI.setPenaltyReady();
      checkPenalties();
    }

    /* ---------- schermata di accesso: senza account (e senza internet) il gioco non si apre ---------- */
    const gate = $('gate'), appEl = document.querySelector('.app');
    let fbReady = false, gateOffline = false, gateErr = '';
    function paintGate() {
      const open = !ST.dbRef;
      gate.hidden = !open;
      if (!open) $('gate-note').textContent = '';
      appEl.inert = open;
      appEl.setAttribute('aria-hidden', String(open));
      if (!open) return;
      let key, signin = false, retry = false;
      if (!fbUsable()) key = 'acc.unavail';
      else if (gateOffline) { key = 'gate.offline'; retry = true; }
      else if (fbReady && !ST.fbUser) { key = 'gate.signin'; signin = true; }
      else key = 'gate.loading';
      $('gate-msg').textContent = gateErr || T(key);
      $('gate-in').hidden = !signin;
      $('gate-retry').hidden = !retry;
      $('gate-in').disabled = $('gate-retry').disabled = ST.accBusy;
    }
    // riprova a collegarsi (pulsante "Riprova" e ritorno della rete)
    async function retryConnect() {
      if (ST.dbRef || ST.accBusy) return;
      gateErr = '';
      if (!fbReady) { await initCloudInner(); return; }
      if (ST.fbUser) await fbConnect();
    }
    $('gate-retry').addEventListener('click', retryConnect);
    $('gate-in').addEventListener('click', signIn);

    let initJob = null;
    function initCloudInner() {
      if (!initJob) initJob = (async () => {
        gateOffline = false; paintGate();
        if (!fbUsable()) { paintAccount(); paintGate(); return; }
        if (!(await loadFirebase()) || !fbInit()) { gateOffline = true; paintAccount(); paintGate(); return; }
        ST.fbUser = await fbFirstUser();
        fbReady = true;
        paintAccount();
        if (!ST.fbUser) { markSigned(false); setSaveState('local'); paintGate(); return; }
        markSigned(true);
        await fbConnect();
      })().finally(() => { initJob = null; });
      return initJob;
    }
    // collega l'account (carica i dati). Senza connessione si resta sulla schermata di accesso e si riprova:
    // quando torna internet, quando torni sull'app, oppure con "Riprova".
    let cloudJob = null;
    function fbConnect() {
      if (!ST.fbUser || ST.dbRef) return Promise.resolve();
      if (cloudJob) return cloudJob;
      cloudJob = (async () => {
        gateOffline = false; paintGate();
        try { await cloudLoad(ST.fbDb.doc('users/' + ST.fbUser.uid), ST.fbUser.uid); }
        catch (e) { console.warn('cloud', e); if (!ST.dbRef) { setSaveState('local'); gateOffline = true; } }
        paintAccount(); paintGate();
      })().finally(() => { cloudJob = null; });
      return cloudJob;
    }
    // quando torna la rete o torni sull'app: ci si collega (se non lo si era) e si manda ciò che era rimasto indietro
    // (anche l'ascolto delle missioni condivise riparte, se si era interrotto per un errore)
    window.addEventListener('online', () => { retryConnect(); syncKick(); if (ST.dbRef && ST.fbUser) sharedStart(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (!ST.dbRef && gateOffline) retryConnect();
      syncKick();
      if (ST.dbRef && ST.fbUser) sharedStart();
    });

    // riquadro "Account" nella scheda Dati delle impostazioni
    function paintAccount() {
      const box = $('acc-box');
      if (!box) return;
      const usable = fbUsable();
      $('acc-in').hidden = !usable || !!ST.fbUser;
      $('acc-out').hidden = !ST.fbUser;
      $('acc-in').disabled = $('acc-out').disabled = ST.accBusy;
      const who = ST.fbUser ? (ST.fbUser.email || ST.fbUser.displayName || '') : '';
      $('acc-status').textContent = !usable ? T('acc.unavail') : !ST.fbUser ? T('acc.off')
        : ST.dbRef ? T('acc.as', { who }) : T('acc.as.wait', { who });   // accesso fatto, ma l'account non è ancora raggiungibile
    }
    function accMsg(t) { $('acc-msg').textContent = t || ''; }
    async function signIn() {
      if (ST.accBusy) return;
      ST.accBusy = true; accMsg(''); gateErr = ''; paintAccount(); paintGate();
      if (!(await loadFirebase()) || !fbInit()) {
        accMsg(T('acc.err')); gateErr = T('gate.nonet');
        ST.accBusy = false; paintAccount(); paintGate(); return;
      }
      fbReady = true;
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        const r = await ST.fbAuth.signInWithPopup(provider);
        ST.fbUser = r.user;
        markSigned(true);
        paintAccount();
        ST.accBusy = false;
        await fbConnect();
        sfx('ok');
      } catch (e) {
        const code = e && e.code || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          try { markSigned(true); await ST.fbAuth.signInWithRedirect(provider); return; } catch (e2) { markSigned(false); console.warn('auth', e2); }
        }
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
          accMsg(T('acc.err')); gateErr = T(code === 'auth/network-request-failed' ? 'gate.nonet' : 'acc.err'); console.warn('auth', e);
        }
      }
      ST.accBusy = false; paintAccount(); paintGate();
    }
    $('acc-in').addEventListener('click', signIn);
    // Uscire: i dati stanno solo nell'account, quindi prima si manda ciò che manca e poi si tolgono da questo dispositivo.
    // C'è ancora qualcosa da mandare all'account?
    const unsynced = () => {
      if (!ST.dbRef) return true;   // account mai raggiunto in questa sessione: le modifiche fatte qui potrebbero non esserci
      absorbLocal();
      return userDirty || ST.writing || ST.again || monthQueue.size > 0 || imgQueue.size > 0 || syncBusy() || hasPend();
    };
    // manda tutto e aspetta (al massimo ms millisecondi); true se alla fine l'account ha tutto
    async function waitSynced(ms) {
      if (!ST.dbRef) return false;
      const end = Date.now() + ms;
      let kick = 0;
      while (Date.now() < end) {
        if (Date.now() >= kick) {   // si rilancia l'invio ogni 2 secondi, non di continuo
          kick = Date.now() + 2000;
          clearTimeout(retryT);
          if (!ST.writing) flush();
          if (monthQueue.size) flushMissions();
          if (imgQueue.size) flushImgs();
        }
        await new Promise(r => setTimeout(r, 250));
        if (!unsynced()) return true;
      }
      return !unsynced();
    }
    let outArmed = 0;   // secondo tocco su "Esci" entro 10 secondi: si esce anche senza aver mandato tutto
    $('acc-out').addEventListener('click', async () => {
      if (ST.accBusy || !ST.fbAuth) return;
      const force = Date.now() < outArmed;
      outArmed = 0;
      ST.accBusy = true; paintAccount();
      if (!force) {
        accMsg(T('acc.out.saving'));
        if (!(await waitSynced(8000))) {
          outArmed = Date.now() + 10000;
          accMsg(T('acc.out.unsaved'));
          sfx('err');
          ST.accBusy = false; paintAccount();
          return;
        }
      }
      try { await ST.fbAuth.signOut(); }
      catch (e) { console.warn('auth', e); accMsg(T('acc.out.err')); ST.accBusy = false; paintAccount(); return; }
      markSigned(false);
      stopListening();
      clearTimeout(retryT);
      ST.fbUser = null; ST.dbRef = null;
      friendsReset();
      sharedReset();
      await wipeLocalData();
      try { sessionStorage.setItem('liferpg:bye', '1'); } catch (e) { /* ignora */ }
      location.reload();   // si riparte da zero: in memoria non resta niente dell'account
    });
    // dopo il ricaricamento seguito all'uscita: lo si dice nel riquadro Account
    try { if (sessionStorage.getItem('liferpg:bye')) { sessionStorage.removeItem('liferpg:bye'); $('gate-note').textContent = T('acc.bye'); } } catch (e) { /* ignora */ }
    // chiudendo o ricaricando la pagina con modifiche non ancora nell'account (per esempio senza rete)
    // il browser chiede conferma: sul dispositivo non c'è una copia, quindi andrebbero perse
    window.addEventListener('beforeunload', e => {
      if (ST.dbRef && unsynced()) { e.preventDefault(); e.returnValue = ''; }
    });
    async function initCloud() {
      paintGate();
      await initCloudInner();
    }
    musicSync();      // prova a partire subito (funziona se il browser lo permette, altrimenti al primo tocco)
    imagesInit();

    return {
      stampRoutines, tombMissions, tombRoutine, mergeMonth, txDoc, syncFail, syncOk, flush, persist, loadFirebase, fbConnect, paintAccount, initCloud,
    };
  }
  window.LIFE_RPG_CLOUD = { create };
})();
