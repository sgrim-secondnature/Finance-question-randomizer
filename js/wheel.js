/* ============================================================
   Second Nature – Finance Team Spin to Win
   All design values read from CSS custom properties defined
   in styles/main.css. No magic strings or numbers here.
   ============================================================ */

// ============================================================
//  TOKEN READER — reads CSS custom properties from :root
// ============================================================

const rootStyle = getComputedStyle(document.documentElement);

function cssVar(name) {
  return rootStyle.getPropertyValue(name).trim();
}

function cssNum(name) {
  return parseFloat(cssVar(name));
}

// ============================================================
//  TOKENS (read once at init from CSS custom properties)
// ============================================================

const TOKENS = Object.freeze({
  // Colors (only those directly used in drawing)
  violet:    cssVar('--sn-violet'),
  cyan:      cssVar('--sn-cyan'),
  navy:      cssVar('--sn-navy'),
  white:     cssVar('--sn-white'),

  // Wheel slice palette
  wheelColors: cssVar('--sn-wheel-colors').split(',').map(c => c.trim()),

  // Opacity
  opacityDimmed:    cssNum('--opacity-dimmed'),
  opacitySeparator: cssNum('--opacity-separator'),
  opacityFlash:     cssNum('--opacity-flash'),
  opacityMuted:     cssNum('--opacity-muted'),

  // Typography
  fontFamily:    cssVar('--font-family'),
  fontWeight:    cssNum('--font-weight-label'),
  fontSize:      cssVar('--font-size-label'),

  // Wheel geometry
  wheelSize:        cssNum('--wheel-size'),
  wheelInset:       cssNum('--wheel-inset'),
  centerRadius:     cssNum('--wheel-center-radius'),
  centerRing:       cssNum('--wheel-center-ring'),
  centerDot:        cssNum('--wheel-center-dot'),
  pointerHalfW:     cssNum('--wheel-pointer-half-w'),
  pointerTop:       cssNum('--wheel-pointer-top'),
  pointerTip:       cssNum('--wheel-pointer-tip'),
  textOffsetX:      cssNum('--wheel-text-offset-x'),
  textOffsetY:      cssNum('--wheel-text-offset-y'),
  separatorWidth:   cssNum('--wheel-separator-width'),
  ringWidth:        cssNum('--wheel-ring-width'),

  // Canvas shadow / stroke
  labelShadowBlur:      cssNum('--label-shadow-blur'),
  labelShadowOffsetY:   cssNum('--label-shadow-offset-y'),
  pointerShadowBlur:    cssNum('--pointer-shadow-blur'),
  pointerShadowOffset:  cssNum('--pointer-shadow-offset'),
  pointerShadowOpacity: cssNum('--pointer-shadow-opacity'),
  pointerStrokeWidth:   cssNum('--pointer-stroke-width'),
  centerGradientPad:    cssNum('--center-gradient-pad'),

  // Animation
  spinDuration:      cssNum('--spin-duration'),
  spinMinRotations:  cssNum('--spin-min-rotations'),
  spinExtraRots:     cssNum('--spin-extra-rotations'),
  glowDuration:      cssNum('--glow-duration'),
  glowBaseBlur:      cssNum('--glow-base-blur'),
  glowAmplitude:     cssNum('--glow-amplitude'),
  glowPhaseStep:     cssNum('--glow-phase-step'),
  overlayCloseDelay: cssNum('--overlay-close-delay'),

  // Easing
  easeDecayRate:    cssNum('--ease-decay-rate'),
  wobbleThreshold:  cssNum('--wobble-threshold'),
  wobbleFrequency:  cssNum('--wobble-frequency'),
  wobbleIntensity:  cssNum('--wobble-intensity'),
  wobbleDamping:    cssNum('--wobble-damping'),
  tickCutoff:       cssNum('--tick-cutoff'),

  // Persistence
  storageKey: cssVar('--storage-key').replace(/"/g, ''),
});

const TWO_PI = Math.PI * 2;
const POINTER_ANGLE = (3 * Math.PI) / 2; // 12 o'clock

// ============================================================
//  DOM REFERENCES (cached once)
// ============================================================

const DOM = Object.freeze({
  canvas:        document.getElementById('wheel'),
  spinBtn:       document.getElementById('spin-btn'),
  statusBadge:   document.getElementById('status-badge'),
  allPicked:     document.getElementById('all-picked'),
  overlay:       document.getElementById('winner-overlay'),
  winnerName:    document.getElementById('winner-name'),
  winnerCard:    document.getElementById('winner-card'),
  sectionWheel:  document.getElementById('section-wheel'),
  sectionHistory:document.getElementById('section-history'),
  tabWheel:      document.getElementById('tab-wheel'),
  tabHistory:    document.getElementById('tab-history'),
  historyTbody:  document.getElementById('history-tbody'),
  historyTable:  document.getElementById('history-table'),
  historyEmpty:  document.getElementById('history-empty'),
});

// ============================================================
//  CANVAS SETUP (HiDPI + Responsive)
// ============================================================

const ctx = DOM.canvas.getContext('2d');
const MAX_WHEEL = TOKENS.wheelSize; // 520 — design maximum
const dpr = window.devicePixelRatio || 1;

/** Compute the best wheel size for the current viewport */
function computeWheelSize() {
  return Math.min(MAX_WHEEL, window.innerWidth * 0.88);
}

let SIZE = computeWheelSize();
let HALF = SIZE / 2;

/** Apply SIZE to the canvas element (call after SIZE changes) */
function applyCanvasSize() {
  DOM.canvas.width  = SIZE * dpr;
  DOM.canvas.height = SIZE * dpr;
  DOM.canvas.style.width  = SIZE + 'px';
  DOM.canvas.style.height = SIZE + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Compute scale factor relative to the 520px design baseline */
function wheelScale() {
  return SIZE / MAX_WHEEL;
}

applyCanvasSize();

// ============================================================
//  STATE
// ============================================================

let names = [];
let slice = 0;
let rotation = 0;
let spinning = false;
let winnerIndex = -1;
let glowPhase = 0;
let glowAnimId = null;
let spinHistory = JSON.parse(localStorage.getItem(TOKENS.storageKey) || '[]');

// ============================================================
//  HELPERS
// ============================================================

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function isNamePicked(name) {
  return spinHistory.some(h => h.name === name);
}

function getAvailable() {
  return names.filter(n => !isNamePicked(n));
}

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

// ============================================================
//  DRAWING (all geometry scaled by wheelScale())
// ============================================================

/** Scale a design-baseline value to the current wheel SIZE */
function s(value) { return value * wheelScale(); }

function drawWheel() {
  ctx.clearRect(0, 0, SIZE, SIZE);

  names.forEach((name, i) => {
    const angle = rotation + i * slice;
    const picked = isNamePicked(name);
    const color = TOKENS.wheelColors[i % TOKENS.wheelColors.length];

    drawSlice(angle, color, picked);
    drawWinnerGlow(i, angle);
    drawSeparator(angle);
    drawSliceLabel(name, angle, picked);
  });

  drawCenterCircle();
  drawPointer();
}

function drawSlice(angle, color, picked) {
  ctx.beginPath();
  ctx.moveTo(HALF, HALF);
  ctx.arc(HALF, HALF, HALF - s(TOKENS.wheelInset), angle, angle + slice);
  ctx.closePath();
  ctx.fillStyle = picked ? hexToRgba(color, TOKENS.opacityDimmed) : color;
  ctx.fill();
}

function drawWinnerGlow(index, angle) {
  if (index !== winnerIndex || spinning) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(HALF, HALF);
  ctx.arc(HALF, HALF, HALF - s(TOKENS.wheelInset), angle, angle + slice);
  ctx.closePath();
  ctx.shadowColor = TOKENS.cyan;
  ctx.shadowBlur = s(TOKENS.glowBaseBlur) + Math.sin(glowPhase) * s(TOKENS.glowAmplitude);
  ctx.fill();
  ctx.restore();
}

function drawSeparator(angle) {
  const edge = HALF - s(TOKENS.wheelInset);
  ctx.beginPath();
  ctx.moveTo(HALF, HALF);
  ctx.lineTo(HALF + edge * Math.cos(angle), HALF + edge * Math.sin(angle));
  ctx.strokeStyle = hexToRgba(TOKENS.white, TOKENS.opacitySeparator);
  ctx.lineWidth = s(TOKENS.separatorWidth);
  ctx.stroke();
}

function drawSliceLabel(name, angle, picked) {
  const fontSize = Math.max(10, Math.round(parseFloat(TOKENS.fontSize) * wheelScale()));
  ctx.save();
  ctx.translate(HALF, HALF);
  ctx.rotate(angle + slice / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = picked
    ? hexToRgba(TOKENS.white, TOKENS.opacitySeparator)
    : TOKENS.white;
  ctx.font = `${TOKENS.fontWeight} ${fontSize}px ${TOKENS.fontFamily}`;
  ctx.shadowColor = hexToRgba('#000000', TOKENS.opacityMuted);
  ctx.shadowBlur = s(TOKENS.labelShadowBlur);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = s(TOKENS.labelShadowOffsetY);
  ctx.fillText(name, HALF - s(TOKENS.textOffsetX), s(TOKENS.textOffsetY));
  ctx.restore();
}

function drawCenterCircle() {
  const grad = ctx.createRadialGradient(
    HALF, HALF, 0,
    HALF, HALF, s(TOKENS.centerRadius) + s(TOKENS.centerGradientPad)
  );
  grad.addColorStop(0, TOKENS.white);
  grad.addColorStop(0.6, TOKENS.navy);
  grad.addColorStop(1, TOKENS.navy);
  ctx.beginPath();
  ctx.arc(HALF, HALF, s(TOKENS.centerRadius), 0, TWO_PI);
  ctx.fillStyle = grad;
  ctx.fill();

  // White ring
  ctx.beginPath();
  ctx.arc(HALF, HALF, s(TOKENS.centerRing), 0, TWO_PI);
  ctx.strokeStyle = TOKENS.white;
  ctx.lineWidth = s(TOKENS.ringWidth);
  ctx.stroke();

  // Cyan dot
  ctx.beginPath();
  ctx.arc(HALF, HALF, s(TOKENS.centerDot), 0, TWO_PI);
  ctx.fillStyle = TOKENS.cyan;
  ctx.fill();
}

function drawPointer() {
  const hw  = s(TOKENS.pointerHalfW);
  const top = s(TOKENS.pointerTop);
  const tip = s(TOKENS.pointerTip);

  ctx.save();
  ctx.shadowColor = hexToRgba(TOKENS.navy, TOKENS.pointerShadowOpacity);
  ctx.shadowBlur = s(TOKENS.pointerShadowBlur);
  ctx.shadowOffsetY = s(TOKENS.pointerShadowOffset);

  ctx.beginPath();
  ctx.moveTo(HALF - hw, top);
  ctx.lineTo(HALF + hw, top);
  ctx.lineTo(HALF, tip);
  ctx.closePath();

  const pg = ctx.createLinearGradient(HALF, top, HALF, tip);
  pg.addColorStop(0, TOKENS.cyan);
  pg.addColorStop(1, TOKENS.navy);
  ctx.fillStyle = pg;
  ctx.fill();

  ctx.strokeStyle = TOKENS.white;
  ctx.lineWidth = s(TOKENS.pointerStrokeWidth);
  ctx.stroke();
  ctx.restore();
}

function flashPointer() {
  const hw  = s(TOKENS.pointerHalfW);
  const top = s(TOKENS.pointerTop);
  const tip = s(TOKENS.pointerTip);

  ctx.save();
  ctx.globalAlpha = TOKENS.opacityFlash;
  ctx.beginPath();
  ctx.moveTo(HALF - hw, top);
  ctx.lineTo(HALF + hw, top);
  ctx.lineTo(HALF, tip);
  ctx.closePath();
  ctx.fillStyle = TOKENS.white;
  ctx.fill();
  ctx.restore();
}

// ============================================================
//  EASING
// ============================================================

function easeOutExpoWobble(t) {
  if (t >= 1) return 1;
  const base = 1 - Math.pow(2, -TOKENS.easeDecayRate * t);
  if (t <= TOKENS.wobbleThreshold) return base;
  const tail = t - TOKENS.wobbleThreshold;
  const wobble = Math.sin(tail * TOKENS.wobbleFrequency)
               * TOKENS.wobbleIntensity * (1 - t) * TOKENS.wobbleDamping;
  return base + wobble;
}

// ============================================================
//  SPIN
// ============================================================

function spin() {
  if (spinning) return;

  const available = getAvailable();
  if (available.length === 0) {
    showAllPicked();
    return;
  }

  spinning = true;
  winnerIndex = -1;
  stopGlowAnim();
  DOM.spinBtn.disabled = true;

  // Pick a random available member
  const winnerName = available[Math.floor(Math.random() * available.length)];
  const winnerIdx = names.indexOf(winnerName);

  // Calculate target rotation to land winner under the pointer
  const winnerSliceCenter = winnerIdx * slice + slice / 2;
  const extraAngle = (POINTER_ANGLE - winnerSliceCenter - rotation % TWO_PI + TWO_PI * 20) % TWO_PI;
  const fullSpins = TOKENS.spinMinRotations + Math.floor(Math.random() * TOKENS.spinExtraRots);
  const target = rotation + fullSpins * TWO_PI + extraAngle;

  const startRotation = rotation;
  const totalDelta = target - startRotation;
  const startTime = performance.now();
  let lastSliceIdx = -1;

  function animate(now) {
    const t = Math.min((now - startTime) / TOKENS.spinDuration, 1);
    rotation = startRotation + totalDelta * easeOutExpoWobble(t);
    drawWheel();

    // Tick flash on slice boundary crossings
    const currentSliceIdx = Math.floor(normalizeAngle(rotation) / slice) % names.length;
    if (currentSliceIdx !== lastSliceIdx && lastSliceIdx !== -1 && t < TOKENS.tickCutoff) {
      flashPointer();
    }
    lastSliceIdx = currentSliceIdx;

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      onSpinComplete(target, winnerIdx, winnerName);
    }
  }

  requestAnimationFrame(animate);
}

function onSpinComplete(target, winnerIdx, winnerName) {
  rotation = target;
  winnerIndex = winnerIdx;
  spinning = false;
  DOM.spinBtn.disabled = false;

  drawWheel();
  addToHistory(winnerName);
  showWinner(winnerName);
  startGlowAnim();
  updateStatus();
}

// ============================================================
//  GLOW ANIMATION
// ============================================================

function startGlowAnim() {
  glowPhase = 0;
  const glowStart = performance.now();

  function tick(now) {
    glowPhase += TOKENS.glowPhaseStep;
    drawWheel();
    if (winnerIndex >= 0 && !spinning && (now - glowStart) < TOKENS.glowDuration) {
      glowAnimId = requestAnimationFrame(tick);
    } else {
      glowAnimId = null;
    }
  }

  glowAnimId = requestAnimationFrame(tick);
}

function stopGlowAnim() {
  if (glowAnimId) {
    cancelAnimationFrame(glowAnimId);
    glowAnimId = null;
  }
}

// ============================================================
//  WINNER OVERLAY
// ============================================================

function showWinner(name) {
  DOM.winnerName.textContent = name;
  DOM.overlay.classList.remove('hidden');

  // Announce to screen readers via the aria-live region
  const liveRegion = document.getElementById('sr-announcement');
  if (liveRegion) liveRegion.textContent = name + ' has been selected!';

  // Re-trigger animation
  DOM.winnerCard.classList.remove('animate-scale-in');
  void DOM.winnerCard.offsetWidth;
  DOM.winnerCard.classList.add('animate-scale-in');
}

function closeOverlay() {
  DOM.overlay.classList.add('hidden');
}

function closeOverlayAndSpin() {
  closeOverlay();
  setTimeout(spin, TOKENS.overlayCloseDelay);
}

// ============================================================
//  HISTORY (localStorage)
// ============================================================

function addToHistory(name) {
  const now = new Date();
  const timeStr = now.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  spinHistory.push({ name, time: timeStr });
  localStorage.setItem(TOKENS.storageKey, JSON.stringify(spinHistory));
  renderHistory();
}

function clearHistory() {
  spinHistory = [];
  localStorage.removeItem(TOKENS.storageKey);
  winnerIndex = -1;
  stopGlowAnim();
  renderHistory();
  updateStatus();
  drawWheel();
}

function renderHistory() {
  if (spinHistory.length === 0) {
    DOM.historyTable.classList.add('hidden');
    DOM.historyEmpty.classList.remove('hidden');
    return;
  }

  DOM.historyEmpty.classList.add('hidden');
  DOM.historyTable.classList.remove('hidden');

  DOM.historyTbody.innerHTML = spinHistory.map((entry, i) => {
    const parity = i % 2 === 0 ? 'history-row--even' : 'history-row--odd';
    return `<tr class="history-row ${parity}">
      <td class="py-2 px-2 md:py-2.5 md:px-3 text-xs md:text-sm font-bold text-navy-40">${i + 1}</td>
      <td class="py-2 px-2 md:py-2.5 md:px-3 text-xs md:text-sm font-semibold text-sn-navy">${entry.name}</td>
      <td class="py-2 px-2 md:py-2.5 md:px-3 text-xs md:text-sm text-navy-50 text-right">${entry.time}</td>
    </tr>`;
  }).join('');
}

// ============================================================
//  STATUS & TABS
// ============================================================

function updateStatus() {
  const available = getAvailable();
  if (names.length === 0) {
    DOM.statusBadge.textContent = 'Loading...';
    return;
  }
  if (available.length === 0) {
    DOM.statusBadge.textContent = `All ${names.length} members picked!`;
    showAllPicked();
  } else {
    DOM.statusBadge.textContent = `${available.length} of ${names.length} remaining`;
    hideAllPicked();
  }
}

function showAllPicked() {
  DOM.allPicked.classList.remove('hidden');
  DOM.spinBtn.disabled = true;
}

function hideAllPicked() {
  DOM.allPicked.classList.add('hidden');
  DOM.spinBtn.disabled = false;
}

const TAB_BASE = 'tab-btn px-4 py-1.5 text-xs md:px-6 md:py-2 md:text-sm font-bold rounded-pill transition-all duration-200';

function switchTab(tab) {
  const isWheel = tab === 'wheel';

  DOM.sectionWheel.classList.toggle('hidden', !isWheel);
  DOM.sectionHistory.classList.toggle('hidden', isWheel);
  DOM.tabWheel.className  = `${TAB_BASE} ${isWheel ? 'tab-btn--active' : 'tab-btn--inactive'}`;
  DOM.tabHistory.className = `${TAB_BASE} ${isWheel ? 'tab-btn--inactive' : 'tab-btn--active'}`;

  // ARIA: update tab selection state
  DOM.tabWheel.setAttribute('aria-selected', isWheel ? 'true' : 'false');
  DOM.tabHistory.setAttribute('aria-selected', isWheel ? 'false' : 'true');
}

// ============================================================
//  RESPONSIVE RESIZE
// ============================================================

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const newSize = computeWheelSize();
    if (Math.abs(newSize - SIZE) < 2) return; // no meaningful change
    SIZE = newSize;
    HALF = SIZE / 2;
    applyCanvasSize();
    if (names.length) drawWheel();
  }, 150);
});

// ============================================================
//  INIT
// ============================================================

fetch('data/team.json')
  .then(res => res.json())
  .then(data => {
    names = data.members;
    slice = TWO_PI / names.length;
    drawWheel();
    renderHistory();
    updateStatus();
  })
  .catch(err => console.error('Failed to load team data:', err));
