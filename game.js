(() => {
  'use strict';

  /* ====== CONFIGURAÇÃO ====== */
  const SAIR_URL = 'jogo.html';    // página para onde o botão "Sair" leva
  const NOME = 'Marcinho';

  const W = 380, H = 680, CX = W / 2;
  const PLANET_R = 136, PLANET_CY = H;          // meia Terra centralizada na base
  const PW = 56, PH = 64, PLAYER_TOP = 458;     // personagem
  const PLAYER_SPEED = 430;                     // px/s com o teclado
  const BAD_UNLOCK = 10;                        // pontos para os itens ruins começarem a cair
  const WIN_SCORE = 70;                         // pontos para vencer
  const BAD_CHANCE = 0.62;                      // chance de um item ser ruim (mais ruins do que bons)
  const GOOD = ['🌿', '\u2600\uFE0F', '\u267B\uFE0F'];
  const BAD  = ['💨', '🔥'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ====== DOM ====== */
  const $ = id => document.getElementById(id);
  const canvas = $('c'), ctx = canvas.getContext('2d');
  const game = $('game'), scoreEl = $('score'), hint = $('hint'), toast = $('toast');
  const pauseBtn = $('pauseBtn'), playBtn = $('playBtn');
  const ovStart = $('ovStart'), ovPause = $('ovPause'), ovOver = $('ovOver');
  const endTitle = $('endTitle'), endSub = $('endSub');
  ctx.imageSmoothingEnabled = false;

  /* Escala dos textos HTML conforme o tamanho real do jogo */
  const fit = () => game.style.setProperty('--u', (game.clientWidth / W) + 'px');
  fit();
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(game);
  window.addEventListener('resize', fit);

  /* Telas largas: reduz o conjunto todo para caber na janela (sem rolagem), com margem em volta */
  const stage = $('stage');
  const MARGIN = 24;
  function fitStage() {
    const wide = window.innerWidth > 1020;
    let s = 1;
    if (wide) {
      s = Math.min((window.innerWidth - MARGIN * 2) / stage.offsetWidth,
                   (window.innerHeight - MARGIN * 2) / stage.offsetHeight, 1.3);
    }
    const on = wide && s >= .45;
    document.body.classList.toggle('fit', on);
    stage.style.transform = on ? 'scale(' + s + ')' : '';
  }
  fitStage();
  window.addEventListener('resize', fitStage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitStage);

  /* ====== ESTADO ====== */
  let state = 'idle';                // idle | playing | paused | over | won
  let score, playTime, spawnTimer, badUnlocked, shake, flash;
  let items = [], particles = [], floaters = [];
  const player = { x: CX, tx: CX };
  const keys = { left: false, right: false };
  let clock = 0, last = performance.now();

  /* ====== PIXEL ART ====== */
  // Ruído simples para desenhar continentes
  function hash(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = t => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => vnoise(x * .13, y * .13) * .6 + vnoise(x * .3 + 50, y * .3 + 50) * .3 + vnoise(x * .7 + 9, y * .7 + 9) * .1;

  // Planeta: desenhado em baixa resolução (blocos de 4px) e ampliado sem suavização
  const PL_W = 95, PL_H = 50, PL_SCALE = 4;
  const planetImg = (() => {
    const c = document.createElement('canvas'); c.width = PL_W; c.height = PL_H;
    const g = c.getContext('2d');
    const cx = PL_W / 2, cy = PL_H, R = PLANET_R / PL_SCALE;
    for (let y = 0; y < PL_H; y++) {
      for (let x = 0; x < PL_W; x++) {
        const d = Math.hypot(x + .5 - cx, y + .5 - cy);
        let col = null, a = 1;
        if (d <= R) {
          if (d > R - 1.4) col = '#a9dcff';
          else if (d > R - 2.8) col = '#5db4f5';
          else {
            const n = fbm(x, y), r = hash(x * 7, y * 13);
            if (n > .47) {
              col = r > .72 ? '#2f7d33' : r < .22 ? '#5cbf4f' : '#3f9a3a';
              if (n > .6) col = r > .55 ? '#26692c' : '#2f7d33';
            } else {
              col = r > .8 ? '#2a74d6' : r < .15 ? '#1a4fa3' : '#2263bf';
              if (n > .42) col = '#3a86e0';
            }
          }
        } else if (d <= R + 1.3) { col = '#6cc0ff'; a = .6; }
        else if (d <= R + 2.6) { col = '#4a9be8'; a = .3; }
        else if (d <= R + 4)   { col = '#3a78d8'; a = .13; }
        if (col) { g.globalAlpha = a; g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    return c;
  })();

  // Marcinho: sprite 14x16 (bloco de 4px), gordinho, camisa e calça pretas
  const SPRITE = [
    '....HHHHHH....',
    '...HHHHHHHH...',
    '...HSSSSSSH...',
    '...SSESSESS...',
    '...SSSSSSSS...',
    '....SSMMSS....',
    '....SSSSSS....',
    '..BBBBBBBBBB..',
    '.BBBBBBBBBBBB.',
    '.SBBBBBBBBBBS.',
    '.SBBBBBBBBBBS.',
    '.BBBBBBBBBBBB.',
    '..BBBBBBBBBB..',
    '..PPPPPPPPPP..',
    '..PPPP..PPPP..',
    '..WWWW..WWWW..'
  ];
  const PAL = { H: '#5a3a24', S: '#e2a878', E: '#1a1a24', M: '#a4553f', B: '#171a26', P: '#0d0e16', W: '#e9ecf7' };
  const playerImg = (() => {
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const g = c.getContext('2d');
    SPRITE.forEach((row, r) => [...row].forEach((ch, col) => {
      if (ch === '.') return;
      g.fillStyle = PAL[ch]; g.fillRect(col * 4, r * 4, 4, 4);
    }));
    return c;
  })();

  // Fundo: gradiente + estrelas
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#090d2b'); bgGrad.addColorStop(.5, '#131a4d'); bgGrad.addColorStop(1, '#27358a');
  const stars = Array.from({ length: 64 }, (_, i) => ({
    x: Math.round(Math.random() * W), y: Math.round(Math.random() * (H - 120)),
    s: Math.random() < .25 ? 3 : 2, ph: Math.random() * 6.28, v: 4 + Math.random() * 10, cross: i < 7
  }));

  /* ====== JOGO ====== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const surfaceY = x => {
    const dx = x - CX;
    return Math.abs(dx) < PLANET_R ? PLANET_CY - Math.sqrt(PLANET_R * PLANET_R - dx * dx) : H;
  };
  const BAD_SPEED_BOOST = 1.5;                                          // salto de velocidade quando os itens ruins começam (10 pts)
  const fallSpeed = () => Math.min(600, (120 + playTime * 3.2) * (badUnlocked ? BAD_SPEED_BOOST : 1));  // e acelera com o tempo
  const spawnEvery = () => Math.max(.42, 1.2 - playTime * .008);         // e aparecem cada vez mais rápido

  function reset() {
    score = 0; playTime = 0; spawnTimer = .6; badUnlocked = false; shake = 0; flash = 0;
    items = []; particles = []; floaters = [];
    player.x = player.tx = CX;
    scoreEl.textContent = '0';
    hint.classList.remove('off');
  }
  reset();

  function setState(s) {
    state = s;
    ovStart.hidden = s !== 'idle';
    ovPause.hidden = s !== 'paused';
    ovOver.hidden = s !== 'over' && s !== 'won';
    pauseBtn.classList.toggle('active', s === 'paused');
    pauseBtn.disabled = s === 'idle' || s === 'over' || s === 'won';
    playBtn.disabled = s !== 'idle';
  }
  setState('idle');

  function start() { reset(); setState('playing'); playBtn.blur(); }
  function togglePause() {
    if (state === 'playing') setState('paused');
    else if (state === 'paused') setState('playing');
  }
  function endGame(won) {
    keys.left = keys.right = false;
    endTitle.textContent = won ? 'Você e o ' + NOME + ' salvaram o planeta!' : 'Você perdeu';
    endSub.hidden = won;
    setState(won ? 'won' : 'over');
  }
  const gameOver = () => endGame(false);
  const victory = () => endGame(true);
  function exitGame() { window.location.href = SAIR_URL; }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
  }

  function addScore(d, x, y) {
    score += d;
    scoreEl.textContent = score;
    const txt = d > 0 ? '+' + d : String(d);
    floaters.push({ x, y, text: txt, color: d > 0 ? '#6dff8a' : d < 0 ? '#ff6b5b' : '#aebaf5', life: .9 });
    if (!badUnlocked && score >= BAD_UNLOCK) {
      badUnlocked = true;
      showToast('ITENS RUINS! TUDO MAIS RÁPIDO!');
    }
    if (badUnlocked && score <= 0) gameOver();
    else if (score >= WIN_SCORE) victory();
  }

  function burst(x, y, colors, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 40 + Math.random() * 110;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: .5 + Math.random() * .3, max: .8,
        c: colors[(Math.random() * colors.length) | 0], s: Math.random() < .5 ? 3 : 4 });
    }
  }

  function spawn() {
    const bad = badUnlocked && Math.random() < BAD_CHANCE;
    const list = bad ? BAD : GOOD;
    items.push({
      x: CX + (Math.random() * 2 - 1) * (PLANET_R - 20), y: -20,
      vy: fallSpeed() * (.9 + Math.random() * .25),
      emoji: list[(Math.random() * list.length) | 0], bad
    });
  }

  const isCaught = it =>
    Math.abs(it.x - player.x) < PW / 2 - 4 + 10 &&
    it.y + 12 > PLAYER_TOP + 4 && it.y - 12 < PLAYER_TOP + PH - 6;

  function update(dt) {
    playTime += dt;
    if (playTime > 4.5) hint.classList.add('off');

    // movimento
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) player.tx += dir * PLAYER_SPEED * dt;
    player.tx = clamp(player.tx, PW / 2 + 4, W - PW / 2 - 4);
    player.x += (player.tx - player.x) * Math.min(1, dt * 28);

    // estrelas descendo devagar
    for (const s of stars) { s.y += s.v * dt; if (s.y > H - 40) s.y = -4; }

    // novos itens
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawn(); spawnTimer = spawnEvery() * (.8 + Math.random() * .4); }

    // itens
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.vy * dt;

      if (isCaught(it)) {
        items.splice(i, 1);
        burst(it.x, it.y, it.bad ? ['#ffd166', '#ffffff', '#ff9a5b'] : ['#ffffff', '#aebaf5'], 8);
        addScore(it.bad ? 1 : 0, it.x, it.y - 10);
        if (state !== 'playing') return;
        continue;
      }
      const sy = surfaceY(it.x);
      if (it.y + 12 >= sy) {
        items.splice(i, 1);
        if (it.bad) {
          burst(it.x, sy, ['#ff6b5b', '#ffb04a', '#ffffff'], 16);
          flash = 1; shake = 1;
          addScore(-10, it.x, sy - 14);
        } else {
          burst(it.x, sy, ['#6dff8a', '#b6ff9c', '#ffffff'], 12);
          addScore(2, it.x, sy - 14);
        }
        if (state !== 'playing') return;
      }
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.vy += 320 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 42 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    flash = Math.max(0, flash - dt * 2.2);
    shake = Math.max(0, shake - dt * 3);
  }

  /* ====== DESENHO ====== */
  function render() {
    ctx.save();
    if (shake > 0 && !reduceMotion) {
      const m = shake * 6;
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    ctx.fillStyle = bgGrad; ctx.fillRect(-10, -10, W + 20, H + 20);

    // estrelas
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = .4 + .5 * Math.sin(clock * 1.6 + s.ph);
      if (s.cross) { ctx.fillRect(s.x - 1, Math.round(s.y) - 4, 2, 8); ctx.fillRect(s.x - 4, Math.round(s.y) - 1, 8, 2); }
      else ctx.fillRect(s.x, Math.round(s.y), s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // planeta
    ctx.drawImage(planetImg, 0, H - PL_H * PL_SCALE, PL_W * PL_SCALE, PL_H * PL_SCALE);
    if (flash > 0) {
      ctx.globalAlpha = flash * .45; ctx.fillStyle = '#ff4030';
      ctx.beginPath(); ctx.arc(CX, PLANET_CY, PLANET_R, Math.PI, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // itens
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "26px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    for (const it of items) ctx.fillText(it.emoji, Math.round(it.x), Math.round(it.y));

    // personagem + nick
    const px = Math.round(player.x - PW / 2);
    ctx.drawImage(playerImg, px, PLAYER_TOP);
    ctx.font = "bold 12px 'Courier New',monospace";
    const tw = ctx.measureText(NOME).width, bw = Math.round(tw + 10), bh = 16;
    const bx = clamp(Math.round(player.x - bw / 2), 2, W - bw - 2), by = PLAYER_TOP - 22;
    ctx.fillStyle = 'rgba(0,0,0,.68)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(NOME, bx + bw / 2, by + bh / 2 + 1);

    // partículas
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1);
      ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;

    // textos flutuantes (+2, +1, 0, -10)
    ctx.font = "500 18px 'Pixelify Sans','Courier New',monospace";
    ctx.lineWidth = 4; ctx.strokeStyle = '#05071a'; ctx.lineJoin = 'round';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / .4, 0, 1);
      ctx.strokeText(f.text, Math.round(f.x), Math.round(f.y));
      ctx.fillStyle = f.color; ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; clock += dt;
    if (state === 'playing') update(dt);
    if (state !== 'paused') updateEffects(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ====== CONTROLES ====== */
  playBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', togglePause);
  game.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'resume') togglePause();
    else if (a === 'restart') start();
    else if (a === 'exit') exitGame();
  });

  const isPlayKey = e => e.code === 'Space' || e.key === ' ';
  window.addEventListener('keydown', e => {
    if (isPlayKey(e)) {
      if (state === 'playing' || state === 'paused') { e.preventDefault(); if (!e.repeat) togglePause(); }
      return;
    }
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; if (state === 'playing') e.preventDefault(); }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; if (state === 'playing') e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (isPlayKey(e) && (state === 'playing' || state === 'paused')) e.preventDefault(); // evita "clicar" em botão focado
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setState('paused'); });

  // Arrastar (mouse ou toque)
  let dragging = false;
  const movePointer = e => {
    const r = canvas.getBoundingClientRect();
    player.tx = clamp((e.clientX - r.left) * (W / r.width), PW / 2 + 4, W - PW / 2 - 4);
  };
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    dragging = true; canvas.setPointerCapture(e.pointerId); movePointer(e);
  });
  canvas.addEventListener('pointermove', e => { if (dragging && state === 'playing') movePointer(e); });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
})();