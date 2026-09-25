/*
 * Life RPG — dati di gioco
 * ---------------------------------------------------------------
 * Le regole del gioco, senza interfaccia e senza salvataggi:
 * le sei statistiche, i livelli (0–100) e gli XP che richiedono,
 * i titoli del personaggio (classi, coppie, gruppi, gradi).
 *
 * Tutto dipende solo dai numeri che riceve, quindi si può provare da solo
 * (vedi test/tgame.js). L'unica cosa che viene da fuori è T, la funzione
 * delle traduzioni, per i nomi mostrati.
 *
 * Uso (in index.js):  const G = window.LIFE_RPG_GAME.create(T);
 */
(() => {
  'use strict';
  function create(T) {
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
    function heroRole(x) {
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
    function heroClass(x) {
      const r = heroRole(x);
      const name = T(r.ns + '.' + r.id);
      return r.ns === 'tier' ? name : withGrade(name, r.lv);
    }

    // ---------- XP ----------
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

    return { statDef, STATS, ICONS, ALIASES, MAX_LEVEL, MAX_XP, xpForLevel, levelFromXp, fracLevel, overallOf, PAIRS, TRIPLES, QUADS, QUINTS, TIERS, GRADES, gradeOf, withGrade, SPEC_MIN_LEVEL, SPEC_RATIO, NEAR_RATIO, heroRole, heroClass, blank, normalize };
  }
  window.LIFE_RPG_GAME = { create };
})();
