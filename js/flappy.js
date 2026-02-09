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
  // Logical (design) dimensions — game physics stay constant.
  // The canvas CSS size scales to fit the container.
  const BASE_W = 380;
  const BASE_H = 520;

  const CFG = {
    width:       BASE_W,
    height:      BASE_H,
    // Physics defaults (overridden by difficulty presets)
    gravity:     0.28,
    flapForce:  -5.0,
    terminalVel: 5.5,
    pipeWidth:   52,
    pipeGap:     162,
    pipeSpeed:   2.2,
    pipeSpawn:   1700,
    hitboxPad:   5,
    // Fixed layout
    groundH:     50,
    birdSize:    28,
    birdX:       70,
    cloudCount:  4,
    resetDelay:  600,
  };

  /* --- Difficulty presets ------------------------------------ */
  const DIFFICULTY = {
    easy:   { gravity: 0.22, flapForce: -4.6, terminalVel: 4.8, pipeGap: 180, pipeSpeed: 1.9, pipeSpawn: 1900, hitboxPad: 7 },
    normal: { gravity: 0.28, flapForce: -5.0, terminalVel: 5.5, pipeGap: 162, pipeSpeed: 2.2, pipeSpawn: 1700, hitboxPad: 5 },
    hard:   { gravity: 0.38, flapForce: -6.0, terminalVel: 7.0, pipeGap: 138, pipeSpeed: 2.6, pipeSpawn: 1450, hitboxPad: 2 },
  };
  const DIFF_KEYS = ['easy', 'normal', 'hard'];
  const DIFF_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  let currentDifficulty = localStorage.getItem('sn-flappy-diff') || 'normal';

  function applyDifficulty(key) {
    const d = DIFFICULTY[key];
    if (!d) return;
    currentDifficulty = key;
    CFG.gravity     = d.gravity;
    CFG.flapForce   = d.flapForce;
    CFG.terminalVel = d.terminalVel;
    CFG.pipeGap     = d.pipeGap;
    CFG.pipeSpeed   = d.pipeSpeed;
    CFG.pipeSpawn   = d.pipeSpawn;
    CFG.hitboxPad   = d.hitboxPad;
    localStorage.setItem('sn-flappy-diff', key);
    // Update header badge in real-time
    updateHeader();
  }

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
  // Loaded from data/banners.json at game start; inline fallback if fetch fails.
  let BANNER_TEXTS = [
    'Triple Win!', 'SNKO 2026', 'Second Nature', 'Resident Benefits',
    'Credit Building', 'Grow the Pie', 'Moment Maker', 'Extreme Ownership',
  ];

  async function loadBannerTexts() {
    try {
      const resp = await fetch('data/banners.json');
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json) && json.length > 0) BANNER_TEXTS = json;
      }
    } catch (_) { /* keep fallback */ }
  }

  /* SNKO skyline city identifiers — each has a distinctive silhouette */
  const SKYLINE_CITIES = ['phoenix', 'neworleans', 'montreal', 'dallas', 'nashville'];

  /* --- Background state -------------------------------------- */
  let bgLayers = null; // initialised in initBackground()

  /* --- Performance: cached values (populated once in startGame) --- */
  let CC = null;   // cached colors  – plain string map, avoids getComputedStyle per frame
  let CF = '';     // cached font    – heading font string
  let FONTS = null; // cached font strings – avoids template literal allocation per frame
  let skyGrad    = null;  // cached sky gradient
  let accentGrad = null;  // cached ground-accent gradient
  let pipeGrad   = null;  // cached pipe body gradient (translated per pipe)

  /** Return max of fn(item) across arr without allocating a temporary array. */
  function maxOf(arr, fn) {
    let m = -Infinity;
    for (let i = 0, len = arr.length; i < len; i++) {
      const v = fn(arr[i]);
      if (v > m) m = v;
    }
    return m;
  }

  /* --- State ------------------------------------------------- */
  let heart, overlay;
  let gameOpen   = false;
  let hasPlayedOnce = false; // true after the first flap — keeps header diff btn visible on reset
  let canvas, ctx, rafId;
  let bird, pipes, clouds, score, state; // 'idle' | 'play' | 'dead' | 'paused'
  let lastPipeTime, deadTime, frameTime;
  let globalTime = 0; // always-incrementing time for ambient animations
  let pausedTime = 0; // timestamp when we paused (to fix pipe-spawn drift)
  let prevStateBeforePause = null; // state before pause (so we resume correctly)

  /* --- Per-difficulty best scores ----------------------------- */
  // Stored as JSON: { easy: 0, normal: 0, hard: 0 }
  const BEST_STORAGE_KEY = 'sn-flappy-best-v2';
  let bestScores = { easy: 0, normal: 0, hard: 0 };

  function loadBestScores() {
    try {
      const raw = localStorage.getItem(BEST_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of DIFF_KEYS) {
          if (typeof parsed[k] === 'number' && parsed[k] > 0) bestScores[k] = parsed[k];
        }
      }
      // Migrate old single-score key if v2 doesn't exist yet
      if (!raw) {
        const old = parseInt(localStorage.getItem('sn-flappy-best') || '0', 10);
        if (old > 0) {
          bestScores.normal = old;
          saveBestScores();
          localStorage.removeItem('sn-flappy-best');
        }
      }
    } catch (_) { /* keep defaults */ }
  }

  function saveBestScores() {
    localStorage.setItem(BEST_STORAGE_KEY, JSON.stringify(bestScores));
  }

  /** Shorthand: best score for the current difficulty */
  function bestScore() {
    return bestScores[currentDifficulty] || 0;
  }

  /* --- Settings heart button (top-right of canvas) ----------- */
  const SETTINGS_BTN = {
    size:  22,       // heart icon drawn at this size
    pad:   10,       // padding from canvas edges
    hoverR: 18,      // hit-test radius (generous for touch)
  };
  let settingsHover  = false;  // is the mouse over the settings heart?
  let settingsOpen   = false;  // is the difficulty picker visible?
  let mouseX = -1, mouseY = -1; // canvas-local mouse coords (for hover)
  let _currentCursor = '';      // tracks last cursor value to avoid redundant DOM writes
  let _cachedDiffLayout = null; // cached diffPickerLayout — computed once in openDiffPicker

  /* --- In-game controls hint (fades after a few seconds) ----- */
  let hintStartTime = 0;       // set when gameplay begins
  const HINT_DURATION = 3500;  // total visible time (ms)
  const HINT_FADE     = 1200;  // fade-out portion at end (ms)

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

    loadBestScores();

    heart.addEventListener('click', onHeartClick);
    // Keyboard support for accessibility (role="button" + tabindex="0")
    heart.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onHeartClick(e);
      }
    });
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
          <button id="flappy-diff-btn" class="flappy-header-diff" title="Change difficulty" style="display:none"></button>
          <span id="flappy-best" class="flappy-header-best"></span>
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
            <p class="flappy-title-card__hint">
              <kbd class="flappy-kbd">Space</kbd>
              <kbd class="flappy-kbd">Click</kbd>
              <span class="flappy-hint-label">to flap</span>
            </p>
            ${bestScore() > 0 ? `<p class="flappy-title-card__best">Best: ${bestScore()}</p>` : ''}
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

    // Wire header difficulty button — opens the canvas picker
    document.getElementById('flappy-diff-btn').addEventListener('click', onHeaderDiffClick);

    // Focus the play button for accessibility
    document.getElementById('flappy-play-btn').focus();

    startGame();
  }

  function dismissTitleCard() {
    const card = document.getElementById('flappy-title-card');
    if (!card) return;
    card.classList.add('flappy-title-card--out');
    setTimeout(() => { card.remove(); }, 350);
    // Start actual gameplay — flap() transitions from idle→play and calls updateHeader()
    flap();
  }

  /** Update both header elements (difficulty badge + best score) to reflect current state.
   *  The difficulty button stays hidden until the game leaves 'idle' (title card dismissed). */
  function updateHeader() {
    const diffBtn = document.getElementById('flappy-diff-btn');
    const bestEl  = document.getElementById('flappy-best');
    const best    = bestScore();
    if (diffBtn) {
      diffBtn.textContent = DIFF_LABELS[currentDifficulty] || 'Normal';
      // Show the header difficulty button once the player has started at least once
      const showDiff = hasPlayedOnce || (state && state !== 'idle');
      diffBtn.style.display = showDiff ? '' : 'none';
      diffBtn.style.opacity = '1';
    }
    if (bestEl) {
      bestEl.textContent = best > 0 ? 'Best: ' + best : '';
      bestEl.style.opacity = best > 0 ? '0.7' : '0';
    }
  }

  /** Clicking the header difficulty badge toggles the canvas picker (always pauses) */
  function onHeaderDiffClick(e) {
    e.stopPropagation(); // don't bubble to backdrop close
    if (state === 'idle' && !hasPlayedOnce) return; // ignore clicks before first play
    if (settingsOpen) {
      closeDiffPicker();
    } else {
      openDiffPicker();
    }
  }

  function closeGame() {
    stopGame();
    hasPlayedOnce = false;
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
    if (e.key === 'Escape') {
      if (settingsOpen) { closeDiffPicker(); return; }
      closeGame();
      return;
    }
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

    // Load banner texts from JSON (non-blocking — fallback is already in place)
    loadBannerTexts();

    // --- Cache all CSS design tokens ONCE (avoids getComputedStyle per frame) ---
    CC = {
      navy:      COLORS.navy(),
      violet:    COLORS.violet(),
      cyan:      COLORS.cyan(),
      magenta:   COLORS.magenta(),
      light:     COLORS.light(),
      white:     COLORS.white(),
      midviolet: COLORS.midviolet(),
    };
    CF = FONT_HEADING();

    // Pre-compute all font strings once (avoids template literal alloc per frame)
    FONTS = {
      banner:   `800 9px ${CF}`,
      score:    `800 32px ${CF}`,
      hint:     `600 11px ${CF}`,
      diffTitle:`800 12px ${CF}`,
      diffBtn:  `700 11px ${CF}`,
      diffBest: `600 9px ${CF}`,
      deadTitle:`800 20px ${CF}`,
      deadScore:`700 14px ${CF}`,
      deadRetry:`600 12px ${CF}`,
    };

    // Responsive: compute display size to fit within the viewport
    const maxCssW = Math.min(BASE_W, window.innerWidth - 48);
    const cssScale = maxCssW / BASE_W;
    const cssW = Math.round(BASE_W * cssScale);
    const cssH = Math.round(BASE_H * cssScale);

    // HiDPI: backing store uses logical game dimensions * dpr
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = BASE_W * dpr;
    canvas.height = BASE_H * dpr;
    // CSS display size scales to fit container
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.scale(dpr, dpr);

    // --- Build reusable gradients (coordinates are constant) ---
    skyGrad = ctx.createLinearGradient(0, 0, 0, CFG.height - CFG.groundH);
    skyGrad.addColorStop(0, CC.light);
    skyGrad.addColorStop(0.6, CC.white);
    skyGrad.addColorStop(1, '#F5F0F8');

    accentGrad = ctx.createLinearGradient(0, 0, CFG.width, 0);
    accentGrad.addColorStop(0, CC.magenta);
    accentGrad.addColorStop(1, CC.cyan);

    // Pipe gradient at origin — translated per-pipe via ctx.translate
    pipeGrad = ctx.createLinearGradient(0, 0, CFG.pipeWidth, 0);
    pipeGrad.addColorStop(0, CC.navy);
    pipeGrad.addColorStop(1, CC.midviolet);

    heartImg = await loadHeartImage(CC.violet);
    initClouds();
    initBackground();
    applyDifficulty(currentDifficulty); // load saved (or default) difficulty
    resetGameState();

    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseleave', () => { mouseX = mouseY = -1; settingsHover = false; });

    frameTime = performance.now();
    accumulator = 0;   // reset fixed-timestep accumulator
    loop();
  }

  function stopGame() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (canvas) {
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('mousemove', onCanvasMouseMove);
    }
    settingsOpen = false;
    prevStateBeforePause = null;
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
    if (state === 'paused') return; // don't flap while picker is open
    if (state === 'idle') {
      // Dismiss the HTML title card if still present
      const card = document.getElementById('flappy-title-card');
      if (card) {
        card.classList.add('flappy-title-card--out');
        setTimeout(() => { card.remove(); }, 350);
      }
      state = 'play';
      hasPlayedOnce = true;
      updateHeader();
      bird.vy = CFG.flapForce;
      lastPipeTime = performance.now();
      hintStartTime = performance.now();
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

  /* --- Canvas interaction routing ----------------------------- */
  // Convert a DOM mouse/touch event to canvas-local coordinates
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CFG.width  / rect.width;
    const scaleY = CFG.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  // Settings heart center (top-right)
  function settingsBtnCenter() {
    return {
      x: CFG.width  - SETTINGS_BTN.pad - SETTINGS_BTN.size / 2,
      y: SETTINGS_BTN.pad + SETTINGS_BTN.size / 2,
    };
  }

  function isInsideSettingsBtn(cx, cy) {
    const c = settingsBtnCenter();
    const dx = cx - c.x, dy = cy - c.y;
    return dx * dx + dy * dy <= SETTINGS_BTN.hoverR * SETTINGS_BTN.hoverR;
  }

  // Difficulty picker button hit-test — returns the key ('easy'|'normal'|'hard') or null
  function hitTestDiffPicker(cx, cy) {
    if (!settingsOpen) return null;
    const card = _cachedDiffLayout || diffPickerLayout();
    for (let i = 0; i < DIFF_KEYS.length; i++) {
      const btn = card.buttons[i];
      if (cx >= btn.x && cx <= btn.x + btn.w && cy >= btn.y && cy <= btn.y + btn.h) {
        return DIFF_KEYS[i];
      }
    }
    return null;
  }

  // Layout for the difficulty picker card (centered, just below the settings heart)
  function diffPickerLayout() {
    const cardW = 150, cardH = 130, btnH = 28, btnGap = 6, btnPadX = 14, topPad = 32;
    const sc = settingsBtnCenter();
    const cx = Math.min(sc.x - cardW / 2, CFG.width - cardW - 6);
    const cy = sc.y + SETTINGS_BTN.size / 2 + 8;
    const buttons = [];
    for (let i = 0; i < DIFF_KEYS.length; i++) {
      buttons.push({
        x: cx + btnPadX,
        y: cy + topPad + i * (btnH + btnGap),
        w: cardW - btnPadX * 2,
        h: btnH,
        key: DIFF_KEYS[i],
      });
    }
    return { x: cx, y: cy, w: cardW, h: cardH, buttons };
  }

  function onCanvasClick(e) {
    const p = canvasCoords(e);

    // If difficulty picker is open, check button hits first
    if (settingsOpen) {
      const key = hitTestDiffPicker(p.x, p.y);
      if (key) {
        changeDifficulty(key);
        return;
      }
      // Clicking outside the picker closes it and resumes
      closeDiffPicker();
      return;
    }

    // Settings heart click — toggle pause + picker
    if (isInsideSettingsBtn(p.x, p.y) && state !== 'idle') {
      openDiffPicker();
      return;
    }

    // Normal flap
    flap();
  }

  function onCanvasTouchStart(e) {
    e.preventDefault();
    const p = canvasCoords(e);

    if (settingsOpen) {
      const key = hitTestDiffPicker(p.x, p.y);
      if (key) {
        changeDifficulty(key);
        return;
      }
      closeDiffPicker();
      return;
    }

    if (isInsideSettingsBtn(p.x, p.y) && state !== 'idle') {
      openDiffPicker();
      return;
    }

    flap();
  }

  function onCanvasMouseMove(e) {
    const p = canvasCoords(e);
    mouseX = p.x;
    mouseY = p.y;
    settingsHover = isInsideSettingsBtn(p.x, p.y);
    // Update cursor style (only when changed to avoid DOM style recalc)
    if (canvas) {
      const overPicker = settingsOpen && hitTestDiffPicker(p.x, p.y);
      const desired = (settingsHover || overPicker) ? 'pointer' : 'default';
      if (desired !== _currentCursor) {
        _currentCursor = desired;
        canvas.style.cursor = desired;
      }
    }
  }

  function openDiffPicker() {
    // Remember the state we came from so we can resume correctly
    if (state === 'play') {
      prevStateBeforePause = 'play';
      pausedTime = performance.now();
      state = 'paused';
    } else {
      prevStateBeforePause = state; // 'idle', 'dead', etc.
    }
    settingsOpen = true;
    _cachedDiffLayout = diffPickerLayout();
  }

  function closeDiffPicker() {
    settingsOpen = false;
    _cachedDiffLayout = null;
    if (state === 'paused' && prevStateBeforePause === 'play') {
      // Resume play — adjust lastPipeTime so pipe spawn doesn't fire immediately
      const elapsed = performance.now() - pausedTime;
      lastPipeTime += elapsed;
      frameTime = performance.now();
      accumulator = 0;
      state = 'play';
    }
    prevStateBeforePause = null;
  }

  /** Apply difficulty AND reset the game if changing mid-run */
  function changeDifficulty(key) {
    if (key === currentDifficulty) {
      // Same difficulty — just close picker, resume
      closeDiffPicker();
      return;
    }
    // Different difficulty — apply and reset
    applyDifficulty(key);
    resetGameState();
    // Close picker without resuming (we're now in 'idle')
    settingsOpen = false;
    _cachedDiffLayout = null;
    prevStateBeforePause = null;
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

    // --- Pre-compute maxRight edge trackers (avoids O(n^2) maxOf scans) ---
    bgLayers.maxRightSkyline   = maxOf(bgLayers.skyline,    s  => s.x + s.totalW);
    bgLayers.maxRightBuildings = maxOf(bgLayers.buildings,   bb => bb.x + bb.w);
    bgLayers.maxRightTrees     = maxOf(bgLayers.trees,       tt => tt.x + tt.w);
    bgLayers.maxRightGroundDeco = maxOf(bgLayers.groundDeco, gg => gg.x);
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
  // Altitude bands keep concurrent planes well-separated.
  // The full range is 12–160 (much wider than the old 15–85).
  const PLANE_ALT_MIN     = 12;
  const PLANE_ALT_MAX     = 160;
  const PLANE_ALT_SEP     = 45;   // minimum vertical gap between concurrent planes

  let nextPlaneTime = 0;
  function spawnPlane() {
    const bannerText = BANNER_TEXTS[Math.floor(Math.random() * BANNER_TEXTS.length)];

    // Pick a y that's at least PLANE_ALT_SEP away from every existing plane
    let y, attempts = 0;
    do {
      y = PLANE_ALT_MIN + Math.random() * (PLANE_ALT_MAX - PLANE_ALT_MIN);
      attempts++;
    } while (
      attempts < 20 &&
      bgLayers.planes.some(p => Math.abs(p.y - y) < PLANE_ALT_SEP)
    );

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
        // Swap-and-pop: O(1) removal (draw order doesn't matter for planes)
        const last = bgLayers.planes.length - 1;
        if (i !== last) bgLayers.planes[i] = bgLayers.planes[last];
        bgLayers.planes.pop();
      }
    }
    if (now > nextPlaneTime && bgLayers.planes.length < 2) {
      spawnPlane();
    }

    // === Everything below only scrolls during active play ===
    if (!isPlaying) return;

    // Shift maxRight trackers in lockstep with their layer speed
    const skyShift  = BG.farSpeed  * CFG.pipeSpeed * dt;
    const midShift  = BG.midSpeed  * CFG.pipeSpeed * dt;
    const nearShift = BG.nearSpeed * CFG.pipeSpeed * dt;
    bgLayers.maxRightSkyline    -= skyShift;
    bgLayers.maxRightBuildings  -= midShift;
    bgLayers.maxRightTrees      -= nearShift;
    bgLayers.maxRightGroundDeco -= nearShift;

    // Skyline
    for (const seg of bgLayers.skyline) {
      seg.x -= skyShift;
      if (seg.x + seg.totalW < -20) {
        const gap = 5;
        seg.x = bgLayers.maxRightSkyline + gap;
        bgLayers.maxRightSkyline = seg.x + seg.totalW;
        seg.city = SKYLINE_CITIES[Math.floor(Math.random() * SKYLINE_CITIES.length)];
      }
    }

    // Buildings
    for (const b of bgLayers.buildings) {
      b.x -= midShift;
      if (b.x + b.w < -20) {
        const gap = 15 + Math.random() * 40;
        b.x = bgLayers.maxRightBuildings + gap;
        b.h = 30 + Math.random() * 60;
        b.y = (CFG.height - CFG.groundH) - b.h;
        b.type = Math.random() < 0.4 ? 'house' : Math.random() < 0.65 ? 'apartment' : 'office';
        b.windows = Math.floor(Math.random() * 4) + 1;
        bgLayers.maxRightBuildings = b.x + b.w;
      }
    }

    // Trees
    for (const t of bgLayers.trees) {
      t.x -= nearShift;
      if (t.x + t.w < -20) {
        const gap = 20 + Math.random() * 50;
        t.x = bgLayers.maxRightTrees + gap;
        t.w = BG.treeMinW + Math.random() * (BG.treeMaxW - BG.treeMinW);
        t.h = t.w * (1.5 + Math.random());
        t.type = Math.random() < 0.3 ? 'pine' : 'round';
        bgLayers.maxRightTrees = t.x + t.w;
      }
    }

    // Ground deco
    for (const g of bgLayers.groundDeco) {
      g.x -= nearShift;
      if (g.x < -10) {
        const gap = 25 + Math.random() * 35;
        g.x = bgLayers.maxRightGroundDeco + gap;
        bgLayers.maxRightGroundDeco = g.x;
      }
    }
  }

  /* --- Draw all background layers (called before pipes/bird) -- */
  function drawBackground() {
    if (!bgLayers) return;
    const navy = CC.navy;
    const violet = CC.violet;
    const cyan = CC.cyan;
    const magenta = CC.magenta;

    // Layer 0: Far clouds (batched single fill)
    ctx.globalAlpha = BG.cloudFarAlpha;
    ctx.fillStyle = cyan;
    drawCloudsBatched(bgLayers.farClouds);

    // Layer 1: Distant skyline
    ctx.globalAlpha = BG.skylineAlpha;
    ctx.fillStyle = navy;
    for (const seg of bgLayers.skyline) {
      drawSkylineSegment(seg);
    }

    // Layer 2: Mid clouds (batched single fill)
    ctx.globalAlpha = BG.cloudMidAlpha;
    ctx.fillStyle = cyan;
    drawCloudsBatched(bgLayers.midClouds);

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
    ctx.font = FONTS.banner;
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

    // Reset state changed by drawPlane (globalAlpha, textBaseline, lineWidth)
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
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
    ctx.globalAlpha = 0.15;

    for (const g of bgLayers.groundDeco) {
      if (g.type === 'dash') {
        // Road-style dash
        ctx.fillStyle = CC.cyan;
        ctx.fillRect(g.x, groundY + CFG.groundH / 2 - 1, 8, 2);
      } else {
        // Small dot/rivet
        ctx.fillStyle = CC.magenta;
        ctx.beginPath();
        ctx.arc(g.x, groundY + CFG.groundH * 0.7, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* --- Main loop (fixed-timestep) ----------------------------- */
  // Physics always tick at exactly 60 Hz regardless of monitor refresh rate.
  // This prevents the game from speeding up on 120/144 Hz screens or
  // slowing down when the browser throttles frames.
  const FIXED_DT   = 1;               // 1 "tick" = 1/60 s of physics
  const TICK_MS    = 1000 / 60;        // ≈16.667 ms per tick
  const MAX_TICKS  = 4;                // safety cap — skip frames if way behind
  let accumulator  = 0;

  function loop() {
    const now   = performance.now();
    const delta = now - frameTime;     // real ms elapsed since last frame
    frameTime   = now;

    // Accumulate real time; consume it in fixed-size physics steps
    accumulator += delta;
    let ticks = 0;
    while (accumulator >= TICK_MS && ticks < MAX_TICKS) {
      update(FIXED_DT, now);
      accumulator -= TICK_MS;
      ticks++;
    }
    // If we hit the cap, throw away excess time so we don't spiral
    if (ticks >= MAX_TICKS) accumulator = 0;

    draw(now);

    rafId = requestAnimationFrame(loop);
  }

  function update(dt, now) {
    globalTime = now;

    // Clouds always drift
    for (const c of clouds) {
      c.x -= c.speed * dt;
      if (c.x + c.w < 0) { c.x = CFG.width + 10; c.y = 30 + Math.random() * (CFG.height * 0.35); }
    }

    // Background layers: clouds & planes always move; ground stuff only during play (not paused)
    if (bgLayers) updateBackground(dt, now, state === 'play');

    if (state === 'idle' || state === 'dead' || state === 'paused') return;

    // Bird physics — floaty feel with terminal velocity
    bird.vy  += CFG.gravity * dt;
    // Cap downward speed so the bird never plummets like a stone
    if (bird.vy > CFG.terminalVel) bird.vy = CFG.terminalVel;
    bird.y   += bird.vy * dt;
    // Gentler rotation: tilt is based on velocity but with softer mapping
    const targetRot = Math.max(-20, Math.min(55, bird.vy * 3.2));
    bird.rot += (targetRot - bird.rot) * 0.12; // smooth interpolation

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

      // Remove off-screen (swap-and-pop: O(1), draw order doesn't matter)
      if (p.x + CFG.pipeWidth < 0) {
        const last = pipes.length - 1;
        if (i !== last) pipes[i] = pipes[last];
        pipes.pop();
        continue;
      }

      // Score
      if (!p.scored && p.x + CFG.pipeWidth < CFG.birdX) {
        p.scored = true;
        score++;
      }

      // Collision — with forgiveness padding so near-misses don't kill
      const pad = CFG.hitboxPad;
      const bx = CFG.birdX + pad;
      const by = bird.y + pad;
      const bs = CFG.birdSize - pad * 2;
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
    if (score > bestScores[currentDifficulty]) {
      bestScores[currentDifficulty] = score;
      saveBestScores();
      updateHeader();
    }
  }

  /* --- Draw ------------------------------------------------- */
  function draw(now) {
    const W = CFG.width;
    const H = CFG.height;

    // Sky gradient (cached — never changes)
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // === PARALLAX BACKGROUND (behind clouds & pipes) ===
    drawBackground();

    // Near clouds (batched single fill)
    ctx.fillStyle = CC.cyan;
    ctx.globalAlpha = 0.12;
    drawCloudsBatched(clouds);
    ctx.globalAlpha = 1;

    // Pipes
    for (const p of pipes) {
      drawPipe(p);
    }

    // Ground
    ctx.fillStyle = CC.navy;
    ctx.fillRect(0, H - CFG.groundH, W, CFG.groundH);

    // Ground decorations (road dashes, dots)
    drawGroundDeco();

    // Ground accent line (cached gradient)
    ctx.fillStyle = accentGrad;
    ctx.fillRect(0, H - CFG.groundH, W, 3);

    // Bird — only visible during play & dead, not on the idle title screen
    if (state !== 'idle') drawBird();

    // Score
    drawScore();

    // Fading controls hint (first few seconds of play)
    drawControlsHint(now);

    // Settings heart button (always on top except behind popups)
    drawSettingsBtn();

    // Overlays
    if (state === 'idle' && !document.getElementById('flappy-title-card')) drawReadyScreen();
    if (state === 'dead') drawDeadScreen();
    if (state === 'paused' || settingsOpen) drawDiffPicker();
  }

  /** Add a single cloud's 3 ellipses to the CURRENT path (caller owns beginPath/fill). */
  function addCloudToPath(x, y, w) {
    const h = w * 0.45;
    ctx.moveTo(x + w * 0.35 + w * 0.35, y + h * 0.6);
    ctx.ellipse(x + w * 0.35, y + h * 0.6, w * 0.35, h * 0.45, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.65 + w * 0.3, y + h * 0.5);
    ctx.ellipse(x + w * 0.65, y + h * 0.5, w * 0.3, h * 0.4, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.5 + w * 0.25, y + h * 0.35);
    ctx.ellipse(x + w * 0.5, y + h * 0.35, w * 0.25, h * 0.35, 0, 0, Math.PI * 2);
  }

  /** Draw an array of clouds in a single batched fill call. */
  function drawCloudsBatched(cloudArr) {
    ctx.beginPath();
    for (let i = 0, len = cloudArr.length; i < len; i++) {
      const c = cloudArr[i];
      addCloudToPath(c.x, c.y, c.w);
    }
    ctx.fill();
  }

  function drawPipe(p) {
    const r  = 8; // corner radius
    const W  = CFG.pipeWidth;
    const gT = p.topH;
    const gB = p.topH + CFG.pipeGap;

    // Use cached pipe gradient — translate so origin aligns with pipe x
    ctx.translate(p.x, 0);

    // Top pipe (gradient drawn at origin)
    ctx.fillStyle = pipeGrad;
    roundRect(0, -4, W, gT + 4, r);

    // Lip on top pipe
    ctx.fillStyle = CC.violet;
    roundRect(-4, gT - 20, W + 8, 20, r);

    // Bottom pipe (same cached gradient)
    ctx.fillStyle = pipeGrad;
    roundRect(0, gB, W, CFG.height - gB, r);

    // Lip on bottom pipe
    ctx.fillStyle = CC.violet;
    roundRect(-4, gB, W + 8, 20, r);

    ctx.translate(-p.x, 0);
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
      ctx.fillStyle = CC.violet;
      ctx.beginPath();
      ctx.arc(0, 0, CFG.birdSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScore() {
    if (state === 'idle') return;

    ctx.font = FONTS.score;
    ctx.textAlign = 'center';
    ctx.fillStyle = CC.navy;
    ctx.globalAlpha = 0.12;
    ctx.fillText(score, CFG.width / 2 + 2, 52);
    ctx.globalAlpha = 1;
    ctx.fillStyle = CC.magenta;
    ctx.fillText(score, CFG.width / 2, 50);
  }

  /* --- In-game controls hint (fading) ------------------------- */
  function drawControlsHint(now) {
    if (state !== 'play' || hintStartTime === 0) return;
    const elapsed = now - hintStartTime;
    if (elapsed > HINT_DURATION) return; // fully gone

    // Compute alpha: full opacity, then fade out at the end
    let alpha = 0.55;
    const fadeStart = HINT_DURATION - HINT_FADE;
    if (elapsed > fadeStart) {
      alpha *= 1 - (elapsed - fadeStart) / HINT_FADE;
    }
    if (alpha <= 0) return;

    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';

    // "Space / Click to flap" — centered below the score
    const cy = 78;
    ctx.font = FONTS.hint;
    ctx.fillStyle = CC.navy;
    ctx.fillText('Space / Click to flap', CFG.width / 2, cy);

    ctx.globalAlpha = 1;
  }

  /* --- Settings heart button (top-right on canvas) ----------- */
  function drawSettingsBtn() {
    // Only show during play, paused, or dead — not on idle title screen
    if (state === 'idle') return;
    const c = settingsBtnCenter();
    const s = SETTINGS_BTN.size;
    ctx.save();

    // Nearly invisible by default, glows on hover
    const baseAlpha = settingsHover || settingsOpen ? 0.65 : 0.08;
    ctx.globalAlpha = baseAlpha;

    if (heartImg) {
      ctx.drawImage(heartImg, c.x - s / 2, c.y - s / 2, s, s);
    } else {
      ctx.fillStyle = CC.violet;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle outline ring on hover
    if (settingsHover || settingsOpen) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = CC.magenta;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s / 2 + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* --- Difficulty picker popup (drawn on canvas) ------------- */
  function drawDiffPicker() {
    if (!settingsOpen) return;
    const layout = _cachedDiffLayout || diffPickerLayout();
    ctx.save();

    // Semi-transparent scrim behind the card
    ctx.fillStyle = 'rgba(9, 9, 73, 0.3)';
    ctx.fillRect(0, 0, CFG.width, CFG.height);

    // Card shadow (two offset translucent rects instead of shadowBlur)
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    roundRect(layout.x + 2, layout.y + 4, layout.w, layout.h, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    roundRect(layout.x + 1, layout.y + 2, layout.w, layout.h, 12);
    // Card background
    ctx.fillStyle = CC.white;
    roundRect(layout.x, layout.y, layout.w, layout.h, 12);

    // Title
    ctx.font = FONTS.diffTitle;
    ctx.textAlign = 'center';
    ctx.fillStyle = CC.navy;
    ctx.fillText('Difficulty', layout.x + layout.w / 2, layout.y + 22);

    // Buttons
    for (let i = 0; i < layout.buttons.length; i++) {
      const btn = layout.buttons[i];
      const key = DIFF_KEYS[i];
      const isActive = key === currentDifficulty;
      const isHover  = mouseX >= btn.x && mouseX <= btn.x + btn.w &&
                       mouseY >= btn.y && mouseY <= btn.y + btn.h;

      // Button bg
      if (isActive) {
        ctx.fillStyle = CC.violet;
      } else if (isHover) {
        ctx.fillStyle = '#F0E8FA';
      } else {
        ctx.fillStyle = CC.light;
      }
      roundRect(btn.x, btn.y, btn.w, btn.h, 6);

      // Button label (left-aligned) + best score (right-aligned)
      const bst = bestScores[key] || 0;
      ctx.font = FONTS.diffBtn;
      ctx.textAlign = 'left';
      ctx.fillStyle = isActive ? CC.white : CC.navy;
      ctx.fillText(DIFF_LABELS[key], btn.x + 10, btn.y + btn.h / 2 + 4);
      if (bst > 0) {
        ctx.font = FONTS.diffBest;
        ctx.textAlign = 'right';
        ctx.globalAlpha = isActive ? 0.75 : 0.45;
        ctx.fillText('Best: ' + bst, btn.x + btn.w - 10, btn.y + btn.h / 2 + 3);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }

  /* --- Ready screen (canvas-drawn, shown after difficulty change resets to idle) --- */
  function drawReadyScreen() {
    ctx.save();

    // Dim overlay
    ctx.fillStyle = 'rgba(9, 9, 73, 0.35)';
    ctx.fillRect(0, 0, CFG.width, CFG.height);

    // Card
    const cardW = 220;
    const cardH = 140;
    const cx    = (CFG.width  - cardW) / 2;
    const cy    = (CFG.height - cardH) / 2 - 15;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    roundRect(cx + 2, cy + 5, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    roundRect(cx + 1, cy + 2, cardW, cardH, 16);
    // Background
    ctx.fillStyle = CC.white;
    roundRect(cx, cy, cardW, cardH, 16);

    // Heart icon
    if (heartImg) {
      const iconS = 32;
      ctx.drawImage(heartImg, CFG.width / 2 - iconS / 2, cy + 16, iconS, iconS);
    }

    // Difficulty label
    ctx.font = FONTS.deadScore;
    ctx.textAlign = 'center';
    ctx.fillStyle = CC.violet;
    ctx.fillText(DIFF_LABELS[currentDifficulty] || 'Normal', CFG.width / 2, cy + 72);

    // Best score for this difficulty
    const best = bestScore();
    if (best > 0) {
      ctx.fillStyle = CC.magenta;
      ctx.fillText('Best: ' + best, CFG.width / 2, cy + 92);
    }

    // "Tap to play" prompt
    ctx.font = FONTS.deadRetry;
    ctx.fillStyle = CC.navy;
    ctx.globalAlpha = 0.5;
    ctx.fillText('Space / Click to play', CFG.width / 2, cy + 122);
    ctx.globalAlpha = 1;

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
    // Card shadow (two offset translucent rects instead of shadowBlur)
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    roundRect(cx + 2, cy + 5, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    roundRect(cx + 1, cy + 2, cardW, cardH, 16);
    ctx.fillStyle = CC.white;
    roundRect(cx, cy, cardW, cardH, 16);

    ctx.font = FONTS.deadTitle;
    ctx.textAlign = 'center';
    ctx.fillStyle = CC.navy;
    ctx.fillText('Game Over', CFG.width / 2, cy + 38);

    ctx.font = FONTS.deadScore;
    ctx.fillStyle = CC.violet;
    ctx.fillText(`Score: ${score}`, CFG.width / 2, cy + 68);

    ctx.fillStyle = CC.magenta;
    ctx.fillText(`Best: ${bestScore()}`, CFG.width / 2, cy + 90);

    ctx.font = FONTS.deadRetry;
    ctx.fillStyle = CC.navy;
    ctx.globalAlpha = 0.5;
    ctx.fillText('Space / Click to retry', CFG.width / 2, cy + 128);
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
