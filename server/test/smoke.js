/**
 * End-to-end smoke test over real sockets: boots the server on a scratch port,
 * connects two WebSocket clients, joins a room and verifies the wire protocol.
 *
 * Run with:  node test/smoke.js      (from the server/ directory)
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'src', 'index.js');
const PORT = 8099;

/** Send a request-target verbatim so traversal attempts are not normalised away. */
function rawGet(requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: requestPath, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeClient(name) {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const client = { socket, name, messages: [], id: null, lastState: null, onState: null, events: [] };

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    client.messages.push(msg);
    if (msg.t === 'welcome' && msg.you) client.id = msg.you.id;
    if (msg.t === 'state') {
      client.lastState = msg;
      client.onState?.(msg);
    }
    if (msg.t === 'events') client.events.push(...(msg.events ?? []));
  });

  client.send = (message) => socket.send(JSON.stringify(message));

  /**
   * Wait for a message matching a predicate. Returns immediately if one has
   * already arrived — callers must therefore use a precise predicate, never just
   * the message type, or they will match the initial greeting.
   */
  client.waitForWhere = (predicate, label, timeout = 8000) => new Promise((resolve, reject) => {
    const found = client.messages.find(predicate);
    if (found) return resolve(found);
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`timed out waiting for ${label} on ${name}`));
    }, timeout);
    const listener = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        socket.off('message', listener);
        resolve(msg);
      }
    };
    socket.on('message', listener);
  });

  return client;
}

const server = spawn(process.execPath, [serverEntry, '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => { /* the banner is not needed here */ });
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

const cleanup = () => {
  try { server.kill(); } catch { /* ignore */ }
};
process.on('exit', cleanup);

try {
  await delay(1400);

  console.log('\nstatic + content endpoints');
  const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
  check('health endpoint responds', health.ok === true);
  check('health reports no live players yet', health.players === 0, JSON.stringify(health));

  const web = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  check('web client is served at /', web.includes('MILOFIT Arena'));
  check('web client loads its module bundle', web.includes('/src/main.js'));

  const style = await fetch(`http://127.0.0.1:${PORT}/style.css`).then((r) => r.status);
  check('stylesheets are served', style === 200);

  const simCore = await fetch(`http://127.0.0.1:${PORT}/shared/sim-core.js`).then((r) => r.text());
  check('shared sim-core is served to the browser', simCore.includes('export function stepPlayerMovement'));

  // Raw requests, because fetch() normalises "../" away before it hits the wire.
  const probes = [
    '/../server/package.json',
    '/%2e%2e/server/package.json',
    '/..%5Cserver%5Cpackage.json',
    '/src/../../server/src/index.js',
    '/shared/../server/package.json',
  ];
  let leaked = null;
  for (const probe of probes) {
    const res = await rawGet(probe);
    if (res.body.includes('milofit-arena-server') || res.body.includes('WebSocketServer')) leaked = probe;
  }
  check('path traversal cannot read files outside the web root', leaked === null, `leaked via ${leaked}`);

  const missing = await fetch(`http://127.0.0.1:${PORT}/no-such-file.js`).then((r) => r.text());
  check('unknown paths fall back to the client shell', missing.includes('MILOFIT Arena'));

  const content = await fetch(`http://127.0.0.1:${PORT}/api/content`).then((r) => r.json());
  check('content api returns the weapons', Array.isArray(content.weapons) && content.weapons.length >= 8);
  check('content api returns the characters', Array.isArray(content.characters) && content.characters.length >= 4);
  check('content api returns the maps', Array.isArray(content.maps) && content.maps.length >= 2);
  check('content api returns tuning constants', typeof content.tuning?.tickRate === 'number');
  check('content api returns the spawn loadout', Array.isArray(content.spawnSlots));

  console.log('\nwebsocket handshake and join');
  const alpha = makeClient('Alpha');
  const greeting = await alpha.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
  check('server greets a fresh socket', !!greeting);
  check('greeting advertises the protocol version', typeof greeting.game?.protocolVersion === 'number');

  alpha.send({ t: 'join', name: 'Alpha', character: 'recruit', room: 'smoke', team: 'red' });
  const welcome = await alpha.waitForWhere((m) => m.t === 'welcome' && !!m.you, 'join welcome');
  check('join produces a session id', typeof welcome.you?.id === 'string', JSON.stringify(welcome.you));
  check('the first joiner is the host', welcome.you?.host === true);
  check('join returns room settings', welcome.room?.id === 'smoke', `room=${welcome.room?.id}`);
  check('join returns the arena map', typeof welcome.room?.mapId === 'string');
  check('join returns a roster', welcome.roster?.players.length === 1);

  const bravo = makeClient('Bravo');
  await bravo.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
  bravo.send({ t: 'join', name: 'Bravo', character: 'scout', room: 'smoke', team: 'blue' });
  await bravo.waitForWhere((m) => m.t === 'welcome' && !!m.you, 'join welcome');
  check('the second joiner is not the host', bravo.messages.find((m) => m.t === 'welcome' && m.you)?.you.host === false);

  const roster = await alpha.waitForWhere((m) => m.t === 'roster' && m.roster?.players.length === 2, 'two-player roster');
  check('roster lists both players', roster.roster.players.length === 2);
  check('roster carries team assignments', roster.roster.players.every((p) => typeof p.team === 'string'));

  console.log('\nlive match');
  const tickSeen = [];
  const startX = { value: null };
  let sawPlaying = false;
  let sawMovement = false;
  let sawAlive = false;

  alpha.onState = (snap) => {
    tickSeen.push(snap.tick);
    if (snap.state !== 'playing') return;
    sawPlaying = true;
    const me = snap.players.find((p) => p.i === alpha.id);
    if (!me) return;
    if ((me.fl & 1) !== 0) sawAlive = true;
    if (startX.value === null) startX.value = me.x;
    else if (Math.abs(me.x - startX.value) > 40) sawMovement = true;
  };

  let seq = 0;
  const drive = setInterval(() => {
    seq += 1;
    alpha.send({ t: 'input', x: 1, jump: false, jet: false, fire: false, aim: { x: 9999, y: 900 }, seq, rtt: 20 });
    bravo.send({ t: 'input', x: -1, jump: true, jet: true, fire: false, aim: { x: 0, y: 900 }, seq, rtt: 25 });
  }, 16);

  await delay(7000);
  clearInterval(drive);

  check('match transitions out of the lobby', sawPlaying, `last tick=${tickSeen.at(-1)}`);
  check('snapshots keep flowing', tickSeen.length > 40, `snapshots=${tickSeen.length}`);
  check('players become alive once the match starts', sawAlive);
  check('player position changes while driving input', sawMovement);
  check('ticks are monotonically increasing', tickSeen.every((t, i) => i === 0 || t > tickSeen[i - 1]));
  check('snapshot includes bullet + pickup arrays', Array.isArray(alpha.lastState.bullets) && Array.isArray(alpha.lastState.pickups));
  check('snapshot includes match metadata', typeof alpha.lastState.timeLeft === 'number' && typeof alpha.lastState.scoreLimit === 'number');
  check('players report jetpack fuel and ammo', alpha.lastState.players.every((p) => typeof p.j === 'number' && typeof p.m === 'number'));

  console.log('\nchat, ping and errors');
  alpha.send({ t: 'chat', text: 'hello arena' });
  const chat = await bravo.waitForWhere((m) => m.t === 'chat' && m.text === 'hello arena', 'chat relay').catch(() => null);
  check('chat reaches other players', chat?.text === 'hello arena');
  check('chat is attributed to the sender', chat?.name === 'Alpha', JSON.stringify(chat));

  const systemChat = alpha.messages.find((m) => m.t === 'chat' && m.from === 'system' && /joined/.test(m.text));
  check('join events are announced as system chat', !!systemChat);

  alpha.send({ t: 'ping', ts: 12345 });
  const pong = await alpha.waitForWhere((m) => m.t === 'pong' && m.ts === 12345, 'pong');
  check('ping/pong round trip works', pong.ts === 12345);

  alpha.send({ t: 'bogus_type' });
  const err = await alpha.waitForWhere((m) => m.t === 'error', 'error reply');
  check('unknown message types are rejected', err?.code === 'unknown_type', JSON.stringify(err));

  alpha.send({ t: 'chat', text: 'x'.repeat(400) });
  const longChat = await bravo.waitForWhere((m) => m.t === 'chat' && m.from === alpha.id, 'long chat').catch(() => null);
  check('chat is truncated to the protocol limit', !longChat || longChat.text.length <= 120, `len=${longChat?.text.length}`);

  console.log('\nroom settings and lifecycle');
  alpha.send({ t: 'settings', map: 'caverns', mode: 'dm' });
  const roomChange = await alpha.waitForWhere((m) => m.t === 'room' && m.room.mapId === 'caverns', 'arena change');
  check('host can change the arena', roomChange.room.mapId === 'caverns');

  bravo.send({ t: 'settings', map: 'foundry' });
  await delay(250);
  const nonHostChange = alpha.messages.filter((m) => m.t === 'room' && m.room.mapId === 'foundry');
  check('non-hosts cannot change the arena', nonHostChange.length === 0);

  bravo.send({ t: 'start' });
  const notHost = await bravo.waitForWhere((m) => m.t === 'error' && m.code === 'not_host', 'not_host error');
  check('non-hosts cannot force-start the match', notHost?.code === 'not_host');

  alpha.socket.close();
  bravo.socket.close();
  await delay(500);

  const after = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
  check('server survives a client disconnect', after.ok === true);
  check('disconnected players leave the room', after.players === 0, JSON.stringify(after));
} catch (err) {
  failed += 1;
  console.error('\nunexpected failure:', err);
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
