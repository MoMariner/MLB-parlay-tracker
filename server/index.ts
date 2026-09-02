import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { networkInterfaces } from 'node:os';

import { prisma } from './db.js';
import { playersRouter } from './routes/players.js';
import { gamesRouter } from './routes/games.js';
import { betsRouter } from './routes/bets.js';
import { parlaysRouter } from './routes/parlays.js';
import { settingsRouter } from './routes/settings.js';
import { loadSettings } from './services/settings.js';
import { attachSocket, syncPollers, stopAll } from './services/gamePollingManager.js';
import { authRequired, isAuthed, passwordMatches, requireAuth, setSessionCookie, clearSessionCookie } from './auth.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
const httpServer = createServer(app);
// Open CORS + a 0.0.0.0 bind so the dashboard opens on a TV or phone on the
// same LAN (spec §26 / local network access).
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// --- session endpoints (public, so the login box can talk to them) ---
app.get('/api/session', (req, res) => {
  res.json({ authRequired, authenticated: isAuthed(req) });
});

app.post('/api/login', (req, res) => {
  if (!authRequired) return res.json({ authenticated: true });
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  setSessionCookie(res);
  res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Everything past here needs a session when a password is configured.
app.use('/api', requireAuth);

app.use('/api/players', playersRouter);
app.use('/api/games', gamesRouter);
app.use('/api/bets', betsRouter);
app.use('/api/parlays', parlaysRouter);
app.use('/api/settings', settingsRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve the built client in production; in dev, Vite proxies to this server.
app.use(express.static('dist/client'));

// The live feed carries the same data as the API, so it needs the same gate.
io.use((socket, next) => {
  if (isAuthed({ headers: { cookie: socket.handshake.headers.cookie } })) return next();
  next(new Error('unauthorized'));
});

attachSocket(io);

io.on('connection', (socket) => {
  console.log(`[socket] client connected (${io.engine.clientsCount} total)`);
  socket.on('disconnect', () => console.log('[socket] client disconnected'));
});

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

async function main() {
  await loadSettings();
  await syncPollers();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  MLB Live Bet Tracker on http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${PORT}`);
    console.log(authRequired
      ? '  Password protection: ON'
      : '  Password protection: OFF (set APP_PASSWORD to enable)');
    console.log('');
  });
}

let shuttingDown = false;

/**
 * Exit promptly on a restart.
 *
 * `httpServer.close()` only fires once every connection has drained, and
 * Socket.IO clients hold theirs open indefinitely -- so on its own it hangs
 * forever and `tsx watch` force-kills the process without starting the next
 * one, leaving the API down after an ordinary file save. Drop the sockets
 * first, and keep a hard deadline as a backstop.
 */
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  stopAll();
  io.close();                       // disconnects websocket clients
  httpServer.closeAllConnections?.(); // and any keep-alive HTTP sockets
  httpServer.close();

  try {
    await prisma.$disconnect();
  } catch {
    // exiting anyway
  }

  process.exit(0);
}

// A hang here is invisible in dev, so fail loudly rather than silently.
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
