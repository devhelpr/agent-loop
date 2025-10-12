// Simple arcade-style Asteroids clone (vanilla JS)
// Controls: left/right/up/space/p

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = canvas.width = canvas.clientWidth;
let H = canvas.height = canvas.clientHeight;

// responsive canvas on resize
function resize(){
  const ratio = window.devicePixelRatio || 1;
  W = canvas.width = Math.floor(canvas.clientWidth * ratio);
  H = canvas.height = Math.floor(canvas.clientHeight * ratio);
  canvas.style.width = canvas.clientWidth + 'px';
  canvas.style.height = canvas.clientHeight + 'px';
  ctx.setTransform(ratio,0,0,ratio,0,0);
}
window.addEventListener('resize', resize);
resize();

// Game state
let keys = {};
let bullets = [];
let asteroids = [];
let particles = [];
let score = 0;
let lives = 3;
let running = false;
let paused = false;

const ship = {
  x: W/2, y: H/2,
  r: 14,
  angle: -Math.PI/2,
  thrust: {x:0,y:0},
  turning:0,
  accelerating:false,
  blink:0,
};

// helpers
function rand(min,max){return Math.random()*(max-min)+min}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}

// create asteroids
function spawnAsteroids(n=5){
  for(let i=0;i<n;i++){
    const a = {x: rand(0,W), y: rand(0,H), r: rand(30,70), vx: rand(-0.6,0.6), vy: rand(-0.6,0.6), spin: rand(-0.02,0.02)};
    asteroids.push(a);
  }
}

function fire(){
  if(!running || paused) return;
  bullets.push({x: ship.x + Math.cos(ship.angle)*ship.r, y: ship.y + Math.sin(ship.angle)*ship.r, vx: Math.cos(ship.angle)*6 + ship.thrust.x, vy: Math.sin(ship.angle)*6 + ship.thrust.y, life:60});
}

function explode(x,y,amount=12,color='#fff'){
  for(let i=0;i<amount;i++){
    particles.push({x,y,vx:rand(-2,2),vy:rand(-2,2),life:rand(30,80),col:color});
  }
}

// input
window.addEventListener('keydown',e=>{
  keys[e.key.toLowerCase()] = true;
  if(e.key === ' '){ e.preventDefault(); fire(); }
  if(e.key.toLowerCase()==='p'){ paused = !paused; }
});
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()] = false; });

// game loop
let last = performance.now();
function loop(now){
  const dt = Math.min(40, now - last)/16; last = now;
  if(running && !paused){ update(dt); }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  // turning
  if(keys['arrowleft'] || keys['a']) ship.angle -= 0.06*dt;
  if(keys['arrowright'] || keys['d']) ship.angle += 0.06*dt;
  // thrust
  if(keys['arrowup'] || keys['w']){
    ship.thrust.x += Math.cos(ship.angle)*0.12*dt;
    ship.thrust.y += Math.sin(ship.angle)*0.12*dt;
    ship.accelerating = true;
  } else { ship.accelerating = false; ship.thrust.x *= 0.993; ship.thrust.y *= 0.993; }

  ship.x += ship.thrust.x*dt*1.2;
  ship.y += ship.thrust.y*dt*1.2;

  // wrap
  if(ship.x < -ship.r) ship.x = W + ship.r;
  if(ship.x > W + ship.r) ship.x = -ship.r;
  if(ship.y < -ship.r) ship.y = H + ship.r;
  if(ship.y > H + ship.r) ship.y = -ship.r;

  // bullets
  bullets = bullets.filter(b=>{ b.x += b.vx*dt; b.y += b.vy*dt; b.life--; return b.life>0 && b.x>-50 && b.x<W+50 && b.y>-50 && b.y<H+50; });

  // asteroids
  for(let a of asteroids){
    a.x += a.vx*dt*1.2; a.y += a.vy*dt*1.2; a.angle = (a.angle||0) + a.spin*dt;
    if(a.x < -a.r) a.x = W + a.r;
    if(a.x > W + a.r) a.x = -a.r;
    if(a.y < -a.r) a.y = H + a.r;
    if(a.y > H + a.r) a.y = -a.r;
  }

  // collisions bullets-asteroids
  for(let i=asteroids.length-1;i>=0;i--){
    const a = asteroids[i];
    for(let j=bullets.length-1;j>=0;j--){
      const b = bullets[j];
      if(Math.hypot(a.x-b.x,a.y-b.y) < a.r){
        // hit
        bullets.splice(j,1);
        asteroids.splice(i,1);
        score += Math.floor(100/a.r*10)+50;
        explode(a.x,a.y, Math.floor(a.r/6), 'rgba(112,240,216,0.9)');
        if(a.r > 35){
          // split
          const cnt = 1 + Math.floor(rand(1,3));
          for(let k=0;k<cnt;k++){
            asteroids.push({x:a.x, y:a.y, r: a.r/2, vx: rand(-1.5,1.5), vy: rand(-1.5,1.5), spin: rand(-0.04,0.04)});
          }
        }
        break;
      }
    }
  }

  // ship collisions
  for(let i=asteroids.length-1;i>=0;i--){
    const a = asteroids[i];
    if(Math.hypot(a.x-ship.x,a.y-ship.y) < a.r + ship.r - 4){
      explode(ship.x, ship.y, 32, 'rgba(255,120,120,0.95)');
      lives -= 1; ship.x = W/2; ship.y = H/2; ship.thrust.x = ship.thrust.y = 0; ship.angle = -Math.PI/2;
      if(lives <= 0){ endGame(); }
      break;
    }
  }

  // particles
  particles = particles.filter(p=>{ p.x += p.vx*dt; p.y += p.vy*dt; p.life--; return p.life>0; });

  // spawn more asteroids if cleared
  if(asteroids.length === 0){ spawnAsteroids(3 + Math.floor(score/1000)); }

  // update HUD
  document.getElementById('score').textContent = score;
  document.getElementById('lives').textContent = lives;
}

function draw(){
  // background grid
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // subtle star field
  ctx.fillStyle = '#07121a';
  ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);

  // stars
  for(let i=0;i<40;i++){
    ctx.fillStyle = `rgba(255,255,255,${0.02 + (i%5)/50})`;
    ctx.fillRect((i*47)%canvas.clientWidth, (i*83)%canvas.clientHeight, 1.5,1.5);
  }

  // draw asteroids
  for(const a of asteroids){
    ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(a.angle||0);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
    const points = Math.max(6, Math.floor(a.r/8));
    for(let i=0;i<points;i++){
      const ang = i*(Math.PI*2/points);
      const rad = a.r * (0.7 + Math.sin(i*3 + a.x)*0.2);
      const x = Math.cos(ang)*rad, y = Math.sin(ang)*rad;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  // bullets
  ctx.fillStyle = '#fff';
  for(const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,2,0,Math.PI*2); ctx.fill(); }

  // ship
  ctx.save(); ctx.translate(ship.x,ship.y); ctx.rotate(ship.angle);
  ctx.strokeStyle = '#dffcf3'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(ship.r,0); ctx.lineTo(-ship.r*0.6, -ship.r*0.6); ctx.lineTo(-ship.r*0.6, ship.r*0.6); ctx.closePath(); ctx.stroke();
  // thrust
  if(ship.accelerating){ ctx.beginPath(); ctx.moveTo(-ship.r*0.6, -6); ctx.lineTo(-ship.r-8, 0); ctx.lineTo(-ship.r*0.6, 6); ctx.fillStyle = 'rgba(120,167,255,0.9)'; ctx.fill(); }
  ctx.restore();

  // particles
  for(const p of particles){ ctx.fillStyle = p.col; ctx.fillRect(p.x,p.y,2,2); }

  // HUD hint small
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(12,12,160,36); ctx.restore();

  // overlay handling
  const overlay = document.getElementById('overlay');
  overlay.style.display = running ? 'none' : 'flex';
}

// start / end
function startGame(){
  running = true; paused = false; score = 0; lives = 3; bullets = []; asteroids = []; particles = [];
  ship.x = canvas.clientWidth/2; ship.y = canvas.clientHeight/2; ship.thrust.x = ship.thrust.y = 0; ship.angle = -Math.PI/2;
  spawnAsteroids(5);
}

function endGame(){
  running = false; document.getElementById('overlay-title').textContent = 'Game Over';
  document.getElementById('overlay-msg').innerHTML = `Final score: <strong>${score}</strong> — Press <kbd>Space</kbd> to restart`;
  document.getElementById('start-btn').textContent = 'Restart';
}

// UI buttons
document.getElementById('start-btn').addEventListener('click', ()=>{ startGame(); });
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target === e.currentTarget){ /*click outside*/ } });

// mute placeholder
let muted=false; document.getElementById('mute-btn').addEventListener('click', e=>{ muted=!muted; e.target.textContent = muted ? 'Unmute' : 'Mute'; });

// quick start on space when overlay shown
window.addEventListener('keydown', e=>{ if(e.key === ' ' && !running){ e.preventDefault(); startGame(); } });

// initial display
document.getElementById('overlay-title').textContent = 'ASTEROIDS';

// add subtle scanline overlay element for retro look
const scan = document.createElement('div'); scan.className='hud-scanline'; document.querySelector('.game-wrap').appendChild(scan);

