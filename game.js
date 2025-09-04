const GAME_VERSION = self.GAME_VERSION;
if(self.BOOT) self.BOOT.script = true;

function asArray(v){ return Array.isArray(v)?v:[]; }

const VIRTUAL_HEIGHT = 810;
const tileSize = 60;

const CLAMP_PLAYER_TO_CAMERA_X = true;

const PARALLAX_ENABLED = true;
const parallax = { segments:{}, clouds:[] };

let canvas, ctx;
let dpr = 1, canvasScale = 1, offsetX = 0, offsetY = 0, eff = 1;
let viewWidth = Math.round(VIRTUAL_HEIGHT * (self.innerWidth / self.innerHeight));
let viewHeight = VIRTUAL_HEIGHT;
let cssWidth = 0, cssHeight = 0;
let last = 0, acc = 0, fps = 60, fpsTime = 0, frameCount = 0;
const dt = 1/60;
let safeMode = false;
let score = 0;
let isReady = false;
let loader = null;
const HUD_EXT_KEY = 'platformer.debug.hud.extended';
let hudExtended = localStorage.getItem(HUD_EXT_KEY) === 'true';
let paused = true;

const GRID_ENABLED_KEY = 'platformer.debug.grid.enabled';
const GRID_STEP_KEY = 'platformer.debug.grid.step';
let gridEnabled = localStorage.getItem(GRID_ENABLED_KEY) === 'true';
let gridStep = parseInt(localStorage.getItem(GRID_STEP_KEY),10);
if(gridStep !== 5) gridStep = 1;
let gridBtn = null;
let stepBtn = null;
let deadZoneDebug = false;

const DIFF_KEY = 'platformer.difficulty.v1';
const FRAMING_KEY = 'platformer.camera.framingTiles';
// Difficulty multipliers relative to Easy base values
const DIFF_FACTORS = { Easy:1.00, Normal:1.60, Hard:2.20 };

const settings = {
  framingTiles: -3.75,
  camera: {
    followY: true,
    deadzoneUpTiles: 6.0,
    deadzoneDownTiles: 1.0,
    lerpPerSec: 10.0
  }
};

const storedFraming = parseFloat(localStorage.getItem(FRAMING_KEY));
if(!isNaN(storedFraming)) settings.framingTiles = Math.max(-8, Math.min(8, storedFraming));

const base = {
  maxRunSpeed: 6.0 * 3.5 * 2.20, // rebased from previous Hard
  runAccel: 6.0 * 3.0 * 2.20,
  runDecel: 0.7 * 2.20
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

let currentDifficulty = localStorage.getItem(DIFF_KEY) || 'Easy';
if(!DIFF_FACTORS[currentDifficulty]) currentDifficulty = 'Easy';

function applyDifficulty(diff){
  const factor = DIFF_FACTORS[diff] || 1;
  MAX_RUN_SPEED = base.maxRunSpeed * factor;
  RUN_ACCEL = base.runAccel * factor;
  const t = dt * 10;
  const denom = 2 * STOP_DIST - MAX_RUN_SPEED * t;
  RUN_DECEL = denom > 0 ? (MAX_RUN_SPEED * MAX_RUN_SPEED * t) / denom : MAX_RUN_SPEED;
  if(world.platforms.length){
    measureReachability();
    adjustCoinPlatforms();
  }
}

function randomBlinkInterval(){
  return Math.random() < 0.5
    ? 2000 + Math.random()*1500
    : 3000 + Math.random()*2250;
}

function randomYawnInterval(){
  return Math.random() < 0.5
    ? 6000 + Math.random()*3000
    : 10000 + Math.random()*5000;
}

function randomYawnCooldown(){
  return 10000 + Math.random()*5000;
}

let leftHeld = false, rightHeld = false, upHeld = false;
let keyLeft = false, keyRight = false;
let gpLeft = false, gpRight = false, prevGpLeft = false, prevGpRight = false;
let moveAxis = 0;
const AIR_DECEL = 0.98;
const STOP_EPS = 0.05; // ~0.5px/s
const RELEASE_CUT = 0.5;
const RELEASE_DAMP = Math.pow(0.05, dt/0.30);
const RELEASE_RESUME = 0.05; // 50ms
let lastInputEvent = '';

let inputHUD = false;

const world = { platforms:[], coins:[], player:null, spawnCenterX:0, camera:{x:0,y:0, framingYTiles:settings.framingTiles, targetY:0, desiredY:0, clampY:'none', appliedOffsetY:0, anchorY:0, dzUp:0, dzDown:0} };
let worldStartX = 0, worldEndX = 0, worldMinY = 0, worldMaxY = 0, worldWidthPx = 0;
let worldMode = 'detected';

let gridSegments = [];
let gridMinY = 0;
let gridMaxY = 0;
let gridCacheKey = '';
let gridDrawnPrev = false;
let gridDrawnNow = false;

const REACH_SAFE_Y = 0.75;
const REACH_SAFE_X = 0.80;
let reachV = 0, reachH0 = 0, reachHrun = 0;
let fixedCoins = 0, unreachableCoins = 0;
let movedCoinPlatforms = 0, clampedCoinPlatforms = 0;

const snap = v => Math.round(v * eff) / eff;

function resetInput(release=false){
  keyLeft = keyRight = upHeld = false;
  gpLeft = gpRight = prevGpLeft = prevGpRight = false;
  leftHeld = rightHeld = false;
  moveAxis = 0;
  const p = world.player;
  if(p){
    if(release && !p.onGround){
      startAirReleaseCut();
    }else{
      p.vx = 0;
      p.releaseCut = false;
    }
  }
}

function startAirReleaseCut(){
  const p = world.player;
  if(!p || p.onGround) return;
  p.vx *= RELEASE_CUT;
  p.releaseCut = true;
  p.releaseTimer = 0;
}

function pollGamepad(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : null;
  if(!pads) return;
  const gp = pads[0];
  if(!gp){
    if(prevGpLeft || prevGpRight) startAirReleaseCut();
    gpLeft = gpRight = prevGpLeft = prevGpRight = false;
    return;
  }
  const ax = gp.axes[0] || 0;
  const left = ax < -0.5;
  const right = ax > 0.5;
  if((prevGpLeft && !left) || (prevGpRight && !right)) startAirReleaseCut();
  prevGpLeft = gpLeft = left;
  prevGpRight = gpRight = right;
}

let vMax = 0;
const segment = {start:-400,end:800,startTime:0,delta:0,running:false,done:false};
let gameTime = 0;

function resetSegment(){
  vMax = 0;
  segment.running=false;
  segment.done=false;
  segment.startTime=0;
  segment.delta=0;
}

function computeWorldBounds(){
  const tile = 60;
  const TAIL_TILES = 3;
  const tailX = TAIL_TILES * tile;
  const topPadTiles = Math.max(12, Math.abs(settings.framingTiles) + 6);
  const bottomPadTiles = Math.max(6, TAIL_TILES);
  const topPad = topPadTiles * tile;
  const bottomPad = bottomPadTiles * tile;
  let minX = Infinity, maxX = -Infinity;
  worldMinY = Infinity;
  worldMaxY = -Infinity;
  for(const pl of world.platforms){
    minX = Math.min(minX, pl.x);
    maxX = Math.max(maxX, pl.x + pl.w);
    worldMinY = Math.min(worldMinY, pl.y);
    worldMaxY = Math.max(worldMaxY, pl.y + pl.h);
  }
  for(const c of world.coins){
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    worldMinY = Math.min(worldMinY, c.y);
    worldMaxY = Math.max(worldMaxY, c.y);
  }
  const p = world.player;
  if(p){
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
    worldMinY = Math.min(worldMinY, p.y);
    worldMaxY = Math.max(worldMaxY, p.y + p.h);
  }
  if(minX === Infinity){
    minX = 0; maxX = 0; worldMinY = 0; worldMaxY = 0;
  }
  if(worldMinY === Infinity) worldMinY = 0;
  if(worldMaxY === -Infinity) worldMaxY = 0;
  minX = Math.min(minX, 0) - tailX;
  maxX = maxX + tailX;
  worldMinY -= topPad;
  worldMaxY += bottomPad;

  // Ensure camera can reach desired offset when player stands on ground
  const ground = world.platforms[0];
  if(ground && p){
    const playerY = ground.y - p.h/2;
    const offsetY = settings.framingTiles * tile;
    const desiredCamY = playerY - (viewHeight/2 - offsetY);
    const minAllowed = desiredCamY - 2 * tile;
    if(worldMinY > minAllowed) worldMinY = minAllowed;
  }

  const detectedTiles = Math.ceil((maxX - minX) / tile);
  worldMode = 'detected';
  if(detectedTiles < 1440){
    worldMode = 'fallback';
    const half = (1440 / 2) * tile;
    minX = -half;
    maxX = half;
  }
  worldStartX = minX;
  worldEndX = maxX;
  worldWidthPx = worldEndX - worldStartX;
  buildParallaxLayers();
}

function measureReachability(){
  const dtl = dt;
  let y=0, vy=JUMP_VELOCITY, maxY=0;
  while(true){
    vy += GRAVITY;
    y += vy*dtl*10;
    if(y<maxY) maxY=y;
    if(y>=0) break;
  }
  reachV = -maxY;
  const simDist = startVx=>{
    let x=0, y=0, vx=startVx, vy=JUMP_VELOCITY;
    while(true){
      vx += AIR_ACCEL;
      if(vx>MAX_RUN_SPEED) vx=MAX_RUN_SPEED;
      vy += GRAVITY;
      x += vx*dtl*10;
      y += vy*dtl*10;
      if(y>=0) break;
    }
    return x;
  };
  reachH0 = simDist(0);
  reachHrun = simDist(MAX_RUN_SPEED);
}

function adjustCoinPlatforms(){
  const ground = world.platforms[0];
  const pairs = [];
  for(const c of world.coins){
    const pl = world.platforms.find(p=>c.x>=p.x && c.x<=p.x+p.w);
    if(pl) pairs.push({pl,c});
  }
  const maxV = reachV * REACH_SAFE_Y;
  const maxH = reachHrun * REACH_SAFE_X;
  const player = world.player || {w:40};
  const minLanding = player.w * 1.5;
  fixedCoins = 0;
  unreachableCoins = 0;

  const findSupport = pl=>{
    let best = ground;
    let bestMetric = Infinity;
    for(const p of world.platforms){
      if(p===pl) continue;
      const dx = pl.x - (p.x + p.w);
      const dy = p.y - pl.y;
      if(dx >= 0 && dy >= 0){
        const m = dx + dy;
        if(m < bestMetric){ bestMetric = m; best = p; }
      }else if(dx < 0 && dy >= 0 && p.x < pl.x + pl.w && p.x + p.w > pl.x){
        const m = dy;
        if(m < bestMetric){ bestMetric = m; best = p; }
      }
    }
    return best;
  };

  const unresolved = [];

  for(const {pl,c} of pairs){
    if(pl.w < minLanding) pl.w = minLanding;
    const support = findSupport(pl);
    let changed = false;

    // vertical adjustment
    let diffY = support.y - pl.y;
    if(diffY > maxV){
      let newY = support.y - maxV;
      for(const other of world.platforms){
        if(other===pl) continue;
        if(pl.x < other.x + other.w && pl.x + pl.w > other.x){
          if(newY + pl.h > other.y && newY < other.y + other.h){
            newY = other.y - pl.h;
          }
        }
      }
      const dy = newY - pl.y;
      if(dy){
        pl.y = newY;
        c.y += dy;
        changed = true;
      }
      diffY = support.y - pl.y;
    }

    // horizontal adjustment
    let gap = pl.x - (support.x + support.w);
    if(gap > maxH){
      let newX = pl.x - (gap - maxH);
      for(const other of world.platforms){
        if(other===pl) continue;
        if(newX < other.x + other.w && newX + pl.w > other.x){
          newX = other.x + other.w;
        }
      }
      const dx = newX - pl.x;
      if(dx){
        pl.x = newX;
        c.x += dx;
        changed = true;
      }
      gap = pl.x - (support.x + support.w);
    }

    if(diffY <= maxV && gap <= maxH){
      if(changed){
        fixedCoins++;
        pl.flash = 'green';
      }
    }else{
      unresolved.push({pl,c,support});
      unreachableCoins++;
      pl.flash = 'red';
    }
  }

  if(unresolved.length){
    const shift = 2 * tileSize;
    for(const item of unresolved){
      const {pl,c,support} = item;
      let newY = pl.y + shift;
      for(const other of world.platforms){
        if(other===pl) continue;
        if(pl.x < other.x + other.w && pl.x + pl.w > other.x){
          if(newY + pl.h > other.y && newY < other.y + other.h){
            newY = other.y - pl.h;
          }
        }
      }
      const dy = newY - pl.y;
      if(dy){ pl.y = newY; c.y += dy; }
      const diffY = support.y - pl.y;
      const gap = pl.x - (support.x + support.w);
      if(diffY <= maxV && gap <= maxH){
        fixedCoins++;
        unreachableCoins--;
        pl.flash = 'green';
      }else{
        pl.flash = 'red';
      }
    }
  }

  computeWorldBounds();
  rebuildGrid();
}

function lowerCoinPlatforms(){
  const delta = 4 * tileSize;
  const minGap = 0.5 * tileSize;
  movedCoinPlatforms = 0;
  clampedCoinPlatforms = 0;
  for(const pl of world.platforms){
    if(pl.w >= 6 * tileSize || pl.type === 'large' || pl.tag === 'large' || pl.support) continue;
    const coins = world.coins.filter(c => c.x >= pl.x && c.x <= pl.x + pl.w);
    if(!coins.length) continue;
    const offsets = coins.map(c => c.y - pl.y);
    let targetY = pl.y + delta;
    for(const other of world.platforms){
      if(other === pl) continue;
      if(pl.x < other.x + other.w && pl.x + pl.w > other.x && other.y >= pl.y){
        const limit = other.y - pl.h - minGap;
        if(targetY > limit) targetY = limit;
      }
    }
    const dy = targetY - pl.y;
    if(dy > 0){
      pl.y = targetY;
      coins.forEach((c,i)=>{ c.y = pl.y + offsets[i]; });
      movedCoinPlatforms++;
      if(dy < delta) clampedCoinPlatforms++;
    }
  }
}

function rebuildGrid(){
  const tile = 60;
  const step = gridStep;
  const startX = Math.floor(worldStartX/(step*tile))*step*tile;
  const endX = Math.ceil(worldEndX/(step*tile))*step*tile;
  worldWidthPx = endX - startX;
  const fallbackTiles = 720;
  const padTiles = Math.max(fallbackTiles, Math.ceil((viewHeight/ tile) * 1.5));
  const pad = padTiles * tile;
  let minY = worldMinY - pad;
  let maxY = worldMaxY + pad;
  const needed = 1440 * tile;
  if((maxY - minY) < needed){
    const extra = (needed - (maxY - minY)) / 2;
    minY -= extra;
    maxY += extra;
  }
  minY = Math.floor(minY/(step*tile))*step*tile;
  maxY = Math.ceil(maxY/(step*tile))*step*tile;
  gridMinY = minY;
  gridMaxY = maxY;
  const height = maxY - minY;
  const baseThin = Math.ceil(eff) / eff;
  const baseBold = Math.ceil(2 * eff) / eff;
  const key = [gridEnabled,step,tile,dpr,canvasScale,startX,endX,minY,maxY].join('|');
  if(key === gridCacheKey) return;
  gridCacheKey = key;
  gridSegments = [];
  if(!gridEnabled) return;
  const SEG_W = 4096;
  for(let sx=startX; sx<endX; sx+=SEG_W){
    const segW = Math.min(SEG_W, endX - sx);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(segW*dpr));
    canvas.height = Math.max(1, Math.round(height*dpr));
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.setTransform(dpr,0,0,dpr,0,0);
    g.translate(-sx,-minY);
    g.font = '12px sans-serif';
    g.textBaseline = 'top';
    const vxStart = Math.ceil(sx/(step*tile))*step*tile;
    for(let x=vxStart; x<=sx+segW; x+=step*tile){
      const idx = Math.round(x/tile);
      const major = idx%10===0;
      const color = major?'rgba(255,255,255,0.55)':'rgba(255,255,255,0.25)';
      const thickness = major?baseBold:baseThin;
      const lx = snap(x);
      g.fillStyle = color;
      g.fillRect(lx, minY, thickness, height);
      if(major){
        g.fillText(idx, lx+2, minY+2);
      }
    }
    const hyStart = Math.ceil(minY/(step*tile))*step*tile;
    for(let y=hyStart; y<=maxY; y+=step*tile){
      const idx = Math.round(y/tile);
      const major = idx%10===0;
      const color = major?'rgba(255,255,255,0.55)':'rgba(255,255,255,0.25)';
      const thickness = major?baseBold:baseThin;
      const ly = snap(y);
      g.fillStyle = color;
      g.fillRect(sx, ly, segW, thickness);
      if(major){
        g.fillText(idx, sx+2, ly+2);
      }
    }
    gridSegments.push({canvas,x:sx,w:segW});
  }
}

let started=false;
function start(){
  if(started) return;
  started=true;
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  resize();
  loader = document.getElementById('loading-screen');
  drawLoading();
  try{
    init();
    setupMenu();
    if(self.BOOT) self.BOOT.init=true;
    last = performance.now();
    requestAnimationFrame(loop);
    if(self.BOOT) self.BOOT.loop=true;
  }catch(e){ showError(e); }
}

function drawLoading(){
  if(isReady) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(canvasScale*dpr,0,0,canvasScale*dpr,offsetX*dpr,offsetY*dpr);
  drawParallax(0,0);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText('Loading...',20,40);
}

if(document.readyState==='loading') window.addEventListener('DOMContentLoaded', start, {once:true}); else start();
window.addEventListener('resize', resize);
if(window.visualViewport) window.visualViewport.addEventListener('resize', resize);

function syncCanvas(){
  const newDpr = window.devicePixelRatio || 1;
  const newCssW = window.innerWidth;
  const newCssH = window.innerHeight;
  const newScale = newCssH / VIRTUAL_HEIGHT;
  const newViewWidth = Math.round(VIRTUAL_HEIGHT * (newCssW / newCssH));
  const newOffsetX = (newCssW - newViewWidth * newScale) / 2;
  const newOffsetY = 0;
  if(newDpr === dpr && newScale === canvasScale && newCssW === cssWidth && newCssH === cssHeight && newViewWidth === viewWidth) return false;
  dpr = newDpr;
  canvasScale = newScale;
  offsetX = newOffsetX;
  offsetY = newOffsetY;
  cssWidth = newCssW;
  cssHeight = newCssH;
  viewWidth = newViewWidth;
  viewHeight = VIRTUAL_HEIGHT;
  eff = dpr * canvasScale;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(canvasScale*dpr,0,0,canvasScale*dpr,offsetX*dpr,offsetY*dpr);
  safeMode = cssWidth < 720 || cssHeight < 405;
  return true;
}

function resize(){
  if(syncCanvas()){
    rebuildGrid();
    buildParallaxLayers();
  }
}

function init(){
  // Input
  window.addEventListener('keydown',e=>{
    if(e.code==='F3'){ hudExtended=!hudExtended; localStorage.setItem(HUD_EXT_KEY,hudExtended); e.preventDefault(); return; }
    if(e.code==='F1'){ inputHUD=!inputHUD; e.preventDefault(); return; }
    if(e.code==='F2'){ toggleGrid(); e.preventDefault(); return; }
    if(e.code==='F4'){ toggleGridStep(); e.preventDefault(); return; }
    if(e.code==='KeyG'){ deadZoneDebug=!deadZoneDebug; e.preventDefault(); return; }
    if(e.code==='BracketLeft'){
      settings.framingTiles=Math.max(-8,settings.framingTiles-1);
      world.camera.framingYTiles=settings.framingTiles;
      localStorage.setItem(FRAMING_KEY, settings.framingTiles);
      computeWorldBounds();
      rebuildGrid();
      e.preventDefault();
      return;
    }
    if(e.code==='BracketRight'){
      settings.framingTiles=Math.min(8,settings.framingTiles+1);
      world.camera.framingYTiles=settings.framingTiles;
      localStorage.setItem(FRAMING_KEY, settings.framingTiles);
      computeWorldBounds();
      rebuildGrid();
      e.preventDefault();
      return;
    }
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
    if(e.code==='ArrowLeft'||e.code==='KeyA') keyLeft=true;
    if(e.code==='ArrowRight'||e.code==='KeyD') keyRight=true;
    if(e.code==='ArrowUp'||e.code==='KeyW'||e.code==='Space'){ upHeld=true; world.player.jumpBuffer=JUMP_BUFFER_MS; }
    if(e.code==='KeyR'){ resetSegment(); resetInput(); }
    lastInputEvent = 'keydown '+e.code;
  });
  window.addEventListener('keyup',e=>{
    let release=false;
    if(e.code==='ArrowLeft'||e.code==='KeyA'){ if(keyLeft) release=true; keyLeft=false; }
    if(e.code==='ArrowRight'||e.code==='KeyD'){ if(keyRight) release=true; keyRight=false; }
    if(e.code==='ArrowUp'||e.code==='KeyW'||e.code==='Space') upHeld=false;
    if(release) startAirReleaseCut();
    lastInputEvent = 'keyup '+e.code;
  });
  window.addEventListener('blur',()=>{ resetInput(true); lastInputEvent='blur'; });
  document.addEventListener('visibilitychange',()=>{ if(document.hidden){ resetInput(true); lastInputEvent='vis'; } });
  ['touchend','touchcancel','touchleave'].forEach(ev=>window.addEventListener(ev,()=>{ resetInput(true); lastInputEvent=ev; }));

  const groundDeltaY = 4 * tileSize;
  const groundY = 300 + groundDeltaY;

  // Level
  world.platforms = asArray([
    {x:-400,y:groundY,w:1200,h:40},
    {x:200,y:220,w:120,h:20},
    {x:350,y:150,w:120,h:20},
    {x:520,y:250,w:150,h:20},
    {x:710,y:180,w:120,h:20}
  ]);
  const ground = world.platforms[0];
  const baseTiles = ground.w / tileSize;
  const extendLeftTiles = 2 * baseTiles;
  const extendRightTiles = 10 * baseTiles;
  ground.x -= extendLeftTiles * tileSize;
  ground.w += (extendLeftTiles + extendRightTiles) * tileSize;
  world.coins = asArray([
    {x:230,y:190,t:0,collected:false},
    {x:410,y:120,t:0,collected:false},
    {x:595,y:220,t:0,collected:false},
    {x:770,y:150,t:0,collected:false}
  ]);
  lowerCoinPlatforms();

  world.player = {
    x:0,y:groundY-40,w:40,h:40,vx:0,vy:0,onGround:false,
    coyote:0,jumpBuffer:0,
    scaleX:1,scaleY:1,
    eye:1,blinkTimer:randomBlinkInterval(),blinkDuration:0,blinkRepeat:false,
    mouth:0,
    yawnTimer:randomYawnInterval(),yawnCooldown:0,
    yawning:false,yawnPhase:0,yawnTime:0,yawnDurA:0,yawnDurP:0,yawnDurC:0,
    yawnStretch:0,yawnTilt:0,longBlink:false,
    breathe:0,dir:1,
    releaseCut:false,releaseTimer:0
  };
  world.spawnCenterX = world.player.x + world.player.w/2;
  computeWorldBounds();
  rebuildGrid();
  gridBtn = document.getElementById('btn-grid');
  stepBtn = document.getElementById('btn-step');
  const bindBtn = (el, handler)=>{
    ['click','touchstart'].forEach(ev=>{
      el.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); handler(); },{passive:false});
    });
  };
  bindBtn(gridBtn, toggleGrid);
  bindBtn(stepBtn, toggleGridStep);
  updateGridButtons();
  resetInput();
}


function loop(t){
  try{
    const delta = t-last; last=t;
    acc += delta/1000;
    frameCount++;
    if(t - fpsTime > 1000){ fps = frameCount; frameCount=0; fpsTime=t; if(fps<30) safeMode=true; }
    let steps=0; while(acc >= dt && steps < 5){ update(dt); acc-=dt; steps++; }
    if(acc>dt) acc=dt;
    updateCamera(delta/1000);
    if(CLAMP_PLAYER_TO_CAMERA_X){
      world.camera.clampX = clampPlayerToCameraX();
    }else{
      world.camera.clampX = 'none';
    }
    render();
    if(!isReady){
      isReady = true;
      if(loader) loader.style.display = 'none';
      if(self.BOOT){
        self.BOOT.frame = true;
        if(self.BOOT.watchdog) clearTimeout(self.BOOT.watchdog);
      }
    }
    requestAnimationFrame(loop);
  }catch(e){ showError(e); }
}

function update(dt){
  if(paused) return;
  const p = world.player;
  pollGamepad();
  leftHeld = keyLeft || gpLeft;
  rightHeld = keyRight || gpRight;
  p.breathe += dt*2;

  if(p.yawning && (!p.onGround || leftHeld || rightHeld || upHeld)){
    cancelYawn(p);
  }

  if(p.yawning){
    updateYawn(p, dt);
  }else{
    if(p.yawnCooldown>0){
      p.yawnCooldown -= dt*1000;
    }else{
      const idle = p.onGround && Math.abs(p.vx) < 0.05 && Math.abs(p.vy) < 0.05 && !leftHeld && !rightHeld && !upHeld;
      if(idle){
        p.yawnTimer -= dt*1000;
        if(p.yawnTimer<=0) startYawn(p);
      }else{
        p.yawnTimer = randomYawnInterval();
      }
    }
  }

  if(!p.yawning){
    p.blinkTimer -= dt*1000;
    if(p.blinkTimer<=0 && p.blinkDuration<=0){
      p.eye = 0;
      p.blinkDuration = 120 + Math.random()*60;
      if(p.blinkRepeat){
        p.blinkRepeat = false;
      }else{
        p.blinkRepeat = Math.random() < 0.1;
      }
    }
    if(p.blinkDuration>0){
      p.blinkDuration -= dt*1000;
      if(p.blinkDuration<=0){
        p.eye = 1;
        if(p.blinkRepeat){
          p.blinkTimer = 60 + Math.random()*40;
        }else{
          p.blinkTimer = randomBlinkInterval();
        }
      }
    }
  }

  p.coyote-=dt*1000; if(p.coyote<0) p.coyote=0;
  p.jumpBuffer-=dt*1000; if(p.jumpBuffer<0) p.jumpBuffer=0;

  gameTime += dt;

  // Input
  const accel = p.onGround ? RUN_ACCEL : AIR_ACCEL;
  const prevVx = p.vx;
  moveAxis = (rightHeld?1:0) - (leftHeld?1:0);
  if(p.releaseCut){
    if(moveAxis===0){
      p.vx *= RELEASE_DAMP;
      if(Math.abs(p.vx) < STOP_EPS) { p.vx=0; p.releaseCut=false; }
    }else{
      p.releaseTimer += dt;
      p.vx *= RELEASE_DAMP;
      if(p.releaseTimer >= RELEASE_RESUME) p.releaseCut=false;
    }
  }
  if(!p.releaseCut){
    if(moveAxis){
      p.vx += moveAxis*accel;
      p.dir = moveAxis > 0 ? 1 : -1;
    }else{
      if(p.onGround){
        if(p.vx>0){ p.vx = Math.max(0, p.vx-RUN_DECEL); }
        else if(p.vx<0){ p.vx = Math.min(0, p.vx+RUN_DECEL); }
      }else{
        p.vx *= AIR_DECEL;
      }
    }
    if(!moveAxis){
      if((prevVx>0 && p.vx<0) || (prevVx<0 && p.vx>0)) p.vx=0;
      if(Math.abs(p.vx) < STOP_EPS) p.vx = 0;
    }
  }

  if(p.jumpBuffer>0 && (p.onGround || p.coyote>0)){
    p.vy = JUMP_VELOCITY;
    p.onGround=false;
    p.coyote=0; p.jumpBuffer=0;
    p.scaleY=0.9; p.scaleX=1.1;
  }

  if(!upHeld && p.vy<0) p.vy *= 0.4; // variable jump

  p.vy += GRAVITY;
  // limit speeds
  p.vx = Math.max(Math.min(p.vx, MAX_RUN_SPEED), -MAX_RUN_SPEED);

  const prevCenterX = p.x + p.w/2;
  moveAndCollide(p, dt);
  if(p.onGround) p.releaseCut=false;
  if(!moveAxis && Math.abs(p.vx) < STOP_EPS) p.vx = 0;
  updateCoins(dt);

  const vInst = Math.abs(p.vx*10);
  if(vInst > vMax) vMax = vInst;
  const centerX = p.x + p.w/2;
  if(!segment.running && prevCenterX < segment.start && centerX >= segment.start){
    segment.running = true;
    segment.startTime = gameTime;
    segment.done = false;
  }
  if(segment.running && !segment.done && prevCenterX < segment.end && centerX >= segment.end){
    segment.done = true;
    segment.delta = gameTime - segment.startTime;
  }
}

function startYawn(p){
  const s = safeMode ? 0.7 : 1;
  p.yawning = true;
  p.yawnPhase = 'a';
  p.yawnTime = 0;
  p.yawnDurA = (150 + Math.random()*100)*s;
  p.yawnDurP = (600 + Math.random()*300)*s;
  p.yawnDurC = (300 + Math.random()*200)*s;
  p.yawnStretch = 0;
  p.yawnTilt = 0;
  p.mouth = 0;
  p.eye = 0.6;
  p.longBlink = false;
}

function cancelYawn(p){
  p.yawning=false;
  p.yawnStretch=0;
  p.yawnTilt=0;
  p.mouth=0;
  p.eye=1;
  p.longBlink=false;
  p.yawnCooldown = randomYawnCooldown();
  p.yawnTimer = randomYawnInterval();
}

function endYawn(p){
  p.yawning=false;
  p.yawnStretch=0;
  p.yawnTilt=0;
  p.mouth=0;
  p.eye=1;
  p.longBlink=false;
  p.yawnCooldown = randomYawnCooldown();
  p.yawnTimer = randomYawnInterval();
}

function updateYawn(p, dt){
  const amp = 0.1 * (safeMode ? 0.7 : 1);
  p.yawnTime += dt*1000;
  if(p.yawnPhase==='a'){
    const t = Math.min(1, p.yawnTime/p.yawnDurA);
    p.yawnStretch = amp * t;
    if(p.yawnTime >= p.yawnDurA){
      p.yawnPhase='p';
      p.yawnTime=0;
      p.mouth = 1;
      p.yawnStretch = amp;
      p.yawnTilt = -0.1 * (safeMode ? 0.7 : 1);
      if(Math.random()<0.2){ p.longBlink=true; p.eye=0; } else { p.eye=1; }
    }
  }else if(p.yawnPhase==='p'){
    if(p.yawnTime >= p.yawnDurP){
      p.yawnPhase='c';
      p.yawnTime=0;
      if(p.longBlink){ p.eye=1; p.longBlink=false; }
    }
  }else if(p.yawnPhase==='c'){
    const t = Math.min(1, p.yawnTime/p.yawnDurC);
    p.yawnStretch = amp + ((-amp*0.3) - amp)*t;
    p.mouth = 1 - t;
    p.yawnTilt = -0.1 * (safeMode ? 0.7 : 1) * (1 - t);
    if(p.yawnTime >= p.yawnDurC){
      endYawn(p);
    }
  }
}

function moveAndCollide(p, dt){
  p.x += p.vx*dt*10;
  for(const pl of world.platforms){
    if(rectIntersect(p,pl)){
      if(p.vx>0) p.x = pl.x - p.w; else if(p.vx<0) p.x = pl.x+pl.w;
      p.vx = 0;
    }
  }
  p.y += p.vy*dt*10;
  let landed=false;
  for(const pl of world.platforms){
    if(rectIntersect(p,pl)){
      if(p.vy>0){ p.y = pl.y - p.h; p.vy=0; p.onGround=true; p.coyote=COYOTE_MS; landed=true; }
      else if(p.vy<0){ p.y = pl.y + pl.h; p.vy=0; }
    }
  }
  if(!landed && p.onGround){ p.onGround=false; p.coyote=COYOTE_MS; }

  // ease scale back
  p.scaleX += (1 - p.scaleX)*0.1;
  p.scaleY += (1 - p.scaleY)*0.1;
}

function updateCoins(dt){
  for(const c of world.coins){
    c.t += dt;
    if(!c.collected){
      if(rectIntersect({x:world.player.x,y:world.player.y,w:world.player.w,h:world.player.h}, {x:c.x-10,y:c.y-10,w:20,h:20})){
        c.collected=true; score++;
      }
    }
  }
}

function updateCamera(dt){
  const p = world.player;
  if(!p) return;

  // --- X axis follows as before ---
  const targetX = p.x + p.w/2;
  const desiredX = targetX - viewWidth/2;
  const minCamXSpawn = Math.max(worldStartX, world.spawnCenterX - viewWidth/2);
  const maxCamX = Math.max(worldStartX, worldEndX - viewWidth);
  let camX = Math.min(Math.max(desiredX, minCamXSpawn), maxCamX);
  world.camera.x += (camX - world.camera.x) * 0.15;
  if(Math.abs(camX - world.camera.x) < 0.5) world.camera.x = camX;
  world.camera.x = Math.min(Math.max(world.camera.x, minCamXSpawn), maxCamX);

  // --- Y axis with dead-zone and smoothing ---
  let camY = world.camera.y;
  const offsetY = settings.framingTiles * tileSize;
  const anchorWorldY = camY + (viewHeight/2 - offsetY);
  const zu = settings.camera.deadzoneUpTiles * tileSize;
  const zd = settings.camera.deadzoneDownTiles * tileSize;
  const playerY = p.y + p.h/2;
  let targetCamY = camY;
  if(settings.camera.followY){
    if(playerY < anchorWorldY - zu){
      targetCamY = playerY + zu - (viewHeight/2 - offsetY);
    }else if(playerY > anchorWorldY + zd){
      targetCamY = playerY - zd - (viewHeight/2 - offsetY);
    }
  }
  const alpha = 1 - Math.exp(-settings.camera.lerpPerSec * dt);
  camY = camY + (targetCamY - camY) * alpha;

  const minCamY = worldMinY;
  const maxCamY = Math.max(worldMinY, worldMaxY - viewHeight);
  let clampY = 'none';
  if(camY < minCamY){
    camY = minCamY;
    clampY = 'top';
  }else if(camY > maxCamY && playerY <= worldMaxY){
    camY = maxCamY;
    clampY = 'bottom';
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
  const screenAnchorY = viewHeight/2 - offsetY;
  const applied = Math.round(screenAnchorY - screenPlayerY);
  world.camera.appliedOffsetY = applied;
}

function clampPlayerToCameraX(){
  const p = world.player;
  const camX = world.camera.x;
  const left = camX;
  const right = camX + viewWidth - p.w;
  if(p.x < left){
    p.x = left;
    p.vx = Math.max(0, p.vx);
    p.releaseCut = false;
    return 'left';
  }
  if(p.x > right){
    p.x = right;
    p.vx = Math.min(0, p.vx);
    p.releaseCut = false;
    return 'right';
  }
  return 'none';
}

function rectIntersect(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function render(){
  if(syncCanvas()) rebuildGrid();
  const camX = snap(world.camera.x);
  const camY = snap(world.camera.y);
  const sd = canvasScale * dpr;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(sd,0,0,sd,offsetX*dpr,offsetY*dpr);
  drawParallax(camX, camY);
  renderGrid(ctx, camX, camY);
  ctx.setTransform(sd,0,0,sd,offsetX*dpr - camX*sd, offsetY*dpr - camY*sd);
  drawPlatforms();
  drawCoins();
  drawPlayer();
  ctx.setTransform(sd,0,0,sd,offsetX*dpr,offsetY*dpr);
  if(deadZoneDebug){
    const offsetY = settings.framingTiles * tileSize;
    const anchorScreenY = viewHeight/2 - offsetY;
    const zu = world.camera.dzUp || 0;
    const zd = world.camera.dzDown || 0;
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,0,0.2)';
    ctx.strokeStyle = 'rgba(255,0,0,0.5)';
    ctx.fillRect(0, anchorScreenY - zu, viewWidth, zu + zd);
    ctx.strokeRect(0, anchorScreenY - zu, viewWidth, zu + zd);
    ctx.restore();
  }
  drawHUD();
  gridDrawnPrev = gridDrawnNow;
}

function buildParallaxLayers(){
  if(!PARALLAX_ENABLED) return;
  const ground = world.platforms[0];
  const groundY = ground ? ground.y : viewHeight;
  const hillsFarY = groundY - tileSize * 3.7;
  const hillsMidY = groundY - tileSize * 2.7;
  const shrubsY   = groundY - tileSize * 1.2;
  const segW = Math.max(2048, Math.ceil(viewWidth * 1.5));
  const outline = 2.5 / eff;

  const makeHills = (light, shadow)=>{
    const h = 400;
    const canvas = document.createElement('canvas');
    canvas.width = segW; canvas.height = h;
    const g = canvas.getContext('2d');
    g.lineWidth = outline;
    g.lineJoin = g.lineCap = 'round';
    const base = h * 0.75;
    const waves = Math.ceil(segW / 300);
    const path = new Path2D();
    path.moveTo(0, base);
    for(let i=0;i<waves;i++){
      const x0 = i * (segW / waves);
      const xc = x0 + (segW / waves)/2;
      const peak = base - 60 - Math.random()*40;
      const x1 = x0 + (segW / waves);
      path.quadraticCurveTo(xc, peak, x1, base);
    }
    path.lineTo(segW, h);
    path.lineTo(0, h);
    path.closePath();
    g.fillStyle = light; g.fill(path);
    g.save();
    g.clip(path);
    g.fillStyle = shadow;
    g.fillRect(0, base, segW, h-base);
    g.restore();
    g.strokeStyle = '#000';
    g.stroke(path);
    return {canvas, width:segW, height:h};
  };

  const makeShrubs = ()=>{
    const h = 200;
    const canvas = document.createElement('canvas');
    canvas.width = segW; canvas.height = h;
    const g = canvas.getContext('2d');
    g.lineWidth = outline;
    g.lineJoin = g.lineCap = 'round';
    const base = h;
    const count = Math.ceil(segW / 160);
    for(let i=0;i<count;i++){
      const x = Math.random()*segW;
      const s = 20 + Math.random()*20;
      g.save();
      g.translate(x, base);
      const path = new Path2D();
      path.moveTo(-s,0);
      path.lineTo(0,-s*1.5);
      path.lineTo(s,0);
      path.closePath();
      g.fillStyle = '#3f9d4b';
      g.fill(path);
      g.save();
      g.clip(path);
      g.fillStyle = '#2f7a3a';
      g.fillRect(0,-s*1.5,s,s*1.5);
      g.restore();
      g.strokeStyle = '#000';
      g.stroke(path);
      g.restore();
    }
    return {canvas, width:segW, height:h};
  };

  const hillsFar = makeHills('#2d6a35','#234d2b');
  const hillsMid = makeHills('#3f9d4b','#2f7a3a');
  const shrubs   = makeShrubs();

  parallax.segments = {
    hillsFar:{...hillsFar, baseY: hillsFarY - hillsFar.height, px:0.10, py:0.08},
    hillsMid:{...hillsMid, baseY: hillsMidY - hillsMid.height, px:0.20, py:0.12},
    shrubs  :{...shrubs  , baseY: shrubsY   - shrubs.height  , px:0.35, py:0.15}
  };

  parallax.clouds = [];
  const cloudCount = 6 + Math.floor(Math.random()*3);
  for(let i=0;i<cloudCount;i++){
    parallax.clouds.push({
      x: Math.random()*(viewWidth+400) - 200,
      y: 60 + Math.random()*120,
      r: 20 + Math.random()*20,
      speed: 6 + Math.random()*6,
      phase: Math.random()*Math.PI*2
    });
  }
}

function drawParallax(camX, camY){
  if(!PARALLAX_ENABLED || !parallax.segments.hillsFar){
    const bgOffset = snap(camX*0.2);
    drawBackground(bgOffset);
    return;
  }
  const w = viewWidth;
  const h = viewHeight;
  const sky = ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,'#4a90e2');
  sky.addColorStop(1,'#87ceeb');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,w,h);

  const sunX = w*0.8 - camX*0.05;
  const sunY = 100 - camY*0.05;
  const sunR = 80;
  const grad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunR);
  grad.addColorStop(0,'#fff5a0');
  grad.addColorStop(1,'rgba(255,255,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI*2);
  ctx.fill();

  const drawLayer = seg=>{
    const s = seg;
    let x = - (camX * s.px) % s.width;
    if(x>0) x -= s.width;
    const y = s.baseY - camY * s.py;
    while(x < w){
      ctx.drawImage(s.canvas, Math.round(x), Math.round(y));
      x += s.width;
    }
  };
  drawLayer(parallax.segments.hillsFar);
  drawLayer(parallax.segments.hillsMid);

  const lw = 2.5 / eff;
  ctx.lineWidth = lw;
  ctx.lineJoin = ctx.lineCap = 'round';
  for(const c of parallax.clouds){
    c.x += c.speed * dt;
    const sx = c.x - camX*0.15;
    const sy = c.y + Math.sin(gameTime*0.5 + c.phase)*5 - camY*0.10;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(-2*c.r,0,c.r,0,Math.PI*2);
    ctx.arc(-c.r,-c.r*0.6,c.r*1.2,0,Math.PI*2);
    ctx.arc(0,0,c.r*1.4,0,Math.PI*2);
    ctx.arc(c.r,-c.r*0.6,c.r*1.2,0,Math.PI*2);
    ctx.arc(2*c.r,0,c.r,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(180,200,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(0,c.r*0.3,2.4*c.r,c.r,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
    if(sx > w + 200){
      c.x = camX*0.15 - 200;
      c.y = 60 + Math.random()*120;
    }
  }

  drawLayer(parallax.segments.shrubs);
}

function drawBackground(offset){
  const w = viewWidth, h = viewHeight;
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'#4a90e2');
  grad.addColorStop(1,'#87ceeb');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
  if(!safeMode){
    ctx.fillStyle = '#a0d0ff';
    const cloudOffset = Math.round(offset*0.3*eff)/eff;
    for(let i=0;i<3;i++){
      const x = Math.round(((cloudOffset + i*200) % (w+200) -200)*eff)/eff;
      ctx.beginPath();
      ctx.arc(x,100+i*30,80,0,Math.PI*2);
      ctx.fill();
    }
  }
}

function renderGrid(ctx, camX, camY){
  let drawn = false;
  if(!gridEnabled || !gridSegments.length){ gridDrawnNow = false; return; }
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const sd = canvasScale * dpr;
  ctx.setTransform(sd,0,0,sd,offsetX*dpr - camX*sd, offsetY*dpr - camY*sd);
  const viewStartX = camX;
  const viewEndX = camX + viewWidth;
  const viewStartY = camY;
  const viewEndY = camY + viewHeight;
  for(const seg of gridSegments){
    const segEndX = seg.x + seg.w;
    if(segEndX <= viewStartX || seg.x >= viewEndX) continue;
    const drawStartX = Math.max(seg.x, viewStartX);
    const drawEndX = Math.min(segEndX, viewEndX);
    const srcX = drawStartX - seg.x;
    const drawW = drawEndX - drawStartX;
    const drawStartY = Math.max(gridMinY, viewStartY);
    const drawEndY = Math.min(gridMaxY, viewEndY);
    const srcY = drawStartY - gridMinY;
    const drawH = drawEndY - drawStartY;
    ctx.drawImage(seg.canvas,
      srcX*dpr, srcY*dpr, drawW*dpr, drawH*dpr,
      drawStartX, drawStartY, drawW, drawH);
    drawn = true;
  }
  ctx.imageSmoothingEnabled = prevSmooth;
  gridDrawnNow = drawn;
}

function drawPlatform(pl){
  ctx.save();
  ctx.translate(pl.x,pl.y);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#7b4f28';
  ctx.fillRect(0,0,pl.w,pl.h);
  ctx.strokeRect(0,0,pl.w,pl.h);
  ctx.fillStyle = '#8e5b32';
  ctx.fillRect(0,0,pl.w,pl.h/2);
  ctx.fillStyle = '#5e3a1a';
  ctx.fillRect(0,pl.h/2,pl.w,pl.h/2);
  ctx.fillStyle = '#4caf50';
  ctx.fillRect(0,-4,pl.w,8);
  for(let x=0;x<pl.w;x+=6){ ctx.beginPath(); ctx.moveTo(x,-4); ctx.lineTo(x+3,0); ctx.lineTo(x+6,-4); ctx.fill(); }
  if(pl.flash){
    const clr = pl.flash === 'red' ? 'rgba(255,0,0,0.4)' : 'rgba(0,255,0,0.4)';
    ctx.fillStyle = clr;
    ctx.fillRect(0,0,pl.w,pl.h);
    pl.flash = null;
  }
  ctx.restore();
}

function drawPlatforms(){
  for(const pl of world.platforms) drawPlatform(pl);
}

function drawCoin(c){
  if(c.collected) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  const scale = 1 + Math.sin(c.t*4)*0.1;
  ctx.scale(scale,1);
  ctx.beginPath();
  ctx.fillStyle = '#ffd700';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.arc(0,0,10,0,Math.PI*2);
  ctx.fill();
  ctx.stroke();
  const grad = ctx.createRadialGradient(-3,-3,2,0,0,10);
  grad.addColorStop(0,'#fff'); grad.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
  const t = (c.t%1.2)/1.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0,0,10,-Math.PI/4 + t*Math.PI*2,-Math.PI/4 + t*Math.PI*2 + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawCoins(){ for(const c of world.coins) drawCoin(c); }

function drawPlayer(){
  const p = world.player;
  const groundY = getGroundY(p);
  const shadowScale = Math.max(0.2, Math.min(1, (groundY - (p.y+p.h))/100));
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(p.x+p.w/2, groundY-5, (p.w/2)*shadowScale, (p.h/6)*shadowScale,0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(p.x+p.w/2, p.y+p.h/2);
  const breathe = 1 + Math.sin(p.breathe)*0.02;
  ctx.scale(p.scaleX*breathe, p.scaleY/breathe*(1+p.yawnStretch));
  ctx.rotate(p.yawnTilt);
  ctx.beginPath();
  ctx.fillStyle = '#76e3a6';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.rect(-p.w/2,-p.h/2,p.w,p.h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#6ac395';
  ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h/2);
  ctx.fillStyle = '#84f7bd';
  ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h/4);
  // eyes
  ctx.fillStyle = '#000';
  const eyeY = -p.h*0.1;
  const eyeOffset = p.dir*4;
  const drawEye=open=>{
    if(open>=1){
      ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill();
    }else if(open<=0){
      ctx.fillRect(-3,-1,6,2);
    }else{
      ctx.save(); ctx.scale(1,open); ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  };
  ctx.save(); ctx.translate(-8+eyeOffset,eyeY); drawEye(p.eye); ctx.restore();
  ctx.save(); ctx.translate(8+eyeOffset,eyeY); drawEye(p.eye); ctx.restore();
  // mouth
  if(p.mouth>0){
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.ellipse(0,8,8*p.mouth,12*p.mouth,0,0,Math.PI*2);
    ctx.fill();
  }else{
    ctx.beginPath();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.moveTo(-8,8); ctx.quadraticCurveTo(0,12,8,8);
    ctx.stroke();
  }
  ctx.restore();
}

function getGroundY(p){
  let gy = p.y+p.h+100;
  for(const pl of world.platforms){
    if(p.x+p.w > pl.x && p.x < pl.x+pl.w && pl.y >= p.y+p.h && pl.y < gy) gy = pl.y;
  }
  return gy;
}

function drawHUD(){
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';

  const tiles = world.camera.framingYTiles || 0;
  const offPix = Math.round(world.camera.appliedOffsetY || 0);
  const clamp = world.camera.clampY || 'none';
  const camY = Math.round(world.camera.y);
  const camX = Math.round(world.camera.x);
  const camCenterX = Math.round(world.camera.x + viewWidth/2);
  const camCenterTX = ((world.camera.x + viewWidth/2)/tileSize).toFixed(1);
  const minCamXSpawn = Math.max(worldStartX, world.spawnCenterX - viewWidth/2);
  const clampX = (camX <= Math.round(minCamXSpawn)) ? 'left' :
    (camX >= Math.round(Math.max(worldStartX, worldEndX - viewWidth)) ? 'right' : 'none');
  const line = `Framing: tiles=${tiles} | offY=${offPix} | clampY=${clamp} | CamY=${camY} | CamX=${camCenterX} (t=${camCenterTX}) | clampX=${clampX} | clampX=${world.camera.clampX||'none'}`;
  ctx.strokeText(line, 20, 20);
  ctx.fillText(line, 20, 20);

  const camLine = `C x=${camCenterX} px (t=${camCenterTX})`;
  const player = world.player;
  const playerLine = `P x=${Math.round(player.x)} px (t=${(player.x/tileSize).toFixed(1)})`;
  ctx.strokeText(camLine, 20, 40);
  ctx.fillText(camLine, 20, 40);
  ctx.strokeText(playerLine, 20, 60);
  ctx.fillText(playerLine, 20, 60);

  const viewLine = `View: ${viewWidth}×${viewHeight}`;
  ctx.strokeText(viewLine, 20, 80);
  ctx.fillText(viewLine, 20, 80);

  const ver = 'v'+GAME_VERSION;
  ctx.strokeText(ver, viewWidth-80, viewHeight-20);
  ctx.fillText(ver, viewWidth-80, viewHeight-20);

  if(inputHUD){
    const inputLine = `L:${leftHeld?1:0} R:${rightHeld?1:0} move:${moveAxis} vx:${player.vx.toFixed(2)} last:${lastInputEvent}`;
    ctx.strokeText(inputLine,20,viewHeight-40);
    ctx.fillText(inputLine,20,viewHeight-40);
  }

  ctx.restore();
}

function updateGridButtons(){
  if(gridBtn) gridBtn.textContent = 'Grid: '+(gridEnabled?'On':'Off');
  if(stepBtn) stepBtn.textContent = 'Step: '+(gridStep===5?'5×5':'1×1');
}

function toggleGrid(){
  gridEnabled = !gridEnabled;
  localStorage.setItem(GRID_ENABLED_KEY, gridEnabled);
  updateGridButtons();
  rebuildGrid();
}

function toggleGridStep(){
  gridStep = gridStep===1?5:1;
  localStorage.setItem(GRID_STEP_KEY, gridStep);
  updateGridButtons();
  rebuildGrid();
}

function setupMenu(){
  const menu = document.getElementById('menu');
  const mainMenu = document.getElementById('menu-main');
  const settingsMenu = document.getElementById('menu-settings');
  const startBtn = document.getElementById('btn-start');
  const settingsBtn = document.getElementById('btn-settings');
  const backBtn = document.getElementById('btn-back');
  const diffRadios = document.querySelectorAll('input[name="difficulty"]');

  const show = screen=>{
    resetInput(true);
    mainMenu.classList.toggle('hidden', screen!=='main');
    settingsMenu.classList.toggle('hidden', screen!=='settings');
    menu.style.display='flex';
    paused = true;
  };

  startBtn.addEventListener('click',()=>{ applyDifficulty(currentDifficulty); resetInput(); menu.style.display='none'; paused=false; });
  settingsBtn.addEventListener('click',()=>show('settings'));
  backBtn.addEventListener('click',()=>show('main'));

  diffRadios.forEach(r=>r.addEventListener('change',e=>{
    currentDifficulty = e.target.value;
    localStorage.setItem(DIFF_KEY,currentDifficulty);
    resetInput();
  }));
  const saved = document.querySelector(`input[name="difficulty"][value="${currentDifficulty}"]`);
  if(saved) saved.checked = true;


  window.addEventListener('keydown',e=>{
    if(menu.style.display!=='none'){
      if(!mainMenu.classList.contains('hidden')){
        if(e.code==='Enter'){ applyDifficulty(currentDifficulty); resetInput(); menu.style.display='none'; paused=false; e.preventDefault(); }
      }else{
        if(e.code==='Escape'||e.code==='Backspace'){ show('main'); e.preventDefault(); }
      }
    }
  });

  show('main');
}
