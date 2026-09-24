/*
 * Life RPG — missioni e calendario: la parte che si vede
 * ---------------------------------------------------------------
 * Tutto quello che mostra e fa le missioni sullo schermo:
 * - le schede delle missioni (con stelle, ricompense, penalità, pulsanti) e l'elenco a gruppi;
 * - completare, annullare, togliere una penalità, la finestra delle penalità, i messaggi;
 * - il "giro di oggi" delle routine e il controllo delle scadenze (anche con l'app aperta);
 * - il calendario, la lista del giorno e i collegamenti a Google Calendar;
 * - la finestra per creare e modificare missioni e routine, l'elenco delle routine;
 * - la selezione di missioni completate o fallite, per eliminarle.
 *
 * Le REGOLE (date, scadenze, ordine, XP, routine) sono in missions.js; qui si usano e basta.
 * Tutto il resto (salvataggio, finestre, suoni, XP del personaggio) lo fornisce index.js:
 * - D: le funzioni e i valori che non cambiano (traduzioni, suoni, finestre, disegni...);
 * - S: lo stato che cambia nel tempo (elenco delle missioni e delle routine, XP, account, finestra aperta).
 *   Si legge sempre da S (S.missions, S.xp...) così si vede la versione di adesso, anche dopo che
 *   la sincronizzazione ha sostituito l'elenco intero.
 *
 * Uso (in index.js):  const MUI = window.LIFE_RPG_MISSIONS_UI.create(D, S);
 */
(() => {
  'use strict';
  function create(D, S) {
    const {
      GAME, MISSIONS, T, TN, locale, fmt, sfx, $, mk, mfDelArm, selArm, reduce, iconSvg, digitsSvg,
      saveRoutinesLocal, tombMissions, tombRoutine, persist, render, floatText, showLevelUp, openModal, closeModal,
      statColor, readable, touchMonth, showView,
    } = D;
    const { STATS, MAX_XP, levelFromXp, overallOf } = GAME;
    const {
      MAX_PER_MONTH, MAX_MISSIONS, MAX_ROUTINES, pad2, isoDate, parseDate, todayStr, addDaysStr, monthOf, validDate, validTime,
      rewardTotal, rewardMatch, startMs, dueEndMs, isLate, notYet, WD_ALL, gcalUrl, gcalRoutineUrl,
    } = MISSIONS;
    const nameSpan = key => D.nameSpan(key);   // in index.js è definito più avanti: si prende al momento dell'uso

    const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
    const fmtClock = ms => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const fmtDay = (s, long) => cap1(parseDate(s).toLocaleDateString(locale(),
      long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }));
    const dueLabel = m => fmtDay(m.due) + (m.dueTime ? T('time.at', { time: m.dueTime }) : '');
    const fromLabel = m => fmtDay(m.from) + (m.fromTime ? T('time.at', { time: m.fromTime }) : '');
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

    // completare e annullare ("non ancora completabile" è notYet, in missions.js)
    function completeMission(id) {
      const m = S.missions.find(x => x.id === id);
      if (!m || m.done || m.failed) return;   // scaduta: non si completa più (si può solo riprogrammare)
      if (isLate(m)) {   // scaduta da poco ma non ancora segnata come fallita: non si completa, e diventa fallita adesso
        missionMsg(T('msg.expired', { title: m.title }), 'bad', true);
        sfx('err');
        renderMissionViews();
        checkPenalties();
        return;
      }
      if (notYet(m)) { missionMsg(T('m.locked', { when: m.rid ? fmtDay(m.due) : fromLabel(m) }), 'bad', true); sfx('err'); return; }
      const before = STATS.map(s => levelFromXp(S.xp[s.key]));
      const ovFrom = overallOf(before);
      // routine: la serie cresce solo se la completi entro il giorno previsto
      const rt = routineOf(m);
      const { rs, bonus } = MISSIONS.streakStep(rt, m, todayStr());
      const applied = MISSIONS.gainXp(S.xp, m.rewards, bonus);
      const lastT = S.missions.reduce((mx, x) => x.done ? Math.max(mx, x.done.t) : mx, 0);
      m.done = { date: todayStr(), t: Math.max(Date.now(), lastT + 1), applied };   // t cresce sempre: ordina le completate
      if (rs) {
        m.done.rs = rs;
        rt.streak = rs.n; rt.streakDate = m.due; rt.best = Math.max(rt.best || 0, rs.n);
        saveRoutinesLocal();
      }
      persist();
      touchMonth(monthOf(m));
      const after = STATS.map(s => levelFromXp(S.xp[s.key]));
      const ups = STATS.map((s, i) => ({ s, from: before[i], to: after[i] })).filter(u => u.to > u.from);
      render(true);
      STATS.forEach(s => { if (applied[s.key] > 0) floatText(s.key, '+' + fmt(applied[s.key]), false); });
      missionMsg(T(Object.keys(bonus).length ? 'msg.completed.bonus' : 'msg.completed', { title: m.title, gain: gainText(applied), n: rs ? rs.n : 0 }), 'good');
      renderMissionViews();
      if (ups.length) { showLevelUp(ups, ovFrom, overallOf(after)); sfx('up'); } else sfx(Object.keys(bonus).length ? 'bonus' : 'add');
    }
    function undoMission(id) {
      const m = S.missions.find(x => x.id === id);
      if (!m || !m.done) return;
      const before = STATS.map(s => levelFromXp(S.xp[s.key]));
      const removed = MISSIONS.undoXp(S.xp, m.done.applied);
      const rsBack = m.done.rs, rtBack = routineOf(m);
      m.done = null;
      if (MISSIONS.streakUndo(rtBack, rsBack, m.due)) saveRoutinesLocal();   // la serie torna com'era prima
      persist();
      touchMonth(monthOf(m));
      const after = STATS.map(s => levelFromXp(S.xp[s.key]));
      render(true);
      const parts = STATS.filter(s => removed[s.key] > 0).map(s => '-' + fmt(removed[s.key]) + ' ' + s.name);
      missionMsg(T('msg.undone', { title: m.title, loss: parts.length ? parts.join(', ') : T('xp.none.remove') }), 'bad');
      renderMissionViews();
      sfx(after.some((l, i) => l < before[i]) ? 'down' : 'sub');
    }

    // penalità: alla prima apertura dopo la scadenza, una sola volta per missione
    function revertPenalty(id) {
      const m = S.missions.find(x => x.id === id);
      if (!m || !m.failed || m.done || m.rid) return;
      const restored = MISSIONS.gainXp(S.xp, m.failed.applied);
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
      if (S.activeModal) return false;   // non interrompere chi sta scrivendo: si riprova dopo
      const today = todayStr();
      const due = MISSIONS.lateMissions(S.missions);
      if (!due.length) return true;
      const before = STATS.map(s => levelFromXp(S.xp[s.key]));
      const list = [];
      due.forEach((m, i) => {
        const removed = MISSIONS.penaltyXp(S.xp, m.penalty);
        m.failed = { date: today, t: Date.now() + i, applied: removed };
        list.push({ m, removed });
      });
      new Set(due.map(monthOf)).forEach(touchMonth);   // un salvataggio per mese, non uno per missione
      persist();
      const after = STATS.map(s => levelFromXp(S.xp[s.key]));
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
    // (giorni previsti, pause, serie e il "giro di oggi" sono in missions.js)
    const routineOf = m => MISSIONS.routineOf(S.routines, m);
    // crea le volte di oggi, aggiorna la serie e pulisce le volte saltate; true se qualcosa è cambiato
    let routinesDay = '';
    function syncRoutines() {
      routinesDay = todayStr();
      const res = MISSIONS.routineDay(S.routines, S.missions, todayStr());
      S.missions = res.missions;
      if (res.routinesChanged) saveRoutinesLocal();
      if (res.changed) res.months.forEach(touchMonth);
      return res.changed;
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
      if (penaltyReady && !S.activeModal && Date.now() >= holdUntil) {
        if (syncRoutines()) renderMissionViews();
        applyPenalties();
      }
      const sig = todayStr() + ':' + S.missions.filter(m => !m.done && isLate(m)).length;
      if (sig !== lastSig) { lastSig = sig; renderMissionViews(); }
    }
    $('pen-ok').addEventListener('click', closeModal);
    $('pmodal').addEventListener('click', e => { if (e.target === $('pmodal')) closeModal(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (S.dbRef) holdPenalties(2500);
      checkPenalties();
    });
    window.addEventListener('focus', checkPenalties);
    // con l'app aperta: a cavallo della mezzanotte compaiono le routine del nuovo giorno,
    // e una missione che scade diventa subito fallita (con una finestra aperta si aspetta che la chiudi)
    setInterval(() => {
      if (document.hidden) return;
      if (todayStr() !== routinesDay || S.missions.some(m => !m.done && !m.failed && isLate(m))) checkPenalties();
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
    function renderMissions() {
      const { todo, failed, done, groups } = MISSIONS.missionLists(S.missions);
      const tl = $('m-todo'), fl = $('m-failed'), dl = $('m-done');
      tl.textContent = ''; fl.textContent = ''; dl.textContent = '';

      // da fare: raggruppate per scadenza
      if (!todo.length) tl.appendChild(mk('p', 'empty', T('mis.empty.todo')));
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
    const plannedRoutines = (ds, ids) => MISSIONS.plannedRoutines(S.routines, ds, ids);
    function renderCalendar(focusDate) {
      const grid = $('cal-grid');
      grid.textContent = '';
      T('cal.wd').split(',').forEach(w => grid.appendChild(mk('div', 'cal-wd', w)));
      const offset = (new Date(calY, calM, 1).getDay() + 6) % 7;
      const days = new Date(calY, calM + 1, 0).getDate();
      for (let i = 0; i < offset; i++) grid.appendChild(mk('div', 'cal-blank'));
      const { todo, done, fail } = MISSIONS.calendarMarks(S.missions);
      const today = todayStr();
      const ids = new Set(S.missions.map(m => m.id));
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
      const { todo, failed, done } = MISSIONS.dayLists(S.missions, selDate);
      const planned = plannedRoutines(selDate, new Set(S.missions.map(m => m.id)));
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
      const next = MISSIONS.nextChange(S.missions, now);
      if (next === Infinity) return;
      expiryTimer = setTimeout(() => { renderMissionViews(); checkPenalties(); }, Math.min(next - now + 50, 3600000));   // al massimo un'ora: si ricontrolla
    }

    $('m-new').addEventListener('click', () => openMissionForm(null, null));
    $('m-more').addEventListener('click', () => { doneShown += PAGE; renderMissions(); });
    // frecce pixel-art: il font dell'app non ha i caratteri < e >
    // (pixel grandi come quelli delle lettere: 1 pixel del font = 1/16 della sua altezza)
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
      const m0 = id ? S.missions.find(x => x.id === id) : null;
      if (m0 && m0.rid && routineOf(m0)) { openRoutineForm(m0.rid); return; }   // le volte di una routine si modificano dalla routine
      editingId = id; editingRid = null; routinesBack = false;
      editingDue = m0 ? m0.due : null;
      editingFrom = m0 ? m0.from : null;
      editingFromTime = m0 ? m0.fromTime : null;
      $('mf-rep-field').hidden = !!m0;          // una missione già creata non diventa routine
      $('mf-rep-toggle').hidden = false;
      setFormRepeat(false);
      const m = id ? S.missions.find(x => x.id === id) : null;
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
      const r = rid ? S.routines.find(x => x.id === rid) : null;
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
      const cur = editingRid ? S.routines.find(x => x.id === editingRid) : null;
      if (pf && pf < todayStr() && !(cur && cur.pause && cur.pause.from === pf)) return fail(T('mf.err.past'), $('mf-pause-from'));
      if (pu && pf && pu < pf) return fail(T('mf.err.pause'), $('mf-pause-until'));
      let r = editingRid ? S.routines.find(x => x.id === editingRid) : null;
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
        if (S.routines.length >= MAX_ROUTINES) return fail(T('mf.err.routines', { max: MAX_ROUTINES }), null);
        r = { id: 'r' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4), title, desc, rewards, penalty, days, time,
          start, pause, streak: 0, streakDate: addDaysStr(start, -1), best: 0, bonus, stars };
        S.routines.push(r);
      }
      // le volte ancora da fare prendono i valori nuovi
      const months = new Set();
      S.missions.forEach(m => {
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
      const r = S.routines.find(x => x.id === editingRid);
      if (!r) return;
      if (!$('mf-del').dataset.armed) { mfDelArm(true); return; }   // solo "Elimina" → "Conferma", nello stesso punto
      const drop = S.missions.filter(m => m.rid === r.id && !m.done && !m.failed);
      const months = new Set(drop.map(monthOf));
      tombMissions(drop);
      S.missions = S.missions.filter(m => !drop.includes(m));
      tombRoutine(r.id);
      S.routines = S.routines.filter(x => x !== r);
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
      let m = editingId ? S.missions.find(x => x.id === editingId) : null;
      if (m) {
        if (m.done) return fail(T('mf.err.done'), null);
        Object.assign(m, { title, desc, rewards, penalty, due, dueTime, from, fromTime, stars });
      } else {
        const created = todayStr();
        if (S.missions.filter(x => monthOf(x) === created.slice(0, 7)).length >= MAX_PER_MONTH) {
          return fail(T('mf.err.month', { max: MAX_PER_MONTH }), null);
        }
        if (S.missions.length >= MAX_MISSIONS) return fail(T('mf.err.total'), null);
        m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, desc, rewards, penalty, due, dueTime, from, fromTime, created, done: null, failed: null, stars };
        S.missions.push(m);
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
      const gone = S.missions.filter(m => sel.ids.has(m.id) && (m.done || m.failed));
      const months = new Set(gone.map(monthOf));
      tombMissions(gone);
      S.missions = S.missions.filter(m => !gone.includes(m));
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
      const m = editingId ? S.missions.find(x => x.id === editingId) : null;
      if (!m || m.done) return;
      if (!$('mf-del').dataset.armed) { mfDelArm(true); return; }   // solo "Elimina" → "Conferma", nello stesso punto
      tombMissions([m]);
      S.missions = S.missions.filter(x => x !== m);
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
      $('r-empty').hidden = S.routines.length > 0;
      S.routines.forEach(r => box.appendChild(routineCard(r)));
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

    // l'app ha finito di caricare l'account: da adesso le penalità possono scattare
    function setPenaltyReady() { penaltyReady = true; }

    return {
      missionMsg, syncRoutines, checkPenalties, setPenaltyReady, collapseMissionLists, renderMissions, renderCalendar, renderMissionViews, initCal, formLabels, paintFormRepeat, sel, rmodal, renderRoutines,
    };
  }
  window.LIFE_RPG_MISSIONS_UI = { create };
})();
