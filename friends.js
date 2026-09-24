/*
 * Life RPG — amici
 * ---------------------------------------------------------------
 * Ogni giocatore ha un codice amico (8 caratteri) e un profilo pubblico: nome, livello complessivo,
 * XP delle sei statistiche (da cui l'app dell'amico ricalcola titolo e grafico nella sua lingua).
 * Il profilo lo leggono solo gli amici (regole su Firebase). Le missioni non escono mai dall'account.
 *
 * Qui: il codice amico, la pubblicazione del profilo, richieste e elenco degli amici, la finestra Amici
 * e il profilo di un amico (la sua scheda Personaggio in sola lettura, con i suoi colori, il suo sfondo
 * e la musica del suo ruolo).
 *
 * L'accesso all'account (Firebase) resta in index.js. Come gli altri file riceve:
 * - D: funzioni e valori che non cambiano;
 * - S: lo stato che cambia (lingua, impostazioni, XP, account), letto sempre "fresco".
 *
 * Uso (in index.js):  const FR = window.LIFE_RPG_FRIENDS.create(D, S);
 */
(() => {
  'use strict';
  function create(D, S) {
    const {
      LANGS, T, STATS, levelFromXp, overallOf, normalize, heroClass, paletteVars, HEX, CLOUD_IMG_MAX, validImg, imgs,
      sfx, musicGuestStart, $, fpArm, levelTabSvg, radarMarkup, openModal, closeModal, openSettings, mk, fbConnect,
    } = D;
    // amici: il tuo codice, l'ultimo profilo pubblicato, l'impronta dello sfondo condiviso, l'elenco
    let myCode = '', codeJob = null, pubTimer = 0, lastPub = '', pubBgId;
    let friends = { rows: [], profs: {}, loaded: false };

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
      const uid = S.fbUser.uid;
      codeJob = (async () => {
        const ps = await S.fbDb.doc('profiles/' + uid).get();
        if (ps.exists && ps.data().code) return (myCode = ps.data().code);
        for (let i = 0; i < 6; i++) {
          const c = genCode();
          try { await S.fbDb.doc('friendCodes/' + c).set({ uid }); return (myCode = c); } catch (e) { /* codice già usato */ }
        }
        throw new Error('code');
      })().finally(() => { codeJob = null; });
      return codeJob;
    }
    // profilo pubblico: si riscrive solo se è cambiato qualcosa che gli amici vedono
    function schedulePublish(now) {
      if (!S.fbUser || !S.dbRef || S.accPending) return;
      clearTimeout(pubTimer);
      pubTimer = setTimeout(publishProfile, now ? 0 : 1500);
    }
    async function publishProfile() {
      if (!S.fbUser || !S.dbRef) return;
      try {
        const code = await ensureCode();
        const bg = S.settings.shareBg && imgs.bg && imgs.bg.length <= CLOUD_IMG_MAX ? imgs.bg : null;
        const bgId = bg ? imgId(bg) : '';
        const look = { bg: !!bg, bgId, lang: S.settings.lang };   // la lingua: gli amici vedono la tua scheda come la vedi tu
        ['winColor', 'inkColor', 'softColor', 'accentColor', 'nameColor'].forEach(k => { if (S.settings[k]) look[k] = S.settings[k]; });
        const pub = { name: S.settings.name.trim().slice(0, 30), level: overallOf(STATS.map(s => levelFromXp(S.xp[s.key]))), stats: { ...S.xp }, look, code };
        // sfondo: solo se l'hai scelto tu; se lo spegni o lo togli, sparisce anche per gli amici.
        // Si carica solo quando cambia davvero: l'impronta (bgId) dice se quello online è già questo.
        if (pubBgId === undefined) {
          const ps = await S.fbDb.doc('profiles/' + S.fbUser.uid).get();
          const old = ps.exists && ps.data().look;
          pubBgId = old ? (old.bgId || (old.bg ? '?' : '')) : '?';   // profilo di una versione precedente: si ricarica una volta
        }
        if (bgId !== pubBgId) {
          const bref = S.fbDb.doc('profileBg/' + S.fbUser.uid);
          if (bg) await bref.set({ data: bg, updated: Date.now() });
          else await bref.delete();
          pubBgId = bgId;
        }
        const sig = JSON.stringify(pub);
        if (sig === lastPub) return;
        await S.fbDb.doc('profiles/' + S.fbUser.uid).set({ ...pub, updated: Date.now() });
        lastPub = sig;
        if (!$('fmodal').hidden) paintFriendsHead();
      } catch (e) { console.warn('profile', e); }
    }
    function friendsReset() {
      myCode = ''; lastPub = ''; pubBgId = undefined; clearTimeout(pubTimer);
      friends = { rows: [], profs: {}, loaded: false };
      paintFriendsBtn();
    }
    const otherOf = f => f.members.find(m => m !== S.fbUser.uid);
    function incoming() { return friends.rows.filter(f => f.status === 'pending' && f.requestedBy !== S.fbUser.uid); }
    function paintFriendsBtn() {
      const n = S.fbUser && friends.loaded ? incoming().length : 0;
      $('btn-friends').textContent = n ? T('fr.btn.n', { n }) : T('fr.btn');
    }
    async function loadFriends() {
      const q = await S.fbDb.collection('friendships').where('members', 'array-contains', S.fbUser.uid).get();
      const rows = q.docs.map(d => ({ id: d.id, ...d.data() }));
      const acc = rows.filter(f => f.status === 'accepted');
      const profs = {};
      await Promise.all(acc.map(async f => {
        const uid = otherOf(f);
        try { const p = await S.fbDb.doc('profiles/' + uid).get(); if (p.exists) profs[uid] = p.data(); } catch (e) { /* profilo non leggibile */ }
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
        act.append(mkBtn(' add', T('fr.accept'), () => frAct(() => S.fbDb.doc('friendships/' + f.id).update({ status: 'accepted' }), T('fr.msg.accepted'))),
                   mkBtn('', T('fr.decline'), () => frAct(() => S.fbDb.doc('friendships/' + f.id).delete(), '')));
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
      const mine = friends.rows.filter(f => f.status === 'pending' && f.requestedBy === S.fbUser.uid);
      mine.forEach(f => {
        const row = mk('div', 'fr-row');
        row.appendChild(mk('span', 'fr-who', T('fr.pending.to', { code: fmtCode(f.toCode || '') })));
        row.appendChild(mkBtn('', T('fr.cancel'), () => frAct(() => S.fbDb.doc('friendships/' + f.id).delete(), '')));
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
        const cs = await S.fbDb.doc('friendCodes/' + code).get();
        if (!cs.exists) { frMsg(T('fr.msg.notfound'), 'bad'); sfx('err'); return; }
        const uid = cs.data().uid, me = S.fbUser.uid;
        if (uid === me) { frMsg(T('fr.msg.self'), 'bad'); return; }
        await loadFriends();
        const ex = friends.rows.find(f => f.members.includes(uid));
        if (ex && ex.status === 'accepted') { frMsg(T('fr.msg.already')); renderFriends(); return; }
        if (ex && ex.requestedBy === me) { frMsg(T('fr.msg.pending')); renderFriends(); return; }
        $('fr-in').value = '';
        if (ex) { await frAct(() => S.fbDb.doc('friendships/' + ex.id).update({ status: 'accepted' }), T('fr.msg.accepted')); return; }   // ti aveva già scritto lui
        await frAct(() => S.fbDb.doc('friendships/' + pairOf(me, uid)).set({
          members: [me, uid], requestedBy: me, status: 'pending', created: Date.now(),
          fromName: S.settings.name.trim().slice(0, 30), fromCode: myCode, toCode: code,
        }), T('fr.msg.sent'));
      } catch (e) { console.warn('friends', e); frMsg(T('fr.msg.err'), 'bad'); sfx('err'); }
    }
    async function openFriends(afterMsg) {
      frMsg('');
      const noacc = t => {   // niente amici per ora: senza accesso (con il pulsante) oppure account non raggiungibile
        $('fr-noacc-text').textContent = t;
        $('fr-goacc').hidden = !!S.fbUser;
        $('fr-noacc').hidden = false; $('fr-main').hidden = true;
      };
      if (!S.fbUser) { noacc(T('fr.needacc')); openModal($('fmodal'), $('fr-goacc')); return; }
      if (!S.dbRef) {
        noacc(T('fr.connecting'));
        openModal($('fmodal'), $('fr-close'));
        await fbConnect();
        if ($('fmodal').hidden) return;                  // nel frattempo hai chiuso la finestra
        if (!S.dbRef) { noacc(T('fr.offline')); return; }
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
      const fl = p.look && LANGS.some(l => l.id === p.look.lang) ? p.look.lang : S.lang;
      const mine = S.lang;
      S.lang = fl;
      try {
        $('fp-tab').innerHTML = levelTabSvg(ov, 3);
        $('fp-tab').setAttribute('aria-label', T('lv') + ' ' + ov);
        $('fp-name').textContent = friendName(p);
        $('fp-class').textContent = heroClass(x);
        $('fp-radar').innerHTML = radarMarkup(x);
      } finally { S.lang = mine; }
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
        const b = await S.fbDb.doc('profileBg/' + uid).get();
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
      try { await S.fbDb.doc('friendships/' + pairOf(S.fbUser.uid, fpUid)).delete(); } catch (e) { console.warn('friends', e); }
      backToFriends(T('fr.msg.removed'));
    });

    return {
      schedulePublish, friendsReset, paintFriendsBtn, checkFriendRequests,
    };
  }
  window.LIFE_RPG_FRIENDS = { create };
})();
