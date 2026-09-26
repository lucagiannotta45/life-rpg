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
 * sono in un file a parte: game.js.
 * I disegni (icone e cifre a pixel, linguetta del livello, radar) sono in draw.js.
 * Le regole della sincronizzazione tra dispositivi (calcoli puri) sono in sync.js.
 * Effetti sonori e musica (con la tabella dei brani MUSIC_FILES) sono in audio.js.
 * I calcoli dei colori (temi, finestre, testo leggibile) sono in look.js; la finestra Impostazioni,
 * il pannello Personalizza e l'applicazione dell'aspetto sono in settings-ui.js. Gli amici sono in friends.js.
 * Il motore dell'account e della sincronizzazione (scrivere, ascoltare, accedere) è in cloud.js;
 * i dati (XP, missioni, routine, impostazioni, stato della sincronizzazione) restano qui.
 * Le regole delle missioni, delle routine e del calendario (calcoli puri) sono in missions.js;
 * la parte che si vede (schede, elenco, calendario, finestre delle missioni) è in missions-ui.js.
 * L'ordine dei file in index.html è:
 *   i18n.js → game.js → draw.js → look.js → sync.js → missions.js → missions-ui.js → settings-ui.js
 *   → cloud.js → friends.js → audio.js → index.js.
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
 *                                              (subito dopo si creano cloud.js e friends.js)
 *  12. avvio                                 — inizializzazione dell'app, service worker e
 *                                              avvio della connessione all'account
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
    STATS, ICONS, ALIASES, MAX_LEVEL, xpForLevel, levelFromXp, fracLevel, overallOf, PAIRS, TRIPLES,
    QUADS, QUINTS, TIERS, GRADES, SPEC_MIN_LEVEL, blank, normalize,
  } = GAME;
  const heroRole = (x = xp) => GAME.heroRole(x);     // di solito si guardano i tuoi XP
  const heroClass = (x = xp) => GAME.heroClass(x);
  // Regole della sincronizzazione tra dispositivi (calcoli puri): sono in sync.js
  const SYNC = window.LIFE_RPG_SYNC.create(GAME);
  const {
    normDel, normRaw, rawOf, clampXp, effOf, canon, mergeItems,
  } = SYNC;
  // Calcoli dei colori (luminosità, mescolanze, colori delle finestre...): sono in look.js
  const { mixHex, hslToHex, winBase, paletteVars, readable, normHex } = window.LIFE_RPG_LOOK;
  // Regole delle missioni, delle routine e del calendario (calcoli puri): sono in missions.js
  const MISSIONS = window.LIFE_RPG_MISSIONS.create(GAME, SYNC);
  // qui servono solo queste: le altre le usa missions-ui.js direttamente da MISSIONS
  const { monthOf, normalizeMissions, normalizeRoutines } = MISSIONS;
  const LS_KEY = 'liferpg:v1';
  const LS_ACC = 'liferpg:acc';   // l'account a cui è collegato questo dispositivo (lo usa anche cloud.js)
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
  // indovina la lingua dalle impostazioni del dispositivo (usata solo al primissimo avvio in assoluto,
  // quando non c'è ancora nessuna preferenza salvata): se il dispositivo è in una lingua che non
  // supportiamo, si parte dall'inglese, più neutro dell'italiano per chi capita qui la prima volta
  function detectLang() {
    try {
      const cands = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
      for (const c of cands) {
        const base = String(c).split('-')[0].toLowerCase();
        const hit = LANGS.find(l => l.id.toLowerCase() === base || l.id.toLowerCase().startsWith(base + '-'));
        if (hit) return hit.id;
      }
    } catch (e) { /* navigator non disponibile */ }
    return 'en';
  }
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
    // nessuna preferenza salvata: primissimo avvio in assoluto su questo dispositivo, si indovina la lingua
    const s = defaultSettings();
    s.lang = detectLang();
    return s;
  }
  // sul dispositivo resta solo la lingua (serve già alla schermata di accesso); il resto sta nell'account
  function saveSettingsLocal() {
    lsSet(LS_SET, JSON.stringify({ lang: settings.lang }));
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
  function idbLoad() {
    const got = {};
    return idbRun('readonly', st => {
      IMG_NAMES.forEach(n => { st.get(n).onsuccess = e => { if (e.target.result != null) got[n] = e.target.result; }; });
    }).then(() => got);
  }
  // salva l'immagine n (quella in `imgs`); risolve true se è stata scritta da qualche parte, false se no
  // le immagini restano solo in memoria (e nell'account): sul dispositivo non si salva niente
  function saveImgLocal(n) { return Promise.resolve(true); }
  // all'avvio: prende le immagini salvate da versioni precedenti (poi, caricato l'account, si tolgono dal dispositivo)
  async function imagesInit() {
    // aprire il database lo creerebbe: si guarda prima se esiste (c'è solo su dispositivi usati con versioni precedenti)
    try {
      if (!window.indexedDB || !indexedDB.databases) return;
      if (!(await indexedDB.databases()).some(x => x.name === IDB_NAME)) return;
    } catch (e) { return; }
    let stored;
    try { stored = await idbLoad(); } catch (e) { return; }   // niente IndexedDB: si resta su localStorage
    let changed = false;
    for (const n of IMG_NAMES) {
      if (imgTouched.has(n)) continue;                        // cambiata da quando la pagina è aperta: vale quella
      if (validImg(stored[n])) {
        if (imgs[n] !== stored[n]) { imgs[n] = stored[n]; changed = true; }
      }   // (non si sposta più niente in IndexedDB: le immagini di versioni precedenti si leggono e basta)
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

  // Alcuni browser non lasciano salvare dati quando si apre un file HTML dal dispositivo
  let storageOk = true;
  try { localStorage.setItem('liferpg:probe', '1'); localStorage.removeItem('liferpg:probe'); } catch (e) { storageOk = false; }
  let saveKind = 'local';
  const saveStateEl = document.getElementById('save-state');
  const lsFailed = new Set();   // chiavi che il browser non è riuscito a scrivere (memoria piena)
  const paintSaveState = () => {
    const key = (!storageOk && saveKind === 'local') ? 'nostorage' : saveKind;
    const full = storageOk && lsFailed.size > 0;
    saveStateEl.textContent = full ? T('save.full') : (key === 'error' || key === 'offline') ? T('save.' + key) : '';
    saveStateEl.classList.toggle('warn', !!saveStateEl.textContent);
  };
  const setSaveState = k => { saveKind = k; paintSaveState(); };
  // scrive in localStorage (value null = cancella); se non ci riesce lo segnala invece di ignorarlo
  // I dati stanno solo nell'account: sul dispositivo non si scrive niente di tuo (progressi, missioni, routine,
  // immagini, stato della sincronizzazione, missioni condivise). Restano solo le preferenze del dispositivo:
  // lingua, suoni, musica. Le chiavi qui sotto si possono solo cancellare (dati di versioni precedenti).
  const ACCOUNT_KEYS = new Set(['liferpg:v1', 'liferpg:missions:v1', 'liferpg:routines:v1', 'liferpg:sync:v2', 'liferpg:acc', 'liferpg:shared:v1', 'liferpg:sroutines:v1']);
  const isAccountKey = k => ACCOUNT_KEYS.has(k) || k.startsWith('liferpg:img:');
  let storageLocked = false;   // dopo l'uscita dall'account non si riscrive più niente
  function lsSet(key, value) {
    if (storageLocked || (value != null && isAccountKey(key))) return true;
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
  function linkedUidRaw() { try { return localStorage.getItem(LS_ACC) || ''; } catch (e) { return ''; } }
  function saveSync() { lsSet(LS_SYNC, JSON.stringify(sync)); }
  // Uscendo dall'account i dati non restano sul dispositivo: si tolgono progressi, missioni, routine,
  // impostazioni, immagini, stato della sincronizzazione, missioni condivise e sfondi degli amici.
  // Restano solo le preferenze del dispositivo (lingua, suoni, musica). Dopo si ricarica la pagina.
  // Toglie dal dispositivo i dati rimasti da versioni precedenti (quando si salvava anche lì).
  // Si chiama dopo che l'account è stato caricato (e questi dati uniti all'account) e uscendo dall'account.
  async function clearDeviceData() {
    [...ACCOUNT_KEYS, ...IMG_NAMES.map(n => LS_IMG + n)].forEach(k => lsSet(k, null));
    lsSet(LS_SET, JSON.stringify({ lang: settings.lang }));
    // i database delle versioni precedenti (immagini e sfondi degli amici) si eliminano del tutto
    try { if (idbPromise) (await idbPromise).close(); } catch (e) { /* non era aperto */ }
    idbPromise = null;
    const drop = name => new Promise(res => {
      if (!window.indexedDB) { res(); return; }
      try { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch (e) { res(); }
    });
    await Promise.race([Promise.all([drop(IDB_NAME), drop('liferpg-friends')]), new Promise(res => setTimeout(res, 3000))]);
  }
  async function wipeLocalData() {
    await clearDeviceData();
    storageLocked = true;   // da qui in poi niente viene più scritto (poi la pagina si ricarica)
  }
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
  // si riparte da zero in memoria (tranne la lingua): per i dati di un altro account rimasti sul dispositivo
  function discardLocal() {
    xp = blank(); missions = []; routines = [];
    settings = normalizeSettings({ lang: settings.lang }); settingsTouched = false;
    IMG_NAMES.forEach(n => { imgs[n] = null; }); imgTouched.clear();
    sync = blankSync(''); sync.xpBase = blank(); sync.xpSeen = blank(); xpAbs = 0;
    mSeen.clear(); rSeen.clear();
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
    if (AUDIO.soundOn()) sfx('ok');
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
  function openModal(m, focusEl, opts) {
    lastFocus = document.activeElement;
    activeModal = m;
    m.hidden = false;
    if (focusEl && isTextField(focusEl) && isTouch()) {
      const win = m.querySelector('.modal-win') || m;
      win.setAttribute('tabindex', '-1');
      win.focus({ preventScroll: true });
    } else if (focusEl) focusEl.focus();
    if (!(opts && opts.silentOpen)) sfx('open');
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

  $('btn-export').addEventListener('click', () => {
    const text = JSON.stringify(buildBackup(), null, 2);
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
  // true mentre si stanno mandando all'account missioni o immagini
  const syncBusy = () => monthBusy || imgBusy;
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
  let SH = null;   // missioni condivise (shared.js): si creano più avanti, dopo gli amici
  let SR = null;   // routine di gruppo (shared-routines.js): subito dopo le missioni condivise
  const MUI = window.LIFE_RPG_MISSIONS_UI.create({
    GAME, MISSIONS, T, TN, locale, fmt, sfx, $, mk, mfDelArm, selArm, reduce, iconSvg, digitsSvg,
    saveRoutinesLocal, tombMissions, tombRoutine, persist, render, floatText, showLevelUp, openModal, closeModal,
    statColor, readable, touchMonth, showView,
    get nameSpan() { return nameSpan; },   // definito più avanti (sezione "info")
    get SH() { return SH; },
    get SR() { return SR; },
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
    p(b, T('info.fr.p3'));

    // dati
    b = section('data', T('info.data.h'));
    p(b, dbRef ? T('info.data.cloud') : storageOk ? T('info.data.local') : T('info.data.nostorage'));
    p(b, T(dbRef ? 'info.data.p3' : 'info.data.p3.local'));   // con l'account il backup è una copia di sicurezza, senza è l'unico modo di trasferire i dati
    // informativa sulla privacy (privacy.html, accanto a index.html), nella sezione della lingua attiva
    const pv = mk('a', null, T('info.data.privacy'));
    pv.href = 'privacy.html#' + (lang === 'it' ? 'it' : lang === 'pt-BR' ? 'pt' : 'en');
    pv.target = '_blank'; pv.rel = 'noopener';
    b.appendChild(mk('p')).appendChild(pv);
  }

  /* ----- account e sincronizzazione (cloud.js): creati qui, prima degli amici e dell'avvio ----- */
  const CLOUD = window.LIFE_RPG_CLOUD.create({
    T, TN, STATS, levelFromXp, overallOf, blank, normalize, SYNC, normDel, rawOf, clampXp, mergeItems, monthOf,
    normalizeMissions, normalizeRoutines, fmt, saveLocal, hasProgress, defaultSettings, saveSettingsLocal, isDefaultSettings,
    LANGS, applyLang, mergeSettings, IMG_NAMES, CLOUD_IMG_MAX, validImg, imgs, imgTouched, saveImgLocal, imagesInit, saveMissionsLocal,
    saveRoutinesLocal, setSaveState, lsSet, blankSync, DEV, absorbLocal, recomputeXp, hasPend, saveSync, missionSig,
    routineSig, seenOf, mSeen, rSeen, sfx, musicSync, $, render, openModal, closeModal, applyImages, cs, paintCustom,
    applyAll, imgQueue, flushImgs, monthQueue, flushMissions, touchMonth, MUI, checkPenalties, renderMissionViews, rmodal,
    renderRoutines, renderInfo, schedulePublish, friendsReset, checkFriendRequests, LS_ACC, sharedStart, sharedReset,
    wipeLocalData, clearDeviceData, discardLocal, syncBusy,
  }, {
    get settings() { return settings; }, set settings(v) { settings = v; },
    get settingsTouched() { return settingsTouched; }, set settingsTouched(v) { settingsTouched = v; },
    get missions() { return missions; }, set missions(v) { missions = v; },
    get routinesApplying() { return routinesApplying; }, set routinesApplying(v) { routinesApplying = v; },
    get routines() { return routines; }, set routines(v) { routines = v; },
    get xp() { return xp; }, set xp(v) { xp = v; },
    get dbRef() { return dbRef; }, set dbRef(v) { dbRef = v; },
    get writing() { return writing; }, set writing(v) { writing = v; },
    get again() { return again; }, set again(v) { again = v; },
    get fbAuth() { return fbAuth; }, set fbAuth(v) { fbAuth = v; },
    get fbDb() { return fbDb; }, set fbDb(v) { fbDb = v; },
    get fbUser() { return fbUser; }, set fbUser(v) { fbUser = v; },
    get accBusy() { return accBusy; }, set accBusy(v) { accBusy = v; },
    get accPending() { return accPending; }, set accPending(v) { accPending = v; },
    get sync() { return sync; }, set sync(v) { sync = v; },
    get xpAbs() { return xpAbs; }, set xpAbs(v) { xpAbs = v; },
    get deferredUser() { return deferredUser; }, set deferredUser(v) { deferredUser = v; },
  });
  // "ponti": funzioni dichiarate (esistono fin dall'inizio del file, come prima) che passano la chiamata a cloud.js
  function stampRoutines(...a) { return CLOUD.stampRoutines(...a); }
  function tombMissions(...a) { return CLOUD.tombMissions(...a); }
  function tombRoutine(...a) { return CLOUD.tombRoutine(...a); }
  function mergeMonth(...a) { return CLOUD.mergeMonth(...a); }
  function txDoc(...a) { return CLOUD.txDoc(...a); }
  function syncFail(...a) { return CLOUD.syncFail(...a); }
  function syncOk(...a) { return CLOUD.syncOk(...a); }
  function flush(...a) { return CLOUD.flush(...a); }
  function persist(...a) { return CLOUD.persist(...a); }
  function loadFirebase(...a) { return CLOUD.loadFirebase(...a); }
  function fbConnect(...a) { return CLOUD.fbConnect(...a); }
  function paintAccount(...a) { return CLOUD.paintAccount(...a); }
  function initCloud(...a) { return CLOUD.initCloud(...a); }

  /* ----- amici (friends.js): creati qui, prima dell'avvio, perché l'avvio li usa già ----- */
  // Codice amico, profilo pubblico, elenco e profilo di un amico: sono in friends.js.
  const FR = window.LIFE_RPG_FRIENDS.create({
    LANGS, T, STATS, levelFromXp, overallOf, normalize, heroClass, paletteVars, HEX, CLOUD_IMG_MAX, validImg, imgs,
    sfx, musicGuestStart, $, fpArm, levelTabSvg, radarMarkup, openModal, closeModal, openSettings, mk, fbConnect,
  }, {
    get lang() { return lang; }, set lang(v) { lang = v; },
    get settings() { return settings; },
    get xp() { return xp; },
    get dbRef() { return dbRef; },
    get fbDb() { return fbDb; },
    get fbUser() { return fbUser; },
    get accPending() { return accPending; },
  });
  // "ponti": funzioni dichiarate (esistono fin dall'inizio del file, come prima) che passano la chiamata a friends.js
  function schedulePublish(now) { return FR.schedulePublish(now); }
  function friendsReset() { return FR.friendsReset(); }
  function paintFriendsBtn() { return FR.paintFriendsBtn(); }
  function checkFriendRequests() { return FR.checkFriendRequests(); }

  /* ----- missioni condivise (shared.js): dopo gli amici, perché invitano un amico ----- */
  // Inviti, documento condiviso su Firebase, esito (superata o fallita per entrambi): sono in shared.js.
  SH = window.LIFE_RPG_SHARED.create({
    T, GAME, MISSIONS, $, mk, sfx, openModal, closeModal, touchMonth, tombMissions, lsSet, fbConnect,
    friendsList: () => FR.friendsList(), loadFriendsList: () => FR.loadFriends(),
    MUI,
  }, {
    get missions() { return missions; }, set missions(v) { missions = v; },
    get settings() { return settings; },
    get dbRef() { return dbRef; },
    get fbDb() { return fbDb; },
    get fbUser() { return fbUser; },
  });
  /* ----- routine di gruppo (shared-routines.js): usano la finestra "Invita amici" di shared.js ----- */
  SR = window.LIFE_RPG_SHARED_ROUTINES.create({
    T, GAME, MISSIONS, sfx, touchMonth, lsSet, saveRoutinesLocal, MUI,
    get SH() { return SH; },
  }, {
    get missions() { return missions; }, set missions(v) { missions = v; },
    get routines() { return routines; }, set routines(v) { routines = v; },
    get dbRef() { return dbRef; },
    get fbDb() { return fbDb; },
    get fbUser() { return fbUser; },
  });
  // "ponti" per cloud.js: si parte quando l'account è collegato, si azzera uscendo
  function sharedStart() { SH.start(); SR.start(); }
  function sharedReset() { SH.reset(); SR.reset(); }

  /* ================= avvio ================= */
  initCal();
  renderMissionViews();
  applyAll();
  buildCustom();
  applyLang();   // di nuovo: ora esistono anche le voci create da buildCustom
  wireDrops();
  render(false);

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
