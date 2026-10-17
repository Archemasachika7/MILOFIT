#!/usr/bin/env node
/**
 * MILOFIT Arena — game server.
 *
 * One process does two jobs:
 *   1. serves the static web client (web/) and the shared content (shared/)
 *   2. runs the authoritative matches and speaks the WebSocket protocol (/ws)
 *
 * Usage:  node src/index.js [--port 8080] [--host 0.0.0.0]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { publicContent, contentSummary, WEB_DIR, SHARED_DIR, manifest } from './gameData.js';
import { RoomManager, Client } from './rooms.js';
import {
  S2C,
  C2S,
  decode,
  sanitizeMessage,
  sanitizeCharacter,
  sanitizeTeam,
  sanitizeMapId,
  sanitizeModeId,
  sanitizeMatchFormat,
  sanitizeRoleMode,
  sanitizeGravityMode,
  sanitizeRoleId,
  normalizeInput,
} from './protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ arguments

function parseArgs(argv) {
  const out = { port: 8080, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]) || out.port;
    else if (a === '--host' || a === '-h') out.host = argv[++i] || out.host;
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7)) || out.port;
    else if (a.startsWith('--host=')) out.host = a.slice(7) || out.host;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// --------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(res, absPath, { cache = 'no-cache' } = {}) {
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

/** Resolve a URL path inside a base directory, refusing traversal. */
function safeJoin(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const abs = path.resolve(baseDir, normalized);
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (abs !== baseDir && !abs.startsWith(baseWithSep)) return null;
  return abs;
}

const contentCache = JSON.stringify(publicContent());

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...rooms.stats(), protocolVersion: manifest.game.protocolVersion }));
    return;
  }

  if (url === '/api/content') {
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-cache' });
    res.end(contentCache);
    return;
  }

  if (url.startsWith('/shared/')) {
    const abs = safeJoin(SHARED_DIR, url.slice('/shared/'.length));
    if (!abs) { res.writeHead(403); res.end('403'); return; }
    serveFile(res, abs, { cache: 'public, max-age=60' });
    return;
  }

  if (url === '/' || url.startsWith('/?')) {
    serveFile(res, path.join(WEB_DIR, 'index.html'));
    return;
  }

  const abs = safeJoin(WEB_DIR, url);
  if (!abs) { res.writeHead(403); res.end('403'); return; }
  fs.stat(abs, (err, stat) => {
    if (!err && stat.isDirectory()) {
      serveFile(res, path.join(abs, 'index.html'));
      return;
    }
    if (err) {
      serveFile(res, path.join(WEB_DIR, 'index.html'));
      return;
    }
    serveFile(res, abs);
  });
});

// --------------------------------------------------------------- websocket API

const rooms = new RoomManager();
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

function roomSummaries() {
  const out = [];
  for (const room of rooms.rooms.values()) {
    out.push({
      id: room.id,
      players: room.clients.size,
      max: room.maxPlayers(),
      mapId: room.match.mapId,
      modeId: room.match.mode.id,
      state: room.match.state,
    });
  }
  out.sort((a, b) => b.players - a.players);
  return out;
}

function baseWelcome() {
  return {
    t: S2C.WELCOME,
    ...contentSummary(),
    rooms: roomSummaries(),
    serverTime: Date.now(),
  };
}

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (socket, req) => {
  const client = new Client(socket, { address: req.socket.remoteAddress ?? 'unknown' });
  socket.isAlive = true;
  client.send(baseWelcome());

  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('error', () => { /* close handler cleans up */ });

  socket.on('message', (raw) => {
    try {
      handleMessage(client, raw);
    } catch (err) {
      console.error(`[${client.id}] handler error:`, err);
      client.send({ t: S2C.ERROR, code: 'server_error', message: 'internal error' });
    }
  });

  socket.on('close', () => {
    const room = client.roomId ? rooms.rooms.get(client.roomId) : null;
    if (room) room.leave(client);
  });
});

function activeRoom(client) {
  return client.roomId ? rooms.rooms.get(client.roomId) ?? null : null;
}

function fail(client, code, message) {
  client.send({ t: S2C.ERROR, code, message });
}

function handleMessage(client, raw) {
  if (!client.spendTokens()) {
    fail(client, 'rate_limited', 'sending too fast');
    return;
  }

  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const msg = decode(text);
  if (!msg) {
    fail(client, 'bad_message', 'expected a JSON object with a "t" field');
    return;
  }

  switch (msg.t) {
    case C2S.HELLO: {
      client.send(baseWelcome());
      return;
    }

    case C2S.JOIN: {
      const previous = activeRoom(client);
      if (previous) previous.leave(client, { quiet: true });

      const character = sanitizeCharacter(msg.character) ?? client.character;
      const roomOptions = {
        mapId: sanitizeMapId(msg.map),
        modeId: sanitizeModeId(msg.mode),
        format: sanitizeMatchFormat(msg.format),
        roleMode: sanitizeRoleMode(msg.roleMode),
        gravityMode: sanitizeGravityMode(msg.gravityMode),
      };
      const room = rooms.getOrCreate(msg.room, roomOptions);
      if (room.clients.size >= room.maxPlayers()) {
        fail(client, 'room_full', `room "${room.id}" is full`);
        return;
      }
      client.character = character;
      room.join(client, {
        name: msg.name,
        character,
        role: sanitizeRoleId(msg.role),
        team: sanitizeTeam(msg.team),
      });
      console.log(`[${client.id}] joined "${room.id}" as ${client.name} (${character})`);
      return;
    }

    case C2S.INPUT: {
      const room = activeRoom(client);
      if (!room) return;
      room.applyInput(client, normalizeInput(msg));
      return;
    }

    case C2S.CHAT: {
      const room = activeRoom(client);
      if (!room) return;
      const text = sanitizeMessage(msg.text);
      if (text) room.chat(client, text);
      return;
    }

    case C2S.TEAM: {
      const room = activeRoom(client);
      if (!room) return;
      if (room.match.setTeam(client.id, sanitizeTeam(msg.team))) room.broadcastRoster(true);
      return;
    }

    case C2S.SETTINGS: {
      const room = activeRoom(client);
      if (!room) return;
      room.setSettings(client, {
        mapId: sanitizeMapId(msg.map),
        modeId: sanitizeModeId(msg.mode),
        format: sanitizeMatchFormat(msg.format),
        roleMode: sanitizeRoleMode(msg.roleMode),
        gravityMode: sanitizeGravityMode(msg.gravityMode),
      });
      return;
    }

    case C2S.START: {
      const room = activeRoom(client);
      if (!room) return;
      if (!room.isHost(client.id)) {
        fail(client, 'not_host', 'only the host can start');
      } else if (room.match.players.size < room.match.minPlayers()) {
        fail(client, 'not_enough_players', `this room needs at least ${room.match.minPlayers()} players to start`);
      } else {
        room.start(client);
      }
      return;
    }

    case C2S.PING: {
      client.send({ t: S2C.PONG, ts: msg.ts ?? null, serverTime: Date.now() });
      return;
    }

    default:
      fail(client, 'unknown_type', `unsupported message type "${msg.t}"`);
  }
}

// Heartbeat: drop sockets that stopped answering so rooms do not leak slots.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try { socket.ping(); } catch { /* ignore */ }
  }
}, 15000);
if (heartbeat.unref) heartbeat.unref();

// ------------------------------------------------------------------- bootstrap

function lanAddresses() {
  const found = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) found.push(iface.address);
    }
  }
  return found;
}

rooms.start();

server.listen(args.port, args.host, () => {
  const { port } = server.address();
  const banner = [
    '',
    `  ${manifest.game.title} — server online`,
    `  web client   http://localhost:${port}/`,
    ...lanAddresses().map((ip) => `  lan / phone  http://${ip}:${port}/   (ws://${ip}:${port}/ws)`),
    `  websocket    ws://localhost:${port}/ws`,
    `  content api  http://localhost:${port}/api/content`,
    `  protocol     v${manifest.game.protocolVersion}`,
    '',
  ];
  console.log(banner.join('\n'));
});

function shutdown(signal) {
  console.log(`\n[${signal}] shutting down`);
  clearInterval(heartbeat);
  rooms.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
