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
 * Indice delle sezioni, nell'ordine in cui compaiono (cerca il titolo per saltare al punto giusto):
 *   1. lingue                                — collegamento ai testi di i18n.js
 *   2. dati di gioco                         — statistiche, missioni, livelli, XP
 *   3. stato e salvataggio                   — stato in memoria + persistenza locale;
 *                                              contiene "sincronizzazione con l'account (più dispositivi)"
 *   4. suono                                 — effetti sonori dell'interfaccia
 *   5. interfaccia: elementi                 — riferimenti ai nodi del DOM, pulsanti "premi di nuovo", radar
 *   6. effetti                               — animazioni e feedback visivi
 *   7. finestre (Dati e Personalizza)        — pannelli modali
 *   8. personalizzazione                     — temi, sfondi, nome, icone
 *   9. missioni e calendario                 — creazione/gestione missioni, routine, penalità, calendario
 *  10. musica                                — musica di sottofondo (un brano per ogni ruolo)
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
  // "name" e "cls" cambiano con la lingua; "key" resta quella italiana perché è nei salvataggi
  const statDef = (key, color, icon) => ({
    key, color, icon,
    get name() { return T('stat.' + key); },
    get cls() { return T('cls.' + key); },
  });
  const STATS = [
    statDef('Vigore',     '#ff6262', 'manubrio'),
    statDef('Vitalita',   '#55e58a', 'cuore'),
    statDef('Intelletto', '#52c8ff', 'libro'),
    statDef('Creativita', '#ffb638', 'scintilla'),
    statDef('Animo',      '#ad92ff', 'fiamma'),
    statDef('Legami',     '#ff80c8', 'anelli'),
  ];
  // Icone pixel predefinite delle statistiche (X = pixel pieno); si possono sostituire con un'immagine
  const ICONS = {
    manubrio: { name: 'Manubrio', rows: ['X........X','XX......XX','XXXXXXXXXX','XXXXXXXXXX','XX......XX','X........X'] },
    cuore: { name: 'Cuore', rows: ['.XX..XX.','XXXXXXXX','XXXXXXXX','XXXXXXXX','.XXXXXX.','..XXXX..','...XX...'] },
    libro: { name: 'Libro', rows: ['XXXXXXX.','XX....X.','XX.XX.X.','XX....X.','XX.XX.X.','XX....X.','XXXXXXX.','.XXXXXX.'] },
    scintilla: { name: 'Scintilla', rows: ['...XX...','...XX...','..XXXX..','XXXXXXXX','XXXXXXXX','..XXXX..','...XX...','...XX...'] },
    fiamma: { name: 'Fiamma', rows: ['...X....','..XX....','..XXX...','.XXXX.X.','.XXXXXX.','XXXXXXXX','XXXXXXXX','.XXXXXX.'] },
    anelli: { name: 'Anelli', rows: ['.XXX...XXX.','X...X.X...X','X....X....X','X...X.X...X','.XXX...XXX.'] },
  };
  const ALIASES = { 'Vitalità': 'Vitalita', 'Creatività': 'Creativita' };
  const MAX_LEVEL = 100;
  const MAX_XP = 100000;        // XP del livello 100: nessuna statistica può superarli
  const LS_KEY = 'liferpg:v1';
  const LS_SOUND = 'liferpg:sound';

  // Livelli da 0 a 100. XP totali per il livello L = ceil(100 * L^1,5):
  // il livello 0 richiede 0 XP, il livello 100 richiede 100.000 XP.
  const xpForLevel = L => Math.ceil(100 * L * Math.sqrt(L));
  function levelFromXp(xp) {
    let l = 0;
    while (l < MAX_LEVEL && xpForLevel(l + 1) <= xp) l++;
    return l;
  }
  function fracLevel(xp) {
    const L = levelFromXp(xp);
    if (L >= MAX_LEVEL) return MAX_LEVEL;
    const lo = xpForLevel(L), hi = xpForLevel(L + 1);
    return L + (xp - lo) / (hi - lo);
  }
  const overallOf = levels => Math.floor(levels.reduce((a, b) => a + b, 0) / levels.length);

  // ---------- Titolo del personaggio ----------
  // Coppie di statistiche (chiave: nomi in ordine di elenco) -> titolo
  // i valori sono id neutri: il nome mostrato viene da I18N ("pair.<id>")
  const PAIRS = {
    'Vigore+Vitalita': 'gladiator',   'Vigore+Intelletto': 'strategist',   'Vigore+Creativita': 'acrobat',
    'Vigore+Animo': 'samurai',        'Vigore+Legami': 'knight',
    'Vitalita+Intelletto': 'alchemist', 'Vitalita+Creativita': 'dancer', 'Vitalita+Animo': 'shaman',
    'Vitalita+Legami': 'healer',
    'Intelletto+Creativita': 'inventor', 'Intelletto+Animo': 'sage',   'Intelletto+Legami': 'mentor',
    'Creativita+Animo': 'poet',       'Creativita+Legami': 'storyteller',
    'Animo+Legami': 'peacemaker',
  };
  // Tre, quattro e cinque statistiche in testa: un titolo per ogni combinazione (chiavi in ordine di elenco)
  const TRIPLES = {
    'Vigore+Vitalita+Intelletto': 'general',   'Vigore+Vitalita+Creativita': 'explorer',   'Vigore+Vitalita+Animo': 'paladin',
    'Vigore+Vitalita+Legami': 'pillar',        'Vigore+Intelletto+Creativita': 'architect', 'Vigore+Intelletto+Animo': 'stoic',
    'Vigore+Intelletto+Legami': 'warlord',     'Vigore+Creativita+Animo': 'wanderer',       'Vigore+Creativita+Legami': 'catalyst',
    'Vigore+Animo+Legami': 'protector',        'Vitalita+Intelletto+Creativita': 'naturalist', 'Vitalita+Intelletto+Animo': 'apothecary',
    'Vitalita+Intelletto+Legami': 'surgeon',   'Vitalita+Creativita+Animo': 'enchanter',   'Vitalita+Creativita+Legami': 'entertainer',
    'Vitalita+Animo+Legami': 'shepherd',       'Intelletto+Creativita+Animo': 'philosopher', 'Intelletto+Creativita+Legami': 'orator',
    'Intelletto+Animo+Legami': 'counselor',    'Creativita+Animo+Legami': 'inspirer',
  };
  const QUADS = {
    'Vigore+Vitalita+Intelletto+Creativita': 'pioneer',      'Vigore+Vitalita+Intelletto+Animo': 'spartan',
    'Vigore+Vitalita+Intelletto+Legami': 'sovereign',        'Vigore+Vitalita+Creativita+Animo': 'savage',
    'Vigore+Vitalita+Creativita+Legami': 'busker',           'Vigore+Vitalita+Animo+Legami': 'sentinel',
    'Vigore+Intelletto+Creativita+Animo': 'loner',           'Vigore+Intelletto+Creativita+Legami': 'entrepreneur',
    'Vigore+Intelletto+Animo+Legami': 'commander',           'Vigore+Creativita+Animo+Legami': 'revolutionary',
    'Vitalita+Intelletto+Creativita+Animo': 'hermit',        'Vitalita+Intelletto+Creativita+Legami': 'humanist',
    'Vitalita+Intelletto+Animo+Legami': 'priest',            'Vitalita+Creativita+Animo+Legami': 'jester',
    'Intelletto+Creativita+Animo+Legami': 'visionary',
  };
  // cinque in testa: il titolo dipende dalla statistica che manca
  const QUINTS = { Vigore: 'oracle', Vitalita: 'ascetic', Intelletto: 'barbarian', Creativita: 'templar', Animo: 'conqueror', Legami: 'ronin' };
  // Titoli per chi è equilibrato, in base al livello complessivo
  const TIERS = [[75, 'demigod'], [50, 'legend'], [25, 'champion'], [10, 'hero'], [0, 'adventurer']];
  const tierOf = ov => T('tier.' + (TIERS.find(x => ov >= x[0]) || TIERS[TIERS.length - 1])[1]);
  // Grado davanti al titolo delle classi specializzate, in base al livello
  // (statistica in testa, oppure media delle due per le coppie)
  const GRADES = [[75, 'grandmaster'], [50, 'master'], [25, ''], [0, 'apprentice']];
  const gradeOf = lv => {
    const id = (GRADES.find(x => lv >= x[0]) || GRADES[GRADES.length - 1])[1];
    return id ? T('grade.' + id) : '';
  };
  const withGrade = (name, lv) => (gradeOf(lv) ? gradeOf(lv) + ' ' : '') + name;
  const SPEC_MIN_LEVEL = 5;    // sotto questo livello non si parla di specializzazione
  const SPEC_RATIO = 2;        // specializzato se il livello massimo è almeno il doppio del minimo
  const NEAR_RATIO = 0.8;      // "vicine" alla massima: almeno l'80% del suo livello

  // Il ruolo del personaggio: { ns, id, lv }. "ns" è il gruppo dei testi (tier, cls, pair, triple, quad, quint),
  // "id" il nome interno e "lv" il livello da cui dipende il grado. Serve sia al nome mostrato sia al brano musicale.
  function heroRole(x = xp) {
    // ordine per XP (a parità di XP vince la prima nell'elenco); x: gli XP di chi guardiamo (di solito i tuoi)
    const order = STATS.map((s, i) => ({ s, i, xp: x[s.key], lv: levelFromXp(x[s.key]) }))
      .sort((a, b) => b.xp - a.xp || a.i - b.i);
    const levels = order.map(o => o.lv);
    const maxLv = Math.max(...levels), minLv = Math.min(...levels);
    if (maxLv < SPEC_MIN_LEVEL || maxLv < SPEC_RATIO * minLv) {
      const ov = overallOf(levels);
      return { ns: 'tier', id: (TIERS.find(x => ov >= x[0]) || TIERS[TIERS.length - 1])[1], lv: 0 };
    }
    const near = order.filter(o => o.lv >= NEAR_RATIO * maxLv).length;
    if (near === 1) return { ns: 'cls', id: order[0].s.key, lv: order[0].lv };   // una sola statistica in testa
    if (near === 2) {                                        // due statistiche in testa
      const [a, b] = [order[0], order[1]].sort((p, q) => p.i - q.i);
      return { ns: 'pair', id: PAIRS[a.s.key + '+' + b.s.key], lv: Math.floor((a.lv + b.lv) / 2) };
    }
    // tre, quattro o cinque in testa: un titolo per la combinazione, con il grado della media dei loro livelli
    const lead = order.slice(0, near).sort((p, q) => p.i - q.i);
    const avg = Math.floor(lead.reduce((t, o) => t + o.lv, 0) / lead.length);
    const key = lead.map(o => o.s.key).join('+');
    if (near === 3) return { ns: 'triple', id: TRIPLES[key], lv: avg };
    if (near === 4) return { ns: 'quad', id: QUADS[key], lv: avg };
    const missing = STATS.find(s => !lead.some(o => o.s.key === s.key));
    return { ns: 'quint', id: QUINTS[missing.key], lv: avg };           // cinque forti e una sola lacuna
  }
  function heroClass(x = xp) {
    const r = heroRole(x);
    const name = T(r.ns + '.' + r.id);
    return r.ns === 'tier' ? name : withGrade(name, r.lv);
  }
  const fmt = n => n.toLocaleString(locale());

  /* ================= stato e salvataggio ================= */
  const blank = () => Object.fromEntries(STATS.map(s => [s.key, 0]));
  function normalize(obj) {
    const out = blank();
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        const key = ALIASES[k] || k;
        if (key in out) {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) out[key] = Math.min(Math.floor(n), MAX_XP);
        }
      }
    }
    return out;
  }
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
  const MAX_PER_MONTH = 200;
  const MAX_MISSIONS = 2000;
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  }
  const validTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  // registro degli XP per dispositivo: { idDispositivo: { statistica: numero } }, al massimo 16 dispositivi
  function normLedger(o) {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    let n = 0;
    for (const [dev, e] of Object.entries(o)) {
      if (n >= 16 || !/^[a-z0-9]{4,12}$/.test(dev) || !e || typeof e !== 'object') continue;
      const v = {};
      STATS.forEach(s => { const x = Number(e[s.key]); if (Number.isInteger(x) && x && Math.abs(x) <= MAX_XP) v[s.key] = x; });
      if (Object.keys(v).length) { out[dev] = v; n++; }
    }
    return n ? out : null;
  }
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
  // Definiti qui, prima di caricare missioni e routine, perché servono già per controllare i dati salvati.
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
      // sincronizzazione (vedi "sincronizzazione con l'account"): u = istante dell'ultima modifica,
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
  const MAX_ROUTINES = 30;
  const KEEP_DAYS = 60;     // le routine completate o fallite più vecchie si tolgono dalla cronologia
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
  // Come restano d'accordo più dispositivi collegati allo stesso account, anche se uno è rimasto aperto
  // in background per giorni:
  // - ogni missione e ogni routine ha "u", l'istante dell'ultima modifica: in un conflitto vince la più recente;
  // - una missione o routine eliminata lascia una "lapide" (id → istante) per 90 giorni, così un dispositivo
  //   rimasto indietro non la fa ricomparire;
  // - gli XP non si sovrascrivono mai: si manda all'account solo la DIFFERENZA rispetto all'ultimo valore visto lì
  //   (xpBase), dentro una transazione. L'account tiene anche il totale "grezzo" (xr), non tagliato fra 0 e 100.000:
  //   se due penalità arrivano insieme il totale può scendere sotto zero per un momento, e il taglio
  //   perderebbe l'informazione che serve per correggerlo subito dopo. Sul dispositivo si vede sempre il valore tagliato;
  // - ogni missione porta un piccolo registro "c": quanti XP ha dato o tolto ciascun dispositivo con quella missione.
  //   Se la tua versione perde il confronto con quella di un altro dispositivo (per esempio l'avete completata tutti
  //   e due mentre eravate offline), confronti la tua voce nel registro vincente con la tua e annulli la differenza:
  //   così una missione non conta mai due volte;
  // - le impostazioni vincono per intero, secondo l'istante dell'ultima modifica (sAt);
  // - "rev" nel documento del giocatore cresce a ogni scrittura: un aggiornamento più vecchio non torna indietro.
  // Tutto questo stato è di un solo account (key) ed è salvato sul dispositivo.
  const LS_SYNC = 'liferpg:sync:v2';
  const TOMB_MS = 90 * 86400000;
  // xpBase: totale grezzo visto nell'account; pend: XP fatti qui e non ancora mandati; xpSeen: gli XP locali già contati in pend
  const blankSync = key => ({ key: key || '', xpBase: null, pend: blank(), xpSeen: null, rev: 0, mDel: {}, rDel: {}, sAt: 0 });
  // totale grezzo: interi, anche negativi, entro un margine largo
  function normRaw(o) {
    const out = blank();
    if (o && typeof o === 'object') STATS.forEach(s => { const n = Number(o[s.key]); if (Number.isFinite(n)) out[s.key] = Math.max(-10 * MAX_XP, Math.min(10 * MAX_XP, Math.round(n))); });
    return out;
  }
  const rawOf = d => (d && d.xr && typeof d.xr === 'object') ? normRaw(d.xr) : normalize(d && d.xp);
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
  // lapidi: { id: { t: istante, c: registro della missione eliminata, z: epoca } }
  function normDel(o) {
    const out = {};
    if (o && typeof o === 'object') for (const [id, v] of Object.entries(o)) {
      const t = Number(v && typeof v === 'object' ? v.t : v);
      if (!/^[\w-]{1,40}$/.test(id) || !Number.isFinite(t) || t <= 0) continue;
      const x = { t: Math.floor(t) };
      const led = v && typeof v === 'object' ? normLedger(v.c) : null;
      if (led) x.c = led;
      if (v && Number(v.z) > 0) x.z = Math.floor(Number(v.z));
      out[id] = x;
    }
    return out;
  }
  // lapidi più vecchie di 90 giorni: non servono più
  function pruneDel(del) {
    const lim = Date.now() - TOMB_MS, out = {};
    for (const [id, x] of Object.entries(del)) if (x.t >= lim) out[id] = x;
    return out;
  }
  // "effetto" di una missione sugli XP: + quelli ricevuti completandola, - quelli persi con la penalità (solo i valori diversi da 0)
  const effOf = m => {
    const src = m && (m.done || m.failed), e = {};
    if (src) STATS.forEach(s => { const v = src.applied[s.key] || 0; if (v) e[s.key] = m.done ? v : -v; });
    return e;
  };
  const addEff = (acc, e, sign) => { for (const k in e) acc[k] = (acc[k] || 0) + sign * e[k]; };
  const clampXp = v => Math.min(MAX_XP, Math.max(0, Math.round(v)));
  // le modifiche fatte qui agli XP (missioni, penalità...) finiscono in "pend", da mandare all'account
  function absorbLocal() {
    if (!sync.xpSeen) sync.xpSeen = { ...xp };
    STATS.forEach(s => { sync.pend[s.key] += xp[s.key] - sync.xpSeen[s.key]; });
    sync.xpSeen = { ...xp };
  }
  // XP mostrati = totale dell'account + ciò che non è ancora partito, tagliato fra 0 e 100.000
  function recomputeXp() {
    const B = sync.xpBase || blank();
    let ch = false;
    STATS.forEach(s => { const v = clampXp(B[s.key] + sync.pend[s.key]); if (v !== xp[s.key]) { xp[s.key] = v; ch = true; } });
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

  // confronto "stesso contenuto": si normalizza, si ordinano le chiavi e si ignorano "u" e i campi vuoti
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(k => v[k] != null && k !== 'u' && k !== 'c').map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
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

  // unisce due elenchi (missioni o routine) elemento per elemento. Per ogni id dice da dove viene il vincitore.
  function mergeItems(L, lDel, R, rDel, sig) {
    const lm = new Map(L.map(x => [x.id, x])), rm = new Map(R.map(x => [x.id, x]));
    const del = { ...rDel };
    for (const [id, x] of Object.entries(lDel)) if (!del[id] || del[id].t < x.t) del[id] = x;
    const items = [], info = new Map();
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id), r = rm.get(id);
      let w, same = false;
      if (l && r) {
        same = sig(l) === sig(r);
        w = same ? r : ((l.u || 0) > (r.u || 0) ? l : r);   // a parità vince l'account (come prima)
      } else w = l || r;
      if (del[id] && del[id].t >= (w.u || 0)) w = null;        // eliminata dopo l'ultima modifica
      else if (del[id]) delete del[id];                        // modificata dopo l'eliminazione: resta, la lapide si toglie
      if (w) items.push(w);
      info.set(id, { l, r, w, same });
    }
    return { items, del: pruneDel(del), info };
  }

  // porta dentro questo dispositivo il contenuto di un mese dell'account (R, lapidi rDel).
  // Se una tua versione ha perso, si annulla la parte di XP che il registro vincente non ti riconosce.
  function mergeMonth(ym, R, rDel) {
    const lDel = sync.mDel[ym] || {};
    const L = missions.filter(m => monthOf(m) === ym);
    const res = mergeItems(L, lDel, R, rDel, missionSig);
    const comp = {};
    let changed = false, dirty = false;
    res.info.forEach(({ l, w, same }, id) => {
      if (l && w !== l) {
        changed = true;
        const win = w || res.del[id] || {};                 // vincitore: un'altra versione, oppure la lapide
        if ((win.z || 0) === (l.z || 0)) {                  // stessa epoca (un backup importato azzera il conto)
          addEff(comp, (win.c && win.c[DEV]) || {}, 1);
          addEff(comp, (l.c && l.c[DEV]) || {}, -1);
        }
      }
      if (!l && w) changed = true;
      if (w && w === l && !same) dirty = true;             // l'account non ha ancora la tua versione
    });
    for (const [id, x] of Object.entries(lDel)) if (!(rDel[id] && rDel[id].t >= x.t) && res.del[id]) dirty = true;
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
    const res = mergeItems(routines, sync.rDel, R, rDel, routineSig);
    let changed = false, dirty = false;
    const gone = [];
    res.info.forEach(({ l, w, same }) => {
      if (l && w !== l) { changed = true; if (!w) gone.push(l.id); }
      if (!l && w) changed = true;
      if (w && w === l && !same) dirty = true;
    });
    for (const [id, x] of Object.entries(sync.rDel)) if (!(rDel[id] && rDel[id].t >= x.t) && res.del[id]) dirty = true;
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
        const S = rawOf(d), xr = {}, nx = {};
        STATS.forEach(s => { const k = s.key; xr[k] = sent.abs ? sent.xs[k] : S[k] + sent.pend[k]; nx[k] = clampXp(xr[k]); });
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
  let soundOn = true;
  try { soundOn = localStorage.getItem(LS_SOUND) !== '0'; } catch (e) { /* ignora */ }
  let audio = null;
  function blip(freq, t0, dur, type, vol) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  // suoni dei menu: hanno un interruttore a parte (Impostazioni, scheda Suono)
  const LS_SOUND_MENU = 'liferpg:sound:menu';
  const MENU_KINDS = new Set(['tab', 'open', 'close', 'save', 'del', 'err']);
  let menuOn = true, lastMajor = 0, lastLow = 0;
  try { menuOn = localStorage.getItem(LS_SOUND_MENU) !== '0'; } catch (e) { /* ignora */ }
  function sfx(kind, arg) {
    if (!soundOn) return;
    if (MENU_KINDS.has(kind) && !menuOn) return;
    if (kind === 'open' || kind === 'close') {
      // apertura e chiusura di finestre contano poco: se suona già altro (salvataggio, penalità...) o un'altra finestra, si tacciono
      setTimeout(() => { const n = Date.now(); if (n - lastMajor > 250 && n - lastLow > 100) sfxNow(kind, arg); }, 40);
      return;
    }
    sfxNow(kind, arg);
  }
  let sfxSeq = 0;
  function sfxNow(kind, arg) {
    if (kind === 'open' || kind === 'close') lastLow = Date.now(); else lastMajor = Date.now();
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        try {
          const t = audio.currentTime;
          if (kind === 'add') { blip(660, t, 0.07, 'square', 0.04); blip(880, t + 0.06, 0.09, 'square', 0.04); }
          if (kind === 'sub') { blip(440, t, 0.08, 'triangle', 0.07); blip(330, t + 0.07, 0.1, 'triangle', 0.07); }
          if (kind === 'up') [523, 659, 784, 1047, 1319].forEach((f, i) => blip(f, t + i * 0.09, 0.16, 'square', 0.045));
          if (kind === 'down') [392, 330, 262].forEach((f, i) => blip(f, t + i * 0.1, 0.16, 'triangle', 0.08));
          // suoni dei menu e della navigazione
          if (kind === 'tab') blip([523, 587, 659, 784][arg] || 523, t, 0.1, 'triangle', 0.06);   // una nota per scheda, su una scala
          if (kind === 'open') { blip(392, t, 0.08, 'triangle', 0.06); blip(587, t + 0.07, 0.11, 'triangle', 0.06); }
          if (kind === 'close') { blip(587, t, 0.08, 'triangle', 0.06); blip(392, t + 0.07, 0.11, 'triangle', 0.06); }
          if (kind === 'ok') { blip(659, t, 0.08, 'triangle', 0.06); blip(988, t + 0.08, 0.14, 'triangle', 0.06); }   // accesso riuscito, amicizia accettata
          if (kind === 'save') { blip(523, t, 0.08, 'triangle', 0.06); blip(659, t + 0.08, 0.08, 'triangle', 0.06); blip(784, t + 0.16, 0.13, 'triangle', 0.06); }
          if (kind === 'del') { blip(330, t, 0.1, 'triangle', 0.07); blip(196, t + 0.09, 0.16, 'triangle', 0.07); }
          if (kind === 'err') { blip(180, t, 0.11, 'square', 0.045); blip(150, t + 0.12, 0.15, 'square', 0.045); }
          if (kind === 'bonus') [[784, 0, 0.08], [988, 0.08, 0.08], [1175, 0.16, 0.08], [1568, 0.24, 0.18]].forEach(([f, d, l]) => blip(f, t + d, l, 'square', 0.04));
        } catch (e) { /* audio non disponibile */ }
      };
      if (audio.state !== 'running') {
        // alcuni browser (Safari) riavviano l'audio con un po' di ritardo: si suona solo dopo, così le note non si perdono
        const mine = ++sfxSeq, r = audio.resume();
        if (r && r.then) r.then(() => { if (mine === sfxSeq) play(); }, () => { /* niente audio */ });
        else play();
      } else play();
    } catch (e) { /* audio non disponibile */ }
  }
  const soundBtn = document.getElementById('btn-sound');
  const menuBtn = document.getElementById('btn-menu-sound');
  function paintSound() {
    soundBtn.textContent = soundOn ? T('sound.on') : T('sound.off');
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    menuBtn.textContent = menuOn ? T('sound.menu.on') : T('sound.menu.off');
    menuBtn.setAttribute('aria-pressed', String(menuOn));
  }
  menuBtn.addEventListener('click', () => {
    menuOn = !menuOn;
    try { localStorage.setItem(LS_SOUND_MENU, menuOn ? '1' : '0'); } catch (e) { /* ignora */ }
    paintSound();
    if (menuOn) sfx('tab', 2);
  });
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem(LS_SOUND, soundOn ? '1' : '0'); } catch (e) { /* ignora */ }
    paintSound();
    if (soundOn) sfx('add');
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

  const icoPx = rw => (Math.max(rw.length, rw[0].length) >= 9 ? 3 : 4);   // pixel interi per le icone delle righe di Statistiche
  // Ogni quadratino di un'icona pixel deve occupare un numero INTERO di pixel dello schermo: su un telefono con fattore di scala
  // 2,625 o 2,75 un quadratino da 3 pixel CSS sarebbe largo 7,9 o 8,25 pixel, e i disegni verrebbero storti e irregolari.
  const snapCell = px => { const d = window.devicePixelRatio || 1; return Math.max(1, Math.round(px * d)) / d; };
  const snapSize = (sv, cells) => +(cells * snapCell(+sv.dataset.px)).toFixed(4);
  function iconSvg(rows, px) {
    const h = rows.length, w = rows[0].length;
    let r = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'X') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }));
    const size = px ? ` data-px="${px}" data-cols="${w}" data-rows="${h}" width="${+(w * snapCell(px)).toFixed(4)}" height="${+(h * snapCell(px)).toFixed(4)}"` : '';
    return `<svg viewBox="0 0 ${w} ${h}"${size} fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  // numeri disegnati a pixel con le stesse forme del font dell'app (griglia 6 x 9 per cifra), così restano nitidi a qualsiasi dimensione dello schermo
  const DIGITS = {
    '0': ['..X...', '.X.X..', 'X...X.', 'X...X.', 'X...X.', 'X...X.', 'X...X.', '.X.X..', '..X...'],
    '1': ['...X..', '.XXX..', '...X..', '...X..', '...X..', '...X..', '...X..', '...X..', '...X..'],
    '2': ['.XXX..', 'X...X.', 'X...X.', '....X.', '...X..', '..X...', '.X....', 'X.....', 'XXXXX.'],
    '3': ['.XXX..', 'X...X.', 'X...X.', '....X.', '..XX..', '....X.', 'X...X.', 'X...X.', '.XXX..'],
    '4': ['..XX..', '.X.X..', '.X.X..', 'X..X..', 'X..X..', 'X..X..', 'XXXXX.', '...X..', '...X..'],
    '5': ['XXXXX.', 'X.....', 'X.....', 'X.....', 'XXXX..', '....X.', '....X.', 'X...X.', '.XXX..'],
    '6': ['.XXX..', 'X...X.', 'X.....', 'X.....', 'XXXX..', 'X...X.', 'X...X.', 'X...X.', '.XXX..'],
    '7': ['XXXXX.', '....X.', '....X.', '...X..', '...X..', '..X...', '..X...', '.X....', '.X....'],
    '8': ['.XXX..', 'X...X.', 'X...X.', 'X...X.', '.XXX..', 'X...X.', 'X...X.', 'X...X.', '.XXX..'],
    '9': ['.XXX..', 'X...X.', 'X...X.', 'X...X.', '.XXXX.', '....X.', '....X.', 'X...X.', '.XXX..'],
    '+': ['......', '..X...', '..X...', '..X...', 'XXXXX.', '..X...', '..X...', '..X...', '......'],
  };
  // righe di pixel di un numero, senza le colonne vuote ai lati (così sta al centro di badge e linguetta)
  function digitRows(str) {
    const rows = Array.from({ length: 9 }, (_, r) => [...str].map(ch => (DIGITS[ch] || DIGITS['0'])[r]).join(''));
    const used = c => rows.some(row => row[c] === 'X');
    let from = 0, to = rows[0].length - 1;
    while (from < to && !used(from)) from++;
    while (to > from && !used(to)) to--;
    return rows.map(row => row.slice(from, to + 1));
  }
  const digitsSvg = str => iconSvg(digitRows(str));

  /* ----- linguetta del livello: pixel art dorata al centro del bordo in alto della scheda Personaggio ----- */
  // targhetta con gli angoli smussati e bordo doppio (L chiaro, B oro, D scuro), interno I, punte a freccia ai lati;
  // dentro "Lv" e il numero con le cifre a pixel. Si allarga da sola con il numero (anche 100).
  const TAB_H = 15, TAB_LV = 8, TAB_PAD = 3, TAB_GAP = 2;
  const TAB_CAP = ['...L', '..LB', '.LBB', 'LBBB', '.DBB', '..DB', '...D'];
  const TAB_CAP_R = TAB_CAP.map(r => [...r].reverse().map(c => c === 'L' ? 'D' : c === 'D' ? 'L' : c).join(''));
  function levelTabSvg(level, px) {
    const dg = digitRows(String(Math.max(0, level)));
    const pw = 2 + TAB_PAD + TAB_LV + TAB_GAP + dg[0].length + TAB_PAD + 2, cap = TAB_CAP[0].length, W = pw + 2 * cap, H = TAB_H;
    const inside = (x, y) => x >= 0 && x < pw && y >= 0 && y < H && !((x === 0 || x === pw - 1) && (y === 0 || y === H - 1));
    const out = (x, y) => ({ u: !inside(x, y - 1), d: !inside(x, y + 1), l: !inside(x - 1, y), r: !inside(x + 1, y) });
    const edge = (x, y) => { const o = out(x, y); return o.u || o.d || o.l || o.r; };
    const grid = Array.from({ length: H }, () => Array(W).fill('.'));
    const cy = (H - TAB_CAP.length) / 2;
    TAB_CAP.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') grid[cy + y][x] = c; }));
    TAB_CAP_R.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') grid[cy + y][cap + pw + x] = c; }));
    for (let y = 0; y < H; y++) for (let x = 0; x < pw; x++) {
      if (!inside(x, y)) continue;
      let c;
      if (edge(x, y)) { const o = out(x, y); c = ((o.d || o.r) && !(o.u || o.l)) || (o.d && o.l) ? 'D' : 'L'; }
      else if ([[0, -1], [0, 1], [-1, 0], [1, 0]].some(([a, b]) => inside(x + a, y + b) && edge(x + a, y + b))) c = 'B';
      else c = 'I';
      grid[y][cap + x] = c;
    }
    const dx = cap + 2 + TAB_PAD + TAB_LV + TAB_GAP, dy = (H - 9) / 2;
    dg.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') grid[dy + y][dx + x] = 'n'; }));
    let body = '';
    grid.forEach((row, y) => {
      let x = 0;
      while (x < W) {
        const c = row[x]; let e = x + 1;
        while (e < W && row[e] === c) e++;
        if (c !== '.') body += `<rect class="lt-${c}" x="${x}" y="${y}" width="${e - x}" height="1"/>`;
        x = e;
      }
    });
    body += `<text class="lt-t" x="${cap + 2 + TAB_PAD}" y="${dy + 9}" font-size="10">${T('lv')}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" data-px="${px}" data-cols="${W}" data-rows="${H}" width="${+(W * snapCell(px)).toFixed(4)}" height="${+(H * snapCell(px)).toFixed(4)}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
  }
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
  const CX = 180, CY = 192, R = 108, LR = 148;
  const ang = i => (-90 + i * 60) * Math.PI / 180;
  const pt = (i, r) => [CX + r * Math.cos(ang(i)), CY + r * Math.sin(ang(i))];
  const ptsStr = arr => arr.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  // ordine delle statistiche nell'esagono, dalla cima in senso orario (l'elenco delle statistiche resta com'è)
  const RADAR_IDX = ['Intelletto', 'Vigore', 'Vitalita', 'Creativita', 'Legami', 'Animo'].map(k => STATS.findIndex(x => x.key === k));
  const POS = STATS.map((_, i) => RADAR_IDX.indexOf(i));      // posizione nell'esagono di ogni statistica
  // disegno completo del radar per certi XP (lo usano il tuo radar e il profilo degli amici)
  function radarMarkup(x) {
    const fr = STATS.map(s => fracLevel(x[s.key]));
    const top = Math.min(MAX_LEVEL, Math.max(10, Math.ceil(Math.max(...fr) / 10) * 10));
    let h = '';
    [0.25, 0.5, 0.75, 1].forEach(f => { h += `<polygon class="r-ring${f === 1 ? ' outer' : ''}" points="${ptsStr(STATS.map((_, i) => pt(i, R * f)))}"/>`; });
    STATS.forEach((_, i) => { const p = pt(i, R); h += `<line class="r-axis" x1="${CX}" y1="${CY}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`; });
    h += `<polygon class="r-shape" points="${ptsStr(RADAR_IDX.map((k, i) => pt(i, R * Math.min(1, Math.max(fr[k] / top, 0.03)))))}"/>`;
    RADAR_IDX.forEach((si, i) => {
      const s = STATS[si], p = pt(i, LR);
      let dyName = -6, dyLv = 16;
      if (i === 0) { dyName = -22; dyLv = 0; }
      if (i === 3) { dyName = 8; dyLv = 30; }
      const dx = (i === 1 || i === 2) ? 18 : (i === 4 || i === 5) ? -18 : 0;
      const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      h += `<text class="r-name" x="${(p[0] + dx).toFixed(1)}" y="${(p[1] + dyName).toFixed(1)}" text-anchor="middle">${esc(s.name)}</text>`;
      h += `<text class="r-lv" x="${(p[0] + dx).toFixed(1)}" y="${(p[1] + dyLv).toFixed(1)}" text-anchor="middle">${esc(T('lv') + ' ' + levelFromXp(x[s.key]))}</text>`;
    });
    return h;
  }
  radar.innerHTML = radarMarkup(blank());
  const shape = radar.querySelector('.r-shape');
  const radarNames = [...radar.querySelectorAll('.r-name')];   // nello stesso ordine di RADAR_IDX
  const labelLv = [...radar.querySelectorAll('.r-lv')];

  let radarCur = STATS.map(() => 0), radarRaf = 0;
  function drawRadar(ratios) {
    const pts = RADAR_IDX.map((k, i) => pt(i, R * Math.min(1, Math.max(ratios[k], 0.03))));
    shape.setAttribute('points', ptsStr(pts));
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
    pasteSlot = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    // un attimo dopo: se chi ha chiuso questa finestra ne apre subito un'altra (profilo di un amico, impostazioni...),
    // le penalità aspettano che si chiuda anche quella invece di aprirsi sotto di lei
    setTimeout(checkPenalties, 0);
  }
  function dataMsg(t) { $('data-msg').textContent = t; }
  // Impostazioni: cinque schede (Aspetto, Lingua, Suono, Dati, Info)
  const SET_TABS = { look: ['tab-look', 'pane-look'], lang: ['tab-lang', 'pane-lang'], sound: ['tab-sound', 'pane-sound'], data: ['tab-data', 'pane-data'], info: ['tab-info', 'pane-info'] };
  const SET_ORDER = ['look', 'lang', 'sound', 'data', 'info'];
  function showTab(name) {
    settingsWin.dataset.tab = name;
    SET_ORDER.forEach(n => {
      $(SET_TABS[n][1]).hidden = n !== name;
      const b = $(SET_TABS[n][0]);
      b.setAttribute('aria-selected', String(n === name));
      b.tabIndex = n === name ? 0 : -1;
    });
    $('btn-custom-reset').hidden = name !== 'look';
    if (name !== 'look') custResetArm(false);
    if (name === 'look') paintCustom();
    if (name === 'data') { dataMsg(''); $('json-box').hidden = true; resetArm(false); }
    if (name === 'info') renderInfo();
  }
  function openSettings(name) {
    if (!fbAuth && !(window.claude && typeof window.claude.use === 'function')) loadFirebase();   // pronte per "Accedi"
    showTab(name);
    openModal(settingsWin, name === 'look' ? $('in-name') : name === 'lang' ? $('tab-lang') : name === 'sound' ? $('btn-sound') : name === 'data' ? $('btn-export') : $('tab-info'));
  }
  $('btn-settings').addEventListener('click', () => openSettings('look'));
  SET_ORDER.forEach((n, i) => {
    const b = $(SET_TABS[n][0]);
    b.addEventListener('click', () => showTab(n));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const to = SET_ORDER[(i + (e.key === 'ArrowRight' ? 1 : SET_ORDER.length - 1)) % SET_ORDER.length];
      showTab(to);
      $(SET_TABS[to][0]).focus();
    });
  });
  $('btn-close').addEventListener('click', closeModal);
  settingsWin.addEventListener('click', e => { if (e.target === settingsWin) closeModal(); });

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
  const rootStyle = document.documentElement.style;
  const WIN_VARS = ['--win-a', '--win-b', '--win-c', '--win-edge', '--win-glow', '--ink-soft', '--track', '--btn'];

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
  }
  function hslToHex(hh, ss, ll) {
    ss /= 100; ll /= 100;
    const k = n => (n + hh / 30) % 12, a = ss * Math.min(ll, 1 - ll);
    const f = n => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  // colore di base delle finestre: se troppo chiaro viene scurito per lasciare il testo leggibile
  function winBase(c) {
    let a = c, k = 0;
    while (luminance(a) > 0.2 && k < 24) { a = mixHex(a, '#000000', 0.08); k++; }
    return a;
  }
  // variabili CSS delle finestre ricavate da un solo colore (le usa anche il profilo di un amico)
  function paletteVars(color) {
    const a = winBase(color), dk = mixHex(a, '#000000', 0.70);
    return {
      '--win-a': a,
      '--win-b': mixHex(a, '#000000', 0.45),
      '--win-c': dk,
      '--win-edge': dk,
      '--win-glow': mixHex(a, '#ffffff', 0.45),
      '--ink-soft': mixHex(a, '#ffffff', 0.72),
      '--track': mixHex(a, '#000000', 0.82),
      '--btn': mixHex(a, '#ffffff', 0.06),
    };
  }
  function applyTheme() {
    const c = settings.winColor;
    if (!c) { WIN_VARS.forEach(v => rootStyle.removeProperty(v)); return; }
    Object.entries(paletteVars(c)).forEach(([k, v]) => rootStyle.setProperty(k, v));
  }
  function applyFrame() { document.documentElement.dataset.frame = settings.frame; }
  // colori dei testi. --ink-soft dipende anche dal colore delle finestre: va applicato dopo di esso
  function applyTextColors() {
    ['--name-color', '--title-color', '--ink', '--ink-strong', '--gold'].forEach(v => rootStyle.removeProperty(v));
    if (settings.inkColor) { rootStyle.setProperty('--ink', settings.inkColor); rootStyle.setProperty('--ink-strong', settings.inkColor); }
    if (settings.accentColor) rootStyle.setProperty('--gold', settings.accentColor);
    if (settings.nameColor) rootStyle.setProperty('--name-color', settings.nameColor);
    if (settings.titleColor) rootStyle.setProperty('--title-color', settings.titleColor);
    if (settings.softColor) rootStyle.setProperty('--ink-soft', settings.softColor);
  }
  function applyPalette() { applyTheme(); applyTextColors(); }
  // trasparenza delle finestre: 0 = opache, 100 = completamente trasparenti.
  // Con la trasparenza si aggiunge uno sfocato (fino a 6px verso il 60%) che poi scompare,
  // così a 100% lo sfondo si vede nitido.
  function applyTransparency() {
    const t = settings.trans;
    if (!t) { rootStyle.removeProperty('--win-op'); rootStyle.removeProperty('--win-bf'); return; }
    rootStyle.setProperty('--win-op', (100 - t) + '%');
    const blur = t <= 60 ? t / 10 : 6 * (100 - t) / 40;
    if (blur > 0) rootStyle.setProperty('--win-bf', 'blur(' + blur + 'px)');
    else rootStyle.removeProperty('--win-bf');
  }
  function applyName() { $('player-name').textContent = settings.name.trim(); schedulePublish(); }
  // titolo in alto: testo a scelta (vuoto = "Life RPG") oppure nascosto
  function applyTitle() {
    const el = $('app-title');
    const text = settings.titleText.replace(/\s+/g, ' ').trim() || 'Life RPG';
    el.textContent = text;
    el.hidden = !settings.titleShow;
    el.classList.toggle('long', text.length > 16);
    document.title = settings.titleShow ? text : 'Life RPG';
  }
  function statColor(key) { return settings.colors[key] || STATS.find(s => s.key === key).color; }
  // colore del testo leggibile su fondo scuro: se quello scelto è troppo scuro lo si schiarisce (il bordo resta del colore scelto)
  function readable(hex) {
    let c = HEX.test(hex) ? hex : '#ffffff';
    for (let k = 0; k < 20 && luminance(c) < 0.18; k++) c = mixHex(c, '#ffffff', 0.12);
    return c;
  }
  function statIconId(key) { return STATS.find(s => s.key === key).icon; }
  // mostra l'icona pixel oppure l'immagine caricata
  function paintIcon(el, key) {
    const data = imgs[key];
    if (data) {
      const im = document.createElement('img');
      im.alt = ''; im.src = data;
      el.textContent = '';
      el.appendChild(im);
      el.classList.add('has-img');
    } else {
      el.classList.remove('has-img');
      const rw = ICONS[statIconId(key)].rows;
      // nelle righe delle statistiche l'icona ha pixel interi (3 o 4 px), così resta nitida
      el.innerHTML = iconSvg(rw, el.classList.contains('ico') ? icoPx(rw) : 0);
    }
  }
  function applyStats() {
    STATS.forEach(s => {
      const c = statColor(s.key), r = rows[s.key];
      r.item.style.setProperty('--c', c);
      paintIcon(r.item.querySelector('.ico'), s.key);
    });
  }
  // con "riduci animazioni" attivo sul dispositivo, una GIF di sfondo viene mostrata ferma (primo fotogramma)
  let stillSrc = null, stillUrl = null, stillFor = null;
  function stillOf(src) {
    if (stillSrc === src) return stillUrl;
    if (stillFor !== src) {
      stillFor = src;
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth || 1; c.height = im.naturalHeight || 1;
        c.getContext('2d').drawImage(im, 0, 0);
        stillSrc = src; stillUrl = c.toDataURL('image/png');
        if (imgs.bg === src) applyImages();
      };
      im.src = src;
    }
    return null;
  }
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function applyImages() {
    schedulePublish();
    const el = $('bg-img');
    let bg = imgs.bg;
    if (bg && isGif(bg) && reduceMotion()) bg = stillOf(bg);
    if (bg) {
      el.style.backgroundImage = 'url("' + bg + '")';
      el.style.backgroundSize = (FITS.find(f => f.id === settings.bgFit) || FITS[0]).size;
      // "Adatta": le bande vuote si riempiono con una copia sfocata della stessa immagine
      const fill = $('bg-fill');
      if (settings.bgFit === 'adatta') { fill.style.backgroundImage = 'url("' + bg + '")'; fill.hidden = false; }
      else { fill.hidden = true; fill.style.backgroundImage = ''; }
      el.hidden = false;
      document.body.classList.add('has-bg');
    } else {
      el.hidden = true;
      el.style.backgroundImage = '';
      el.style.backgroundSize = '';
      $('bg-fill').hidden = true;
      $('bg-fill').style.backgroundImage = '';
      document.body.classList.remove('has-bg');
    }
    applyStats();
  }
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

  const cs = {};
  function buildCustom() {
    // colori: finestre, nome e titolo
    $('in-win').addEventListener('input', e => {
      settings.winColor = e.target.value.toLowerCase();
      applyPalette(); paintCustom(); changed(true);
    });
    $('win-reset').addEventListener('click', () => { settings.winColor = null; applyPalette(); paintCustom(); changed(); });
    [['in-ink', 'ink-reset', 'inkColor'], ['in-soft', 'soft-reset', 'softColor'], ['in-accent', 'accent-reset', 'accentColor'],
     ['in-name-color', 'name-color-reset', 'nameColor'], ['in-title-color', 'title-color-reset', 'titleColor']]
      .forEach(([inp, rst, key]) => {
        $(inp).addEventListener('input', e => { settings[key] = e.target.value.toLowerCase(); applyPalette(); paintCustom(); changed(true); });
        $(rst).addEventListener('click', () => { settings[key] = null; applyPalette(); paintCustom(); changed(); });
      });
    // trasparenza
    $('in-trans').addEventListener('input', e => {
      settings.trans = Math.min(100, Math.max(0, Math.round(Number(e.target.value)) || 0));
      $('trans-val').textContent = settings.trans + '%';
      applyTransparency(); changed(true);
    });
    // bordi delle finestre
    FRAMES.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = f.name; b.dataset.id = f.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { settings.frame = f.id; applyFrame(); paintCustom(); changed(); });
      $('seg-frame').appendChild(b);
    });
    // lingua
    LANGS.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = l.name; b.dataset.id = l.id; b.lang = l.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        if (settings.lang === l.id) return;
        settings.lang = l.id;
        applyLang(); paintCustom(); changed();
        // i messaggi già mostrati restano nella vecchia lingua: si tolgono
        missionMsg(''); dataMsg(''); imgMsg('');
      });
      $('seg-lang').appendChild(b);
    });
    // adattamento dell'immagine di sfondo
    FITS.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = f.name; b.dataset.id = f.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { settings.bgFit = f.id; applyImages(); paintCustom(); changed(); });
      $('seg-fit').appendChild(b);
    });
    // titolo in alto
    $('in-title').addEventListener('input', e => {
      settings.titleText = e.target.value.slice(0, 24);
      applyTitle(); changed(true);
    });
    $('btn-title-show').addEventListener('click', () => {
      settings.titleShow = !settings.titleShow;
      applyTitle(); paintCustom(); changed();
    });
    // sfondo visibile agli amici
    $('btn-share-bg').addEventListener('click', () => {
      settings.shareBg = !settings.shareBg;
      paintCustom(); changed();
    });
    // nome
    $('in-name').addEventListener('input', e => {
      settings.name = e.target.value.slice(0, 16);
      applyName(); changed(true);
    });
    // icona e colore di ogni statistica
    STATS.forEach(s => {
      const item = document.createElement('div');
      item.className = 'cs-item';
      item.dataset.slot = s.key;
      item.innerHTML =
        '<div class="cs-row">' +
          `<button type="button" class="cs-icon" aria-expanded="false" aria-label="${T('cs.icon.aria', { name: s.name })}"></button>` +
          `<span class="cs-name">${s.name}</span>` +
          `<input type="color" class="cs-color" aria-label="${T('cs.color.aria', { name: s.name })}">` +
        '</div>' +
        '<div class="cs-panel" hidden>' +
          '<div class="img-actions">' +
            '<button type="button" class="btn small cs-upload" data-i18n="img.use">' + T('img.use') + '</button>' +
            '<button type="button" class="btn small sub cs-remove" hidden data-i18n="img.remove">' + T('img.remove') + '</button>' +
          '</div>' +
          '<p class="tip" data-i18n="img.tip">' + T('img.tip') + '</p>' +
        '</div>';
      $('stat-custom').appendChild(item);
      const q = sel => item.querySelector(sel);
      const c = cs[s.key] = {
        item, icoBtn: q('.cs-icon'), nameEl: q('.cs-name'), color: q('.cs-color'),
        panel: q('.cs-panel'), upBtn: q('.cs-upload'), rmBtn: q('.cs-remove'),
      };
      c.upBtn.addEventListener('click', () => pickImage(s.key));
      c.rmBtn.addEventListener('click', () => { setImg(s.key, null); imgMsg(T('img.msg.removed')); });
      c.icoBtn.addEventListener('click', () => {
        const open = c.panel.hidden;
        STATS.forEach(t => { cs[t.key].panel.hidden = true; cs[t.key].icoBtn.setAttribute('aria-expanded', 'false'); });
        c.panel.hidden = !open;
        c.icoBtn.setAttribute('aria-expanded', String(open));
      });
      c.color.addEventListener('input', e => {
        settings.colors[s.key] = e.target.value.toLowerCase();
        applyStats(); paintCustom(); changed(true);
      });
    });

    $('btn-custom-reset').addEventListener('click', () => {
      const b = $('btn-custom-reset');
      if (!b.dataset.armed) { custResetArm(true); return; }
      custResetArm(false);
      settings = Object.assign(defaultSettings(), { lang: settings.lang });   // la lingua non fa parte dell'aspetto
      IMG_NAMES.forEach(n => { if (imgs[n]) setImg(n, null); });
      applyAll(); paintCustom(); changed();
      imgMsg('');
    });

    document.querySelectorAll('#settings input[type="color"]').forEach(attachHex);
  }

  function paintCustom() {
    $('in-name').value = settings.name;
    $('in-title').value = settings.titleText;
    $('btn-title-show').setAttribute('aria-pressed', String(settings.titleShow));
    $('btn-title-show').textContent = settings.titleShow ? T('look.title.shown') : T('look.title.hidden');
    $('btn-share-bg').setAttribute('aria-pressed', String(settings.shareBg));
    $('btn-share-bg').textContent = settings.shareBg ? T('look.sharebg.on') : T('look.sharebg.off');
    $('share-bg-big').hidden = !(settings.shareBg && imgs.bg && imgs.bg.length > CLOUD_IMG_MAX);
    $('in-trans').value = settings.trans;
    $('trans-val').textContent = settings.trans + '%';
    $('in-win').value = settings.winColor || '#3049cf';
    $('win-reset').hidden = !settings.winColor;
    const accent = settings.accentColor || '#ffd54a';
    $('in-ink').value = settings.inkColor || '#f5f7ff';
    $('ink-reset').hidden = !settings.inkColor;
    $('in-soft').value = settings.softColor || (settings.winColor ? mixHex(winBase(settings.winColor), '#ffffff', 0.72) : '#b9c4ff');
    $('soft-reset').hidden = !settings.softColor;
    $('in-accent').value = accent;
    $('accent-reset').hidden = !settings.accentColor;
    $('in-name-color').value = settings.nameColor || accent;
    $('name-color-reset').hidden = !settings.nameColor;
    $('in-title-color').value = settings.titleColor || accent;
    $('title-color-reset').hidden = !settings.titleColor;
    document.querySelectorAll('#seg-frame button').forEach(b => {
      b.textContent = T('frame.' + b.dataset.id);
      b.setAttribute('aria-checked', String(b.dataset.id === settings.frame));
    });
    document.querySelectorAll('#seg-lang button').forEach(b =>
      b.setAttribute('aria-checked', String(b.dataset.id === settings.lang)));
    STATS.forEach(s => {
      const c = cs[s.key], col = statColor(s.key);
      c.item.style.setProperty('--c', col);
      c.nameEl.textContent = s.name;
      c.icoBtn.setAttribute('aria-label', T('cs.icon.aria', { name: s.name }));
      c.color.setAttribute('aria-label', T('cs.color.aria', { name: s.name }));
      paintIcon(c.icoBtn, s.key);
      c.color.value = col;
      c.rmBtn.hidden = !imgs[s.key];
    });
    $('bg-remove').hidden = !imgs.bg;
    $('fit-wrap').hidden = !imgs.bg;
    document.querySelectorAll('#seg-fit button').forEach(b => {
      b.textContent = T('fit.' + b.dataset.id);
      b.setAttribute('aria-checked', String(b.dataset.id === settings.bgFit));
    });
    syncHex();
  }

  // accanto a ogni selettore di colore c'è un campo per scrivere il codice esadecimale
  function normHex(v) {
    let t = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(ch => ch + ch).join('');
    return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
  }
  function attachHex(colorEl) {
    const t = document.createElement('input');
    t.type = 'text'; t.className = 'hex'; t.maxLength = 7;
    t.spellcheck = false; t.autocomplete = 'off'; t.placeholder = '#rrggbb';
    t.setAttribute('aria-label', T('hex.aria'));
    t.value = colorEl.value;
    colorEl.insertAdjacentElement('afterend', t);
    colorEl._hex = t;
    colorEl.addEventListener('input', () => {
      if (document.activeElement !== t) t.value = colorEl.value;
      t.removeAttribute('aria-invalid');
    });
    t.addEventListener('input', () => {
      const v = normHex(t.value);
      if (!v) { t.setAttribute('aria-invalid', 'true'); return; }
      t.removeAttribute('aria-invalid');
      colorEl.value = v;
      colorEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    t.addEventListener('blur', () => { t.value = colorEl.value; t.removeAttribute('aria-invalid'); });
  }
  function syncHex() {
    document.querySelectorAll('#settings input[type="color"]').forEach(c => {
      if (c._hex && document.activeElement !== c._hex) c._hex.value = c.value;
    });
  }


  /* ----- caricamento immagini ----- */
  // Le pagine pubblicate non possono aprire indirizzi web: le immagini arrivano da un file,
  // dagli appunti (incolla) o dal trascinamento, poi vengono ridimensionate e salvate.
  const MAX_FILE = 15 * 1024 * 1024;
  const imgQueue = new Set();
  let imgBusy = false;
  function imgMsg(t) { $('custom-msg').textContent = t; }

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

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('lettura'));
      fr.onload = () => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('formato'));
        im.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }
  function makeIcon(im) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const g = c.getContext('2d');
    const k = Math.max(96 / im.width, 96 / im.height);
    const dw = im.width * k, dh = im.height * k;
    g.drawImage(im, (96 - dw) / 2, (96 - dh) / 2, dw, dh);
    let url = c.toDataURL('image/png');
    if (url.length > 120000) url = c.toDataURL('image/jpeg', 0.8);
    return url;
  }
  function makeBackground(im) {
    const tries = [[1280, 0.72], [1280, 0.6], [1024, 0.6], [900, 0.5], [720, 0.5], [560, 0.45]];
    for (const [max, q] of tries) {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.drawImage(im, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', q);
      if (url.length <= 200000) return url;
    }
    return null;
  }
  async function useImageFile(slot, file) {
    if (!file || !/^image\//.test(file.type || '')) { imgMsg(T('img.msg.notimg')); return; }
    if (file.size > MAX_FILE) { imgMsg(T('img.msg.big')); return; }
    imgMsg(T('img.msg.work'));
    try {
      const im = await loadImage(file);
      let data, gifBig = false;
      if (slot === 'bg' && isGif(im.src)) {
        // le GIF si tengono così come sono, altrimenti perdono l'animazione
        if (file.size <= GIF_MAX_FILE) data = im.src;
        else { data = makeBackground(im); gifBig = true; }
      } else data = slot === 'bg' ? makeBackground(im) : makeIcon(im);
      if (!validImg(data)) { imgMsg(T('img.msg.unusable')); return; }
      const saved = await setImg(slot, data);
      if (!saved) imgMsg(T('img.msg.full'));
      else if (gifBig) imgMsg(T('img.msg.gifbig'));
      else if (dbRef && data.length > CLOUD_IMG_MAX) imgMsg(T('img.msg.gifcloud'));
      else imgMsg(T('img.msg.ok'));
    } catch (e) {
      imgMsg(T('img.msg.unread'));
    }
  }

  const fileImg = $('file-img');
  let uploadSlot = null, pasteSlot = null;
  function pickImage(slot) { uploadSlot = slot; fileImg.click(); }
  fileImg.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f && uploadSlot) useImageFile(uploadSlot, f);
  });
  $('bg-upload').addEventListener('click', () => pickImage('bg'));
  $('bg-remove').addEventListener('click', () => { setImg('bg', null); imgMsg(T('img.msg.bgremoved')); });

  // ricorda l'area su cui hai toccato per sapere dove incollare
  const slotOf = el => (el && el.closest ? el.closest('[data-slot]') : null);
  paneLook.addEventListener('pointerdown', e => { const s = slotOf(e.target); pasteSlot = s ? s.dataset.slot : null; });
  paneLook.addEventListener('focusin', e => { const s = slotOf(e.target); if (s) pasteSlot = s.dataset.slot; });
  document.addEventListener('paste', e => {
    if (activeModal !== settingsWin || paneLook.hidden) return;
    const focused = slotOf(document.activeElement);
    const slot = pasteSlot || (focused ? focused.dataset.slot : null);
    if (!slot) return;
    const items = e.clipboardData && e.clipboardData.items ? [...e.clipboardData.items] : [];
    const it = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!it) return;
    e.preventDefault();
    useImageFile(slot, it.getAsFile());
  });
  function wireDrops() {
    paneLook.querySelectorAll('[data-slot]').forEach(el => {
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag'));
      el.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) useImageFile(el.dataset.slot, f);
        else imgMsg(T('img.msg.drop'));
      });
    });
  }
  // un file lasciato fuori dalle aree non deve aprirsi al posto della pagina
  ['dragover', 'drop'].forEach(t => window.addEventListener(t, e => e.preventDefault()));

  /* ================= missioni e calendario ================= */
  const pad2 = n => String(n).padStart(2, '0');
  const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => isoDate(new Date());
  const monthOf = m => m.created.slice(0, 7);
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  // istante (in millisecondi) dopo il quale la missione è scaduta, con l'orologio del dispositivo:
  // alla fine dell'ora scelta (minuto compreso) oppure, senza ora, alla fine del giorno
  // istante da cui la missione si può completare (senza ora: da mezzanotte)
  function startMs(m) {
    if (!m.from) return -Infinity;
    const d = parseDate(m.from);
    if (m.fromTime) { const [hh, mm] = m.fromTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); }
    return d.getTime();
  }
  function dueEndMs(m) {
    if (!m.due) return Infinity;
    const d = parseDate(m.due);
    if (m.dueTime) { const [hh, mm] = m.dueTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); return d.getTime() + 60000; }
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const isLate = m => !m.done && Date.now() >= dueEndMs(m);
  const dueKey = m => (m.due || m.from || '9999-99-99') + ' ' + (m.dueTime || '99:99');
  const fmtClock = ms => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtDay = (s, long) => cap1(parseDate(s).toLocaleDateString(locale(),
    long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }));
  const dueLabel = m => fmtDay(m.due) + (m.dueTime ? T('time.at', { time: m.dueTime }) : '');
  const fromLabel = m => fmtDay(m.from) + (m.fromTime ? T('time.at', { time: m.fromTime }) : '');
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
      const e = effOf(m), d = {};
      addEff(d, e, 1); addEff(d, was ? was.e : {}, -1);
      if (STATS.some(s => d[s.key])) {
        const c = JSON.parse(JSON.stringify(m.c || {})), mine = c[DEV] || {};
        STATS.forEach(s => { const v = (mine[s.key] || 0) + (d[s.key] || 0); if (v) mine[s.key] = v; else delete mine[s.key]; });
        if (Object.keys(mine).length) c[DEV] = mine; else delete c[DEV];
        if (Object.keys(c).length) m.c = c; else delete m.c;
      }
      mSeen.set(m.id, { g, e });
    });
  }
  function touchMonth(ym) {
    stampMonth(ym);
    monthQueue.add(ym);
    saveMissionsLocal();
    flushMissions();
  }

  // messaggi
  // Messaggi sulle missioni. Le conferme ("Missione creata…") non si vedono: le legge solo il lettore di schermo,
  // perché chi guarda lo schermo vede già succedere l'azione. Si vedono (in rosso) solo i messaggi che spiegano
  // perché un'azione non è avvenuta (visible = true).
  function missionMsg(text, kind, visible) {
    ['mis-msg', 'cal-msg'].forEach(id => { const e = $(id); e.textContent = visible ? text : ''; e.className = 'msg' + (kind ? ' ' + kind : ''); });
    const live = $('act-live');
    live.textContent = '';
    if (!visible && text) setTimeout(() => { live.textContent = text; }, 50);   // un attimo dopo, così viene letto anche se è uguale al precedente
  }
  const gainText = map => {
    if (allSame(map)) return '+' + fmt(allSame(map)) + ' ' + T('xp.all');
    const parts = STATS.filter(s => map[s.key] > 0).map(s => '+' + fmt(map[s.key]) + ' ' + s.name);
    return parts.length ? parts.join(', ') : T('xp.none.lower');
  };

  // completare e annullare
  // ancora non completabile: la data è nel futuro
  // non ancora completabile: una missione prima della sua disponibilità (giorno e ora), una routine prima del suo giorno
  const notYet = m => !m.done && !m.failed && (m.rid ? !!m.due && m.due > todayStr() : !!m.from && Date.now() < startMs(m));
  function completeMission(id) {
    const m = missions.find(x => x.id === id);
    if (!m || m.done || m.failed) return;   // scaduta: non si completa più (si può solo riprogrammare)
    if (isLate(m)) {   // scaduta da poco ma non ancora segnata come fallita: non si completa, e diventa fallita adesso
      missionMsg(T('msg.expired', { title: m.title }), 'bad', true);
      sfx('err');
      renderMissionViews();
      checkPenalties();
      return;
    }
    if (notYet(m)) { missionMsg(T('m.locked', { when: m.rid ? fmtDay(m.due) : fromLabel(m) }), 'bad', true); sfx('err'); return; }
    const before = STATS.map(s => levelFromXp(xp[s.key]));
    const ovFrom = overallOf(before);
    const applied = {};
    // routine: la serie cresce solo se la completi entro il giorno previsto
    const rt = routineOf(m);
    let rs = null;
    const bonus = {};
    if (rt && m.due && todayStr() <= m.due && m.due > (rt.streakDate || '')) {
      const n = (rt.streak || 0) + 1;
      rs = { prev: rt.streak || 0, prevDate: rt.streakDate || '', n };
      if (rt.bonus && n % rt.bonus.every === 0) STATS.forEach(s => { if (m.rewards[s.key] > 0) bonus[s.key] = rt.bonus.xp; });
    }
    STATS.forEach(s => {
      const b = xp[s.key];
      xp[s.key] = Math.min(MAX_XP, b + (m.rewards[s.key] || 0) + (bonus[s.key] || 0));
      applied[s.key] = xp[s.key] - b;
    });
    const lastT = missions.reduce((mx, x) => x.done ? Math.max(mx, x.done.t) : mx, 0);
    m.done = { date: todayStr(), t: Math.max(Date.now(), lastT + 1), applied };   // t cresce sempre: ordina le completate
    if (rs) {
      m.done.rs = rs;
      rt.streak = rs.n; rt.streakDate = m.due; rt.best = Math.max(rt.best || 0, rs.n);
      saveRoutinesLocal();
    }
    persist();
    touchMonth(monthOf(m));
    const after = STATS.map(s => levelFromXp(xp[s.key]));
    const ups = STATS.map((s, i) => ({ s, from: before[i], to: after[i] })).filter(u => u.to > u.from);
    render(true);
    STATS.forEach(s => { if (applied[s.key] > 0) floatText(s.key, '+' + fmt(applied[s.key]), false); });
    missionMsg(T(Object.keys(bonus).length ? 'msg.completed.bonus' : 'msg.completed', { title: m.title, gain: gainText(applied), n: rs ? rs.n : 0 }), 'good');
    renderMissionViews();
    if (ups.length) { showLevelUp(ups, ovFrom, overallOf(after)); sfx('up'); } else sfx(Object.keys(bonus).length ? 'bonus' : 'add');
  }
  function undoMission(id) {
    const m = missions.find(x => x.id === id);
    if (!m || !m.done) return;
    const before = STATS.map(s => levelFromXp(xp[s.key]));
    const removed = {};
    STATS.forEach(s => {
      const b = xp[s.key];
      xp[s.key] = Math.max(0, b - (m.done.applied[s.key] || 0));
      removed[s.key] = b - xp[s.key];
    });
    const rsBack = m.done.rs, rtBack = routineOf(m);
    m.done = null;
    if (rsBack && rtBack && rtBack.streakDate === m.due) {   // la serie torna com'era prima
      rtBack.streak = rsBack.prev;
      rtBack.streakDate = rsBack.prevDate || addDaysStr(m.due, -1);
      saveRoutinesLocal();
    }
    persist();
    touchMonth(monthOf(m));
    const after = STATS.map(s => levelFromXp(xp[s.key]));
    render(true);
    const parts = STATS.filter(s => removed[s.key] > 0).map(s => '-' + fmt(removed[s.key]) + ' ' + s.name);
    missionMsg(T('msg.undone', { title: m.title, loss: parts.length ? parts.join(', ') : T('xp.none.remove') }), 'bad');
    renderMissionViews();
    sfx(after.some((l, i) => l < before[i]) ? 'down' : 'sub');
  }

  // penalità: alla prima apertura dopo la scadenza, una sola volta per missione
  function revertPenalty(id) {
    const m = missions.find(x => x.id === id);
    if (!m || !m.failed || m.done || m.rid) return;
    const restored = {};
    STATS.forEach(s => {
      const b = xp[s.key];
      xp[s.key] = Math.min(MAX_XP, b + (m.failed.applied[s.key] || 0));
      restored[s.key] = xp[s.key] - b;
    });
    m.failed = null;
    m.due = null;   // senza data (e senza ora), così non scade di nuovo
    m.dueTime = null;
    persist();
    touchMonth(monthOf(m));
    render(true);
    missionMsg(T(hasAny(restored) ? 'msg.penrev' : 'msg.resched', { title: m.title, gain: gainText(restored) }), 'good');
    renderMissionViews();
    sfx('add');
    // si apre la modifica per scegliere una nuova data; se la chiudi, la missione resta senza data
    openMissionForm(m.id);
    mfMsg(T(hasAny(restored) ? 'msg.penrev.form' : 'msg.resched.form'));
    $('mf-date').focus();
  }
  function showPenalties(list, before, after, ovBefore, ovAfter) {
    $('pen-sum').textContent = TN('pen.sum', list.length);
    const box = $('pen-list');
    box.textContent = '';
    list.forEach(({ m, removed }) => {
      const card = mk('article', 'mission failed');
      const head = mk('div', 'm-head');
      head.appendChild(mk('h3', 'm-title', m.title));
      head.appendChild(mk('span', 'm-date late', T('m.late.on', { when: dueLabel(m) })));
      card.appendChild(head);
      card.appendChild(lossChips(removed));
      box.appendChild(card);
    });
    const drops = $('pen-drops');
    drops.textContent = '';
    STATS.forEach((s, i) => {
      if (after[i] >= before[i]) return;
      const line = mk('p', 'pen-line');
      const name = nameSpan(s.key);
      line.append(name, ' ', mk('span', 'to', T('pen.line', { to: after[i] })));
      drops.appendChild(line);
    });
    if (ovAfter < ovBefore) drops.appendChild(mk('p', 'pen-line', T('lu.overall', { from: ovBefore, to: ovAfter })));
    openModal($('pmodal'), $('pen-ok'));
    sfx('down');
  }
  function applyPenalties() {
    if (activeModal) return false;   // non interrompere chi sta scrivendo: si riprova dopo
    const today = todayStr();
    const due = missions
      .filter(m => !m.done && !m.failed && m.due && isLate(m))
      .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.created.localeCompare(b.created));
    if (!due.length) return true;
    const before = STATS.map(s => levelFromXp(xp[s.key]));
    const list = [];
    due.forEach((m, i) => {
      const removed = {};
      STATS.forEach(s => {
        const r = Math.min(xp[s.key], m.penalty[s.key] || 0);
        xp[s.key] -= r;
        removed[s.key] = r;
      });
      m.failed = { date: today, t: Date.now() + i, applied: removed };
      list.push({ m, removed });
    });
    new Set(due.map(monthOf)).forEach(touchMonth);   // un salvataggio per mese, non uno per missione
    persist();
    const after = STATS.map(s => levelFromXp(xp[s.key]));
    render(true);
    STATS.forEach(s => {
      const tot = list.reduce((a, x) => a + x.removed[s.key], 0);
      if (tot > 0) floatText(s.key, '-' + fmt(tot), true);
    });
    renderMissionViews();
    showPenalties(list, before, after, overallOf(before), overallOf(after));
    return true;
  }
  /* ----- routine: creazione delle volte e serie ----- */
  const WD_ALL = [1, 2, 3, 4, 5, 6, 0];   // giorni nel modulo, lunedì per primo (numeri di Date.getDay)
  const addDaysStr = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return isoDate(d); };
  const inPause = (r, d) => !!r.pause && r.pause.from <= d && d <= r.pause.until;
  const dayCounts = (r, d) => d >= r.start && r.days.includes(parseDate(d).getDay()) && !inPause(r, d);
  const occId = (r, d) => r.id + '-' + d.replace(/-/g, '');
  const routineOf = m => (m && m.rid ? routines.find(r => r.id === m.rid) || null : null);
  // crea le volte di oggi, aggiorna la serie e pulisce le volte saltate; true se qualcosa è cambiato
  let routinesDay = '';
  function syncRoutines() {
    routinesDay = todayStr();
    if (!routines.length && !missions.some(m => m.rid)) return false;
    const today = todayStr();
    const yesterday = addDaysStr(today, -1);
    const months = new Set();
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
      const r = routineOf(m);
      let drop = false;
      if (!m.done && !m.failed) drop = !!r && (inPause(r, m.due) || m.due < r.start);
      else drop = (m.done || m.failed).date < keepFrom;
      if (drop) { months.add(monthOf(m)); changed = true; }
      return !drop;
    });
    if (routinesChanged) saveRoutinesLocal();
    if (changed) months.forEach(touchMonth);
    return changed;
  }

  // le penalità scattano appena la missione scade: all'apertura, al ritorno sulla pagina e, con l'app aperta, entro pochi secondi
  let penaltyReady = false, lastSig = '', holdUntil = 0, holdT = 0;
  // tornando sull'app, con l'account collegato, le penalità aspettano un paio di secondi: il tempo di ricevere
  // quello che hai fatto su un altro dispositivo (per esempio una missione completata lì)
  function holdPenalties(ms) {
    holdUntil = Date.now() + ms;
    clearTimeout(holdT);
    holdT = setTimeout(checkPenalties, ms + 50);
  }
  function checkPenalties() {
    // le penalità aspettano il caricamento dell'account e che non ci sia una finestra aperta; le schede si aggiornano comunque
    if (penaltyReady && !activeModal && Date.now() >= holdUntil) {
      if (syncRoutines()) renderMissionViews();
      applyPenalties();
    }
    const sig = todayStr() + ':' + missions.filter(m => !m.done && isLate(m)).length;
    if (sig !== lastSig) { lastSig = sig; renderMissionViews(); }
  }
  $('pen-ok').addEventListener('click', closeModal);
  $('pmodal').addEventListener('click', e => { if (e.target === $('pmodal')) closeModal(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (dbRef) holdPenalties(2500);
    checkPenalties();
  });
  window.addEventListener('focus', checkPenalties);
  // con l'app aperta: a cavallo della mezzanotte compaiono le routine del nuovo giorno,
  // e una missione che scade diventa subito fallita (con una finestra aperta si aspetta che la chiudi)
  setInterval(() => {
    if (document.hidden) return;
    if (todayStr() !== routinesDay || missions.some(m => !m.done && !m.failed && isLate(m))) checkPenalties();
  }, 15000);

  // schede delle missioni
  // valore uguale per tutte e sei le statistiche (0 se non lo è)
  const allSame = map => {
    const v = STATS.map(s => Number(map && map[s.key]) || 0);
    return v[0] > 0 && v.every(x => x === v[0]) ? v[0] : 0;
  };
  function chips(map) {
    const box = mk('div', 'chips');
    let any = false;
    const same = allSame(map);
    if (same) {
      any = true;
      box.appendChild(mk('span', 'chip all', '+' + fmt(same) + ' ' + T('xp.all')));
    } else STATS.forEach(s => {
      if (!(map[s.key] > 0)) return;
      any = true;
      const c = mk('span', 'chip', '+' + fmt(map[s.key]) + ' ' + s.name);
      c.style.setProperty('--c', statColor(s.key));
      c.style.setProperty('--ct', readable(statColor(s.key)));
      box.appendChild(c);
    });
    if (!any) box.appendChild(mk('span', 'chip none', T('xp.none')));
    return box;
  }
  const hasAny = map => STATS.some(s => map && map[s.key] > 0);
  const lossText = map => {
    if (allSame(map)) return '-' + fmt(allSame(map)) + ' ' + T('xp.all');
    const parts = STATS.filter(s => map[s.key] > 0).map(s => '-' + fmt(map[s.key]) + ' ' + s.name);
    return parts.length ? parts.join(', ') : T('xp.none.lower');
  };
  function lossChips(map) {
    const box = mk('div', 'chips');
    let any = false;
    if (allSame(map)) {
      any = true;
      box.appendChild(mk('span', 'chip loss', '-' + fmt(allSame(map)) + ' ' + T('xp.all')));
    } else STATS.forEach(s => {
      if (!(map[s.key] > 0)) return;
      any = true;
      box.appendChild(mk('span', 'chip loss', '-' + fmt(map[s.key]) + ' ' + s.name));
    });
    if (!any) box.appendChild(mk('span', 'chip none', T('xp.none.remove')));
    return box;
  }
  // Google Calendar: apre un evento già compilato; l'avviso (promemoria) lo decide il calendario di chi lo salva
  function gcalUrl(m) {
    const d8 = ds => ds.replace(/-/g, '');
    const p2 = n => String(n).padStart(2, '0');
    let dates;
    if (m.dueTime) {
      const [hh, mm] = m.dueTime.split(':').map(Number);
      const e = parseDate(m.due); e.setHours(hh, mm + 30, 0, 0);
      dates = d8(m.due) + 'T' + p2(hh) + p2(mm) + '00/' + d8(isoDate(e)) + 'T' + p2(e.getHours()) + p2(e.getMinutes()) + '00';
    } else {
      const n = parseDate(m.due); n.setDate(n.getDate() + 1);
      dates = d8(m.due) + '/' + d8(isoDate(n));
    }
    let u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(m.title) + '&dates=' + dates;
    if (m.desc) u += '&details=' + encodeURIComponent(m.desc);
    return u;
  }
  // le stesse 5 stelle del modulo, in piccolo e non toccabili, per vedere durata e difficoltà nell'elenco
  function miniStars(n) {
    const wrap = mk('span', 'mini-stars');
    for (let i = 1; i <= 5; i++) {
      const s = mk('span', 'mini-star' + (i <= n ? ' filled' : ''));
      s.innerHTML = iconSvg(starRows, 2);
      wrap.appendChild(s);
    }
    return wrap;
  }
  // etichetta "↻ Routine · serie 5": dice subito che tipo di missione è, quindi sta sotto il titolo
  const ROUTINE_ICON = ['...XXX...', '.XX...X..', '.X....XXX', 'X......X.', 'X........', 'X.......X', '.X.....X.', '.XX...XX.', '...XXX...'];
  function routineTag(text) {
    const t = mk('p', 'm-tag');
    const ic = mk('span', 'm-tag-ico'); ic.innerHTML = iconSvg(ROUTINE_ICON, 2);
    t.append(ic, mk('span', null, text));
    return t;
  }
  function starsLine(stars) {
    if (!stars) return null;   // missione creata prima di questo sistema: niente da mostrare
    const wrap = mk('div', 'm-stars');
    // due file in una griglia: le stelle di Durata e di Difficoltà partono dallo stesso punto
    wrap.append(mk('span', 'm-stars-lbl', T('mf.reward.dur')), miniStars(stars.d),
                mk('span', 'm-stars-lbl', T('mf.reward.dif')), miniStars(stars.f));
    wrap.setAttribute('aria-label', T('m.stars.aria', { d: stars.d, f: stars.f }));
    return wrap;
  }
  // inCal: scheda del pannello "Giorno" del calendario, in sola lettura
  function missionCard(m, inCal) {
    const failedNow = !!m.failed && !m.done;
    const card = mk('article', 'mission' + (m.done ? ' done' : '') + (failedNow ? ' failed' : ''));
    card.dataset.id = m.id;
    const head = mk('div', 'm-head');
    head.appendChild(mk('h3', 'm-title', m.title));
    if (m.done) head.appendChild(mk('span', 'm-date', T('m.done.on', { when: fmtDay(m.done.date) + (m.done.t > 1e12 ? T('time.at', { time: fmtClock(m.done.t) }) : '') })));
    else if (m.due) {
      const late = isLate(m);
      const txt = late ? T('m.late.on', { when: dueLabel(m) })
        : !m.rid && notYet(m) ? T('m.range', { from: fromLabel(m), to: dueLabel(m) })
        : T('m.due.by', { when: dueLabel(m) });
      head.appendChild(mk('span', 'm-date' + (late ? ' late' : ''), txt));
    } else if (notYet(m)) head.appendChild(mk('span', 'm-date', T('m.from', { when: fromLabel(m) })));
    card.appendChild(head);
    const rtn = routineOf(m);
    if (rtn) card.appendChild(routineTag(!m.done && !m.failed && rtn.streak ? T('m.routine.streak', { n: rtn.streak }) : T('m.routine')));
    if (m.desc) card.appendChild(mk('p', 'm-desc', m.desc));
    const msl = starsLine(m.stars);
    if (msl) card.appendChild(msl);
    if (failedNow) card.appendChild(mk('p', 'm-still', T('m.still')));
    const chipBox = chips(m.done ? m.done.applied : m.rewards);
    if (failedNow) chipBox.classList.add('missed');   // ricompensa che non arriverà più
    card.appendChild(chipBox);
    if (m.done && m.failed) {
      card.appendChild(mk('p', 'm-pen', T('m.pen.late', { loss: lossText(m.failed.applied) })));
    } else if (failedNow) {
      const sameDate = m.failed.date === m.due;   // la data qui sopra ("Scaduta il...") è già quella giusta: non ripeterla
      card.appendChild(mk('p', 'm-pen', T(sameDate ? 'm.pen.lost.same' : 'm.pen.lost', { when: fmtDay(m.failed.date), loss: lossText(m.failed.applied) })));
    } else if (!m.done && m.due && hasAny(m.penalty)) {
      card.appendChild(mk('p', 'm-pen', T('m.pen.warn', { loss: lossText(m.penalty) })));
    }
    const act = mk('div', 'm-actions');
    const btn = (cls, text, label, fn) => {
      const b = mk('button', 'btn small' + cls, text);
      b.type = 'button';
      b.setAttribute('aria-label', label + ' ' + m.title);
      b.addEventListener('click', fn);
      return b;
    };
    if (inCal) {
      // calendario: niente azioni sulla missione, solo Google Calendar (se serve) e il collegamento alla scheda Missioni
      if (!m.done && !failedNow && (m.rid ? !!rtn : !!m.due)) act.appendChild(gcalLink(m.rid ? gcalRoutineUrl(rtn) : gcalUrl(m), m.rid ? T('aria.gcal.routine') + ' ' + rtn.title : T('aria.gcal') + ' ' + m.title));
      act.appendChild(btn('', T('btn.goto'), T('aria.goto'), () => goToMission(m.id)));
    } else if (m.done) {
      act.appendChild(btn('', T('btn.undo'), T('aria.undo'), () => undoMission(m.id)));
    } else if (failedNow) {
      if (!m.rid) {
        const hadPenalty = hasAny(m.penalty);
        act.appendChild(btn('', T(hadPenalty ? 'btn.undopen' : 'btn.resched'), T(hadPenalty ? 'aria.undopen' : 'aria.resched'), () => revertPenalty(m.id)));
      }
    } else {
      const cb = btn(' add', T('btn.complete'), T('aria.complete'), () => completeMission(m.id));
      if (notYet(m) || isLate(m)) { cb.disabled = true; cb.classList.add('locked'); }   // data nel futuro: si completa dal giorno stesso; scaduta: mai più
      act.append(cb, btn('', T('btn.edit'), T('aria.edit'), () => openMissionForm(m.id)));
    }
    if (act.childElementCount) card.appendChild(act);   // una routine fallita non ha pulsanti
    return card;
  }

  const PAGE = 8;          // quante missioni si vedono per volta prima di "Mostra altre"
  let doneShown = PAGE;    // quante completate sono visibili
  const shownBy = {};      // quante ne sono state aperte in ogni gruppo
  function collapseMissionLists() {
    const opened = doneShown !== PAGE || Object.keys(shownBy).length;
    doneShown = PAGE;
    Object.keys(shownBy).forEach(k => delete shownBy[k]);
    if (opened) renderMissions();
  }
  // un gruppo di missioni con il suo titolo e, se sono tante, "Mostra altre"
  function groupBlock(box, key, title, list) {
    if (!list.length) return;
    const n = shownBy[key] || PAGE;
    if (title) box.appendChild(mk('h4', 'sub', title + ' (' + list.length + ')'));
    list.slice(0, n).forEach(m => box.appendChild(missionCard(m)));
    if (list.length > n) {
      const left = list.length - n;
      const more = mk('button', 'btn small', T('mis.more.n', { n: left }));
      more.type = 'button';
      more.setAttribute('aria-label', TN('mis.more.aria', left) + (title ? T('mis.more.grp', { group: title }) : ''));
      more.addEventListener('click', () => { shownBy[key] = n + PAGE; renderMissions(); });
      box.appendChild(more);
    }
  }
  let curView = 'char';

  /* ================= musica ================= */
  // Il brano suona in loop su tutte le schede: nella scheda Personaggio al volume scelto, nelle altre più piano.
  // Ogni ruolo ha il suo file, con il nome italiano del ruolo (Eroe.mp3, Mago.mp3, Samurai.mp3...), senza il grado davanti,
  // accanto a index.html (maiuscole e minuscole contano). Se il file del ruolo non c'è si usa Avventuriero.mp3.
  // Il brano si sceglie quando entri nella scheda Personaggio; la musica si ferma solo se la spegni o se la pagina non è in primo piano.
  const LS_MUSIC = 'liferpg:music', LS_MUSIC_VOL = 'liferpg:music:vol';
  const MUSIC_FALLBACK = 'Avventuriero.mp3';
  const MUSIC_DUCK = 0.3;      // volume nelle schede diverse da Personaggio, rispetto a quello scelto
  // un brano per ogni ruolo. I nomi dei file sono fissi: correggere o cambiare una traduzione (anche quella
  // italiana, da cui erano stati ricavati) non cambia più il brano che suona.
  const MUSIC_FILES = {
    cls: { Vigore: 'Guerriero', Vitalita: 'Druido', Intelletto: 'Mago', Creativita: 'Bardo', Animo: 'Monaco', Legami: 'Custode' },
    triple: { general: 'Generale', explorer: 'Esploratore', paladin: 'Paladino', pillar: 'Pilastro', architect: 'Architetto', stoic: 'Stoico', warlord: 'Condottiero', wanderer: 'Errante', catalyst: 'Trascinatore', protector: 'Protettore', naturalist: 'Naturalista', apothecary: 'Speziale', surgeon: 'Cerusico', enchanter: 'Incantatore', entertainer: 'Intrattenitore', shepherd: 'Pastore', philosopher: 'Filosofo', orator: 'Oratore', counselor: 'Consigliere', inspirer: 'Ispiratore' },
    quad: { pioneer: 'Pioniere', spartan: 'Spartano', sovereign: 'Sovrano', savage: 'Selvaggio', busker: 'Saltimbanco', sentinel: 'Sentinella', loner: 'Solitario', entrepreneur: 'Imprenditore', commander: 'Comandante', revolutionary: 'Rivoluzionario', hermit: 'Eremita', humanist: 'Umanista', priest: 'Sacerdote', jester: 'Giullare', visionary: 'Visionario' },
    quint: { oracle: 'Oracolo', ascetic: 'Asceta', barbarian: 'Barbaro', templar: 'Templare', conqueror: 'Conquistatore', ronin: 'Ronin' },
    pair: { gladiator: 'Gladiatore', strategist: 'Stratega', acrobat: 'Acrobata', samurai: 'Samurai', knight: 'Cavaliere', alchemist: 'Alchimista', dancer: 'Danzatore', shaman: 'Sciamano', healer: 'Guaritore', inventor: 'Inventore', sage: 'Saggio', mentor: 'Mentore', poet: 'Poeta', storyteller: 'Cantastorie', peacemaker: 'Pacificatore' },
    tier: { adventurer: 'Avventuriero', hero: 'Eroe', champion: 'Campione', legend: 'Leggenda', demigod: 'Semidio' },
  };
  function roleFile(x = xp) {   // x: gli XP di chi ascoltiamo (di solito i tuoi, oppure quelli di un amico)
    const r = heroRole(x);
    const f = MUSIC_FILES[r.ns] && MUSIC_FILES[r.ns][r.id];
    return f ? f + '.mp3' : MUSIC_FALLBACK;
  }
  let musicOn = true, musicPct = 35;
  try {
    musicOn = localStorage.getItem(LS_MUSIC) !== '0';
    const raw = localStorage.getItem(LS_MUSIC_VOL), v = Number(raw);
    if (raw !== null && Number.isFinite(v) && v >= 0 && v <= 100) musicPct = Math.round(v);
  } catch (e) { /* ignora */ }
  const musicGain = () => Math.pow(musicPct / 100, 2);     // curva quadratica: i volumi bassi si regolano meglio
  // mentre muovi il cursore del volume (e per due secondi dopo) suona al volume pieno, così senti davvero quello che scegli
  let musicBoost = false, musicBoostT = 0;
  const musicLevel = () => (curView === 'char' || musicBoost) ? 1 : MUSIC_DUCK;
  const musicTarget = () => musicGain() * musicLevel();
  let musicEl = null, musicFile = '', musicFailed = false, musicFade = 0;
  const musicMissing = new Set();      // brani che il server non ha: non si richiedono di nuovo
  const musicBtn = $('btn-music'), musicSlider = $('in-music-vol'), musicVal = $('music-val');
  function loadTrack(file) {
    if (!musicEl) {
      musicEl = new Audio();
      musicEl.loop = true; musicEl.preload = 'auto'; musicEl.volume = 0;
      musicEl.addEventListener('error', onMusicError);
    }
    if (musicFile !== file) { musicFile = file; musicEl.src = file; }   // cambiando brano si riparte dall'inizio
  }
  function onMusicError() {
    musicMissing.add(musicFile);
    if (musicFile !== MUSIC_FALLBACK) { if (musicWanted()) musicPlay(); }   // manca il brano del ruolo: si usa quello di riserva
    else musicFailed = true;                                                // manca anche quello: niente musica
  }
  // mentre guardi il profilo di un amico suona il brano del SUO ruolo (musicGuest); chiudendo torna il tuo
  let musicGuest = null, ownResume = null;
  const pickTrack = () => { const f = musicGuest || roleFile(); return musicMissing.has(f) ? MUSIC_FALLBACK : f; };
  function musicSwitch(resumeAt) {
    const want = pickTrack();
    if (!musicWanted() || !musicEl || musicEl.paused || want === musicFile) return;   // stesso brano: continua senza interruzioni
    fadeMusic(0, 300, () => {
      loadTrack(want);   // brano diverso: riparte dall'inizio...
      if (resumeAt) musicEl.addEventListener('loadedmetadata', () => { try { musicEl.currentTime = resumeAt; } catch (e) { /* ignora */ } }, { once: true });   // ...tranne il tuo, che riprende da dov'era
      musicPlay();
    });
  }
  function musicGuestStart(x) {
    if (!musicGuest && musicEl && !musicEl.paused) ownResume = { file: musicFile, t: musicEl.currentTime };
    musicGuest = roleFile(x);
    musicSwitch(0);
  }
  function musicGuestEnd() {
    if (!musicGuest) return;
    musicGuest = null;
    const r = ownResume; ownResume = null;
    musicSwitch(r && r.file === pickTrack() ? r.t : 0);
  }
  function getMusic() {
    if (musicFailed) return null;
    if (!musicEl || musicEl.paused) loadTrack(pickTrack());     // mentre suona il brano non cambia
    return musicEl;
  }
  function fadeMusic(to, ms, done) {
    const a = musicEl; if (!a) return;
    clearInterval(musicFade);
    const from = a.volume, steps = Math.max(1, Math.round(ms / 50)); let i = 0;
    musicFade = setInterval(() => {
      i++;
      a.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
      if (i >= steps) { clearInterval(musicFade); if (done) done(); }
    }, 50);
  }
  const musicWanted = () => musicOn && !document.hidden;
  function musicPlay() {           // parte, oppure porta il volume al livello giusto per la scheda in cui sei
    const a = getMusic(); if (!a) return;
    const p = a.play();
    const ok = () => fadeMusic(musicTarget(), 600);
    if (p && p.then) p.then(ok, () => { /* il browser aspetta un tocco: si riprova al prossimo */ }); else ok();
  }
  function musicStop(now) {
    const a = musicEl; if (!a || a.paused) return;
    if (now) { clearInterval(musicFade); a.pause(); return; }
    fadeMusic(0, 400, () => { if (!musicWanted()) a.pause(); });
  }
  // entrando nella scheda Personaggio si controlla se il ruolo è cambiato: in quel caso cambia anche il brano
  function musicRetrack() {
    const want = pickTrack();
    if (!musicEl || musicEl.paused || want === musicFile) { musicPlay(); return; }
    fadeMusic(0, 300, () => { loadTrack(want); musicPlay(); });
  }
  function musicSync(enteringChar) {
    if (!musicWanted()) musicStop(); else if (enteringChar) musicRetrack(); else musicPlay();
  }
  function musicRetune() { if (musicEl && !musicEl.paused) fadeMusic(musicTarget(), 600); }   // finito il cursore, si riabbassa
  function paintMusic() {
    musicBtn.textContent = musicOn ? T('music.on') : T('music.off');
    musicBtn.setAttribute('aria-pressed', String(musicOn));
    musicSlider.value = String(musicPct);
    musicVal.textContent = musicPct + '%';
  }
  musicBtn.addEventListener('click', () => {
    musicOn = !musicOn;
    try { localStorage.setItem(LS_MUSIC, musicOn ? '1' : '0'); } catch (e) { /* ignora */ }
    paintMusic();
    if (musicOn) musicPlay(); else musicStop();
  });
  musicSlider.addEventListener('input', e => {
    musicPct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    try { localStorage.setItem(LS_MUSIC_VOL, String(musicPct)); } catch (err) { /* ignora */ }
    paintMusic();
    const wasFull = musicLevel() === 1;
    musicBoost = true;
    clearTimeout(musicBoostT);
    musicBoostT = setTimeout(() => { musicBoost = false; musicRetune(); }, 2000);
    if (musicEl && !musicEl.paused) {
      if (wasFull) { clearInterval(musicFade); musicEl.volume = musicTarget(); } else fadeMusic(musicTarget(), 200);
    } else if (musicWanted()) musicPlay();
  });
  // i browser non fanno partire la musica prima che tu tocchi qualcosa: al primo tocco (su qualsiasi scheda) parte
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
    if (musicWanted() && (!musicEl || musicEl.paused)) musicPlay();
  }, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) musicStop(true); else musicSync(); });
  paintMusic();
  function renderMissions() {
    const pending = missions.filter(m => !m.done);
    const todo = pending.filter(m => !m.failed).sort((a, b) =>
      dueKey(a).localeCompare(dueKey(b)) || a.created.localeCompare(b.created) || a.title.localeCompare(b.title));
    const failed = pending.filter(m => m.failed).sort((a, b) =>
      b.failed.date.localeCompare(a.failed.date) || dueKey(b).localeCompare(dueKey(a)) || a.title.localeCompare(b.title));
    const done = missions.filter(m => m.done).sort((a, b) =>
      b.done.date.localeCompare(a.done.date) || b.done.t - a.done.t);
    const tl = $('m-todo'), fl = $('m-failed'), dl = $('m-done');
    tl.textContent = ''; fl.textContent = ''; dl.textContent = '';

    // da fare: raggruppate per scadenza
    if (!todo.length) tl.appendChild(mk('p', 'empty', T('mis.empty.todo')));
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
    groupBlock(tl, 'late', T('grp.late'), groups.late);
    groupBlock(tl, 'routine', T('grp.routine'), groups.routine);
    groupBlock(tl, 'today', T('grp.today'), groups.today);
    groupBlock(tl, 'soon', T('grp.soon'), groups.soon);
    groupBlock(tl, 'later', T('grp.later'), groups.later);
    groupBlock(tl, 'nodate', T('grp.nodate'), groups.nodate);

    // fallite: le più recenti per prime, con lo stesso "Mostra altre"
    groupBlock(fl, 'failed', '', failed);
    $('w-failed').hidden = !failed.length;
    if (!failed.length && sel.list === 'failed') { sel.list = null; sel.ids.clear(); }

    // completate: le 8 più recenti, poi "Mostra altre"
    if (!done.length) dl.appendChild(mk('p', 'empty', T('mis.empty.done')));
    done.slice(0, doneShown).forEach(m => dl.appendChild(missionCard(m)));
    if (!done.length && sel.list === 'done') { sel.list = null; sel.ids.clear(); }
    selDecorate(fl, 'failed');
    selDecorate(dl, 'done');
    paintSelBars();
    $('m-more').hidden = done.length <= doneShown;
    $('m-more').textContent = T('mis.more.n', { n: done.length - doneShown });
    const nb = $('nav-badge');
    const nbTxt = todo.length > 99 ? '99+' : String(todo.length);
    nb.dataset.n = nbTxt;
    nb.innerHTML = digitsSvg(nbTxt);
    nb.hidden = !todo.length;
    if (todo.length) $('vt-missions').setAttribute('aria-label', T('view.missions') + ' (' + todo.length + ')');
    else $('vt-missions').removeAttribute('aria-label');
  }

  // calendario
  let calY = 0, calM = 0, selDate = '';
  function initCal() {
    const t = new Date();
    calY = t.getFullYear(); calM = t.getMonth(); selDate = isoDate(t);
  }
  // routine previste nei giorni futuri (non sono ancora missioni: compaiono il giorno stesso)
  function plannedRoutines(ds, ids) {
    if (ds <= todayStr()) return [];
    return routines.filter(r => dayCounts(r, ds) && !ids.has(occId(r, ds)));
  }
  function renderCalendar(focusDate) {
    const grid = $('cal-grid');
    grid.textContent = '';
    T('cal.wd').split(',').forEach(w => grid.appendChild(mk('div', 'cal-wd', w)));
    const offset = (new Date(calY, calM, 1).getDay() + 6) % 7;
    const days = new Date(calY, calM + 1, 0).getDate();
    for (let i = 0; i < offset; i++) grid.appendChild(mk('div', 'cal-blank'));
    const todo = {}, done = {}, fail = {};
    missions.forEach(m => {
      if (m.done) done[m.done.date] = (done[m.done.date] || 0) + 1;
      else if (m.due && m.failed) fail[m.due] = (fail[m.due] || 0) + 1;
      else if (m.due || m.from) { const k = m.due || m.from; todo[k] = (todo[k] || 0) + 1; }
    });
    const today = todayStr();
    const ids = new Set(missions.map(m => m.id));
    for (let d = 1; d <= days; d++) {
      const ds = calY + '-' + pad2(calM + 1) + '-' + pad2(d);
      const planned = plannedRoutines(ds, ids).length;
      if (planned) todo[ds] = (todo[ds] || 0) + planned;
      const b = mk('button', 'cal-day' + (ds === today ? ' today' : ''));
      b.type = 'button';
      b.dataset.date = ds;
      b.appendChild(mk('span', 'cal-num', String(d)));
      const dots = mk('span', 'dots');
      if (todo[ds]) dots.appendChild(mk('i', 'dot todo'));
      if (fail[ds]) dots.appendChild(mk('i', 'dot fail'));
      if (done[ds]) dots.appendChild(mk('i', 'dot done'));
      b.appendChild(dots);
      b.setAttribute('aria-pressed', String(ds === selDate));
      b.setAttribute('aria-label', fmtDay(ds, true)
        + (todo[ds] ? T('cal.aria.todo', { n: todo[ds] }) : '')
        + (fail[ds] ? TN('cal.aria.fail', fail[ds]) : '')
        + (done[ds] ? TN('cal.aria.done', done[ds]) : ''));
      b.addEventListener('click', () => selectDate(ds));
      b.addEventListener('keydown', e => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (!step) return;
        e.preventDefault();
        const t = parseDate(ds);
        t.setDate(t.getDate() + step);
        selectDate(isoDate(t), true);
      });
      grid.appendChild(b);
    }
    $('cal-title').textContent = cap1(new Date(calY, calM, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }));
    const todayLbl = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    $('cal-today').textContent = T('cal.today.btn', { date: todayLbl });
    $('cal-today').setAttribute('aria-label', T('cal.today.aria', { date: todayLbl }));
    syncTodayBtn();
    renderDay();
    if (focusDate) { const b = grid.querySelector('[data-date="' + focusDate + '"]'); if (b) b.focus(); }
  }
  // "Oggi" compare solo quando serve: se stai guardando un altro mese o hai scelto un altro giorno
  function syncTodayBtn() {
    const n = new Date();
    $('cal-today-row').hidden = calY === n.getFullYear() && calM === n.getMonth() && selDate === isoDate(n);
  }
  function selectDate(ds, focus) {
    selDate = ds;
    const d = parseDate(ds);
    if (d.getFullYear() !== calY || d.getMonth() !== calM) {
      calY = d.getFullYear(); calM = d.getMonth();
      renderCalendar(focus ? ds : null);
      return;
    }
    $('cal-grid').querySelectorAll('.cal-day').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.date === ds)));
    syncTodayBtn();
    renderDay();
    if (focus) { const b = $('cal-grid').querySelector('[data-date="' + ds + '"]'); if (b) b.focus(); }
  }
  // collegamento "Aggiungi a Google Calendar" (per una routine: un evento che si ripete)
  function gcalLink(href, label) {
    const a = mk('a', 'btn small gcal', T('btn.gcal'));
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', label);
    return a;
  }
  // dal calendario alla scheda Missioni, sulla missione (aprendo il gruppo se era dietro "Mostra altre")
  function goToMission(id) {
    showView('missions');
    const find = () => $('view-missions').querySelector('.mission[data-id="' + id + '"]');
    let card = find();
    if (!card) {
      doneShown = 1e9;
      ['late', 'routine', 'today', 'soon', 'later', 'nodate', 'failed'].forEach(k => { shownBy[k] = 1e9; });
      renderMissions();
      card = find();
    }
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  }
  function renderDay() {
    $('day-title').textContent = fmtDay(selDate, true) + (selDate === todayStr() ? T('day.today') : '');
    const box = $('day-list');
    box.textContent = '';
    const byTime = (a, b) => dueKey(a).localeCompare(dueKey(b)) || a.title.localeCompare(b.title);
    const todo = missions.filter(m => !m.done && !m.failed && (m.due || m.from) === selDate).sort(byTime);
    const failed = missions.filter(m => !m.done && m.failed && m.due === selDate).sort(byTime);
    const done = missions.filter(m => m.done && m.done.date === selDate).sort((a, b) => b.done.t - a.done.t || a.title.localeCompare(b.title));   // le più recenti in alto
    const planned = plannedRoutines(selDate, new Set(missions.map(m => m.id)));
    if (!todo.length && !failed.length && !done.length && !planned.length) box.appendChild(mk('p', 'empty', T('day.empty')));
    if (planned.length) {
      box.appendChild(mk('h4', 'sub', T('day.routines') + ' (' + planned.length + ')'));
      planned.forEach(r => {
        const card = mk('article', 'mission');
        const head = mk('div', 'm-head');
        head.appendChild(mk('h3', 'm-title', r.title));
        if (r.time) head.appendChild(mk('span', 'm-date', T('r.at', { time: r.time })));
        card.appendChild(head);
        card.appendChild(routineTag(T('m.routine')));
        if (r.desc) card.appendChild(mk('p', 'm-desc', r.desc));
        card.appendChild(chips(r.rewards));
        const act = mk('div', 'm-actions');
        act.appendChild(gcalLink(gcalRoutineUrl(r), T('aria.gcal.routine') + ' ' + r.title));
        card.appendChild(act);
        box.appendChild(card);
      });
    }
    const group = (label, list) => { box.appendChild(mk('h4', 'sub', label + ' (' + list.length + ')')); list.forEach(m => box.appendChild(missionCard(m, true))); };
    if (todo.length) group(T('mis.todo'), todo);
    if (failed.length) group(T('mis.failed'), failed);
    if (done.length) group(T('mis.done'), done);
  }
  function moveMonth(delta) {
    const t = new Date(calY, calM + delta, 1);
    calY = t.getFullYear(); calM = t.getMonth();
    const now = new Date();
    selDate = (calY === now.getFullYear() && calM === now.getMonth()) ? isoDate(now) : isoDate(t);
    renderCalendar();
  }
  function renderMissionViews() { renderMissions(); renderCalendar(); scheduleExpiry(); }
  // allo scoccare della prossima scadenza la scheda diventa subito "Scaduta" (e la missione fallita), senza aspettare
  let expiryTimer = 0;
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    const now = Date.now();
    const next = missions.reduce((mn, m) => {
      if (m.done || m.failed) return mn;
      const st = startMs(m);
      if (st > now) mn = Math.min(mn, st);   // diventa disponibile
      if (!m.due) return mn;
      const e = dueEndMs(m);
      return e > now ? Math.min(mn, e) : mn;   // scade
    }, Infinity);
    if (next === Infinity) return;
    expiryTimer = setTimeout(() => { renderMissionViews(); checkPenalties(); }, Math.min(next - now + 50, 3600000));   // al massimo un'ora: si ricontrolla
  }

  // viste: Personaggio, Missioni, Calendario
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
  $('m-new').addEventListener('click', () => openMissionForm(null, null));
  $('m-more').addEventListener('click', () => { doneShown += PAGE; renderMissions(); });
  // frecce pixel-art: il font dell'app non ha i caratteri < e >
  // (pixel grandi come quelli delle lettere: 1 pixel del font = 1/16 della sua altezza)
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
  $('cal-prev').innerHTML = iconSvg(['.....XX', '....XX.', '...XX..', '..XX...', '.XX....', 'XX.....', '.XX....', '..XX...', '...XX..', '....XX.', '.....XX']);
  $('cal-next').innerHTML = iconSvg(['XX.....', '.XX....', '..XX...', '...XX..', '....XX.', '.....XX', '....XX.', '...XX..', '..XX...', '.XX....', 'XX.....']);
  $('cal-prev').addEventListener('click', () => moveMonth(-1));
  $('cal-next').addEventListener('click', () => moveMonth(1));
  $('cal-today').addEventListener('click', () => {
    const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); selDate = isoDate(n);
    renderCalendar(selDate);   // il pulsante sparisce: il fuoco va sul giorno di oggi nella griglia
  });

  // finestra per creare e modificare una missione
  const mform = $('mform');
  const xpInputs = {}, penInputs = {};
  let editingId = null;
  let formRepeat = false, editingRid = null, routinesBack = false, editingDue = null, editingFrom = null, editingFromTime = null;
  const dayBtns = [];
  const formLabels = [];   // etichette dei nomi delle statistiche, da aggiornare cambiando lingua
  const formRows = [];     // righe ricompensa e penalità: prendono i colori scelti nelle impostazioni
  // i nomi delle statistiche nella finestra usano il colore scelto (schiarito solo se troppo scuro per leggersi)
  function paintFormColors() { formRows.forEach(([key, el]) => el.style.setProperty('--c', readable(statColor(key)))); }
  STATS.forEach(s => {
    const row = mk('div', 'xp-row');
    formRows.push([s.key, row]);
    const label = mk('label', null, s.name);
    label.htmlFor = 'mf-xp-' + s.key;
    const inp = mk('input', 'xp-in');
    inp.id = 'mf-xp-' + s.key;
    inp.type = 'number'; inp.min = '0'; inp.max = String(MAX_XP); inp.step = '1';
    inp.inputMode = 'numeric'; inp.placeholder = '0'; inp.autocomplete = 'off';
    row.append(label, inp);
    $('mf-xp').appendChild(row);
    xpInputs[s.key] = inp;

    const prow = mk('div', 'xp-row');
    formRows.push([s.key, prow]);
    const plabel = mk('label', null, s.name);
    plabel.htmlFor = 'mf-pen-' + s.key;
    const pinp = mk('input', 'xp-in');
    pinp.id = 'mf-pen-' + s.key;
    pinp.type = 'number'; pinp.min = '0'; pinp.max = String(MAX_XP); pinp.step = '1';
    pinp.inputMode = 'numeric'; pinp.placeholder = '0'; pinp.autocomplete = 'off';
    prow.append(plabel, pinp);
    formLabels.push([s, label, plabel]);
    $('mf-pen').appendChild(prow);
    penInputs[s.key] = pinp;
    inp.addEventListener('input', paintXpCounter);
  });
  let mfDur = 0, mfDif = 0, mfLegacyTotal = null;   // 0 = nessuna stella scelta; mfLegacyTotal: missione com'era prima di questo sistema
  // stella a pixel 9×9 (usata nella finestra e nei riepiloghi); si disegna sempre a pixel interi
  const starRows = ['....X....', '....X....', '...XXX...', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '..XXXXX..', '.XXX.XXX.', '.X.....X.'];
  function buildStars(box, onSet) {
    const btns = [];
    for (let n = 1; n <= 5; n++) {
      const b = mk('button', 'star-btn');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.setAttribute('aria-label', String(n));
      b.innerHTML = iconSvg(starRows, 3);
      b.addEventListener('click', () => onSet(n));
      box.appendChild(b);
      btns.push(b);
    }
    return btns;
  }
  function paintStarRow(btns, n) {
    btns.forEach((b, i) => { b.classList.toggle('filled', i < n); b.setAttribute('aria-checked', String(i === n - 1)); });
  }
  const durBtns = buildStars($('mf-dur'), n => { mfDur = n; mfLegacyTotal = null; paintStarRow(durBtns, mfDur); paintXpCounter(); });
  const difBtns = buildStars($('mf-dif'), n => { mfDif = n; mfLegacyTotal = null; paintStarRow(difBtns, mfDif); paintXpCounter(); });
  const rewardTargetNow = () => (mfDur && mfDif) ? rewardTotal(mfDur, mfDif) : (mfLegacyTotal != null ? mfLegacyTotal : null);
  const xpSumNow = () => STATS.reduce((t, s) => t + (Number(xpInputs[s.key].value) || 0), 0);
  function paintXpCounter() {
    const total = rewardTargetNow(), sum = xpSumNow();
    const totalEl = $('mf-xp-total'), counterEl = $('mf-xp-counter');
    if (total == null) {
      totalEl.textContent = T('mf.reward.pick');
      counterEl.textContent = ''; counterEl.className = 'xp-counter';
    } else {
      totalEl.textContent = T(mfLegacyTotal != null ? 'mf.reward.total.legacy' : 'mf.reward.total', { n: fmt(total) });
      if (sum === total) { counterEl.textContent = T('mf.reward.ok', { n: fmt(total) }); counterEl.className = 'xp-counter ok'; }
      else if (sum < total) { counterEl.textContent = T('mf.reward.under', { have: fmt(sum), n: fmt(total), left: fmt(total - sum) }); counterEl.className = 'xp-counter warn'; }
      else { counterEl.textContent = T('mf.reward.over', { have: fmt(sum), n: fmt(total), over: fmt(sum - total) }); counterEl.className = 'xp-counter warn'; }
    }
  }
  // imposta le stelle aprendo il modulo: con una missione/routine esistente riconosce il totale, se possibile
  function setRewardStars(d, f, legacyTotal) {
    mfDur = d || 0; mfDif = f || 0; mfLegacyTotal = legacyTotal != null ? legacyTotal : null;
    paintStarRow(durBtns, mfDur); paintStarRow(difBtns, mfDif);
    paintXpCounter();
  }
  function initRewardStars(rewards, stars) {
    if (!rewards) { setRewardStars(0, 0, null); return; }
    if (stars) { setRewardStars(stars.d, stars.f, null); return; }
    const sum = STATS.reduce((t, s) => t + (rewards[s.key] || 0), 0);
    const match = rewardMatch(sum);
    setRewardStars(match ? match[0] : 0, match ? match[1] : 0, match ? null : sum);
  }
  function mfMsg(t) { $('mf-msg').textContent = t; }   // (in rosso: sono errori)
  // giorni della settimana della routine (lunedì per primo)
  WD_ALL.forEach(d => {
    const b = mk('button');
    b.type = 'button'; b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', 'true'); b.dataset.d = String(d);
    b.addEventListener('click', () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')));
    $('mf-days').appendChild(b);
    dayBtns.push(b);
  });
  const setDays = list => dayBtns.forEach(b => b.setAttribute('aria-checked', String(list.includes(Number(b.dataset.d)))));
  function paintDayChips() { const wd = T('cal.wd').split(','); dayBtns.forEach((b, i) => { b.textContent = wd[i] || ''; }); }
  function paintFormRepeat() {
    $('mf-rep').textContent = formRepeat ? T('mf.rep.on') : T('mf.rep.off');
    $('mf-rep').setAttribute('aria-pressed', String(formRepeat));
    $('mf-rep-box').hidden = !formRepeat;
    $('mf-from-block').hidden = formRepeat;   // una routine non ha disponibilità né scadenza: solo l'ora di scadenza
    $('mf-date').hidden = formRepeat;
    $('mf-due-lbl').textContent = formRepeat ? T('mf.time') : T('mf.date');
    $('mf-dt-tip').hidden = formRepeat;
    $('mf-pen-tip').textContent = formRepeat ? T('mf.pen.tip.r') : T('mf.pen.tip');
    $('mf-pen-on').textContent = penOn ? T('mf.pen.on') : T('mf.pen.off');   // (anche quando cambi lingua)
    paintDayChips();
  }
  function setFormRepeat(on) { formRepeat = on; paintFormRepeat(); syncTime(); }
  // l'ora ha senso solo con una data (o in una routine): senza, il campo e la spiegazione non si vedono
  // l'ora compare solo dopo il giorno (nelle routine c'è solo l'ora); i "Togli" solo se c'è qualcosa da togliere
  function syncTime() {
    const hasDue = !!$('mf-date').value, dueTimeOk = formRepeat || hasDue;
    const hasFrom = !formRepeat && !!$('mf-from').value;
    if (!dueTimeOk) $('mf-time').value = '';
    if (!hasFrom) $('mf-from-time').value = '';
    $('mf-time').hidden = !dueTimeOk;
    $('mf-from-time').hidden = !hasFrom;
    $('mf-date').parentElement.classList.toggle('two', !formRepeat && hasDue);
    $('mf-from').parentElement.classList.toggle('two', hasFrom);
    $('mf-nodate').hidden = formRepeat || !hasDue;
    $('mf-notime').hidden = !$('mf-time').value;
    $('mf-nofrom').hidden = !hasFrom;
    $('mf-nofromtime').hidden = !$('mf-from-time').value;
    $('mf-time-tip').hidden = !(dueTimeOk || hasFrom);
  }
  // penalità: interruttore; spento = nessuna penalità (i numeri scritti restano, se lo riaccendi prima di salvare)
  let penOn = false;
  function setPenOn(on, fromUser) {
    penOn = on;
    $('mf-pen-on').setAttribute('aria-pressed', String(on));
    $('mf-pen-on').textContent = on ? T('mf.pen.on') : T('mf.pen.off');
    $('mf-pen-box').hidden = !on;
    if (on && fromUser && !formRepeat && !$('mf-date').value) mfMsg(T('mf.err.pendate'));   // promemoria subito, non al salvataggio
    else if (fromUser) mfMsg('');
  }
  // descrizione: si apre quando serve (aperta già se la missione ne ha una)
  function setDescOpen(open) {
    $('mf-desc-box').hidden = !open;
    $('mf-desc-add').hidden = open;
  }
  function openMissionForm(id, dateStr) {
    const m0 = id ? missions.find(x => x.id === id) : null;
    if (m0 && m0.rid && routineOf(m0)) { openRoutineForm(m0.rid); return; }   // le volte di una routine si modificano dalla routine
    editingId = id; editingRid = null; routinesBack = false;
    editingDue = m0 ? m0.due : null;
    editingFrom = m0 ? m0.from : null;
    editingFromTime = m0 ? m0.fromTime : null;
    $('mf-rep-field').hidden = !!m0;          // una missione già creata non diventa routine
    $('mf-rep-toggle').hidden = false;
    setFormRepeat(false);
    const m = id ? missions.find(x => x.id === id) : null;
    $('t-mform').textContent = m ? T('mf.edit') : T('mf.new');
    $('mf-title').value = m ? m.title : '';
    $('mf-desc').value = m ? m.desc : '';
    STATS.forEach(s => {
      xpInputs[s.key].value = m && m.rewards[s.key] ? String(m.rewards[s.key]) : '';
      penInputs[s.key].value = m && m.penalty && m.penalty[s.key] ? String(m.penalty[s.key]) : '';
    });
    initRewardStars(m ? m.rewards : null, m ? m.stars : null);
    $('mf-date').min = todayStr();
    $('mf-from').min = todayStr();
    $('mf-date').value = m ? (m.due || '') : (dateStr || '');
    $('mf-from').value = m && !m.rid ? (m.from || '') : '';
    $('mf-from-time').value = m && !m.rid && m.fromTime ? m.fromTime : '';
    $('mf-time').value = m && m.dueTime ? m.dueTime : '';
    syncTime();
    setPenOn(!!(m && m.penalty && STATS.some(s => m.penalty[s.key] > 0)));
    setDescOpen(!!(m && m.desc));
    $('mf-del').hidden = !m;
    mfDelArm(false);
    mfMsg('');
    paintFormColors();
    openModal(mform, $('mf-title'));
  }
  function openRoutineForm(rid) {
    const r = rid ? routines.find(x => x.id === rid) : null;
    editingId = null; editingRid = r ? r.id : null;
    $('mf-rep-field').hidden = false;
    $('mf-rep-toggle').hidden = true;
    setFormRepeat(true);
    $('t-mform').textContent = r ? T('mf.edit.routine') : T('mf.new.routine');
    $('mf-title').value = r ? r.title : '';
    $('mf-desc').value = r ? r.desc : '';
    STATS.forEach(s => {
      xpInputs[s.key].value = r && r.rewards[s.key] ? String(r.rewards[s.key]) : '';
      penInputs[s.key].value = r && r.penalty[s.key] ? String(r.penalty[s.key]) : '';
    });
    initRewardStars(r ? r.rewards : null, r ? r.stars : null);
    $('mf-date').value = '';
    $('mf-time').value = r && r.time ? r.time : '';
    setDays(r ? r.days : WD_ALL);
    $('mf-bonus-every').value = r && r.bonus ? String(r.bonus.every) : '';
    $('mf-bonus-xp').value = r && r.bonus ? String(r.bonus.xp) : '';
    $('mf-start').min = todayStr();
    $('mf-start').max = addDaysStr(todayStr(), 365);
    $('mf-start').value = r ? r.start : todayStr();
    $('mf-start').disabled = !!r && r.start <= todayStr();     // una routine già iniziata non cambia data di inizio
    $('mf-pause-from').min = todayStr();
    $('mf-pause-from').value = r && r.pause ? r.pause.from : '';
    $('mf-pause-until').value = r && r.pause ? r.pause.until : '';
    syncTime();
    setPenOn(!!(r && r.penalty && STATS.some(s => r.penalty[s.key] > 0)));
    setDescOpen(!!(r && r.desc));
    $('mf-del').hidden = !r;
    mfDelArm(false);
    mfMsg('');
    paintFormColors();
    openModal(mform, $('mf-title'));
  }
  function finishForm() {
    closeModal();
    if (routinesBack) { routinesBack = false; openRoutines(); }
  }
  function submitRoutine(title, rewards, penalty, stars) {
    const fail = (t, el) => { mfMsg(t); sfx('err'); if (el) el.focus(); };
    const days = WD_ALL.filter((d, i) => dayBtns[i].getAttribute('aria-checked') === 'true');
    if (!days.length) return fail(T('mf.err.days'), dayBtns[0]);
    const timeRaw = $('mf-time').value;
    if (timeRaw && !validTime(timeRaw)) return fail(T('mf.err.time'), $('mf-time'));
    const ev = $('mf-bonus-every').value.trim(), bx = $('mf-bonus-xp').value.trim();
    let bonus = null;
    if (ev || bx) {
      const e = Number(ev), x = Number(bx);
      if (!(Number.isInteger(e) && e >= 2 && e <= 365 && Number.isInteger(x) && x >= 1 && x <= MAX_XP)) {
        return fail(T('mf.err.bonus', { max: fmt(MAX_XP) }), $('mf-bonus-every'));
      }
      bonus = { every: e, xp: x };
    }
    const today = todayStr();
    const pu = $('mf-pause-until').value, pf = $('mf-pause-from').value;
    if ((pu && !validDate(pu)) || (pf && !validDate(pf))) return fail(T('mf.err.date'), $('mf-pause-until'));
    if (pf && !pu) return fail(T('mf.err.pause'), $('mf-pause-until'));
    const cur = editingRid ? routines.find(x => x.id === editingRid) : null;
    if (pf && pf < todayStr() && !(cur && cur.pause && cur.pause.from === pf)) return fail(T('mf.err.past'), $('mf-pause-from'));
    if (pu && pf && pu < pf) return fail(T('mf.err.pause'), $('mf-pause-until'));
    let r = editingRid ? routines.find(x => x.id === editingRid) : null;
    const started = !!r && r.start <= today;
    const start = started ? r.start : ($('mf-start').value || today);
    if (!validDate(start)) return fail(T('mf.err.date'), $('mf-start'));
    if (!started && start < today) return fail(T('mf.err.past'), $('mf-start'));
    if (!started && start > addDaysStr(today, 365)) return fail(T('mf.err.far'), $('mf-start'));
    const pause = pu && pu >= today ? { from: pf || today, until: pu } : null;
    const desc = $('mf-desc').value.trim().slice(0, 500);
    const time = timeRaw || null;
    if (r) {
      Object.assign(r, { title, desc, rewards, penalty, days, time, pause, bonus, stars });
      if (r.made && r.made >= today) r.made = addDaysStr(today, -1);   // se oggi ora è un giorno previsto, compare subito
      if (!started && r.start !== start) { r.start = start; r.streak = 0; r.streakDate = addDaysStr(start, -1); }
    } else {
      if (routines.length >= MAX_ROUTINES) return fail(T('mf.err.routines', { max: MAX_ROUTINES }), null);
      r = { id: 'r' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4), title, desc, rewards, penalty, days, time,
        start, pause, streak: 0, streakDate: addDaysStr(start, -1), best: 0, bonus, stars };
      routines.push(r);
    }
    // le volte ancora da fare prendono i valori nuovi
    const months = new Set();
    missions.forEach(m => {
      if (m.rid === r.id && !m.done && !m.failed) {
        Object.assign(m, { title, desc, rewards: { ...rewards }, penalty: { ...penalty }, dueTime: time, stars });
        months.add(monthOf(m));
      }
    });
    months.forEach(touchMonth);
    saveRoutinesLocal();
    const wasEdit = !!editingRid;
    syncRoutines();
    sfx('save');
    finishForm();
    renderMissionViews();
    missionMsg(T(wasEdit ? 'msg.routine.edited' : 'msg.routine.created', { title }), 'good');
  }
  function deleteRoutine() {
    const r = routines.find(x => x.id === editingRid);
    if (!r) return;
    if (!$('mf-del').dataset.armed) { mfDelArm(true); return; }   // solo "Elimina" → "Conferma", nello stesso punto
    const drop = missions.filter(m => m.rid === r.id && !m.done && !m.failed);
    const months = new Set(drop.map(monthOf));
    tombMissions(drop);
    missions = missions.filter(m => !drop.includes(m));
    tombRoutine(r.id);
    routines = routines.filter(x => x !== r);
    saveRoutinesLocal();
    months.forEach(touchMonth);
    sfx('del');
    finishForm();
    renderMissionViews();
    missionMsg(T('msg.routine.deleted', { title: r.title }), '');
  }
  function submitMission() {
    const fail = (t, el) => { mfMsg(t); sfx('err'); if (el) el.focus(); };
    const title = $('mf-title').value.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) return fail(T('mf.err.title'), $('mf-title'));
    const rewardTarget = rewardTargetNow();
    if (rewardTarget == null) return fail(T('mf.err.stars'), null);
    const rewards = {};
    let rewardSum = 0;
    for (const s of STATS) {
      const raw = xpInputs[s.key].value.trim();
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_XP) {
        return fail(T('mf.err.xp', { max: fmt(MAX_XP) }), xpInputs[s.key]);
      }
      rewards[s.key] = n;
      rewardSum += n;
    }
    if (rewardSum !== rewardTarget) return fail(T('mf.err.xpsum', { have: fmt(rewardSum), total: fmt(rewardTarget) }), xpInputs[STATS[0].key]);
    const stars = (mfDur && mfDif) ? { d: mfDur, f: mfDif } : null;
    const penalty = {};
    let anyPen = false;
    for (const s of STATS) {
      const raw = penOn ? penInputs[s.key].value.trim() : '';   // interruttore spento: nessuna penalità
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_XP) {
        return fail(T('mf.err.pen', { max: fmt(MAX_XP) }), penInputs[s.key]);
      }
      penalty[s.key] = n;
      if (n > 0) anyPen = true;
    }
    if (formRepeat) return submitRoutine(title, rewards, penalty, stars);
    const dueRaw = $('mf-date').value;
    if (dueRaw && !validDate(dueRaw)) return fail(T('mf.err.date'), $('mf-date'));
    if (dueRaw && dueRaw < todayStr() && !(editingId && dueRaw === editingDue)) return fail(T('mf.err.past'), $('mf-date'));
    if (anyPen && !dueRaw) return fail(T('mf.err.pendate'), $('mf-date'));
    const timeRaw = dueRaw ? $('mf-time').value : '';
    if (timeRaw && !validTime(timeRaw)) return fail(T('mf.err.time'), $('mf-time'));
    const dueTime = timeRaw || null;
    if (anyPen && dueRaw && Date.now() >= dueEndMs({ due: dueRaw, dueTime })) {
      return fail(T('mf.err.pastdue'), $('mf-date'));
    }
    const desc = $('mf-desc').value.trim().slice(0, 500);
    const due = dueRaw || null;
    // disponibile dal: non nel passato (tranne se non l'hai cambiato) e non dopo la scadenza
    const fromRaw = $('mf-from').value;
    if (fromRaw && !validDate(fromRaw)) return fail(T('mf.err.date'), $('mf-from'));
    if (fromRaw && fromRaw < todayStr() && !(editingId && fromRaw === editingFrom)) return fail(T('mf.err.past'), $('mf-from'));
    const fromTimeRaw = fromRaw ? $('mf-from-time').value : '';
    if (fromTimeRaw && !validTime(fromTimeRaw)) return fail(T('mf.err.time'), $('mf-from-time'));
    const from = fromRaw || null, fromTime = fromTimeRaw || null;
    // la disponibilità deve iniziare prima della scadenza (giorno e ora)
    if (from && due && startMs({ from, fromTime }) >= dueEndMs({ due, dueTime })) return fail(T('mf.err.from'), $('mf-from'));
    let m = editingId ? missions.find(x => x.id === editingId) : null;
    if (m) {
      if (m.done) return fail(T('mf.err.done'), null);
      Object.assign(m, { title, desc, rewards, penalty, due, dueTime, from, fromTime, stars });
    } else {
      const created = todayStr();
      if (missions.filter(x => monthOf(x) === created.slice(0, 7)).length >= MAX_PER_MONTH) {
        return fail(T('mf.err.month', { max: MAX_PER_MONTH }), null);
      }
      if (missions.length >= MAX_MISSIONS) return fail(T('mf.err.total'), null);
      m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, desc, rewards, penalty, due, dueTime, from, fromTime, created, done: null, failed: null, stars };
      missions.push(m);
    }
    touchMonth(monthOf(m));
    sfx('save');
    closeModal();
    renderMissionViews();
    missionMsg(T(editingId ? 'msg.edited' : 'msg.created', { title }), 'good');
    if (m.due) { const d = parseDate(m.due); calY = d.getFullYear(); calM = d.getMonth(); selDate = m.due; renderCalendar(); }
  }
  // selezione di missioni completate o fallite, per eliminarle (gli XP guadagnati o persi restano)
  const sel = { list: null, ids: new Set() };
  function selStart(list) { sel.list = list; sel.ids.clear(); renderMissions(); }
  function selStop() { if (!sel.list) return; sel.list = null; sel.ids.clear(); renderMissions(); }
  // trasforma le schede della lista in caselle da spuntare
  function selDecorate(box, list) {
    if (sel.list !== list) return;
    box.querySelectorAll('.mission[data-id]').forEach(card => {
      const id = card.dataset.id;
      const on = () => sel.ids.has(id);
      card.classList.add('selecting');
      card.classList.toggle('picked', on());
      card.setAttribute('role', 'checkbox');
      card.setAttribute('aria-checked', String(on()));
      card.tabIndex = 0;
      const tick = mk('span', 'sel-box'); tick.setAttribute('aria-hidden', 'true');
      card.prepend(tick);
      const toggle = () => {
        if (on()) sel.ids.delete(id); else sel.ids.add(id);
        card.classList.toggle('picked', on());
        card.setAttribute('aria-checked', String(on()));
        paintSelBars();
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    });
  }
  function paintSelBars() {
    document.querySelectorAll('.sel-bar').forEach(bar => {
      const list = bar.dataset.list, active = sel.list === list;
      const has = !!document.getElementById(list === 'done' ? 'm-done' : 'm-failed').querySelector('.mission');
      bar.hidden = !has && !active;
      bar.querySelector('[data-sel="start"]').hidden = active || (!!sel.list && !active);
      bar.querySelector('[data-sel="del"]').hidden = !active;
      bar.querySelector('[data-sel="cancel"]').hidden = !active;
      const del = bar.querySelector('[data-sel="del"]');
      del.disabled = !sel.ids.size;
      if (!del.dataset.armed) del.textContent = T('sel.del', { n: sel.ids.size });
    });
  }
  function selDelete() {
    const del = document.querySelector('.sel-bar:not([hidden]) [data-sel="del"]:not([hidden])');
    if (!sel.ids.size) return;
    if (!del || !del.dataset.armed) { selArm(true); return; }
    selArm(false);
    const gone = missions.filter(m => sel.ids.has(m.id) && (m.done || m.failed));
    const months = new Set(gone.map(monthOf));
    tombMissions(gone);
    missions = missions.filter(m => !gone.includes(m));
    months.forEach(touchMonth);
    sfx('del');
    missionMsg(TN('msg.deleted.n', gone.length), '');
    sel.list = null; sel.ids.clear();
    renderMissionViews();
  }
  document.querySelectorAll('.sel-bar').forEach(bar => {
    bar.querySelector('[data-sel="start"]').addEventListener('click', () => selStart(bar.dataset.list));
    bar.querySelector('[data-sel="cancel"]').addEventListener('click', () => { selArm(false); selStop(); });
    bar.querySelector('[data-sel="del"]').addEventListener('click', selDelete);
  });

  function deleteMission() {
    if (editingRid) { deleteRoutine(); return; }
    const m = editingId ? missions.find(x => x.id === editingId) : null;
    if (!m || m.done) return;
    if (!$('mf-del').dataset.armed) { mfDelArm(true); return; }   // solo "Elimina" → "Conferma", nello stesso punto
    tombMissions([m]);
    missions = missions.filter(x => x !== m);
    touchMonth(monthOf(m));
    sfx('del');
    closeModal();
    renderMissionViews();
    missionMsg(T('msg.deleted', { title: m.title }), '');
  }
  $('mf-save').addEventListener('click', submitMission);
  $('mf-cancel').addEventListener('click', finishForm);
  $('mf-rep').addEventListener('click', () => setFormRepeat(!formRepeat));
  $('mf-pause-clear').addEventListener('click', () => { $('mf-pause-from').value = ''; $('mf-pause-until').value = ''; });

  // Google Calendar per una routine: un evento che si ripete negli stessi giorni (l'avviso lo decide il calendario)
  function gcalRoutineUrl(r) {
    const d8 = ds => ds.replace(/-/g, '');
    const p2 = n => String(n).padStart(2, '0');
    let d = todayStr();
    for (let i = 0; i < 400 && !dayCounts(r, d); i++) d = addDaysStr(d, 1);   // il primo giorno previsto (dopo un'eventuale pausa)
    if (!dayCounts(r, d)) { d = todayStr(); for (let i = 0; i < 7 && !r.days.includes(parseDate(d).getDay()); i++) d = addDaysStr(d, 1); }
    const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const rule = r.days.length === 7 ? 'RRULE:FREQ=DAILY' : 'RRULE:FREQ=WEEKLY;BYDAY=' + WD_ALL.filter(x => r.days.includes(x)).map(x => BY[x]).join(',');
    let dates;
    if (r.time) {
      const [hh, mm] = r.time.split(':').map(Number);
      const e = parseDate(d); e.setHours(hh, mm + 30, 0, 0);
      dates = d8(d) + 'T' + p2(hh) + p2(mm) + '00/' + d8(isoDate(e)) + 'T' + p2(e.getHours()) + p2(e.getMinutes()) + '00';
    } else {
      dates = d8(d) + '/' + d8(addDaysStr(d, 1));
    }
    let u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(r.title) + '&dates=' + dates + '&recur=' + encodeURIComponent(rule);
    if (r.desc) u += '&details=' + encodeURIComponent(r.desc);
    return u;
  }

  // elenco delle routine
  const rmodal = $('rmodal');
  function daysText(r) {
    if (r.days.length === 7) return T('r.everyday');
    const wd = T('cal.wd').split(',');
    return WD_ALL.map((d, i) => (r.days.includes(d) ? wd[i] : null)).filter(Boolean).join(', ');
  }
  function routineCard(r) {
    const card = mk('article', 'mission');
    const head = mk('div', 'm-head');
    head.appendChild(mk('h3', 'm-title', r.title));
    head.appendChild(mk('span', 'm-date', daysText(r) + (r.time ? ' ' + T('r.at', { time: r.time }) : '')));
    card.appendChild(head);
    if (r.desc) card.appendChild(mk('p', 'm-desc', r.desc));
    const rsl = starsLine(r.stars);
    if (rsl) card.appendChild(rsl);
    card.appendChild(chips(r.rewards));
    card.appendChild(mk('p', 'm-desc', T('r.streak', { n: r.streak || 0 }) + ', ' + T('r.best', { n: r.best || 0 })));
    if (r.bonus) card.appendChild(mk('p', 'm-desc', T('r.bonus', { xp: fmt(r.bonus.xp), n: r.bonus.every })));
    if (r.start > todayStr()) card.appendChild(mk('p', 'm-routine', T('r.starts', { when: fmtDay(r.start) })));
    if (r.pause && r.pause.until >= todayStr()) {
      card.appendChild(mk('p', 'm-pen', r.pause.from > todayStr()
        ? T('r.pause.plan', { from: fmtDay(r.pause.from), to: fmtDay(r.pause.until) })
        : T('r.paused', { when: fmtDay(r.pause.until) })));
    }
    const act = mk('div', 'm-actions');
    const b = mk('button', 'btn small', T('btn.edit'));
    b.type = 'button';
    b.setAttribute('aria-label', T('aria.edit') + ' ' + r.title);
    b.addEventListener('click', () => { closeModal(); routinesBack = true; openRoutineForm(r.id); });
    act.appendChild(b);
    card.appendChild(act);
    return card;
  }
  function renderRoutines() {
    const box = $('r-list');
    box.textContent = '';
    $('r-empty').hidden = routines.length > 0;
    routines.forEach(r => box.appendChild(routineCard(r)));
  }
  function openRoutines() { renderRoutines(); openModal(rmodal, $('r-new')); }
  $('m-routines').addEventListener('click', openRoutines);
  $('r-new').addEventListener('click', () => { closeModal(); routinesBack = true; openRoutineForm(null); });
  $('r-close').addEventListener('click', closeModal);
  rmodal.addEventListener('click', e => { if (e.target === rmodal) closeModal(); });
  $('mf-del').addEventListener('click', deleteMission);
  $('mf-nodate').addEventListener('click', () => { $('mf-date').value = ''; syncTime(); $('mf-date').focus(); });
  $('mf-nofrom').addEventListener('click', () => { $('mf-from').value = ''; syncTime(); $('mf-from').focus(); });
  $('mf-nofromtime').addEventListener('click', () => { $('mf-from-time').value = ''; syncTime(); $('mf-from-time').focus(); });
  ['input', 'change'].forEach(t => { $('mf-from').addEventListener(t, syncTime); $('mf-from-time').addEventListener(t, syncTime); });
  $('mf-notime').addEventListener('click', () => { $('mf-time').value = ''; syncTime(); $('mf-time').focus(); });
  ['input', 'change'].forEach(t => { $('mf-date').addEventListener(t, syncTime); $('mf-time').addEventListener(t, syncTime); });
  $('mf-pen-on').addEventListener('click', () => setPenOn(!penOn, true));
  $('mf-desc-add').addEventListener('click', () => { setDescOpen(true); $('mf-desc').focus(); });
  mform.addEventListener('click', e => { if (e.target === mform) closeModal(); });
  mform.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'date') { e.preventDefault(); submitMission(); }
  });

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
    finally { penaltyReady = true; checkPenalties(); }
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
