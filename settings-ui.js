/*
 * Life RPG — impostazioni e personalizzazione
 * ---------------------------------------------------------------
 * - la finestra Impostazioni e le sue cinque schede (Aspetto, Lingua, Suono, Dati, Info);
 * - l'applicazione dell'aspetto scelto: colore e cornice delle finestre, colori dei testi, trasparenza,
 *   nome, titolo in alto, colori e icone delle statistiche, immagini di sfondo;
 * - il pannello Personalizza (selettori di colore con il campo esadecimale, scelte, immagini);
 * - il caricamento delle immagini (da file, incollate o trascinate), ridimensionate prima di salvarle.
 *
 * I calcoli dei colori sono in look.js. Restano in index.js: aprire e chiudere le finestre, il cambio
 * di lingua (ridisegna tutta l'app), il salvataggio delle impostazioni ("changed"), l'invio delle
 * immagini all'account (setImg, flushImgs) e la scheda Dati (backup, import, "Azzera tutto").
 *
 * Come missions-ui.js riceve:
 * - D: funzioni e valori che non cambiano;
 * - S: lo stato che cambia (S.settings, S.dbRef, S.fbAuth, S.activeModal), letto sempre "fresco":
 *   le impostazioni vengono sostituite per intero (valori predefiniti, backup, sincronizzazione).
 *
 * Uso (in index.js):  const SET = window.LIFE_RPG_SETTINGS_UI.create(D, S);
 */
(() => {
  'use strict';
  function create(D, S) {
    const {
      LANGS, T, STATS, ICONS, mixHex, winBase, paletteVars, normHex, FRAMES, FITS, defaultSettings, IMG_NAMES, CLOUD_IMG_MAX,
      GIF_MAX_FILE, isGif, validImg, imgs, $, resetArm, custResetArm, icoPx, iconSvg, rows, settingsWin, paneLook,
      openModal, closeModal, dataMsg, applyLang, applyAll, changed, setImg, renderInfo, loadFirebase, schedulePublish,
    } = D;
    const missionMsg = (...a) => D.missionMsg(...a);   // in index.js nasce più avanti: si prende al momento dell'uso

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
      if (!S.fbAuth) loadFirebase();   // pronte per "Accedi"
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

    const rootStyle = document.documentElement.style;
    const WIN_VARS = ['--win-a', '--win-b', '--win-c', '--win-edge', '--win-glow', '--ink-soft', '--track', '--btn'];

    // (i calcoli dei colori sono in look.js: vedi "dati di gioco")
    function applyTheme() {
      const c = S.settings.winColor;
      if (!c) { WIN_VARS.forEach(v => rootStyle.removeProperty(v)); return; }
      Object.entries(paletteVars(c)).forEach(([k, v]) => rootStyle.setProperty(k, v));
    }
    function applyFrame() { document.documentElement.dataset.frame = S.settings.frame; }
    // colori dei testi. --ink-soft dipende anche dal colore delle finestre: va applicato dopo di esso
    function applyTextColors() {
      ['--name-color', '--title-color', '--ink', '--ink-strong', '--gold'].forEach(v => rootStyle.removeProperty(v));
      if (S.settings.inkColor) { rootStyle.setProperty('--ink', S.settings.inkColor); rootStyle.setProperty('--ink-strong', S.settings.inkColor); }
      if (S.settings.accentColor) rootStyle.setProperty('--gold', S.settings.accentColor);
      if (S.settings.nameColor) rootStyle.setProperty('--name-color', S.settings.nameColor);
      if (S.settings.titleColor) rootStyle.setProperty('--title-color', S.settings.titleColor);
      if (S.settings.softColor) rootStyle.setProperty('--ink-soft', S.settings.softColor);
    }
    function applyPalette() { applyTheme(); applyTextColors(); }
    // trasparenza delle finestre: 0 = opache, 100 = completamente trasparenti.
    // Con la trasparenza si aggiunge uno sfocato (fino a 6px verso il 60%) che poi scompare,
    // così a 100% lo sfondo si vede nitido.
    function applyTransparency() {
      const t = S.settings.trans;
      if (!t) { rootStyle.removeProperty('--win-op'); rootStyle.removeProperty('--win-bf'); return; }
      rootStyle.setProperty('--win-op', (100 - t) + '%');
      const blur = t <= 60 ? t / 10 : 6 * (100 - t) / 40;
      if (blur > 0) rootStyle.setProperty('--win-bf', 'blur(' + blur + 'px)');
      else rootStyle.removeProperty('--win-bf');
    }
    function applyName() { $('player-name').textContent = S.settings.name.trim(); schedulePublish(); }
    // titolo in alto: testo a scelta (vuoto = "Life RPG") oppure nascosto
    function applyTitle() {
      const el = $('app-title');
      const text = S.settings.titleText.replace(/\s+/g, ' ').trim() || 'Life RPG';
      el.textContent = text;
      el.hidden = !S.settings.titleShow;
      el.classList.toggle('long', text.length > 16);
      document.title = S.settings.titleShow ? text : 'Life RPG';
    }
    function statColor(key) { return S.settings.colors[key] || STATS.find(s => s.key === key).color; }
    function statIconId(key) { return STATS.find(s => s.key === key).icon; }
    // mostra l'icona pixel oppure l'immagine caricata
    // trasparenza delle immagini: si guarda una volta per immagine e si ricorda
    const alphaKnown = new Map();
    function hasAlpha(data) {
      if (/^data:image\/jpe?g/i.test(data)) { alphaKnown.set(data, false); return Promise.resolve(false); }   // i JPEG non hanno trasparenza
      return new Promise(resolve => {
        const im = new Image();
        im.onload = () => {
          let a = false;
          try {
            const k = Math.min(1, 128 / Math.max(im.width, im.height, 1));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
            const g = c.getContext('2d');
            g.drawImage(im, 0, 0, c.width, c.height);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { a = true; break; }
          } catch (e) { /* non leggibile: come un'immagine piena */ }
          alphaKnown.set(data, a); resolve(a);
        };
        im.onerror = () => { alphaKnown.set(data, false); resolve(false); };
        im.src = data;
      });
    }
    function paintIcon(el, key) {
      const data = imgs[key];
      if (data) {
        const im = document.createElement('img');
        im.alt = ''; im.src = data;
        el.textContent = '';
        el.appendChild(im);
        el.classList.add('has-img');
        // immagine con zone trasparenti: si mostra senza riquadro (vale anche per le icone caricate prima)
        el.classList.toggle('alpha', alphaKnown.get(data) === true);
        if (!alphaKnown.has(data)) hasAlpha(data).then(a => { if (im.parentNode === el) el.classList.toggle('alpha', a); });
      } else {
        el.classList.remove('has-img', 'alpha');
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
        el.style.backgroundSize = (FITS.find(f => f.id === S.settings.bgFit) || FITS[0]).size;
        // "Adatta": le bande vuote si riempiono con una copia sfocata della stessa immagine
        const fill = $('bg-fill');
        if (S.settings.bgFit === 'adatta') { fill.style.backgroundImage = 'url("' + bg + '")'; fill.hidden = false; }
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
    const cs = {};
    function buildCustom() {
      // colori: finestre, nome e titolo
      $('in-win').addEventListener('input', e => {
        S.settings.winColor = e.target.value.toLowerCase();
        applyPalette(); paintCustom(); changed(true);
      });
      $('win-reset').addEventListener('click', () => { S.settings.winColor = null; applyPalette(); paintCustom(); changed(); });
      [['in-ink', 'ink-reset', 'inkColor'], ['in-soft', 'soft-reset', 'softColor'], ['in-accent', 'accent-reset', 'accentColor'],
       ['in-name-color', 'name-color-reset', 'nameColor'], ['in-title-color', 'title-color-reset', 'titleColor']]
        .forEach(([inp, rst, key]) => {
          $(inp).addEventListener('input', e => { S.settings[key] = e.target.value.toLowerCase(); applyPalette(); paintCustom(); changed(true); });
          $(rst).addEventListener('click', () => { S.settings[key] = null; applyPalette(); paintCustom(); changed(); });
        });
      // trasparenza
      $('in-trans').addEventListener('input', e => {
        S.settings.trans = Math.min(100, Math.max(0, Math.round(Number(e.target.value)) || 0));
        $('trans-val').textContent = S.settings.trans + '%';
        applyTransparency(); changed(true);
      });
      // bordi delle finestre
      FRAMES.forEach(f => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = f.name; b.dataset.id = f.id;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => { S.settings.frame = f.id; applyFrame(); paintCustom(); changed(); });
        $('seg-frame').appendChild(b);
      });
      // lingua
      LANGS.forEach(l => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = l.name; b.dataset.id = l.id; b.lang = l.id;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => {
          if (S.settings.lang === l.id) return;
          S.settings.lang = l.id;
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
        b.addEventListener('click', () => { S.settings.bgFit = f.id; applyImages(); paintCustom(); changed(); });
        $('seg-fit').appendChild(b);
      });
      // titolo in alto
      $('in-title').addEventListener('input', e => {
        S.settings.titleText = e.target.value.slice(0, 24);
        applyTitle(); changed(true);
      });
      $('btn-title-show').addEventListener('click', () => {
        S.settings.titleShow = !S.settings.titleShow;
        applyTitle(); paintCustom(); changed();
      });
      // sfondo visibile agli amici
      $('btn-share-bg').addEventListener('click', () => {
        S.settings.shareBg = !S.settings.shareBg;
        paintCustom(); changed();
      });
      // nome
      $('in-name').addEventListener('input', e => {
        S.settings.name = e.target.value.slice(0, 16);
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
          S.settings.colors[s.key] = e.target.value.toLowerCase();
          applyStats(); paintCustom(); changed(true);
        });
      });

      $('btn-custom-reset').addEventListener('click', () => {
        const b = $('btn-custom-reset');
        if (!b.dataset.armed) { custResetArm(true); return; }
        custResetArm(false);
        S.settings = Object.assign(defaultSettings(), { lang: S.settings.lang });   // la lingua non fa parte dell'aspetto
        IMG_NAMES.forEach(n => { if (imgs[n]) setImg(n, null); });
        applyAll(); paintCustom(); changed();
        imgMsg('');
      });

      document.querySelectorAll('#settings input[type="color"]').forEach(attachHex);
    }

    function paintCustom() {
      $('in-name').value = S.settings.name;
      $('in-title').value = S.settings.titleText;
      $('btn-title-show').setAttribute('aria-pressed', String(S.settings.titleShow));
      $('btn-title-show').textContent = S.settings.titleShow ? T('look.title.shown') : T('look.title.hidden');
      $('btn-share-bg').setAttribute('aria-pressed', String(S.settings.shareBg));
      $('btn-share-bg').textContent = S.settings.shareBg ? T('look.sharebg.on') : T('look.sharebg.off');
      $('share-bg-big').hidden = !(S.settings.shareBg && imgs.bg && imgs.bg.length > CLOUD_IMG_MAX);
      $('in-trans').value = S.settings.trans;
      $('trans-val').textContent = S.settings.trans + '%';
      $('in-win').value = S.settings.winColor || '#3049cf';
      $('win-reset').hidden = !S.settings.winColor;
      const accent = S.settings.accentColor || '#ffd54a';
      $('in-ink').value = S.settings.inkColor || '#f5f7ff';
      $('ink-reset').hidden = !S.settings.inkColor;
      $('in-soft').value = S.settings.softColor || (S.settings.winColor ? mixHex(winBase(S.settings.winColor), '#ffffff', 0.72) : '#b9c4ff');
      $('soft-reset').hidden = !S.settings.softColor;
      $('in-accent').value = accent;
      $('accent-reset').hidden = !S.settings.accentColor;
      $('in-name-color').value = S.settings.nameColor || accent;
      $('name-color-reset').hidden = !S.settings.nameColor;
      $('in-title-color').value = S.settings.titleColor || accent;
      $('title-color-reset').hidden = !S.settings.titleColor;
      document.querySelectorAll('#seg-frame button').forEach(b => {
        b.textContent = T('frame.' + b.dataset.id);
        b.setAttribute('aria-checked', String(b.dataset.id === S.settings.frame));
      });
      document.querySelectorAll('#seg-lang button').forEach(b =>
        b.setAttribute('aria-checked', String(b.dataset.id === S.settings.lang)));
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
        b.setAttribute('aria-checked', String(b.dataset.id === S.settings.bgFit));
      });
      syncHex();
    }

    // accanto a ogni selettore di colore c'è un campo per scrivere il codice esadecimale (normHex è in look.js)
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
    function imgMsg(t) { $('custom-msg').textContent = t; }
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
    // icona di una statistica: un quadrato di 128 px.
    // - immagine piena (una foto): riempie il quadrato, tagliando ai lati quello che avanza (come prima);
    // - immagine con zone trasparenti: si toglie il margine trasparente intorno alla forma, la forma si mostra
    //   intera al centro, e resta trasparente (sempre PNG: il JPEG cancellerebbe la trasparenza).
    function makeIcon(im) {
      // si guarda l'immagine (ridotta, per fare in fretta): ha zone trasparenti? dove sta la parte visibile?
      const k0 = Math.min(1, 512 / Math.max(im.width, im.height, 1));
      const w0 = Math.max(1, Math.round(im.width * k0)), h0 = Math.max(1, Math.round(im.height * k0));
      let box = null, alpha = false;
      try {
        const pc = document.createElement('canvas');
        pc.width = w0; pc.height = h0;
        const pg = pc.getContext('2d');
        pg.drawImage(im, 0, 0, w0, h0);
        const px = pg.getImageData(0, 0, w0, h0).data;
        let x0 = w0, y0 = h0, x1 = -1, y1 = -1;
        for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
          const a = px[(y * w0 + x) * 4 + 3];
          if (a < 250) alpha = true;
          if (a > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        // riquadro della parte visibile, riportato alla misura vera dell'immagine
        if (alpha && x1 >= 0) box = { x: x0 / k0, y: y0 / k0, w: (x1 - x0 + 1) / k0, h: (y1 - y0 + 1) / k0 };
      } catch (e) { alpha = false; }
      const draw = size => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const g = c.getContext('2d');
        if (box) {
          const k = Math.min(size / box.w, size / box.h);   // la forma intera, senza tagli
          const dw = box.w * k, dh = box.h * k;
          g.drawImage(im, box.x, box.y, box.w, box.h, (size - dw) / 2, (size - dh) / 2, dw, dh);
        } else {
          const k = Math.max(size / im.width, size / im.height);   // riempie il quadrato
          const dw = im.width * k, dh = im.height * k;
          g.drawImage(im, (size - dw) / 2, (size - dh) / 2, dw, dh);
        }
        return c;
      };
      let c = draw(128), url = c.toDataURL('image/png');
      if (url.length > 120000) {
        if (alpha) { c = draw(96); url = c.toDataURL('image/png'); }   // trasparente: più piccola, ma sempre PNG
        else url = c.toDataURL('image/jpeg', 0.8);
      }
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
        else if (S.dbRef && data.length > CLOUD_IMG_MAX) imgMsg(T('img.msg.gifcloud'));
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
      if (S.activeModal !== settingsWin || paneLook.hidden) return;
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

    // chiudendo una finestra si dimentica dove incollare un'immagine
    function clearPasteSlot() { pasteSlot = null; }

    return {
      openSettings, applyTheme, applyFrame, applyTextColors, applyTransparency, applyName, applyTitle, statColor, applyImages, cs, buildCustom, paintCustom, wireDrops, clearPasteSlot,
    };
  }
  window.LIFE_RPG_SETTINGS_UI = { create };
})();
