/* ============================================================
   Flappy Nature – Easter Egg Game
   Self-contained IIFE. Reads design tokens from CSS vars.
   Triggered by clicking the footer heart.
   No globals, no side-effects on the rest of the site.
   ============================================================ */
;(function () {
  'use strict';

  /* --- Helpers ----------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const css = (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop).trim();

  /* --- Design tokens (from main.css) ------------------------- */
  const COLORS = {
    navy:      () => css('--sn-navy')    || '#090949',
    violet:    () => css('--sn-violet')  || '#6500D9',
    cyan:      () => css('--sn-cyan')    || '#00D9FF',
    magenta:   () => css('--sn-magenta') || '#D76EFF',
    light:     () => css('--sn-light')   || '#FBF6F6',
    white:     () => css('--sn-white')   || '#FFFFFF',
    midviolet: () => css('--sn-midviolet') || '#4B00A0',
  };
  const FONT_HEADING = () => css('--font-family-heading') || '"Poppins", sans-serif';

  /* --- Game constants ---------------------------------------- */
  const CFG = {
    width:       380,
    height:      520,
    gravity:     0.38,
    flapForce:  -6.2,
    pipeWidth:   52,
    pipeGap:     145,
    pipeSpeed:   2.4,
    pipeSpawn:   1600,    // ms between pipes
    groundH:     50,
    birdSize:    28,
    birdX:       70,
    cloudCount:  4,
    resetDelay:  600,     // ms before tap-to-restart works
  };

  /* --- Parallax Background System ----------------------------- */
  // All Second Nature themed background artifacts
  // Layers move at different speeds for depth effect
  // Everything is subtle/muted so it doesn't obscure gameplay

  const BG = {
    // Layer speeds (multiplier of pipeSpeed) — smaller = farther away
    farSpeed:    0.08,   // distant skyline
    midSpeed:    0.18,   // mid buildings / trees
    nearSpeed:   0.35,   // closer elements
    planeSpeed:  0.6,    // planes cross faster

    // Spawn / density
    skylineSegW:  120,   // width of each skyline building segment
    buildingMinW: 25,
    buildingMaxW: 50,
    treeMinW:     8,
    treeMaxW:     18,

    // Opacity — everything deliberately muted
    skylineAlpha:  0.06,
    buildingAlpha: 0.07,
    treeAlpha:     0.06,
    planeAlpha:    0.18,
    bannerAlpha:   0.30,
    cloudFarAlpha: 0.06,
    cloudMidAlpha: 0.10,
  };

  /* --- Banner / plane text pools ----------------------------- */
  const BANNER_TEXTS = [
    'Triple Win!',
    'SNKO 2026',
    'NARPM 7x Affiliate',
    'Resident Benefits',
    'Credit Building',
    'Maestro',
    'Phoenix',
    'New Orleans',
    'Montreal',
    'Air Filters',
    '64pt Credit Boost!',
    'RBP',
    'Purple Heart',
    'Pirate Ship!',
    'Grow the Pie',
    'Move-In Concierge',
    'Identity Protection',
    'Resident Rewards',
    '2M+ Experiences',
    '2500+ PM Companies',
    'Moment Maker',
    'Extreme Ownership',
    'Resident Onboarding',
    'Second Nature',
    'Dallas',
    'Nashville',
  ];

  /* SNKO skyline city identifiers — each has a distinctive silhouette */
  const SKYLINE_CITIES = ['phoenix', 'neworleans', 'montreal', 'dallas', 'nashville'];

  /* --- Background state -------------------------------------- */
  let bgLayers = null; // initialised in initBackground()

  /* --- State ------------------------------------------------- */
  let heart, overlay;
  let gameOpen   = false;
  let canvas, ctx, rafId;
  let bird, pipes, clouds, score, bestScore, state; // 'idle' | 'play' | 'dead'
  let lastPipeTime, deadTime, frameTime;
  let globalTime = 0; // always-incrementing time for ambient animations

  /* --- Heart SVG for canvas drawing -------------------------- */
  const HEART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M16 1.88647C8.01418 1.88647 2 7.9574 2 15.9999C2 24.0425 8.01418 30.1134 16 30.1134C23.9858 30.1134 30 24.0425 30 15.9999C30 7.9574 23.9858 1.88647 16 1.88647ZM23.1773 16.851L16.5957 23.4326C16.2553 23.773 15.6879 23.773 15.3475 23.4326L8.9078 16.9929C7.33333 15.4184 7.06383 12.8794 8.42553 11.1205C10.0709 8.99286 13.1489 8.85101 14.9929 10.695L15.9716 11.6737L16.8511 10.7943C18.539 9.09215 21.3333 8.92194 23.078 10.5673C24.8794 12.2695 24.922 15.1063 23.1773 16.851Z" fill="FILL"/>
  </svg>`;

  let heartImg = null;

  function loadHeartImage(color) {
    return new Promise((resolve) => {
      const svg  = HEART_SVG.replace('FILL', color);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.src = url;
    });
  }

  /* --- Click Sequence --------------------------------------- */
  function init() {
    heart   = $('#easter-heart');
    overlay = $('#flappy-overlay');
    if (!heart || !overlay) return;

    bestScore = parseInt(localStorage.getItem('sn-flappy-best') || '0', 10);

    heart.addEventListener('click', onHeartClick);
  }

  let animating = false; // guard against clicks during animations

  function onHeartClick(e) {
    e.preventDefault();
    if (gameOpen || animating) return;

    // Single click triggers the full sequence: small jump → large jump → launch
    animating = true;
    animateJump('small', () => {
      animateJump('large', () => {
        launchSequence();
      });
    });
  }

  /* Animate a jump — calls onDone callback when finished */
  function animateJump(size, onDone) {
    const isSmall  = size === 'small';
    const apex     = isSmall ? -20  : -55;    // how high it goes
    const crouch   = isSmall ? 2    : 4;      // crouch depth
    const duration = isSmall ? 700  : 1000;   // total animation time (longer for clear settle)
    const sq       = isSmall ? 1.04 : 1.12;   // squish intensity
    const inv      = 2 - sq;                  // inverse squish

    const anim = heart.animate([
      { transform: 'translateY(0)   scale(1, 1)',         offset: 0 },
      { transform: `translateY(${crouch}px) scale(${sq}, ${inv})`, offset: 0.08 },   // crouch
      { transform: `translateY(${apex * 0.6}px) scale(${inv}, ${sq})`, offset: 0.25 },  // launch
      { transform: `translateY(${apex}px) scale(1, 1)`,   offset: 0.4 },              // apex — pause
      { transform: `translateY(${apex * 0.95}px) scale(1, 1)`, offset: 0.45 },        // hang
      { transform: `translateY(${apex * 0.5}px) scale(1, 1)`, offset: 0.58 },         // falling
      { transform: `translateY(0)   scale(${sq}, ${inv})`, offset: 0.72 },             // land squish
      { transform: `translateY(${isSmall ? -2 : -4}px) scale(0.98, 1.03)`, offset: 0.8 }, // micro rebound
      { transform: 'translateY(0)   scale(1, 1)',         offset: 0.88 },              // settle
      { transform: 'translateY(0)   scale(1, 1)',         offset: 1 },                 // hold — ready!
    ], { duration, easing: 'ease-in-out' });

    anim.onfinish = () => {
      if (onDone) {
        onDone();
      } else {
        animating = false;
      }
    };
  }

  /* Launch heart to center of viewport, then open modal */
  function launchSequence() {
    animating = true;
    const rect = heart.getBoundingClientRect();
    const cx   = window.innerWidth  / 2;
    const cy   = window.innerHeight / 2;
    const dx   = cx - (rect.left + rect.width / 2);
    const dy   = cy - (rect.top  + rect.height / 2);

    const anim = heart.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)',
        opacity: 1, offset: 0 },
      { transform: 'translate(0, 6px) scale(1.2, 0.8) rotate(0deg)',
        opacity: 1, offset: 0.08 },                                        // crouch
      { transform: `translate(${dx * 0.15}px, ${dy * 0.6}px) scale(1.8) rotate(-12deg)`,
        opacity: 1, offset: 0.35 },                                        // arc upward
      { transform: `translate(${dx * 0.7}px, ${dy * 0.85}px) scale(2.5) rotate(5deg)`,
        opacity: 1, offset: 0.6 },                                         // approaching center
      { transform: `translate(${dx}px, ${dy}px) scale(3.2) rotate(0deg)`,
        opacity: 0.85, offset: 0.8 },                                      // arrive
      { transform: `translate(${dx}px, ${dy}px) scale(4) rotate(0deg)`,
        opacity: 0, offset: 1 },                                           // fade out
    ], { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });

    anim.onfinish = () => {
      anim.cancel();
      animating = false;
      openGame();
    };
  }

  /* --- Modal ------------------------------------------------ */
  function openGame() {
    gameOpen = true;

    overlay.innerHTML = `
      <div class="flappy-modal">
        <div class="flappy-modal__header">
          <svg width="18" height="18" viewBox="0 0 32 32" style="flex-shrink:0">
            <path d="M16 1.88647C8.01418 1.88647 2 7.9574 2 15.9999C2 24.0425 8.01418 30.1134 16 30.1134C23.9858 30.1134 30 24.0425 30 15.9999C30 7.9574 23.9858 1.88647 16 1.88647ZM23.1773 16.851L16.5957 23.4326C16.2553 23.773 15.6879 23.773 15.3475 23.4326L8.9078 16.9929C7.33333 15.4184 7.06383 12.8794 8.42553 11.1205C10.0709 8.99286 13.1489 8.85101 14.9929 10.695L15.9716 11.6737L16.8511 10.7943C18.539 9.09215 21.3333 8.92194 23.078 10.5673C24.8794 12.2695 24.922 15.1063 23.1773 16.851Z" fill="${COLORS.magenta()}"/>
          </svg>
          <span>Flappy Nature</span>
          <span id="flappy-best" style="margin-left:auto;font-size:11px;opacity:0;font-weight:600;transition:opacity 0.3s ease;"></span>
          <button class="flappy-modal__close" aria-label="Close game" title="Close">&times;</button>
        </div>
        <div class="flappy-modal__body">
          <canvas id="flappy-canvas" width="${CFG.width}" height="${CFG.height}"></canvas>
          <!-- Title card popover — sits on top of the canvas -->
          <div id="flappy-title-card" class="flappy-title-card">
            <div class="flappy-title-card__icon">
              <svg width="48" height="48" viewBox="0 0 32 32">
                <path d="M16 1.88647C8.01418 1.88647 2 7.9574 2 15.9999C2 24.0425 8.01418 30.1134 16 30.1134C23.9858 30.1134 30 24.0425 30 15.9999C30 7.9574 23.9858 1.88647 16 1.88647ZM23.1773 16.851L16.5957 23.4326C16.2553 23.773 15.6879 23.773 15.3475 23.4326L8.9078 16.9929C7.33333 15.4184 7.06383 12.8794 8.42553 11.1205C10.0709 8.99286 13.1489 8.85101 14.9929 10.695L15.9716 11.6737L16.8511 10.7943C18.539 9.09215 21.3333 8.92194 23.078 10.5673C24.8794 12.2695 24.922 15.1063 23.1773 16.851Z" fill="${COLORS.violet()}"/>
              </svg>
            </div>
            <h2 class="flappy-title-card__title">Flappy Nature</h2>
            <p class="flappy-title-card__hint">Click, Space, or Enter to flap</p>
            ${bestScore > 0 ? `<p class="flappy-title-card__best">Best: ${bestScore}</p>` : ''}
            <button id="flappy-play-btn" class="flappy-title-card__play">Play</button>
          </div>
        </div>
        <div class="flappy-modal__footer">
          Made with &hearts; by the Finance Team
        </div>
      </div>`;

    overlay.classList.remove('hidden');
    // Force reflow, then fade in
    overlay.offsetHeight; // eslint-disable-line no-unused-expressions
    overlay.classList.add('visible');

    // Wire close
    overlay.querySelector('.flappy-modal__close').addEventListener('click', closeGame);
    overlay.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown);

    // Wire play button
    document.getElementById('flappy-play-btn').addEventListener('click', dismissTitleCard);

    // Focus the play button for accessibility
    document.getElementById('flappy-play-btn').focus();

    startGame();
  }

  function dismissTitleCard() {
    const card = document.getElementById('flappy-title-card');
    if (!card) return;
    card.classList.add('flappy-title-card--out');
    setTimeout(() => { card.remove(); }, 350);
    showHeaderBest();
    // Start actual gameplay
    flap();
  }

  function showHeaderBest() {
    const el = document.getElementById('flappy-best');
    if (!el) return;
    if (bestScore > 0) {
      el.textContent = 'Best: ' + bestScore;
    }
    el.style.opacity = '0.7';
  }

  function closeGame() {
    stopGame();
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      gameOpen = false;
    }, 300);
    document.removeEventListener('keydown', onKeyDown);
    overlay.removeEventListener('click', onBackdropClick);
  }

  function onBackdropClick(e) {
    if (e.target === overlay) closeGame();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { closeGame(); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flap();
    }
  }

  /* --- Game Engine ------------------------------------------- */
  async function startGame() {
    canvas = $('#flappy-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = CFG.width  * dpr;
    canvas.height = CFG.height * dpr;
    canvas.style.width  = CFG.width  + 'px';
    canvas.style.height = CFG.height + 'px';
    ctx.scale(dpr, dpr);

    heartImg = await loadHeartImage(COLORS.violet());
    initClouds();
    initBackground();
    resetGameState();

    canvas.addEventListener('click', flap);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); flap(); }, { passive: false });

    frameTime = performance.now();
    loop();
  }

  function stopGame() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (canvas) {
      canvas.removeEventListener('click', flap);
    }
  }

  function resetGameState() {
    bird  = { y: CFG.height / 2 - 30, vy: 0, rot: 0 };
    pipes = [];
    score = 0;
    state = 'idle';
    lastPipeTime = 0;
    deadTime     = 0;
  }

  function flap() {
    if (state === 'idle') {
      // Dismiss the HTML title card if still present
      const card = document.getElementById('flappy-title-card');
      if (card) {
        card.classList.add('flappy-title-card--out');
        setTimeout(() => { card.remove(); }, 350);
      }
      showHeaderBest();
      state = 'play';
      bird.vy = CFG.flapForce;
      lastPipeTime = performance.now();
    } else if (state === 'play') {
      bird.vy = CFG.flapForce;
    } else if (state === 'dead') {
      if (performance.now() - deadTime > CFG.resetDelay) {
        resetGameState();
        state = 'play';
        bird.vy = CFG.flapForce;
        lastPipeTime = performance.now();
      }
    }
  }

  /* --- Clouds ----------------------------------------------- */
  function initClouds() {
    clouds = [];
    for (let i = 0; i < CFG.cloudCount; i++) {
      clouds.push({
        x: Math.random() * CFG.width,
        y: 30 + Math.random() * (CFG.height * 0.35),
        w: 40 + Math.random() * 50,
        speed: 0.15 + Math.random() * 0.25,
      });
    }
  }

  /* ============================================================
     PARALLAX BACKGROUND — layered Second Nature themed scenery
     ============================================================ */

  function initBackground() {
    bgLayers = {
      farClouds:   [],
      skyline:     [],
      midClouds:   [],
      buildings:   [],
      trees:       [],
      planes:      [],
      groundDeco:  [],
    };

    const W = CFG.width;
    const H = CFG.height;
    const groundY = H - CFG.groundH;

    // --- Far clouds (big, slow, very faint) ---
    for (let i = 0; i < 3; i++) {
      bgLayers.farClouds.push({
        x: Math.random() * W * 1.5,
        y: 15 + Math.random() * 60,
        w: 70 + Math.random() * 80,
        speed: BG.farSpeed,
      });
    }

    // --- Skyline (distant city silhouette at horizon) ---
    let sx = -50;
    while (sx < W + BG.skylineSegW) {
      const city = SKYLINE_CITIES[Math.floor(Math.random() * SKYLINE_CITIES.length)];
      const seg = generateSkylineSegment(city, sx, groundY);
      bgLayers.skyline.push(seg);
      sx += seg.totalW;
    }

    // --- Mid-layer clouds ---
    for (let i = 0; i < 3; i++) {
      bgLayers.midClouds.push({
        x: Math.random() * W * 1.3,
        y: 60 + Math.random() * 100,
        w: 35 + Math.random() * 45,
        speed: BG.midSpeed,
      });
    }

    // --- Mid buildings (houses, apartments, properties) ---
    let bx = -30;
    while (bx < W + 80) {
      const w = BG.buildingMinW + Math.random() * (BG.buildingMaxW - BG.buildingMinW);
      const h = 30 + Math.random() * 60;
      const type = Math.random();
      bgLayers.buildings.push({
        x: bx,
        y: groundY - h,
        w: w,
        h: h,
        type: type < 0.4 ? 'house' : type < 0.7 ? 'apartment' : 'office',
        windows: Math.floor(Math.random() * 4) + 1,
        speed: BG.midSpeed,
      });
      bx += w + 15 + Math.random() * 40;
    }

    // --- Trees (between buildings) ---
    let tx = 10;
    while (tx < W + 40) {
      const w = BG.treeMinW + Math.random() * (BG.treeMaxW - BG.treeMinW);
      bgLayers.trees.push({
        x: tx,
        y: groundY,
        w: w,
        h: w * (1.5 + Math.random()),
        type: Math.random() < 0.3 ? 'pine' : 'round',
        speed: BG.nearSpeed,
      });
      tx += w + 20 + Math.random() * 50;
    }

    // --- Plane with banner (spawns off-screen right, flies left) ---
    spawnPlane();

    // --- Ground decoration (road markings, grass patches) ---
    let gx = 0;
    while (gx < W + 30) {
      bgLayers.groundDeco.push({
        x: gx,
        type: Math.random() < 0.5 ? 'dash' : 'dot',
        speed: BG.nearSpeed,
      });
      gx += 25 + Math.random() * 35;
    }
  }

  /* --- Skyline segment generators per city ------------------- */
  function generateSkylineSegment(city, startX, groundY) {
    const buildings = [];
    let cx = 0;
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const w = 12 + Math.random() * 22;
      let h;
      switch (city) {
        case 'phoenix':    h = 25 + Math.random() * 35; break; // lower desert skyline
        case 'neworleans': h = 20 + Math.random() * 30; break; // french quarter low-rise
        case 'montreal':   h = 35 + Math.random() * 50; break; // taller downtown
        case 'dallas':     h = 40 + Math.random() * 55; break; // big Texas skyscrapers
        case 'nashville':  h = 30 + Math.random() * 40; break; // moderate skyline
        default:           h = 25 + Math.random() * 40;
      }
      buildings.push({
        ox: cx, w, h,
        hasSpire: Math.random() < 0.2,
        hasDome:  city === 'montreal' && Math.random() < 0.15,
        hasCactus: city === 'phoenix' && Math.random() < 0.25,
      });
      cx += w + 2 + Math.random() * 6;
    }
    return {
      x: startX,
      groundY,
      city,
      buildings,
      totalW: cx,
      speed: BG.farSpeed,
    };
  }

  /* --- Plane spawner ----------------------------------------- */
  let nextPlaneTime = 0;
  function spawnPlane() {
    const bannerText = BANNER_TEXTS[Math.floor(Math.random() * BANNER_TEXTS.length)];
    const y = 15 + Math.random() * 70;
    const goingRight = Math.random() < 0.5;
    bgLayers.planes.push({
      x: goingRight ? -180 : CFG.width + 180,
      y,
      dir: goingRight ? 1 : -1,
      bannerText,
      bannerW: bannerText.length * 6.5 + 24,
      wobble: Math.random() * 1000,
      speed: BG.planeSpeed,
    });
    nextPlaneTime = performance.now() + 8000 + Math.random() * 15000;
  }


  /* --- Update all background layers -------------------------- */
  // isPlaying = true only during 'play' state
  // Clouds & planes always move (ambient life); ground layers freeze when not playing
  function updateBackground(dt, now, isPlaying) {
    const W = CFG.width;
    // Ambient speed factor: slower drift when idle/dead, full speed during play
    const ambientMul = isPlaying ? 1 : 0.35;

    // Far clouds — always move (ambient)
    for (const c of bgLayers.farClouds) {
      c.x -= c.speed * CFG.pipeSpeed * dt * ambientMul;
      if (c.x + c.w < -20) { c.x = W + 20 + Math.random() * 60; c.y = 15 + Math.random() * 60; }
    }

    // Mid clouds — always move (ambient)
    for (const c of bgLayers.midClouds) {
      c.x -= c.speed * CFG.pipeSpeed * dt * ambientMul;
      if (c.x + c.w < -20) { c.x = W + 20 + Math.random() * 40; c.y = 60 + Math.random() * 100; }
    }

    // Planes — always move (they fly independently of ground scroll)
    for (let i = bgLayers.planes.length - 1; i >= 0; i--) {
      const p = bgLayers.planes[i];
      p.x += p.dir * p.speed * CFG.pipeSpeed * dt * ambientMul;
      if ((p.dir > 0 && p.x > W + 250 + p.bannerW) || (p.dir < 0 && p.x < -250 - p.bannerW)) {
        bgLayers.planes.splice(i, 1);
      }
    }
    if (now > nextPlaneTime && bgLayers.planes.length < 2) {
      spawnPlane();
    }

    // === Everything below only scrolls during active play ===
    if (!isPlaying) return;

    // Skyline
    for (const seg of bgLayers.skyline) {
      seg.x -= seg.speed * CFG.pipeSpeed * dt;
      if (seg.x + seg.totalW < -20) {
        seg.x = Math.max(...bgLayers.skyline.map(s => s.x + s.totalW)) + 5;
        seg.city = SKYLINE_CITIES[Math.floor(Math.random() * SKYLINE_CITIES.length)];
      }
    }

    // Buildings
    for (const b of bgLayers.buildings) {
      b.x -= b.speed * CFG.pipeSpeed * dt;
      if (b.x + b.w < -20) {
        b.x = Math.max(...bgLayers.buildings.map(bb => bb.x + bb.w)) + 15 + Math.random() * 40;
        b.h = 30 + Math.random() * 60;
        b.y = (CFG.height - CFG.groundH) - b.h;
        b.type = Math.random() < 0.4 ? 'house' : Math.random() < 0.65 ? 'apartment' : 'office';
        b.windows = Math.floor(Math.random() * 4) + 1;
      }
    }

    // Trees
    for (const t of bgLayers.trees) {
      t.x -= t.speed * CFG.pipeSpeed * dt;
      if (t.x + t.w < -20) {
        t.x = Math.max(...bgLayers.trees.map(tt => tt.x + tt.w)) + 20 + Math.random() * 50;
        t.w = BG.treeMinW + Math.random() * (BG.treeMaxW - BG.treeMinW);
        t.h = t.w * (1.5 + Math.random());
        t.type = Math.random() < 0.3 ? 'pine' : 'round';
      }
    }

    // Ground deco
    for (const g of bgLayers.groundDeco) {
      g.x -= BG.nearSpeed * CFG.pipeSpeed * dt;
      if (g.x < -10) {
        g.x = Math.max(...bgLayers.groundDeco.map(gg => gg.x)) + 25 + Math.random() * 35;
      }
    }
  }

  /* --- Draw all background layers (called before pipes/bird) -- */
  function drawBackground() {
    if (!bgLayers) return;
    const navy = COLORS.navy();
    const violet = COLORS.violet();
    const cyan = COLORS.cyan();
    const magenta = COLORS.magenta();

    ctx.save();

    // Layer 0: Far clouds
    ctx.globalAlpha = BG.cloudFarAlpha;
    ctx.fillStyle = cyan;
    for (const c of bgLayers.farClouds) {
      drawCloud(c.x, c.y, c.w);
    }

    // Layer 1: Distant skyline
    ctx.globalAlpha = BG.skylineAlpha;
    ctx.fillStyle = navy;
    for (const seg of bgLayers.skyline) {
      drawSkylineSegment(seg);
    }

    // Layer 2: Mid clouds
    ctx.globalAlpha = BG.cloudMidAlpha;
    ctx.fillStyle = cyan;
    for (const c of bgLayers.midClouds) {
      drawCloud(c.x, c.y, c.w);
    }

    // Layer 3: Planes with banners
    for (const p of bgLayers.planes) {
      drawPlane(p, navy, magenta, violet);
    }

    // Layer 4: Buildings
    ctx.globalAlpha = BG.buildingAlpha;
    for (const b of bgLayers.buildings) {
      drawBuilding(b, navy, violet);
    }

    // Layer 5: Trees
    ctx.globalAlpha = BG.treeAlpha;
    for (const t of bgLayers.trees) {
      drawTree(t, navy, violet);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* --- Draw: skyline silhouette ------------------------------ */
  function drawSkylineSegment(seg) {
    for (const b of seg.buildings) {
      const x = seg.x + b.ox;
      const y = seg.groundY - b.h;
      ctx.fillRect(x, y, b.w, b.h);

      // Spire
      if (b.hasSpire) {
        ctx.beginPath();
        ctx.moveTo(x + b.w * 0.4, y);
        ctx.lineTo(x + b.w * 0.5, y - 12);
        ctx.lineTo(x + b.w * 0.6, y);
        ctx.fill();
      }
      // Dome (Montreal)
      if (b.hasDome) {
        ctx.beginPath();
        ctx.arc(x + b.w / 2, y, b.w * 0.35, Math.PI, 0);
        ctx.fill();
      }
      // Cactus (Phoenix)
      if (b.hasCactus) {
        const cx = x + b.w + 4;
        const cy = seg.groundY;
        ctx.fillRect(cx, cy - 18, 3, 18);
        ctx.fillRect(cx - 4, cy - 14, 4, 3);
        ctx.fillRect(cx + 3, cy - 11, 4, 3);
        ctx.fillRect(cx - 4, cy - 14, 3, -6);
        ctx.fillRect(cx + 4, cy - 11, 3, -5);
      }
    }
  }

  /* --- Draw: building ---------------------------------------- */
  function drawBuilding(b, navy, violet) {
    ctx.fillStyle = navy;
    const groundY = CFG.height - CFG.groundH;

    switch (b.type) {
      case 'house': {
        // Body
        ctx.fillRect(b.x, b.y + 8, b.w, b.h - 8);
        // Roof (triangle)
        ctx.beginPath();
        ctx.moveTo(b.x - 3, b.y + 8);
        ctx.lineTo(b.x + b.w / 2, b.y);
        ctx.lineTo(b.x + b.w + 3, b.y + 8);
        ctx.closePath();
        ctx.fill();
        // Door
        ctx.fillStyle = violet;
        const dw = b.w * 0.22;
        ctx.fillRect(b.x + (b.w - dw) / 2, groundY - 10, dw, 10);
        ctx.fillStyle = navy;
        // Windows
        if (b.windows >= 1) {
          const wy = b.y + 14;
          const ww = 4;
          const wh = 4;
          ctx.fillStyle = violet;
          ctx.fillRect(b.x + 4, wy, ww, wh);
          if (b.w > 30) ctx.fillRect(b.x + b.w - 8, wy, ww, wh);
          ctx.fillStyle = navy;
        }
        break;
      }
      case 'apartment': {
        ctx.fillRect(b.x, b.y, b.w, b.h);
        // Window grid
        ctx.fillStyle = violet;
        const cols = Math.max(2, Math.floor(b.w / 10));
        const rows = Math.max(2, Math.floor(b.h / 14));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillRect(
              b.x + 4 + c * ((b.w - 8) / cols),
              b.y + 5 + r * ((b.h - 10) / rows),
              3, 4
            );
          }
        }
        ctx.fillStyle = navy;
        break;
      }
      case 'office': {
        ctx.fillRect(b.x, b.y, b.w, b.h);
        // Antenna
        ctx.fillRect(b.x + b.w / 2 - 1, b.y - 8, 2, 8);
        // Horizontal stripes (floors)
        ctx.fillStyle = violet;
        const floors = Math.floor(b.h / 10);
        for (let f = 0; f < floors; f++) {
          ctx.fillRect(b.x + 2, b.y + 4 + f * 10, b.w - 4, 1);
        }
        ctx.fillStyle = navy;
        break;
      }
    }
  }

  /* --- Draw: tree -------------------------------------------- */
  function drawTree(t, navy, violet) {
    const cx = t.x + t.w / 2;
    // Trunk
    ctx.fillStyle = navy;
    ctx.fillRect(cx - 1.5, t.y - t.h * 0.4, 3, t.h * 0.4);

    if (t.type === 'pine') {
      // Triangle pine
      ctx.beginPath();
      ctx.moveTo(cx, t.y - t.h);
      ctx.lineTo(cx - t.w / 2, t.y - t.h * 0.3);
      ctx.lineTo(cx + t.w / 2, t.y - t.h * 0.3);
      ctx.closePath();
      ctx.fillStyle = violet;
      ctx.fill();
    } else {
      // Round canopy
      ctx.fillStyle = violet;
      ctx.beginPath();
      ctx.arc(cx, t.y - t.h * 0.55, t.w * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* --- Draw: plane with banner ------------------------------- */
  function drawPlane(p, navy, magenta, violet) {
    ctx.save();
    const wobbleY = Math.sin(globalTime * 0.0015 + p.wobble) * 3;
    const py = p.y + wobbleY;
    const dir = p.dir;   // +1 = flying right, -1 = flying left
    const px = p.x;

    // --- Banner trails BEHIND the plane ---
    const tailX    = px - 12 * dir;          // tail tip of plane
    const ropeLen  = 18;                     // rope gap between tail and banner
    const bannerX  = tailX - ropeLen * dir;  // where rope meets banner edge
    const bw       = p.bannerW;
    const bh       = 16;
    // Banner extends further behind the plane from the connection point
    const bLeft    = dir > 0 ? bannerX - bw : bannerX;
    const bTop     = py - bh / 2;

    // Rope from tail to banner
    ctx.strokeStyle = navy;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = BG.bannerAlpha * 0.6;
    ctx.beginPath();
    ctx.moveTo(tailX, py);
    ctx.lineTo(dir > 0 ? bLeft + bw : bLeft, py);
    ctx.stroke();

    // Banner rectangle — more visible
    ctx.globalAlpha = BG.bannerAlpha;
    ctx.fillStyle = magenta;
    roundRectPath(bLeft, bTop, bw, bh, 3);
    ctx.fill();

    // Banner text — full opacity relative to the banner so it's legible
    ctx.globalAlpha = BG.bannerAlpha + 0.15; // text slightly more opaque than bg
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 9px ${FONT_HEADING()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.bannerText, bLeft + bw / 2, bTop + bh / 2 + 0.5);

    // --- Plane body (drawn on top of rope/banner) ---
    ctx.globalAlpha = BG.planeAlpha;
    ctx.fillStyle = navy;

    // Fuselage
    ctx.beginPath();
    ctx.ellipse(px, py, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose cone
    ctx.beginPath();
    ctx.moveTo(px + 12 * dir, py);
    ctx.lineTo(px + 17 * dir, py - 1.5);
    ctx.lineTo(px + 17 * dir, py + 1.5);
    ctx.closePath();
    ctx.fill();

    // Wings — sweep backward
    ctx.beginPath();
    ctx.moveTo(px + 3 * dir, py);
    ctx.lineTo(px - 4 * dir, py - 9);
    ctx.lineTo(px - 8 * dir, py - 8);
    ctx.lineTo(px - 2 * dir, py);
    ctx.closePath();
    ctx.fill();

    // Tail fin
    ctx.beginPath();
    ctx.moveTo(px - 10 * dir, py - 1);
    ctx.lineTo(px - 14 * dir, py - 7);
    ctx.lineTo(px - 12 * dir, py);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /* Helper for plane banner rounded rect (doesn't call fill) */
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }


  /* --- Draw: ground decorations ------------------------------ */
  function drawGroundDeco() {
    if (!bgLayers) return;
    const groundY = CFG.height - CFG.groundH;
    ctx.save();
    ctx.globalAlpha = 0.15;

    for (const g of bgLayers.groundDeco) {
      if (g.type === 'dash') {
        // Road-style dash
        ctx.fillStyle = COLORS.cyan();
        ctx.fillRect(g.x, groundY + CFG.groundH / 2 - 1, 8, 2);
      } else {
        // Small dot/rivet
        ctx.fillStyle = COLORS.magenta();
        ctx.beginPath();
        ctx.arc(g.x, groundY + CFG.groundH * 0.7, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* --- Main loop -------------------------------------------- */
  function loop() {
    const now = performance.now();
    const dt  = Math.min((now - frameTime) / 16.667, 3); // normalize to ~60fps, cap
    frameTime = now;

    update(dt, now);
    draw();

    rafId = requestAnimationFrame(loop);
  }

  function update(dt, now) {
    globalTime = now;

    // Clouds always drift
    for (const c of clouds) {
      c.x -= c.speed * dt;
      if (c.x + c.w < 0) { c.x = CFG.width + 10; c.y = 30 + Math.random() * (CFG.height * 0.35); }
    }

    // Background layers: clouds & planes always move; ground stuff only during play
    if (bgLayers) updateBackground(dt, now, state === 'play');

    if (state === 'idle' || state === 'dead') return;

    // Bird physics
    bird.vy  += CFG.gravity * dt;
    bird.y   += bird.vy * dt;
    bird.rot  = Math.max(-25, Math.min(70, bird.vy * 4));

    // Ceiling clamp
    if (bird.y < 0) { bird.y = 0; bird.vy = 0; }

    // Ground collision
    if (bird.y + CFG.birdSize > CFG.height - CFG.groundH) {
      die();
      return;
    }

    // Spawn pipes
    if (now - lastPipeTime > CFG.pipeSpawn) {
      const minTop = 60;
      const maxTop = CFG.height - CFG.groundH - CFG.pipeGap - 60;
      const topH   = minTop + Math.random() * (maxTop - minTop);
      pipes.push({ x: CFG.width, topH, scored: false });
      lastPipeTime = now;
    }

    // Move & collide pipes
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= CFG.pipeSpeed * dt;

      // Remove off-screen
      if (p.x + CFG.pipeWidth < 0) { pipes.splice(i, 1); continue; }

      // Score
      if (!p.scored && p.x + CFG.pipeWidth < CFG.birdX) {
        p.scored = true;
        score++;
      }

      // Collision
      const bx = CFG.birdX;
      const by = bird.y;
      const bs = CFG.birdSize;
      if (bx + bs > p.x && bx < p.x + CFG.pipeWidth) {
        if (by < p.topH || by + bs > p.topH + CFG.pipeGap) {
          die();
          return;
        }
      }
    }
  }

  function die() {
    state    = 'dead';
    deadTime = performance.now();
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('sn-flappy-best', String(bestScore));
      updateHeaderBest();
    }
  }

  function updateHeaderBest() {
    const el = document.getElementById('flappy-best');
    if (!el) return;
    el.textContent = bestScore > 0 ? 'Best: ' + bestScore : '';
    el.style.opacity = '0.7';
  }

  /* --- Draw ------------------------------------------------- */
  function draw() {
    const W = CFG.width;
    const H = CFG.height;

    // Sky gradient — slightly warmer to give the city a "golden hour" feel
    const sky = ctx.createLinearGradient(0, 0, 0, H - CFG.groundH);
    sky.addColorStop(0, COLORS.light());
    sky.addColorStop(0.6, COLORS.white());
    sky.addColorStop(1, '#F5F0F8'); // very faint lavender at horizon
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // === PARALLAX BACKGROUND (behind clouds & pipes) ===
    drawBackground();

    // Near clouds (original layer — slightly more opaque than BG clouds)
    ctx.fillStyle = COLORS.cyan();
    ctx.globalAlpha = 0.12;
    for (const c of clouds) {
      drawCloud(c.x, c.y, c.w);
    }
    ctx.globalAlpha = 1;

    // Pipes
    for (const p of pipes) {
      drawPipe(p);
    }

    // Ground
    ctx.fillStyle = COLORS.navy();
    ctx.fillRect(0, H - CFG.groundH, W, CFG.groundH);

    // Ground decorations (road dashes, dots)
    drawGroundDeco();

    // Ground accent line
    const accent = ctx.createLinearGradient(0, 0, W, 0);
    accent.addColorStop(0, COLORS.magenta());
    accent.addColorStop(1, COLORS.cyan());
    ctx.fillStyle = accent;
    ctx.fillRect(0, H - CFG.groundH, W, 3);

    // Bird — only visible during play & dead, not on the idle title screen
    if (state !== 'idle') drawBird();

    // Score
    drawScore();

    // Overlays
    if (state === 'dead') drawDeadScreen();
  }

  function drawCloud(x, y, w) {
    const h = w * 0.45;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.35, y + h * 0.6, w * 0.35, h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + w * 0.65, y + h * 0.5, w * 0.3, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h * 0.35, w * 0.25, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPipe(p) {
    const r  = 8; // corner radius
    const W  = CFG.pipeWidth;
    const gT = p.topH;
    const gB = p.topH + CFG.pipeGap;

    // Top pipe
    const tGrad = ctx.createLinearGradient(p.x, 0, p.x + W, 0);
    tGrad.addColorStop(0, COLORS.navy());
    tGrad.addColorStop(1, COLORS.midviolet());
    ctx.fillStyle = tGrad;
    roundRect(p.x, -4, W, gT + 4, r);

    // Lip on top pipe
    ctx.fillStyle = COLORS.violet();
    roundRect(p.x - 4, gT - 20, W + 8, 20, r);

    // Bottom pipe
    const bGrad = ctx.createLinearGradient(p.x, 0, p.x + W, 0);
    bGrad.addColorStop(0, COLORS.navy());
    bGrad.addColorStop(1, COLORS.midviolet());
    ctx.fillStyle = bGrad;
    roundRect(p.x, gB, W, CFG.height - gB, r);

    // Lip on bottom pipe
    ctx.fillStyle = COLORS.violet();
    roundRect(p.x - 4, gB, W + 8, 20, r);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawBird() {
    ctx.save();
    ctx.translate(CFG.birdX + CFG.birdSize / 2, bird.y + CFG.birdSize / 2);
    ctx.rotate((bird.rot * Math.PI) / 180);

    if (heartImg) {
      ctx.drawImage(heartImg, -CFG.birdSize / 2, -CFG.birdSize / 2, CFG.birdSize, CFG.birdSize);
    } else {
      // Fallback circle
      ctx.fillStyle = COLORS.violet();
      ctx.beginPath();
      ctx.arc(0, 0, CFG.birdSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScore() {
    if (state === 'idle') return;

    ctx.save();
    ctx.font = `800 32px ${FONT_HEADING()}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.navy();
    ctx.globalAlpha = 0.12;
    ctx.fillText(score, CFG.width / 2 + 2, 52);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.magenta();
    ctx.fillText(score, CFG.width / 2, 50);
    ctx.restore();
  }

  function drawDeadScreen() {
    ctx.save();

    // Dim overlay
    ctx.fillStyle = 'rgba(9, 9, 73, 0.45)';
    ctx.fillRect(0, 0, CFG.width, CFG.height);

    // Game Over card
    const cardW = 220;
    const cardH = 150;
    const cx    = (CFG.width  - cardW) / 2;
    const cy    = (CFG.height - cardH) / 2 - 15;
    ctx.fillStyle = COLORS.white();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur  = 20;
    roundRect(cx, cy, cardW, cardH, 16);
    ctx.shadowBlur = 0;

    ctx.font = `800 20px ${FONT_HEADING()}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.navy();
    ctx.fillText('Game Over', CFG.width / 2, cy + 38);

    ctx.font = `700 14px ${FONT_HEADING()}`;
    ctx.fillStyle = COLORS.violet();
    ctx.fillText(`Score: ${score}`, CFG.width / 2, cy + 68);

    ctx.fillStyle = COLORS.magenta();
    ctx.fillText(`Best: ${bestScore}`, CFG.width / 2, cy + 90);

    ctx.font = `600 12px ${FONT_HEADING()}`;
    ctx.fillStyle = COLORS.navy();
    ctx.globalAlpha = 0.5;
    ctx.fillText('Tap to try again', CFG.width / 2, cy + 128);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  /* --- Boot ------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
