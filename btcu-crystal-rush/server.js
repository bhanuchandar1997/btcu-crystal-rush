const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false } });
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'BTCU Crystal Rush' }));

const rooms = new Map();
const ARENA = { width: 1800, height: 1000 };
const MAX_PLAYERS = 8;
const MATCH_SECONDS = 60;
const TICK_MS = 50;
const CRYSTAL_COUNT = 18;
const COLORS = ['#72f1b8','#7cc7ff','#ff8fab','#ffd166','#b892ff','#5eead4','#fb923c','#e879f9'];

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function spawnPoint() {
  return {
    x: 130 + Math.random() * (ARENA.width - 260),
    y: 120 + Math.random() * (ARENA.height - 240)
  };
}

function randomCrystal(id) {
  const p = spawnPoint();
  return { id, x: p.x, y: p.y, value: Math.random() < 0.18 ? 3 : 1 };
}

function newRoom(hostId) {
  const code = makeRoomCode();
  const room = {
    code,
    hostId,
    status: 'lobby',
    startedAt: null,
    endsAt: null,
    players: new Map(),
    crystals: Array.from({ length: CRYSTAL_COUNT }, (_, i) => randomCrystal(i)),
    nextCrystalId: CRYSTAL_COUNT,
    winner: null
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, socket, name) {
  const p = spawnPoint();
  const cleanName = String(name || 'Player').trim().slice(0, 18) || 'Player';
  let display = cleanName;
  let n = 2;
  while ([...room.players.values()].some(x => x.name.toLowerCase() === display.toLowerCase())) {
    display = `${cleanName.slice(0, 14)} ${n++}`;
  }
  const player = {
    id: socket.id,
    name: display,
    color: COLORS[room.players.size % COLORS.length],
    x: p.x,
    y: p.y,
    score: 0,
    vx: 0,
    vy: 0,
    lastInput: { dx: 0, dy: 0 },
    lastSeen: Date.now()
  };
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = socket.id;
  return player;
}

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    winner: room.winner,
    arena: ARENA,
    players: [...room.players.values()].map(({ id, name, color, x, y, score }) => ({ id, name, color, x, y, score })),
    crystals: room.crystals
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function startRoom(room) {
  if (room.status !== 'lobby' || room.players.size < 2) return false;
  room.status = 'playing';
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + MATCH_SECONDS * 1000;
  room.winner = null;
  for (const p of room.players.values()) {
    p.score = 0;
    const s = spawnPoint();
    p.x = s.x; p.y = s.y;
  }
  broadcast(room);
  return true;
}

function finishRoom(room) {
  if (room.status !== 'playing') return;
  room.status = 'finished';
  const sorted = [...room.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  room.winner = sorted[0] ? { id: sorted[0].id, name: sorted[0].name, score: sorted[0].score } : null;
  broadcast(room);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    const room = newRoom(socket.id);
    const player = addPlayer(room, socket, name);
    socket.emit('roomJoined', { code: room.code, playerId: player.id, hostId: room.hostId });
    broadcast(room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('errorMessage', 'Room not found.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('errorMessage', 'Room is full.');
    if (room.status !== 'lobby') return socket.emit('errorMessage', 'That match has already started.');
    const player = addPlayer(room, socket, name);
    socket.emit('roomJoined', { code: room.code, playerId: player.id, hostId: room.hostId });
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (!startRoom(room)) socket.emit('errorMessage', 'At least 2 players are needed to start.');
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== 'finished' || room.hostId !== socket.id) return;
    room.status = 'lobby';
    room.startedAt = null;
    room.endsAt = null;
    room.winner = null;
    room.crystals = Array.from({ length: CRYSTAL_COUNT }, (_, i) => randomCrystal(i));
    for (const p of room.players.values()) p.score = 0;
    broadcast(room);
  });

  socket.on('input', input => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== 'playing') return;
    let dx = Number(input?.dx) || 0;
    let dy = Number(input?.dy) || 0;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    p.lastInput = { dx, dy };
    p.lastSeen = Date.now();
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    broadcast(room);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;

  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    if (room.endsAt && now >= room.endsAt) {
      finishRoom(room);
      continue;
    }

    for (const p of room.players.values()) {
      const speed = 360;
      p.x += p.lastInput.dx * speed * dt;
      p.y += p.lastInput.dy * speed * dt;
      p.x = Math.max(55, Math.min(ARENA.width - 55, p.x));
      p.y = Math.max(55, Math.min(ARENA.height - 55, p.y));

      for (let i = room.crystals.length - 1; i >= 0; i--) {
        const c = room.crystals[i];
        if (Math.hypot(p.x - c.x, p.y - c.y) < 55) {
          p.score += c.value;
          room.crystals.splice(i, 1);
          room.crystals.push(randomCrystal(room.nextCrystalId++));
        }
      }
    }
    broadcast(room);
  }
}, TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BTCU Crystal Rush running on port ${PORT}`);
});
