const GAME_VERSION = self.GAME_VERSION;
const params = new URLSearchParams(location.search);
let DEBUG = params.get("debug") === "1";
if (self.BOOT) self.BOOT.script = true;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

const VIRTUAL_HEIGHT = 810;
const tileSize = 60;
const PLATFORM_HEIGHT = 20;

const CLAMP_PLAYER_TO_CAMERA_X = true;

let cameraRightClamp = "secondMainEnd";

let parallaxEnabled = true;
const parallax = { segments: {}, clouds: [] };

let canvas, ctx;
let dpr = 1,
  canvasScale = 1,
  offsetX = 0,
  offsetY = 0,
  eff = 1;
let viewWidth = Math.round(
  VIRTUAL_HEIGHT * (self.innerWidth / self.innerHeight),
);
let viewHeight = VIRTUAL_HEIGHT;
let cssWidth = 0,
  cssHeight = 0;
let last = 0,
  acc = 0,
  fps = 60,
  fpsTime = 0,
  frameCount = 0;
const dt = 1 / 60;
let safeMode = false;
let score = 0;
let isReady = false;
let loader = null;
const HUD_EXT_KEY = "platformer.debug.hud.extended";
let hudExtended = localStorage.getItem(HUD_EXT_KEY) === "true";
let paused = true;

const GRID_ENABLED_KEY = "platformer.debug.grid.enabled";
const GRID_STEP_KEY = "platformer.debug.grid.step";
let gridEnabled = localStorage.getItem(GRID_ENABLED_KEY) === "true";
let gridStep = parseInt(localStorage.getItem(GRID_STEP_KEY), 10);
if (gridStep !== 5) gridStep = 1;
let gridBtn = null;
let stepBtn = null;
let parallaxBtn = null;
let vfxBtn = null;
let shakeBtn = null;
let deadZoneDebug = false;
let debugControls = null;

function setDebug(value) {
  DEBUG = value;
  if (debugControls) debugControls.style.display = DEBUG ? "flex" : "none";
}

window.addEventListener("keydown", (e) => {
  if (e.key === "F3") {
    setDebug(!DEBUG);
  } else if (e.key === "F4") {
    downloadSpikes();
  }
});

const DIFF_KEY = "platformer.difficulty.v1";
const FRAMING_KEY = "platformer.camera.framingTiles";
// Difficulty multipliers relative to Easy base values
const DIFF_FACTORS = { Easy: 1.0, Normal: 1.6, Hard: 2.2 };

const settings = {
  framingTiles: -3.75,
  camera: {
    followY: true,
    deadzoneUpTiles: 6.0,
    deadzoneDownTiles: 1.0,
    lerpPerSec: 10.0,
  },
};

const storedFraming = parseFloat(localStorage.getItem(FRAMING_KEY));
if (!isNaN(storedFraming))
  settings.framingTiles = Math.max(-8, Math.min(8, storedFraming));

const base = {
  maxRunSpeed: 6.0 * 3.5 * 2.2, // rebased from previous Hard
  runAccel: 6.0 * 3.0 * 2.2,
  runDecel: 0.7 * 2.2,
};

let MAX_RUN_SPEED = base.maxRunSpeed;
let RUN_ACCEL = base.runAccel;
let RUN_DECEL = base.runDecel;
const AIR_ACCEL = 6.0; // keep air control
const JUMP_VELOCITY = -35;
const COYOTE_MS = 100;
const JUMP_BUFFER_MS = 120;
const GRAVITY = 1.2;
const STOP_DIST = 48; // target ground stop distance in px (~0.8 tile)

const dashDistanceTiles = 2;
const dashDuration = 0.14;
const dashCooldown = 0.35;
const airDashCount = 1;
const LEVEL_START_PX = { x: 20, y: 0 }; // world space

// Dash VFX/SFX parameters
let vfxEnabled = true;
let trailInterval = 0.03;
let trailLifetime = 0.18;
let trailPoolSize = 12;
let speedLinesLifetime = 0.12;
let dustEnabled = true;
let cameraShakeAmpTiles = 0.03;
let cameraShakeDur = 0.1;
let cameraShakeOn = true;
let leadKickTiles = 0.25;
let sfxDash = "dash_swoosh";

// Dash events
const OnDashStart = [];
const OnDashUpdate = [];
const OnDashEnd = [];

// VFX pools and state
const dashTrails = [];
const speedLines = [];
const dashDust = [];
for (let i = 0; i < trailPoolSize; i++)
  dashTrails.push({
    active: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    dir: 1,
    scaleX: 1,
    scaleY: 1,
    eye: 1,
    mouth: 0,
    age: 0,
  });
for (let i = 0; i < 20; i++)
  speedLines.push({
    active: false,
    x: 0,
    y: 0,
    dir: 1,
    len: 20,
    age: 0,
    life: 0,
    vx: 0,
  });
for (let i = 0; i < 40; i++)
  dashDust.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0 });
let trailTimer = 0;
let cameraKickX = 0;
let cameraKickReturn = 0;
let cameraShakeT = 0;
let cameraShakeActive = 0;
let cameraShakeFreq = 30;
let cameraShakeAmp = 0;
let audioCtx = null;

const perf = {
  frameTimes: [],
  frameMs: 0,
  updateMs: 0,
  renderMs: 0,
  counts: { entities: 0, sprites: 0, particles: 0, collisions: 0 },
};
const spikeLog = [];
let collisionChecks = 0;

let currentDifficulty = localStorage.getItem(DIFF_KEY) || "Easy";
if (!DIFF_FACTORS[currentDifficulty]) currentDifficulty = "Easy";

function applyDifficulty(diff) {
  const factor = DIFF_FACTORS[diff] || 1;
  MAX_RUN_SPEED = base.maxRunSpeed * factor;
  RUN_ACCEL = base.runAccel * factor;
  const t = dt * 10;
  const denom = 2 * STOP_DIST - MAX_RUN_SPEED * t;
  RUN_DECEL =
    denom > 0 ? (MAX_RUN_SPEED * MAX_RUN_SPEED * t) / denom : MAX_RUN_SPEED;
  if (world.platforms.length) {
    measureReachability();
    generateLevel(levelSeed, lastGen.layers);
    resetPlayerToGround();
  }
}

function randomBlinkInterval() {
  return Math.random() < 0.5
    ? 2000 + Math.random() * 1500
    : 3000 + Math.random() * 2250;
}

function randomYawnInterval() {
  return Math.random() < 0.5
    ? 6000 + Math.random() * 3000
    : 10000 + Math.random() * 5000;
}

function randomYawnCooldown() {
  return 10000 + Math.random() * 5000;
}

let leftHeld = false,
  rightHeld = false,
  upHeld = false;
let keyLeft = false,
  keyRight = false;
let gpLeft = false,
  gpRight = false,
  prevGpLeft = false,
  prevGpRight = false;
let moveAxis = 0;
const AIR_DECEL = 0.98;
const STOP_EPS = 0.05; // ~0.5px/s
const RELEASE_CUT = 0.5;
const RELEASE_DAMP = Math.pow(0.05, dt / 0.3);
const RELEASE_RESUME = 0.05; // 50ms
let lastInputEvent = "";

let inputHUD = false;

const world = {
  platforms: [],
  coins: [],
  player: null,
  spawnCenterX: 0,
  gapStartX: 0,
  newPlatformEnd: 0,
  secondMainRightX: 0,
  gapBridge: null,
  teleport: null,
  camera: {
    x: 0,
    y: 0,
    framingYTiles: settings.framingTiles,
    targetY: 0,
    desiredY: 0,
    clampY: "none",
    appliedOffsetY: 0,
    anchorY: 0,
    dzUp: 0,
    dzDown: 0,
  },
};
let worldStartX = 0,
  worldEndX = 0,
  worldMinY = 0,
  worldMaxY = 0,
  worldWidthPx = 0;
let worldMode = "detected";

const gridCanvas = document.createElement("canvas");
let gridCtx = gridCanvas.getContext("2d");
gridCtx.imageSmoothingEnabled = false;
let gridOriginX = 0;
let gridOriginY = 0;
const gridCache = { tile: 0, scale: 0, step: 0, camTileX: null, camTileY: null };
let gridDrawnPrev = false;
let gridDrawnNow = false;

const REACH_SAFE_Y = 0.75;
const REACH_SAFE_X = 0.8;
let reachV = 0,
  reachH0 = 0,
  reachHrun = 0;
let fixedCoins = 0,
  unreachableCoins = 0;
let movedCoinPlatforms = 0,
  clampedCoinPlatforms = 0;
let levelSeed = 0;
const lastGen = { seed: 0, layers: 0, stepX: 0, stepY: 0 };

// Simple platform generator settings
const PLATFORM_GEN = {
  mainBackwardTiles: 20,
  mainForwardTiles: 300,
  mainThicknessTiles: 60,
  platformLengthTiles: 3,
  minDx: 2,
  bandBottomOffset: 2,
  bandTopOffset: 4,
  maxAttempts: 20,
  seed: null,
};

const snap = (v) => Math.round(v * eff) / eff;

function isReachable(dx, prevY, newY, mainY) {
  const dy = newY - prevY;
  if (newY < mainY + 1) return false;
  if (dy > 1) return false;
  if (dy === 1) return dx <= 6;
  if (dy === 0) return dx <= 6;
  if (dy === -1) return dx <= 8;
  return false;
}

function hasHeadClearance(x, y, w, clearanceTiles = 2) {
  const tile = tileSize;
  const area = { x, y: y - clearanceTiles * tile, w, h: clearanceTiles * tile };
  for (const pl of world.platforms) {
    if (
      area.x < pl.x + pl.w &&
      area.x + area.w > pl.x &&
      area.y < pl.y + pl.h &&
      area.y + area.h > pl.y
    ) {
      return false;
    }
  }
  return true;
}

function resetInput(release = false) {
  keyLeft = keyRight = upHeld = false;
  gpLeft = gpRight = prevGpLeft = prevGpRight = false;
  leftHeld = rightHeld = false;
  moveAxis = 0;
  const p = world.player;
  if (p) {
    if (release && !p.onGround) {
      startAirReleaseCut();
    } else {
      p.vx = 0;
      p.releaseCut = false;
    }
  }
}

function startAirReleaseCut() {
  const p = world.player;
  if (!p || p.onGround) return;
  p.vx *= RELEASE_CUT;
  p.releaseCut = true;
  p.releaseTimer = 0;
}

// VFX helpers
function spawnTrail(p) {
  const t = dashTrails.find((tr) => !tr.active);
  if (!t) return;
  t.active = true;
  t.x = p.x;
  t.y = p.y;
  t.w = p.w;
  t.h = p.h;
  t.dir = p.dir;
  t.scaleX = p.scaleX || 1;
  t.scaleY = p.scaleY || 1;
  t.eye = p.eye;
  t.mouth = p.mouth;
  t.age = 0;
}

function spawnSpeedLine(p) {
  const s = speedLines.find((sl) => !sl.active);
  if (!s) return;
  s.active = true;
  s.dir = p.dashDir;
  s.x = p.x + p.w / 2 + (Math.random() - 0.5) * p.w;
  s.y = p.y + p.h / 2 + (Math.random() * 0.4 - 0.2) * tileSize;
  s.len = 20 + Math.random() * 10;
  s.age = 0;
  s.life = speedLinesLifetime + (Math.random() * 0.04 - 0.02);
  s.vx = -p.dashDir * 120;
}

function spawnDust(p) {
  const count = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const d = dashDust.find((dd) => !dd.active);
    if (!d) break;
    d.active = true;
    d.x = p.x + p.w / 2 + (Math.random() - 0.5) * p.w;
    d.y = p.y + p.h;
    d.vx = Math.random() * 120 - 60;
    d.vy = -(60 + Math.random() * 60);
    d.age = 0;
    d.life = 0.2 + Math.random() * 0.1;
  }
}

function playDashSfx() {
  if (!vfxEnabled) return;
  try {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    const pitch = 1 + (Math.random() * 0.1 - 0.05);
    osc.frequency.value = 800 * pitch;
    gain.gain.value = 0.8;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    // ignore audio errors
  }
}

function startCameraKick(dir) {
  cameraKickX = leadKickTiles * tileSize * dir;
  cameraKickReturn = 0;
}

function endCameraKick() {
  cameraKickReturn = 0.0001;
}

function startCameraShake() {
  if (!cameraShakeOn) return;
  cameraShakeT = 0;
  cameraShakeActive = cameraShakeDur;
  cameraShakeFreq = 30 + Math.random() * 10;
  cameraShakeAmp = cameraShakeAmpTiles * tileSize;
}

function updateVfx(dt) {
  if (!vfxEnabled) return;
  // trails
  for (const t of dashTrails) {
    if (!t.active) continue;
    t.age += dt;
    if (t.age >= trailLifetime) t.active = false;
  }
  // speed lines
  for (const s of speedLines) {
    if (!s.active) continue;
    s.age += dt;
    s.x += s.vx * dt;
    if (s.age >= s.life) s.active = false;
  }
  // dust
  for (const d of dashDust) {
    if (!d.active) continue;
    d.age += dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vy += GRAVITY * tileSize * dt;
    if (d.age >= d.life) d.active = false;
  }
  // camera kick return
  if (cameraKickReturn > 0) {
    cameraKickReturn += dt;
    const t = cameraKickReturn / 0.12;
    if (t >= 1) {
      cameraKickX = 0;
      cameraKickReturn = 0;
    } else cameraKickX *= 1 - t;
  }
  // camera shake timer
  if (cameraShakeOn && cameraShakeT < cameraShakeActive) cameraShakeT += dt;
  else if (!cameraShakeOn) cameraShakeT = cameraShakeActive = 0;
}

function clearVfx() {
  dashTrails.forEach((t) => (t.active = false));
  speedLines.forEach((s) => (s.active = false));
  dashDust.forEach((d) => (d.active = false));
  cameraKickX = 0;
  cameraKickReturn = 0;
  cameraShakeT = cameraShakeActive = 0;
}

function drawVfx() {
  if (!vfxEnabled) return;
  ctx.save();
  // trails
  for (const t of dashTrails) {
    if (!t.active) continue;
    perf.counts.sprites++;
    perf.counts.particles++;
    const alpha = Math.exp(-t.age / trailLifetime);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(t.x + t.w / 2 - t.dir * tileSize * 0.05, t.y + t.h / 2);
    ctx.scale(t.scaleX, t.scaleY);
    ctx.fillStyle = "#bbf9ff";
    ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // speed lines
  for (const s of speedLines) {
    if (!s.active) continue;
    perf.counts.sprites++;
    perf.counts.particles++;
    const alpha = 1 - s.age / s.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#bbf9ff";
    const h = 2;
    ctx.fillRect(s.x - s.dir * s.len, s.y - h / 2, s.len, h);
  }
  ctx.globalAlpha = 1;
  // dust
  for (const d of dashDust) {
    if (!d.active) continue;
    perf.counts.sprites++;
    perf.counts.particles++;
    const alpha = 1 - d.age / d.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#aaa";
    ctx.beginPath();
    ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Hook VFX to dash events
OnDashStart.push((p) => {
  trailTimer = 0;
  if (vfxEnabled) {
    spawnTrail(p);
    startCameraKick(p.dashDir);
    startCameraShake();
    if (dustEnabled && p.onGround) spawnDust(p);
    spawnSpeedLine(p);
    playDashSfx();
  }
});

OnDashUpdate.push((p, dt) => {
  if (!vfxEnabled) return;
  trailTimer += dt;
  if (trailTimer >= trailInterval) {
    trailTimer -= trailInterval;
    spawnTrail(p);
  }
  spawnSpeedLine(p);
});

OnDashEnd.push((p) => {
  if (!vfxEnabled) return;
  endCameraKick();
  if (dustEnabled && p.onGround) spawnDust(p);
});

function startDash() {
  const p = world.player;
  if (!p || p.dashing) return;
  if (p.dashCooldown > 0) return;
  let axis = (keyRight || gpRight ? 1 : 0) - (keyLeft || gpLeft ? 1 : 0);
  if (!p.onGround) {
    if (p.airDash <= 0) return;
    p.airDash--;
  }
  const dir = axis !== 0 ? (axis > 0 ? 1 : -1) : p.dir;
  p.dir = dir;
  p.dashing = true;
  p.dashDir = dir;
  p.dashTime = 0;
  p.dashProgress = 0;
  p.vx = 0;
  p.vy = 0;
  OnDashStart.forEach((fn) => fn(p));
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : null;
  if (!pads) return;
  const gp = pads[0];
  if (!gp) {
    if (prevGpLeft || prevGpRight) startAirReleaseCut();
    gpLeft = gpRight = prevGpLeft = prevGpRight = false;
    return;
  }
  const ax = gp.axes[0] || 0;
  const left = ax < -0.5;
  const right = ax > 0.5;
  if ((prevGpLeft && !left) || (prevGpRight && !right)) startAirReleaseCut();
  prevGpLeft = gpLeft = left;
  prevGpRight = gpRight = right;
}

let vMax = 0;
const segment = {
  start: -400,
  end: 800,
  startTime: 0,
  delta: 0,
  running: false,
  done: false,
};
let gameTime = 0;

function resetSegment() {
  vMax = 0;
  segment.running = false;
  segment.done = false;
  segment.startTime = 0;
  segment.delta = 0;
}

function computeWorldBounds() {
  const tile = 60;
  const TAIL_TILES = 3;
  const tailX = TAIL_TILES * tile;
  const topPadTiles = Math.max(12, Math.abs(settings.framingTiles) + 6);
  const bottomPadTiles = Math.max(6, TAIL_TILES);
  const topPad = topPadTiles * tile;
  const bottomPad = bottomPadTiles * tile;
  let minX = Infinity,
    maxX = -Infinity;
  worldMinY = Infinity;
  worldMaxY = -Infinity;
  for (const pl of world.platforms) {
    minX = Math.min(minX, pl.x);
    maxX = Math.max(maxX, pl.x + pl.w);
    worldMinY = Math.min(worldMinY, pl.y);
    worldMaxY = Math.max(worldMaxY, pl.y + pl.h);
  }
  for (const c of world.coins) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    worldMinY = Math.min(worldMinY, c.y);
    worldMaxY = Math.max(worldMaxY, c.y);
  }
  if (world.teleport) {
    const t = world.teleport;
    minX = Math.min(minX, t.x);
    maxX = Math.max(maxX, t.x + t.w);
    worldMinY = Math.min(worldMinY, t.y);
    worldMaxY = Math.max(worldMaxY, t.y + t.h);
  }
  const p = world.player;
  if (p) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
    worldMinY = Math.min(worldMinY, p.y);
    worldMaxY = Math.max(worldMaxY, p.y + p.h);
  }
  if (minX === Infinity) {
    minX = 0;
    maxX = 0;
    worldMinY = 0;
    worldMaxY = 0;
  }
  if (worldMinY === Infinity) worldMinY = 0;
  if (worldMaxY === -Infinity) worldMaxY = 0;
  minX = Math.min(minX, 0) - tailX;
  maxX = maxX + tailX;
  worldMinY -= topPad;
  worldMaxY += bottomPad;

  // Ensure camera can reach desired offset when player stands on ground
  const ground = world.platforms[0];
  if (ground && p) {
    const playerY = ground.y - p.h / 2;
    const offsetY = settings.framingTiles * tile;
    const desiredCamY = playerY - (viewHeight / 2 - offsetY);
    const minAllowed = desiredCamY - 2 * tile;
    if (worldMinY > minAllowed) worldMinY = minAllowed;
  }

  const detectedTiles = Math.ceil((maxX - minX) / tile);
  worldMode = "detected";
  if (detectedTiles < 1440) {
    worldMode = "fallback";
    const half = (1440 / 2) * tile;
    minX = -half;
    maxX = half;
  }
  worldStartX = minX;
  worldEndX = maxX;
  worldWidthPx = worldEndX - worldStartX;
  buildParallaxLayers();
}

function measureReachability() {
  const dtl = dt;
  let y = 0,
    vy = JUMP_VELOCITY,
    maxY = 0;
  while (true) {
    vy += GRAVITY;
    y += vy * dtl * 10;
    if (y < maxY) maxY = y;
    if (y >= 0) break;
  }
  reachV = -maxY;
  const simDist = (startVx) => {
    let x = 0,
      y = 0,
      vx = startVx,
      vy = JUMP_VELOCITY;
    while (true) {
      vx += AIR_ACCEL;
      if (vx > MAX_RUN_SPEED) vx = MAX_RUN_SPEED;
      vy += GRAVITY;
      x += vx * dtl * 10;
      y += vy * dtl * 10;
      if (y >= 0) break;
    }
    return x;
  };
  reachH0 = simDist(0);
  reachHrun = simDist(MAX_RUN_SPEED);
}

function adjustCoinPlatforms() {
  const ground = world.platforms[0];
  const pairs = [];
  for (const c of world.coins) {
    const pl = world.platforms.find((p) => c.x >= p.x && c.x <= p.x + p.w);
    if (pl) pairs.push({ pl, c });
  }
  const maxV = reachV * REACH_SAFE_Y;
  const maxH = reachHrun * REACH_SAFE_X;
  const player = world.player || { w: 40 };
  const minLanding = player.w * 1.5;
  fixedCoins = 0;
  unreachableCoins = 0;

  const findSupport = (pl) => {
    let best = ground;
    let bestMetric = Infinity;
    for (const p of world.platforms) {
      if (p === pl) continue;
      const dx = pl.x - (p.x + p.w);
      const dy = p.y - pl.y;
      if (dx >= 0 && dy >= 0) {
        const m = dx + dy;
        if (m < bestMetric) {
          bestMetric = m;
          best = p;
        }
      } else if (dx < 0 && dy >= 0 && p.x < pl.x + pl.w && p.x + p.w > pl.x) {
        const m = dy;
        if (m < bestMetric) {
          bestMetric = m;
          best = p;
        }
      }
    }
    return best;
  };

  const unresolved = [];

  for (const { pl, c } of pairs) {
    if (pl.w < minLanding) pl.w = minLanding;
    const support = findSupport(pl);
    let changed = false;

    // vertical adjustment
    let diffY = support.y - pl.y;
    if (diffY > maxV) {
      let newY = support.y - maxV;
      for (const other of world.platforms) {
        if (other === pl) continue;
        if (pl.x < other.x + other.w && pl.x + pl.w > other.x) {
          if (newY + pl.h > other.y && newY < other.y + other.h) {
            newY = other.y - pl.h;
          }
        }
      }
      const dy = newY - pl.y;
      if (dy) {
        pl.y = newY;
        c.y += dy;
        changed = true;
      }
      diffY = support.y - pl.y;
    }

    // horizontal adjustment
    let gap = pl.x - (support.x + support.w);
    if (gap > maxH) {
      let newX = pl.x - (gap - maxH);
      for (const other of world.platforms) {
        if (other === pl) continue;
        if (newX < other.x + other.w && newX + pl.w > other.x) {
          newX = other.x + other.w;
        }
      }
      const dx = newX - pl.x;
      if (dx) {
        pl.x = newX;
        c.x += dx;
        changed = true;
      }
      gap = pl.x - (support.x + support.w);
    }

    if (diffY <= maxV && gap <= maxH) {
      if (changed) {
        fixedCoins++;
        pl.flash = "green";
      }
    } else {
      unresolved.push({ pl, c, support });
      unreachableCoins++;
      pl.flash = "red";
    }
  }

  if (unresolved.length) {
    const shift = 2 * tileSize;
    for (const item of unresolved) {
      const { pl, c, support } = item;
      let newY = pl.y + shift;
      for (const other of world.platforms) {
        if (other === pl) continue;
        if (pl.x < other.x + other.w && pl.x + pl.w > other.x) {
          if (newY + pl.h > other.y && newY < other.y + other.h) {
            newY = other.y - pl.h;
          }
        }
      }
      const dy = newY - pl.y;
      if (dy) {
        pl.y = newY;
        c.y += dy;
      }
      const diffY = support.y - pl.y;
      const gap = pl.x - (support.x + support.w);
      if (diffY <= maxV && gap <= maxH) {
        fixedCoins++;
        unreachableCoins--;
        pl.flash = "green";
      } else {
        pl.flash = "red";
      }
    }
  }

  computeWorldBounds();
  rebuildGrid();
}

function generateLevel(seed, layers = 4) {
  // Deterministic random
  if (seed == null) seed = Math.floor(Math.random() * 1e9);
  PLATFORM_GEN.seed = seed;
  levelSeed = seed;
  lastGen.seed = seed;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const tile = tileSize;
  const groundH = PLATFORM_GEN.mainThicknessTiles * PLATFORM_HEIGHT;
  const platformH = PLATFORM_HEIGHT;
  const w = PLATFORM_GEN.platformLengthTiles * tile;
  const baseGroundY = 300 + 4 * tile;
  lastGen.layers = 1;
  lastGen.stepX = tile;
  lastGen.stepY = tile;

  // reset world
  world.platforms = [];
  world.coins = [];
  world.gapBridge = null;
  world.teleport = null;

  // main ground platform
  const anchorX = 0;
  const leftBound = anchorX - PLATFORM_GEN.mainBackwardTiles * tile;
  const rightBound = anchorX + PLATFORM_GEN.mainForwardTiles * tile;
  const ground = {
    x: leftBound,
    y: baseGroundY,
    w: rightBound - leftBound,
    h: groundH,
    level: 0,
  };
  world.platforms.push(ground);
  world.coins.push({
    x: anchorX + w - tile / 2,
    y: ground.y - tile / 3,
    t: 0,
    collected: false,
  });

  world.gapStartX = ground.x + ground.w;
  const bridge = {
    x: world.gapStartX,
    y: baseGroundY,
    w: tile,
    h: tile,
    level: 0,
  };
  world.platforms.push(bridge);
  world.gapBridge = bridge;
  const endPlatform = {
    x: world.gapStartX + tile,
    y: baseGroundY,
    w: 20 * tile,
    h: groundH,
    level: 0,
  };
  world.platforms.push(endPlatform);
  world.newPlatformEnd = endPlatform.x + endPlatform.w;
  world.secondMainRightX = endPlatform.x + endPlatform.w;

  const mainYTile = Math.round(baseGroundY / tile);
  const bandBottom = mainYTile + PLATFORM_GEN.bandBottomOffset;
  const bandTop = mainYTile + PLATFORM_GEN.bandTopOffset;
  const tileToY = (ty) => baseGroundY - (ty - mainYTile) * tile;

  let prev = { x: anchorX, yTile: mainYTile, w: 0 };
  let currY = mainYTile;

  while (true) {
    let minDx = PLATFORM_GEN.minDx;
    if (prev.x + prev.w + minDx * tile + w > rightBound) {
      if (prev.x + prev.w + tile + w > rightBound) break;
      minDx = 1;
    }

    const headClearPrev = hasHeadClearance(prev.x, tileToY(prev.yTile), prev.w);
    let dy;
    if (currY > bandTop) {
      dy = -1;
    } else if (currY < bandBottom) {
      dy = headClearPrev ? 1 : 0;
    } else {
      const r = rnd();
      if (r < 0.5) dy = -1;
      else if (r < 0.8) dy = 0;
      else dy = headClearPrev ? 1 : 0;
    }

    let newY = currY + dy;
    if (dy === -1 && newY < mainYTile + 1) {
      dy = 0;
      newY = currY;
    }

    let maxDx = dy === -1 ? 8 : 6;
    if (minDx > maxDx) minDx = maxDx;

    let placed = false;
    for (
      let attempts = 0;
      attempts < PLATFORM_GEN.maxAttempts && !placed;
      attempts++
    ) {
      const dx = minDx + Math.floor(rnd() * (maxDx - minDx + 1));
      const nx = prev.x + prev.w + dx * tile;
      const ny = tileToY(newY);
      const pl = { x: nx, y: ny, w, h: platformH, level: 0 };
      if (pl.x < leftBound || pl.x + pl.w > rightBound) continue;
      if (!isReachable(dx, prev.yTile, newY, mainYTile)) continue;
      let overlap = false;
      for (const other of world.platforms) {
        if (
          pl.x < other.x + other.w &&
          pl.x + pl.w > other.x &&
          pl.y < other.y + other.h &&
          pl.y + pl.h > other.y
        ) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      if (!headClearPrev) {
        placed = false;
        break;
      }
      if (!hasHeadClearance(pl.x, pl.y, pl.w)) continue;
      world.platforms.push(pl);
      world.coins.push({
        x: pl.x + pl.w - tile / 2,
        y: pl.y - tile / 3,
        t: 0,
        collected: false,
      });
      prev = { x: pl.x, yTile: newY, w: pl.w };
      currY = newY;
      placed = true;
    }
    if (!placed) break;
  }

  adjustCoinPlatforms();
  computeWorldBounds();
  rebuildGrid();
}

function resetPlayerToGround() {
  teleportPlayerToTarget(false);
}

function placePlayerAtLevelStart(p) {
  p.x = LEVEL_START_PX.x - p.w / 2;
  p.y = LEVEL_START_PX.y - p.h;
  for (let i = 0; i < 2; i++) {
    if (world.platforms.some((pl) => rectIntersect(p, pl))) p.y -= 1;
    else break;
  }
}

function teleportPlayerToTarget(freeze = true) {
  const p = world.player;
  if (!p) return;
  placePlayerAtLevelStart(p);
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.coyote = 0;
  p.jumpBuffer = 0;
  p.releaseCut = false;
  p.releaseTimer = 0;
  p.dashing = false;
  p.dashDir = 1;
  p.dashTime = 0;
  p.dashProgress = 0;
  p.dashCooldown = 0;
  p.airDash = airDashCount;
  if (freeze) p.ghostFrames = 1;
  world.spawnCenterX = LEVEL_START_PX.x;
  computeWorldBounds();
  snapCameraToPlayer();
  rebuildGrid();
  resetInput(true);
  if (DEBUG)
    console.log("tp feet", p.x + p.w / 2, p.y + p.h);
}

function snapCameraToPlayer() {
  const p = world.player;
  if (!p) return;
  const targetX = p.x + p.w / 2;
  const desiredX = targetX - viewWidth / 2;
  const minCamXSpawn = Math.max(
    worldStartX,
    world.spawnCenterX - viewWidth / 2,
  );
  let clampRight = worldEndX;
  if (cameraRightClamp === "gapStart")
    clampRight = Math.min(clampRight, world.gapStartX);
  else if (cameraRightClamp === "newPlatformEnd")
    clampRight = Math.min(clampRight, world.newPlatformEnd);
  else if (cameraRightClamp === "secondMainEnd")
    clampRight = Math.min(clampRight, world.secondMainRightX);
  const maxCamX = Math.max(worldStartX, clampRight - viewWidth);
  world.camera.x = Math.min(Math.max(desiredX, minCamXSpawn), maxCamX);

  const offsetY = settings.framingTiles * tileSize;
  const playerY = p.y + p.h / 2;
  let camY = playerY - (viewHeight / 2 - offsetY);
  const minCamY = worldMinY;
  const maxCamY = Math.max(worldMinY, worldMaxY - viewHeight);
  let clampY = "none";
  if (camY < minCamY) {
    camY = minCamY;
    clampY = "top";
  } else if (camY > maxCamY && playerY <= worldMaxY) {
    camY = maxCamY;
    clampY = "bottom";
  }
  world.camera.y = camY;
  const anchorWorldY = camY + (viewHeight / 2 - offsetY);
  world.camera.framingYTiles = settings.framingTiles;
  world.camera.clampY = clampY;
  world.camera.anchorY = anchorWorldY;
  world.camera.dzUp = settings.camera.deadzoneUpTiles * tileSize;
  world.camera.dzDown = settings.camera.deadzoneDownTiles * tileSize;
  world.camera.targetY = playerY;
  world.camera.desiredY = camY;
  world.camera.appliedOffsetY = 0;
}

function lowerCoinPlatforms() {
  const delta = 4 * tileSize;
  const minGap = 0.5 * tileSize;
  movedCoinPlatforms = 0;
  clampedCoinPlatforms = 0;
  for (const pl of world.platforms) {
    if (
      pl.w >= 6 * tileSize ||
      pl.type === "large" ||
      pl.tag === "large" ||
      pl.support
    )
      continue;
    const coins = world.coins.filter((c) => c.x >= pl.x && c.x <= pl.x + pl.w);
    if (!coins.length) continue;
    const offsets = coins.map((c) => c.y - pl.y);
    let targetY = pl.y + delta;
    for (const other of world.platforms) {
      if (other === pl) continue;
      if (
        pl.x < other.x + other.w &&
        pl.x + pl.w > other.x &&
        other.y >= pl.y
      ) {
        const limit = other.y - pl.h - minGap;
        if (targetY > limit) targetY = limit;
      }
    }
    const dy = targetY - pl.y;
    if (dy > 0) {
      pl.y = targetY;
      coins.forEach((c, i) => {
        c.y = pl.y + offsets[i];
      });
      movedCoinPlatforms++;
      if (dy < delta) clampedCoinPlatforms++;
    }
  }
}

function rebuildGrid() {
  gridCache.camTileX = null;
}

function buildGrid(camTileX, camTileY) {
  const tile = tileSize;
  const scale = canvasScale;
  const step = gridStep;
  const sd = scale * dpr;
  const pad = 2 * tile;
  const width = viewWidth + pad * 2;
  const height = viewHeight + pad * 2;

  gridCache.tile = tile;
  gridCache.scale = scale;
  gridCache.step = step;
  gridCache.camTileX = camTileX;
  gridCache.camTileY = camTileY;

  gridCanvas.width = Math.max(1, Math.round(width * sd));
  gridCanvas.height = Math.max(1, Math.round(height * sd));
  gridCtx = gridCanvas.getContext("2d");
  gridCtx.imageSmoothingEnabled = false;
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  gridCtx.lineWidth = 1;
  gridCtx.font = `${12 * sd}px sans-serif`;
  gridCtx.textBaseline = "top";

  gridOriginX = (camTileX - 2) * tile;
  gridOriginY = (camTileY - 2) * tile;

  const startX = gridOriginX;
  const endX = gridOriginX + width;
  const startY = gridOriginY;
  const endY = gridOriginY + height;
  const stepWorld = step * tile;

  for (let x = Math.ceil(startX / stepWorld) * stepWorld; x <= endX; x += stepWorld) {
    const idx = Math.round(x / tile);
    const major = idx % 10 === 0;
    const color = major ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)";
    const px = Math.round((x - gridOriginX) * sd) + 0.5;
    gridCtx.strokeStyle = color;
    gridCtx.beginPath();
    gridCtx.moveTo(px, 0);
    gridCtx.lineTo(px, gridCanvas.height);
    gridCtx.stroke();
    if (major) {
      gridCtx.fillStyle = color;
      gridCtx.fillText(idx, px + 2, 2);
    }
  }

  for (let y = Math.ceil(startY / stepWorld) * stepWorld; y <= endY; y += stepWorld) {
    const idx = Math.round(y / tile);
    const major = idx % 10 === 0;
    const color = major ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)";
    const py = Math.round((y - gridOriginY) * sd) + 0.5;
    gridCtx.strokeStyle = color;
    gridCtx.beginPath();
    gridCtx.moveTo(0, py);
    gridCtx.lineTo(gridCanvas.width, py);
    gridCtx.stroke();
    if (major) {
      gridCtx.fillStyle = color;
      gridCtx.fillText(idx, 2, py + 2);
    }
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  canvas = document.getElementById("game");
  ctx = canvas.getContext("2d");
  resize();
  loader = document.getElementById("loading-screen");
  drawLoading();
  try {
    init();
    setupMenu();
    if (self.BOOT) self.BOOT.init = true;
    last = performance.now();
    requestAnimationFrame(loop);
    if (self.BOOT) self.BOOT.loop = true;
  } catch (e) {
    showError(e);
  }
}

function drawLoading() {
  if (isReady) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(
    canvasScale * dpr,
    0,
    0,
    canvasScale * dpr,
    offsetX * dpr,
    offsetY * dpr,
  );
  drawParallax(0, 0);
  ctx.fillStyle = "#fff";
  ctx.font = "20px sans-serif";
  ctx.fillText("Loading...", 20, 40);
}

if (document.readyState === "loading")
  window.addEventListener("DOMContentLoaded", start, { once: true });
else start();
window.addEventListener("resize", resize);
if (window.visualViewport)
  window.visualViewport.addEventListener("resize", resize);

function syncCanvas() {
  const newDpr = window.devicePixelRatio || 1;
  const newCssW = window.innerWidth;
  const newCssH = window.innerHeight;
  const newScale = newCssH / VIRTUAL_HEIGHT;
  const newViewWidth = Math.round(VIRTUAL_HEIGHT * (newCssW / newCssH));
  const newOffsetX = (newCssW - newViewWidth * newScale) / 2;
  const newOffsetY = 0;
  if (
    newDpr === dpr &&
    newScale === canvasScale &&
    newCssW === cssWidth &&
    newCssH === cssHeight &&
    newViewWidth === viewWidth
  )
    return false;
  dpr = newDpr;
  canvasScale = newScale;
  offsetX = newOffsetX;
  offsetY = newOffsetY;
  cssWidth = newCssW;
  cssHeight = newCssH;
  viewWidth = newViewWidth;
  viewHeight = VIRTUAL_HEIGHT;
  eff = dpr * canvasScale;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(
    canvasScale * dpr,
    0,
    0,
    canvasScale * dpr,
    offsetX * dpr,
    offsetY * dpr,
  );
  safeMode = cssWidth < 720 || cssHeight < 405;
  return true;
}

function resize() {
  if (syncCanvas()) {
    rebuildGrid();
    buildParallaxLayers();
  }
}

function init() {
  // Input
  window.addEventListener("keydown", (e) => {
    if (e.code === "F3") {
      hudExtended = !hudExtended;
      localStorage.setItem(HUD_EXT_KEY, hudExtended);
      e.preventDefault();
      return;
    }
    if (e.code === "F1") {
      inputHUD = !inputHUD;
      e.preventDefault();
      return;
    }
    if (e.code === "F2") {
      deadZoneDebug = !deadZoneDebug;
      e.preventDefault();
      return;
    }
    if (e.code === "F4") {
      toggleGridStep();
      e.preventDefault();
      return;
    }
    if (e.code === "KeyG") {
      toggleGrid();
      e.preventDefault();
      return;
    }
    if (e.code === "BracketLeft") {
      settings.framingTiles = Math.max(-8, settings.framingTiles - 1);
      world.camera.framingYTiles = settings.framingTiles;
      localStorage.setItem(FRAMING_KEY, settings.framingTiles);
      computeWorldBounds();
      rebuildGrid();
      e.preventDefault();
      return;
    }
    if (e.code === "BracketRight") {
      settings.framingTiles = Math.min(8, settings.framingTiles + 1);
      world.camera.framingYTiles = settings.framingTiles;
      localStorage.setItem(FRAMING_KEY, settings.framingTiles);
      computeWorldBounds();
      rebuildGrid();
      e.preventDefault();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(
        e.code,
      )
    )
      e.preventDefault();
    if (e.code === "ArrowLeft" || e.code === "KeyA") keyLeft = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") keyRight = true;
    if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Space") {
      upHeld = true;
      world.player.jumpBuffer = JUMP_BUFFER_MS;
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") startDash();
    if (e.code === "KeyR") {
      resetSegment();
      resetInput();
    }
    if (e.code === "KeyN") {
      levelSeed = Date.now();
      measureReachability();
      generateLevel(levelSeed, lastGen.layers);
      resetPlayerToGround();
      resetInput(true);
      e.preventDefault();
      return;
    }
    lastInputEvent = "keydown " + e.code;
  });
  window.addEventListener("keyup", (e) => {
    let release = false;
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      if (keyLeft) release = true;
      keyLeft = false;
    }
    if (e.code === "ArrowRight" || e.code === "KeyD") {
      if (keyRight) release = true;
      keyRight = false;
    }
    if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Space")
      upHeld = false;
    if (release) startAirReleaseCut();
    lastInputEvent = "keyup " + e.code;
  });
  window.addEventListener("blur", () => {
    resetInput(true);
    lastInputEvent = "blur";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetInput(true);
      lastInputEvent = "vis";
    }
  });
  ["touchend", "touchcancel", "touchleave"].forEach((ev) =>
    window.addEventListener(ev, () => {
      resetInput(true);
      lastInputEvent = ev;
    }),
  );

  world.spawnCenterX = LEVEL_START_PX.x;
  measureReachability();
  levelSeed = Date.now();
  generateLevel(levelSeed, 4);
  world.player = {
    x: LEVEL_START_PX.x - 20,
    y: LEVEL_START_PX.y - 40,
    w: 40,
    h: 40,
    vx: 0,
    vy: 0,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    scaleX: 1,
    scaleY: 1,
    eye: 1,
    blinkTimer: randomBlinkInterval(),
    blinkDuration: 0,
    blinkRepeat: false,
    mouth: 0,
    yawnTimer: randomYawnInterval(),
    yawnCooldown: 0,
    yawning: false,
    yawnPhase: 0,
    yawnTime: 0,
    yawnDurA: 0,
    yawnDurP: 0,
    yawnDurC: 0,
    yawnStretch: 0,
    yawnTilt: 0,
    longBlink: false,
    breathe: 0,
    dir: 1,
    releaseCut: false,
    releaseTimer: 0,
    dashing: false,
    dashDir: 1,
    dashTime: 0,
    dashProgress: 0,
    dashCooldown: 0,
    airDash: airDashCount,
    ghostFrames: 0,
  };
  teleportPlayerToTarget(false);
  debugControls = document.getElementById("debug-controls");
  setDebug(DEBUG);
  gridBtn = document.getElementById("btn-grid");
  stepBtn = document.getElementById("btn-step");
  parallaxBtn = document.getElementById("btn-parallax");
  vfxBtn = document.getElementById("btn-vfx");
  shakeBtn = document.getElementById("btn-shake");
  const bindBtn = (el, handler) => {
    ["click", "touchstart"].forEach((ev) => {
      el.addEventListener(
        ev,
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          handler();
        },
        { passive: false },
      );
    });
  };
  bindBtn(gridBtn, toggleGrid);
  bindBtn(stepBtn, toggleGridStep);
  bindBtn(parallaxBtn, toggleParallax);
  bindBtn(vfxBtn, toggleVfx);
  bindBtn(shakeBtn, toggleShake);
  updateGridButtons();
  resetInput();
}

function loop(t) {
  try {
    perf.frameStart = performance.now();
    perf.counts.entities =
      1 + world.platforms.length + world.coins.length;
    perf.counts.sprites = 0;
    perf.counts.particles = 0;
    collisionChecks = 0;
    const delta = t - last;
    last = t;
    acc += delta / 1000;
    frameCount++;
    if (t - fpsTime > 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsTime = t;
      if (fps < 30) safeMode = true;
    }
    performance.mark("updateStart");
    const uStart = performance.now();
    let steps = 0;
    while (acc >= dt && steps < 5) {
      update(dt);
      acc -= dt;
      steps++;
    }
    if (acc > dt) acc = dt;
    updateCamera(delta / 1000);
    const uEnd = performance.now();
    performance.mark("updateEnd");
    perf.updateStart = uStart;
    perf.updateEnd = uEnd;
    perf.updateMs = uEnd - uStart;
    perf.counts.collisions = collisionChecks;
    perf.counts.entities =
      1 + world.platforms.length + world.coins.length;
    if (CLAMP_PLAYER_TO_CAMERA_X) {
      world.camera.clampX = clampPlayerToCameraX();
    } else {
      world.camera.clampX = "none";
    }
    performance.mark("renderStart");
    perf.renderStart = performance.now();
    render();
    perf.renderEnd = performance.now();
    performance.mark("renderEnd");
    perf.renderMs = perf.renderEnd - perf.renderStart;
    perf.frameEnd = perf.renderEnd;
    perf.frameMs = perf.frameEnd - perf.frameStart;
    performance.mark("frameEnd");
    perf.frameTimes.push(perf.frameMs);
    if (perf.frameTimes.length > 600) perf.frameTimes.shift();
    if (perf.frameMs > 20) {
      const snap = {
        frameMs: perf.frameMs,
        updateMs: perf.updateMs,
        renderMs: perf.renderMs,
        heapUsed: performance.memory
          ? performance.memory.usedJSHeapSize
          : null,
        counts: { ...perf.counts },
        flags: {
          gridOn: gridEnabled,
          parallaxOn: parallaxEnabled,
          vfxOn: vfxEnabled,
          cameraShakeOn,
        },
      };
      spikeLog.push(snap);
      if (spikeLog.length > 50) spikeLog.shift();
    }
    if (!isReady) {
      isReady = true;
      if (loader) loader.style.display = "none";
      if (self.BOOT) {
        self.BOOT.frame = true;
        if (self.BOOT.watchdog) clearTimeout(self.BOOT.watchdog);
      }
    }
    requestAnimationFrame(loop);
  } catch (e) {
    showError(e);
  }
}

function update(dt) {
  if (paused) return;
  const p = world.player;
  pollGamepad();
  leftHeld = keyLeft || gpLeft;
  rightHeld = keyRight || gpRight;
  if (p.ghostFrames > 0) {
    leftHeld = rightHeld = upHeld = false;
  }
  p.breathe += dt * 2;

  if (p.yawning && (!p.onGround || leftHeld || rightHeld || upHeld)) {
    cancelYawn(p);
  }

  if (p.yawning) {
    updateYawn(p, dt);
  } else {
    if (p.yawnCooldown > 0) {
      p.yawnCooldown -= dt * 1000;
    } else {
      const idle =
        p.onGround &&
        Math.abs(p.vx) < 0.05 &&
        Math.abs(p.vy) < 0.05 &&
        !leftHeld &&
        !rightHeld &&
        !upHeld;
      if (idle) {
        p.yawnTimer -= dt * 1000;
        if (p.yawnTimer <= 0) startYawn(p);
      } else {
        p.yawnTimer = randomYawnInterval();
      }
    }
  }

  if (!p.yawning) {
    p.blinkTimer -= dt * 1000;
    if (p.blinkTimer <= 0 && p.blinkDuration <= 0) {
      p.eye = 0;
      p.blinkDuration = 120 + Math.random() * 60;
      if (p.blinkRepeat) {
        p.blinkRepeat = false;
      } else {
        p.blinkRepeat = Math.random() < 0.1;
      }
    }
    if (p.blinkDuration > 0) {
      p.blinkDuration -= dt * 1000;
      if (p.blinkDuration <= 0) {
        p.eye = 1;
        if (p.blinkRepeat) {
          p.blinkTimer = 60 + Math.random() * 40;
        } else {
          p.blinkTimer = randomBlinkInterval();
        }
      }
    }
  }

  p.coyote -= dt * 1000;
  if (p.coyote < 0) p.coyote = 0;
  p.jumpBuffer -= dt * 1000;
  if (p.jumpBuffer < 0) p.jumpBuffer = 0;

  gameTime += dt;

  if (p.dashCooldown > 0) {
    p.dashCooldown -= dt;
    if (p.dashCooldown < 0) p.dashCooldown = 0;
  }
  if (p.dashing) {
    OnDashUpdate.forEach((fn) => fn(p, dt));
    const speed = (dashDistanceTiles * tileSize) / dashDuration;
    const moved = dashMove(p, p.dashDir * speed * dt);
    p.dashProgress += Math.abs(moved);
    p.dashTime += dt;
    if (
      p.dashTime >= dashDuration ||
      p.dashProgress >= dashDistanceTiles * tileSize - 0.1 ||
      moved === 0
    ) {
      p.dashing = false;
      p.vx = p.dashDir * MAX_RUN_SPEED;
      p.vy = 0;
      if (p.onGround) p.airDash = airDashCount;
      p.dashCooldown = dashCooldown;
      OnDashEnd.forEach((fn) => fn(p));
    }
    updateVfx(dt);
    return;
  }

  // Input
  const accel = p.onGround ? RUN_ACCEL : AIR_ACCEL;
  const prevVx = p.vx;
  moveAxis = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);
  if (p.releaseCut) {
    if (moveAxis === 0) {
      p.vx *= RELEASE_DAMP;
      if (Math.abs(p.vx) < STOP_EPS) {
        p.vx = 0;
        p.releaseCut = false;
      }
    } else {
      p.releaseTimer += dt;
      p.vx *= RELEASE_DAMP;
      if (p.releaseTimer >= RELEASE_RESUME) p.releaseCut = false;
    }
  }
  if (!p.releaseCut) {
    if (moveAxis) {
      p.vx += moveAxis * accel;
      p.dir = moveAxis > 0 ? 1 : -1;
    } else {
      if (p.onGround) {
        if (p.vx > 0) {
          p.vx = Math.max(0, p.vx - RUN_DECEL);
        } else if (p.vx < 0) {
          p.vx = Math.min(0, p.vx + RUN_DECEL);
        }
      } else {
        p.vx *= AIR_DECEL;
      }
    }
    if (!moveAxis) {
      if ((prevVx > 0 && p.vx < 0) || (prevVx < 0 && p.vx > 0)) p.vx = 0;
      if (Math.abs(p.vx) < STOP_EPS) p.vx = 0;
    }
  }

  if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
    p.vy = JUMP_VELOCITY;
    p.onGround = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.scaleY = 0.9;
    p.scaleX = 1.1;
  }

  if (!upHeld && p.vy < 0) p.vy *= 0.4; // variable jump

  p.vy += GRAVITY;
  // limit speeds
  p.vx = Math.max(Math.min(p.vx, MAX_RUN_SPEED), -MAX_RUN_SPEED);

  const prevCenterX = p.x + p.w / 2;
  moveAndCollide(p, dt);
  if (p.onGround) p.releaseCut = false;
  if (!moveAxis && Math.abs(p.vx) < STOP_EPS) p.vx = 0;
  updateCoins(dt);
  updateBridgeTeleport();

  const vInst = Math.abs(p.vx * 10);
  if (vInst > vMax) vMax = vInst;
  const centerX = p.x + p.w / 2;
  if (
    !segment.running &&
    prevCenterX < segment.start &&
    centerX >= segment.start
  ) {
    segment.running = true;
    segment.startTime = gameTime;
    segment.done = false;
  }
  if (
    segment.running &&
    !segment.done &&
    prevCenterX < segment.end &&
    centerX >= segment.end
  ) {
    segment.done = true;
    segment.delta = gameTime - segment.startTime;
  }
  updateVfx(dt);
}

function startYawn(p) {
  const s = safeMode ? 0.7 : 1;
  p.yawning = true;
  p.yawnPhase = "a";
  p.yawnTime = 0;
  p.yawnDurA = (150 + Math.random() * 100) * s;
  p.yawnDurP = (600 + Math.random() * 300) * s;
  p.yawnDurC = (300 + Math.random() * 200) * s;
  p.yawnStretch = 0;
  p.yawnTilt = 0;
  p.mouth = 0;
  p.eye = 0.6;
  p.longBlink = false;
}

function cancelYawn(p) {
  p.yawning = false;
  p.yawnStretch = 0;
  p.yawnTilt = 0;
  p.mouth = 0;
  p.eye = 1;
  p.longBlink = false;
  p.yawnCooldown = randomYawnCooldown();
  p.yawnTimer = randomYawnInterval();
}

function endYawn(p) {
  p.yawning = false;
  p.yawnStretch = 0;
  p.yawnTilt = 0;
  p.mouth = 0;
  p.eye = 1;
  p.longBlink = false;
  p.yawnCooldown = randomYawnCooldown();
  p.yawnTimer = randomYawnInterval();
}

function updateYawn(p, dt) {
  const amp = 0.1 * (safeMode ? 0.7 : 1);
  p.yawnTime += dt * 1000;
  if (p.yawnPhase === "a") {
    const t = Math.min(1, p.yawnTime / p.yawnDurA);
    p.yawnStretch = amp * t;
    if (p.yawnTime >= p.yawnDurA) {
      p.yawnPhase = "p";
      p.yawnTime = 0;
      p.mouth = 1;
      p.yawnStretch = amp;
      p.yawnTilt = -0.1 * (safeMode ? 0.7 : 1);
      if (Math.random() < 0.2) {
        p.longBlink = true;
        p.eye = 0;
      } else {
        p.eye = 1;
      }
    }
  } else if (p.yawnPhase === "p") {
    if (p.yawnTime >= p.yawnDurP) {
      p.yawnPhase = "c";
      p.yawnTime = 0;
      if (p.longBlink) {
        p.eye = 1;
        p.longBlink = false;
      }
    }
  } else if (p.yawnPhase === "c") {
    const t = Math.min(1, p.yawnTime / p.yawnDurC);
    p.yawnStretch = amp + (-amp * 0.3 - amp) * t;
    p.mouth = 1 - t;
    p.yawnTilt = -0.1 * (safeMode ? 0.7 : 1) * (1 - t);
    if (p.yawnTime >= p.yawnDurC) {
      endYawn(p);
    }
  }
}

function dashMove(p, dx) {
  if (dx === 0) return 0;
  const startX = p.x;
  let endX = startX + dx;
  if (dx > 0) {
    for (const pl of world.platforms) {
      if (p.y < pl.y + pl.h && p.y + p.h > pl.y) {
        if (pl.y < p.y + p.h - tileSize * 0.25) {
          const stop = pl.x - p.w;
          if (stop >= startX && stop < endX) endX = stop;
        }
      }
    }
  } else {
    for (const pl of world.platforms) {
      if (p.y < pl.y + pl.h && p.y + p.h > pl.y) {
        if (pl.y < p.y + p.h - tileSize * 0.25) {
          const stop = pl.x + pl.w;
          if (stop <= startX && stop > endX) endX = stop;
        }
      }
    }
  }
  p.x = endX;
  return endX - startX;
}

function moveAndCollide(p, dt) {
  if (p.ghostFrames > 0) {
    p.x += p.vx * dt * 10;
    p.y += p.vy * dt * 10;
    p.ghostFrames--;
    return;
  }
  p.x += p.vx * dt * 10;
  for (const pl of world.platforms) {
    if (rectIntersect(p, pl)) {
      if (p.vx > 0) p.x = pl.x - p.w;
      else if (p.vx < 0) p.x = pl.x + pl.w;
      p.vx = 0;
    }
  }
  p.y += p.vy * dt * 10;
  let landed = false;
  for (const pl of world.platforms) {
    if (rectIntersect(p, pl)) {
      if (p.vy > 0) {
        p.y = pl.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.coyote = COYOTE_MS;
        landed = true;
        p.airDash = airDashCount;
      } else if (p.vy < 0) {
        p.y = pl.y + pl.h;
        p.vy = 0;
      }
    }
  }
  if (!landed && p.onGround) {
    p.onGround = false;
    p.coyote = COYOTE_MS;
  }

  // ease scale back
  p.scaleX += (1 - p.scaleX) * 0.1;
  p.scaleY += (1 - p.scaleY) * 0.1;
}

function updateCoins(dt) {
  for (const c of world.coins) {
    c.t += dt;
    if (!c.collected) {
      if (
        rectIntersect(
          {
            x: world.player.x,
            y: world.player.y,
            w: world.player.w,
            h: world.player.h,
          },
          { x: c.x - 10, y: c.y - 10, w: 20, h: 20 },
        )
      ) {
        c.collected = true;
        score++;
      }
    }
  }
}

function updateBridgeTeleport() {
  const p = world.player;
  if (!p) return;
  if (world.gapBridge) {
    const remaining = world.coins.some((c) => !c.collected);
    if (!remaining) {
      const b = world.gapBridge;
      if (!rectIntersect(p, b)) {
        const idx = world.platforms.indexOf(b);
        if (idx >= 0) world.platforms.splice(idx, 1);
        world.gapBridge = null;
        world.teleport = { x: b.x, y: b.y, w: b.w, h: b.h };
        computeWorldBounds();
        rebuildGrid();
      }
    }
  }
  if (world.teleport && rectIntersect(p, world.teleport)) {
    teleportPlayerToTarget();
  }
}

function updateCamera(dt) {
  const p = world.player;
  if (!p) return;

  // --- X axis follows as before ---
  const targetX = p.x + p.w / 2;
  const desiredX = targetX - viewWidth / 2;
  const minCamXSpawn = Math.max(
    worldStartX,
    world.spawnCenterX - viewWidth / 2,
  );
  let clampRight = worldEndX;
  if (cameraRightClamp === "gapStart")
    clampRight = Math.min(clampRight, world.gapStartX);
  else if (cameraRightClamp === "newPlatformEnd")
    clampRight = Math.min(clampRight, world.newPlatformEnd);
  else if (cameraRightClamp === "secondMainEnd")
    clampRight = Math.min(clampRight, world.secondMainRightX);
  const maxCamX = Math.max(worldStartX, clampRight - viewWidth);
  let camX = Math.min(Math.max(desiredX, minCamXSpawn), maxCamX);
  world.camera.x += (camX - world.camera.x) * 0.15;
  if (Math.abs(camX - world.camera.x) < 0.5) world.camera.x = camX;
  world.camera.x = Math.min(Math.max(world.camera.x, minCamXSpawn), maxCamX);

  // --- Y axis with dead-zone and smoothing ---
  let camY = world.camera.y;
  const offsetY = settings.framingTiles * tileSize;
  const anchorWorldY = camY + (viewHeight / 2 - offsetY);
  const zu = settings.camera.deadzoneUpTiles * tileSize;
  const zd = settings.camera.deadzoneDownTiles * tileSize;
  const playerY = p.y + p.h / 2;
  let targetCamY = camY;
  if (settings.camera.followY) {
    if (playerY < anchorWorldY - zu) {
      targetCamY = playerY + zu - (viewHeight / 2 - offsetY);
    } else if (playerY > anchorWorldY + zd) {
      targetCamY = playerY - zd - (viewHeight / 2 - offsetY);
    }
  }
  const alpha = 1 - Math.exp(-settings.camera.lerpPerSec * dt);
  camY = camY + (targetCamY - camY) * alpha;

  const minCamY = worldMinY;
  const maxCamY = Math.max(worldMinY, worldMaxY - viewHeight);
  let clampY = "none";
  if (camY < minCamY) {
    camY = minCamY;
    clampY = "top";
  } else if (camY > maxCamY && playerY <= worldMaxY) {
    camY = maxCamY;
    clampY = "bottom";
  }

  world.camera.y = camY;
  world.camera.framingYTiles = settings.framingTiles;
  world.camera.clampY = clampY;
  world.camera.anchorY = anchorWorldY;
  world.camera.dzUp = zu;
  world.camera.dzDown = zd;
  world.camera.targetY = playerY;
  world.camera.desiredY = targetCamY;

  const screenPlayerY = playerY - world.camera.y;
  const screenAnchorY = viewHeight / 2 - offsetY;
  const applied = Math.round(screenAnchorY - screenPlayerY);
  world.camera.appliedOffsetY = applied;
}

function clampPlayerToCameraX() {
  const p = world.player;
  const camX = world.camera.x;
  const left = camX;
  const right = camX + viewWidth - p.w;
  if (p.x < left) {
    p.x = left;
    p.vx = Math.max(0, p.vx);
    p.releaseCut = false;
    return "left";
  }
  if (p.x > right) {
    p.x = right;
    p.vx = Math.min(0, p.vx);
    p.releaseCut = false;
    return "right";
  }
  return "none";
}

function rectIntersect(a, b) {
  collisionChecks++;
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function render() {
  if (syncCanvas()) rebuildGrid();
  let camX = snap(world.camera.x);
  let camY = snap(world.camera.y);
  let shakeX = 0,
    shakeY = 0;
  if (cameraShakeOn && cameraShakeT < cameraShakeActive) {
    const prog = cameraShakeT / cameraShakeActive;
    const amp = cameraShakeAmp * (1 - prog);
    const t = cameraShakeT * cameraShakeFreq * Math.PI * 2;
    shakeX = Math.sin(t) * amp;
    shakeY = Math.cos(t * 1.3) * amp;
  }
  camX += cameraKickX + shakeX;
  camY += shakeY;
  const sd = canvasScale * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(sd, 0, 0, sd, offsetX * dpr, offsetY * dpr);
  drawParallax(camX, camY);
  renderGrid(ctx, camX, camY);
  ctx.setTransform(
    sd,
    0,
    0,
    sd,
    offsetX * dpr - camX * sd,
    offsetY * dpr - camY * sd,
  );
  drawPlatforms();
  if (world.teleport) drawTeleport(world.teleport);
  drawCoins();
  drawPlayer();
  drawTeleportDebugMarker();
  if (paused) clearVfx();
  else drawVfx();
  ctx.setTransform(sd, 0, 0, sd, offsetX * dpr, offsetY * dpr);
  if (deadZoneDebug) {
    const offsetY = settings.framingTiles * tileSize;
    const anchorScreenY = viewHeight / 2 - offsetY;
    const zu = world.camera.dzUp || 0;
    const zd = world.camera.dzDown || 0;
    ctx.save();
    ctx.fillStyle = "rgba(255,0,0,0.2)";
    ctx.strokeStyle = "rgba(255,0,0,0.5)";
    ctx.fillRect(0, anchorScreenY - zu, viewWidth, zu + zd);
    ctx.strokeRect(0, anchorScreenY - zu, viewWidth, zu + zd);
    ctx.restore();
  }
  if (DEBUG) drawHUD();
  gridDrawnPrev = gridDrawnNow;
}

function buildParallaxLayers() {
  if (!parallaxEnabled) return;
  const ground = world.platforms[0];
  const groundY = ground ? ground.y : viewHeight;
  const hillsFarY = groundY - tileSize * 3.7;
  const hillsMidY = groundY - tileSize * 2.7;
  const shrubsY = groundY - tileSize * 1.2;
  const segW = Math.max(2048, Math.ceil(viewWidth * 1.5));
  const outline = 2.5 / eff;

  const makeHills = (light, shadow) => {
    const h = 400;
    const canvas = document.createElement("canvas");
    canvas.width = segW;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.lineWidth = outline;
    g.lineJoin = g.lineCap = "round";
    const base = h * 0.75;
    const waves = Math.ceil(segW / 300);
    const path = new Path2D();
    path.moveTo(0, base);
    for (let i = 0; i < waves; i++) {
      const x0 = i * (segW / waves);
      const xc = x0 + segW / waves / 2;
      const peak = base - 60 - Math.random() * 40;
      const x1 = x0 + segW / waves;
      path.quadraticCurveTo(xc, peak, x1, base);
    }
    path.lineTo(segW, h);
    path.lineTo(0, h);
    path.closePath();
    g.fillStyle = light;
    g.fill(path);
    g.save();
    g.clip(path);
    g.fillStyle = shadow;
    g.fillRect(0, base, segW, h - base);
    g.restore();
    g.strokeStyle = "#000";
    g.stroke(path);
    return { canvas, width: segW, height: h };
  };

  const makeShrubs = () => {
    const h = 200;
    const canvas = document.createElement("canvas");
    canvas.width = segW;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.lineWidth = outline;
    g.lineJoin = g.lineCap = "round";
    const base = h;
    const count = Math.ceil(segW / 160);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * segW;
      const s = 20 + Math.random() * 20;
      g.save();
      g.translate(x, base);
      const path = new Path2D();
      path.moveTo(-s, 0);
      path.lineTo(0, -s * 1.5);
      path.lineTo(s, 0);
      path.closePath();
      g.fillStyle = "#3f9d4b";
      g.fill(path);
      g.save();
      g.clip(path);
      g.fillStyle = "#2f7a3a";
      g.fillRect(0, -s * 1.5, s, s * 1.5);
      g.restore();
      g.strokeStyle = "#000";
      g.stroke(path);
      g.restore();
    }
    return { canvas, width: segW, height: h };
  };

  const hillsFar = makeHills("#2d6a35", "#234d2b");
  const hillsMid = makeHills("#3f9d4b", "#2f7a3a");
  const shrubs = makeShrubs();

  parallax.segments = {
    hillsFar: {
      ...hillsFar,
      baseY: hillsFarY - hillsFar.height,
      px: 0.1,
      py: 0.08,
    },
    hillsMid: {
      ...hillsMid,
      baseY: hillsMidY - hillsMid.height,
      px: 0.2,
      py: 0.12,
    },
    shrubs: { ...shrubs, baseY: shrubsY - shrubs.height, px: 0.35, py: 0.15 },
  };

  parallax.clouds = [];
  const cloudCount = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < cloudCount; i++) {
    parallax.clouds.push({
      x: Math.random() * (viewWidth + 400) - 200,
      y: 60 + Math.random() * 120,
      r: 20 + Math.random() * 20,
      speed: 6 + Math.random() * 6,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function drawParallax(camX, camY) {
  if (!parallaxEnabled || !parallax.segments.hillsFar) {
    const bgOffset = snap(camX * 0.2);
    drawBackground(bgOffset);
    return;
  }
  const w = viewWidth;
  const h = viewHeight;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#4a90e2");
  sky.addColorStop(1, "#87ceeb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sunX = w * 0.8 - camX * 0.05;
  const sunY = 100 - camY * 0.05;
  const sunR = 80;
  const grad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunR);
  grad.addColorStop(0, "#fff5a0");
  grad.addColorStop(1, "rgba(255,255,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  const drawLayer = (seg) => {
    const s = seg;
    let x = -(camX * s.px) % s.width;
    if (x > 0) x -= s.width;
    const y = s.baseY - camY * s.py;
    while (x < w) {
      ctx.drawImage(s.canvas, Math.round(x), Math.round(y));
      perf.counts.sprites++;
      x += s.width;
    }
  };
  drawLayer(parallax.segments.hillsFar);
  drawLayer(parallax.segments.hillsMid);

  const lw = 2.5 / eff;
  ctx.lineWidth = lw;
  ctx.lineJoin = ctx.lineCap = "round";
  for (const c of parallax.clouds) {
    c.x += c.speed * dt;
    const sx = c.x - camX * 0.15;
    const sy = c.y + Math.sin(gameTime * 0.5 + c.phase) * 5 - camY * 0.1;
    perf.counts.sprites++;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.beginPath();
    ctx.arc(-2 * c.r, 0, c.r, 0, Math.PI * 2);
    ctx.arc(-c.r, -c.r * 0.6, c.r * 1.2, 0, Math.PI * 2);
    ctx.arc(0, 0, c.r * 1.4, 0, Math.PI * 2);
    ctx.arc(c.r, -c.r * 0.6, c.r * 1.2, 0, Math.PI * 2);
    ctx.arc(2 * c.r, 0, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(180,200,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(0, c.r * 0.3, 2.4 * c.r, c.r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (sx > w + 200) {
      c.x = camX * 0.15 - 200;
      c.y = 60 + Math.random() * 120;
    }
  }

  drawLayer(parallax.segments.shrubs);
}

function drawBackground(offset) {
  const w = viewWidth,
    h = viewHeight;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#4a90e2");
  grad.addColorStop(1, "#87ceeb");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  if (!safeMode) {
    ctx.fillStyle = "#a0d0ff";
    const cloudOffset = Math.round(offset * 0.3 * eff) / eff;
    for (let i = 0; i < 3; i++) {
      const x =
        Math.round((((cloudOffset + i * 200) % (w + 200)) - 200) * eff) / eff;
      ctx.beginPath();
      ctx.arc(x, 100 + i * 30, 80, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function renderGrid(ctx, camX, camY) {
  if (!gridEnabled) {
    gridDrawnNow = false;
    return;
  }
  const camTileX = Math.floor(camX / tileSize);
  const camTileY = Math.floor(camY / tileSize);
  if (
    gridCache.tile !== tileSize ||
    gridCache.scale !== canvasScale ||
    gridCache.step !== gridStep ||
    gridCache.camTileX !== camTileX ||
    gridCache.camTileY !== camTileY
  ) {
    buildGrid(camTileX, camTileY);
  }
  const sd = canvasScale * dpr;
  const dx = Math.round((gridOriginX - camX) * sd) + offsetX * dpr;
  const dy = Math.round((gridOriginY - camY) * sd) + offsetY * dpr;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gridCanvas, dx, dy);
  ctx.imageSmoothingEnabled = prevSmooth;
  ctx.restore();
  gridDrawnNow = true;
}

function drawPlatform(pl) {
  perf.counts.sprites++;
  ctx.save();
  ctx.translate(pl.x, pl.y);
  const tileH = PLATFORM_HEIGHT;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#7b4f28";
  ctx.fillRect(0, 0, pl.w, pl.h);
  for (let y = 0; y < pl.h; y += tileH) {
    ctx.fillStyle = "#8e5b32";
    ctx.fillRect(0, y, pl.w, tileH / 2);
    ctx.fillStyle = "#5e3a1a";
    ctx.fillRect(0, y + tileH / 2, pl.w, tileH / 2);
  }
  ctx.strokeRect(0, 0, pl.w, pl.h);
  ctx.fillStyle = "#4caf50";
  ctx.fillRect(0, -4, pl.w, 8);
  for (let x = 0; x < pl.w; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, -4);
    ctx.lineTo(x + 3, 0);
    ctx.lineTo(x + 6, -4);
    ctx.fill();
  }
  if (pl.flash) {
    const clr = pl.flash === "red" ? "rgba(255,0,0,0.4)" : "rgba(0,255,0,0.4)";
    ctx.fillStyle = clr;
    ctx.fillRect(0, 0, pl.w, pl.h);
    pl.flash = null;
  }
  ctx.restore();
}

function drawPlatforms() {
  for (const pl of world.platforms) drawPlatform(pl);
}

function drawTeleport(tp) {
  perf.counts.sprites++;
  ctx.fillStyle = "#000";
  ctx.fillRect(tp.x, tp.y, tp.w, tp.h);
}

function drawTeleportDebugMarker() {
  if (!DEBUG) return;
  const size = 4;
  const x = LEVEL_START_PX.x;
  const y = LEVEL_START_PX.y;
  ctx.strokeStyle = "#f00";
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x - size, y + size);
  ctx.lineTo(x + size, y - size);
  ctx.stroke();
}

function drawCoin(c) {
  if (c.collected) return;
  perf.counts.sprites++;
  ctx.save();
  ctx.translate(c.x, c.y);
  const scale = 1 + Math.sin(c.t * 4) * 0.1;
  ctx.scale(scale, 1);
  ctx.beginPath();
  ctx.fillStyle = "#ffd700";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const grad = ctx.createRadialGradient(-3, -3, 2, 0, 0, 10);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  const t = (c.t % 1.2) / 1.2;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(
    0,
    0,
    10,
    -Math.PI / 4 + t * Math.PI * 2,
    -Math.PI / 4 + t * Math.PI * 2 + 0.5,
  );
  ctx.stroke();
  ctx.restore();
}

function drawCoins() {
  for (const c of world.coins) drawCoin(c);
}

function drawPlayer() {
  const p = world.player;
  perf.counts.sprites++;
  const groundY = getGroundY(p);
  const shadowScale = Math.max(0.2, Math.min(1, (groundY - (p.y + p.h)) / 100));
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(
    p.x + p.w / 2,
    groundY - 5,
    (p.w / 2) * shadowScale,
    (p.h / 6) * shadowScale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  const breathe = 1 + Math.sin(p.breathe) * 0.02;
  ctx.scale(p.scaleX * breathe, (p.scaleY / breathe) * (1 + p.yawnStretch));
  ctx.rotate(p.yawnTilt);
  ctx.beginPath();
  ctx.fillStyle = "#76e3a6";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6ac395";
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h / 2);
  ctx.fillStyle = "#84f7bd";
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h / 4);
  // eyes
  ctx.fillStyle = "#000";
  const eyeY = -p.h * 0.1;
  const eyeOffset = p.dir * 4;
  const drawEye = (open) => {
    if (open >= 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (open <= 0) {
      ctx.fillRect(-3, -1, 6, 2);
    } else {
      ctx.save();
      ctx.scale(1, open);
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
  ctx.save();
  ctx.translate(-8 + eyeOffset, eyeY);
  drawEye(p.eye);
  ctx.restore();
  ctx.save();
  ctx.translate(8 + eyeOffset, eyeY);
  drawEye(p.eye);
  ctx.restore();
  // mouth
  if (p.mouth > 0) {
    ctx.beginPath();
    ctx.fillStyle = "#000";
    ctx.ellipse(0, 8, 8 * p.mouth, 12 * p.mouth, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.moveTo(-8, 8);
    ctx.quadraticCurveTo(0, 12, 8, 8);
    ctx.stroke();
  }
  ctx.restore();
}

function getGroundY(p) {
  let gy = p.y + p.h + 100;
  for (const pl of world.platforms) {
    if (p.x + p.w > pl.x && p.x < pl.x + pl.w && pl.y >= p.y + p.h && pl.y < gy)
      gy = pl.y;
  }
  return gy;
}

function drawHUD() {
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 3;
  ctx.font = "14px monospace";
  ctx.textBaseline = "top";

  let y = 20;
  const times = perf.frameTimes.slice().sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  const p99 = times[Math.floor(times.length * 0.99)] || 0;
  const p999 = times[Math.floor(times.length * 0.999)] || 0;
  const fpsAvg = avg ? 1000 / avg : 0;
  const fps1 = p99 ? 1000 / p99 : 0;
  const fps01 = p999 ? 1000 / p999 : 0;
  const fpsLine = `FPS ${fpsAvg.toFixed(1)} / ${fps1.toFixed(1)} / ${fps01.toFixed(1)}`;
  ctx.strokeText(fpsLine, 20, y);
  ctx.fillText(fpsLine, 20, y);
  y += 20;
  const frameLine =
    `frame ${perf.frameMs.toFixed(1)} ms, update ${perf.updateMs.toFixed(1)} ms, render ${perf.renderMs.toFixed(1)} ms`;
  ctx.strokeText(frameLine, 20, y);
  ctx.fillText(frameLine, 20, y);
  y += 20;
  if (performance.memory) {
    const heapLine = `heapUsed ${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB`;
    ctx.strokeText(heapLine, 20, y);
    ctx.fillText(heapLine, 20, y);
    y += 20;
  }
  const countLine =
    `counts e:${perf.counts.entities} s:${perf.counts.sprites} vfx:${perf.counts.particles} coll:${perf.counts.collisions}`;
  ctx.strokeText(countLine, 20, y);
  ctx.fillText(countLine, 20, y);
  y += 20;

  const tiles = world.camera.framingYTiles || 0;
  const offPix = Math.round(world.camera.appliedOffsetY || 0);
  const clamp = world.camera.clampY || "none";
  const camY = Math.round(world.camera.y);
  const camX = Math.round(world.camera.x);
  const camCenterX = Math.round(world.camera.x + viewWidth / 2);
  const camCenterTX = ((world.camera.x + viewWidth / 2) / tileSize).toFixed(1);
  const minCamXSpawn = Math.max(
    worldStartX,
    world.spawnCenterX - viewWidth / 2,
  );
  const clampX =
    camX <= Math.round(minCamXSpawn)
      ? "left"
      : camX >= Math.round(Math.max(worldStartX, worldEndX - viewWidth))
        ? "right"
        : "none";
  const line = `Framing: tiles=${tiles} | offY=${offPix} | clampY=${clamp} | CamY=${camY} | CamX=${camCenterX} (t=${camCenterTX}) | clampX=${clampX} | clampX=${world.camera.clampX || "none"}`;
  ctx.strokeText(line, 20, y);
  ctx.fillText(line, 20, y);
  y += 20;

  const camLine = `C x=${camCenterX} px (t=${camCenterTX})`;
  const player = world.player;
  const playerLine = `P x=${Math.round(player.x)} px (t=${(player.x / tileSize).toFixed(1)})`;
  ctx.strokeText(camLine, 20, y);
  ctx.fillText(camLine, 20, y);
  y += 20;
  ctx.strokeText(playerLine, 20, y);
  ctx.fillText(playerLine, 20, y);
  y += 20;

  const viewLine = `View: ${viewWidth}×${viewHeight}`;
  ctx.strokeText(viewLine, 20, y);
  ctx.fillText(viewLine, 20, y);
  y += 20;

  const genLine = `Gen: layers=${lastGen.layers} stepX=${Math.round(lastGen.stepX)} stepY=${Math.round(lastGen.stepY)} seed=${lastGen.seed}`;
  ctx.strokeText(genLine, 20, y);
  ctx.fillText(genLine, 20, y);

  const ver = "v" + GAME_VERSION;
  ctx.strokeText(ver, viewWidth - 80, viewHeight - 20);
  ctx.fillText(ver, viewWidth - 80, viewHeight - 20);

  if (inputHUD) {
    const inputLine = `L:${leftHeld ? 1 : 0} R:${rightHeld ? 1 : 0} move:${moveAxis} vx:${player.vx.toFixed(2)} last:${lastInputEvent}`;
    ctx.strokeText(inputLine, 20, viewHeight - 40);
    ctx.fillText(inputLine, 20, viewHeight - 40);
  }

  ctx.restore();
}

function updateGridButtons() {
  if (gridBtn) gridBtn.textContent = "Grid: " + (gridEnabled ? "On" : "Off");
  if (stepBtn)
    stepBtn.textContent = "Step: " + (gridStep === 5 ? "5×5" : "1×1");
  if (parallaxBtn)
    parallaxBtn.textContent =
      "Parallax: " + (parallaxEnabled ? "On" : "Off");
  if (vfxBtn) vfxBtn.textContent = "VFX: " + (vfxEnabled ? "On" : "Off");
  if (shakeBtn)
    shakeBtn.textContent = "Shake: " + (cameraShakeOn ? "On" : "Off");
}

function toggleGrid() {
  gridEnabled = !gridEnabled;
  localStorage.setItem(GRID_ENABLED_KEY, gridEnabled);
  updateGridButtons();
  rebuildGrid();
}

function toggleGridStep() {
  gridStep = gridStep === 1 ? 5 : 1;
  localStorage.setItem(GRID_STEP_KEY, gridStep);
  updateGridButtons();
  rebuildGrid();
}

function toggleParallax() {
  parallaxEnabled = !parallaxEnabled;
  updateGridButtons();
  buildParallaxLayers();
}

function toggleVfx() {
  vfxEnabled = !vfxEnabled;
  updateGridButtons();
}

function toggleShake() {
  cameraShakeOn = !cameraShakeOn;
  updateGridButtons();
}

function downloadSpikes() {
  if (!spikeLog.length) return;
  const blob = new Blob([JSON.stringify(spikeLog, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "perf_spikes.json";
  a.click();
  URL.revokeObjectURL(url);
}

function setupMenu() {
  const menu = document.getElementById("menu");
  const mainMenu = document.getElementById("menu-main");
  const settingsMenu = document.getElementById("menu-settings");
  const startBtn = document.getElementById("btn-start");
  const settingsBtn = document.getElementById("btn-settings");
  const backBtn = document.getElementById("btn-back");
  const diffRadios = document.querySelectorAll('input[name="difficulty"]');

  const show = (screen) => {
    resetInput(true);
    mainMenu.classList.toggle("hidden", screen !== "main");
    settingsMenu.classList.toggle("hidden", screen !== "settings");
    menu.style.display = "flex";
    paused = true;
    if (audioCtx) audioCtx.suspend();
  };

  const hide = () => {
    menu.style.display = "none";
    paused = false;
    if (audioCtx) audioCtx.resume();
  };

  const newGame = () => {
    applyDifficulty(currentDifficulty);
    score = 0;
    levelSeed = Date.now();
    measureReachability();
    generateLevel(levelSeed, 4);
    resetPlayerToGround();
    resetInput();
    hide();
  };

  startBtn.addEventListener("click", newGame);
  settingsBtn.addEventListener("click", () => show("settings"));
  backBtn.addEventListener("click", () => show("main"));

  diffRadios.forEach((r) =>
    r.addEventListener("change", (e) => {
      currentDifficulty = e.target.value;
      localStorage.setItem(DIFF_KEY, currentDifficulty);
      resetInput();
    }),
  );
  const saved = document.querySelector(
    `input[name="difficulty"][value="${currentDifficulty}"]`,
  );
  if (saved) saved.checked = true;

  window.addEventListener("keydown", (e) => {
    if (menu.style.display !== "none") {
      if (!mainMenu.classList.contains("hidden")) {
        if (e.code === "Enter") {
          newGame();
          e.preventDefault();
        } else if (e.code === "Escape") {
          hide();
          e.preventDefault();
        }
      } else {
        if (e.code === "Escape" || e.code === "Backspace") {
          show("main");
          e.preventDefault();
        }
      }
    } else if (e.code === "Escape") {
      show("main");
      e.preventDefault();
    }
  });

  show("main");
}
