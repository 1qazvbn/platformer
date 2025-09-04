const GAME_VERSION = self.GAME_VERSION;
if(self.BOOT) self.BOOT.script = true;

function asArray(v){ return Array.isArray(v)?v:[]; }

let canvas, ctx, dpr=1, viewWidth=0, viewHeight=0, last=0, acc=0, fps=60, fpsTime=0, frameCount=0;
const dt = 1/60;
let safeMode = false;
let score = 0;
let isReady = false;
let loader = null;
let debug = false;

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

const keys = {left:false,right:false,up:false};

const world = { platforms:[], coins:[], player:null, camera:{x:0,y:0} };

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

function resize(){
  dpr = window.devicePixelRatio || 1;
  viewWidth = innerWidth;
  viewHeight = innerHeight;
  canvas.style.width = viewWidth + 'px';
  canvas.style.height = viewHeight + 'px';
  canvas.width = Math.floor(viewWidth * dpr);
  canvas.height = Math.floor(viewHeight * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(viewWidth < 720) safeMode = true;
}

function init(){
  // Input
  window.addEventListener('keydown',e=>{
    if(e.code==='F3'){ debug=!debug; e.preventDefault(); return; }
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
    if(e.code==='ArrowLeft'||e.code==='KeyA') keys.left=true;
    if(e.code==='ArrowRight'||e.code==='KeyD') keys.right=true;
    if(e.code==='ArrowUp'||e.code==='KeyW'||e.code==='Space'){ keys.up=true; world.player.jumpBuffer=JUMP_BUFFER_MS; }
    if(e.code==='KeyR'){ resetSegment(); }
  });
  window.addEventListener('keyup',e=>{
    if(e.code==='ArrowLeft'||e.code==='KeyA') keys.left=false;
    if(e.code==='ArrowRight'||e.code==='KeyD') keys.right=false;
    if(e.code==='ArrowUp'||e.code==='KeyW'||e.code==='Space') keys.up=false;
  });

  // Level
  world.platforms = asArray([
    {x:-400,y:300,w:1200,h:40},
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

  world.player = {
    x:0,y:0,w:40,h:40,vx:0,vy:0,onGround:false,
    coyote:0,jumpBuffer:0,
    scaleX:1,scaleY:1,
    eye:1,blinkTimer:randomBlinkInterval(),blinkDuration:0,blinkRepeat:false,
    mouth:0,
    yawnTimer:randomYawnInterval(),yawnCooldown:0,
    yawning:false,yawnPhase:0,yawnTime:0,yawnDurA:0,yawnDurP:0,yawnDurC:0,
    yawnStretch:0,yawnTilt:0,longBlink:false,
    breathe:0,dir:1
  };
}

const GRAVITY = 1.2;
const MAX_RUN_SPEED = 6.0 * 3.5; // allow up to ×4 if needed
const RUN_ACCEL = 6.0 * 3.0;
const AIR_ACCEL = 6.0; // keep air control
const JUMP_VELOCITY = -35;
const COYOTE_MS = 100;
const JUMP_BUFFER_MS = 120;
const RUN_DECEL = 0.7; // was 0.85 (×2 decel)

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
  const p = world.player;
  p.breathe += dt*2;

  if(p.yawning && (!p.onGround || keys.left || keys.right || keys.up)){
    cancelYawn(p);
  }

  if(p.yawning){
    updateYawn(p, dt);
  }else{
    if(p.yawnCooldown>0){
      p.yawnCooldown -= dt*1000;
    }else{
      const idle = p.onGround && Math.abs(p.vx) < 0.05 && Math.abs(p.vy) < 0.05 && !keys.left && !keys.right && !keys.up;
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
  if(keys.left) { p.vx -= accel; p.dir=-1; }
  if(keys.right){ p.vx += accel; p.dir=1; }
  if(!keys.left && !keys.right && p.onGround){
    p.vx*=RUN_DECEL;
    if(Math.abs(p.vx) < 0.05) p.vx = 0;
  }

  if(p.jumpBuffer>0 && (p.onGround || p.coyote>0)){
    p.vy = JUMP_VELOCITY;
    p.onGround=false;
    p.coyote=0; p.jumpBuffer=0;
    p.scaleY=0.9; p.scaleX=1.1;
  }

  if(!keys.up && p.vy<0) p.vy *= 0.4; // variable jump

  p.vy += GRAVITY;
  // limit speeds
  p.vx = Math.max(Math.min(p.vx, MAX_RUN_SPEED), -MAX_RUN_SPEED);

  const prevCenterX = p.x + p.w/2;
  moveAndCollide(p, dt);
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
  const lookAhead = Math.min(Math.max(Math.abs(vInst)*0.18,80),220) * p.dir;
  const targetX = p.x + p.w/2 - viewWidth/2 + lookAhead;
  const targetY = p.y + p.h/2 - viewHeight/2;
  world.camera.x += (targetX - world.camera.x)*0.15;
  world.camera.y += (targetY - world.camera.y)*0.15;
  if(p.onGround){
    if(Math.abs(p.vx) < 0.05 && Math.abs(targetX - world.camera.x) < 0.5) world.camera.x = targetX;
    if(Math.abs(p.vy) < 0.05 && Math.abs(targetY - world.camera.y) < 0.5) world.camera.y = targetY;
  }
}

function rectIntersect(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function render(){
  const camX = Math.round(world.camera.x*dpr)/dpr;
  const camY = Math.round(world.camera.y*dpr)/dpr;
  const bgOffset = Math.round(camX*0.2*dpr)/dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawBackground(bgOffset);
  ctx.setTransform(dpr,0,0,dpr,-camX*dpr,-camY*dpr);
  drawPlatforms();
  drawCoins();
  drawPlayer();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawHUD(camX, camY);
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
  const p = world.player;
  const vInst = p.vx*10;
  const vTiles = vInst/60;
  ctx.fillText(`v_inst: ${vInst.toFixed(1)}px/s (${vTiles.toFixed(2)}t/s)`,20,70);
  ctx.fillText(`v_max: ${vMax.toFixed(1)}px/s`,20,90);
  if(segment.done){
    const vAvg = 1200/segment.delta;
    const vAvgTiles = vAvg/60;
    ctx.fillText(`Δt: ${segment.delta.toFixed(2)}s`,20,110);
    ctx.fillText(`v_avg: ${vAvg.toFixed(1)}px/s (${vAvgTiles.toFixed(2)}t/s)`,20,130);
  }
  ctx.fillText('v'+GAME_VERSION, viewWidth-80, viewHeight-20);
  if(debug){
    ctx.fillText(`camX:${camX.toFixed(2)} camY:${camY.toFixed(2)}`,20,150);
    ctx.fillText(`playerX:${p.x.toFixed(2)} playerY:${p.y.toFixed(2)}`,20,170);
    ctx.fillText(`dpr:${dpr.toFixed(2)} canvas:${viewWidth}x${viewHeight}`,20,190);
  }
}
