/*
 * Life RPG — logica dell'app
 * ---------------------------------------------------------------
 * File estratto da index.html durante il refactoring: prima tutto
 * questo codice viveva in un <script> inline; ora è qui, come file
 * a sé stante, per essere più facile da leggere, cercare e mantenere.
 *
 * I testi delle 3 lingue (it/en/pt-BR) NON sono in questo file: sono in
 * i18n.js (caricato prima di questo, vedi index.html), per poterli
 * modificare senza dover cercare tra la logica dell'app.
 *
 * Anche le regole del gioco (statistiche, livelli, titoli del personaggio)
 * sono in un file a parte: game.js, caricato subito prima di questo.
 * I disegni (icone e cifre a pixel, linguetta del livello, radar) sono in draw.js.
 * Le regole della sincronizzazione tra dispositivi (calcoli puri) sono in sync.js.
 * Effetti sonori e musica (con la tabella dei brani MUSIC_FILES) sono in audio.js.
 * I calcoli dei colori (temi, finestre, testo leggibile) sono in look.js; la finestra Impostazioni,
 * il pannello Personalizza e l'applicazione dell'aspetto sono in settings-ui.js.
 * Le regole delle missioni, delle routine e del calendario (calcoli puri) sono in missions.js;
 * la parte che si vede (schede, elenco, calendario, finestre delle missioni) è in missions-ui.js.
 * L'ordine dei file in index.html è:
 *   i18n.js → game.js → draw.js → look.js → sync.js → missions.js → missions-ui.js → settings-ui.js
 *   → audio.js → index.js.
 *
 * Indice delle sezioni, nell'ordine in cui compaiono (cerca il titolo per saltare al punto giusto):
 *   1. lingue                                — collegamento ai testi di i18n.js
 *   2. dati di gioco                         — collegamento a game.js (statistiche, livelli, titoli)
 *   3. stato e salvataggio                   — stato in memoria + persistenza locale;
 *                                              contiene "sincronizzazione con l'account (più dispositivi)"
 *   4. suono                                 — collegamento ad audio.js + pulsanti Suono
 *   5. interfaccia: elementi                 — riferimenti ai nodi del DOM, pulsanti "premi di nuovo", radar
 *   6. effetti                               — animazioni e feedback visivi
 *   7. finestre (Dati e Personalizza)        — aprire/chiudere le finestre, scheda Dati (backup, import, azzera)
 *   8. personalizzazione                     — collegamento a settings-ui.js, cambio di lingua,
 *                                              salvataggio delle impostazioni e delle immagini
 *   9. missioni e calendario                 — mk (crea elementi), salvataggio mese per mese e
 *                                              collegamento a missions-ui.js
 *  10. musica                                — pulsanti Musica e volume (la logica è in audio.js)
 *  10b. schede e icone                       — navigazione Personaggio/Statistiche/Missioni/Calendario,
 *                                              icone delle Impostazioni
 *  11. info: la guida del giocatore          — testo di aiuto in-app
 *  12. avvio                                 — inizializzazione dell'app
 *  13. account (Firebase)                    — accesso con Google, collegamento e unione dei dati
 *  14. amici                                 — codici amico, richieste, profili pubblici
 *
 * Tutta l'app resta racchiusa in un'unica IIFE (subito sotto) per non
 * inquinare lo scope globale della pagina: le funzioni e variabili
 * definite qui non sono quindi accessibili da fuori questo file, e
 * questo file può essere caricato con l'attributo "defer" in index.html
 * senza bisogno di alcun tag <script> inline.
 */
(() => {
  'use strict';

  /* ================= lingue ================= */
  // I testi delle 3 lingue (LANGS, I18N) vivono ora in i18n.js, caricato
  // prima di questo file: qui prendiamo solo i due riferimenti che servono.
  const { LANGS, I18N } = window.LIFE_RPG_I18N;

  let lang = 'it';                                      // lingua attiva (si aggiorna da settings.lang)
  const curLang = () => LANGS.find(l => l.id === lang) || LANGS[0];
  const locale = () => curLang().locale;
  // testo tradotto; se manca nella lingua attiva si usa l'italiano
  function T(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]);
    if (s === undefined) s = I18N.it[key];
    if (s === undefined) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }
  // con il singolare/plurale: chiavi "nome_one" e "nome_other"
  const TN = (key, n, vars) => T(key + (n === 1 ? '_one' : '_other'), Object.assign({ n }, vars));


  /* ================= dati di gioco ================= */
  // Regole del gioco (statistiche, livelli, titoli): sono in game.js, caricato prima di questo file
  const GAME = window.LIFE_RPG_GAME.create(T);
  const {
    STATS, ICONS, ALIASES, MAX_LEVEL, MAX_XP, xpForLevel, levelFromXp, fracLevel, overallOf, PAIRS, TRIPLES,
    QUADS, QUINTS, TIERS, GRADES, SPEC_MIN_LEVEL, blank, normalize,
  } = GAME;
  const heroRole = (x = xp) => GAME.heroRole(x);     // di solito si guardano i tuoi XP
  const heroClass = (x = xp) => GAME.heroClass(x);
  // Regole della sincronizzazione tra dispositivi (calcoli puri): sono in sync.js
  const SYNC = window.LIFE_RPG_SYNC.create(GAME);
  const {
    normLedger, normDel, normRaw, rawOf, clampXp, effOf, canon, mergeItems,
  } = SYNC;
  // Calcoli dei colori (luminosità, mescolanze, colori delle finestre...): sono in look.js
  const { luminance, mixHex, hslToHex, winBase, paletteVars, readable, normHex } = window.LIFE_RPG_LOOK;
  // Regole delle missioni, delle routine e del calendario (calcoli puri): sono in missions.js
  const MISSIONS = window.LIFE_RPG_MISSIONS.create(GAME, SYNC);
  const {
    MAX_PER_MONTH, MAX_MISSIONS, MAX_ROUTINES,
    pad2, isoDate, parseDate, todayStr, addDaysStr, monthOf, validDate, validTime,
    rewardTotal, rewardMatch, normalizeMissions, normalizeRoutines,
    startMs, dueEndMs, isLate, notYet, WD_ALL, gcalUrl, gcalRoutineUrl,
  } = MISSIONS;
  const LS_KEY = 'liferpg:v1';
  const fmt = n => n.toLocaleString(locale());

  /* ================= stato e salvataggio ================= */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* storage non disponibile */ }
    return blank();
  }
  function saveLocal() {
    lsSet(LS_KEY, JSON.stringify(xp));
  }
  const hasProgress = o => Object.values(o).some(v => v > 0);

  /* ----- impostazioni di personalizzazione ----- */
  const LS_SET = 'liferpg:settings:v1';
  // solo per convertire i temi scelti in passato nel colore corrispondente
  const LEGACY_THEMES = [
    { id: 'blu',      name: 'Blu',      h: 231, s: 68 },
    { id: 'viola',    name: 'Viola',    h: 266, s: 62 },
    { id: 'rosa',     name: 'Rosa',     h: 328, s: 62 },
    { id: 'rosso',    name: 'Rosso',    h: 355, s: 64 },
    { id: 'arancio',  name: 'Arancio',  h: 22,  s: 74 },
    { id: 'verde',    name: 'Verde',    h: 146, s: 50 },
    { id: 'turchese', name: 'Turchese', h: 186, s: 62 },
    { id: 'grafite',  name: 'Grafite',  h: 220, s: 9 },
  ];
  const FRAMES = [
    { id: 'nessuno',  name: 'Nessuno' },
    { id: 'sottile',  name: 'Sottile' },
    { id: 'semplice', name: 'Semplice' },
    { id: 'classico', name: 'Classico' },
  ];
  const FITS = [
    { id: 'adatta',  name: 'Adatta',  size: 'contain' },
    { id: 'riempi',  name: 'Riempi',  size: 'cover' },
    { id: 'allunga', name: 'Allunga', size: '100% 100%' },
  ];
  const HEX = /^#[0-9a-f]{6}$/i;
  const defaultSettings = () => ({ name: '', titleText: '', titleShow: true, frame: 'semplice', frameV: 2, bgFit: 'adatta', winColor: null, inkColor: null, softColor: null, accentColor: null, nameColor: null, titleColor: null, trans: 0, colors: {}, shareBg: false, lang: 'it' });
  function normalizeSettings(o) {
    const s = defaultSettings();
    if (!o || typeof o !== 'object') return s;
    if (typeof o.name === 'string') s.name = o.name.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (typeof o.titleText === 'string') s.titleText = o.titleText.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (o.titleShow === false) s.titleShow = false;
    if (o.shareBg === true) s.shareBg = true;
    if (LANGS.some(l => l.id === o.lang)) s.lang = o.lang;
    if (typeof o.winColor === 'string' && HEX.test(o.winColor)) {
      s.winColor = o.winColor.toLowerCase();
    } else {
      const t = LEGACY_THEMES.find(x => x.id === o.theme && x.id !== 'blu');
      if (t) s.winColor = hslToHex(t.h, t.s, 49);
    }
    // frameV 2: il nuovo predefinito è "semplice"; le scelte fatte prima (frameV assente) si ignorano
    if (o.frameV === 2 && FRAMES.some(f => f.id === o.frame)) s.frame = o.frame;
    if (FITS.some(f => f.id === o.bgFit)) s.bgFit = o.bgFit;
    for (const k of ['nameColor', 'titleColor', 'inkColor', 'softColor', 'accentColor']) {
      if (typeof o[k] === 'string' && HEX.test(o[k])) s[k] = o[k].toLowerCase();
    }
    if (Number.isFinite(Number(o.trans))) s.trans = Math.min(100, Math.max(0, Math.round(Number(o.trans))));
    for (const st of STATS) {
      if (o.colors && typeof o.colors[st.key] === 'string' && HEX.test(o.colors[st.key])) s.colors[st.key] = o.colors[st.key].toLowerCase();
    }
    return s;
  }
  function loadSettingsLocal() {
    try {
      const raw = localStorage.getItem(LS_SET);
      if (raw) return normalizeSettings(JSON.parse(raw));
    } catch (e) { /* storage non disponibile */ }
    return defaultSettings();
  }
  function saveSettingsLocal() {
    lsSet(LS_SET, JSON.stringify(settings));
  }
  const isDefaultSettings = () => JSON.stringify(settings) === JSON.stringify(defaultSettings());
  let settings = loadSettingsLocal();
  lang = settings.lang;
  let settingsTouched = false;
  // le impostazioni di un backup o dell'account salvate prima di questa versione non hanno la lingua:
  // in quel caso si tiene quella che stai usando
  function mergeSettings(raw) {
    const s = normalizeSettings(raw);
    if (!(raw && LANGS.some(l => l.id === raw.lang))) s.lang = settings.lang;
    return s;
  }

  /* ----- immagini personalizzate (sfondo e icone) ----- */
  const IMG_NAMES = ['bg', ...STATS.map(s => s.key)];
  const LS_IMG = 'liferpg:img:';
  const IMG_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const CLOUD_IMG_MAX = 260000;                          // oltre questa misura un'immagine resta solo sul dispositivo
  const GIF_MAX_FILE = 2 * 1024 * 1024;                  // una GIF sotto i 2 MB si tiene com'è, così resta animata
  const GIF_MAX_CHARS = Math.ceil(GIF_MAX_FILE / 3) * 4 + 64;
  const isGif = s => typeof s === 'string' && s.startsWith('data:image/gif;');
  const validImg = s => typeof s === 'string' && s.length <= (isGif(s) ? GIF_MAX_CHARS : CLOUD_IMG_MAX) && IMG_RE.test(s);
  const imgs = Object.fromEntries(IMG_NAMES.map(n => [n, null]));
  const imgTouched = new Set();
  function loadImgsLocal() {
    for (const n of IMG_NAMES) {
      try { const v = localStorage.getItem(LS_IMG + n); if (validImg(v)) imgs[n] = v; } catch (e) { /* ignora */ }
    }
  }
  // Le immagini stanno in IndexedDB (molto più spazio di localStorage). Restano in memoria in `imgs`;
  // localStorage serve solo per i dati salvati da versioni precedenti e come ripiego se IndexedDB non c'è.
  const IDB_NAME = 'liferpg', IDB_STORE = 'imgs';
  let idbPromise = null;
  function idbOpen() {
    if (!idbPromise) idbPromise = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('noidb')); return; }
      let r;
      try { r = indexedDB.open(IDB_NAME, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('idb'));
      r.onblocked = () => rej(new Error('blocked'));
    });
    return idbPromise;
  }
  // esegue fn(store) in una transazione e risolve quando è davvero finita (scritta su disco)
  function idbRun(mode, fn) {
    return idbOpen().then(db => new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, mode);
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => rej(tx.error || new Error('tx'));
      fn(tx.objectStore(IDB_STORE));
    }));
  }
  const idbPut = (n, v) => idbRun('readwrite', st => { st.put(v, n); });
  const idbDel = n => idbRun('readwrite', st => { st.delete(n); });
  function idbLoad() {
    const got = {};
    return idbRun('readonly', st => {
      IMG_NAMES.forEach(n => { st.get(n).onsuccess = e => { if (e.target.result != null) got[n] = e.target.result; }; });
    }).then(() => got);
  }
  // salva l'immagine n (quella in `imgs`); risolve true se è stata scritta da qualche parte, false se no
  function saveImgLocal(n) {
    const v = imgs[n] || null;
    return (v ? idbPut(n, v) : idbDel(n)).then(
      () => { lsSet(LS_IMG + n, null); return true; },     // ora è in IndexedDB: la copia vecchia si toglie
      () => lsSet(LS_IMG + n, v)                            // IndexedDB non disponibile: si ripiega su localStorage
    );
  }
  // all'avvio: prende le immagini da IndexedDB e sposta lì quelle rimaste in localStorage
  async function imagesInit() {
    let stored;
    try { stored = await idbLoad(); } catch (e) { return; }   // niente IndexedDB: si resta su localStorage
    let changed = false;
    for (const n of IMG_NAMES) {
      if (imgTouched.has(n)) continue;                        // cambiata da quando la pagina è aperta: vale quella
      if (validImg(stored[n])) {
        if (imgs[n] !== stored[n]) { imgs[n] = stored[n]; changed = true; }
      } else if (imgs[n]) {
        try { await idbPut(n, imgs[n]); lsSet(LS_IMG + n, null); } catch (e) { /* resta dov'è */ }
      }
    }
    if (changed) { applyImages(); if (cs.Vigore) paintCustom(); }
  }
  loadImgsLocal();

  /* ----- missioni ----- */
  const LS_MIS = 'liferpg:missions:v1';
  // limiti, controllo dei dati e stelle (Durata x Difficoltà): sono in missions.js
  function loadMissionsLocal() {
    try {
      const raw = localStorage.getItem(LS_MIS);
      if (raw) return normalizeMissions(JSON.parse(raw));
    } catch (e) { /* storage non disponibile */ }
    return [];
  }
  function saveMissionsLocal() {
    const ok = lsSet(LS_MIS, JSON.stringify(missions));
    return ok;
  }
  let missions = loadMissionsLocal();

  /* ----- routine: missioni che si ripetono nei giorni scelti ----- */
  const LS_ROU = 'liferpg:routines:v1';
  // limiti e controllo dei dati delle routine: sono in missions.js
  function loadRoutinesLocal() {
    try { const raw = localStorage.getItem(LS_ROU); if (raw) return normalizeRoutines(JSON.parse(raw)); } catch (e) { /* ignora */ }
    return [];
  }
  let routinesApplying = false;
  function saveRoutinesLocal() {
    if (!routinesApplying) stampRoutines();   // modifica fatta qui: si segna l'istante (le routine arrivate dall'account ce l'hanno già)
    lsSet(LS_ROU, JSON.stringify(routines));
    if (routinesApplying) return;             // routine appena arrivate dall'account: non c'è niente da rimandare
    if (dbRef) flush();
  }
  let routines = loadRoutinesLocal();
  try { localStorage.removeItem('liferpg:drive'); } catch (e) { /* Google Drive non c'è più */ }

  let xp = loadLocal();
  let dbRef = null, writing = false, again = false;
  let fbAuth = null, fbDb = null, fbUser = null, accBusy = false;   // account Firebase (vedi la sezione "account")
  let accPending = null;                                            // scelta "quali dati tenere" in attesa
  let myCode = '', codeJob = null, pubTimer = 0, lastPub = '', pubBgId;   // amici: il tuo codice, l'ultimo profilo pubblicato, l'impronta dello sfondo condiviso
  let friends = { rows: [], profs: {}, loaded: false };
  let downloadsCap = null;

  // Alcuni browser non lasciano salvare dati quando si apre un file HTML dal dispositivo
  let storageOk = true;
  try { localStorage.setItem('liferpg:probe', '1'); localStorage.removeItem('liferpg:probe'); } catch (e) { storageOk = false; }
  let saveKind = 'local';
  const saveStateEl = document.getElementById('save-state');
  const lsFailed = new Set();   // chiavi che il browser non è riuscito a scrivere (memoria piena)
  const paintSaveState = () => {
    const key = (!storageOk && saveKind === 'local') ? 'nostorage' : saveKind;
    const full = storageOk && lsFailed.size > 0;
    saveStateEl.textContent = full ? T('save.full') : (key === 'nostorage' || key === 'error') ? T('save.' + key) : '';
    saveStateEl.classList.toggle('warn', !!saveStateEl.textContent);
  };
  const setSaveState = k => { saveKind = k; paintSaveState(); };
  // scrive in localStorage (value null = cancella); se non ci riesce lo segnala invece di ignorarlo
  function lsSet(key, value) {
    let ok = true;
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { ok = false; }
    if (storageOk) {
      const was = lsFailed.size;
      if (ok) lsFailed.delete(key); else lsFailed.add(key);
      if (was !== lsFailed.size) paintSaveState();
    }
    return ok;
  }

  /* ----- sincronizzazione con l'account (più dispositivi) ----- */
  // Le regole (chi vince, lapidi, registro degli XP, totale grezzo) sono spiegate e scritte in sync.js.
  // Qui c'è lo stato di questo dispositivo e il modo in cui lo si aggiorna.
  // Lo stato è di un solo account (key) ed è salvato sul dispositivo.
  const LS_SYNC = 'liferpg:sync:v2';
  // xpBase: totale grezzo visto nell'account; pend: XP fatti qui e non ancora mandati; xpSeen: gli XP locali già contati in pend
  const blankSync = key => ({ key: key || '', xpBase: null, pend: blank(), xpSeen: null, rev: 0, mDel: {}, rDel: {}, sAt: 0 });
  // questo dispositivo, per il registro "c" delle missioni
  const DEV = (() => {
    let id = '';
    try { id = localStorage.getItem('liferpg:dev') || ''; } catch (e) { /* ignora */ }
    if (!/^[a-z0-9]{4,12}$/.test(id)) {
      const b = new Uint32Array(2); crypto.getRandomValues(b);
      id = (b[0].toString(36) + b[1].toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(6, '0');
      try { localStorage.setItem('liferpg:dev', id); } catch (e) { /* ignora */ }
    }
    return id;
  })();
  // le modifiche fatte qui agli XP (missioni, penalità...) finiscono in "pend", da mandare all'account
  function absorbLocal() {
    if (!sync.xpSeen) sync.xpSeen = { ...xp };
    STATS.forEach(s => { sync.pend[s.key] += xp[s.key] - sync.xpSeen[s.key]; });
    sync.xpSeen = { ...xp };
  }
  // XP mostrati = totale dell'account + ciò che non è ancora partito, tagliato fra 0 e 100.000
  function recomputeXp() {
    const shown = SYNC.shownXp(sync.xpBase, sync.pend);
    let ch = false;
    STATS.forEach(s => { if (shown[s.key] !== xp[s.key]) { xp[s.key] = shown[s.key]; ch = true; } });
    sync.xpSeen = { ...xp };
    return ch;
  }
  const hasPend = () => STATS.some(s => sync.pend[s.key]);
  function loadSync() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_SYNC) || 'null');
      if (o && typeof o === 'object' && typeof o.key === 'string') {
        const s = blankSync(o.key);
        if (o.xpBase && typeof o.xpBase === 'object') s.xpBase = normRaw(o.xpBase);
        s.pend = normRaw(o.pend);
        if (o.xpSeen && typeof o.xpSeen === 'object') s.xpSeen = normalize(o.xpSeen);
        s.rev = Number.isInteger(o.rev) && o.rev > 0 ? o.rev : 0;
        if (o.mDel && typeof o.mDel === 'object') for (const [ym, d] of Object.entries(o.mDel)) if (/^\d{4}-\d{2}$/.test(ym)) s.mDel[ym] = normDel(d);
        s.rDel = normDel(o.rDel);
        s.sAt = Number.isFinite(Number(o.sAt)) && o.sAt > 0 ? Number(o.sAt) : 0;
        return s;
      }
    } catch (e) { /* stato illeggibile: si riparte */ }
    // prima volta con questa versione: se il dispositivo era già collegato a un account, i dati di adesso sono
    // il punto di partenza (xpBase), così le modifiche fatte da qui in poi, anche offline, non si perdono
    const s = blankSync(linkedUidRaw());
    s.xpBase = { ...xp }; s.xpSeen = { ...xp };
    return s;
  }
  function linkedUidRaw() { try { return localStorage.getItem('liferpg:acc') || ''; } catch (e) { return ''; } }
  function saveSync() { lsSet(LS_SYNC, JSON.stringify(sync)); }
  let sync = loadSync();
  saveSync();
  let xpAbs = 0;            // diverso da 0: gli XP vanno scritti così come sono (backup importato, "Azzera tutto", scelta "questo dispositivo")
  let deferredUser = null;  // aggiornamento del documento arrivato mentre si scriveva: si guarda dopo

  const missionSig = m => canon(normalizeMissions([m])[0] || m);
  const routineSig = r => canon(normalizeRoutines([r])[0] || r);
  // ultima versione "firmata" di ogni missione e routine: se cambia, si aggiorna "u".
  // Per le missioni si ricorda anche l'effetto sugli XP, per scrivere nel registro "c" quanto è cambiato qui.
  const seenOf = m => ({ g: missionSig(m), e: effOf(m) });
  const mSeen = new Map(missions.map(m => [m.id, seenOf(m)]));
  const rSeen = new Map(routines.map(r => [r.id, routineSig(r)]));
  function stampRoutines() {
    const now = Date.now();
    routines.forEach(r => { const g = routineSig(r); if (rSeen.get(r.id) !== g) { r.u = Math.max(now, (r.u || 0) + 1); rSeen.set(r.id, g); } });
  }
  // missioni o routine eliminate da te: la lapide impedisce che tornino da un altro dispositivo
  function tombMissions(list) {
    const now = Date.now();
    list.forEach(m => {
      const ym = monthOf(m), x = { t: now };
      if (m.c) x.c = m.c;
      if (m.z) x.z = m.z;
      (sync.mDel[ym] = sync.mDel[ym] || {})[m.id] = x;
      mSeen.delete(m.id);
    });
    saveSync();
  }
  function tombRoutine(id) { sync.rDel[id] = { t: Date.now() }; rSeen.delete(id); saveSync(); }

  // porta dentro questo dispositivo il contenuto di un mese dell'account (R, lapidi rDel).
  // Se una tua versione ha perso, si annulla la parte di XP che il registro vincente non ti riconosce.
  function mergeMonth(ym, R, rDel) {
    const L = missions.filter(m => monthOf(m) === ym);
    const res = SYNC.mergeReport(L, sync.mDel[ym] || {}, R, rDel, missionSig, DEV);
    const { comp, changed, dirty } = res;
    if (Object.keys(res.del).length) sync.mDel[ym] = res.del; else delete sync.mDel[ym];
    if (changed) {
      missions = missions.filter(m => monthOf(m) !== ym).concat(res.items);
      L.forEach(m => { if (!res.info.get(m.id).w) mSeen.delete(m.id); });
      res.items.forEach(m => { const i = res.info.get(m.id); if (i.w !== i.l) mSeen.set(m.id, seenOf(m)); });
      saveMissionsLocal();
    }
    const fix = STATS.filter(s => comp[s.key]);
    let xpCh = false;
    if (fix.length) {
      absorbLocal();
      fix.forEach(s => { sync.pend[s.key] += comp[s.key]; });
      xpCh = recomputeXp();
      saveLocal();
    }
    saveSync();
    if (dirty) monthQueue.add(ym);
    return { changed, xpChanged: fix.length > 0 || xpCh };
  }

  // porta dentro le routine dell'account
  function mergeRoutinesIn(R, rDel) {
    const res = SYNC.mergeReport(routines, sync.rDel, R, rDel, routineSig);
    const { changed, dirty, gone } = res;
    sync.rDel = res.del;
    if (changed) {
      routines = res.items;
      rSeen.clear(); routines.forEach(r => rSeen.set(r.id, routineSig(r)));
      routinesApplying = true; saveRoutinesLocal(); routinesApplying = false;
      // routine eliminata su un altro dispositivo: le sue volte ancora da fare spariscono anche qui
      if (gone.length) {
        const drop = missions.filter(m => gone.includes(m.rid) && !m.done && !m.failed);
        if (drop.length) {
          const months = new Set(drop.map(monthOf));
          tombMissions(drop);
          missions = missions.filter(m => !drop.includes(m));
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
    if (sent || force || rev > sync.rev) {
      absorbLocal();
      // ciò che è appena stato scritto non è più "da mandare"
      if (sent) STATS.forEach(s => { sync.pend[s.key] -= sent.pend[s.key]; });
      sync.xpBase = rawOf(d);
      xpChanged = recomputeXp();
      sync.rev = Math.max(sync.rev, rev);
      saveLocal();
    }
    const rr = mergeRoutinesIn(normalizeRoutines(d.routines), normDel(d.rDel));
    // impostazioni: vince la modifica più recente; a parità (anche dati di versioni precedenti) vince l'account
    const rsAt = Number(d.sAt) || 0;
    let setDirty = false;
    if (d.settings && typeof d.settings === 'object') {
      if (rsAt >= sync.sAt) {
        const s = mergeSettings(d.settings);
        sync.sAt = rsAt;
        if (JSON.stringify(s) !== JSON.stringify(settings)) {
          settings = s;
          saveSettingsLocal();
          applyAll();
          paintCustom();
        }
      } else setDirty = true;
    } else if (!isDefaultSettings() || sync.sAt) setDirty = true;
    saveSync();
    return { xpChanged, routinesChanged: rr.changed, dirty: rr.dirty || setDirty };
  }

  // legge, unisce e riscrive un documento in modo sicuro: con Firebase in una transazione
  // (se nel frattempo un altro dispositivo lo cambia, si rifà da capo); altrove lettura e poi scrittura
  async function txDoc(ref, make) {
    if (fbDb && dbRef && typeof fbDb.runTransaction === 'function' && ref.firestore) {
      await fbDb.runTransaction(async t => {
        const snap = await t.get(ref);
        t.set(ref, make(snap.exists ? snap.data() : null));
      });
    } else {
      const snap = await ref.get();
      await ref.set(make(snap.exists ? snap.data() : null));
    }
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
    if (!dbRef) return;
    if (userDirty) flush();
    if (monthQueue.size) flushMissions();
    if (imgQueue.size) flushImgs();
  }

  // documento del giocatore: XP (come differenza), routine e impostazioni
  async function flush() {
    if (!dbRef) return;
    userDirty = true;
    if (writing) { again = true; return; }
    writing = true;
    stampRoutines();
    absorbLocal();
    const sent = { xs: { ...xp }, pend: { ...sync.pend }, abs: xpAbs };
    let out = null;
    try {
      await txDoc(dbRef, cur => {
        const d = cur || {};
        const xr = SYNC.nextRaw(rawOf(d), sent.pend, sent.abs, sent.xs), nx = {};
        STATS.forEach(s => { nx[s.key] = clampXp(xr[s.key]); });
        const rr = mergeItems(routines, sync.rDel, normalizeRoutines(d.routines), normDel(d.rDel), routineSig);
        const rs = d.settings && typeof d.settings === 'object' ? mergeSettings(d.settings) : null, rsAt = Number(d.sAt) || 0;
        const mine = !rs || sync.sAt > rsAt;
        out = { v: 2, rev: (Number(d.rev) || 0) + 1, xp: nx, xr, settings: mine ? settings : rs, sAt: mine ? sync.sAt : rsAt, routines: rr.items, rDel: rr.del };
        return JSON.parse(JSON.stringify(out));
      });
      userDirty = false;
      if (sent.abs && xpAbs === sent.abs) xpAbs = 0;
      const r = applyUserDoc(JSON.parse(JSON.stringify(out)), sent);
      if (r.dirty) again = true;
      syncOk();
      if (r.xpChanged || r.routinesChanged) afterRemote(r.routinesChanged);
    } catch (e) { syncFail(e); }
    writing = false;
    if (deferredUser) { const d = deferredUser; deferredUser = null; onUserSnap(d); }
    if (again) { again = false; flush(); }
  }
  function persist() { saveLocal(); flush(); }

  // dopo un aggiornamento arrivato da un altro dispositivo: si ridisegna ciò che serve
  function afterRemote(missionsToo) {
    render(false);
    if (missionsToo) renderMissionViews();
    if (!rmodal.hidden) renderRoutines();
  }
  function onUserSnap(d) {
    if (writing) { if (!deferredUser || (Number(d.rev) || 0) >= (Number(deferredUser.rev) || 0)) deferredUser = d; return; }
    const r = applyUserDoc(d, null);
    if (r.dirty) flush();
    if (r.xpChanged || r.routinesChanged) afterRemote(r.routinesChanged);
  }

  // aggiornamenti in diretta dall'account (solo Firebase): documento del giocatore, missioni, immagini
  let unsubs = [];
  function stopListening() { unsubs.forEach(f => { try { f(); } catch (e) { /* ignora */ } }); unsubs = []; }
  function startListening() {
    stopListening();
    if (!dbRef || typeof dbRef.onSnapshot !== 'function' || !dbRef.firestore) return;
    const ref = dbRef;
    const err = e => console.warn('listen', e);
    unsubs.push(ref.onSnapshot(s => {
      if (dbRef !== ref || !s.exists || s.metadata.hasPendingWrites) return;
      onUserSnap(s.data());
    }, err));
    unsubs.push(ref.collection('m').onSnapshot(qs => {
      if (dbRef !== ref) return;
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
      if (dbRef !== ref) return;
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

  /* ================= suono ================= */
  // Effetti sonori e musica vivono in audio.js: qui si crea il "mixer" e si collegano i pulsanti.
  // Il brano si sceglie dal tuo ruolo (XP attuali); nella scheda Personaggio la musica suona a volume pieno.
  const AUDIO = window.LIFE_RPG_AUDIO.create(GAME, {
    xp: () => xp,
    fullVolume: () => curView === 'char',
  });
  const { sfx, musicPlay, musicStop, musicSync, musicGuestStart, musicGuestEnd } = AUDIO;
  const soundBtn = document.getElementById('btn-sound');
  const menuBtn = document.getElementById('btn-menu-sound');
  function paintSound() {
    soundBtn.textContent = AUDIO.soundOn() ? T('sound.on') : T('sound.off');
    soundBtn.setAttribute('aria-pressed', String(AUDIO.soundOn()));
    menuBtn.textContent = AUDIO.menuOn() ? T('sound.menu.on') : T('sound.menu.off');
    menuBtn.setAttribute('aria-pressed', String(AUDIO.menuOn()));
  }
  menuBtn.addEventListener('click', () => {
    AUDIO.setMenuSound(!AUDIO.menuOn());
    paintSound();
    if (AUDIO.menuOn()) sfx('tab', 2);
  });
  soundBtn.addEventListener('click', () => {
    AUDIO.setSound(!AUDIO.soundOn());
    paintSound();
    if (AUDIO.soundOn()) sfx('add');
  });
  paintSound();

  /* ================= interfaccia: elementi ================= */
  const $ = id => document.getElementById(id);

  // pulsanti "premi di nuovo per confermare": al primo tocco diventano "Conferma" (nello stesso punto) per 4 secondi.
  // btns: i pulsanti; idle: il loro testo normale; confirmAria: la descrizione per i lettori di schermo mentre aspettano
  function armable(btns, idle, confirmAria) {
    let timer = 0;
    const arm = on => {
      clearTimeout(timer);
      btns().forEach(b => {
        b.dataset.armed = on ? '1' : '';
        b.textContent = on ? T('btn.confirm') : idle();
        if (on) b.setAttribute('aria-label', confirmAria()); else b.removeAttribute('aria-label');
      });
      if (on) timer = setTimeout(() => arm(false), 4000);
    };
    return arm;
  }
  const resetArm = armable(() => [$('btn-reset')], () => T('data.reset'), () => T('data.reset.confirm'));
  const custResetArm = armable(() => [$('btn-custom-reset')], () => T('look.reset'), () => T('look.reset.confirm'));
  const mfDelArm = armable(() => [$('mf-del')], () => T('btn.delete'), () => T('btn.delete.confirm'));
  const fpArm = armable(() => [$('fp-remove')], () => T('fr.remove'), () => T('fr.remove.confirm'));
  const selArm = armable(() => [...document.querySelectorAll('.sel-bar [data-sel="del"]')],
    () => T('sel.del', { n: sel.ids.size }), () => T('sel.del.confirm', { n: sel.ids.size }));
  // quanto spazio copre la barra in basso (Personaggio, Statistiche...): serve al CSS per non nascondere la fine delle finestre
  (() => {
    const nav = document.querySelector('.tabs.views');
    if (!nav) return;
    const measure = () => {
      const h = Math.ceil(window.innerHeight - nav.getBoundingClientRect().top);
      if (h > 0) document.documentElement.style.setProperty('--nav-h', h + 'px');
    };
    measure();
    window.addEventListener('resize', measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(nav);
  })();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';

  // disegni a pixel (icone, cifre, linguetta del livello) e radar: sono in draw.js
  const DRAW = window.LIFE_RPG_DRAW.create(T, GAME);
  const { icoPx, snapSize, iconSvg, digitsSvg, levelTabSvg, radarMarkup, radarShapePoints, RADAR_IDX, POS } = DRAW;
  // se cambia lo zoom o lo schermo, le icone si ricalcolano
  window.addEventListener('resize', () => {
    document.querySelectorAll('svg[data-px]').forEach(sv => {
      sv.setAttribute('width', snapSize(sv, +sv.dataset.cols)); sv.setAttribute('height', snapSize(sv, +sv.dataset.rows));
    });
  });

  /* ----- lista statistiche ----- */
  const list = $('stat-list');
  const rows = {};

  STATS.forEach(s => {
    const item = document.createElement('div');
    item.className = 'item';
    item.style.setProperty('--c', s.color);
    item.innerHTML =
      '<div class="row">' +
        `<span class="ico">${iconSvg(ICONS[s.icon].rows, icoPx(ICONS[s.icon].rows))}</span>` +
        '<span class="row-main">' +
          `<span class="row-top"><span class="nm">${s.name}</span><span class="lv"><span class="lv-t">Lv</span> <b></b></span></span>` +
          '<span class="bar"><span class="fill"></span></span>' +
          '<span class="row-bot"><span class="xp"></span><span class="need"></span></span>' +
        '</span>' +
      '</div>';
    list.appendChild(item);
    const q = sel => item.querySelector(sel);
    rows[s.key] = { item, el: q('.row'), nm: q('.nm'), lvT: q('.lv-t'), lv: q('.lv b'), fill: q('.fill'), xp: q('.xp'), need: q('.need') };
  });

  /* ----- radar ----- */
  const radar = $('radar');
  radar.innerHTML = radarMarkup(blank());
  const shape = radar.querySelector('.r-shape');
  const radarNames = [...radar.querySelectorAll('.r-name')];   // nello stesso ordine di RADAR_IDX
  const labelLv = [...radar.querySelectorAll('.r-lv')];

  let radarCur = STATS.map(() => 0), radarRaf = 0;
  function drawRadar(ratios) {
    shape.setAttribute('points', radarShapePoints(ratios));
  }
  function animateRadar(target) {
    cancelAnimationFrame(radarRaf);
    const from = radarCur.slice();
    if (reduce) { radarCur = target.slice(); drawRadar(radarCur); return; }
    const t0 = performance.now(), dur = 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      radarCur = from.map((f, i) => f + (target[i] - f) * e);
      drawRadar(radarCur);
      if (k < 1) radarRaf = requestAnimationFrame(step);
    };
    radarRaf = requestAnimationFrame(step);
  }

  /* ----- render ----- */
  let lastOverall = null;
  function render(animate) {
    const levels = STATS.map(s => levelFromXp(xp[s.key]));
    STATS.forEach((s, i) => {
      const r = rows[s.key], x = xp[s.key], L = levels[i];
      r.lv.textContent = L;
      r.xp.textContent = fmt(x) + ' XP';
      if (L >= MAX_LEVEL) {
        r.need.textContent = T('lvl.max');
        r.fill.style.width = '100%';
      } else {
        const lo = xpForLevel(L), hi = xpForLevel(L + 1);
        r.need.textContent = TN('lvl.need', hi - x, { n: fmt(hi - x) });
        r.fill.style.width = ((x - lo) / (hi - lo) * 100).toFixed(1) + '%';
      }
      labelLv[POS[i]].textContent = T('lv') + ' ' + L;
    });

    const ov = overallOf(levels);
    // livello complessivo nella linguetta dorata in cima alla scheda
    const lvEl = $('lv-tab');
    lvEl.innerHTML = levelTabSvg(ov, 3);
    lvEl.setAttribute('aria-label', T('lv') + ' ' + ov);
    if (animate && lastOverall !== null && ov !== lastOverall && !reduce) {   // cambia livello: un piccolo balzo
      lvEl.classList.remove('bump'); void lvEl.offsetWidth; lvEl.classList.add('bump');
    }
    lastOverall = ov;
    $('class-name').textContent = heroClass();

    // Scala relativa: il bordo esterno è la decina successiva al livello più alto (minimo 10)
    const fracs = STATS.map(s => fracLevel(xp[s.key]));
    const scaleMax = Math.min(MAX_LEVEL, Math.max(10, Math.ceil(Math.max(...fracs) / 10) * 10));
    const ratios = fracs.map(f => f / scaleMax);
    if (animate) animateRadar(ratios); else { radarCur = ratios; drawRadar(ratios); }
    schedulePublish();
  }

  /* ================= effetti ================= */
  function floatText(key, text, neg) {
    if (reduce) return;
    const n = document.createElement('span');
    n.className = 'float' + (neg ? ' neg' : '');
    n.textContent = text;
    rows[key].el.appendChild(n);
    setTimeout(() => n.remove(), 1000);
  }

  let luTimer = 0;
  function hideLevelUp() {
    clearTimeout(luTimer);
    $('levelup').hidden = true;
    $('burst').innerHTML = '';
  }
  // ups: [{ s, from, to }] statistiche salite di livello; ovFrom/ovTo: livello complessivo
  function showLevelUp(ups, ovFrom, ovTo) {
    const listEl = $('lu-list');
    listEl.textContent = '';
    ups.forEach(u => {
      const line = document.createElement('p');
      line.className = 'lu-line';
      const name = document.createElement('span');
      name.className = 'lu-name';
      name.style.color = readable(statColor(u.s.key));
      name.textContent = u.s.name;
      const lv = document.createElement('span');
      lv.className = 'lu-to';
      lv.textContent = T('lu.line', { to: u.to });
      line.append(name, ' ', lv);
      listEl.appendChild(line);
    });
    const ovl = $('lu-overall');
    if (ovTo > ovFrom) { ovl.textContent = T('lu.overall', { from: ovFrom, to: ovTo }); ovl.hidden = false; }
    else ovl.hidden = true;

    const burst = $('burst');
    burst.innerHTML = '';
    if (!reduce) {
      const colors = [...ups.map(u => statColor(u.s.key)), '#ffd54a', '#ffffff'];
      for (let i = 0; i < 32; i++) {
        const a = Math.random() * Math.PI * 2, d = 110 + Math.random() * 190;
        const p = document.createElement('i');
        p.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
        p.style.setProperty('--dy', Math.round(Math.sin(a) * d) + 'px');
        p.style.setProperty('--pc', colors[i % colors.length]);
        burst.appendChild(p);
      }
    }
    $('levelup').hidden = false;
    clearTimeout(luTimer);
    luTimer = setTimeout(hideLevelUp, Math.min(6500, 2800 + 800 * (ups.length - 1)));
  }
  $('levelup').addEventListener('click', hideLevelUp);

  /* ================= finestre (Dati e Personalizza) ================= */
  const settingsWin = $('settings'), paneLook = $('pane-look');
  let activeModal = null, lastFocus = null;
  // sul telefono (schermo touch) non si mette il cursore in un campo di testo aprendo una finestra,
  // altrimenti la tastiera si apre da sola: il fuoco va sulla finestra stessa (per i lettori di schermo)
  const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const isTextField = el => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit'].includes(el.type)));
  function openModal(m, focusEl) {
    lastFocus = document.activeElement;
    activeModal = m;
    m.hidden = false;
    if (focusEl && isTextField(focusEl) && isTouch()) {
      const win = m.querySelector('.modal-win') || m;
      win.setAttribute('tabindex', '-1');
      win.focus({ preventScroll: true });
    } else if (focusEl) focusEl.focus();
    sfx('open');
  }
  function closeModal() {
    if (!activeModal) return;
    if (activeModal.id === 'fpmodal') musicGuestEnd();   // esci dal profilo di un amico: torna la tua musica
    sfx('close');
    activeModal.hidden = true;
    activeModal = null;
    resetArm(false);
    custResetArm(false);
    mfDelArm(false);
    clearPasteSlot();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    // un attimo dopo: se chi ha chiuso questa finestra ne apre subito un'altra (profilo di un amico, impostazioni...),
    // le penalità aspettano che si chiuda anche quella invece di aprirsi sotto di lei
    setTimeout(checkPenalties, 0);
  }
  function dataMsg(t) { $('data-msg').textContent = t; }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (activeModal) closeModal();
      else if (!$('levelup').hidden) hideLevelUp();
    }
    if (e.key === 'Tab' && activeModal) {
      const f = [...activeModal.querySelectorAll('button, textarea, input')]
        .filter(n => !n.hidden && !n.disabled && n.type !== 'file' && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function tryDownload(text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'life_rpg_save.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) { return false; }
  }

  // il salvataggio completo (usato dal backup)
  function buildBackup() {
    const out = { ...xp, _settings: settings };
    out._images = Object.fromEntries(IMG_NAMES.filter(n => imgs[n]).map(n => [n, imgs[n]]));
    out._missions = missions;
    out._routines = routines;
    return out;
  }
  const isBackup = obj => !!obj && typeof obj === 'object' && Object.keys(obj).some(k => (ALIASES[k] || k) in blank());
  // importare un backup sostituisce i dati: vale come una modifica fatta adesso, che vince anche sugli altri dispositivi
  function applyBackup(obj) {
    xp = normalize(obj);
    xpAbs = Date.now();   // gli XP del backup si scrivono così come sono
    if (obj._settings) {
      settings = mergeSettings(obj._settings);
      settingsTouched = true;
      sync.sAt = Date.now(); saveSync();
      saveSettingsLocal();
      applyAll();
      paintCustom();
    }
    if (obj._images && typeof obj._images === 'object') {
      IMG_NAMES.forEach(n => {
        const v = validImg(obj._images[n]) ? obj._images[n] : null;
        if (imgs[n] !== v) setImg(n, v);
      });
    }
    if (Array.isArray(obj._missions)) {
      const months = new Set(missions.map(monthOf));
      const next = normalizeMissions(obj._missions), keep = new Set(next.map(m => m.id));
      tombMissions(missions.filter(m => !keep.has(m.id)));
      missions = next;
      const epoch = Date.now();
      missions.forEach(m => { months.add(monthOf(m)); m.z = epoch; delete m.c; mSeen.set(m.id, { g: '', e: effOf(m) }); });   // nuova epoca: gli XP del backup sono già scritti per intero
      months.forEach(touchMonth);
      renderMissionViews();
    }
    if (Array.isArray(obj._routines)) {
      const next = normalizeRoutines(obj._routines), keep = new Set(next.map(r => r.id));
      routines.filter(r => !keep.has(r.id)).forEach(r => tombRoutine(r.id));
      routines = next;
      rSeen.clear();
      saveRoutinesLocal();
    }
    if (syncRoutines()) renderMissionViews();
    persist();
    render(true);
  }

  $('btn-export').addEventListener('click', async () => {
    const text = JSON.stringify(buildBackup(), null, 2);
    if (downloadsCap) {
      try {
        await downloadsCap.save({ filename: 'life_rpg_save.json', data: text });
        dataMsg(T('data.msg.exported'));
        return;
      } catch (e) {
        if (e && e.code === 'declined') { dataMsg(T('data.msg.cancelled')); return; }
      }
    }
    const started = tryDownload(text);
    const box = $('json-box');
    box.value = text; box.hidden = false;
    if (!started) { box.focus(); box.select(); }
    dataMsg(started
      ? T('data.msg.downloading')
      : T('data.msg.copy'));
  });

  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => dataMsg(T('data.msg.readerr'));
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (!isBackup(obj)) { dataMsg(T('data.msg.unknown')); return; }
        applyBackup(obj);
        dataMsg(T('data.msg.imported'));
      } catch (err) {
        dataMsg(T('data.msg.badjson'));
      }
    };
    reader.readAsText(file);
  });



  const resetBtn = $('btn-reset');
  resetBtn.addEventListener('click', () => {
    if (!resetBtn.dataset.armed) { resetArm(true); return; }   // solo "Azzera tutto" → "Conferma", nello stesso punto
    resetArm(false);
    xp = blank(); xpAbs = Date.now(); persist(); render(true);
    const months = new Set(missions.map(monthOf));
    tombMissions(missions);
    missions = [];
    routines.forEach(r => tombRoutine(r.id));
    routines = []; saveRoutinesLocal();
    months.forEach(touchMonth);
    renderMissionViews();
    dataMsg(T('data.msg.wiped'));
  });

  /* ================= personalizzazione ================= */
  // Finestra Impostazioni, pannello Personalizza, applicazione dell'aspetto e caricamento immagini: settings-ui.js
  const SET = window.LIFE_RPG_SETTINGS_UI.create({
    LANGS, T, STATS, ICONS, mixHex, winBase, paletteVars, normHex, FRAMES, FITS, defaultSettings, IMG_NAMES, CLOUD_IMG_MAX,
    GIF_MAX_FILE, isGif, validImg, imgs, $, resetArm, custResetArm, icoPx, iconSvg, rows, settingsWin, paneLook,
    openModal, closeModal, dataMsg, applyLang, applyAll, changed, setImg, renderInfo, loadFirebase, schedulePublish,
    get missionMsg() { return missionMsg; },   // definito più avanti (missions-ui.js)
  }, {
    get settings() { return settings; }, set settings(v) { settings = v; },
    get dbRef() { return dbRef; },
    get fbAuth() { return fbAuth; },
    get activeModal() { return activeModal; },
  });
  const {
    openSettings, applyTheme, applyFrame, applyTextColors, applyTransparency, applyName, applyTitle, statColor, applyImages, cs, buildCustom, paintCustom, wireDrops, clearPasteSlot,
  } = SET;
  // cambia lingua: aggiorna tutti i testi della pagina
  function applyLang() {
    lang = LANGS.some(l => l.id === settings.lang) ? settings.lang : 'it';
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = T(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = T(n.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', T(n.dataset.i18nAria)); });
    $('btn-settings').title = T('nav.settings');
    document.querySelectorAll('#settings .btn.reset').forEach(b => { b.title = T('btn.default'); });
    STATS.forEach((s, i) => {
      const r = rows[s.key];
      r.nm.textContent = s.name;
      r.lvT.textContent = T('lv');
      radarNames[POS[i]].textContent = s.name;
    });
    formLabels.forEach(([s, a, c]) => { a.textContent = s.name; c.textContent = s.name; });
    document.querySelectorAll('#settings input[type="color"]').forEach(c => {
      if (c._hex) c._hex.setAttribute('aria-label', T('hex.aria'));
    });
    paintSound(); paintMusic(); resetArm(false); custResetArm(false); mfDelArm(false);
    setSaveState(saveKind);
    if (cs.Vigore) paintCustom();
    render(false);
    renderMissionViews();
    renderInfo();
    paintAccount();
    paintFriendsBtn();
    paintFormRepeat();
    if (!rmodal.hidden) renderRoutines();
  }
  function applyAll() { applyLang(); applyTheme(); applyFrame(); applyTextColors(); applyTransparency(); applyName(); applyTitle(); applyImages(); }

  let setTimer = 0;
  function changed(soon) {
    settingsTouched = true;
    sync.sAt = Date.now(); saveSync();   // le impostazioni vincono per intero: conta l'ultima modifica
    saveSettingsLocal();
    schedulePublish();
    clearTimeout(setTimer);
    if (soon) setTimer = setTimeout(flush, 600); else flush();
  }

  /* ----- immagini: salvataggio e invio all'account ----- */
  // (il caricamento da file, appunti e trascinamento è in settings-ui.js)
  const imgQueue = new Set();
  let imgBusy = false;

  async function flushImgs() {
    if (!dbRef || imgBusy) return;
    imgBusy = true;
    let name = null;
    try {
      while (imgQueue.size && dbRef) {
        name = imgQueue.values().next().value;
        imgQueue.delete(name);
        const ref = dbImgs().doc(name);
        if (imgs[name]) { if (imgs[name].length <= CLOUD_IMG_MAX) await ref.set({ v: 1, data: imgs[name] }); } else await ref.delete();
        name = null;
      }
    } catch (e) {
      if (name) imgQueue.add(name);   // si riprova più tardi
      syncFail(e);
    }
    imgBusy = false;
  }
  function dbImgs() { return dbRef.collection('imgs'); }

  // applica e salva un'immagine (null = toglie); risolve false se il browser non ha spazio
  async function setImg(name, data) {
    imgs[name] = data;
    imgTouched.add(name);
    const saving = saveImgLocal(name);     // l'immagine si vede subito, senza aspettare il salvataggio
    applyImages();
    if (cs.Vigore) paintCustom();
    imgQueue.add(name);
    flushImgs();
    return saving;
  }

  /* ================= missioni e calendario ================= */
  // Le regole (date, scadenze, ordine, routine, penalità, Google Calendar) sono in missions.js,
  // la parte che si vede è in missions-ui.js. Qui restano mk (usato da tutta l'app) e il salvataggio.
  // crea un elemento della pagina, con classe e testo
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // salvataggio: un documento per mese di creazione, così non crescono troppo
  const monthQueue = new Set();
  let monthBusy = false;
  // ogni mese si scrive in una transazione: si legge quello che c'è nell'account, lo si unisce
  // missione per missione con quello di questo dispositivo e si riscrive il risultato
  async function flushMonth(ym) {
    const ref = dbRef.collection('m').doc(ym);
    let out = null;
    await txDoc(ref, cur => {
      const R = normalizeMissions(cur && cur.items).filter(m => monthOf(m) === ym);
      const res = mergeItems(missions.filter(m => monthOf(m) === ym), sync.mDel[ym] || {}, R, normDel(cur && cur.del), missionSig);
      out = JSON.parse(JSON.stringify({ v: 2, items: res.items, del: res.del }));
      return out;
    });
    return mergeMonth(ym, normalizeMissions(out.items), out.del);
  }
  async function flushMissions() {
    if (!dbRef || monthBusy) return;
    monthBusy = true;
    let ym = null, redraw = false, xpAny = false;
    try {
      while (monthQueue.size && dbRef) {
        ym = monthQueue.values().next().value;
        monthQueue.delete(ym);
        const r = await flushMonth(ym);
        redraw = redraw || r.changed; xpAny = xpAny || r.xpChanged;
        ym = null;
      }
      syncOk();
    } catch (e) {
      if (ym) monthQueue.add(ym);   // si riprova più tardi
      syncFail(e);
    }
    monthBusy = false;
    if (xpAny) persist();
    if (redraw || xpAny) { render(false); renderMissionViews(); }
  }
  // da chiamare dopo ogni modifica alle missioni di un mese: segna l'istante delle missioni cambiate, salva e manda
  function stampMonth(ym) {
    const now = Date.now();
    missions.forEach(m => {
      if (monthOf(m) !== ym) return;
      const g = missionSig(m), was = mSeen.get(m.id);
      if (was && was.g === g) return;
      m.u = Math.max(now, (m.u || 0) + 1);
      // quanto è cambiato qui l'effetto sugli XP: si aggiunge alla voce di questo dispositivo nel registro
      const e = effOf(m);
      const c = SYNC.stampLedger(m.c, was ? was.e : {}, e, DEV);
      if (c) m.c = c; else delete m.c;
      mSeen.set(m.id, { g, e });
    });
  }
  function touchMonth(ym) {
    stampMonth(ym);
    monthQueue.add(ym);
    saveMissionsLocal();
    flushMissions();
  }

  /* ----- la parte che si vede: missions-ui.js ----- */
  // Schede, elenco, calendario, finestre di missioni e routine, penalità e messaggi sono in missions-ui.js.
  // D = funzioni e valori che non cambiano; S = stato che cambia (letto sempre "fresco").
  const MUI = window.LIFE_RPG_MISSIONS_UI.create({
    GAME, MISSIONS, T, TN, locale, fmt, sfx, $, mk, mfDelArm, selArm, reduce, iconSvg, digitsSvg,
    saveRoutinesLocal, tombMissions, tombRoutine, persist, render, floatText, showLevelUp, openModal, closeModal,
    statColor, readable, touchMonth, showView,
    get nameSpan() { return nameSpan; },   // definito più avanti (sezione "info")
  }, {
    get missions() { return missions; }, set missions(v) { missions = v; },
    get routines() { return routines; }, set routines(v) { routines = v; },
    get xp() { return xp; },
    get dbRef() { return dbRef; },
    get activeModal() { return activeModal; },
  });
  const {
    missionMsg, syncRoutines, checkPenalties, collapseMissionLists, renderMissions, renderCalendar, renderMissionViews, initCal, formLabels, paintFormRepeat, sel, rmodal, renderRoutines,
  } = MUI;

  /* ================= musica ================= */
  // La musica (un brano per ogni ruolo, tabella MUSIC_FILES) è in audio.js: qui ci sono solo i comandi.
  const musicBtn = $('btn-music'), musicSlider = $('in-music-vol'), musicVal = $('music-val');
  function paintMusic() {
    musicBtn.textContent = AUDIO.musicOn() ? T('music.on') : T('music.off');
    musicBtn.setAttribute('aria-pressed', String(AUDIO.musicOn()));
    musicSlider.value = String(AUDIO.musicPct());
    musicVal.textContent = AUDIO.musicPct() + '%';
  }
  musicBtn.addEventListener('click', () => {
    AUDIO.setMusic(!AUDIO.musicOn());
    paintMusic();
    if (AUDIO.musicOn()) musicPlay(); else musicStop();
  });
  musicSlider.addEventListener('input', e => {
    AUDIO.setMusicVolume(e.target.value);
    paintMusic();
  });
  // i browser non fanno partire la musica prima che tu tocchi qualcosa: al primo tocco (su qualsiasi scheda) parte
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
    if (AUDIO.musicWanted() && AUDIO.musicIdle()) musicPlay();
  }, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) musicStop(true); else musicSync(); });
  paintMusic();

  /* ================= schede e icone ================= */
  // viste: Personaggio, Statistiche, Missioni, Calendario
  let curView = 'char';
  const VIEWS = { char: ['vt-char', 'view-char'], stats: ['vt-stats', 'view-stats'], missions: ['vt-missions', 'view-missions'], cal: ['vt-cal', 'view-cal'] };
  function showView(name) {
    const prevView = curView;
    curView = name;
    musicSync(name === 'char' && prevView !== 'char');
    // lasciando la scheda Missioni, i gruppi aperti con "Mostra altre" si richiudono
    if (prevView === 'missions' && name !== 'missions') { sel.list = null; sel.ids.clear(); collapseMissionLists(); }
    Object.entries(VIEWS).forEach(([n, [t, v]]) => {
      $(v).hidden = n !== name;
      $(t).setAttribute('aria-selected', String(n === name));
      $(t).tabIndex = n === name ? 0 : -1;
    });
    if (name !== 'char') missionMsg('');
    if (name === 'missions') renderMissions();
    if (name === 'cal') renderCalendar();
  }
  const VIEW_ORDER = ['char', 'stats', 'missions', 'cal'];
  // icone pixel della navigazione (11 x 10, X = pixel pieno)
  const NAV_ICONS = {
    char: ['....XXX....','...XXXXX...','...XXXXX...','...XXXXX...','....XXX....','...........','..XXXXXXX..','.XXXXXXXXX.','.XXXXXXXXX.','.XXXXXXXXX.'],
    stats: ['........XXX','........XXX','........XXX','........XXX','....XXX.XXX','....XXX.XXX','XXX.XXX.XXX','XXX.XXX.XXX','...........','XXXXXXXXXXX'],
    missions: ['XXXXXXXXXXX','XXXXXXXXXXX','.X.......X.','.X.XXXXX.X.','.X.......X.','.X.XXXXX.X.','.X.......X.','.X.XXX...X.','XXXXXXXXXXX','XXXXXXXXXXX'],
    cal: ['.XX.....XX.','XXXXXXXXXXX','XXXXXXXXXXX','X.........X','X.X.X.X.X.X','X.........X','X.X.X.X.X.X','X.........X','X.X.X.X.X.X','XXXXXXXXXXX'],
  };
  VIEW_ORDER.forEach(n => $('ni-' + n).insertAdjacentHTML('afterbegin', iconSvg(NAV_ICONS[n])));
  // cambio di schermata fatto dall'utente: suona la nota della scheda (solo se davvero cambia)
  const goView = n => { if (n !== curView) sfx('tab', VIEW_ORDER.indexOf(n)); showView(n); };
  VIEW_ORDER.forEach((n, i) => {
    const b = $(VIEWS[n][0]);
    b.addEventListener('click', () => goView(n));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const to = VIEW_ORDER[(i + (e.key === 'ArrowRight' ? 1 : VIEW_ORDER.length - 1)) % VIEW_ORDER.length];
      goView(to);
      $(VIEWS[to][0]).focus();
    });
  });
  // icone delle schede delle Impostazioni (11 x 11)
  const TAB_ICONS = {
    look: ['....XXX....', '..XXX..XX..', '.XXXX...XX.', '.XXXX....X.', 'XXXXX.....X', 'XXXXX.....X', 'XXXXX.....X', '.XXXX....X.', '.XXXX...XX.', '..XXX..XX..', '....XXX....'],
    lang: ['...XXXXX...', '.XX..X..XX.', '.X..X.X..X.', 'X...X.X...X', 'X..X...X..X', 'XXXXXXXXXXX', 'X..X...X..X', 'X...X.X...X', '.X..X.X..X.', '.XX..X..XX.', '...XXXXX...'],
    sound: ['....X......', '...XX...X..', '..XXX....X.', 'XXXXX.X..X.', 'XXXXX..X..X', 'XXXXX..X..X', 'XXXXX..X..X', 'XXXXX.X..X.', '..XXX....X.', '...XX...X..', '....X......'],
    data: ['XXXXXXXXX..', 'XX.....XXX.', 'XX.XXX.XXXX', 'XX.XXX.XXXX', 'XX.....XXXX', 'XXXXXXXXXXX', 'X.........X', 'X.XXXXXXX.X', 'X.........X', 'X.XXXXXXX.X', 'XXXXXXXXXXX'],
    info: ['...XXXXX...', '.XX.....XX.', '.X.......X.', 'X....X....X', 'X.........X', 'X....X....X', 'X....X....X', 'X....X....X', '.X.......X.', '.XX.....XX.', '...XXXXX...'],
  };
  Object.keys(TAB_ICONS).forEach(k => $('tab-' + k).insertAdjacentHTML('afterbegin', iconSvg(TAB_ICONS[k], 3)));
  // freccia "torna al predefinito" dei colori (9 x 9)
  document.querySelectorAll('#settings .btn.reset').forEach(b => { b.innerHTML = iconSvg(['..X......', '.XX......', 'XXXXXXX..', '.XX....X.', '..X.....X', '........X', '........X', '.X.....X.', '..XXXXX..'], 3); });
  // ingranaggio delle Impostazioni (11 x 11, X = pixel pieno)
  $('btn-settings').innerHTML = iconSvg(['....XXX....', '.XX.XXX.XX.', '.XXXXXXXXX.', '..XXXXXXX..', 'XXXX...XXXX', 'XXXX...XXXX', 'XXXX...XXXX', '..XXXXXXX..', '.XXXXXXXXX.', '.XX.XXX.XX.', '....XXX....'], 3);
  /* ================= info: la guida del giocatore ================= */
  const nameSpan = key => {
    const s = STATS.find(x => x.key === key);
    const e = mk('span', null, s.name);
    e.style.color = readable(statColor(key));
    return e;
  };
  function renderInfo() {
    const box = $('info-list');
    const wasOpen = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.id));
    const first = !box.firstChild;
    box.textContent = '';
    // id: resta uguale in tutte le lingue, così le sezioni aperte restano aperte cambiando lingua
    const section = (id, title) => {
      const det = mk('details', 'info-sec');
      det.dataset.id = id;
      det.appendChild(mk('summary', null, title));
      if (first ? id === 'play' : wasOpen.has(id)) det.open = true;
      const body = mk('div', 'info-body');
      det.appendChild(body);
      box.appendChild(det);
      return body;
    };
    const p = (body, text) => body.appendChild(mk('p', null, text));
    const range = (arr, i) => {
      const from = arr[i][0], to = i > 0 ? arr[i - 1][0] - 1 : null;
      if (to === null) return T('range.up', { from });
      return from === 0 ? T('range.below', { n: to + 1 }) : T('range.from', { from, to });
    };

    // come si gioca
    let b = section('play', T('info.play.h'));
    p(b, T('info.play.p1'));
    p(b, T('info.play.p2'));

    // livelli e XP
    b = section('levels', T('info.lvl.h'));
    p(b, T('info.lvl.p1'));
    p(b, T('info.lvl.p2'));
    const table = mk('table', 'info-table');
    const head = mk('tr'); head.append(mk('th', null, T('info.lvl.col1')), mk('th', null, T('info.lvl.col2')));
    table.appendChild(head);
    [1, 5, 10, 25, 50, 100].forEach(l => {
      const tr = mk('tr'); tr.append(mk('td', null, String(l)), mk('td', null, fmt(xpForLevel(l))));
      table.appendChild(tr);
    });
    b.appendChild(table);
    p(b, T('info.lvl.p3'));

    // titolo del personaggio
    b = section('title', T('info.title.h'));
    p(b, T('info.title.p1'));
    p(b, T('info.title.p2'));
    p(b, T('info.title.lead', { min: SPEC_MIN_LEVEL }));
    // un gruppo apribile per ogni numero di statistiche in testa, con tutti i titoli
    const titleBody = b;
    const group = (id, heading, items) => {
      const det = mk('details', 'info-sub');
      det.dataset.id = id;
      det.appendChild(mk('summary', null, heading + ' (' + items.length + ')'));
      if (wasOpen.has(id)) det.open = true;
      const ul = mk('ul', 'info-ul');
      items.forEach(it => ul.appendChild(it));
      const inner = mk('div', 'info-sub-body');
      inner.appendChild(ul);
      det.appendChild(inner);
      titleBody.appendChild(det);
    };
    const combo = (keys, name) => {
      const li = mk('li');
      li.append(mk('span', null, name), mk('span', 'dim', ': '));
      keys.forEach((k, i) => { if (i) li.append(mk('span', 'dim', ' + ')); li.append(nameSpan(k)); });
      return li;
    };
    group('title-g1', T('info.title.g1'), STATS.map(s => combo([s.key], s.cls)));
    group('title-g2', T('info.title.g2'), Object.entries(PAIRS).map(([k, id]) => combo(k.split('+'), T('pair.' + id))));
    group('title-g3', T('info.title.g3'), Object.entries(TRIPLES).map(([k, id]) => combo(k.split('+'), T('triple.' + id))));
    group('title-g4', T('info.title.g4'), Object.entries(QUADS).map(([k, id]) => combo(k.split('+'), T('quad.' + id))));
    group('title-g5', T('info.title.g5'), STATS.map(s => {
      const li = mk('li');
      li.append(mk('span', null, T('quint.' + QUINTS[s.key])), mk('span', 'dim', ': ' + T('info.title.except') + ' '), nameSpan(s.key));
      return li;
    }));
    p(b, T('info.title.p3'));
    const tl = mk('ul', 'info-ul');
    for (let i = TIERS.length - 1; i >= 0; i--) {
      const li = mk('li'); li.append(mk('span', null, T('tier.' + TIERS[i][1])), mk('span', 'dim', ': ' + range(TIERS, i)));
      tl.appendChild(li);
    }
    b.appendChild(tl);
    p(b, T('info.title.grade.p', { list: GRADES.filter(g => g[1]).reverse().map(g => T('grade.' + g[1])).join(', ') }));

    // missioni
    b = section('missions', T('info.mis.h'));
    p(b, T('info.mis.p1'));
    p(b, T('info.mis.p2'));
    p(b, T('info.mis.p3'));
    p(b, T('info.mis.p4'));
    p(b, T('info.mis.p7'));
    p(b, T('info.mis.p5'));
    p(b, T('info.mis.p6'));

    // amici
    b = section('friends', T('info.fr.h'));
    p(b, T('info.fr.p1'));
    p(b, T('info.fr.p2'));

    // dati
    b = section('data', T('info.data.h'));
    p(b, dbRef ? T('info.data.cloud') : storageOk ? T('info.data.local') : T('info.data.nostorage'));
    p(b, T(dbRef ? 'info.data.p3' : 'info.data.p3.local'));   // con l'account il backup è una copia di sicurezza, senza è l'unico modo di trasferire i dati
  }

  /* ================= avvio ================= */
  initCal();
  renderMissionViews();
  applyAll();
  buildCustom();
  applyLang();   // di nuovo: ora esistono anche le voci create da buildCustom
  wireDrops();
  render(false);

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
      return v === '1' || (v === null && !!localStorage.getItem('liferpg:acc'));   // versione precedente: basta essere stati collegati
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
    if (fbAuth || !fbUsable() || !window.firebase) return !!fbAuth;
    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
      fbAuth = app.auth();
      fbDb = app.firestore();
      return true;
    } catch (e) { console.warn('firebase', e); return false; }
  }
  // al primo avvio Firebase ritrova da solo l'accesso fatto in precedenza (anche offline)
  function fbFirstUser() { return new Promise(res => { const off = fbAuth.onAuthStateChanged(u => { off(); res(u); }); }); }

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
  // il dispositivo ricorda a quale account è già collegato: la scelta "quali dati tenere" si fa una volta sola
  const LS_ACC = 'liferpg:acc';
  const linkedUid = () => { try { return localStorage.getItem(LS_ACC) || ''; } catch (e) { return ''; } };
  const linkUid = uid => lsSet(LS_ACC, uid);
  // confronto senza "u": due copie degli stessi dati sono uguali anche se le modifiche hanno istanti diversi
  const sortedSig = (list, sig) => [...list].sort((a, b) => a.id.localeCompare(b.id)).map(sig).join('\n');
  const remoteMissions = r => Object.values(r.rM).flatMap(x => x.items);
  const deviceHasData = () => hasProgress(xp) || missions.length > 0 || routines.length > 0 || !isDefaultSettings() || IMG_NAMES.some(n => imgs[n]);
  function accountHasData(r) {
    return !!r.d && (hasProgress(normalize(r.d.xp)) || (Array.isArray(r.d.routines) && r.d.routines.length > 0)
      || (!!r.d.settings && JSON.stringify(mergeSettings(r.d.settings)) !== JSON.stringify({ ...defaultSettings(), lang: settings.lang })))
      || remoteMissions(r).length > 0 || Object.keys(r.rImgs).length > 0;
  }
  function sameData(r) {
    if (!r.d) return false;
    return JSON.stringify(normalize(r.d.xp)) === JSON.stringify(xp)
      && JSON.stringify(mergeSettings(r.d.settings || {})) === JSON.stringify(settings)
      && sortedSig(normalizeRoutines(r.d.routines || []), routineSig) === sortedSig(routines, routineSig)
      && sortedSig(remoteMissions(r), missionSig) === sortedSig(missions, missionSig)
      && IMG_NAMES.every(n => {
        const here = imgs[n] || null;
        if (here && here.length > CLOUD_IMG_MAX) return true;   // troppo grande per l'account: non conta
        return (r.rImgs[n] || null) === here;
      });
  }
  // riassunto di un insieme di dati per la finestra della scelta
  function dataSummary(x, list) {
    const total = STATS.reduce((t, s) => t + (x[s.key] || 0), 0);
    return TN('acc.sum', list.length, { lv: overallOf(STATS.map(s => levelFromXp(x[s.key]))), xp: fmt(total) });
  }

  // carica i dati dall'account (ref = documento del giocatore) e li unisce a quelli di questo dispositivo.
  // uid: l'account Firebase; se il dispositivo non è ancora collegato e sia l'account sia il dispositivo
  // hanno dati diversi, prima si chiede quali tenere. key: a chi appartiene lo stato di sincronizzazione.
  async function cloudLoad(ref, uid, key) {
    const r = await cloudFetch(ref);
    if (uid && linkedUid() !== uid && accountHasData(r) && deviceHasData() && !sameData(r)) {
      accPending = { ref, uid, r, key };
      $('acc-choice-acc').textContent = T('acc.choice.acc', { sum: dataSummary(normalize(r.d && r.d.xp), remoteMissions(r)) });
      $('acc-choice-dev').textContent = T('acc.choice.dev', { sum: dataSummary(xp, missions) });
      openModal($('accmodal'), $('acc-keep-acc'));
      return;
    }
    cloudApply(ref, r, 'merge', !!uid && linkedUid() !== uid, key || uid);
    if (uid) linkUid(uid);
  }
  // mode: 'merge' = unisce (per ogni missione, routine e impostazione vince la modifica più recente; gli XP si sommano
  //         come differenze); 'account' = tiene solo i dati dell'account; 'device' = tiene solo quelli di questo dispositivo
  // firstLink: primo collegamento di questo dispositivo all'account (un'immagine che manca nell'account non va tolta)
  function cloudApply(ref, r, mode, firstLink, key) {
    const d = r.d || {};
    const S = normalize(d.xp);
    dbRef = ref;
    setSaveState('account');
    if (mode === 'merge' && sync.key !== key) {
      // primo collegamento (o un altro account): i dati di adesso sono il punto di partenza.
      // Se l'account ha già dei progressi, gli XP di qui sono gli stessi (dati uguali) oppure zero (dispositivo nuovo);
      // se l'account è vuoto, tutti gli XP di qui sono da mandare.
      const keepAt = settingsTouched ? sync.sAt : 0;
      sync = blankSync(key);
      sync.sAt = keepAt;
      sync.xpBase = hasProgress(S) ? { ...xp } : blank();
      absorbLocal();
      STATS.forEach(s => { sync.pend[s.key] = xp[s.key] - sync.xpBase[s.key]; });
    }
    if (mode === 'account') {
      sync = blankSync(key);
      sync.xpBase = rawOf(d); sync.rev = Number(d.rev) || 0; recomputeXp();
      settingsTouched = false; imgTouched.clear();
      if (d.settings) { settings = mergeSettings(d.settings); sync.sAt = Number(d.sAt) || 0; saveSettingsLocal(); applyAll(); paintCustom(); }
      else userDirty = true;   // l'account non ha ancora le impostazioni: si mandano quelle di qui
      routinesApplying = true;
      routines = normalizeRoutines(d.routines); sync.rDel = normDel(d.rDel); saveRoutinesLocal();
      routinesApplying = false;
      rSeen.clear(); routines.forEach(x => rSeen.set(x.id, routineSig(x)));
      missions = remoteMissions(r);
      mSeen.clear(); missions.forEach(m => mSeen.set(m.id, seenOf(m)));
      Object.entries(r.rM).forEach(([ym, x]) => { if (Object.keys(x.del).length) sync.mDel[ym] = x.del; });
      saveLocal(); saveMissionsLocal(); saveSync();
    } else if (mode === 'device') {
      // i dati di qui vincono su tutto: si segnano come modificati adesso e ciò che c'è solo nell'account si elimina
      const now = Date.now();
      sync = blankSync(key);
      sync.xpBase = { ...xp }; sync.xpSeen = { ...xp }; xpAbs = now; sync.sAt = now; sync.rev = Number(d.rev) || 0;
      routines.forEach(x => { x.u = now; });
      normalizeRoutines(d.routines).forEach(x => { if (!routines.some(y => y.id === x.id)) sync.rDel[x.id] = { t: now }; });
      missions.forEach(m => { m.u = now; m.z = now; delete m.c; mSeen.set(m.id, seenOf(m)); });   // nuova epoca: gli XP sono già scritti per intero
      Object.entries(r.rM).forEach(([ym, x]) => x.items.forEach(m => {
        if (!missions.some(y => y.id === m.id)) (sync.mDel[ym] = sync.mDel[ym] || {})[m.id] = { t: now, z: now };
      }));
      new Set([...missions.map(monthOf), ...Object.keys(r.rM)]).forEach(ym => monthQueue.add(ym));
      IMG_NAMES.forEach(n => { if (imgs[n] || r.rImgs[n]) imgTouched.add(n); });   // solo quelle da salvare o da togliere
      userDirty = true;
      saveMissionsLocal(); saveSync();
      routinesApplying = true; saveRoutinesLocal(); routinesApplying = false;
    } else {
      const u = applyUserDoc(d, null, true);
      if (u.dirty) userDirty = true;
      new Set([...Object.keys(r.rM), ...missions.map(monthOf)]).forEach(ym => {
        const x = r.rM[ym] || { items: [], del: {} };
        mergeMonth(ym, x.items, x.del);
      });
      if (hasPend()) userDirty = true;   // XP fatti qui e non ancora nell'account
      if (!r.d) userDirty = true;
    }
    // immagini: l'account è la fonte, tranne quelle modificate in questa sessione
    IMG_NAMES.forEach(n => {
      if (imgTouched.has(n)) { imgQueue.add(n); return; }
      const v = r.rImgs[n] || null;
      // primo collegamento: l'account non ha questa immagine, il dispositivo sì → si tiene e si carica nell'account
      if (firstLink && mode === 'merge' && !v && imgs[n]) { if (imgs[n].length <= CLOUD_IMG_MAX) imgQueue.add(n); return; }
      if (mode !== 'account' && imgs[n] && imgs[n].length > CLOUD_IMG_MAX) return;   // troppo grande per l'account: resta quella di questo dispositivo
      if (imgs[n] !== v) { imgs[n] = v; saveImgLocal(n); }
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
    if (fbUser && ref !== null) { schedulePublish(true); checkFriendRequests(); }
  }
  function accChoose(mode) {
    const p = accPending;
    if (!p) return;
    accPending = null;
    closeModal();
    cloudApply(p.ref, p.r, mode, false, p.key || p.uid);
    linkUid(p.uid);
    accMsg(T(mode === 'account' ? 'acc.msg.acc' : 'acc.msg.dev'));
    paintAccount();
  }
  $('acc-keep-acc').addEventListener('click', () => accChoose('account'));
  $('acc-keep-dev').addEventListener('click', () => accChoose('device'));

  async function initCloudInner() {
    // pagina pubblicata come artifact su claude.ai: usa il salvataggio di quella piattaforma
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        const [db, user, dl] = await Promise.all([
          window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads'),
        ]);
        downloadsCap = dl || null;
        const uid = user ? await user.id() : null;
        if (!db || !uid) { setSaveState('local'); return; }
        await cloudLoad(db.doc('data/users/' + uid + '/rpg'), null, 'claude:' + uid);
      } catch (e) {
        console.warn('cloud', e);
        if (!dbRef) setSaveState('local');
      }
      return;
    }
    // app sul sito: account Firebase, se hai già fatto l'accesso
    if (!wasSignedIn() || !(await loadFirebase()) || !fbInit()) { setSaveState('local'); paintAccount(); return; }
    fbUser = await fbFirstUser();
    paintAccount();
    if (!fbUser) { markSigned(false); setSaveState('local'); return; }
    markSigned(true);
    await fbConnect();
  }
  // collega l'account (carica e unisce i dati). Se in quel momento manca la connessione si riprova da soli:
  // quando torna internet, quando torni sull'app, quando apri gli amici. Nel frattempo si salva sul dispositivo.
  let cloudJob = null;
  function fbConnect() {
    if (!fbUser || dbRef || accPending) return Promise.resolve();
    if (cloudJob) return cloudJob;
    cloudJob = (async () => {
      try { await cloudLoad(fbDb.doc('users/' + fbUser.uid), fbUser.uid, fbUser.uid); }
      catch (e) { console.warn('cloud', e); if (!dbRef) setSaveState('local'); }
      paintAccount();
    })().finally(() => { cloudJob = null; });
    return cloudJob;
  }
  // quando torna la rete o torni sull'app: ci si collega (se non lo si era) e si manda ciò che era rimasto indietro
  window.addEventListener('online', () => { fbConnect(); syncKick(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    fbConnect();
    syncKick();
    if (dbRef && !unsubs.length) cloudRefresh();   // senza aggiornamenti in diretta (claude.ai): si rilegge l'account
  });
  // rilettura completa dell'account, per chi non ha gli aggiornamenti in diretta
  let refreshing = false;
  async function cloudRefresh() {
    if (refreshing || !dbRef || writing) return;
    refreshing = true;
    try {
      const r = await cloudFetch(dbRef);
      if (r.d) onUserSnap(r.d);
      let any = false, xpAny = false;
      Object.entries(r.rM).forEach(([ym, x]) => { const m = mergeMonth(ym, x.items, x.del); any = any || m.changed; xpAny = xpAny || m.xpChanged; });
      if (xpAny) persist();
      if (any || xpAny) { render(false); renderMissionViews(); }
      if (monthQueue.size) flushMissions();
    } catch (e) { console.warn('refresh', e); }
    refreshing = false;
  }

  /* ================= amici ================= */
  // Ogni giocatore ha un codice amico (8 caratteri) e un profilo pubblico: nome, livello complessivo,
  // XP delle sei statistiche (da cui l'app dell'amico ricalcola titolo e grafico nella sua lingua).
  // Il profilo lo leggono solo gli amici (regole su Firebase). Le missioni non escono mai dall'account.
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // niente 0/O e 1/I, che si confondono
  const fmtCode = c => c ? c.slice(0, 4) + '-' + c.slice(4) : '';
  const cleanCode = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pairOf = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  function imgId(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + str.length.toString(36);
  }
  // sfondi degli amici conservati sul dispositivo (IndexedDB, non tocca lo spazio dei tuoi salvataggi):
  // uno per amico, sostituito solo quando l'amico cambia sfondo, cancellato se non è più tuo amico
  const bgCache = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('idb')); return; }
      const r = indexedDB.open('liferpg-friends', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('bg');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('bg', mode), st = t.objectStore('bg');
        const out = fn(st);
        t.oncomplete = () => res(out && out.result);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      get: uid => tx('readonly', st => st.get(uid)).catch(() => null),
      put: (uid, v) => tx('readwrite', st => st.put(v, uid)).catch(() => {}),
      del: uid => tx('readwrite', st => st.delete(uid)).catch(() => {}),
      keys: () => tx('readonly', st => st.getAllKeys()).catch(() => []),
    };
  })();
  function genCode() {
    const b = new Uint32Array(8);
    crypto.getRandomValues(b);
    return [...b].map(v => CODE_CHARS[v % CODE_CHARS.length]).join('');
  }
  // il tuo codice: se non c'è ancora se ne crea uno libero (se è già preso da qualcuno le regole rifiutano e si riprova)
  function ensureCode() {
    if (myCode) return Promise.resolve(myCode);
    if (codeJob) return codeJob;
    const uid = fbUser.uid;
    codeJob = (async () => {
      const ps = await fbDb.doc('profiles/' + uid).get();
      if (ps.exists && ps.data().code) return (myCode = ps.data().code);
      for (let i = 0; i < 6; i++) {
        const c = genCode();
        try { await fbDb.doc('friendCodes/' + c).set({ uid }); return (myCode = c); } catch (e) { /* codice già usato */ }
      }
      throw new Error('code');
    })().finally(() => { codeJob = null; });
    return codeJob;
  }
  // profilo pubblico: si riscrive solo se è cambiato qualcosa che gli amici vedono
  function schedulePublish(now) {
    if (!fbUser || !dbRef || accPending) return;
    clearTimeout(pubTimer);
    pubTimer = setTimeout(publishProfile, now ? 0 : 1500);
  }
  async function publishProfile() {
    if (!fbUser || !dbRef) return;
    try {
      const code = await ensureCode();
      const bg = settings.shareBg && imgs.bg && imgs.bg.length <= CLOUD_IMG_MAX ? imgs.bg : null;
      const bgId = bg ? imgId(bg) : '';
      const look = { bg: !!bg, bgId, lang: settings.lang };   // la lingua: gli amici vedono la tua scheda come la vedi tu
      ['winColor', 'inkColor', 'softColor', 'accentColor', 'nameColor'].forEach(k => { if (settings[k]) look[k] = settings[k]; });
      const pub = { name: settings.name.trim().slice(0, 30), level: overallOf(STATS.map(s => levelFromXp(xp[s.key]))), stats: { ...xp }, look, code };
      // sfondo: solo se l'hai scelto tu; se lo spegni o lo togli, sparisce anche per gli amici.
      // Si carica solo quando cambia davvero: l'impronta (bgId) dice se quello online è già questo.
      if (pubBgId === undefined) {
        const ps = await fbDb.doc('profiles/' + fbUser.uid).get();
        const old = ps.exists && ps.data().look;
        pubBgId = old ? (old.bgId || (old.bg ? '?' : '')) : '?';   // profilo di una versione precedente: si ricarica una volta
      }
      if (bgId !== pubBgId) {
        const bref = fbDb.doc('profileBg/' + fbUser.uid);
        if (bg) await bref.set({ data: bg, updated: Date.now() });
        else await bref.delete();
        pubBgId = bgId;
      }
      const sig = JSON.stringify(pub);
      if (sig === lastPub) return;
      await fbDb.doc('profiles/' + fbUser.uid).set({ ...pub, updated: Date.now() });
      lastPub = sig;
      if (!$('fmodal').hidden) paintFriendsHead();
    } catch (e) { console.warn('profile', e); }
  }
  function friendsReset() {
    myCode = ''; lastPub = ''; pubBgId = undefined; clearTimeout(pubTimer);
    friends = { rows: [], profs: {}, loaded: false };
    paintFriendsBtn();
  }
  const otherOf = f => f.members.find(m => m !== fbUser.uid);
  function incoming() { return friends.rows.filter(f => f.status === 'pending' && f.requestedBy !== fbUser.uid); }
  function paintFriendsBtn() {
    const n = fbUser && friends.loaded ? incoming().length : 0;
    $('btn-friends').textContent = n ? T('fr.btn.n', { n }) : T('fr.btn');
  }
  async function loadFriends() {
    const q = await fbDb.collection('friendships').where('members', 'array-contains', fbUser.uid).get();
    const rows = q.docs.map(d => ({ id: d.id, ...d.data() }));
    const acc = rows.filter(f => f.status === 'accepted');
    const profs = {};
    await Promise.all(acc.map(async f => {
      const uid = otherOf(f);
      try { const p = await fbDb.doc('profiles/' + uid).get(); if (p.exists) profs[uid] = p.data(); } catch (e) { /* profilo non leggibile */ }
    }));
    friends = { rows, profs, loaded: true };
    paintFriendsBtn();
    const keep = new Set(acc.map(otherOf).filter(uid => profs[uid] && profs[uid].look && profs[uid].look.bg));
    bgCache.keys().then(ks => (ks || []).forEach(k => { if (!keep.has(k)) bgCache.del(k); }));
  }
  async function checkFriendRequests() {
    try { await loadFriends(); } catch (e) { console.warn('friends', e); }
  }
  function frMsg(t, kind) { const e = $('fr-msg'); e.textContent = t || ''; e.className = 'msg' + (kind ? ' ' + kind : ''); }
  const friendName = p => (p && p.name) || T('fr.noname');
  function paintFriendsHead() { $('fr-code').textContent = myCode ? fmtCode(myCode) : '…'; }
  function renderFriends() {
    paintFriendsHead();
    const mkBtn = (cls, text, fn, label) => {
      const b = mk('button', 'btn small' + cls, text); b.type = 'button';
      if (label) b.setAttribute('aria-label', label);
      b.addEventListener('click', fn); return b;
    };
    // richieste ricevute
    const req = $('fr-req'); req.textContent = '';
    incoming().forEach(f => {
      const row = mk('div', 'fr-row');
      row.appendChild(mk('span', 'fr-who', T('fr.from', { name: f.fromName || T('fr.noname') })));
      const act = mk('div', 'fr-act');
      act.append(mkBtn(' add', T('fr.accept'), () => frAct(() => fbDb.doc('friendships/' + f.id).update({ status: 'accepted' }), T('fr.msg.accepted'))),
                 mkBtn('', T('fr.decline'), () => frAct(() => fbDb.doc('friendships/' + f.id).delete(), '')));
      row.appendChild(act); req.appendChild(row);
    });
    $('fr-req-box').hidden = !incoming().length;
    // amici
    const list = $('fr-list'); list.textContent = '';
    const acc = friends.rows.filter(f => f.status === 'accepted')
      .map(f => ({ f, uid: otherOf(f), p: friends.profs[otherOf(f)] }))
      .sort((a, b) => friendName(a.p).localeCompare(friendName(b.p)));
    if (!acc.length) list.appendChild(mk('p', 'empty', T('fr.empty')));
    acc.forEach(({ uid, p }) => {
      const b = mk('button', 'fr-friend');
      b.type = 'button';
      b.append(mk('span', 'fr-who', friendName(p)), mk('span', 'fr-lv', p ? T('lv') + ' ' + p.level : ''));
      b.setAttribute('aria-label', T('fr.open', { name: friendName(p) }));
      b.addEventListener('click', () => openFriendProfile(uid));
      list.appendChild(b);
    });
    // richieste inviate, ancora in attesa
    const out = $('fr-out'); out.textContent = '';
    const mine = friends.rows.filter(f => f.status === 'pending' && f.requestedBy === fbUser.uid);
    mine.forEach(f => {
      const row = mk('div', 'fr-row');
      row.appendChild(mk('span', 'fr-who', T('fr.pending.to', { code: fmtCode(f.toCode || '') })));
      row.appendChild(mkBtn('', T('fr.cancel'), () => frAct(() => fbDb.doc('friendships/' + f.id).delete(), '')));
      out.appendChild(row);
    });
    $('fr-out-box').hidden = !mine.length;
    paintFriendsBtn();
  }
  // esegue un'operazione sugli amici, poi ricarica l'elenco
  async function frAct(job, okText) {
    frMsg(T('fr.msg.wait'));
    try { await job(); await loadFriends(); renderFriends(); frMsg(okText, okText ? 'good' : ''); if (okText) sfx('ok'); }
    catch (e) { console.warn('friends', e); frMsg(T('fr.msg.err'), 'bad'); sfx('err'); }
  }
  async function addFriend() {
    const code = cleanCode($('fr-in').value);
    if (code.length !== 8) { frMsg(T('fr.msg.invalid'), 'bad'); sfx('err'); return; }
    if (code === myCode) { frMsg(T('fr.msg.self'), 'bad'); sfx('err'); return; }
    frMsg(T('fr.msg.wait'));
    try {
      const cs = await fbDb.doc('friendCodes/' + code).get();
      if (!cs.exists) { frMsg(T('fr.msg.notfound'), 'bad'); sfx('err'); return; }
      const uid = cs.data().uid, me = fbUser.uid;
      if (uid === me) { frMsg(T('fr.msg.self'), 'bad'); return; }
      await loadFriends();
      const ex = friends.rows.find(f => f.members.includes(uid));
      if (ex && ex.status === 'accepted') { frMsg(T('fr.msg.already')); renderFriends(); return; }
      if (ex && ex.requestedBy === me) { frMsg(T('fr.msg.pending')); renderFriends(); return; }
      $('fr-in').value = '';
      if (ex) { await frAct(() => fbDb.doc('friendships/' + ex.id).update({ status: 'accepted' }), T('fr.msg.accepted')); return; }   // ti aveva già scritto lui
      await frAct(() => fbDb.doc('friendships/' + pairOf(me, uid)).set({
        members: [me, uid], requestedBy: me, status: 'pending', created: Date.now(),
        fromName: settings.name.trim().slice(0, 30), fromCode: myCode, toCode: code,
      }), T('fr.msg.sent'));
    } catch (e) { console.warn('friends', e); frMsg(T('fr.msg.err'), 'bad'); sfx('err'); }
  }
  async function openFriends(afterMsg) {
    frMsg('');
    const noacc = t => {   // niente amici per ora: senza accesso (con il pulsante) oppure account non raggiungibile
      $('fr-noacc-text').textContent = t;
      $('fr-goacc').hidden = !!fbUser;
      $('fr-noacc').hidden = false; $('fr-main').hidden = true;
    };
    if (!fbUser) { noacc(T('fr.needacc')); openModal($('fmodal'), $('fr-goacc')); return; }
    if (!dbRef) {
      noacc(T('fr.connecting'));
      openModal($('fmodal'), $('fr-close'));
      await fbConnect();
      if ($('fmodal').hidden) return;                  // nel frattempo hai chiuso la finestra
      if (!dbRef) { noacc(T('fr.offline')); return; }
    }
    $('fr-noacc').hidden = true; $('fr-main').hidden = false;
    if ($('fmodal').hidden) openModal($('fmodal'), $('fr-in'));
    renderFriends();
    frMsg(T('fr.msg.wait'));
    try { await ensureCode(); await publishProfile(); await loadFriends(); renderFriends(); frMsg(afterMsg || ''); }
    catch (e) { console.warn('friends', e); frMsg(T('fr.msg.err'), 'bad'); }
  }
  $('btn-friends').addEventListener('click', () => openFriends());
  $('fr-close').addEventListener('click', closeModal);
  $('fmodal').addEventListener('click', e => { if (e.target === $('fmodal')) closeModal(); });
  $('fr-add').addEventListener('click', addFriend);
  $('fr-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFriend(); } });
  $('fr-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(fmtCode(myCode)); frMsg(T('fr.msg.copied'), 'good'); }
    catch (e) { frMsg(fmtCode(myCode)); }
  });
  $('fr-goacc').addEventListener('click', () => { closeModal(); openSettings('data'); });

  // profilo di un amico: la sua scheda Personaggio in sola lettura
  let fpUid = '';
  // i colori dell'amico, come variabili CSS valide solo dentro la finestra del suo profilo
  const FP_VARS = ['--win-a', '--win-b', '--win-c', '--win-edge', '--win-glow', '--ink-soft', '--track', '--btn', '--ink', '--ink-strong', '--gold', '--name-color'];
  function applyFriendLook(el, look) {
    FP_VARS.forEach(v => el.style.removeProperty(v));
    const ok = c => typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : null;
    const L = look || {};
    const win = ok(L.winColor);
    if (win) Object.entries(paletteVars(win)).forEach(([k, v]) => el.style.setProperty(k, v));
    if (ok(L.inkColor)) { el.style.setProperty('--ink', ok(L.inkColor)); el.style.setProperty('--ink-strong', ok(L.inkColor)); }
    if (ok(L.accentColor)) el.style.setProperty('--gold', ok(L.accentColor));
    if (ok(L.nameColor)) el.style.setProperty('--name-color', ok(L.nameColor));
    if (ok(L.softColor)) el.style.setProperty('--ink-soft', ok(L.softColor));
  }
  function openFriendProfile(uid) {
    const p = friends.profs[uid];
    if (!p) { frMsg(T('fr.msg.err'), 'bad'); return; }
    fpUid = uid;
    const x = normalize(p.stats);
    const ov = overallOf(STATS.map(s => levelFromXp(x[s.key])));
    // la sua scheda nella sua lingua (titolo, statistiche, "Lv"); i pulsanti restano nella tua
    const fl = p.look && LANGS.some(l => l.id === p.look.lang) ? p.look.lang : lang;
    const mine = lang;
    lang = fl;
    try {
      $('fp-tab').innerHTML = levelTabSvg(ov, 3);
      $('fp-tab').setAttribute('aria-label', T('lv') + ' ' + ov);
      $('fp-name').textContent = friendName(p);
      $('fp-class').textContent = heroClass(x);
      $('fp-radar').innerHTML = radarMarkup(x);
    } finally { lang = mine; }
    const lc = (LANGS.find(l => l.id === fl) || LANGS[0]).locale;
    $('fpmodal').querySelector('.fp-win').setAttribute('lang', lc ? lc.split('-')[0] : fl);   // pronuncia giusta nei lettori di schermo
    fpArm(false);
    const win = $('fpmodal').querySelector('.fp-win');
    applyFriendLook(win, p.look);
    win.classList.remove('has-bg'); win.style.removeProperty('--fp-bg');
    closeModal();
    openModal($('fpmodal'), $('fp-close'));
    musicGuestStart(x);   // la musica del ruolo dell'amico, dall'inizio
    // lo sfondo (se l'amico lo condivide) arriva dopo: la scheda si vede subito
    if (p.look && p.look.bg) showFriendBg(uid, p.look.bgId || '', win);
    else bgCache.del(uid);
  }
  async function showFriendBg(uid, id, win) {
    const show = d => {
      if (fpUid !== uid || !validImg(d)) return;
      win.style.setProperty('--fp-bg', 'url("' + d + '")');
      win.classList.add('has-bg');
    };
    const c = await bgCache.get(uid);
    if (c && id && c.id === id) { show(c.data); return; }   // è ancora quello: niente download
    try {
      const b = await fbDb.doc('profileBg/' + uid).get();
      const d = b.exists && b.data().data;
      if (!validImg(d)) return;
      show(d);
      if (id) bgCache.put(uid, { id, data: d });
    } catch (e) { console.warn('friend bg', e); if (c) show(c.data); }   // senza rete: meglio la copia vecchia che niente
  }
  function backToFriends(msg) { closeModal(); openFriends(msg); }
  $('fp-close').addEventListener('click', () => backToFriends());
  $('fpmodal').addEventListener('click', e => { if (e.target === $('fpmodal')) backToFriends(); });
  $('fp-remove').addEventListener('click', async () => {
    const b = $('fp-remove');
    if (!b.dataset.armed) { fpArm(true); return; }
    fpArm(false);
    try { await fbDb.doc('friendships/' + pairOf(fbUser.uid, fpUid)).delete(); } catch (e) { console.warn('friends', e); }
    backToFriends(T('fr.msg.removed'));
  });

  // riquadro "Account" nella scheda Dati delle impostazioni
  function paintAccount() {
    const box = $('acc-box');
    if (!box) return;
    const usable = fbUsable();
    box.hidden = !!(window.claude && typeof window.claude.use === 'function');   // su claude.ai l'account è già quello della piattaforma
    $('acc-in').hidden = !usable || !!fbUser;
    $('acc-out').hidden = !fbUser;
    $('acc-in').disabled = $('acc-out').disabled = accBusy;
    const who = fbUser ? (fbUser.email || fbUser.displayName || '') : '';
    $('acc-status').textContent = !usable ? T('acc.unavail') : !fbUser ? T('acc.off')
      : dbRef ? T('acc.as', { who }) : T('acc.as.wait', { who });   // accesso fatto, ma l'account non è ancora raggiungibile
  }
  function accMsg(t) { $('acc-msg').textContent = t || ''; }
  $('acc-in').addEventListener('click', async () => {
    if (accBusy) return;
    accBusy = true; accMsg(''); paintAccount();
    if (!(await loadFirebase()) || !fbInit()) { accMsg(T('acc.err')); accBusy = false; paintAccount(); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const r = await fbAuth.signInWithPopup(provider);
      fbUser = r.user;
      markSigned(true);
      paintAccount();
      await fbConnect();
      sfx('ok');
    } catch (e) {
      const code = e && e.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try { markSigned(true); await fbAuth.signInWithRedirect(provider); return; } catch (e2) { markSigned(false); console.warn('auth', e2); }
      }
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') { accMsg(T('acc.err')); console.warn('auth', e); }
    }
    accBusy = false; paintAccount();
  });
  $('acc-out').addEventListener('click', async () => {
    if (accBusy || !fbAuth) return;
    accBusy = true; paintAccount();
    try { await fbAuth.signOut(); } catch (e) { console.warn('auth', e); }
    markSigned(false);
    stopListening();
    fbUser = null; dbRef = null;
    friendsReset();
    setSaveState('local');
    accMsg(T('acc.bye'));
    accBusy = false; paintAccount(); renderInfo();
  });
  async function initCloud() {
    try { await initCloudInner(); }
    finally { MUI.setPenaltyReady(); checkPenalties(); }
  }
  musicSync();      // prova a partire subito (funziona se il browser lo permette, altrimenti al primo tocco)
  imagesInit();
  // sull'app installata chiede al browser di non cancellare i dati quando lo spazio scarseggia
  try {
    if (navigator.storage && navigator.storage.persist && matchMedia('(display-mode: standalone)').matches) navigator.storage.persist();
  } catch (e) { /* facoltativo */ }
  // offline: il service worker tiene una copia dell'app sul dispositivo
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)); });
  }
  initCloud();
})();
