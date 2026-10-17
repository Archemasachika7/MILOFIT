/**
 * MILOFIT Arena — web client entry point.
 *
 * Responsibilities:
 *   - menu + character picker (rendered from shared content)
 *   - the fixed-step input loop and client-side prediction
 *   - snapshot interpolation for remote players
 *   - HUD, kill feed, chat, scoreboard and screen effects
 */
import { Renderer } from './render.js';
import { InputController, isCoarsePointer } from './input.js';
import { GameClient } from './net.js';
import { Predictor } from './predict.js';
import * as audio from './audio.js';
import { renderCharacterPreview } from './sprites.js';
// See web/src/predict.js for why this specifier is relative and climbs two levels.
import { clamp } from '../../shared/sim-core.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ content

const content = await fetch('/api/content').then((r) => {
  if (!r.ok) throw new Error(`content request failed: ${r.status}`);
  return r.json();
});

const TUNING = content.tuning;
const MAPS = new Map(content.maps.map((m) => [m.id, m]));
const WEAPONS = new Map(content.weapons.map((w) => [w.id, w]));
const CHARACTERS = new Map(content.characters.map((c) => [c.id, c]));

const canvas = $('game');
const renderer = new Renderer(canvas, content);
const isTouch = isCoarsePointer();

// -------------------------------------------------------------------- state

const prefs = {
  name: localStorage.getItem('milofit.name') ?? '',
  character: localStorage.getItem('milofit.character') ?? content.characters[0].id,
  room: (localStorage.getItem('milofit.room') === 'lobby' ? '' : localStorage.getItem('milofit.room')) ?? '',
  team: localStorage.getItem('milofit.team') ?? 'auto',
  format: localStorage.getItem('milofit.format') ?? '1v1',
  roleMode: localStorage.getItem('milofit.roleMode') ?? 'roles',
  role: localStorage.getItem('milofit.role') ?? 'raider',
  gravityMode: localStorage.getItem('milofit.gravityMode') ?? 'normal',
  server: localStorage.getItem('milofit.server')
    ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
};
if (!prefs.name) prefs.name = `Player${Math.floor(Math.random() * 900 + 100)}`;

const game = {
  playing: false,
  client: null,
  predictor: new Predictor(TUNING, MAPS.get('arena_core')),
  camera: { x: 0, y: 0, zoom: 1 },
  shake: { x: 0, y: 0, mag: 0, roll: 0 },
  snapBuffer: [],
  anim: new Map(),
  effects: [],
  killFeed: [],
  chat: [],
  local: { id: null, name: prefs.name, team: 'ffa', role: 'raider', alive: false, spectator: true, hp: 100, maxHealth: 100, shield: 0, jetFuel: 100, maxJetFuel: 100 },
  hitMarker: 0,
  damageFlash: 0,
  banner: null,
  scoreboardPinned: false,
  snapTimes: [],
  fps: 0,
  inputSeq: 0,
  lastState: null,
};

const input = new InputController({
  canvas,
  isTouch,
  toWorld: (sx, sy) => renderer.screenToWorld(sx, sy, game.camera),
});

// ------------------------------------------------------------------ the menu

function populateMenu() {
  $('nameInput').value = prefs.name;
  $('serverInput').value = prefs.server;
  $('roomInput').value = prefs.room;
  $('teamSelect').value = prefs.team;
  $('formatSelect').value = prefs.format;
  $('roleModeSelect').value = prefs.roleMode;
  $('roleSelect').value = prefs.role;
  $('gravitySelect').value = prefs.gravityMode;

  const mapSelect = $('mapSelect');
  mapSelect.innerHTML = '';
  for (const map of content.maps) {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = map.name;
    mapSelect.appendChild(option);
  }
  mapSelect.value = 'arena_core';

  const modeSelect = $('modeSelect');
  modeSelect.innerHTML = '';
  for (const mode of content.modes) {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.name;
    modeSelect.appendChild(option);
  }
  modeSelect.value = 'tdm';
  $('roleSelect').disabled = prefs.roleMode === 'free';
  syncRuleControls();

  const grid = $('characterGrid');
  grid.innerHTML = '';
  const defaultWeapon = WEAPONS.get('bulldog');
  for (const character of content.characters) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'char-card';
    card.dataset.id = character.id;
    const preview = document.createElement('canvas');
    card.appendChild(preview);
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = character.name;
    card.appendChild(label);
    renderCharacterPreview(preview, character, defaultWeapon);
    card.addEventListener('click', () => {
      prefs.character = character.id;
      localStorage.setItem('milofit.character', character.id);
      for (const other of grid.children) other.classList.toggle('selected', other.dataset.id === character.id);
    });
    if (character.id === prefs.character) card.classList.add('selected');
    grid.appendChild(card);
  }
}

function syncRuleControls() {
  const free = $('roleModeSelect').value === 'free';
  const squadFree = $('formatSelect').value === '4v4' && free;
  $('roleSelect').disabled = free;
  $('modeSelect').disabled = squadFree;
  if (squadFree) $('modeSelect').value = 'tdm';
}

function setStatus(text, kind = '') {
  const el = $('menuStatus');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function showMenu(visible) {
  $('menu').classList.toggle('hidden', !visible);
  $('hud').classList.toggle('hidden', visible);
  $('touchControls').classList.toggle('hidden', visible || !isTouch);
  input.enabled = !visible;
  input.keyboardEnabled = !visible;
  if (visible) {
    audio.stopAllLoops();
    audio.setJetIntensity(0);
  }
}

function readMenu() {
  prefs.name = $('nameInput').value.trim().slice(0, 16) || 'Recruit';
  prefs.server = $('serverInput').value.trim();
  prefs.room = $('roomInput').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  prefs.team = $('teamSelect').value;
  localStorage.setItem('milofit.name', prefs.name);
  localStorage.setItem('milofit.server', prefs.server);
  localStorage.setItem('milofit.room', prefs.room);
  localStorage.setItem('milofit.team', prefs.team);
  prefs.format = $('formatSelect').value;
  prefs.roleMode = $('roleModeSelect').value;
  prefs.role = $('roleSelect').value;
  prefs.gravityMode = $('gravitySelect').value;
  localStorage.setItem('milofit.format', prefs.format);
  localStorage.setItem('milofit.roleMode', prefs.roleMode);
  localStorage.setItem('milofit.role', prefs.role);
  localStorage.setItem('milofit.gravityMode', prefs.gravityMode);
  return {
    map: $('mapSelect').value,
    mode: $('modeSelect').value,
    format: prefs.format,
    roleMode: prefs.roleMode,
    role: prefs.role,
    gravityMode: prefs.gravityMode,
  };
}

// ------------------------------------------------------------------ the client

function attachClient(client) {
  game.client = client;

  client.on('status', (status) => {
    if (game.playing) return;
    const labels = {
      connecting: 'Connecting…',
      connected: 'Connected.',
      disconnected: 'Disconnected — retrying…',
      closed: 'Disconnected.',
    };
    setStatus(labels[status] ?? status, status === 'connected' ? 'ok' : '');
  });

  client.on('welcome', (msg) => {
    if (!msg.you) return;
    game.local.id = msg.you.id;
    game.local.name = msg.you.name;
    $('playButton').dataset.host = msg.you.host ? '1' : '';
    if (msg.room) {
      prefs.room = msg.room.id;
      localStorage.setItem('milofit.room', prefs.room);
      $('roomInput').value = prefs.room;
      if (client.joinOptions) client.joinOptions.room = prefs.room;
      const roomMap = MAPS.get(msg.room.mapId);
      if (roomMap) game.predictor.setMap(roomMap);
      updateModeLabel(msg.room);
    }
    // Map/mode are room settings, not JOIN fields. Apply the menu selection once
    // the server confirms this client is host; otherwise the room silently stays
    // on its default map even though the picker showed another choice.
    if (msg.you.host && client.joinOptions?.map && client.joinOptions?.mode) {
      client.send({
        t: 'settings',
        map: client.joinOptions.map,
        mode: client.joinOptions.mode,
        format: client.joinOptions.format,
        roleMode: client.joinOptions.roleMode,
        gravityMode: client.joinOptions.gravityMode,
      });
    }
  });

  client.on('room', (room) => {
    if (!room) return;
    const map = MAPS.get(room.mapId);
    if (map) game.predictor.setMap(map);
    updateModeLabel(room);
  });

  client.on('state', (snap) => {
    const me = snap.players?.find((p) => p.i === game.local.id);
    if (me) game.predictor.setRole(me.r);
    if (Number.isFinite(snap.gravityScale)) game.predictor.setGravityScale(snap.gravityScale);
    pushSnapshot(snap);
    game.lastState = snap;
  });

  client.on('events', handleEvents);

  client.on('chat', (msg) => {
    addChatLine(msg);
  });

  client.on('serverError', (msg) => {
    setStatus(msg.message ?? 'server error', 'error');
    if (msg.code === 'room_full') showMenu(true);
  });

  client.on('reconnecting', ({ attempt }) => {
    setStatus(`Reconnecting… (attempt ${attempt})`);
  });
}

async function connect(joinOptions, { solo = false } = {}) {
  audio.unlockAudio();
  setStatus('Connecting…');
  $('playButton').disabled = true;

  const options = { ...joinOptions };
  if (solo) {
    options.room = `solo-${Math.random().toString(36).slice(2, 7)}`;
  }

  const client = new GameClient(prefs.server);
  attachClient(client);
  try {
    await client.connect();
  } catch (err) {
    setStatus(`Could not connect: ${err.message}`, 'error');
    $('playButton').disabled = false;
    return;
  }

  client.join(options);
  game.playing = true;
  game.snapBuffer.length = 0;
  game.effects.length = 0;
  game.killFeed.length = 0;
  game.chat.length = 0;
  game.anim.clear();
  game.inputSeq = 0;
  game.predictor.reset(null, TUNING.player.width, TUNING.player.height);
  game.camera.x = MAPS.get('arena_core') ? MAPS.get('arena_core').size.width / 2 : 0;
  game.camera.y = MAPS.get('arena_core') ? MAPS.get('arena_core').size.height / 2 : 0;
  $('playButton').disabled = false;
  showMenu(false);
  addChatLine({ from: 'system', name: 'system', team: 'system', text: 'Connected. Good luck.' });
}

function updateModeLabel(room) {
  const mode = content.modes.find((m) => m.id === room.modeId);
  const map = MAPS.get(room.mapId);
  const format = room.format ? ` · ${room.format.toUpperCase()} ${room.roleMode === 'free' ? 'ATTACKERS' : 'ROLES'}` : '';
  const gravity = room.gravityMode && room.gravityMode !== 'normal' ? ` · ${room.gravityMode.toUpperCase()}` : '';
  $('modeLabel').textContent = `${mode?.name ?? room.modeId} · ${map?.name ?? room.mapId}${format}${gravity} · ROOM ${String(room.id).toUpperCase()}`;
}

// ------------------------------------------------------------ snapshot buffer

function pushSnapshot(snap) {
  const now = performance.now();
  game.snapBuffer.push({ at: now, data: snap });
  const cutoff = now - 1500;
  while (game.snapBuffer.length > 2 && game.snapBuffer[0].at < cutoff) game.snapBuffer.shift();
  if (game.snapBuffer.length > 60) game.snapBuffer.shift();
  game.snapTimes.push(now);
  while (game.snapTimes.length && game.snapTimes[0] < now - 1000) game.snapTimes.shift();
}

function pickInterpolation() {
  const renderAt = performance.now() - TUNING.net.interpDelayMs;
  const buffer = game.snapBuffer;
  if (!buffer.length) return { a: null, b: null, alpha: 0 };
  if (buffer.length === 1) return { a: buffer[0].data, b: null, alpha: 1 };
  let index = 0;
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].at <= renderAt) { index = i; break; }
  }
  const a = buffer[index];
  const b = buffer[Math.min(index + 1, buffer.length - 1)];
  if (a === b) return { a: a.data, b: null, alpha: 1 };
  const alpha = clamp((renderAt - a.at) / Math.max(1, b.at - a.at), 0, 1);
  return { a: a.data, b: b.data, alpha };
}

const lerp = (x, y, t) => x + (y - x) * t;
const FLAGS = { ALIVE: 1, GROUND: 2, JET: 4, RELOAD: 8, PROTECTED: 16, SPECTATOR: 32 };

function buildViews(a, b, alpha, dt) {
  if (!a) return [];
  const byId = new Map((b?.players ?? []).map((p) => [p.i, p]));
  const views = [];
  for (const sp of a.players) {
    const np = byId.get(sp.i) ?? sp;
    const character = CHARACTERS.get(sp.c) ?? content.characters[0];
    const isLocal = sp.i === game.local.id;
    const t = isLocal ? 1 : alpha;
    const anim = game.anim.get(sp.i) ?? { walk: 0 };
    game.anim.set(sp.i, anim);

    const v = {
      id: sp.i,
      name: sp.n,
      team: sp.tm,
      role: np.r,
      x: lerp(sp.x, np.x, t),
      y: lerp(sp.y, np.y, t),
      vx: lerp(sp.vx, np.vx, t),
      vy: lerp(sp.vy, np.vy, t),
      aim: lerp(sp.a, np.a, t),
      facing: sp.f,
      hp: np.hp,
      maxHealth: np.mh,
      maxJetFuel: np.mj,
      shield: np.sh,
      alive: (np.fl & FLAGS.ALIVE) !== 0,
      onGround: (np.fl & FLAGS.GROUND) !== 0,
      jetting: (np.fl & FLAGS.JET) !== 0,
      reloading: (np.fl & FLAGS.RELOAD) !== 0,
      protectedNow: (np.fl & FLAGS.PROTECTED) !== 0,
      spectator: (np.fl & FLAGS.SPECTATOR) !== 0,
      weaponId: np.w,
      mag: np.m,
      reserve: np.rr,
      grenades: np.g,
      kills: np.k,
      deaths: np.d,
      score: np.sc,
      respawnIn: np.rd,
      ping: np.pg,
      slot: np.s,
      palette: character.palette,
      walk: anim.walk,
    };

    if (isLocal) {
      const body = game.predictor.body;
      v.x = body.x;
      v.y = body.y;
      v.vx = body.vx;
      v.vy = body.vy;
      v.facing = body.facing;
      v.aim = body.aim;
      v.jetFuel = body.jetFuel;
      game.local.alive = v.alive;
      game.local.spectator = v.spectator;
      game.local.team = v.team;
      game.local.role = v.role;
      game.local.hp = v.hp;
      game.local.maxHealth = v.maxHealth;
      game.local.shield = v.shield;
      game.local.jetFuel = body.jetFuel;
      game.local.maxJetFuel = body.maxJetFuel;
      game.local.weaponId = v.weaponId;
      game.local.mag = v.mag;
      game.local.reserve = v.reserve;
      game.local.grenades = v.grenades;
      game.local.reloading = v.reloading;
      game.local.respawnIn = v.respawnIn;
    }

    anim.walk += (Math.abs(v.vx) / 60) * dt * 22;
    views.push(v);
  }
  return views;
}

// ------------------------------------------------------------------- effects

/**
 * Resolve each flag to the position it should be drawn at.
 *
 * A loose flag is static, so it needs no interpolation. A carried flag has to
 * ride the body holding it — and for the local player that body is the locally
 * predicted one, so the flag stays glued to the runner rather than lagging a
 * snapshot behind.
 */
function buildFlagViews(flags, views) {
  if (!flags || !flags.length) return [];
  return flags.map((f) => {
    const carrier = f.c ? views.find((v) => v.id === f.c) : null;
    return {
      team: f.tm,
      x: carrier ? carrier.x : f.x,
      y: carrier ? carrier.y : f.y,
      bx: f.bx,
      by: f.by,
      atBase: f.a === 1 || f.a === true,
      carried: !!carrier,
    };
  });
}

function addEffect(type, props, life) {
  game.effects.push({ type, t: 0, life, ...props });
}

function distGain(x, y) {
  const { x: cx, y: cy } = game.camera;
  const d = Math.hypot(x - cx, y - cy);
  return clamp(1 - d / 1400, 0.06, 1);
}

function shake(mag) {
  game.shake.mag = Math.min(26, game.shake.mag + mag);
}

function handleEvents(events) {
  const me = game.local.id;
  for (const ev of events) {
    switch (ev.type) {
      case 'fire': {
        addEffect('muzzle', { x: ev.x, y: ev.y, angle: ev.angle }, 0.07);
        audio.playShot(ev.weapon, distGain(ev.x, ev.y));
        if (ev.id === me) {
          game.predictor.body.facing = Math.cos(ev.angle) >= 0 ? 1 : -1;
          shake(0.5);
        } else {
          shake(0.25 * distGain(ev.x, ev.y));
        }
        break;
      }
      case 'impact': {
        addEffect('impact', { x: ev.x, y: ev.y, flesh: !!ev.flesh, seed: Math.random() * 6.28 }, 0.3);
        break;
      }
      case 'explosion': {
        addEffect('explosion', { x: ev.x, y: ev.y, radius: ev.radius }, 0.55);
        addEffect('ring', { x: ev.x, y: ev.y, radius: ev.radius * 1.7, color: '#ffb703' }, 0.45);
        audio.playExplosion(distGain(ev.x, ev.y));
        shake(9 * distGain(ev.x, ev.y) + 3);
        break;
      }
      case 'hitMark': {
        if (ev.to === me) {
          game.hitMarker = 1;
          addEffect('damage', { x: ev.x, y: ev.y, value: String(ev.amount), shield: ev.shield }, 0.7);
          audio.playHitMark();
        }
        break;
      }
      case 'hurt': {
        if (ev.to === me) {
          game.damageFlash = 1;
          audio.playHurt();
          shake(3);
        }
        break;
      }
      case 'kill': {
        addKillFeed(ev);
        if (ev.killer === me) audio.playKill();
        if (ev.victim === me) audio.playDeath();
        break;
      }
      case 'pickup': {
        if (ev.id === me) audio.playPickup();
        addEffect('ring', { x: ev.x, y: ev.y, radius: 42, color: '#ffd166' }, 0.4);
        break;
      }
      case 'capture': {
        game.banner = {
          text: ev.team === game.local.team ? 'YOU SCORED' : `${String(ev.team).toUpperCase()} SCORED`,
          sub: `${ev.name} captured the flag — ${Math.round(ev.score)} / ${game.lastState?.scoreLimit ?? '?'}`,
          t: 0,
          life: 3.2,
        };
        audio.playKill();
        shake(6);
        addEffect('ring', {
          x: ev.x,
          y: ev.y,
          radius: 96,
          color: ev.team === 'red' ? '#ff5d5d' : '#4cc9f0',
        }, 0.75);
        break;
      }
      case 'flag': {
        // taken/dropped/returned — the snapshot already carries the position, so
        // this is purely for the audio cue.
        if (ev.action === 'taken' || ev.action === 'returned') audio.playPickup();
        break;
      }
      case 'reload': {
        if (ev.id === me) audio.playReload(0);
        break;
      }
      case 'reloaded': {
        if (ev.id === me) audio.playReload(1);
        break;
      }
      case 'melee': {
        audio.playShot('basher', distGain(ev.x, ev.y));
        addEffect('ring', { x: ev.x, y: ev.y, radius: 60, color: '#ff8a5c' }, 0.22);
        break;
      }
      case 'throw': {
        audio.playShot('frag', distGain(ev.x, ev.y));
        break;
      }
      case 'spawn': {
        addEffect('ring', { x: ev.x, y: ev.y, radius: 90, color: '#7ee0ff' }, 0.6);
        break;
      }
      case 'matchStart': {
        game.effects.length = 0;
        game.banner = { text: 'FIGHT', sub: '', t: 0, life: 2.2 };
        audio.playCountdownBeep(true);
        break;
      }
      case 'countdown': {
        game.banner = { text: 'GET READY', sub: `Match starts in ${Math.round(ev.seconds)}s`, t: 0, life: ev.seconds };
        audio.playCountdownBeep(false);
        break;
      }
      case 'matchEnd': {
        game.scoreboardPinned = true;
        renderScoreboard(ev.scoreboard ?? [], { final: true, winner: ev.winner });
        const iWon = ev.winner && (game.lastState?.teams
          ? game.local.team === ev.winner
          : ev.winner === me);
        audio.playMatchEnd(!!iWon);
        game.banner = { text: iWon ? 'VICTORY' : 'MATCH OVER', sub: ev.reason === 'time' ? 'Time expired' : 'Score limit reached', t: 0, life: 5 };
        break;
      }
      case 'lobby': {
        game.scoreboardPinned = false;
        $('scoreboard').classList.add('hidden');
        game.banner = { text: 'WAITING FOR PLAYERS', sub: 'Match starts automatically', t: 0, life: 3.5 };
        break;
      }
      default:
        break;
    }
  }
}

function addKillFeed(ev) {
  const el = document.createElement('div');
  el.className = 'kf-entry';
  const killer = ev.killerName ?? 'the arena';
  const killerTeam = ev.killerTeam ? `team-${ev.killerTeam}` : 'team-ffa';
  const victimTeam = `team-${ev.victimTeam ?? 'ffa'}`;
  const weapon = ev.weapon && WEAPONS.get(ev.weapon) ? WEAPONS.get(ev.weapon).name : '—';
  el.innerHTML = `<span class="who ${killerTeam}"></span> <span class="weapon">${weapon}</span> <span class="who ${victimTeam}"></span>`;
  el.children[0].textContent = killer === 'the arena' ? 'the arena' : killer;
  el.children[2].textContent = ev.victimName ?? '?';
  $('killfeed').appendChild(el);
  setTimeout(() => el.remove(), 6500);
  while ($('killfeed').children.length > 6) $('killfeed').firstChild.remove();
}

function addChatLine(msg) {
  const el = document.createElement('div');
  el.className = `chat-line ${msg.team === 'system' || msg.from === 'system' ? 'system' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = msg.from === 'system' || msg.team === 'system' ? '»' : `${msg.name}:`;
  el.appendChild(who);
  el.appendChild(document.createTextNode(` ${msg.text}`));
  $('chatlog').appendChild(el);
  while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove();
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.remove(), 14000);
}

// -------------------------------------------------------------------- HUD

const hudCache = {};

function setText(id, value) {
  if (hudCache[id] === value) return;
  hudCache[id] = value;
  const el = $(id);
  if (el) el.textContent = value;
}

function setWidth(id, pct) {
  const el = $(id);
  if (el) el.style.width = `${clamp(pct, 0, 100)}%`;
}

function updateHud() {
  const local = game.local;
  const state = game.lastState;

  setWidth('healthFill', ((local.hp ?? 0) / Math.max(1, local.maxHealth ?? TUNING.player.maxHealth)) * 100);
  setWidth('shieldFill', (Math.min(50, local.shield ?? 0) / 50) * 100);
  setWidth('jetFill', ((local.jetFuel ?? 0) / Math.max(1, local.maxJetFuel ?? TUNING.jetpack.maxFuel)) * 100);
  setText('healthText', String(Math.max(0, Math.round(local.hp ?? 0))));
  setText('shieldText', String(Math.max(0, Math.round(local.shield ?? 0))));
  setText('jetText', 'JET');

  const weapon = local.weaponId ? WEAPONS.get(local.weaponId) : null;
  setText('weaponName', weapon?.name ?? '—');
  const mag = local.mag ?? 0;
  const reserve = local.reserve ?? 0;
  setText('ammoText', mag < 0 ? '∞' : `${mag} / ${reserve}`);

  const slotList = $('slotList');
  if (slotList.dataset.key !== `${local.weaponId}`) {
    slotList.dataset.key = `${local.weaponId}`;
    slotList.innerHTML = '';
    if (weapon) {
      const chip = document.createElement('span');
      chip.className = 'slot-chip active';
      chip.textContent = weapon.name;
      slotList.appendChild(chip);
    }
    const melee = WEAPONS.get('basher');
    const chip2 = document.createElement('span');
    chip2.className = 'slot-chip';
    chip2.textContent = melee?.name ?? 'Melee';
    slotList.appendChild(chip2);
  }

  setText('grenadeCount', '●'.repeat(Math.max(0, local.grenades ?? 0)) || '·');

  if (state) {
    const minutes = Math.floor(state.timeLeft / 60);
    const seconds = String(state.timeLeft % 60).padStart(2, '0');
    setText('clockValue', `${minutes}:${seconds}`);
    if (state.teams) {
      let line = `RED ${state.scores.red ?? 0} — ${state.scores.blue ?? 0} BLUE`;
      const flags = state.flags ?? [];
      if (flags.length) {
        // Capture the flag: the team score is captures, so show the goal and
        // warn the player when their own flag is out in the field.
        line = `⚑ ${line} / ${state.scoreLimit}`;
        const mine = flags.find((f) => f.tm === local.team);
        if (mine && !mine.a) line += '  ·  YOUR FLAG IS AWAY';
      }
      setText('scoreValue', line);
    } else {
      setText('scoreValue', `SCORE ${state.scores.ffa ?? 0} / ${state.scoreLimit}`);
    }
    $('respawnOverlay').classList.toggle('hidden', local.alive || local.spectator);
    if (!local.alive) setText('respawnTimer', String(Math.ceil(local.respawnIn ?? 0)));
  }

  const snapRate = game.snapTimes.length;
  const client = game.client;
  setText('netStats', '');
  $('netStats').innerHTML = [
    `ping <b>${Math.round(client?.rtt ?? 0)}ms</b>`,
    `snapshots <b>${snapRate}/s</b>`,
    `fps <b>${Math.round(game.fps)}</b>`,
    `players <b>${state?.players.filter((p) => (p.fl & FLAGS.ALIVE) !== 0).length ?? 0}</b>`,
    `offset <b>${game.predictor.error ? Math.round(Math.hypot(game.predictor.error.x, game.predictor.error.y)) : 0}px</b>`,
  ].join(' · ');
}

function renderScoreboard(rows, { final = false, winner = null } = {}) {
  const el = $('scoreboard');
  const state = game.lastState;
  const teams = state?.teams;
  let html = `<h2>${final ? 'Final result' : 'Scoreboard'}${winner ? ` · ${String(winner).toUpperCase()}` : ''}</h2>`;

  const table = (list) => {
    const body = list.map((r) => {
      const me = r.id === game.local.id;
      return `<tr class="${me ? 'me' : ''}"><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.score}</td><td>${r.ping ?? 0}ms</td></tr>`;
    }).join('');
    return `<table><thead><tr><th>Player</th><th>K</th><th>D</th><th>Score</th><th>Ping</th></tr></thead><tbody>${body}</tbody></table>`;
  };

  if (teams) {
    for (const team of ['red', 'blue']) {
      html += `<div class="team-head ${team}">${team.toUpperCase()} — ${state.scores[team] ?? 0}</div>`;
      html += table(rows.filter((r) => r.team === team));
    }
  } else {
    html += table(rows);
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------- camera

function updateCamera(views, dt) {
  const map = MAPS.get(game.lastState?.mapId) ?? MAPS.get('arena_core');
  const local = views.find((v) => v.id === game.local.id);
  const zoom = renderer.preferredZoom(map.size.height);

  let targetX;
  let targetY;
  if (local && (local.alive || !local.spectator)) {
    targetX = local.x + Math.min(120, (local.vx ?? 0) * 0.22);
    targetY = local.y + Math.min(80, (local.vy ?? 0) * 0.14);
  } else {
    targetX = map.size.width / 2;
    targetY = map.size.height / 2;
  }

  const follow = local?.alive ? 7.5 : 2.6;
  const k = 1 - Math.exp(-follow * dt);
  game.camera.x += (targetX - game.camera.x) * k;
  game.camera.y += (targetY - game.camera.y) * k;
  game.camera.zoom += (zoom - game.camera.zoom) * (1 - Math.exp(-6 * dt));

  // Keep the viewport inside the arena when the map is larger than the screen.
  const halfW = renderer.width / 2 / game.camera.zoom;
  const halfH = renderer.height / 2 / game.camera.zoom;
  if (map.size.width > halfW * 2) game.camera.x = clamp(game.camera.x, halfW, map.size.width - halfW);
  else game.camera.x = map.size.width / 2;
  if (map.size.height > halfH * 2) game.camera.y = clamp(game.camera.y, halfH, map.size.height - halfH);
  else game.camera.y = map.size.height / 2;

  game.shake.mag *= Math.exp(-7 * dt);
  game.shake.x = (Math.random() - 0.5) * game.shake.mag;
  game.shake.y = (Math.random() - 0.5) * game.shake.mag;
  game.shake.roll = (Math.random() - 0.5) * game.shake.mag * 0.0012;
}

// --------------------------------------------------------------------- loop

let lastFrame = performance.now();
let acc = 0;
const FIXED_DT = 1 / TUNING.tickRate;

function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.25) dt = 0.25;
  game.fps = game.fps ? game.fps * 0.9 + (1 / Math.max(dt, 0.0001)) * 0.1 : 1 / dt;

  if (renderer.width !== canvas.clientWidth || renderer.height !== canvas.clientHeight) renderer.resize();

  if (game.playing && game.client?.status === 'connected') {
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 6) {
      const localView = game.local;
      const snapBody = findLocalSnapshot();
      if (snapBody) game.predictor.reconcile(snapBody.body, FIXED_DT);

      const frameInput = input.sample({ x: game.predictor.body.x, y: game.predictor.body.y, facing: game.predictor.body.facing });
      game.predictor.step({ x: frameInput.x, jump: frameInput.jump, jet: frameInput.jet, aim: frameInput.aim }, FIXED_DT);
      game.client.sendInput(frameInput, ++game.inputSeq);

      audio.setJetIntensity(game.predictor.body.jetting ? 1 : 0);
      acc -= FIXED_DT;
      steps += 1;
    }
    if (steps === 0) audio.setJetIntensity(0);
  }

  // ---- effects ----------------------------------------------------------
  for (let i = game.effects.length - 1; i >= 0; i--) {
    const fx = game.effects[i];
    fx.t += dt;
    if (fx.t >= fx.life) game.effects.splice(i, 1);
  }
  game.hitMarker = Math.max(0, game.hitMarker - dt * 3.5);
  game.damageFlash = Math.max(0, game.damageFlash - dt * 2.4);
  if (game.banner) {
    game.banner.t += dt;
    if (game.banner.t >= game.banner.life) game.banner = null;
  }

  // ---- render -----------------------------------------------------------
  const { a, b, alpha } = pickInterpolation();
  const views = buildViews(a, b, alpha, dt);
  updateCamera(views, dt);

  const map = MAPS.get(a?.mapId) ?? MAPS.get(game.lastState?.mapId) ?? MAPS.get('arena_core');
  const time = now / 1000;

  renderer.clear();
  renderer.drawBackground(map, game.camera, time);
  renderer.applyCamera(game.camera, game.shake);
  renderer.drawMap(map, time);
  if (a) renderer.drawPickups(a.pickups ?? [], time);
  if (a) renderer.drawBullets(a.bullets ?? []);
  renderer.drawFlags(buildFlagViews(a?.flags, views), time);

  const sorted = views.slice().sort((p, q) => (p.id === game.local.id ? 1 : 0) - (q.id === game.local.id ? 1 : 0));
  for (const view of sorted) {
    if (view.spectator && !view.alive) continue;
    renderer.drawPlayer(view, { isLocal: view.id === game.local.id, time });
  }

  renderer.drawEffects(game.effects);

  if (game.playing) {
    renderer.drawOffscreenMarkers(views, game.camera, { id: game.local.id });
    const aim = input.aimFromStick ?? renderer.screenToWorld(input.mouse.x, input.mouse.y, game.camera);
    const screen = {
      x: (aim.x - game.camera.x) * game.camera.zoom + renderer.width / 2,
      y: (aim.y - game.camera.y) * game.camera.zoom + renderer.height / 2,
    };
    const ready = !game.local.reloading && (game.local.mag ?? 1) !== 0;
    renderer.drawCrosshair(
      clamp(screen.x, 8, renderer.width - 8),
      clamp(screen.y, 8, renderer.height - 8),
      game.hitMarker,
      ready,
    );
    drawOverlays();
  }

  if (!game.playing) drawMenuBackdrop(time);
  else updateHud();
}

function findLocalSnapshot() {
  const buffer = game.snapBuffer;
  if (!buffer.length) return null;
  const data = buffer[buffer.length - 1].data;
  const player = data.players.find((p) => p.i === game.local.id);
  if (!player) return null;
  return {
    body: {
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      a: player.a,
      f: player.f,
      fl: player.fl,
      j: player.j,
      alive: (player.fl & FLAGS.ALIVE) !== 0,
    },
  };
}

function drawOverlays() {
  const { ctx } = renderer;
  ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);

  if (game.damageFlash > 0) {
    const g = ctx.createRadialGradient(
      renderer.width / 2, renderer.height / 2, renderer.height * 0.25,
      renderer.width / 2, renderer.height / 2, renderer.height * 0.75,
    );
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, `rgba(230, 57, 70, ${0.45 * game.damageFlash})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, renderer.width, renderer.height);
  }

  if (game.local.spectator && game.lastState?.state === 'lobby') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,238,252,.9)';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    const text = game.lastState.countdown > 0
      ? `Match starts in ${Math.ceil(game.lastState.countdown)}…`
      : 'Waiting for players…';
    ctx.fillText(text, renderer.width / 2, renderer.height * 0.16);
    ctx.restore();
  }

  if (game.banner) {
    const k = game.banner.t / game.banner.life;
    const alphaIn = Math.min(1, k * 5);
    const alphaOut = Math.min(1, (1 - k) * 5);
    const alpha = Math.min(alphaIn, alphaOut);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 54px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(76,201,240,.55)';
    ctx.shadowBlur = 26;
    ctx.fillText(game.banner.text, renderer.width / 2, renderer.height * 0.36);
    ctx.shadowBlur = 0;
    if (game.banner.sub) {
      ctx.font = '500 17px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(200,215,240,.85)';
      ctx.fillText(game.banner.sub, renderer.width / 2, renderer.height * 0.36 + 34);
    }
    ctx.restore();
  }

  // Scoreboard while the match runs.
  const showBoard = input.keys.has('Tab') || game.scoreboardPinned;
  const board = $('scoreboard');
  if (showBoard) {
    const rows = (game.lastState?.players ?? []).map((p) => ({
      id: p.i, name: p.n, team: p.tm, kills: p.k, deaths: p.d, score: p.sc, ping: p.pg,
    })).sort((x, y) => y.score - x.score);
    if (!game.scoreboardPinned) renderScoreboard(rows);
    else if (board.classList.contains('hidden')) board.classList.remove('hidden');
  } else if (!game.scoreboardPinned) {
    board.classList.add('hidden');
  }
}

function drawMenuBackdrop(time) {
  const { ctx } = renderer;
  ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, renderer.width, renderer.height);
  ctx.globalAlpha = 1;
  const map = MAPS.get('arena_core');
  const cam = {
    x: map.size.width / 2 + Math.sin(time * 0.06) * 260,
    y: map.size.height / 2 + Math.cos(time * 0.045) * 120,
    zoom: Math.min(renderer.width / 1500, renderer.height / 900),
  };
  ctx.save();
  ctx.globalAlpha = 0.28;
  renderer.applyCamera(cam, null);
  renderer.drawMap(map, time);
  ctx.restore();
}

// ------------------------------------------------------------------- wiring

$('playButton').addEventListener('click', () => {
    const settings = readMenu();
    connect({
      name: prefs.name,
      character: prefs.character,
      room: prefs.room,
      team: prefs.team,
      role: settings.role,
      map: settings.map,
      mode: settings.mode,
      format: settings.format,
      roleMode: settings.roleMode,
      gravityMode: settings.gravityMode,
    });
  });

$('practiceButton').addEventListener('click', () => {
  const settings = readMenu();
  connect({
    name: prefs.name,
    character: prefs.character,
    team: 'auto',
    role: settings.role,
    map: settings.map,
    mode: settings.mode,
    format: settings.format,
    roleMode: settings.roleMode,
    gravityMode: settings.gravityMode,
  }, { solo: true });
});

$('roleModeSelect').addEventListener('change', () => {
  syncRuleControls();
});

$('formatSelect').addEventListener('change', () => {
  // Squad mode defaults to the role-free all-attacker ruleset; players can still
  // opt back into role selection explicitly after changing the format.
  if ($('formatSelect').value === '4v4') {
    $('roleModeSelect').value = 'free';
  } else if ($('roleModeSelect').value === 'free') {
    $('roleModeSelect').value = 'roles';
  }
  syncRuleControls();
});

$('menuToggle').addEventListener('click', () => {
  const menuVisible = $('menu').classList.contains('hidden') === false;
  if (menuVisible) {
    showMenu(false);
  } else {
    game.client?.close();
    game.playing = false;
    $('scoreboard').classList.add('hidden');
    game.scoreboardPinned = false;
    showMenu(true);
    setStatus('Disconnected.', '');
  }
});

// Chat: Enter focuses, Enter/Escape submits or cancels.
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('chatInput').value.trim();
  if (value) game.client?.send({ t: 'chat', text: value });
  $('chatInput').value = '';
  closeChat();
});

function openChat() {
  $('chatForm').classList.add('open');
  $('chatInput').focus();
  input.keyboardEnabled = false;
}

function closeChat() {
  $('chatForm').classList.remove('open');
  $('chatInput').blur();
  input.keyboardEnabled = true;
}

window.addEventListener('keydown', (e) => {
  if (!game.playing) return;
  const typing = document.activeElement === $('chatInput');
  if (e.code === 'Enter' && !typing) {
    openChat();
    e.preventDefault();
  } else if (e.code === 'Escape' && typing) {
    closeChat();
  } else if (e.code === 'KeyM' && !typing) {
    audio.setMuted(!audio.isMuted());
    addChatLine({ from: 'system', name: 'system', team: 'system', text: audio.isMuted() ? 'Sound muted' : 'Sound on' });
  } else if (e.code === 'Tab' && !typing) {
    e.preventDefault();
  }
});

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('beforeunload', () => game.client?.close());

populateMenu();
showMenu(true);
setStatus('Pick a character and press Play. Solo practice spawns a private arena.');

requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(frame);
});

// Expose a tiny handle for debugging in the console.
window.MILOFIT = { game, content, renderer, input };
