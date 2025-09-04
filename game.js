const GAME_VERSION = self.GAME_VERSION;
if(self.BOOT) self.BOOT.script = true;

function asArray(v){ return Array.isArray(v)?v:[]; }

let canvas, ctx, last=0, acc=0, fps=60, fpsTime=0, frameCount=0;
const dt = 1/60;
let safeMode = false;
let score = 0;
let isReady = false;
let loader = null;

const keys = {left:false,right:false,up:false};

const world = { platforms:[], coins:[], player:null, camera:{x:0,y:0,shake:0,shakeTime:0} };

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
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  if(innerWidth < 720) safeMode = true;
}

function init(){
  // Input
  window.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
    if(e.code==='ArrowLeft'||e.code==='KeyA') keys.left=true;
    if(e.code==='ArrowRight'||e.code==='KeyD') keys.right=true;
    if(e.code==='ArrowUp'||e.code==='KeyW'||e.code==='Space'){ keys.up=true; world.player.jumpBuffer=JUMP_BUFFER_MS; }
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
    scaleX:1,scaleY:1,blink:0,blinkTimer:0,breathe:0,dir:1
  };
}

const GRAVITY = 1.2;
const MOVE_SPEED = 6.0;
const JUMP_VELOCITY = -35;
const COYOTE_MS = 100;
const JUMP_BUFFER_MS = 120;
const FRICTION = 0.85;

function loop(t){
  try{
    const delta = t-last; last=t;
    acc += delta/1000;
    frameCount++;
    if(t - fpsTime > 1000){ fps = frameCount; frameCount=0; fpsTime=t; if(fps<30) safeMode=true; }
    while(acc>dt){ update(dt); acc-=dt; }
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
  p.blinkTimer -= dt*1000; if(p.blinkTimer<=0){ p.blinkTimer = 200+Math.random()*200; p.blink=1; }
  if(p.blinkTimer < 20) p.blink = 0;

  p.coyote-=dt*1000; if(p.coyote<0) p.coyote=0;
  p.jumpBuffer-=dt*1000; if(p.jumpBuffer<0) p.jumpBuffer=0;

  // Input
  if(keys.left) { p.vx -= MOVE_SPEED; p.dir=-1; }
  if(keys.right){ p.vx += MOVE_SPEED; p.dir=1; }
  if(!keys.left && !keys.right && p.onGround) p.vx*=FRICTION;

  if(p.jumpBuffer>0 && (p.onGround || p.coyote>0)){
    p.vy = JUMP_VELOCITY;
    p.onGround=false;
    p.coyote=0; p.jumpBuffer=0;
    p.scaleY=0.9; p.scaleX=1.1;
  }

  if(!keys.up && p.vy<0) p.vy *= 0.4; // variable jump

  p.vy += GRAVITY;
  // limit speeds
  p.vx = Math.max(Math.min(p.vx, MOVE_SPEED), -MOVE_SPEED);

  moveAndCollide(p, dt);
  updateCoins(dt);
  updateCamera(dt);
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
      if(p.vy>0){ p.y = pl.y - p.h; p.vy=0; p.onGround=true; p.coyote=COYOTE_MS; landed=true; world.camera.shakeTime=200; }
      else if(p.vy<0){ p.y = pl.y + pl.h; p.vy=0; }
    }
  }
  if(!landed && p.onGround){ p.onGround=false; p.coyote=COYOTE_MS; world.camera.shakeTime=0; }

  // ease scale back
  p.scaleX += (1 - p.scaleX)*0.1;
  p.scaleY += (1 - p.scaleY)*0.1;
}

function updateCoins(dt){
  for(const c of world.coins){
    c.t += dt;
    if(!c.collected){
      if(rectIntersect({x:world.player.x,y:world.player.y,w:world.player.w,h:world.player.h}, {x:c.x-10,y:c.y-10,w:20,h:20})){
        c.collected=true; score++; world.camera.shakeTime=200;
      }
    }
  }
}

function updateCamera(dt){
  const p = world.player;
  const targetX = p.x + p.w/2 - canvas.width/2;
  const targetY = p.y + p.h/2 - canvas.height/2;
  world.camera.x += (targetX - world.camera.x)*0.1;
  world.camera.y += (targetY - world.camera.y)*0.1;
  if(p.onGround){
    world.camera.shakeTime -= dt*1000;
    if(world.camera.shakeTime < 0) world.camera.shakeTime = 0;
  }else{
    world.camera.shakeTime = 0;
  }
  world.camera.shake = world.camera.shakeTime > 0 ? 5 * (world.camera.shakeTime/200) : 0;
}

function rectIntersect(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function render(){
  drawBackground(world.camera.x*0.2);
  ctx.save();
  const shakeX = (Math.random()*2-1)*world.camera.shake;
  const shakeY = (Math.random()*2-1)*world.camera.shake;
  ctx.translate(-world.camera.x + shakeX, -world.camera.y + shakeY);
  drawPlatforms();
  drawCoins();
  drawPlayer();
  ctx.restore();
  drawHUD();
}

function drawBackground(offset){
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'#4a90e2');
  grad.addColorStop(1,'#87ceeb');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
  if(!safeMode){
    ctx.fillStyle = '#a0d0ff';
    for(let i=0;i<3;i++){
      const x = (offset*0.3 + i*200)% (w+200) -200;
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
  ctx.scale(p.scaleX*breathe, p.scaleY/breathe);
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
  if(p.blink){
    ctx.beginPath(); ctx.arc(-8+eyeOffset,eyeY,4,0,Math.PI*2); ctx.arc(8+eyeOffset,eyeY,4,0,Math.PI*2); ctx.fill();
  }else{
    ctx.fillRect(-10+eyeOffset,eyeY-1,6,2);
    ctx.fillRect(4+eyeOffset,eyeY-1,6,2);
  }
  // mouth
  ctx.beginPath();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.moveTo(-8,8); ctx.quadraticCurveTo(0,12,8,8);
  ctx.stroke();
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
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText('Coins: '+score,20,30);
  ctx.fillText('Arrows/A,D move • W/↑/Space jump',20,50);
  ctx.fillText('v'+GAME_VERSION, canvas.width-80, canvas.height-20);
}
