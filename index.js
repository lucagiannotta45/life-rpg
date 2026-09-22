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
 * Indice delle sezioni (cerca il titolo per saltare al punto giusto):
 *   1. lingue                                — collegamento ai testi di i18n.js
 *   2. dati di gioco                          — statistiche, missioni, livelli, XP
 *   3. stato e salvataggio                    — stato in memoria + persistenza locale
 *   4. suono                                  — effetti sonori dell'interfaccia
 *   5. interfaccia: elementi                  — riferimenti ai nodi del DOM
 *   6. effetti                                — animazioni e feedback visivi
 *   7. finestre (Dati e Personalizza)         — pannelli modali
 *   8. Google Drive                           — backup/sync su Drive
 *   9. personalizzazione                      — temi, sfondi, nome, icone
 *  10. missioni e calendario                  — creazione/gestione missioni, vista calendario
 *  11. musica                                 — musica di sottofondo
 *  12. info: la guida del giocatore           — testo di aiuto in-app
 *  13. avvio                                  — inizializzazione e bootstrap dell'app
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
  function heroRole() {
    // ordine per XP (a parità di XP vince la prima nell'elenco)
    const order = STATS.map((s, i) => ({ s, i, xp: xp[s.key], lv: levelFromXp(xp[s.key]) }))
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
  function heroClass() {
    const r = heroRole();
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
    driveMark();
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
  const defaultSettings = () => ({ name: '', titleText: '', titleShow: true, frame: 'semplice', frameV: 2, bgFit: 'adatta', winColor: null, inkColor: null, softColor: null, accentColor: null, nameColor: null, titleColor: null, trans: 0, emblem: { border: null, fill: null }, colors: {}, lang: 'it' });
  function normalizeSettings(o) {
    const s = defaultSettings();
    if (!o || typeof o !== 'object') return s;
    if (typeof o.name === 'string') s.name = o.name.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (typeof o.titleText === 'string') s.titleText = o.titleText.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (o.titleShow === false) s.titleShow = false;
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
    if (o.emblem && typeof o.emblem === 'object') {
      if (typeof o.emblem.border === 'string' && HEX.test(o.emblem.border)) s.emblem.border = o.emblem.border.toLowerCase();
      if (typeof o.emblem.fill === 'string' && HEX.test(o.emblem.fill)) s.emblem.fill = o.emblem.fill.toLowerCase();
    }
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
    driveMark();
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
    driveMark();     // subito, in modo sincrono
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
        dueTime: validDate(m.due) && validTime(m.dueTime) ? m.dueTime : null,
        created: m.created, done: null, failed: null, stars: normalizeStars(rewards, m.stars),
      };
      if (typeof m.rid === 'string' && /^\w{1,12}$/.test(m.rid)) it.rid = m.rid;
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
    driveMark();
    return ok;
  }
  let missions = loadMissionsLocal();
  const missionsTouched = new Set();   // mesi modificati in questa sessione

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
      });
      if (out.length >= MAX_ROUTINES) break;
    }
    return out;
  }
  function loadRoutinesLocal() {
    try { const raw = localStorage.getItem(LS_ROU); if (raw) return normalizeRoutines(JSON.parse(raw)); } catch (e) { /* ignora */ }
    return [];
  }
  function saveRoutinesLocal() {
    lsSet(LS_ROU, JSON.stringify(routines));
    driveMark();
  }
  let routines = loadRoutinesLocal();

  let xp = loadLocal();
  let touched = false;
  let dbRef = null, writing = false, again = false;
  let downloadsCap = null;

  // Google Drive: stato del collegamento (le funzioni sono più sotto, nella sezione dedicata).
  // Per attivarlo va scritto qui l'ID client creato su Google Cloud (vedi le istruzioni).
  const GOOGLE_CLIENT_ID = '1034279734942-khlirvv64u1us7hmdikiqq41nal9skd1.apps.googleusercontent.com';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';   // cartella nascosta, solo di questa app
  const DRIVE_FILE = 'life_rpg_save.json';
  const LS_DRIVE = 'liferpg:drive';
  const drv = { on: false, email: '', fileId: '', synced: 0, dirty: false, lastAt: 0, changedAt: 0, token: '', exp: 0, busy: false,
    state: 'off', conflict: null, timer: 0, rev: 0, applying: false, tapAt: 0, checked: false };
  try {
    const d = JSON.parse(localStorage.getItem(LS_DRIVE) || 'null');
    if (d && d.on) Object.assign(drv, { on: true, email: String(d.email || ''), fileId: String(d.fileId || ''), synced: Number(d.synced) || 0, dirty: !!d.dirty, lastAt: Number(d.lastAt) || 0, changedAt: Number(d.changedAt) || 0 });
  } catch (e) { /* ignora */ }
  // ogni modifica ai dati locali segna che c'è qualcosa da salvare su Drive
  function driveMark() {
    if (!drv.on || drv.applying) return;
    drv.dirty = true; drv.rev++; drv.changedAt = Date.now();
    driveKeep();
    driveSchedule();
  }

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

  async function flush() {
    if (!dbRef) return;
    if (writing) { again = true; return; }
    writing = true;
    try {
      await dbRef.set({ v: 1, xp: { ...xp }, settings });
      setSaveState('account');
    } catch (e) {
      console.warn('db.set', e);
      setSaveState('error');
    }
    writing = false;
    if (again) { again = false; flush(); }
  }
  function persist() { saveLocal(); flush(); }

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
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || radar).appendChild(n);
    return n;
  };
  const ptsStr = arr => arr.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

  [0.25, 0.5, 0.75, 1].forEach(f => {
    el('polygon', { class: 'r-ring' + (f === 1 ? ' outer' : ''), points: ptsStr(STATS.map((_, i) => pt(i, R * f))) });
  });
  STATS.forEach((_, i) => {
    const p = pt(i, R);
    el('line', { class: 'r-axis', x1: CX, y1: CY, x2: p[0].toFixed(1), y2: p[1].toFixed(1) });
  });
  const shape = el('polygon', { class: 'r-shape', points: '' });
  const labelLv = [], radarNames = [];
  // ordine delle statistiche nell'esagono, dalla cima in senso orario (l'elenco delle statistiche resta com'è)
  const RADAR_IDX = ['Intelletto', 'Vigore', 'Vitalita', 'Creativita', 'Legami', 'Animo'].map(k => STATS.findIndex(x => x.key === k));
  const POS = STATS.map((_, i) => RADAR_IDX.indexOf(i));      // posizione nell'esagono di ogni statistica
  RADAR_IDX.forEach((si, i) => {
    const s = STATS[si];
    const p = pt(i, LR);
    let dyName = -6, dyLv = 16;
    if (i === 0) { dyName = -22; dyLv = 0; }
    if (i === 3) { dyName = 8; dyLv = 30; }
    // le etichette dei lati si allargano un poco, in modo simmetrico: 3 spazi del font (3 x 6) verso l'esterno
    const dx = (i === 1 || i === 2) ? 18 : (i === 4 || i === 5) ? -18 : 0;
    const n = el('text', { class: 'r-name', x: (p[0] + dx).toFixed(1), y: (p[1] + dyName).toFixed(1), 'text-anchor': 'middle' });
    n.textContent = s.name;
    radarNames.push(n);
    const l = el('text', { class: 'r-lv', x: (p[0] + dx).toFixed(1), y: (p[1] + dyLv).toFixed(1), 'text-anchor': 'middle' });
    l.textContent = T('lv') + ' 0';
    labelLv.push(l);
  });

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
    const ovEl = $('overall');
    ovEl.textContent = ov;
    if (animate && lastOverall !== null && ov !== lastOverall && !reduce) {
      ovEl.classList.remove('bump'); void ovEl.offsetWidth; ovEl.classList.add('bump');
    }
    lastOverall = ov;
    $('class-name').textContent = heroClass();

    // Scala relativa: il bordo esterno è la decina successiva al livello più alto (minimo 10)
    const fracs = STATS.map(s => fracLevel(xp[s.key]));
    const scaleMax = Math.min(MAX_LEVEL, Math.max(10, Math.ceil(Math.max(...fracs) / 10) * 10));
    const ratios = fracs.map(f => f / scaleMax);
    if (animate) animateRadar(ratios); else { radarCur = ratios; drawRadar(ratios); }
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
  function showLevelUp(ups, ovFrom, ovTo, missionTitle) {
    const mEl = $('lu-mission');
    if (missionTitle) { mEl.textContent = missionTitle; mEl.hidden = false; } else mEl.hidden = true;
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
  function openModal(m, focusEl) {
    lastFocus = document.activeElement;
    activeModal = m;
    m.hidden = false;
    if (focusEl) focusEl.focus();
    sfx('open');
  }
  function closeModal() {
    if (!activeModal) return;
    sfx('close');
    activeModal.hidden = true;
    activeModal = null;
    resetArm(false);
    custResetArm(false);
    mfDelArm(false);
    driveOffArm(false);
    pasteSlot = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    checkPenalties();
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

  // il salvataggio completo (usato dal backup e da Google Drive)
  function buildBackup() {
    const out = { ...xp, _settings: settings };
    out._images = Object.fromEntries(IMG_NAMES.filter(n => imgs[n]).map(n => [n, imgs[n]]));
    out._missions = missions;
    out._routines = routines;
    return out;
  }
  const isBackup = obj => !!obj && typeof obj === 'object' && Object.keys(obj).some(k => (ALIASES[k] || k) in blank());
  function applyBackup(obj) {
    xp = normalize(obj);
    touched = true;
    if (obj._settings) {
      settings = mergeSettings(obj._settings);
      settingsTouched = true;
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
      missions = normalizeMissions(obj._missions);
      missions.forEach(m => months.add(monthOf(m)));
      months.forEach(touchMonth);
      renderMissionViews();
    }
    if (Array.isArray(obj._routines)) { routines = normalizeRoutines(obj._routines); saveRoutinesLocal(); }
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


  /* ================= Google Drive ================= */
  // Una copia del salvataggio vive in una cartella nascosta del tuo Drive (visibile solo a questa app).
  // Il collegamento usa l'accesso di Google: dura circa un'ora, poi al primo tocco si rinnova da solo.
  const driveOk = !!GOOGLE_CLIENT_ID && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
  const tokenValid = () => !!drv.token && Date.now() < drv.exp;
  const hasLocalData = () => hasProgress(xp) || missions.length > 0 || IMG_NAMES.some(n => imgs[n])
    || JSON.stringify({ ...settings, lang: 'it' }) !== JSON.stringify(defaultSettings());
  function driveKeep() {
    try {
      if (drv.on) localStorage.setItem(LS_DRIVE, JSON.stringify({ on: true, email: drv.email, fileId: drv.fileId, synced: drv.synced, dirty: drv.dirty, lastAt: drv.lastAt, changedAt: drv.changedAt }));
      else localStorage.removeItem(LS_DRIVE);
    } catch (e) { /* ignora */ }
  }
  const driveSummary = obj => {
    const x = normalize(obj);
    const n = Array.isArray(obj._missions) ? obj._missions.length : 0;
    return TN('drive.sum', n, { lv: overallOf(STATS.map(s => levelFromXp(x[s.key]))) });
  };
  // riepilogo di una copia: livello, missioni, XP totali e (se si sa) quando è stata salvata o modificata
  const driveDetail = (obj, when, whenKey) => {
    const xpTotal = Object.values(normalize(obj)).reduce((a, b) => a + b, 0);
    const parts = [driveSummary(obj), T('drive.sum.xp', { xp: fmt(xpTotal) })];
    if (when > 0) parts.push(T(whenKey, { when: new Date(when).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }));
    return parts.join(' · ');
  };
  function driveState(k) { drv.state = k; paintDrive(); }
  function paintDrive() {
    const box = $('drive-box');
    box.hidden = !GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) return;
    const st = $('drive-status');
    const conflict = drv.on && drv.state === 'conflict' && !!drv.conflict;
    $('drive-connect').hidden = !driveOk || drv.on;
    $('drive-sync').hidden = !drv.on || conflict;
    $('drive-off').hidden = !drv.on;
    $('drive-conflict').hidden = !conflict;
    const who = drv.email || 'Google';
    let t;
    if (!driveOk) t = T('drive.unavail');
    else if (!drv.on) t = T('drive.st.off');
    else if (conflict) t = '';
    else if (drv.state === 'busy') t = T('drive.st.busy');
    else if (drv.state === 'auth') t = T('drive.st.auth');
    else if (drv.state === 'err') t = T('drive.st.err');
    else t = drv.lastAt
      ? T('drive.st.ok', { who, when: new Date(drv.lastAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })
      : T('drive.st.ok0', { who });
    st.textContent = t;
    st.hidden = !t;
    if (conflict) $('drive-conflict-text').textContent = T('drive.conflict', {
      drive: driveDetail(drv.conflict, Number(drv.conflict._savedAt) || 0, 'drive.sum.remote'),
      here: driveDetail(buildBackup(), drv.changedAt, 'drive.sum.local'),
    });
  }

  let gisPromise = null;
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  function driveLoadScript() {
    if (!gisPromise) gisPromise = new Promise((res, rej) => {
      if (gisReady()) { res(); return; }
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = () => res();
      sc.onerror = () => { gisPromise = null; rej(new Error('script')); };
      document.head.appendChild(sc);
    });
    return gisPromise;
  }
  // chiede il permesso a Google: va chiamata da un tocco dell'utente, altrimenti il browser blocca la finestrella
  function driveAuth() {
    return new Promise((resolve, reject) => {
      const go = () => {
        try {
          const c = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE,
            callback: r => {
              if (r && r.access_token) { drv.token = r.access_token; drv.exp = Date.now() + ((Number(r.expires_in) || 3600) - 60) * 1000; resolve(); }
              else { const e = new Error('auth'); e.auth = true; reject(e); }
            },
            error_callback: () => { const e = new Error('auth'); e.auth = true; reject(e); },
          });
          c.requestAccessToken({ prompt: '', hint: drv.email || undefined });
        } catch (e) { reject(e); }
      };
      if (gisReady()) go(); else driveLoadScript().then(go, reject);
    });
  }
  async function driveFetch(url, opts) {
    const o = opts || {};
    const r = await fetch(url, { ...o, headers: { ...(o.headers || {}), Authorization: 'Bearer ' + drv.token } });
    if (r.status === 401) { drv.token = ''; drv.exp = 0; const e = new Error('auth'); e.auth = true; throw e; }
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
    return r;
  }
  async function driveFind() {
    const q = encodeURIComponent("name='" + DRIVE_FILE + "' and 'appDataFolder' in parents and trashed=false");
    const r = await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1&fields=files(id,modifiedTime)&q=' + q);
    const j = await r.json();
    return (j.files && j.files[0]) || null;
  }
  async function driveDownload(id) {
    const r = await driveFetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media');
    return r.json();
  }
  async function driveWrite(text) {
    if (drv.fileId) {
      try {
        await driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + drv.fileId + '?uploadType=media',
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
        return;
      } catch (e) { if (e.status !== 404) throw e; drv.fileId = ''; }   // il file non c'è più: se ne crea uno nuovo
    }
    const b = 'lrpg' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta
      + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + b + '--';
    const r = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
    drv.fileId = (await r.json()).id;
  }
  async function driveUpload() {
    const rev = drv.rev;
    const at = Date.now();
    const snap = buildBackup(); snap._savedAt = at;
    await driveWrite(JSON.stringify(snap));
    drv.synced = at; drv.lastAt = at;
    if (drv.rev === rev) drv.dirty = false;     // se nel frattempo è cambiato altro, resta da salvare
    driveKeep();
  }
  function driveApply(remote) {
    drv.applying = true;
    try { applyBackup(remote); } finally { drv.applying = false; }
    drv.synced = Number(remote._savedAt) || 0; drv.dirty = false; drv.lastAt = Date.now();
    driveKeep();
  }
  function driveFail(e) {
    console.warn('drive', e);
    drv.busy = false;
    driveState(e && e.auth ? 'auth' : 'err');
  }
  function driveSchedule() {
    clearTimeout(drv.timer);
    drv.timer = setTimeout(() => driveSync(false), 4000);
  }
  // user = true quando parte da un tocco: solo allora si può chiedere il permesso a Google
  async function driveSync(user) {
    if (!drv.on || drv.busy || drv.conflict) return;
    drv.busy = true; driveState('busy');
    try {
      if (!tokenValid()) {
        if (!user) { drv.busy = false; driveState('auth'); return; }
        await driveAuth();
      }
      if (!drv.email) {
        try { drv.email = (await (await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json()).user.emailAddress || ''; } catch (e) { /* facoltativo */ }
      }
      const file = await driveFind();
      const remote = file ? await driveDownload(file.id) : null;
      if (file) drv.fileId = file.id;
      const rAt = remote && isBackup(remote) ? Number(remote._savedAt) || 0 : -1;
      if (rAt < 0) {
        await driveUpload();                                   // ancora niente su Drive
      } else if (rAt === drv.synced) {
        if (drv.dirty) await driveUpload();                    // Drive è com'era: si salvano le modifiche fatte qui
      } else if (drv.synced && !drv.dirty) {
        driveApply(remote); dataMsg(T('drive.msg.loaded'));    // qui non è cambiato niente: si prende quello di Drive
      } else if (!drv.synced && !hasLocalData()) {
        driveApply(remote); dataMsg(T('drive.msg.loaded'));    // dispositivo nuovo e vuoto
      } else {
        drv.conflict = remote;                                 // dati diversi da entrambe le parti: sceglie l'utente
        drv.busy = false; drv.checked = true; driveState('conflict');
        if (typeof openSettings === 'function') openSettings('data');
        return;
      }
      drv.checked = true; drv.busy = false;
      driveState('ok');
      if (drv.dirty) driveSchedule();
    } catch (e) { driveFail(e); }
  }
  async function driveKeepLocal() {
    drv.conflict = null; drv.busy = true; driveState('busy');
    try {
      if (!tokenValid()) await driveAuth();
      drv.dirty = true;
      await driveUpload();
      drv.checked = true; drv.busy = false;
      driveState('ok'); dataMsg(T('drive.msg.saved'));
    } catch (e) { driveFail(e); }
  }
  $('drive-connect').addEventListener('click', () => {
    drv.on = true; drv.synced = 0; drv.dirty = false; drv.changedAt = 0; drv.conflict = null; drv.checked = false;
    driveKeep();
    driveSync(true);
  });
  $('drive-sync').addEventListener('click', () => driveSync(true));
  const offBtn = $('drive-off');
  let offTimer = 0;
  function driveOffArm(on) {
    clearTimeout(offTimer);
    offBtn.dataset.armed = on ? '1' : '';
    offBtn.textContent = on ? T('drive.off.confirm') : T('drive.off');
    if (on) offTimer = setTimeout(() => driveOffArm(false), 4000);
  }
  offBtn.addEventListener('click', () => {
    if (!offBtn.dataset.armed) { driveOffArm(true); return; }     // primo tocco: chiede conferma
    driveOffArm(false);
    clearTimeout(drv.timer);
    drv.on = false; drv.conflict = null; drv.dirty = false; drv.changedAt = 0; drv.synced = 0; drv.fileId = ''; drv.token = ''; drv.exp = 0; drv.state = 'off';
    driveKeep(); paintDrive(); dataMsg(T('drive.msg.off'));
  });
  $('drive-keep-drive').addEventListener('click', () => {
    const r = drv.conflict; if (!r) return;
    drv.conflict = null;
    driveApply(r); driveState('ok'); dataMsg(T('drive.msg.loaded'));
  });
  $('drive-keep-local').addEventListener('click', driveKeepLocal);
  // al primo tocco di ogni sessione (e quando l'accesso è scaduto) si riprende il collegamento
  document.addEventListener('click', e => {
    if (!driveOk || !drv.on || drv.busy || drv.conflict) return;
    if (e.target && e.target.closest && e.target.closest('#drive-box')) return;
    if (tokenValid() && drv.checked) return;
    if (!drv.checked || drv.dirty) {
      if (Date.now() - drv.tapAt < 30000) return;
      drv.tapAt = Date.now();
      driveSync(true);
    }
  }, true);
  if (driveOk) driveLoadScript().catch(() => { /* niente rete: si riprova al tocco */ });

  let armTimer = 0;
  const resetBtn = $('btn-reset');
  function resetArm(on) {
    clearTimeout(armTimer);
    resetBtn.dataset.armed = on ? '1' : '';
    resetBtn.textContent = on ? T('data.reset.confirm') : T('data.reset');
    if (on) armTimer = setTimeout(() => resetArm(false), 4000);
  }
  resetBtn.addEventListener('click', () => {
    if (!resetBtn.dataset.armed) { resetArm(true); dataMsg(T('data.msg.armed')); return; }
    resetArm(false);
    xp = blank(); touched = true; persist(); render(true);
    const months = new Set(missions.map(monthOf));
    missions = [];
    routines = []; saveRoutinesLocal();
    months.forEach(touchMonth);
    renderMissionViews();
    dataMsg(T('data.msg.wiped'));
  });

  /* ================= personalizzazione ================= */
  const rootStyle = document.documentElement.style;
  const WIN_VARS = ['--win-a', '--win-b', '--win-c', '--win-edge', '--win-glow', '--ink-soft', '--track', '--btn'];
  const EM_VARS = ['--em-b1', '--em-b2', '--em-b3', '--em-f1', '--em-f2', '--em-num', '--em-lv'];

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
  function applyTheme() {
    const c = settings.winColor;
    if (!c) { WIN_VARS.forEach(v => rootStyle.removeProperty(v)); return; }
    const a = winBase(c), dk = mixHex(a, '#000000', 0.70);
    rootStyle.setProperty('--win-a', a);
    rootStyle.setProperty('--win-b', mixHex(a, '#000000', 0.45));
    rootStyle.setProperty('--win-c', dk);
    rootStyle.setProperty('--win-edge', dk);
    rootStyle.setProperty('--win-glow', mixHex(a, '#ffffff', 0.45));
    rootStyle.setProperty('--ink-soft', mixHex(a, '#ffffff', 0.72));
    rootStyle.setProperty('--track', mixHex(a, '#000000', 0.82));
    rootStyle.setProperty('--btn', mixHex(a, '#ffffff', 0.06));
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
  // colore predefinito dell'interno dell'esagono: quello delle finestre
  function themeFillHex() {
    return settings.winColor ? winBase(settings.winColor) : '#3049cf';
  }
  // esagono del livello: bordo (di solito dorato) e interno (di solito come le finestre)
  function applyEmblem() {
    EM_VARS.forEach(v => rootStyle.removeProperty(v));
    const { border, fill } = settings.emblem;
    const fillDark = fill ? luminance(fill) < 0.4 : true;
    let lv = null;
    if (border) {
      const b1 = mixHex(border, '#ffffff', 0.55), b3 = mixHex(border, '#000000', 0.4);
      rootStyle.setProperty('--em-b1', b1);
      rootStyle.setProperty('--em-b2', border);
      rootStyle.setProperty('--em-b3', b3);
      lv = fillDark ? b1 : b3;
    } else if (fill && !fillDark) {
      lv = '#8a5a00';
    }
    if (fill) {
      rootStyle.setProperty('--em-f1', fill);
      rootStyle.setProperty('--em-f2', mixHex(fill, '#000000', 0.55));
      rootStyle.setProperty('--em-num', fillDark ? '#ffffff' : '#12172e');
    }
    if (lv) rootStyle.setProperty('--em-lv', lv);
  }
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
  function applyName() { $('player-name').textContent = settings.name.trim(); }
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
    paintSound(); paintMusic(); resetArm(false); custResetArm(false); mfDelArm(false); driveOffArm(false);
    setSaveState(saveKind);
    if (cs.Vigore) paintCustom();
    render(false);
    renderMissionViews();
    renderInfo();
    paintDrive();
    paintFormRepeat();
    if (!rmodal.hidden) renderRoutines();
  }
  function applyAll() { applyLang(); applyTheme(); applyFrame(); applyTextColors(); applyTransparency(); applyEmblem(); applyName(); applyTitle(); applyImages(); }

  let setTimer = 0;
  function changed(soon) {
    settingsTouched = true;
    saveSettingsLocal();
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
    // esagono del livello
    $('in-em-b').addEventListener('input', e => {
      settings.emblem.border = e.target.value.toLowerCase();
      applyEmblem(); paintCustom(); changed(true);
    });
    $('in-em-f').addEventListener('input', e => {
      settings.emblem.fill = e.target.value.toLowerCase();
      applyEmblem(); paintCustom(); changed(true);
    });
    $('em-b-reset').addEventListener('click', () => { settings.emblem.border = null; applyEmblem(); paintCustom(); changed(); });
    $('em-f-reset').addEventListener('click', () => { settings.emblem.fill = null; applyEmblem(); paintCustom(); changed(); });
    // titolo in alto
    $('in-title').addEventListener('input', e => {
      settings.titleText = e.target.value.slice(0, 24);
      applyTitle(); changed(true);
    });
    $('btn-title-show').addEventListener('click', () => {
      settings.titleShow = !settings.titleShow;
      applyTitle(); paintCustom(); changed();
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
    $('in-em-b').value = settings.emblem.border || '#ffcf3a';
    $('in-em-f').value = settings.emblem.fill || themeFillHex();
    $('em-b-reset').hidden = !settings.emblem.border;
    $('em-f-reset').hidden = !settings.emblem.fill;
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

  let custArmTimer = 0;
  function custResetArm(on) {
    clearTimeout(custArmTimer);
    const b = $('btn-custom-reset');
    b.dataset.armed = on ? '1' : '';
    b.textContent = on ? T('look.reset.confirm') : T('look.reset');
    if (on) custArmTimer = setTimeout(() => custResetArm(false), 4000);
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
    try {
      while (imgQueue.size) {
        const name = imgQueue.values().next().value;
        imgQueue.delete(name);
        const ref = dbImgs().doc(name);
        if (imgs[name]) { if (imgs[name].length <= CLOUD_IMG_MAX) await ref.set({ v: 1, data: imgs[name] }); } else await ref.delete();
      }
    } catch (e) {
      console.warn('db.imgs', e);
      setSaveState('error');
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
  function dueEndMs(m) {
    if (!m.due) return Infinity;
    const d = parseDate(m.due);
    if (m.dueTime) { const [hh, mm] = m.dueTime.split(':').map(Number); d.setHours(hh, mm, 0, 0); return d.getTime() + 60000; }
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const isLate = m => !m.done && Date.now() >= dueEndMs(m);
  const dueKey = m => (m.due || '9999-99-99') + ' ' + (m.dueTime || '99:99');
  const fmtClock = ms => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtDay = (s, long) => cap1(parseDate(s).toLocaleDateString(locale(),
    long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }));
  const dueLabel = m => fmtDay(m.due) + (m.dueTime ? T('time.at', { time: m.dueTime }) : '');
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // salvataggio: un documento per mese di creazione, così non crescono troppo
  const monthQueue = new Set();
  let monthBusy = false;
  async function flushMissions() {
    if (!dbRef || monthBusy) return;
    monthBusy = true;
    try {
      while (monthQueue.size) {
        const ym = monthQueue.values().next().value;
        monthQueue.delete(ym);
        const items = missions.filter(m => monthOf(m) === ym);
        await dbRef.collection('m').doc(ym).set({ v: 1, items: JSON.parse(JSON.stringify(items)) });
      }
    } catch (e) {
      console.warn('db.missions', e);
      setSaveState('error');
    }
    monthBusy = false;
  }
  function touchMonth(ym) {
    missionsTouched.add(ym);
    monthQueue.add(ym);
    saveMissionsLocal();
    flushMissions();
  }

  // messaggi
  function missionMsg(text, kind) {
    ['mis-msg', 'cal-msg'].forEach(id => { const e = $(id); e.textContent = text; e.className = 'msg' + (kind ? ' ' + kind : ''); });
  }
  const gainText = map => {
    if (allSame(map)) return '+' + fmt(allSame(map)) + ' ' + T('xp.all');
    const parts = STATS.filter(s => map[s.key] > 0).map(s => '+' + fmt(map[s.key]) + ' ' + s.name);
    return parts.length ? parts.join(', ') : T('xp.none.lower');
  };

  // completare e annullare
  // ancora non completabile: la data è nel futuro
  const notYet = m => !m.done && !m.failed && !!m.due && m.due > todayStr();
  function completeMission(id) {
    const m = missions.find(x => x.id === id);
    if (!m || m.done || m.failed) return;   // scaduta: non si completa più (si può solo riprogrammare)
    if (isLate(m)) {   // scaduta da poco ma non ancora segnata come fallita: non si completa, e diventa fallita adesso
      missionMsg(T('msg.expired', { title: m.title }), 'bad');
      sfx('err');
      renderMissionViews();
      checkPenalties();
      return;
    }
    if (notYet(m)) { missionMsg(T('m.locked', { when: fmtDay(m.due) }), 'bad'); sfx('err'); return; }
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
    touched = true;
    persist();
    touchMonth(monthOf(m));
    const after = STATS.map(s => levelFromXp(xp[s.key]));
    const ups = STATS.map((s, i) => ({ s, from: before[i], to: after[i] })).filter(u => u.to > u.from);
    render(true);
    STATS.forEach(s => { if (applied[s.key] > 0) floatText(s.key, '+' + fmt(applied[s.key]), false); });
    missionMsg(T(Object.keys(bonus).length ? 'msg.completed.bonus' : 'msg.completed', { title: m.title, gain: gainText(applied), n: rs ? rs.n : 0 }), 'good');
    renderMissionViews();
    if (ups.length) { showLevelUp(ups, ovFrom, overallOf(after), m.title); sfx('up'); } else sfx(Object.keys(bonus).length ? 'bonus' : 'add');
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
    touched = true;
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
    touched = true;
    persist();
    touchMonth(monthOf(m));
    render(true);
    missionMsg(T(hasAny(restored) ? 'msg.penrev' : 'msg.resched', { title: m.title, gain: gainText(restored) }), 'good');
    renderMissionViews();
    sfx('add');
    // si apre la modifica per scegliere una nuova data; se la chiudi, la missione resta senza data
    openMissionForm(m.id);
    mfMsg(T('msg.penrev.form'));
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
      touchMonth(monthOf(m));
    });
    touched = true;
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
      // le volte di oggi e tutte quelle saltate da quando la routine è iniziata: ogni giorno previsto conta,
      // con o senza penalità (chi non ha messo una penalità perde comunque la serie, ma non XP)
      const existing = new Set(missions.filter(mm => mm.rid === r.id).map(mm => mm.id));
      for (let d = r.start, guard = 0; d <= today && guard < 3660; guard++, d = addDaysStr(d, 1)) {
        if (!dayCounts(r, d)) continue;
        const id = occId(r, d);
        if (existing.has(id) || missions.length >= MAX_MISSIONS) continue;
        missions.push({ id, title: r.title, desc: r.desc, rewards: { ...r.rewards }, penalty: { ...r.penalty },
          due: d, dueTime: r.time, created: d, done: null, failed: null, rid: r.id, stars: r.stars });
        existing.add(id);
        months.add(d.slice(0, 7));
        changed = true;
      }
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
  let penaltyReady = false, lastSig = '';
  function checkPenalties() {
    // le penalità aspettano il caricamento dell'account e che non ci sia una finestra aperta; le schede si aggiornano comunque
    if (penaltyReady && !activeModal) {
      if (syncRoutines()) renderMissionViews();
      applyPenalties();
    }
    const sig = todayStr() + ':' + missions.filter(m => !m.done && isLate(m)).length;
    if (sig !== lastSig) { lastSig = sig; renderMissionViews(); }
  }
  $('pen-ok').addEventListener('click', closeModal);
  $('pmodal').addEventListener('click', e => { if (e.target === $('pmodal')) closeModal(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPenalties(); });
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
  function starsLine(stars) {
    if (!stars) return null;   // missione creata prima di questo sistema: niente da mostrare
    const wrap = mk('div', 'm-stars');
    const row = (label, n) => {
      const r = mk('span', 'm-stars-row');
      r.append(label + ' ', miniStars(n));
      return r;
    };
    wrap.append(row(T('mf.reward.dur'), stars.d), row(T('mf.reward.dif'), stars.f));
    wrap.setAttribute('aria-label', T('m.stars.aria', { d: stars.d, f: stars.f }));
    return wrap;
  }
  function missionCard(m, hideDate) {
    const failedNow = !!m.failed && !m.done;
    const card = mk('article', 'mission' + (m.done ? ' done' : '') + (failedNow ? ' failed' : ''));
    const head = mk('div', 'm-head');
    head.appendChild(mk('h3', 'm-title', m.title));
    if (hideDate) { /* la data è già il titolo del pannello "Giorno": non ripeterla su ogni scheda */ }
    else if (m.done) head.appendChild(mk('span', 'm-date', T('m.done.on', { when: fmtDay(m.done.date) + (m.done.t > 1e12 ? T('time.at', { time: fmtClock(m.done.t) }) : '') })));
    else if (m.due) {
      const late = isLate(m);
      head.appendChild(mk('span', 'm-date' + (late ? ' late' : ''), T(late ? 'm.late.on' : 'm.due.by', { when: dueLabel(m) })));
    }
    card.appendChild(head);
    if (m.desc) card.appendChild(mk('p', 'm-desc', m.desc));
    const msl = starsLine(m.stars);
    if (msl) card.appendChild(msl);
    if (!m.done && !m.failed && notYet(m)) card.appendChild(mk('p', 'm-lock', T('m.locked', { when: fmtDay(m.due) })));
    const rtn = routineOf(m);
    if (rtn) card.appendChild(mk('p', 'm-routine', !m.done && !m.failed && rtn.streak ? T('m.routine.streak', { n: rtn.streak }) : T('m.routine')));
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
    if (m.done) {
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
      if (m.rid ? !!rtn : !!m.due) {
        const a = mk('a', 'btn small gcal', T('btn.gcal'));
        a.href = m.rid ? gcalRoutineUrl(rtn) : gcalUrl(m);   // per una routine: un evento che si ripete
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', m.rid ? T('aria.gcal.routine') + ' ' + rtn.title : T('aria.gcal') + ' ' + m.title);
        act.appendChild(a);
      }
    }
    if (act.childElementCount) card.appendChild(act);   // una routine fallita non ha pulsanti
    return card;
  }

  const PAGE = 8;          // quante missioni si vedono per volta prima di "Mostra altre"
  let doneShown = PAGE;    // quante completate sono visibili
  const shownBy = {};      // quante ne sono state aperte in ogni gruppo
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
  function roleFile() {
    const r = heroRole();
    const it = (I18N.it && I18N.it[r.ns + '.' + r.id]) || '';
    const base = it.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
    return base ? base + '.mp3' : MUSIC_FALLBACK;
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
  const pickTrack = () => { const f = roleFile(); return musicMissing.has(f) ? MUSIC_FALLBACK : f; };
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
  function digitsSvg(str) {
    const rows = Array.from({ length: 9 }, (_, r) => [...str].map(ch => (DIGITS[ch] || DIGITS['0'])[r]).join(''));
    // toglie le colonne vuote ai lati, così il numero sta al centro del badge
    const cols = rows[0].length;
    const used = c => rows.some(row => row[c] === 'X');
    let from = 0, to = cols - 1;
    while (from < to && !used(from)) from++;
    while (to > from && !used(to)) to--;
    return iconSvg(rows.map(row => row.slice(from, to + 1)));
  }
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
      if (!m.due) groups.nodate.push(m);
      else if (isLate(m)) groups.late.push(m);
      else if (m.due === today) (m.rid ? groups.routine : groups.today).push(m);
      else if (m.due <= soonEnd) groups.soon.push(m);
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

    // completate: le 8 più recenti, poi "Mostra altre"
    if (!done.length) dl.appendChild(mk('p', 'empty', T('mis.empty.done')));
    done.slice(0, doneShown).forEach(m => dl.appendChild(missionCard(m)));
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
      else if (m.due) todo[m.due] = (todo[m.due] || 0) + 1;
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
    renderDay();
    if (focusDate) { const b = grid.querySelector('[data-date="' + focusDate + '"]'); if (b) b.focus(); }
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
    renderDay();
    if (focus) { const b = $('cal-grid').querySelector('[data-date="' + ds + '"]'); if (b) b.focus(); }
  }
  function renderDay() {
    $('day-title').textContent = fmtDay(selDate, true) + (selDate === todayStr() ? T('day.today') : '');
    $('day-new').disabled = selDate < todayStr();   // in un giorno passato non si crea una missione
    const box = $('day-list');
    box.textContent = '';
    const byTime = (a, b) => dueKey(a).localeCompare(dueKey(b)) || a.title.localeCompare(b.title);
    const todo = missions.filter(m => !m.done && !m.failed && m.due === selDate).sort(byTime);
    const failed = missions.filter(m => !m.done && m.failed && m.due === selDate).sort(byTime);
    const done = missions.filter(m => m.done && m.done.date === selDate);
    const planned = plannedRoutines(selDate, new Set(missions.map(m => m.id)));
    if (!todo.length && !failed.length && !done.length && !planned.length) box.appendChild(mk('p', 'empty', T('day.empty')));
    if (planned.length) {
      box.appendChild(mk('h4', 'sub', T('day.routines')));
      planned.forEach(r => {
        const card = mk('article', 'mission');
        const head = mk('div', 'm-head');
        head.appendChild(mk('h3', 'm-title', r.title));
        if (r.time) head.appendChild(mk('span', 'm-date', T('r.at', { time: r.time })));
        card.appendChild(head);
        if (r.desc) card.appendChild(mk('p', 'm-desc', r.desc));
        card.appendChild(mk('p', 'm-routine', T('m.routine')));
        card.appendChild(chips(r.rewards));
        box.appendChild(card);
      });
    }
    if (todo.length) { box.appendChild(mk('h4', 'sub', T('mis.todo'))); todo.forEach(m => box.appendChild(missionCard(m, true))); }
    if (failed.length) { box.appendChild(mk('h4', 'sub', T('grp.late'))); failed.forEach(m => box.appendChild(missionCard(m, true))); }
    if (done.length) { box.appendChild(mk('h4', 'sub', T('mis.done'))); done.forEach(m => box.appendChild(missionCard(m, true))); }
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
      if (m.done || m.failed || !m.due) return mn;
      const e = dueEndMs(m);
      return e > now ? Math.min(mn, e) : mn;
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
  $('day-new').addEventListener('click', () => openMissionForm(null, selDate));
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
  $('cal-today').addEventListener('click', () => { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); selDate = isoDate(n); renderCalendar(); });

  // finestra per creare e modificare una missione
  const mform = $('mform');
  const xpInputs = {}, penInputs = {};
  let editingId = null, mfArmTimer = 0;
  let formRepeat = false, editingRid = null, routinesBack = false, editingDue = null;
  const dayBtns = [];
  const formLabels = [];   // etichette dei nomi delle statistiche, da aggiornare cambiando lingua
  STATS.forEach(s => {
    const row = mk('div', 'xp-row');
    row.style.setProperty('--c', s.color);
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
    prow.style.setProperty('--c', s.color);
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
  const starRows = ['...X...', '...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.X...X.', 'X.....X'];
  function buildStars(box, onSet) {
    const btns = [];
    for (let n = 1; n <= 5; n++) {
      const b = mk('button', 'star-btn');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.setAttribute('aria-label', String(n));
      b.innerHTML = iconSvg(starRows, 4);
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
  function mfDelArm(on) {
    clearTimeout(mfArmTimer);
    const b = $('mf-del');
    b.dataset.armed = on ? '1' : '';
    b.textContent = on ? T('btn.delete.confirm') : T('btn.delete');
    if (on) mfArmTimer = setTimeout(() => mfDelArm(false), 4000);
  }
  function mfMsg(t) { $('mf-msg').textContent = t; }
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
    $('mf-date-field').hidden = formRepeat;
    $('mf-pen-tip').textContent = formRepeat ? T('mf.pen.tip.r') : T('mf.pen.tip');
    paintDayChips();
  }
  function setFormRepeat(on) { formRepeat = on; paintFormRepeat(); syncTime(); }
  // l'ora ha senso solo con una data (o in una routine)
  function syncTime() {
    const has = formRepeat || !!$('mf-date').value;
    $('mf-time').disabled = !has;
    $('mf-notime').disabled = !has;
    if (!has) $('mf-time').value = '';
  }
  function openMissionForm(id, dateStr) {
    const m0 = id ? missions.find(x => x.id === id) : null;
    if (m0 && m0.rid && routineOf(m0)) { openRoutineForm(m0.rid); return; }   // le volte di una routine si modificano dalla routine
    editingId = id; editingRid = null; routinesBack = false;
    editingDue = m0 ? m0.due : null;
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
    $('mf-date').value = m ? (m.due || '') : (dateStr || '');
    $('mf-time').value = m && m.dueTime ? m.dueTime : '';
    syncTime();
    $('mf-del').hidden = !m;
    mfDelArm(false);
    mfMsg('');
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
    $('mf-del').hidden = !r;
    mfDelArm(false);
    mfMsg('');
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
        Object.assign(m, { title, desc, rewards: { ...rewards }, penalty: { ...penalty }, dueTime: time });
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
    if (!$('mf-del').dataset.armed) { mfDelArm(true); mfMsg(T('mf.del.confirm')); return; }
    const months = new Set();
    missions = missions.filter(m => {
      if (m.rid === r.id && !m.done && !m.failed) { months.add(monthOf(m)); return false; }
      return true;
    });
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
      const raw = penInputs[s.key].value.trim();
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
    let m = editingId ? missions.find(x => x.id === editingId) : null;
    if (m) {
      if (m.done) return fail(T('mf.err.done'), null);
      Object.assign(m, { title, desc, rewards, penalty, due, dueTime, stars });
    } else {
      const created = todayStr();
      if (missions.filter(x => monthOf(x) === created.slice(0, 7)).length >= MAX_PER_MONTH) {
        return fail(T('mf.err.month', { max: MAX_PER_MONTH }), null);
      }
      if (missions.length >= MAX_MISSIONS) return fail(T('mf.err.total'), null);
      m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, desc, rewards, penalty, due, dueTime, created, done: null, failed: null, stars };
      missions.push(m);
    }
    touchMonth(monthOf(m));
    sfx('save');
    closeModal();
    renderMissionViews();
    missionMsg(T(editingId ? 'msg.edited' : 'msg.created', { title }), 'good');
    if (m.due) { const d = parseDate(m.due); calY = d.getFullYear(); calM = d.getMonth(); selDate = m.due; renderCalendar(); }
  }
  function deleteMission() {
    if (editingRid) { deleteRoutine(); return; }
    const m = editingId ? missions.find(x => x.id === editingId) : null;
    if (!m || m.done) return;
    if (!$('mf-del').dataset.armed) { mfDelArm(true); mfMsg(T('mf.del.confirm')); return; }
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
    const g = mk('a', 'btn small gcal', T('btn.gcal'));
    g.href = gcalRoutineUrl(r);
    g.target = '_blank';
    g.rel = 'noopener noreferrer';
    g.setAttribute('aria-label', T('aria.gcal.routine') + ' ' + r.title);
    act.appendChild(g);
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
  $('mf-nodate').addEventListener('click', () => { $('mf-date').value = ''; syncTime(); });
  $('mf-notime').addEventListener('click', () => { $('mf-time').value = ''; });
  ['input', 'change'].forEach(t => $('mf-date').addEventListener(t, syncTime));
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
    p(b, T('info.mis.p5'));
    p(b, T('info.mis.p6'));

    // dati
    b = section('data', T('info.data.h'));
    p(b, dbRef ? T('info.data.cloud') : storageOk ? T('info.data.local') : T('info.data.nostorage'));
    p(b, T('info.data.p3'));
    if (GOOGLE_CLIENT_ID) p(b, T('info.data.drive'));
  }

  /* ================= avvio ================= */
  initCal();
  renderMissionViews();
  applyAll();
  buildCustom();
  applyLang();   // di nuovo: ora esistono anche le voci create da buildCustom
  wireDrops();
  render(false);

  async function initCloudInner() {
    if (!window.claude || typeof window.claude.use !== 'function') { setSaveState('local'); return; }
    try {
      const [db, user, dl] = await Promise.all([
        window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads'),
      ]);
      downloadsCap = dl || null;
      const uid = user ? await user.id() : null;
      if (!db || !uid) { setSaveState('local'); return; }
      const ref = db.doc('data/users/' + uid + '/rpg');
      const snap = await ref.get();
      dbRef = ref;
      setSaveState('account');
      const d = snap.exists ? snap.data() : null;
      if (d && !touched) { xp = normalize(d.xp); saveLocal(); }
      if (d && d.settings && !settingsTouched) {
        settings = mergeSettings(d.settings);
        saveSettingsLocal();
        applyAll();
        paintCustom();
      }
      // immagini: l'account è la fonte, tranne quelle modificate in questa sessione
      const isnap = await ref.collection('imgs').get();
      const remote = {};
      isnap.docs.forEach(x => { const v = x.data() && x.data().data; if (validImg(v)) remote[x.id] = v; });
      IMG_NAMES.forEach(n => {
        if (imgTouched.has(n)) { imgQueue.add(n); return; }
        const r = remote[n] || null;
        if (imgs[n] && imgs[n].length > CLOUD_IMG_MAX) return;   // troppo grande per l'account: resta quella di questo dispositivo
        if (imgs[n] !== r) { imgs[n] = r; saveImgLocal(n); }
      });
      applyImages();
      paintCustom();
      if (imgQueue.size) flushImgs();
      // missioni: un documento per mese; l'account è la fonte, tranne i mesi modificati in questa sessione
      const msnap = await ref.collection('m').get();
      const remoteM = {};
      msnap.docs.forEach(x => {
        remoteM[x.id] = normalizeMissions(x.data() && x.data().items).filter(m => monthOf(m) === x.id);
      });
      const localM = {};
      missions.forEach(m => { (localM[monthOf(m)] = localM[monthOf(m)] || []).push(m); });
      const mergedM = [];
      new Set([...Object.keys(remoteM), ...Object.keys(localM)]).forEach(ym => {
        if (missionsTouched.has(ym)) { mergedM.push(...(localM[ym] || [])); monthQueue.add(ym); }
        else if (ym in remoteM) mergedM.push(...remoteM[ym]);
        else { mergedM.push(...(localM[ym] || [])); if ((localM[ym] || []).length) monthQueue.add(ym); }
      });
      missions = mergedM;
      saveMissionsLocal();
      renderMissionViews();
      if (monthQueue.size) flushMissions();
      render(true);
      const needUpload = touched || settingsTouched
        || (!d && (hasProgress(xp) || !isDefaultSettings()))
        || (d && !d.settings && !isDefaultSettings());
      if (needUpload) flush();
    } catch (e) {
      console.warn('cloud', e);
      if (!dbRef) setSaveState('local');
    }
  }
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
