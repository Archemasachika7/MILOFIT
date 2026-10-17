/**
 * End-to-end capture-the-flag test over real sockets.
 *
 * simulation-level CTF rules are covered exhaustively in test/sim.js. What this
 * file proves is the part that only exists once the room, the protocol and the
 * client are wired together:
 *
 *   * the server advertises `ctf` as a flag mode,
 *   * the room reports the *capture* limit as its `scoreLimit` (not a kill limit),
 *     and reports it correctly again after switching back to a non-flag mode,
 *   * snapshots always carry a `flags` array — empty outside flag modes,
 *   * in a live CTF match that array describes both flags at their authored bases.
 *
 * Run with:  node test/ctf.js      (from the server/ directory)
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { mapById, modeById, tuning } from '../src/gameData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'src', 'index.js');
const PORT = 8098;

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
  const client = { socket, name, messages: [], id: null, lastState: null, events: [] };

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    client.messages.push(msg);
    if (msg.t === 'welcome' && msg.you) client.id = msg.you.id;
    if (msg.t === 'state') client.lastState = msg;
    if (msg.t === 'events') client.events.push(...(msg.events ?? []));
  });

  client.send = (message) => socket.send(JSON.stringify(message));

  /** Prefer a precise predicate: `messages` accumulates the whole session. */
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
server.stdout.on('data', () => { /* banner not needed */ });
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
process.on('exit', () => { try { server.kill(); } catch { /* ignore */ } });

try {
  await delay(1400);

  console.log('\nctf is advertised');
  const alpha = makeClient('Alpha');
  // The server greets every new socket, so waiting for the greeting also proves
  // the connection is open before the first send.
  await alpha.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
  alpha.send({
    t: 'join', name: 'Alpha', character: 'recruit', role: 'scout', room: '', team: 'red',
    mode: 'dm', format: '4v4', roleMode: 'free', gravityMode: 'lunar',
  });
  const welcome = await alpha.waitForWhere((m) => m.t === 'welcome' && !!m.you, 'join welcome');
  const roomCode = welcome.room?.id;
  check('blank room id creates a shareable six-character LAN code',
    typeof roomCode === 'string' && /^[a-z2-9]{6}$/.test(roomCode), `room=${roomCode}`);
  check('room advertises the 4v4 squad capacity',
    welcome.room?.format === '4v4' && welcome.room?.maxPlayers === 8,
    `format=${welcome.room?.format}, max=${welcome.room?.maxPlayers}`);
  check('role-free room is configured for attackers and lunar gravity',
    welcome.room?.roleMode === 'free' && welcome.room?.gravityMode === 'lunar');

  alpha.send({ t: 'start' });
  const tooFew = await alpha.waitForWhere(
    (m) => m.t === 'error' && m.code === 'not_enough_players',
    'the online match minimum',
  );
  check('online matchmaking will not start a one-player round', tooFew.code === 'not_enough_players');

  const advertised = (welcome.modes ?? []).find((m) => m.id === 'ctf');
  check('welcome advertises the ctf mode', !!advertised);
  check('ctf is advertised as a team flag mode', !!advertised && advertised.teams === true && advertised.flags === true);
  check('ctf is advertised as capture-scored', !!advertised && advertised.teamScoreFromKills === false);

  const bravo = makeClient('Bravo');
  await bravo.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
  bravo.send({ t: 'join', name: 'Bravo', character: 'scout', room: roomCode, team: 'blue' });
  await bravo.waitForWhere((m) => m.t === 'welcome' && !!m.you, 'join welcome');
  check('role-free 4v4 assigns the default Attacker role',
    welcome.roster.players.find((p) => p.id === welcome.you.id)?.role === 'attacker');

  console.log('\nsnapshots always carry a flags array');
  const dmState = await alpha.waitForWhere((m) => m.t === 'state' && m.state === 'lobby', 'a lobby snapshot');
  check('a lobby snapshot has a flags array', Array.isArray(dmState.flags), JSON.stringify(dmState.flags));
  check('deathmatch sends no flags', dmState.flags.length === 0, `${dmState.flags.length} flags`);
  check('deathmatch uses the selected 4v4 kill limit', dmState.scoreLimit === tuning.matchFormats['4v4'].scoreLimit,
    `scoreLimit=${dmState.scoreLimit}`);

  console.log('\nswitching to capture the flag');
  alpha.send({ t: 'settings', mode: 'ctf', map: 'arena_core', roleMode: 'roles' });

  const ctfRoom = await alpha.waitForWhere(
    (m) => m.t === 'room' && m.room?.modeId === 'ctf',
    'the room to switch to ctf',
  );
  check('the host can switch the room to ctf', ctfRoom.room.modeId === 'ctf');
  check('the room reports the capture limit as scoreLimit',
    ctfRoom.room.scoreLimit === tuning.ctf.captureLimit,
    `scoreLimit=${ctfRoom.room.scoreLimit}, captureLimit=${tuning.ctf.captureLimit}`);
  check('the room reports ctf as a flag mode', ctfRoom.room.mode?.flags === true);
  check('ctf is a team mode on the wire', ctfRoom.room.mode?.teams === true);

  // Switching back must restore the selected format's kill limit.
  alpha.send({ t: 'settings', mode: 'tdm' });
  const tdmRoom = await alpha.waitForWhere(
    (m) => m.t === 'room' && m.room?.modeId === 'tdm',
    'the room to switch back to tdm',
  );
  check('switching back to a kill mode restores the kill limit',
    tdmRoom.room.scoreLimit === tuning.matchFormats['4v4'].scoreLimit,
    `scoreLimit=${tdmRoom.room.scoreLimit}`);

  const tdmState = await alpha.waitForWhere(
    (m) => m.t === 'state' && m.mode === 'tdm',
    'a tdm snapshot',
  );
  check('team deathmatch still sends no flags', tdmState.flags.length === 0, `${tdmState.flags.length} flags`);

  // Fill all eight 4v4 slots, then prove the ninth socket is rejected instead
  // of silently being placed in a different room.
  const extraClients = [];
  for (let i = 0; i < 6; i++) {
    const extra = makeClient(`Squad${i}`);
    await extra.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
    extra.send({ t: 'join', name: `Squad${i}`, character: 'recruit', room: roomCode, team: 'auto' });
    await extra.waitForWhere((m) => m.t === 'welcome' && !!m.you, 'join welcome');
    extraClients.push(extra);
  }
  const fullRoster = await alpha.waitForWhere(
    (m) => m.t === 'roster' && m.roster?.players?.length === 8,
    'the full 4v4 roster',
  );
  check('4v4 fills to exactly eight players', fullRoster.roster.players.length === 8);
  const overflow = makeClient('Overflow');
  await overflow.waitForWhere((m) => m.t === 'welcome' && !m.you, 'greeting');
  overflow.send({ t: 'join', name: 'Overflow', character: 'recruit', room: roomCode });
  const full = await overflow.waitForWhere((m) => m.t === 'error' && m.code === 'room_full', 'full-room rejection');
  check('the ninth player is refused by the 4v4 room capacity', full.code === 'room_full');

  alpha.send({ t: 'settings', mode: 'ctf' });
  await alpha.waitForWhere((m) => m.t === 'room' && m.room?.modeId === 'ctf', 'the room back on ctf');

  console.log('\na live ctf match puts both flags at their bases');
  alpha.send({ t: 'start' });
  const playing = await alpha.waitForWhere(
    (m) => m.t === 'state' && m.state === 'playing' && Array.isArray(m.flags) && m.flags.length === 2,
    'a playing ctf snapshot with two flags',
    10000,
  );

  check('a playing ctf snapshot carries exactly two flags', playing.flags.length === 2);
  check('the 4v4 match starts with all eight players', playing.players.length === 8, `${playing.players.length} players`);
  check('the playing snapshot scores to the capture limit',
    playing.scoreLimit === tuning.ctf.captureLimit,
    `scoreLimit=${playing.scoreLimit}`);
  check('ctf is flagged as a team mode in the snapshot', playing.teams === true);
  check('gravity mutator reaches the CTF snapshot',
    playing.gravityMode === 'lunar' && playing.gravityScale === tuning.gravityModes.lunar,
    `mode=${playing.gravityMode} scale=${playing.gravityScale}`);

  const map = mapById.get('arena_core');
  for (const team of ['red', 'blue']) {
    const flag = playing.flags.find((f) => f.tm === team);
    const base = map.flagBases[team];
    check(`the ${team} flag is on the wire`, !!flag);
    if (!flag) continue;
    check(`the ${team} flag reports its home base`, flag.bx === base.x && flag.by === base.y,
      `flag=(${flag.bx}, ${flag.by}) base=(${base.x}, ${base.y})`);
    check(`the ${team} flag starts at its base`, flag.x === base.x && flag.y === base.y,
      `flag=(${flag.x}, ${flag.y})`);
    check(`the ${team} flag starts marked at home`, flag.a === 1, `a=${flag.a}`);
    check(`the ${team} flag starts with no carrier`, flag.c === null || flag.c === undefined, `c=${flag.c}`);
  }

  // Both players should be alive and on opposite teams in a 2-player CTF start.
  const teams = new Set(playing.players.map((p) => p.tm));
  check('both teams are represented at kickoff', teams.has('red') && teams.has('blue'), [...teams].join(','));

  // A non-flag mode must never leak a flag into the event stream either.
  const flagEvents = alpha.events.filter((e) => e.type === 'flag' || e.type === 'capture');
  check('no flag events fire before anyone touches a flag', flagEvents.length === 0,
    JSON.stringify(flagEvents));

  console.log(`\n${passed} passed, ${failed} failed`);
} catch (err) {
  console.error(`\nctf end-to-end test threw: ${err.stack ?? err}`);
  failed += 1;
} finally {
  try { server.kill(); } catch { /* ignore */ }
  process.exit(failed === 0 ? 0 : 1);
}
