/*
 * Life RPG — musica ed effetti sonori
 * ---------------------------------------------------------------
 * Due cose diverse, entrambe qui:
 * - gli EFFETTI SONORI: note brevi generate al momento (Web Audio, nessun file),
 *   per missione completata, penalità, livello, schede, finestre...;
 * - la MUSICA di sottofondo: un file mp3 per ogni ruolo del personaggio, in loop.
 *   Nella scheda Personaggio suona al volume scelto, nelle altre più piano.
 *
 * Qui ci sono lo stato (acceso/spento, volume, brano) e la logica. Le preferenze
 * si salvano sul dispositivo (localStorage) con le stesse chiavi di sempre.
 * I pulsanti delle Impostazioni, il cursore del volume e i "tocchi" che fanno
 * partire la musica restano in index.js, che chiama le funzioni di questo file.
 *
 * Uso (in index.js):
 *   const AUDIO = window.LIFE_RPG_AUDIO.create(GAME, {
 *     xp: () => xp,                              // gli XP attuali (per scegliere il brano del tuo ruolo)
 *     fullVolume: () => curView === 'char',      // true dove la musica suona a volume pieno
 *   });
 */
(() => {
  'use strict';

  // chiavi delle preferenze salvate sul dispositivo (non cambiarle: si perderebbero le scelte già fatte)
  const LS_SOUND = 'liferpg:sound';
  const LS_SOUND_MENU = 'liferpg:sound:menu';
  const LS_MUSIC = 'liferpg:music', LS_MUSIC_VOL = 'liferpg:music:vol';

  // Ogni ruolo ha il suo file, con il nome italiano del ruolo (Eroe.mp3, Mago.mp3, Samurai.mp3...), senza il grado davanti,
  // accanto a index.html (maiuscole e minuscole contano). Se il file del ruolo non c'è si usa Avventuriero.mp3.
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

  // lettura e scrittura delle preferenze: se il browser non lascia usare localStorage si va avanti con i valori predefiniti
  const readPref = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const savePref = (key, val) => { try { localStorage.setItem(key, val); } catch (e) { /* ignora */ } };

  function create(G, opts) {
    const getXp = opts.xp;               // gli XP attuali, letti ogni volta (cambiano durante il gioco)
    const fullVolume = opts.fullVolume;  // true nella scheda Personaggio

    /* ---------- effetti sonori ---------- */
    let soundOn = readPref(LS_SOUND) !== '0';
    // suoni dei menu: hanno un interruttore a parte (Impostazioni, scheda Suono)
    const MENU_KINDS = new Set(['tab', 'open', 'close', 'save', 'del', 'err']);
    let menuOn = readPref(LS_SOUND_MENU) !== '0';
    let audio = null, lastMajor = 0, lastLow = 0;
    function blip(freq, t0, dur, type, vol) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
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
    function setSound(on) { soundOn = !!on; savePref(LS_SOUND, soundOn ? '1' : '0'); }
    function setMenuSound(on) { menuOn = !!on; savePref(LS_SOUND_MENU, menuOn ? '1' : '0'); }

    /* ---------- musica ---------- */
    // Il brano suona in loop su tutte le schede: nella scheda Personaggio al volume scelto, nelle altre più piano.
    // Il brano si sceglie quando entri nella scheda Personaggio; la musica si ferma solo se la spegni o se la pagina non è in primo piano.
    function roleFile(x = getXp()) {   // x: gli XP di chi ascoltiamo (di solito i tuoi, oppure quelli di un amico)
      const r = G.heroRole(x);
      const f = MUSIC_FILES[r.ns] && MUSIC_FILES[r.ns][r.id];
      return f ? f + '.mp3' : MUSIC_FALLBACK;
    }
    let musicOn = readPref(LS_MUSIC) !== '0', musicPct = 35;
    {
      const raw = readPref(LS_MUSIC_VOL), v = Number(raw);
      if (raw !== null && Number.isFinite(v) && v >= 0 && v <= 100) musicPct = Math.round(v);
    }
    const musicGain = () => Math.pow(musicPct / 100, 2);     // curva quadratica: i volumi bassi si regolano meglio
    // mentre muovi il cursore del volume (e per due secondi dopo) suona al volume pieno, così senti davvero quello che scegli
    let musicBoost = false, musicBoostT = 0;
    const musicLevel = () => (fullVolume() || musicBoost) ? 1 : MUSIC_DUCK;
    const musicTarget = () => musicGain() * musicLevel();
    let musicEl = null, musicFile = '', musicFailed = false, musicFade = 0;
    const musicMissing = new Set();      // brani che il server non ha: non si richiedono di nuovo
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
    const musicIdle = () => !musicEl || musicEl.paused;    // true se in questo momento non suona niente
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
    // pulsante Musica: accende o spegne (e lo ricorda)
    function setMusic(on) {
      musicOn = !!on;
      savePref(LS_MUSIC, musicOn ? '1' : '0');
    }
    // cursore del volume, mentre lo muovi: salva il valore e fa sentire subito il volume nuovo (pieno, per 2 secondi)
    function setMusicVolume(value) {
      musicPct = Math.min(100, Math.max(0, Number(value) || 0));
      savePref(LS_MUSIC_VOL, String(musicPct));
      const wasFull = musicLevel() === 1;
      musicBoost = true;
      clearTimeout(musicBoostT);
      musicBoostT = setTimeout(() => { musicBoost = false; musicRetune(); }, 2000);
      if (musicEl && !musicEl.paused) {
        if (wasFull) { clearInterval(musicFade); musicEl.volume = musicTarget(); } else fadeMusic(musicTarget(), 200);
      } else if (musicWanted()) musicPlay();
    }

    return {
      // effetti sonori
      sfx, setSound, setMenuSound,
      soundOn: () => soundOn, menuOn: () => menuOn,
      // musica
      MUSIC_FILES, MUSIC_FALLBACK, MUSIC_DUCK, roleFile,
      setMusic, setMusicVolume,
      musicOn: () => musicOn, musicPct: () => musicPct,
      musicWanted, musicIdle, musicPlay, musicStop, musicSync, musicRetune, musicGuestStart, musicGuestEnd,
    };
  }
  window.LIFE_RPG_AUDIO = { create, MUSIC_FILES, MUSIC_FALLBACK };
})();