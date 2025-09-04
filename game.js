const GAME_VERSION = self.GAME_VERSION;
if(self.BOOT) self.BOOT.script = true;

function asArray(v){ return Array.isArray(v)?v:[]; }

let canvas, ctx, dpr=1, pageScale=1, eff=1, viewWidth=0, viewHeight=0, last=0, acc=0, fps=60, fpsTime=0, frameCount=0;
const dt = 1/60;
const tileSize = 60;
let safeMode = false;
let score = 0;
let isReady = false;
let loader = null;
let debug = false;
let paused = true;

const GRID_ENABLED_KEY = 'platformer.debug.grid.enabled';
const GRID_STEP_KEY = 'platformer.debug.grid.step';
let gridEnabled = localStorage.getItem(GRID_ENABLED_KEY) === 'true';
let gridStep = parseInt(localStorage.getItem(GRID_STEP_KEY),10);
if(gridStep !== 5) gridStep = 1;
let gridBtn = null;
let stepBtn = null;

const DIFF_KEY = 'platformer.difficulty.v1';
// Difficulty multipliers relative to Easy base values
const DIFF_FACTORS = { Easy:1.00, Normal:1.60, Hard:2.20 };

const FRAMING_KEY = 'platformer.camera.framing.v1';
let framingYOffsetTiles = parseInt(localStorage.getItem(FRAMING_KEY),10);
if(![6,5,3,0].includes(framingYOffsetTiles)) framingYOffsetTiles = 5;

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

const world = { platforms:[], coins:[], player:null, camera:{x:0,y:0, framingYOffsetTiles} };
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
  const tail = TAIL_TILES * tile;
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
  minX = Math.min(minX, 0) - tail;
  maxX = maxX + tail;
  worldMinY -= tail;
  worldMaxY += tail;
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
  const key = [gridEnabled,step,tile,dpr,pageScale,startX,endX,minY,maxY].join('|');
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
  drawBackground(0);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText('Loading...',20,40);
}

if(document.readyState==='loading') window.addEventListener('DOMContentLoaded', start, {once:true}); else start();
window.addEventListener('resize', resize);
if(window.visualViewport) window.visualViewport.addEventListener('resize', resize);

function syncCanvas(){
  const newDpr = window.devicePixelRatio || 1;
  const newPageScale = window.visualViewport ? window.visualViewport.scale : 1;
  const cssW = innerWidth;
  const cssH = innerHeight;
  if(newDpr === dpr && newPageScale === pageScale && cssW === viewWidth && cssH === viewHeight) return false;
  dpr = newDpr;
  pageScale = newPageScale;
  eff = dpr * pageScale;
  viewWidth = cssW;
  viewHeight = cssH;
  canvas.style.width = viewWidth + 'px';
  canvas.style.height = viewHeight + 'px';
  canvas.width = Math.round(viewWidth * dpr);
  canvas.height = Math.round(viewHeight * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(viewWidth < 720) safeMode = true;
  return true;
}

function resize(){
  if(syncCanvas()) rebuildGrid();
}

function init(){
  // Input
  window.addEventListener('keydown',e=>{
    if(e.code==='F3'){ debug=!debug; e.preventDefault(); return; }
    if(e.code==='F1'){ inputHUD=!inputHUD; e.preventDefault(); return; }
    if(e.code==='F2'){ toggleGrid(); e.preventDefault(); return; }
    if(e.code==='F4'){ toggleGridStep(); e.preventDefault(); return; }
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
  updateCamera(dt);

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
  const vInst = p.vx*10;
  const lookAhead = Math.min(Math.max(Math.abs(vInst)*0.18,80),260) * p.dir;
  const offset = (world.camera.framingYOffsetTiles || 0) * tileSize;
  let targetX = p.x + p.w/2 - viewWidth/2 + lookAhead;
  let targetY = p.y + p.h/2 - viewHeight*0.5 - offset;
  const maxCamX = Math.max(worldStartX, worldEndX - viewWidth);
  const maxCamY = Math.max(worldMinY, worldMaxY - viewHeight);
  targetX = Math.min(Math.max(targetX, worldStartX), maxCamX);
  targetY = Math.min(Math.max(targetY, worldMinY), maxCamY);
  world.camera.x += (targetX - world.camera.x)*0.15;
  world.camera.y += (targetY - world.camera.y)*0.15;
  if(p.onGround){
    if(Math.abs(p.vx) < 0.05 && Math.abs(targetX - world.camera.x) < 0.5) world.camera.x = targetX;
    if(Math.abs(p.vy) < 0.05 && Math.abs(targetY - world.camera.y) < 0.5) world.camera.y = targetY;
  }
  world.camera.x = Math.min(Math.max(world.camera.x, worldStartX), maxCamX);
  world.camera.y = Math.min(Math.max(world.camera.y, worldMinY), maxCamY);
}

function rectIntersect(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function render(){
  if(syncCanvas()) rebuildGrid();
  const camX = snap(world.camera.x);
  const camY = snap(world.camera.y);
  const bgOffset = snap(camX*0.2);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawBackground(bgOffset);
  renderGrid(ctx, camX, camY);
  ctx.setTransform(dpr,0,0,dpr,-camX*dpr,-camY*dpr);
  drawPlatforms();
  drawCoins();
  drawPlayer();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawHUD(camX, camY);
  gridDrawnPrev = gridDrawnNow;
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
    const cloudOffset = Math.round(offset*0.3*dpr)/dpr;
    for(let i=0;i<3;i++){
      const x = Math.round(((cloudOffset + i*200) % (w+200) -200)*dpr)/dpr;
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
  ctx.setTransform(1,0,0,1,-camX*dpr,-camY*dpr);
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
      drawStartX*dpr, drawStartY*dpr, drawW*dpr, drawH*dpr);
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

function drawHUD(camX, camY){
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText('Coins: '+score,20,30);
  ctx.fillText('Arrows/A,D move • W/↑/Space jump • R reset timer',20,50);
  const diffFactor = DIFF_FACTORS[currentDifficulty];
  ctx.fillText(`Diff: ${currentDifficulty} (x${diffFactor.toFixed(2)})`,20,70);
  const p = world.player;
  const vInst = p.vx*10;
  const vTiles = vInst/60;
  ctx.fillText(`v_inst: ${vInst.toFixed(1)}px/s (${vTiles.toFixed(2)}t/s)`,20,90);
  ctx.fillText(`v_max: ${vMax.toFixed(1)}px/s`,20,110);
  const worldTiles = Math.round(worldWidthPx/60);
  if(segment.done){
    const vAvg = 1200/segment.delta;
    const vAvgTiles = vAvg/60;
    ctx.fillText(`Δt: ${segment.delta.toFixed(2)}s`,20,130);
    ctx.fillText(`v_avg: ${vAvg.toFixed(1)}px/s (${vAvgTiles.toFixed(2)}t/s)`,20,150);
    ctx.fillText(`Grid: ${gridEnabled?'On':'Off'} | Step: ${gridStep===5?'5×5':'1×1'} | DPR: ${dpr.toFixed(2)} | Zoom: ${pageScale.toFixed(2)} | eff: ${eff.toFixed(2)} | ${gridDrawnPrev?'drawn':'not'}`,20,170);
    ctx.fillText(`World: ${worldTiles} tiles (${worldMode})`,20,190);
  }else{
    ctx.fillText(`Grid: ${gridEnabled?'On':'Off'} | Step: ${gridStep===5?'5×5':'1×1'} | DPR: ${dpr.toFixed(2)} | Zoom: ${pageScale.toFixed(2)} | eff: ${eff.toFixed(2)} | ${gridDrawnPrev?'drawn':'not'}`,20,130);
  ctx.fillText(`World: ${worldTiles} tiles (${worldMode})`,20,150);
  }
  ctx.fillText('Ground ΔY: +4 tiles',20,segment.done?210:170);
  ctx.fillText(`Adj: small coin platforms −4t (moved:${movedCoinPlatforms}, clamped:${clampedCoinPlatforms})`,20,segment.done?230:190);
  ctx.fillText('Cam framing: +6|+5|+3|0 tiles',20,segment.done?250:210);
  ctx.fillText(`Reach V=${reachV.toFixed(0)} H0=${reachH0.toFixed(0)} Hrun=${reachHrun.toFixed(0)} | Fixed:${fixedCoins} | Unreachable:${unreachableCoins}`,
    20,segment.done?270:230);
  ctx.fillText('v'+GAME_VERSION, viewWidth-80, viewHeight-20);
  if(debug){
    const dbgY = segment.done?290:250;
    ctx.fillText(`camX:${camX.toFixed(2)} camY:${camY.toFixed(2)}`,20,dbgY);
    ctx.fillText(`playerX:${p.x.toFixed(2)} playerY:${p.y.toFixed(2)}`,20,dbgY+20);
    ctx.fillText(`dpr:${dpr.toFixed(2)} canvas:${viewWidth}x${viewHeight}`,20,dbgY+40);
  }
  if(inputHUD){
    ctx.fillText(`L:${leftHeld?1:0} R:${rightHeld?1:0} move:${moveAxis} vx:${p.vx.toFixed(2)} last:${lastInputEvent}`,20,viewHeight-40);
  }
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
  const framingRadios = document.querySelectorAll('input[name="framing"]');

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

  framingRadios.forEach(r=>r.addEventListener('change',e=>{
    const v = parseInt(e.target.value,10);
    world.camera.framingYOffsetTiles = v;
    localStorage.setItem(FRAMING_KEY,v);
  }));
  const savedFraming = document.querySelector(`input[name="framing"][value="${world.camera.framingYOffsetTiles}"]`);
  if(savedFraming) savedFraming.checked = true;

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
