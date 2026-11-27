'use strict';
/* Gobble Dash — Tilly's Great Escape.
 * An original endless-runner: Tilly the turkey flees Maplewood Farm before
 * Thanksgiving dinner. Jump the ovens and hay bales, duck the flying carving
 * knives, grab corn, and stay ahead of Farmer Bram for 1200 metres.
 * All art is drawn procedurally on one canvas; all sound is WebAudio.
 * No network, no assets, no libraries. Deterministic: one fixed seed drives
 * every run, and a fixed 1/60 s step drives every update. */

var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');
var W = 1280, H = 720;
var GROUND_Y = 600;
var GOAL_M = 1200;
var GRAVITY = 2500;
var JUMP_V = -1020;

/* --- deterministic RNG (mulberry32, fixed seed) --- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rng = mulberry32(20261127);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/* --- game state --- */
var state = 'title'; // title | play | caught | escaped | paused
var stateBeforePause = 'title';
var time = 0;          // seconds since run start (play time)
var animTime = 0;      // always-advancing clock for idle animation
var distancePx = 0;
var speed = 300;
var score = 0;
var corn = 0;
var lives = 3;
var farmerGap = 190;   // px behind Tilly; small = danger
var shake = 0;
var flash = 0;
var warning = 0;       // seconds of "farmer close" warning left
var best = 0;
try { best = Number(window.localStorage.getItem('gobbleDashBest') || 0) || 0; } catch (e) { best = 0; }

var player = { x: 230, y: GROUND_Y, vy: 0, onGround: true, duck: false, invuln: 0, runPhase: 0 };
var obstacles = [];    // {kind:'oven'|'knife'|'hay', x, y, w, h, passed, bob}
var pickups = [];      // {kind:'corn'|'pumpkin', x, y, taken, bob}
var particles = [];    // {x,y,vx,vy,life,maxLife,size,color,kind}
var clouds = [];
var leaves = [];
var spawnIn = 520;     // px until next spawn
var muted = false;
var audioCtx = null;
var buttons = [];      // {x,y,w,h,label,action} rebuilt every frame for hit-testing
var sceneMode = null;  // static screenshot scene, from ?scene=

function resetRun() {
  rng = mulberry32(20261127);
  state = 'play';
  time = 0; distancePx = 0; speed = 300; score = 0; corn = 0; lives = 3;
  farmerGap = 190; shake = 0; flash = 0; warning = 0;
  player = { x: 230, y: GROUND_Y, vy: 0, onGround: true, duck: false, invuln: 0, runPhase: 0 };
  obstacles = []; pickups = []; particles = [];
  spawnIn = 420;
  spawnLeaves();
}

function spawnLeaves() {
  leaves = [];
  for (var i = 0; i < 26; i++) {
    leaves.push({
      x: rng() * W, y: 40 + rng() * 380,
      vx: 18 + rng() * 30, vy: 10 + rng() * 22,
      rot: rng() * Math.PI * 2, vr: (rng() - 0.5) * 2,
      size: 7 + rng() * 9,
      color: ['#c96f2e', '#d99a2b', '#a8512f', '#e0b13c'][Math.floor(rng() * 4)]
    });
  }
  clouds = [];
  for (var j = 0; j < 6; j++) {
    clouds.push({ x: rng() * W, y: 34 + rng() * 110, s: 0.7 + rng() * 0.9, v: 6 + rng() * 8 });
  }
}
spawnLeaves();

/* --- sound: tiny WebAudio bleeps, no files --- */
function ensureAudio() {
  if (audioCtx) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  } catch (e) { audioCtx = null; }
}
function tone(freq, dur, type, vol, slideTo) {
  if (muted || !audioCtx) return;
  try {
    var t0 = audioCtx.currentTime;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) { /* sound is decoration; never break the game */ }
}
function sndJump() { tone(420, 0.16, 'triangle', 0.10, 760); }
function sndCorn() { tone(880, 0.09, 'sine', 0.12, 1320); tone(1320, 0.12, 'sine', 0.08); }
function sndHit() { tone(180, 0.25, 'sawtooth', 0.14, 70); }
function sndGobble() {
  if (muted || !audioCtx) return;
  var f = [520, 430, 610, 380];
  for (var i = 0; i < f.length; i++) {
    (function (fr, delay) {
      setTimeout(function () { tone(fr, 0.07, 'square', 0.06, fr * 0.7); }, delay);
    })(f[i], i * 70);
  }
}
function sndWin() {
  var notes = [523, 659, 784, 1047, 784, 1047];
  for (var i = 0; i < notes.length; i++) {
    (function (fr, delay) { setTimeout(function () { tone(fr, 0.22, 'triangle', 0.12); }, delay); })(notes[i], i * 130);
  }
}
function sndCaught() {
  var notes = [392, 330, 262, 196];
  for (var i = 0; i < notes.length; i++) {
    (function (fr, delay) { setTimeout(function () { tone(fr, 0.3, 'sawtooth', 0.10); }, delay); })(notes[i], i * 160);
  }
}

/* --- spawning: patterns chosen from the seeded stream --- */
function spawnPattern() {
  var roll = rng();
  var x = W + 80;
  if (roll < 0.30) {
    obstacles.push({ kind: 'oven', x: x, y: GROUND_Y, w: 96, h: 118, passed: false, bob: 0 });
  } else if (roll < 0.52) {
    obstacles.push({ kind: 'knife', x: x, y: GROUND_Y - 168, w: 120, h: 34, passed: false, bob: rng() * 6 });
  } else if (roll < 0.68) {
    obstacles.push({ kind: 'hay', x: x, y: GROUND_Y, w: 104, h: 72, passed: false, bob: 0 });
    obstacles.push({ kind: 'oven', x: x + 300, y: GROUND_Y, w: 96, h: 118, passed: false, bob: 0 });
  } else if (roll < 0.86) {
    for (var i = 0; i < 4; i++) {
      pickups.push({ kind: 'corn', x: x + i * 56, y: GROUND_Y - 96, taken: false, bob: i * 0.7 });
    }
    if (rng() < 0.5) obstacles.push({ kind: 'knife', x: x + 330, y: GROUND_Y - 168, w: 120, h: 34, passed: false, bob: 0 });
  } else {
    pickups.push({ kind: 'pumpkin', x: x, y: GROUND_Y - 70, taken: false, bob: 0 });
    obstacles.push({ kind: 'hay', x: x + 260, y: GROUND_Y, w: 104, h: 72, passed: false, bob: 0 });
  }
  // Next gap shrinks as speed grows: fair ramp, never unfair.
  var gapBase = lerp(560, 380, clamp((speed - 300) / 260, 0, 1));
  spawnIn = gapBase + rng() * 260;
}

function burst(x, y, color, n, spd) {
  for (var i = 0; i < n; i++) {
    var a = rng() * Math.PI * 2, s = spd * (0.4 + rng() * 0.8);
    particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0, maxLife: 0.5 + rng() * 0.5, size: 3 + rng() * 6, color: color, kind: 'dot' });
  }
}
function featherBurst(x, y) {
  for (var i = 0; i < 10; i++) {
    particles.push({ x: x, y: y, vx: -60 - rng() * 140, vy: -40 - rng() * 160, life: 0, maxLife: 0.8 + rng() * 0.5, size: 6 + rng() * 8, color: ['#6b4423', '#8b5a2b', '#d99a2b'][i % 3], kind: 'feather', rot: rng() * 6.28, vr: (rng() - 0.5) * 8 });
  }
}

function playerBox() {
  var h = player.duck ? 62 : 96;
  var w = 84;
  return { x: player.x - 34, y: player.y - h, w: w, h: h };
}
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function doHit(ob) {
  if (player.invuln > 0) return;
  lives -= 1;
  player.invuln = 1.4;
  farmerGap = Math.max(34, farmerGap - 72);
  shake = 16; flash = 0.35; warning = 1.6;
  featherBurst(player.x, player.y - 60);
  sndHit();
  if (lives <= 0) {
    state = 'caught';
    sndCaught();
    if (score > best) { best = score; try { window.localStorage.setItem('gobbleDashBest', String(best)); } catch (e) {} }
  }
}

function update(dt) {
  animTime += dt;
  if (state !== 'play') return;
  time += dt;
  // Difficulty ramp: speed grows with distance, capped; score ticks with it.
  var distM = distancePx / 50;
  speed = Math.min(560, 300 + distM * 0.22);
  distancePx += speed * dt;
  score += Math.round(speed * dt * 0.12);
  // Farmer: drifts nearer when Tilly dawdles after a hit, recovers slowly.
  farmerGap = clamp(farmerGap + (player.invuln > 0 ? -14 : 9) * dt, 34, 230);
  if (farmerGap < 88) warning = Math.max(warning, 0.4);
  if (shake > 0) shake = Math.max(0, shake - 40 * dt);
  if (flash > 0) flash = Math.max(0, flash - dt);
  if (warning > 0) warning = Math.max(0, warning - dt);
  if (player.invuln > 0) player.invuln -= dt;

  // Vertical motion.
  if (!player.onGround) {
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND_Y) { player.y = GROUND_Y; player.vy = 0; player.onGround = true; burst(player.x, GROUND_Y, '#c9a06a', 5, 90); }
  }
  player.runPhase += dt * (player.onGround ? speed / 34 : 6);

  // Spawning and scrolling.
  spawnIn -= speed * dt;
  if (spawnIn <= 0) spawnPattern();
  var i, ob, pk;
  for (i = 0; i < obstacles.length; i++) {
    ob = obstacles[i];
    ob.x -= speed * dt;
    if (ob.kind === 'knife') ob.y += Math.sin(animTime * 5 + ob.bob) * 22 * dt;
    if (!ob.passed && ob.x + ob.w < player.x - 40) { ob.passed = true; score += 25; }
    if (player.invuln <= 0) {
      var hb = { x: ob.x + 8, y: ob.kind === 'knife' ? ob.y + 4 : GROUND_Y - ob.h + 8, w: ob.w - 16, h: ob.kind === 'knife' ? ob.h - 8 : ob.h - 8 };
      if (overlap(playerBox(), hb)) doHit(ob);
    }
  }
  obstacles = obstacles.filter(function (o) { return o.x + o.w > -80; });
  for (i = 0; i < pickups.length; i++) {
    pk = pickups[i];
    pk.x -= speed * dt;
    if (!pk.taken && overlap(playerBox(), { x: pk.x - 20, y: pk.y - 20, w: 40, h: 40 })) {
      pk.taken = true;
      if (pk.kind === 'corn') { corn += 1; score += 50; sndCorn(); burst(pk.x, pk.y, '#f2c230', 7, 110); }
      else { lives = Math.min(3, lives + 1); score += 100; sndCorn(); burst(pk.x, pk.y, '#e07b2e', 10, 130); }
    }
  }
  pickups = pickups.filter(function (p) { return !p.taken && p.x > -60; });

  // Ambience: leaves and clouds drift; particles age.
  for (i = 0; i < leaves.length; i++) {
    var lf = leaves[i];
    lf.x -= (lf.vx + speed * 0.06) * dt; lf.y += lf.vy * dt; lf.rot += lf.vr * dt;
    if (lf.x < -20) { lf.x = W + 20; lf.y = 40 + rng() * 380; }
    if (lf.y > GROUND_Y - 8) lf.y = 40;
  }
  for (i = 0; i < clouds.length; i++) {
    clouds[i].x -= clouds[i].v * dt;
    if (clouds[i].x < -160) { clouds[i].x = W + 120; clouds[i].y = 34 + rng() * 110; }
  }
  for (i = particles.length - 1; i >= 0; i--) {
    var pt = particles[i];
    pt.life += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 300 * dt;
    if (pt.rot !== undefined) pt.rot += pt.vr * dt;
    if (pt.life >= pt.maxLife) particles.splice(i, 1);
  }

  // Escape!
  if (distM >= GOAL_M) {
    state = 'escaped';
    score += 500;
    sndWin();
    if (score > best) { best = score; try { window.localStorage.setItem('gobbleDashBest', String(best)); } catch (e) {} }
  }
}

function jump() {
  if (state === 'play' && player.onGround) {
    player.vy = JUMP_V; player.onGround = false; player.duck = false;
    sndJump();
    burst(player.x, GROUND_Y, '#d9b382', 6, 100);
  }
}

/* --- drawing helpers --- */
function ellipse(x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function circle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function rr(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}
function text(str, x, y, size, color, align, weight, font) {
  ctx.fillStyle = color;
  ctx.font = (weight || 'bold') + ' ' + size + 'px ' + (font || 'system-ui, sans-serif');
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}
function textOutline(str, x, y, size, color, align, weight) {
  ctx.font = (weight || 'bold') + ' ' + size + 'px system-ui, sans-serif';
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = Math.max(3, size / 8); ctx.strokeStyle = 'rgba(43,26,18,0.85)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,244,224,0.92)';
  ctx.beginPath();
  ctx.arc(x, y, 26 * s, 0, Math.PI * 2);
  ctx.arc(x + 30 * s, y - 10 * s, 32 * s, 0, Math.PI * 2);
  ctx.arc(x + 64 * s, y, 26 * s, 0, Math.PI * 2);
  ctx.arc(x + 32 * s, y + 10 * s, 30 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackground(scrollX) {
  var sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#f2a65a');
  sky.addColorStop(0.55, '#f7c873');
  sky.addColorStop(1, '#f9dc9a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y + 2);
  // Low autumn sun.
  var sun = ctx.createRadialGradient(1050, 130, 10, 1050, 130, 150);
  sun.addColorStop(0, 'rgba(255,240,190,0.95)');
  sun.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(880, 0, 400, 320);
  circle(1050, 130, 58, '#fff3c4');
  circle(1050, 130, 44, '#ffedb0');
  var i;
  for (i = 0; i < clouds.length; i++) drawCloud(clouds[i].x, clouds[i].y, clouds[i].s);
  // Distant hills.
  ctx.fillStyle = '#c98a4b';
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
  for (i = 0; i <= W; i += 40) ctx.lineTo(i, GROUND_Y - 120 - Math.sin((i + scrollX * 0.1) / 260) * 34);
  ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b87a3e';
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
  for (i = 0; i <= W; i += 40) ctx.lineTo(i, GROUND_Y - 64 - Math.sin((i + scrollX * 0.22) / 200 + 2) * 26);
  ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  // Barn + trees, parallax layer (wrapped so the farm never empties).
  var bx = 900 - ((scrollX * 0.35) % 1500);
  drawBarn(bx, GROUND_Y);
  drawBarn(bx + 1500, GROUND_Y);
  var tx1 = 180 - ((scrollX * 0.35) % 1500);
  var tx2 = 560 - ((scrollX * 0.35) % 1500);
  drawTree(tx1, GROUND_Y);
  drawTree(tx1 + 1500, GROUND_Y);
  drawTree(tx2, GROUND_Y);
  drawTree(tx2 + 1500, GROUND_Y);
  // Fence posts scrolling at full speed.
  ctx.fillStyle = '#7a4a26';
  var off = -(scrollX % 90);
  for (i = 0; i < 17; i++) {
    var fx = off + i * 90;
    ctx.fillRect(fx, GROUND_Y - 58, 10, 58);
    ctx.fillRect(fx - 4, GROUND_Y - 62, 18, 8);
  }
  ctx.fillStyle = '#8d5a2e';
  ctx.fillRect(0, GROUND_Y - 44, W, 10);
  ctx.fillRect(0, GROUND_Y - 26, W, 8);
  // Ground: dirt + grass strip + scrolling tufts and stones.
  var g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  g.addColorStop(0, '#a9713d'); g.addColorStop(0.25, '#8d5a2e'); g.addColorStop(1, '#6e421f');
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = '#7fae4c';
  ctx.fillRect(0, GROUND_Y, W, 12);
  ctx.strokeStyle = 'rgba(60,40,20,0.35)'; ctx.lineWidth = 2;
  var goff = -(scrollX % 70);
  for (i = 0; i < 20; i++) {
    var gx = goff + i * 70;
    ctx.beginPath(); ctx.moveTo(gx, GROUND_Y + 34); ctx.lineTo(gx + 8, GROUND_Y + 52); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx + 30, GROUND_Y + 70); ctx.lineTo(gx + 38, GROUND_Y + 88); ctx.stroke();
  }
  ctx.fillStyle = '#5d8a38';
  for (i = 0; i < 20; i++) {
    var tx = goff + i * 70 + 20;
    ctx.beginPath();
    ctx.moveTo(tx, GROUND_Y + 6); ctx.lineTo(tx - 5, GROUND_Y - 8); ctx.lineTo(tx, GROUND_Y + 4);
    ctx.lineTo(tx + 5, GROUND_Y - 8); ctx.lineTo(tx + 2, GROUND_Y + 6);
    ctx.closePath(); ctx.fill();
  }
  // Falling leaves.
  for (i = 0; i < leaves.length; i++) {
    var lf = leaves[i];
    ctx.save();
    ctx.translate(lf.x, lf.y); ctx.rotate(lf.rot);
    ctx.fillStyle = lf.color;
    ctx.beginPath(); ctx.ellipse(0, 0, lf.size, lf.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawBarn(x, groundY) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#a83a2a';
  ctx.fillRect(-110, -150, 220, 150);
  ctx.beginPath();
  ctx.moveTo(-126, -148); ctx.lineTo(0, -216); ctx.lineTo(126, -148); ctx.closePath();
  ctx.fillStyle = '#7e2a1e'; ctx.fill();
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(-34, -96, 68, 96);
  ctx.strokeStyle = '#7e2a1e'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-34, -96); ctx.lineTo(34, 0); ctx.moveTo(34, -96); ctx.lineTo(-34, 0); ctx.stroke();
  ctx.fillStyle = '#f7ecd2';
  ctx.fillRect(-84, -128, 34, 34); ctx.fillRect(50, -128, 34, 34);
  ctx.strokeStyle = '#7e2a1e'; ctx.lineWidth = 3;
  ctx.strokeRect(-84, -128, 34, 34); ctx.strokeRect(50, -128, 34, 34);
  ctx.restore();
}
function drawTree(x, groundY) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#6e421f';
  ctx.fillRect(-10, -120, 20, 120);
  ctx.fillStyle = '#c96f2e';
  circle(0, -150, 52, '#c96f2e');
  circle(-38, -126, 34, '#d97e35');
  circle(38, -126, 34, '#b85f28');
  ctx.restore();
}

/* --- characters and props, all procedural --- */
function drawTurkey(x, y, s, phase, duck, big) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (duck) ctx.scale(1.25, 0.72);
  var legSwing = Math.sin(phase) * (big ? 0 : 10);
  // Legs.
  ctx.strokeStyle = '#e08a2e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(-12 + legSwing * 0.6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, -8); ctx.lineTo(12 - legSwing * 0.6, 0); ctx.stroke();
  ctx.fillStyle = '#e08a2e';
  ctx.fillRect(-20 + legSwing * 0.6, -3, 16, 4);
  ctx.fillRect(4 - legSwing * 0.6, -3, 16, 4);
  // Tail fan: five feathers.
  var featherCols = ['#8b3a1e', '#c96f2e', '#e0a83c', '#c96f2e', '#8b3a1e'];
  for (var i = 0; i < 5; i++) {
    var ang = -1.15 + i * 0.5;
    var sway = Math.sin(phase * 0.5 + i) * 0.03;
    ctx.save();
    ctx.translate(-38, -56);
    ctx.rotate(ang + sway + Math.PI / 2 - 0.15);
    ellipse(0, -30, 13, 34, featherCols[i]);
    ellipse(0, -34, 6, 20, '#f2d98c');
    ctx.restore();
  }
  // Body.
  ellipse(0, -52, 44, 38, '#6b4423');
  ellipse(-6, -58, 36, 30, '#8b5a2b');
  // Wing.
  ctx.save();
  ctx.translate(-6, -52);
  ctx.rotate(Math.sin(phase) * 0.18 - 0.15);
  ellipse(-6, 0, 30, 17, '#5a3a1e');
  ellipse(-8, -2, 20, 11, '#7a4e28');
  ctx.restore();
  // Neck + head.
  ctx.fillStyle = '#8b5a2b';
  ctx.beginPath(); ctx.ellipse(30, -86, 11, 22, 0.25, 0, Math.PI * 2); ctx.fill();
  circle(38, -104, 17, '#8b5a2b');
  // Bandana (Tilly's red scarf-knot).
  ctx.fillStyle = '#c22f2f';
  ctx.beginPath(); ctx.moveTo(24, -94); ctx.lineTo(44, -90); ctx.lineTo(34, -80); ctx.closePath(); ctx.fill();
  // Beak, snood, wattle, eye.
  ctx.fillStyle = '#f2a03c';
  ctx.beginPath(); ctx.moveTo(50, -106); ctx.lineTo(66, -101); ctx.lineTo(50, -97); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d63a3a';
  ctx.beginPath(); ctx.ellipse(56, -96, 5, 9, 0.2, 0, Math.PI * 2); ctx.fill();
  ellipse(47, -88, 4, 7, '#d63a3a');
  circle(42, -108, 3.4, '#ffffff');
  circle(43, -108, 1.8, '#1d1d1d');
  ctx.restore();
}

function drawFarmer(x, y, s, phase, reaching) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  var bob = Math.sin(phase) * 4;
  // Legs running.
  var sw = Math.sin(phase) * 12;
  ctx.strokeStyle = '#3a4a6b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, -46 + bob * 0.3); ctx.lineTo(-8 + sw, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -46 + bob * 0.3); ctx.lineTo(8 - sw, 0); ctx.stroke();
  // Overalls + plaid shirt.
  ctx.fillStyle = '#c23b2e';
  rr(-26, -108 + bob * 0.3, 52, 62, 8, '#c23b2e');
  ctx.fillStyle = '#2f4a7a';
  ctx.fillRect(-22, -84 + bob * 0.3, 44, 38);
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(-22, -84 + bob * 0.3, 44, 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-22, -100 + bob * 0.3); ctx.lineTo(22, -100 + bob * 0.3); ctx.stroke();
  // Head + straw hat.
  circle(0, -128 + bob * 0.3, 20, '#f0c39a');
  ctx.fillStyle = '#e8c96a';
  ellipse(0, -144 + bob * 0.3, 34, 8, '#e8c96a');
  ctx.fillStyle = '#d9b84e';
  ctx.beginPath(); ctx.ellipse(0, -150 + bob * 0.3, 20, 10, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a83a2a';
  ctx.fillRect(-20, -152 + bob * 0.3, 40, 6);
  // Angry brows + moustache.
  ctx.strokeStyle = '#4a2c14'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-13, -134 + bob * 0.3); ctx.lineTo(-3, -130 + bob * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(13, -134 + bob * 0.3); ctx.lineTo(3, -130 + bob * 0.3); ctx.stroke();
  circle(-7, -127 + bob * 0.3, 2.4, '#1d1d1d');
  circle(7, -127 + bob * 0.3, 2.4, '#1d1d1d');
  ctx.fillStyle = '#7a4a26';
  ctx.beginPath(); ctx.ellipse(0, -118 + bob * 0.3, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Reaching arm + butterfly net.
  ctx.strokeStyle = '#f0c39a'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  var reach = reaching ? 30 : 16;
  ctx.beginPath(); ctx.moveTo(20, -100 + bob * 0.3); ctx.lineTo(20 + reach, -118 + bob * 0.3); ctx.stroke();
  ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(20 + reach, -118 + bob * 0.3); ctx.lineTo(34 + reach, -132 + bob * 0.3); ctx.stroke();
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(44 + reach, -142 + bob * 0.3, 18, 13, -0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(220,230,240,0.55)'; ctx.lineWidth = 1;
  for (var k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(44 + reach - 16, -142 + bob * 0.3 + k * 6);
    ctx.lineTo(44 + reach + 16, -142 + bob * 0.3 + k * 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOven(ob) {
  var x = ob.x, top = GROUND_Y - ob.h;
  ctx.save();
  // Heat glow behind.
  var glow = ctx.createRadialGradient(x + 48, top + 60, 8, x + 48, top + 60, 110);
  glow.addColorStop(0, 'rgba(255,120,30,0.5)');
  glow.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 60, top - 40, 220, 200);
  // Brick body.
  rr(x, top, ob.w, ob.h, 8, '#7e3b2e');
  ctx.fillStyle = '#96604a';
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      ctx.fillRect(x + 6 + c * 30 + (r % 2) * 10, top + 8 + r * 20, 24, 12);
    }
  }
  // Door window with fire.
  rr(x + 18, top + 34, 60, 52, 6, '#2b1a12');
  var flick = Math.sin(animTime * 11 + x) * 4;
  ctx.fillStyle = '#ff7a1e';
  ctx.beginPath();
  ctx.moveTo(x + 28, top + 78);
  ctx.quadraticCurveTo(x + 34, top + 48 + flick, x + 48, top + 42);
  ctx.quadraticCurveTo(x + 62, top + 50 + flick, x + 68, top + 78);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd23c';
  ctx.beginPath();
  ctx.moveTo(x + 36, top + 78);
  ctx.quadraticCurveTo(x + 44, top + 58, x + 48, top + 54);
  ctx.quadraticCurveTo(x + 54, top + 60, x + 60, top + 78);
  ctx.closePath(); ctx.fill();
  // Chimney + smoke.
  ctx.fillStyle = '#5a2a20';
  ctx.fillRect(x + 58, top - 26, 22, 30);
  ctx.fillStyle = 'rgba(230,225,215,0.75)';
  circle(x + 72, top - 38, 9, 'rgba(230,225,215,0.75)');
  circle(x + 78, top - 54, 12, 'rgba(230,225,215,0.55)');
  circle(x + 86, top - 72, 15, 'rgba(230,225,215,0.35)');
  // Warning label.
  rr(x + 22, top + 4, 52, 20, 4, '#f2d98c');
  text('HOT!', x + 48, top + 19, 14, '#7e2a1e', 'center', '900');
  ctx.restore();
}

function drawKnife(ob) {
  var x = ob.x, y = ob.y;
  ctx.save();
  ctx.translate(x + 60, y + 17);
  ctx.rotate(Math.sin(animTime * 4 + ob.bob) * 0.06);
  // Motion streaks.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(66, -8); ctx.lineTo(96, -8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(70, 8); ctx.lineTo(104, 8); ctx.stroke();
  // Blade.
  ctx.fillStyle = '#dfe6ec';
  ctx.beginPath();
  ctx.moveTo(-58, -13); ctx.lineTo(28, -13); ctx.lineTo(56, 0); ctx.lineTo(28, 13); ctx.lineTo(-58, 13);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-50, -9); ctx.lineTo(20, -9); ctx.lineTo(40, 0); ctx.lineTo(20, 5); ctx.lineTo(-50, 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#9aa7b0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-58, 13); ctx.lineTo(28, 13); ctx.stroke();
  // Handle.
  rr(-84, -10, 28, 20, 6, '#4a2c14');
  circle(-58, 0, 4, '#c9a06a');
  ctx.restore();
}

function drawHay(ob) {
  var x = ob.x, top = GROUND_Y - ob.h;
  ctx.save();
  ctx.fillStyle = '#d9a83c';
  ctx.beginPath(); ctx.ellipse(x + 52, top + 36, 52, 36, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c9962e';
  ctx.beginPath(); ctx.ellipse(x + 52, top + 40, 44, 28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8a6a1e'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x + 18, top + 12); ctx.lineTo(x + 18, top + 60); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 86, top + 12); ctx.lineTo(x + 86, top + 60); ctx.stroke();
  ctx.strokeStyle = 'rgba(138,106,30,0.6)'; ctx.lineWidth = 2;
  for (var i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 16 + i * 14, top + 20);
    ctx.lineTo(x + 24 + i * 14, top + 52);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCorn(pk) {
  var bobY = Math.sin(animTime * 3 + pk.bob) * 5;
  var x = pk.x, y = pk.y + bobY;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(animTime * 2 + pk.bob) * 0.12);
  ctx.fillStyle = '#f2c230';
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e0a81e';
  for (var i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.ellipse(i * 7, 0, 3, 17, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#5d8a38';
  ctx.beginPath(); ctx.moveTo(-12, 10); ctx.lineTo(-20, 26); ctx.lineTo(-6, 16); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12, 10); ctx.lineTo(20, 26); ctx.lineTo(6, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  var tw = 0.5 + 0.5 * Math.sin(animTime * 5 + pk.bob);
  ctx.globalAlpha = tw;
  ctx.fillRect(-18, -24, 4, 4);
  ctx.fillRect(14, -18, 3, 3);
  ctx.globalAlpha = 1;
  ctx.restore();
}
function drawPumpkin(pk) {
  var bobY = Math.sin(animTime * 3 + pk.bob) * 5;
  var x = pk.x, y = pk.y + bobY;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#e07b2e';
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 19, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c9651f';
  ctx.beginPath(); ctx.ellipse(-11, 0, 10, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(11, 0, 10, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5d8a38';
  ctx.fillRect(-3, -26, 6, 10);
  ctx.fillStyle = 'rgba(255,220,120,0.9)';
  ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-6, 2); ctx.lineTo(-12, 8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12, -4); ctx.lineTo(6, 2); ctx.lineTo(12, 8); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* --- HUD and screens --- */
function drawHUD() {
  var distM = Math.floor(distancePx / 50);
  ctx.save();
  // Top bar.
  ctx.fillStyle = 'rgba(43,26,18,0.82)';
  rr(16, 14, 1248, 64, 12, 'rgba(43,26,18,0.82)');
  text('SCORE', 38, 38, 15, '#e8c96a', 'left', '800');
  text(String(score), 38, 64, 26, '#ffffff', 'left', '900');
  text('DISTANCE', 240, 38, 15, '#e8c96a', 'left', '800');
  text(distM + ' m / ' + GOAL_M + ' m', 240, 64, 26, '#ffffff', 'left', '900');
  // Progress bar to freedom.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  rr(470, 32, 300, 16, 8, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = '#7fae4c';
  rr(470, 32, 300 * clamp(distM / GOAL_M, 0, 1), 16, 8, '#7fae4c');
  text('FREEDOM', 470, 66, 13, '#f3e2c7', 'left', '700');
  // Lives as feathers.
  text('LIVES', 810, 38, 15, '#e8c96a', 'left', '800');
  for (var i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(828 + i * 34, 54);
    ctx.rotate(-0.4);
    ellipse(0, 0, 8, 15, i < lives ? '#e0a83c' : 'rgba(255,255,255,0.25)');
    ctx.restore();
  }
  // Farmer proximity meter.
  text('FARMER', 950, 38, 15, '#e8c96a', 'left', '800');
  var danger = 1 - clamp((farmerGap - 34) / 196, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  rr(950, 46, 220, 16, 8, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = danger > 0.66 ? '#d63a3a' : danger > 0.33 ? '#e08a2e' : '#7fae4c';
  rr(950, 46, 220 * danger, 16, 8, danger > 0.66 ? '#d63a3a' : danger > 0.33 ? '#e08a2e' : '#7fae4c');
  text(danger > 0.66 ? 'TOO CLOSE!' : danger > 0.33 ? 'CLOSING IN' : 'FAR BEHIND', 950, 66, 11, '#f3e2c7', 'left', '700');
  // Corn count + mute hint.
  text('CORN ' + corn, 1196, 38, 15, '#f2c230', 'right', '800');
  text(muted ? 'M: SOUND OFF' : 'M: SOUND ON', 1196, 64, 13, '#f3e2c7', 'right', '700');
  ctx.restore();
  if (warning > 0 && state === 'play') {
    var pulse = 0.6 + 0.4 * Math.sin(animTime * 10);
    ctx.globalAlpha = pulse;
    textOutline("HE'S RIGHT BEHIND YOU!", W / 2, 130, 34, '#ffd23c', 'center', '900');
    ctx.globalAlpha = 1;
  }
  if (flash > 0) {
    ctx.fillStyle = 'rgba(214,58,58,' + (flash * 0.9).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawButton(x, y, w, h, label, id) {
  buttons.push({ x: x, y: y, w: w, h: h, action: id });
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  rr(x, y, w, h, 14, '#c22f2f');
  ctx.restore();
  rr(x, y, w, h, 14, '#c22f2f');
  ctx.strokeStyle = '#f3e2c7'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 11); ctx.stroke();
  text(label, x + w / 2, y + h / 2 + 9, 26, '#ffffff', 'center', '900');
}

function drawTitle() {
  drawBackground(distancePx);
  // Big friendly turkey on the right; the farmer peeks in from the left
  // in front of the panel so he is never hidden behind it.
  drawTurkey(950, GROUND_Y, 2.1, animTime * 2, false, true);
  ctx.fillStyle = 'rgba(43,26,18,0.45)';
  rr(90, 92, 700, 330, 18, 'rgba(43,26,18,0.45)');
  drawFarmer(118, GROUND_Y, 1.2, animTime * 3, false);
  textOutline('GOBBLE DASH', 120, 190, 84, '#ffd23c', 'left', '900');
  textOutline("Tilly's Great Escape", 124, 244, 40, '#ffffff', 'left', '800');
  text('Thanksgiving is coming. Farmer Bram is coming.', 124, 292, 22, '#f3e2c7', 'left', '600');
  text('Run 1200 m past the ovens and carving knives —', 124, 322, 22, '#f3e2c7', 'left', '600');
  text('and don\'t end up as dinner.', 124, 352, 22, '#f3e2c7', 'left', '600');
  text('SPACE / W / UP — jump    S / DOWN — duck', 124, 396, 20, '#e8c96a', 'left', '700');
  if (best > 0) text('BEST SCORE: ' + best, 124, 424, 20, '#ffffff', 'left', '800');
  drawButton(210, 452, 300, 62, '▶  START RUNNING', 'start');
  text('Click the button, or press ENTER / SPACE.', 210, 548, 18, '#f3e2c7', 'left', '600');
  text('A game by jpmax02 — original art, sound & code.', 640, 700, 15, 'rgba(243,226,199,0.85)', 'center', '600');
}

function drawEnd(escaped) {
  drawBackground(distancePx);
  // Scene: farmer frozen mid-lunge on the left, Tilly ahead.
  if (escaped) {
    drawTurkey(1112, GROUND_Y, 1.5, animTime * 2, false, false);
    drawFarmer(220, GROUND_Y, 1.4, 0.6, true);
    // Freedom gate.
    ctx.strokeStyle = '#7a4a26'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(1060, GROUND_Y - 190); ctx.lineTo(1060, GROUND_Y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1180, GROUND_Y - 190); ctx.lineTo(1180, GROUND_Y); ctx.stroke();
    ctx.fillStyle = '#7fae4c';
    ctx.fillRect(1052, GROUND_Y - 196, 136, 18);
  } else {
    drawFarmer(player.x - 40, GROUND_Y, 1.6, 0.6, true);
    drawTurkey(player.x + 60, GROUND_Y, 1.3, 0, false, false);
  }
  ctx.fillStyle = escaped ? 'rgba(30,70,30,0.35)' : 'rgba(60,20,14,0.55)';
  ctx.fillRect(0, 0, W, H);
  var panelY = 150;
  ctx.fillStyle = 'rgba(43,26,18,0.92)';
  rr(W / 2 - 380, panelY, 760, 380, 20, 'rgba(43,26,18,0.92)');
  ctx.strokeStyle = '#e8c96a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(W / 2 - 380, panelY, 760, 380, 20); ctx.stroke();
  if (escaped) {
    textOutline('YOU ESCAPED!', W / 2, panelY + 84, 62, '#7fae4c', 'center', '900');
    text('Tilly made it past Maplewood Farm —', W / 2, panelY + 140, 24, '#ffffff', 'center', '600');
    text('no Thanksgiving dinner this year!', W / 2, panelY + 172, 24, '#ffffff', 'center', '600');
  } else {
    textOutline('CAUGHT!', W / 2, panelY + 84, 62, '#d63a3a', 'center', '900');
    text('Farmer Bram caught Tilly at ' + Math.floor(distancePx / 50) + ' m.', W / 2, panelY + 140, 24, '#ffffff', 'center', '600');
    text('The oven was so close… run again!', W / 2, panelY + 172, 24, '#ffffff', 'center', '600');
  }
  text('SCORE  ' + score + '      DISTANCE  ' + Math.floor(distancePx / 50) + ' m      CORN  ' + corn, W / 2, panelY + 226, 24, '#ffd23c', 'center', '800');
  text('BEST SCORE  ' + best, W / 2, panelY + 262, 20, '#f3e2c7', 'center', '700');
  drawButton(W / 2 - 160, panelY + 288, 320, 60, '↻  RUN AGAIN  (R)', 'restart');
}

/* --- main render --- */
function render() {
  buttons = [];
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  if (state === 'title') {
    drawTitle();
  } else if (state === 'caught' || state === 'escaped') {
    drawEnd(state === 'escaped');
  } else {
    drawBackground(distancePx);
    // Pickups behind obstacles, obstacles behind characters.
    var i;
    for (i = 0; i < pickups.length; i++) {
      if (pickups[i].kind === 'corn') drawCorn(pickups[i]); else drawPumpkin(pickups[i]);
    }
    for (i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (ob.kind === 'oven') drawOven(ob);
      else if (ob.kind === 'knife') drawKnife(ob);
      else drawHay(ob);
    }
    // Farmer chases from behind; gap shrinks as danger rises.
    var farmerX = player.x - 96 - farmerGap;
    drawFarmer(farmerX, GROUND_Y, 1.35, animTime * 9, farmerGap < 88);
    // Tilly, blinking while invulnerable.
    if (!(player.invuln > 0 && Math.floor(animTime * 12) % 2 === 0)) {
      drawTurkey(player.x, player.y, 1.25, player.runPhase, player.duck, false);
    }
    // Particles on top.
    for (i = 0; i < particles.length; i++) {
      var pt = particles[i];
      var a = 1 - pt.life / pt.maxLife;
      ctx.globalAlpha = a;
      if (pt.kind === 'feather') {
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot || 0);
        ellipse(0, 0, pt.size, pt.size * 0.5, pt.color); ctx.restore();
      } else {
        circle(pt.x, pt.y, pt.size * a + 1, pt.color);
      }
      ctx.globalAlpha = 1;
    }
    drawHUD();
    if (state === 'paused') {
      ctx.fillStyle = 'rgba(43,26,18,0.6)';
      ctx.fillRect(0, 0, W, H);
      textOutline('PAUSED', W / 2, 340, 64, '#ffffff', 'center', '900');
      text('Press P to keep running', W / 2, 392, 24, '#f3e2c7', 'center', '600');
    }
  }
  ctx.restore();
}

/* --- static screenshot scenes: composed, deterministic frames --- */
function setupScene(name) {
  sceneMode = name;
  animTime = 3.2;
  if (name === 'title') {
    state = 'title'; distancePx = 0;
  } else if (name === 'play') {
    resetRun();
    state = 'play';
    distancePx = 50 * 342; speed = 380; score = 1840; corn = 6; lives = 3; farmerGap = 110;
    obstacles = [
      { kind: 'oven', x: 820, y: GROUND_Y, w: 96, h: 118, passed: false, bob: 0 },
      { kind: 'knife', x: 1080, y: GROUND_Y - 168, w: 120, h: 34, passed: false, bob: 1.5 }
    ];
    pickups = [
      { kind: 'corn', x: 520, y: GROUND_Y - 96, taken: false, bob: 0 },
      { kind: 'corn', x: 576, y: GROUND_Y - 96, taken: false, bob: 0.7 },
      { kind: 'corn', x: 632, y: GROUND_Y - 96, taken: false, bob: 1.4 }
    ];
    player.y = GROUND_Y - 30; player.onGround = false; player.runPhase = 2.1;
  } else if (name === 'chase') {
    resetRun();
    state = 'play';
    distancePx = 50 * 968; speed = 520; score = 5420; corn = 14; lives = 1; farmerGap = 40;
    warning = 1.6;
    obstacles = [
      { kind: 'knife', x: 620, y: GROUND_Y - 168, w: 120, h: 34, passed: false, bob: 0.4 },
      { kind: 'oven', x: 980, y: GROUND_Y, w: 96, h: 118, passed: false, bob: 0 }
    ];
    pickups = [{ kind: 'corn', x: 480, y: GROUND_Y - 96, taken: false, bob: 0.3 }];
    player.y = GROUND_Y; player.onGround = true; player.runPhase = 4.4;
    featherBurst(player.x - 30, player.y - 70);
    for (var i = 0; i < particles.length; i++) particles[i].life = 0.25;
  } else if (name === 'escaped') {
    resetRun();
    state = 'escaped';
    distancePx = 50 * 1200; score = 8930; corn = 21; lives = 2; farmerGap = 210;
    if (score > best) best = score;
  } else if (name === 'caught') {
    resetRun();
    state = 'caught';
    distancePx = 50 * 610; score = 3210; corn = 8; lives = 0; farmerGap = 40;
    if (score > best) best = score;
  }
  render();
}

/* --- fixed-step loop --- */
var last = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (sceneMode) return; // static screenshot frame stays put
  if (!last) last = ts;
  var dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  if (state === 'play') {
    acc += dt;
    var step = 1 / 60;
    while (acc >= step) { update(step); acc -= step; }
  } else {
    animTime += dt;
    for (var i = 0; i < leaves.length; i++) {
      var lf = leaves[i];
      lf.x -= lf.vx * dt; lf.y += lf.vy * dt; lf.rot += lf.vr * dt;
      if (lf.x < -20) { lf.x = W + 20; lf.y = 40 + rng() * 380; }
      if (lf.y > GROUND_Y - 8) lf.y = 40;
    }
    for (var j = 0; j < clouds.length; j++) {
      clouds[j].x -= clouds[j].v * dt;
      if (clouds[j].x < -160) { clouds[j].x = W + 120; clouds[j].y = 34 + rng() * 110; }
    }
  }
  render();
}

/* --- input: keyboard + mouse --- */
function startFromMenu() {
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  resetRun();
  sndGobble();
}
function doAction(action) {
  if (action === 'start' || action === 'restart') startFromMenu();
}
document.addEventListener('keydown', function (e) {
  var k = e.key;
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
    e.preventDefault();
    ensureAudio();
    if (state === 'title' || state === 'caught' || state === 'escaped') startFromMenu();
    else if (state === 'play') jump();
  } else if (k === 'Enter') {
    if (state === 'title' || state === 'caught' || state === 'escaped') startFromMenu();
  } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
    e.preventDefault();
    if (state === 'play' && player.onGround) player.duck = true;
  } else if (k === 'r' || k === 'R') {
    if (state === 'caught' || state === 'escaped') startFromMenu();
    else if (state === 'play') { resetRun(); }
  } else if (k === 'p' || k === 'P') {
    if (state === 'play') { stateBeforePause = 'play'; state = 'paused'; }
    else if (state === 'paused') { state = stateBeforePause; }
  } else if (k === 'm' || k === 'M') {
    muted = !muted;
  }
});
document.addEventListener('keyup', function (e) {
  var k = e.key;
  if (k === 'ArrowDown' || k === 's' || k === 'S') player.duck = false;
});
canvas.addEventListener('mousedown', function (e) {
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  var rect = canvas.getBoundingClientRect();
  var mx = (e.clientX - rect.left) * (W / rect.width);
  var my = (e.clientY - rect.top) * (H / rect.height);
  for (var i = 0; i < buttons.length; i++) {
    var b = buttons[i];
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
      doAction(b.action);
      return;
    }
  }
  if (state === 'title' || state === 'caught' || state === 'escaped') startFromMenu();
  else if (state === 'play') jump();
});

/* --- boot --- */
(function boot() {
  var q = new URLSearchParams(window.location.search);
  var scene = q.get('scene');
  if (scene === 'title' || scene === 'play' || scene === 'chase' || scene === 'escaped' || scene === 'caught') {
    setupScene(scene);
  } else {
    requestAnimationFrame(frame);
  }
  // Test hooks: the maker’s own checks read these, never the network.
  window.__gobbleDash = {
    getState: function () { return { state: state, score: score, lives: lives, distanceM: Math.floor(distancePx / 50), corn: corn, obstacles: obstacles.length, pickups: pickups.length, y: Math.round(player.y), duck: player.duck, farmerGap: Math.round(farmerGap) }; },
    start: startFromMenu,
    jump: jump,
    reset: resetRun
  };
})();
