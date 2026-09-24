/*
 * Life RPG — disegni
 * ---------------------------------------------------------------
 * Tutto ciò che l'app disegna da sola, come testo SVG:
 * - le icone a pixel (una griglia di righe: "X" = pixel pieno);
 * - i numeri a pixel, con le stesse forme del font dell'app;
 * - la linguetta dorata del livello in cima alla scheda Personaggio;
 * - il radar a esagono delle sei statistiche (il tuo e quello degli amici).
 *
 * Qui si produce solo il disegno: dove metterlo nella pagina e come animarlo
 * lo decide index.js. Servono T (traduzioni, per "Lv") e le regole del gioco
 * (game.js) per nomi e livelli delle statistiche.
 *
 * Uso (in index.js):  const DRAW = window.LIFE_RPG_DRAW.create(T, GAME);
 */
(() => {
  'use strict';
  function create(T, G) {
    const { STATS, MAX_LEVEL, levelFromXp, fracLevel } = G;
    const icoPx = rw => (Math.max(rw.length, rw[0].length) >= 9 ? 4 : 5);   // pixel interi per le icone delle righe di Statistiche (riquadro da 60 px)
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

    /* ----- radar: esagono delle sei statistiche ----- */
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
    // punti della forma colorata; ratios: per ogni statistica (ordine di STATS) quanto è piena, da 0 a 1
    const radarShapePoints = ratios => ptsStr(RADAR_IDX.map((k, i) => pt(i, R * Math.min(1, Math.max(ratios[k], 0.03)))));

    return { icoPx, snapCell, snapSize, iconSvg, DIGITS, digitRows, digitsSvg, levelTabSvg, CX, CY, R, LR, pt, ptsStr, RADAR_IDX, POS, radarMarkup, radarShapePoints };
  }
  window.LIFE_RPG_DRAW = { create };
})();
