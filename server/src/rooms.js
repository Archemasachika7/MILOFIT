/**
 * Rooms: sockets, the fixed-timestep pump, snapshot/event fan-out and lifecycle.
 *
 * One Room == one Match + the sockets watching it. The manager drives every room
 * from a single 60 Hz interval so a busy server does not create dozens of timers.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { Match } from './sim.js';
import { tuning as T, mapById, modeById, maps, modes, contentSummary } from './gameData.js';
import { S2C, C2S, encode, sanitizeName } from './protocol.js';

const EMPTY_ROOM_TTL_MS = 15000;
const MAX_ROOMS = 200;
const SNAPSHOT_PERIOD = 1 / T.snapshotRate;
const FIXED_DT = 1 / T.tickRate;

function newClientId() {
  return randomUUID().slice(0, 8);
}

export class Client {
  constructor(socket, { address = 'unknown' } = {}) {
    this.id = newClientId();
    this.socket = socket;
    this.address = address;
    this.name = 'Recruit';
    this.character = 'recruit';
    this.roomId = null;
    this.joined = false;
    this.ping = 0;
    this.alive = true;
    this.budget = 240; // simple token bucket, refilled per second
    this.lastChatAt = 0;
  }

  send(message) {
    if (this.socket.readyState !== 1) return false;
    try {
      this.socket.send(encode(message));
      return true;
    } catch {
      return false;
    }
  }

  /** Returns false when the caller should drop the connection. */
  spendTokens() {
    this.budget -= 1;
    if (this.budget < 0) return false;
    return true;
  }

  refill() {
    this.budget = Math.min(240, this.budget + 240 * (1 / T.tickRate));
  }
}

export class Room {
  constructor(id, manager, {
    mapId = 'arena_core',
    modeId = 'tdm',
    format,
    roleMode,
    gravityMode = 'normal',
  } = {}) {
    this.id = id;
    this.manager = manager;
    const initialFormat = format ?? '1v1';
    const initialRoleMode = roleMode ?? (initialFormat === '4v4' ? 'free' : 'roles');
    const initialMode = initialFormat === '4v4' && initialRoleMode === 'free' ? 'tdm' : (modeId ?? 'tdm');
    this.match = new Match({
      mapId: mapId ?? 'arena_core',
      modeId: initialMode,
      format: initialFormat,
      roleMode: initialRoleMode,
      gravityMode: gravityMode ?? 'normal',
      allowSolo: id.startsWith('solo-'),
      seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0,
    });
    this.match.id = id;
    this.clients = new Map();
    this.hostId = null;
    this.acc = 0;
    this.snapAcc = 0;
    this.lastRosterKey = '';
    this.emptySince = null;
    this.log = [];
  }

  // ---------------------------------------------------------------- membership

  join(client, options = {}) {
    client.roomId = this.id;
    client.name = sanitizeName(options.name ?? client.name);
    client.character = options.character ?? client.character;
    client.role = options.role ?? 'raider';
    client.joined = true;

    if (!this.hostId) this.hostId = client.id;
    this.clients.set(client.id, client);

    const player = this.match.addPlayer(client.id, {
      name: client.name,
      character: client.character,
      role: client.role,
      team: options.team ?? 'auto',
    });
    client.role = player.roleId;

    client.send({
      t: S2C.WELCOME,
      you: {
        id: client.id,
        name: client.name,
        character: client.character,
        role: client.role,
        room: this.id,
        host: this.hostId === client.id,
      },
      room: this.settings(),
      roster: this.match.roster(),
      // The same content summary the pre-join greeting carries, so a client that
      // joins straight away still learns which modes exist and which carry flags.
      ...contentSummary(),
      serverTime: Date.now(),
    });

    this.pushLog(`${client.name} joined`);
    this.broadcastRoster(true);
    return player;
  }

  leave(client, { quiet = false } = {}) {
    if (!this.clients.has(client.id)) return;
    const player = this.match.players.get(client.id);
    this.clients.delete(client.id);
    this.match.removePlayer(client.id);
    if (this.hostId === client.id) {
      this.hostId = this.clients.size ? [...this.clients.keys()][0] : null;
      this.broadcast({ t: S2C.WELCOME, you: null, host: this.hostId, reassigned: true });
    }
    if (!quiet) this.pushLog(`${client.name} left`);
    this.broadcastRoster(true);
    if (!this.clients.size) this.emptySince = Date.now();
  }

  settings() {
    return {
      id: this.id,
      mapId: this.match.mapId,
      modeId: this.match.mode.id,
      format: this.match.format,
      roleMode: this.match.roleMode,
      gravityMode: this.match.gravityMode,
      state: this.match.state,
      host: this.hostId,
      map: { id: this.match.map.id, name: this.match.map.name, size: this.match.map.size },
      mode: this.match.mode,
      maxPlayers: this.maxPlayers(),
      scoreLimit: this.match.scoreGoal(),
      timeLimitSeconds: T.match.timeLimitSeconds,
    };
  }

  maxPlayers() {
    return T.matchFormats?.[this.match.format]?.maxPlayers ?? T.limits.maxPlayersPerRoom;
  }

  isHost(clientId) {
    return this.hostId === clientId;
  }

  setSettings(client, { mapId, modeId, format, roleMode, gravityMode }) {
    if (!this.isHost(client.id)) return false;
    let changed = false;
    if (format && T.matchFormats?.[format] && format !== this.match.format) {
      const nextMax = T.matchFormats[format].maxPlayers;
      if (this.clients.size > nextMax) return false;
      changed = this.match.setFormat(format) || changed;
    }
    if (roleMode) changed = this.match.setRoleMode(roleMode) || changed;
    if (gravityMode) changed = this.match.setGravityMode(gravityMode) || changed;
    const effectiveModeId = this.match.format === '4v4' && this.match.roleMode === 'free'
      ? 'tdm'
      : modeId;
    if (effectiveModeId && modeById.has(effectiveModeId) && effectiveModeId !== this.match.modeId) {
      this.match.setMode(effectiveModeId);
      changed = true;
    }
    if (mapId && mapById.has(mapId) && mapId !== this.match.mapId) {
      this.match.setMap(mapId);
      changed = true;
    }
    if (changed) {
      this.pushLog(`${client.name} changed room settings`);
      this.broadcast({ t: S2C.ROOM, room: this.settings() });
      this.broadcastRoster(true);
    }
    return changed;
  }

  start(client) {
    if (!this.isHost(client.id)) return false;
    const ok = this.match.requestStart(client.id);
    if (ok) this.pushLog(`${client.name} started the match`);
    return ok;
  }

  applyInput(client, input) {
    this.match.setInput(client.id, input);
  }

  chat(client, text) {
    const now = Date.now();
    if (now - client.lastChatAt < T.limits.chatCooldownSeconds * 1000) return;
    client.lastChatAt = now;
    const player = this.match.players.get(client.id);
    this.broadcast({
      t: S2C.CHAT,
      from: client.id,
      name: client.name,
      team: player ? player.team : 'ffa',
      text,
      at: now,
    });
  }

  pushLog(text) {
    this.log.push({ text, at: Date.now() });
    if (this.log.length > 40) this.log.shift();
    this.broadcast({ t: S2C.CHAT, from: 'system', name: 'system', team: 'system', text, at: Date.now() });
  }

  // ------------------------------------------------------------------- pump

  pump(delta) {
    // Cap the catch-up work so a stalled process cannot spiral.
    this.acc = Math.min(this.acc + delta, 0.5);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 8) {
      this.match.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps += 1;
    }
    if (steps === 0) return;

    for (const client of this.clients.values()) client.refill();

    this.flushEvents();

    this.snapAcc += delta;
    if (this.snapAcc >= SNAPSHOT_PERIOD) {
      this.snapAcc %= SNAPSHOT_PERIOD;
      this.broadcastSnapshot();
    }

    this.broadcastRoster(false);
  }

  broadcastSnapshot() {
    if (!this.clients.size) return;
    const snap = this.match.snapshot();
    snap.t = S2C.STATE;
    const payload = encode(snap);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === 1) client.socket.send(payload);
    }
  }

  flushEvents() {
    const events = this.match.drainEvents();
    if (!events) return;
    const shared = [];
    const targeted = new Map();
    for (const ev of events) {
      if (ev.to) {
        let list = targeted.get(ev.to);
        if (!list) { list = []; targeted.set(ev.to, list); }
        list.push(ev);
      } else {
        shared.push(ev);
      }
    }
    if (shared.length) this.broadcast({ t: S2C.EVENTS, events: shared });
    for (const [playerId, list] of targeted) {
      const client = this.clients.get(playerId);
      if (client) client.send({ t: S2C.EVENTS, events: list });
    }
  }

  rosterKey() {
    const ids = [...this.clients.keys()].sort();
    return `${this.match.state}|${this.hostId}|${ids.map((id) => {
      const c = this.clients.get(id);
      const p = this.match.players.get(id);
      return `${id}:${c.name}:${p ? p.team : '-'}:${p ? p.character : '-'}`;
    }).join(',')}`;
  }

  broadcastRoster(force) {
    const key = this.rosterKey();
    if (!force && key === this.lastRosterKey) return;
    this.lastRosterKey = key;
    this.broadcast({ t: S2C.ROSTER, roster: this.match.roster(), host: this.hostId, room: this.settings() });
  }

  broadcast(message) {
    const payload = encode(message);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === 1) {
        try {
          client.socket.send(payload);
        } catch {
          /* socket died; the close handler will clean up */
        }
      }
    }
  }

  get expired() {
    if (this.clients.size) return false;
    return this.emptySince !== null && Date.now() - this.emptySince > EMPTY_ROOM_TTL_MS;
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.seq = 1;
    this.timer = null;
    this.last = 0;
  }

  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / T.tickRate);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  pump() {
    const now = performance.now();
    let delta = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(delta) || delta <= 0) return;
    if (delta > 0.5) delta = 0.5;
    for (const room of this.rooms.values()) room.pump(delta);
    for (const [id, room] of this.rooms) {
      if (room.expired) {
        this.rooms.delete(id);
        this.onRoomClosed?.(room);
      }
    }
  }

  normalizeRoomId(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    return cleaned.length >= 1 ? cleaned : null;
  }

  newRoomCode() {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = Array.from({ length: T.limits.roomCodeLength ?? 6 }, () =>
        alphabet[randomInt(0, alphabet.length)]).join('').toLowerCase();
    } while (this.rooms.has(code));
    return code;
  }

  getOrCreate(rawId, options = {}) {
    const id = this.normalizeRoomId(rawId) ?? this.newRoomCode();
    let room = this.rooms.get(id);
    if (room) return room;
    if (this.rooms.size >= MAX_ROOMS) {
      // Fall back to the emptiest room rather than refusing service.
      let best = null;
      for (const r of this.rooms.values()) {
        if (!best || r.clients.size < best.clients.size) best = r;
      }
      if (best) return best;
    }
    room = new Room(id, this, options);
    this.rooms.set(id, room);
    return room;
  }

  stats() {
    let players = 0;
    for (const room of this.rooms.values()) players += room.clients.size;
    return { rooms: this.rooms.size, players, maps: maps.length, modes: modes.length };
  }
}
