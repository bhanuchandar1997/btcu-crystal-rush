const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false } });
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'BTCU Crystal Clash', version: 3 }));

const rooms = new Map();
const ARENA = { width: 2800, height: 1800 };
const MAX_PLAYERS = 8;
const MATCH_SECONDS = 90;
const START_COUNTDOWN_MS = 3000;
const TICK_MS = 50;
const STATE_MS = 67;
const PLAYER_RADIUS = 25;
const BASE_SPEED = 300;
const BOOST_SPEED = 440;
const DASH_SPEED = 960;
const DASH_MS = 200;
const DASH_CD = 2200;
const SHOT_SPEED = 900;
const SHOT_CD = 500;
const RAPID_SHOT_CD = 240;
const BULLET_RADIUS = 8;
const BULLET_LIFE = 1100;
const MAX_BULLETS = 90;
const SHIELD_MS = 4500;
const BOOST_MS = 5500;
const RAPID_MS = 6500;
const CRYSTAL_COUNT = 24;
const POWERUP_MAX = 4;
const COLORS = ['#5eead4','#67e8f9','#f9a8d4','#fde68a','#c4b5fd','#86efac','#fdba74','#fda4af'];

const OBSTACLES = [
  { x: 280, y: 250, w: 520, h: 90 },
  { x: 1020, y: 180, w: 90, h: 480 },
  { x: 1310, y: 360, w: 620, h: 90 },
  { x: 2150, y: 230, w: 90, h: 420 },
  { x: 300, y: 1110, w: 90, h: 420 },
  { x: 650, y: 1360, w: 600, h: 90 },
  { x: 1510, y: 1000, w: 90, h: 500 },
  { x: 1840, y: 1260, w: 600, h: 90 },
  { x: 1140, y: 760, w: 520, h: 80 },
  { x: 1800, y: 560, w: 90, h: 260 },
  { x: 830, y: 720, w: 90, h: 290 }
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(code));
  return code;
}
function intersectsObstacle(x, y, r = 0) {
  return OBSTACLES.some(o => x + r > o.x && x - r < o.x + o.w && y + r > o.y && y - r < o.y + o.h);
}
function spawnPoint() {
  for (let i = 0; i < 250; i++) {
    const p = { x: 100 + Math.random() * (ARENA.width - 200), y: 100 + Math.random() * (ARENA.height - 200) };
    if (!intersectsObstacle(p.x, p.y, PLAYER_RADIUS + 35)) return p;
  }
  return { x: 140, y: 140 };
}
function spawnCrystal(id) {
  const p = spawnPoint();
  const roll = Math.random();
  return { id, x: p.x, y: p.y, value: roll < 0.08 ? 5 : roll < 0.30 ? 3 : 1, rare: roll < 0.08 };
}
function spawnPowerup(id) {
  const p = spawnPoint();
  const roll = Math.random();
  const type = roll < 0.34 ? 'boost' : roll < 0.68 ? 'shield' : 'rapid';
  return { id, x: p.x, y: p.y, type };
}
function roomSnapshot(room, now = Date.now()) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    winner: room.winner,
    arena: ARENA,
    obstacles: OBSTACLES,
    storm: { cx: room.storm.cx, cy: room.storm.cy, radius: stormRadius(room, now) },
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, x: p.x, y: p.y,
      score: p.score, hp: p.hp, maxHp: p.maxHp,
      combo: p.combo, shield: Math.max(0, p.shieldUntil - now),
      boost: Math.max(0, p.boostUntil - now), rapid: Math.max(0, p.rapidUntil - now),
      dash: Math.max(0, p.dashCdUntil - now), shot: Math.max(0, p.shotCdUntil - now),
      stunned: Math.max(0, p.stunnedUntil - now), invuln: Math.max(0, p.invulnUntil - now)
    })),
    crystals: room.crystals,
    powerups: room.powerups,
    bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, color: b.color }))
  };
}
function broadcast(room, now = Date.now()) { io.to(room.code).emit('state', roomSnapshot(room, now)); }
function stormRadius(room, now) {
  if (!room.startsAt) return 880;
  const elapsed = clamp((now - room.startsAt) / 1000, 0, MATCH_SECONDS);
  if (elapsed < 18) return 880;
  return 880 - 470 * clamp((elapsed - 18) / (MATCH_SECONDS - 18), 0, 1);
}
function circleHitsRect(cx, cy, r, rect) {
  const px = clamp(cx, rect.x, rect.x + rect.w);
  const py = clamp(cy, rect.y, rect.y + rect.h);
  return Math.hypot(cx - px, cy - py) <= r;
}
function bulletHitsObstacle(b) {
  return OBSTACLES.some(o => circleHitsRect(b.x, b.y, BULLET_RADIUS, o));
}
function movePlayer(p, now, dt) {
  if (now < p.stunnedUntil) return;
  let dx = p.input.dx, dy = p.input.dy;
  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }
  const speed = now < p.dashUntil ? DASH_SPEED : now < p.boostUntil ? BOOST_SPEED : BASE_SPEED;
  const nx = clamp(p.x + dx * speed * dt, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
  const ny = clamp(p.y + dy * speed * dt, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);
  if (!intersectsObstacle(nx, p.y, PLAYER_RADIUS)) p.x = nx;
  if (!intersectsObstacle(p.x, ny, PLAYER_RADIUS)) p.y = ny;
}
function addPlayer(room, socket, name) {
  const clean = String(name || 'Player').trim().slice(0, 18) || 'Player';
  let display = clean, n = 2;
  while ([...room.players.values()].some(p => p.name.toLowerCase() === display.toLowerCase())) display = `${clean.slice(0, 14)} ${n++}`;
  const s = spawnPoint();
  const player = {
    id: socket.id, name: display, color: COLORS[room.players.size % COLORS.length],
    x: s.x, y: s.y, score: 0, hp: 100, maxHp: 100,
    combo: 0, comboUntil: 0, shieldUntil: 0, boostUntil: 0, rapidUntil: 0,
    stunnedUntil: 0, invulnUntil: 0, dashUntil: 0, dashCdUntil: 0, shotCdUntil: 0,
    input: { dx: 0, dy: 0, aimX: 1, aimY: 0 }, lastDash: false, lastShot: false,
    lastStormTick: Date.now()
  };
  room.players.set(socket.id, player);
  socket.join(room.code); socket.data.roomCode = room.code;
  return player;
}
function resetPlayer(p) {
  const s = spawnPoint();
  Object.assign(p, { x: s.x, y: s.y, hp: 100, combo: 0, comboUntil: 0, shieldUntil: 0, boostUntil: 0, rapidUntil: 0, stunnedUntil: Date.now() + 900, invulnUntil: Date.now() + 1400, dashUntil: 0, dashCdUntil: 0, shotCdUntil: 0, lastStormTick: Date.now() });
}
function newRoom(hostId) {
  const code = makeRoomCode();
  const room = {
    code, hostId, status: 'lobby', startsAt: null, endsAt: null, winner: null,
    nextCrystalId: CRYSTAL_COUNT, nextPowerupId: 1, nextBulletId: 1,
    nextPowerupAt: Date.now() + 5000,
    storm: { cx: ARENA.width / 2, cy: ARENA.height / 2 },
    players: new Map(),
    crystals: Array.from({ length: CRYSTAL_COUNT }, (_, i) => spawnCrystal(i)),
    powerups: [], bullets: []
  };
  rooms.set(code, room);
  return room;
}
function startRoom(room) {
  if (room.status !== 'lobby' || room.players.size < 2) return false;
  const now = Date.now();
  room.status = 'playing'; room.startsAt = now + START_COUNTDOWN_MS; room.endsAt = now + START_COUNTDOWN_MS + MATCH_SECONDS * 1000; room.winner = null;
  room.crystals = Array.from({ length: CRYSTAL_COUNT }, (_, i) => spawnCrystal(i)); room.powerups = []; room.bullets = []; room.nextPowerupAt = room.startsAt + 4500;
  for (const p of room.players.values()) { p.score = 0; resetPlayer(p); p.stunnedUntil = 0; }
  broadcast(room, now); return true;
}
function finishRoom(room) {
  if (room.status !== 'playing') return;
  room.status = 'finished';
  const sorted = [...room.players.values()].sort((a, b) => b.score - a.score || b.combo - a.combo || a.name.localeCompare(b.name));
  room.winner = sorted[0] ? { id: sorted[0].id, name: sorted[0].name, score: sorted[0].score } : null;
  broadcast(room);
}
function collectCrystals(room, p, now) {
  for (let i = room.crystals.length - 1; i >= 0; i--) {
    const c = room.crystals[i];
    if (Math.hypot(p.x - c.x, p.y - c.y) < PLAYER_RADIUS + 20) {
      p.combo = now < p.comboUntil ? Math.min(5, p.combo + 1) : 1;
      p.comboUntil = now + 1800;
      p.score += Math.round(c.value * (1 + Math.max(0, p.combo - 1) * 0.25));
      room.crystals.splice(i, 1); room.crystals.push(spawnCrystal(room.nextCrystalId++));
      return;
    }
  }
}
function collectPowerups(room, p, now) {
  for (let i = room.powerups.length - 1; i >= 0; i--) {
    const q = room.powerups[i];
    if (Math.hypot(p.x - q.x, p.y - q.y) < 44) {
      if (q.type === 'boost') p.boostUntil = now + BOOST_MS;
      if (q.type === 'shield') p.shieldUntil = now + SHIELD_MS;
      if (q.type === 'rapid') p.rapidUntil = now + RAPID_MS;
      room.powerups.splice(i, 1); return;
    }
  }
}
function fireBullet(room, p, now) {
  if (now < p.shotCdUntil || now < p.stunnedUntil || room.bullets.length >= MAX_BULLETS) return;
  const ax = p.input.aimX || p.input.dx || 1, ay = p.input.aimY || p.input.dy || 0;
  const len = Math.hypot(ax, ay) || 1;
  const vx = ax / len * SHOT_SPEED, vy = ay / len * SHOT_SPEED;
  room.bullets.push({ id: room.nextBulletId++, ownerId: p.id, x: p.x + ax / len * 30, y: p.y + ay / len * 30, vx, vy, color: p.color, createdAt: now, life: BULLET_LIFE });
  p.shotCdUntil = now + (now < p.rapidUntil ? 240 : SHOT_CD);
}
function hitPlayer(room, victim, attacker, now) {
  if (victim.id === attacker.id || now < victim.invulnUntil) return;
  if (victim.shieldUntil > now) { victim.shieldUntil = Math.max(now, victim.shieldUntil - 700); return; }
  victim.hp -= 28; victim.stunnedUntil = now + 220;
  attacker.score += 1;
  if (victim.hp <= 0) {
    attacker.score += Math.min(4, victim.score);
    victim.score = Math.max(0, victim.score - 2);
    victim.combo = 0; resetPlayer(victim);
  }
}
function updateBullets(room, now, dt) {
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt * 1000;
    let remove = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > ARENA.width || b.y > ARENA.height || bulletHitsObstacle(b);
    if (!remove) {
      const attacker = room.players.get(b.ownerId);
      for (const victim of room.players.values()) {
        if (!attacker) { remove = true; break; }
        if (victim.id !== attacker.id && Math.hypot(victim.x - b.x, victim.y - b.y) < PLAYER_RADIUS + BULLET_RADIUS) {
          hitPlayer(room, victim, attacker, now); remove = true; break;
        }
      }
    }
    if (remove) room.bullets.splice(i, 1);
  }
}
function applyStorm(room, p, now) {
  const d = Math.hypot(p.x - room.storm.cx, p.y - room.storm.cy), r = stormRadius(room, now);
  if (d > r && now - p.lastStormTick >= 1000) { p.hp -= 12; p.lastStormTick = now; }
  if (d <= r) p.lastStormTick = now;
  if (p.hp <= 0) { p.score = Math.max(0, p.score - 2); resetPlayer(p); }
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    const room = newRoom(socket.id); const player = addPlayer(room, socket, name);
    socket.emit('roomJoined', { code: room.code, playerId: player.id }); broadcast(room);
  });
  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return socket.emit('errorMessage', 'Room not found.');
    if (room.status !== 'lobby') return socket.emit('errorMessage', 'This battle has already started.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('errorMessage', 'Room is full.');
    const player = addPlayer(room, socket, name); socket.emit('roomJoined', { code: room.code, playerId: player.id }); broadcast(room);
  });
  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.hostId !== socket.id) return;
    if (!startRoom(room)) socket.emit('errorMessage', 'At least 2 players are needed to start.');
  });
  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'finished' || room.hostId !== socket.id) return;
    room.status = 'lobby'; room.startsAt = null; room.endsAt = null; room.winner = null; room.bullets = []; room.powerups = []; room.crystals = Array.from({ length: CRYSTAL_COUNT }, (_, i) => spawnCrystal(i));
    for (const p of room.players.values()) resetPlayer(p); broadcast(room);
  });
  socket.on('input', payload => {
    const room = rooms.get(socket.data.roomCode); const p = room?.players.get(socket.id); if (!p) return;
    p.input.dx = clamp(Number(payload?.dx) || 0, -1, 1); p.input.dy = clamp(Number(payload?.dy) || 0, -1, 1);
    const ax = clamp(Number(payload?.aimX), -1, 1), ay = clamp(Number(payload?.aimY), -1, 1);
    if (Number.isFinite(ax) && Number.isFinite(ay) && (Math.abs(ax) + Math.abs(ay) > 0.05)) { p.input.aimX = ax; p.input.aimY = ay; }
    const now = Date.now();
    const dash = Boolean(payload?.dash), shoot = Boolean(payload?.shoot);
    if (room.status === 'playing' && now >= room.startsAt) {
      if (dash && !p.lastDash && now >= p.dashCdUntil && now >= p.stunnedUntil) { p.dashUntil = now + DASH_MS; p.dashCdUntil = now + DASH_CD; }
      if (shoot) fireBullet(room, p, now);
    }
    p.lastDash = dash; p.lastShot = shoot;
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    room.players.delete(socket.id); if (room.players.size === 0) return rooms.delete(room.code);
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    broadcast(room);
  });
});

let lastTick = Date.now(), lastState = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    if (now < room.startsAt) { if (now - lastState >= STATE_MS) { broadcast(room, now); lastState = now; } continue; }
    if (now >= room.endsAt) { finishRoom(room); continue; }
    if (now >= room.nextPowerupAt && room.powerups.length < POWERUP_MAX) { room.powerups.push(spawnPowerup(room.nextPowerupId++)); room.nextPowerupAt = now + 7000 + Math.random() * 5000; }
    updateBullets(room, now, dt);
    for (const p of room.players.values()) {
      movePlayer(p, now, dt); collectCrystals(room, p, now); collectPowerups(room, p, now); applyStorm(room, p, now);
      if (p.comboUntil < now) p.combo = 0;
    }
    if (now - lastState >= STATE_MS) { broadcast(room, now); lastState = now; }
  }
}, TICK_MS);

server.listen(PORT, '0.0.0.0', () => console.log(`BTCU Crystal Clash v3 listening on ${PORT}`));
