/**
 * Deterministic headless tests for the authoritative simulation and the map data.
 * Run with:  node test/sim.js     (from the server/ directory)
 */
import { Match } from '../src/sim.js';
import { tuning as T, maps, weaponById } from '../src/gameData.js';
import { stepPlayerMovement } from '../../shared/sim-core.js';

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

function section(name) {
  console.log(`\n${name}`);
}

const DT = 1 / T.tickRate;

// A monotonically increasing sequence number. The server intentionally drops
// re-ordered frames, so tests must never reuse one.
let seqCounter = 1;

function input(overrides = {}) {
  return {
    x: 0, jump: false, jet: false, fire: false,
    aimX: 0, aimY: 0, rtt: 0, actions: [],
    ...overrides,
    seq: overrides.seq ?? (seqCounter += 1),
  };
}

function place(p, x, y) {
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.spawnProtectUntil = 0;
  p.hp = T.player.maxHealth;
  p.shield = 0;
}

function freshMatch(modeId = 'dm', mapId = 'arena_core') {
  const match = new Match({ mapId, modeId, seed: 1234 });
  match.addPlayer('a', { name: 'Alpha', character: 'recruit' });
  match.addPlayer('b', { name: 'Bravo', character: 'scout' });
  match.startMatch();
  const a = match.players.get('a');
  const b = match.players.get('b');
  // Clear ground on the left of Arena Core: no crates, no centre block.
  place(a, 300, 1016);
  place(b, 620, 1016);
  match.time = 10;
  return { match, a, b };
}

function run(match, ticks) {
  for (let i = 0; i < ticks; i++) match.step(DT);
}

/** Fire `attacker` at `target` (aim is a world point) for up to `ticks`. */
function shootAt(match, attacker, target, ticks) {
  for (let i = 0; i < ticks; i++) {
    match.setInput(attacker.id, input({ fire: true, aimX: target.x, aimY: target.y }));
    match.step(DT);
    if (!target.alive) return i;
  }
  return ticks;
}

// ---------------------------------------------------------------------------

section('map data validation');
{
  const playerW = T.player.width;
  const playerH = T.player.height;

  const blockingAt = (map, x, y, w, h) => (map.solids ?? []).some((s) => {
    if (s.oneWay) return false;
    return x + w / 2 > s.x && x - w / 2 < s.x + s.w && y + h / 2 > s.y && y - h / 2 < s.y + s.h;
  });

  for (const map of maps) {
    const badPickups = (map.pickups ?? []).filter((pk) => blockingAt(map, pk.x, pk.y, 8, 8));
    check(`${map.id}: no pickup is buried in a wall`, badPickups.length === 0,
      badPickups.map((p) => `(${p.x},${p.y} ${p.type})`).join(', '));

    const unreachable = (map.pickups ?? []).filter((pk) => {
      for (let dy = -90; dy <= 90; dy += 4) {
        if (!blockingAt(map, pk.x, pk.y + dy, playerW, playerH)) return false;
      }
      return true;
    });
    check(`${map.id}: every pickup can be reached by a player`, unreachable.length === 0,
      unreachable.map((p) => `(${p.x},${p.y} ${p.type})`).join(', '));

    const badSpawns = (map.spawnPoints ?? []).filter((sp) => blockingAt(map, sp.x, sp.y, playerW, playerH));
    check(`${map.id}: no spawn point is inside geometry`, badSpawns.length === 0,
      badSpawns.map((s) => `(${s.x},${s.y})`).join(', '));

    const unknownWeapons = (map.pickups ?? [])
      .filter((p) => p.type === 'weapon' && !weaponById.has(p.weapon));
    check(`${map.id}: weapon pickups reference real weapons`, unknownWeapons.length === 0,
      unknownWeapons.map((p) => p.weapon).join(', '));

    const inBounds = (map.pickups ?? []).every((p) => p.x > 0 && p.x < map.size.width && p.y > 0 && p.y < map.size.height);
    check(`${map.id}: pickups are inside the arena bounds`, inBounds);

    // ---- capture-the-flag bases. Each one is authored as a team spawn point,
    // so the checks below are the same reachability guarantees as spawns, plus
    // the requirement that both teams actually have somewhere to defend.
    const bases = Object.entries(map.flagBases ?? {}).filter(([k]) => !k.startsWith('$'));
    const badBases = bases.filter(([, b]) => blockingAt(map, b.x, b.y, playerW, playerH));
    check(`${map.id}: no flag base is buried in geometry`, badBases.length === 0,
      badBases.map(([t, b]) => `${t}(${b.x},${b.y})`).join(', '));

    const unreachableBases = bases.filter(([, b]) => {
      for (let dy = -90; dy <= 90; dy += 4) {
        if (!blockingAt(map, b.x, b.y + dy, playerW, playerH)) return false;
      }
      return true;
    });
    check(`${map.id}: every flag base can be reached by a player`, unreachableBases.length === 0,
      unreachableBases.map(([t, b]) => `${t}(${b.x},${b.y})`).join(', '));

    const baseTeams = bases.map(([t]) => t);
    check(`${map.id}: has a red and a blue flag base`, baseTeams.includes('red') && baseTeams.includes('blue'),
      baseTeams.join(',') || 'none');
  }
}

section('match flow');
{
  const match = new Match({ mapId: 'foundry', modeId: 'tdm', seed: 99 });
  check('starts in lobby', match.state === 'lobby');
  match.addPlayer('a', { name: 'Alpha', character: 'recruit' });
  check('one player is enough to arm the countdown', match.players.size === 1);
  run(match, Math.ceil((T.match.warmupCountdownSeconds + 0.2) * T.tickRate));
  check('auto-starts after the warmup countdown', match.state === 'playing', `state=${match.state}`);
  const a = match.players.get('a');
  check('spawned on a team', a.team === 'red' || a.team === 'blue', `team=${a.team}`);
  check('player is alive after spawn', a.alive === true);
  check('player spawns with full health', a.hp === T.player.maxHealth);
  check('player received the spawn loadout', a.slots[0] === 'sidearm' && a.slots[1] === 'basher', JSON.stringify(a.slots));
  check('spawn point is not inside a wall', match.map.spawnPoints.length > 0);
}

section('movement');
{
  const { match, a } = freshMatch();
  const startX = a.x;
  match.setInput('a', input({ x: 1 }));
  run(match, 30);
  check('running right moves the player right', a.x > startX + 60, `x ${startX} -> ${a.x.toFixed(1)}`);
  check('player keeps facing the movement direction', a.facing === 1);

  match.setInput('a', input({ x: -1 }));
  run(match, 30);
  check('running left moves the player left', a.x < 450, `x=${a.x.toFixed(1)}`);
  check('facing flips with direction', a.facing === -1);
}

section('gravity, jumping and jetpack');
{
  const { match, a } = freshMatch();
  place(a, 400, 800);
  run(match, 90);
  check('lands on the ground under gravity', a.onGround === true, `y=${a.y.toFixed(1)} vy=${a.vy.toFixed(1)}`);

  const groundY = a.y;
  match.setInput('a', input({ jump: true }));
  match.step(DT);
  check('jump gives upward velocity', a.vy < 0, `vy=${a.vy.toFixed(1)}`);

  const fuelBefore = a.jetFuel;
  run(match, 40);
  check('jetpack burns fuel', a.jetFuel < fuelBefore, `${fuelBefore.toFixed(1)} -> ${a.jetFuel.toFixed(1)}`);
  check('jetpack climbs above the ground line', a.y < groundY - 40, `y ${groundY.toFixed(1)} -> ${a.y.toFixed(1)}`);

  match.setInput('a', input({}));
  run(match, 300);
  check('fuel recharges back to full on the ground', a.jetFuel >= 99, `fuel=${a.jetFuel.toFixed(1)}`);
  check('falls back down and lands', a.onGround === true, `y=${a.y.toFixed(1)}`);

  // Holding the button at zero fuel must not let you hover indefinitely.
  const { match: m2, a: a2 } = freshMatch();
  place(a2, 400, 700);
  m2.setInput('a', input({ jump: true, jet: true }));
  run(m2, 400);
  check('holding the jet at zero fuel does not hover forever', a2.onGround === true, `y=${a2.y.toFixed(1)} fuel=${a2.jetFuel.toFixed(1)}`);
}

section('shooting and damage');
{
  const { match, a, b } = freshMatch();
  shootAt(match, a, b, 90);
  check('bullets damage the target', b.hp < T.player.maxHealth, `hp=${b.hp}`);
  check('the shooter registers shots', a.stats.shots > 0, `shots=${a.stats.shots}`);
  check('the shooter registers a hit', a.stats.hits > 0, `hits=${a.stats.hits}`);
  check('aim angle points at the target', Math.abs(a.aim) < 0.35, `aim=${a.aim.toFixed(3)} a.y=${a.y.toFixed(1)} b.y=${b.y.toFixed(1)}`);
  check('the gun consumes ammo', a.ammo.sidearm.mag < 12, `mag=${a.ammo.sidearm.mag}`);

  const events = match.drainEvents() ?? [];
  check('impact events are emitted', events.some((e) => e.type === 'impact'));
  check('hit markers are sent to the shooter', events.some((e) => e.type === 'hitMark' && e.to === 'a'));
}

section('walls stop bullets');
{
  const { match, a, b } = freshMatch();
  // The centre block of Arena Core sits between these two.
  place(a, 1000, 1016);
  place(b, 1400, 1016);
  shootAt(match, a, b, 90);
  check('a wall blocks the shot', b.hp === T.player.maxHealth, `hp=${b.hp}`);
}

section('kill, scoring and respawn');
{
  const { match, a, b } = freshMatch();
  shootAt(match, a, b, 600);
  check('shooter gets the kill', a.kills === 1, `kills=${a.kills} hp=${b.hp.toFixed(1)}`);
  check('victim is marked dead', b.alive === false);
  check('victim death counter increments', b.deaths === 1);
  check('shooter score increments', a.score === 1, `score=${a.score}`);
  check('shooter streak is tracked', a.streak === 1);

  const events = match.drainEvents() ?? [];
  const kill = events.find((e) => e.type === 'kill');
  check('a kill event is emitted', !!kill);
  check('kill event credits the killer', kill?.killer === 'a');
  check('kill event names the weapon', kill?.weapon === 'sidearm', `weapon=${kill?.weapon}`);

  run(match, Math.ceil((T.player.respawnSeconds + 0.1) * T.tickRate) + 2);
  check('victim respawns after the timer', b.alive === true, `alive=${b.alive}`);
  check('respawn restores full health', b.hp === T.player.maxHealth);
  check('respawn hands out the starting loadout again', b.slots[0] === 'sidearm');
}

section('weapon switching, reloading and ammo');
{
  const { match, a } = freshMatch();
  a.ammo.sidearm.mag = 1;
  a.ammo.sidearm.reserve = 24;

  match.setInput('a', input({ fire: true }));
  run(match, 20);
  check('magazine empties as shots are fired', a.ammo.sidearm.mag === 0, `mag=${a.ammo.sidearm.mag}`);
  check('an empty magazine triggers a reload', a.reloadEnd > 0, `reloadEnd=${a.reloadEnd.toFixed(2)}`);

  match.setInput('a', input({})); // stop firing so the reload is not undone by new shots
  run(match, 90);
  check('reload refills the magazine from reserve', a.ammo.sidearm.mag === 12, `mag=${a.ammo.sidearm.mag}`);
  check('reserve is spent by the reload', a.ammo.sidearm.reserve === 12, `reserve=${a.ammo.sidearm.reserve}`);

  match.setInput('a', input({ actions: ['switch:1'] }));
  match.step(DT);
  check('switch action changes weapon slot', a.slot === 1, `slot=${a.slot}`);
  check('melee weapon has no ammo counter', a.ammo.basher === undefined);

  match.setInput('a', input({ actions: ['switch:0'] }));
  match.step(DT);
  check('switching back selects the primary', a.slot === 0 && a.slots[0] === 'sidearm');

  a.ammo.sidearm.mag = 0;
  a.ammo.sidearm.reserve = 0;
  match.setInput('a', input({ actions: ['reload'] }));
  match.step(DT);
  check('reloading with no reserve does nothing', a.reloadEnd === 0);
}

section('melee');
{
  const { match, a, b } = freshMatch();
  place(a, 300, 1016);
  place(b, 330, 1016);
  match.setInput('a', input({ aimX: b.x, aimY: b.y }));
  match.step(DT);
  const before = b.hp;
  match.setInput('a', input({ aimX: b.x, aimY: b.y, actions: ['melee'] }));
  match.step(DT);
  check('melee switches to the melee slot', a.slot === 1, `slot=${a.slot}`);
  check('melee damages a target inside the cone', b.hp < before, `hp ${before} -> ${b.hp}`);

  const { match: m2, a: a2, b: b2 } = freshMatch();
  place(a2, 300, 1016);
  place(b2, 620, 1016);
  m2.setInput('a', input({ aimX: b2.x, aimY: b2.y }));
  m2.step(DT);
  m2.setInput('a', input({ aimX: b2.x, aimY: b2.y, actions: ['melee'] }));
  m2.step(DT);
  check('melee misses a target out of range', b2.hp === T.player.maxHealth, `hp=${b2.hp}`);
  check('melee cooldown is applied', a2.meleeCooldown > 0, `cd=${a2.meleeCooldown.toFixed(2)}`);
}

section('grenades and explosions');
{
  const { match, a, b } = freshMatch();
  place(a, 300, 1016);
  place(b, 380, 1016);
  const grenadesBefore = a.grenades;

  // Throw straight down at our own feet so the blast lands somewhere predictable.
  match.setInput('a', input({ aimX: a.x, aimY: a.y + 220, actions: ['grenade'] }));
  match.step(DT);
  check('throwing spends a grenade', a.grenades === grenadesBefore - 1, `grenades=${a.grenades}`);
  const grenade = match.bullets.find((x) => x.kind === 'grenade');
  check('a grenade projectile exists', !!grenade);
  check('grenade carries an explosion payload', !!grenade?.explode);
  check('grenade has gravity and bounce', grenade?.gravityScale === 1 && grenade?.bounciness > 0);

  const aHp = a.hp;
  const bHp = b.hp;
  run(match, Math.ceil((T.grenades.fuseSeconds + 0.3) * T.tickRate));
  check('grenade damages a nearby player', b.hp < bHp, `hp ${bHp} -> ${b.hp.toFixed(1)}`);
  check('self damage is scaled down but present', a.hp < aHp && a.hp > b.hp, `a=${a.hp.toFixed(1)} b=${b.hp.toFixed(1)}`);
  check('grenade is removed after exploding', !match.bullets.some((x) => x.kind === 'grenade'));
  check('an explosion event is emitted', match.events.some((e) => e.type === 'explosion'));

  // Grenades recharge one at a time: one full interval per grenade.
  const { match: m2, a: a2 } = freshMatch();
  a2.grenades = 0;
  a2.grenadeTimer = 0;
  run(m2, Math.ceil((T.grenades.rechargeSeconds + 0.3) * T.tickRate));
  check('one grenade recharges per interval', a2.grenades === 1, `grenades=${a2.grenades}`);
  run(m2, Math.ceil(T.grenades.rechargeSeconds * T.tickRate));
  check('grenades recharge back to the carried maximum', a2.grenades === T.grenades.maxCarried, `grenades=${a2.grenades}`);
}

section('spawn protection');
{
  const { match, a, b } = freshMatch();
  place(a, 620, 1016);
  place(b, 300, 1016);

  // Control: unprotected, the shots must land.
  shootAt(match, b, a, 40);
  check('control: unprotected target takes damage', a.hp < T.player.maxHealth, `hp=${a.hp}`);

  // Now give the target spawn protection.
  a.hp = T.player.maxHealth;
  a.spawnProtectUntil = match.time + 5;
  shootAt(match, b, a, 40);
  check('protected spawn takes no damage', a.hp === T.player.maxHealth, `hp=${a.hp}`);

  // Firing your own weapon drops the shield.
  a.spawnProtectUntil = match.time + 5;
  match.setInput('a', input({ fire: true, aimX: a.x + 100, aimY: a.y }));
  match.step(DT);
  check('firing cancels your own spawn protection', a.spawnProtectUntil === 0);
}

section('pickups');
{
  const { match, a } = freshMatch();
  const health = match.pickups.find((p) => p.type === 'health');
  place(a, health.x, health.y);
  a.hp = 40;
  run(match, 3);
  check('walking into a health pickup heals', a.hp > 40, `hp=${a.hp}`);
  check('the pickup is deactivated after use', match.pickups.find((p) => p.id === health.id).active === false);

  const weaponPickup = match.pickups.find((p) => p.type === 'weapon' && p.weaponId === 'longshot');
  const { match: m2, a: a2 } = freshMatch();
  const target = m2.pickups.find((p) => p.id === weaponPickup.id);
  place(a2, target.x, target.y);
  run(m2, 3);
  check('weapon pickups swap the primary weapon', a2.slots[0] === 'longshot', `slots=${a2.slots.join(',')}`);
  check('the new weapon arrives loaded', a2.ammo.longshot?.mag === 5, `mag=${a2.ammo.longshot?.mag}`);

  // Respawning pickups.
  const { match: m3 } = freshMatch();
  const pk = m3.pickups.find((p) => p.type === 'health');
  pk.active = false;
  pk.respawnAt = m3.time + T.pickups.respawnSeconds;
  run(m3, Math.ceil((T.pickups.respawnSeconds + 0.2) * T.tickRate));
  check('pickups respawn after their cooldown', pk.active === true);
}

section('friendly fire rules in team modes');
{
  const { match, a, b } = freshMatch('tdm');
  a.team = 'red';
  b.team = 'red';
  shootAt(match, a, b, 60);
  check('teammates cannot damage each other', b.hp === T.player.maxHealth, `hp=${b.hp}`);

  const { match: m2, a: a2, b: b2 } = freshMatch('dm');
  m2.players.get('a').team = 'ffa';
  m2.players.get('b').team = 'ffa';
  shootAt(m2, a2, b2, 90);
  check('free-for-all has no friendly fire rule', b2.hp < T.player.maxHealth, `hp=${b2.hp}`);
}

section('respawn placement');
{
  const { match, a, b } = freshMatch('tdm');
  a.team = 'red';
  b.team = 'blue';
  match.spawn(b);
  check('spawn puts the player at a spawn point', match.map.spawnPoints.some((s) => Math.abs(s.x - b.x) < 1 && Math.abs(s.y - b.y) < 1));
  check('spawned player is alive and protected', b.alive && b.spawnProtectUntil > match.time);
}

section('team deathmatch scoring and match end');
{
  const { match, a, b } = freshMatch('tdm');
  a.team = 'red';
  b.team = 'blue';
  match.scores.red = T.match.scoreLimit;
  match.step(DT);
  check('match ends when a team reaches the score limit', match.state === 'ended', `state=${match.state}`);
  check('the leading team is declared the winner', match.winner === 'red', `winner=${match.winner}`);
  check('scoreboard lists every player', match.scoreboard().length === 2);
  run(match, Math.ceil((T.match.postMatchSeconds + 0.2) * T.tickRate));
  check('match returns to the lobby afterwards', match.state === 'lobby', `state=${match.state}`);
}

section('capture the flag');
{
  const goal = T.ctf?.captureLimit ?? 3;

  // ---- rules that only apply to the flag mode
  const { match, a, b } = freshMatch('ctf');
  a.team = 'red';
  b.team = 'blue';

  check('ctf builds one flag per team', match.flags.length === 2, `flags=${match.flags.length}`);
  check('flags start at their own bases',
    match.flags.every((f) => f.atBase && f.carrier === null && f.x === f.baseX && f.y === f.baseY));
  check('ctf team score starts at zero', match.scores.red === 0 && match.scores.blue === 0);
  check('the ctf goal is the capture limit', match.scoreGoal() === goal, `goal=${match.scoreGoal()}`);

  // ---- taking the enemy flag
  const blueFlag = match.flagOf('blue');
  place(a, blueFlag.baseX, blueFlag.baseY);
  match.step(DT);
  check('touching the enemy flag picks it up', blueFlag.carrier === 'a', `carrier=${blueFlag.carrier}`);
  check('a taken flag leaves its base', blueFlag.atBase === false);
  check('taking a flag emits an event', match.events.some((e) => e.type === 'flag' && e.action === 'taken'));

  a.x = 1500;
  a.y = 900;
  match.step(DT);
  check('a carried flag rides with its carrier',
    Math.abs(blueFlag.x - 1500) < 3 && Math.abs(blueFlag.y - 900) < 3, `flag=(${blueFlag.x},${blueFlag.y})`);

  // ---- classic rule: you cannot score while your own flag is away
  const redFlag = match.flagOf('red');
  match.takeFlag(redFlag, b);
  let before = match.scores.red;
  place(a, redFlag.baseX, redFlag.baseY);
  match.step(DT);
  check('no capture while your own flag is away', match.scores.red === before, `score=${match.scores.red}`);

  match.returnFlag(redFlag, 'test');
  place(a, redFlag.baseX, redFlag.baseY);
  match.step(DT);
  check('capturing scores for your team', match.scores.red === before + 1, `score=${match.scores.red}`);
  check('the captured flag goes home', blueFlag.atBase === true && blueFlag.carrier === null);
  check('a capture emits an event', match.events.some((e) => e.type === 'capture' && e.team === 'red'));

  // ---- dropping and self-returning
  match.takeFlag(match.flagOf('blue'), a);
  a.x = 1200;
  a.y = 900;
  match.step(DT);
  check('a player can carry again after a capture', match.flagOf('blue').carrier === 'a');
  match.kill(a, 'b', 'sidearm');
  const dropped = match.flagOf('blue');
  check('dying drops the flag', dropped.carrier === null && dropped.atBase === false, `carrier=${dropped.carrier}`);
  check('the flag drops where the body fell', Math.abs(dropped.x - 1200) < 4, `x=${dropped.x}`);
  check('a dropped flag is scheduled to return', dropped.returnAt > match.time);

  match.time = dropped.returnAt + 0.01;
  match.step(DT);
  check('a dropped flag returns home on the clock', match.flagOf('blue').atBase === true);

  // ---- walking into your own loose flag returns it
  const loose = match.flagOf('red');
  match.putFlagHome(loose);
  loose.atBase = false;
  loose.carrier = null;
  loose.x = 1000;
  loose.y = 800;
  loose.returnAt = match.time + 20;
  place(a, 1000, 800);
  match.step(DT);
  check('touching your own loose flag returns it', match.flagOf('red').atBase === true);

  // ---- kills must not win a flag match
  const k = freshMatch('ctf');
  k.a.team = 'red';
  k.b.team = 'blue';
  const teamBefore = k.match.scores.red;
  k.match.kill(k.b, k.a.id, 'sidearm');
  check('a kill does not move the ctf team score', k.match.scores.red === teamBefore, `score=${k.match.scores.red}`);
  check('a kill still scores for the individual', k.a.score > 0, `score=${k.a.score}`);

  // ---- win condition
  const win = freshMatch('ctf');
  win.match.scores.red = goal - 1;
  win.match.step(DT);
  check('ctf does not end below the capture limit', win.match.state === 'playing', `state=${win.match.state}`);
  win.match.scores.red = goal;
  win.match.step(DT);
  check('ctf ends at the capture limit', win.match.state === 'ended', `state=${win.match.state}`);
  check('the team with the captures wins', win.match.winner === 'red', `winner=${win.match.winner}`);
  check('the snapshot reports the capture goal', win.match.snapshot().scoreLimit === goal);

  // ---- other modes are unaffected
  const dm = freshMatch('dm').match;
  check('deathmatch builds no flags', dm.flags.length === 0, `flags=${dm.flags.length}`);
  check('deathmatch keeps the kill score limit', dm.scoreGoal() === T.match.scoreLimit, `goal=${dm.scoreGoal()}`);
  check('the snapshot always carries a flags array', Array.isArray(dm.snapshot().flags));
  const tdm = freshMatch('tdm').match;
  check('team deathmatch builds no flags', tdm.flags.length === 0);
  check('team deathmatch still scores team kills', tdm.scoreGoal() === T.match.scoreLimit);
}

section('time limit');
{
  const { match } = freshMatch();
  match.timeLeft = 0.01;
  match.step(DT);
  check('match ends when the clock runs out', match.state === 'ended');
  check('end reason is recorded as time', match.endReason === 'time', `reason=${match.endReason}`);
}

section('mode and map switching');
{
  const { match } = freshMatch();
  check('switching to an unknown map is refused', match.setMap('nope') === false);
  check('a refused switch leaves the map alone', match.mapId === 'arena_core', `mapId=${match.mapId}`);
  check('switching to a real map works', match.setMap('caverns') === true && match.mapId === 'caverns');
  check('a map switch returns the room to the lobby', match.state === 'lobby');
  check('switching to the current map is a no-op', match.setMap('caverns') === false);
  check('unknown modes are refused', match.setMode('nope') === false);
  check('mode switch works', match.setMode('tdm') === true && match.mode.id === 'tdm');
  check('the new map geometry is loaded', match.map.id === 'caverns');
}

section('mode switch team hygiene');
{
  // Teams are decided when a player joins, so switching a room from a
  // free-for-all mode into a team mode has to re-seat everyone. Without that a
  // player keeps the sentinel team "ffa", which is not cosmetic: friendly fire is
  // decided by `a.team === b.team`, kills are credited to `scores[a.team]`, spawn
  // points are filtered by team, and in capture the flag `p.team === flag.team` is
  // what makes a capture legal.
  const { match, a, b } = freshMatch();
  check('free-for-all players start on the sentinel team', a.team === 'ffa' && b.team === 'ffa',
    `a=${a.team} b=${b.team}`);

  match.setMode('tdm');
  check('a switch into a team mode seats both players on red or blue',
    (a.team === 'red' || a.team === 'blue') && (b.team === 'red' || b.team === 'blue'),
    `a=${a.team} b=${b.team}`);
  check('the re-seated players are on opposite sides', a.team !== b.team, `a=${a.team} b=${b.team}`);

  // The consequence that matters: a kill must move the team score. Before the
  // fix `scores[killer.team]` wrote into `scores.ffa`, which `snapshot()` never
  // reads in a team mode — so the scoreboard stuck at 0-0 and only the clock
  // could ever end the match.
  match.startMatch();
  place(a, 300, 1016);
  place(b, 620, 1016);
  match.time = 10;
  shootAt(match, a, b, 120);
  check('a kill in the re-seated mode kills the enemy', b.alive === false, `hp=${b.hp}`);
  check('the kill credits the killer team, not a free-for-all bucket',
    match.scores[a.team] > 0 && Number.isFinite(match.scores[a.team]),
    `scores=${JSON.stringify(match.scores)}`);
  check('the other team is untouched', match.scores[b.team] === 0);
  check('team kills never leak into a free-for-all bucket', match.scores.ffa === undefined,
    `ffa=${match.scores.ffa}`);
  check('the score is visible to clients', match.snapshot().scores[a.team] > 0);

  // And the reverse: a team label must not survive into a free-for-all mode.
  check('a switch back to free-for-all drops the team labels', match.setMode('dm') === true);
  check('free-for-all players are back on the sentinel team', a.team === 'ffa' && b.team === 'ffa',
    `a=${a.team} b=${b.team}`);

  // Capture the flag is the case where a stale team label is fatal rather than
  // merely confusing: nobody could ever capture.
  const ctf = freshMatch().match;
  const ca = ctf.players.get('a');
  const cb = ctf.players.get('b');
  ctf.setMode('ctf');
  check('a switch into ctf seats both players on a team',
    (ca.team === 'red' || ca.team === 'blue') && (cb.team === 'red' || cb.team === 'blue'),
    `a=${ca.team} b=${cb.team}`);
  check('the two ctf players are on opposite sides', ca.team !== cb.team);
  check('ctf keeps its own flag on each side after the switch',
    ctf.flags.length === 2 && ctf.flagOf(ca.team) !== null && ctf.flagOf(cb.team) !== null,
    `${ctf.flags.length} flags`);
}

section('match formats, roles and gravity mutators');
{
  const duel = new Match({ mapId: 'arena_core', modeId: 'tdm', format: '1v1', seed: 51 });
  const raider = duel.addPlayer('raider', { name: 'Raider', role: 'raider', team: 'red' });
  const scout = duel.addPlayer('scout', { name: 'Scout', role: 'scout', team: 'blue' });
  check('1v1 is first to 10 with a three-minute clock',
    duel.scoreGoal() === 10 && duel.timeLimitSeconds() === 180,
    `goal=${duel.scoreGoal()} time=${duel.timeLimitSeconds()}`);
  check('Raider is the default role profile', raider.roleId === 'raider' && raider.maxHealth === 100);
  check('role mode applies the selected Scout profile',
    scout.roleId === 'scout' && scout.maxHealth === T.roles.scout.maxHealth && scout.runSpeed === T.roles.scout.runSpeed);
  check('role-free switches every player to the shared Attacker profile', duel.setRoleMode('free'));
  check('role-free players have the same attacker stats',
    raider.roleId === 'attacker' && scout.roleId === 'attacker' &&
      raider.maxHealth === scout.maxHealth && raider.runSpeed === scout.runSpeed);
  check('roles can be re-enabled and restore the saved role choices', duel.setRoleMode('roles'));
  check('saved roles return when role mode is restored', raider.roleId === 'raider' && scout.roleId === 'scout');

  const duo = new Match({ modeId: 'tdm', format: '2v2', seed: 52 });
  check('2v2 has four slots and its own score/time limits',
    T.matchFormats['2v2'].maxPlayers === 4 && duo.scoreGoal() === 25 && duo.timeLimitSeconds() === 300);
  const squad = new Match({ modeId: 'tdm', format: '4v4', roleMode: 'free', gravityMode: 'zero', seed: 53 });
  check('4v4 has eight slots and scores team eliminations',
    T.matchFormats['4v4'].maxPlayers === 8 && squad.mode.teamScoreFromKills !== false);
  check('the role-free squad is configured as attackers', squad.roleMode === 'free');
  check('zero-g uses the configured inverted gravity scale', squad.gravityScale < 0);
  const snap = squad.snapshot();
  check('snapshot publishes format, role mode and gravity mode',
    snap.format === '4v4' && snap.roleMode === 'free' && snap.gravityMode === 'zero' && snap.gravityScale < 0);

  const bodyForGravity = (gravityScale) => ({
    x: 1200, y: 500, vx: 0, vy: 0, w: 30, h: 46,
    onGround: false, jumpHeld: false, jetFuel: 0, jetIdle: 1,
    facing: 1, aim: 0, gravityScale,
  });
  const normal = bodyForGravity(T.gravityModes.normal);
  const lunar = bodyForGravity(T.gravityModes.lunar);
  const zero = bodyForGravity(T.gravityModes.zero);
  for (const body of [normal, lunar, zero]) stepPlayerMovement(body, input(), 1 / T.tickRate, T, []);
  check('lunar gravity reduces the first-tick fall', lunar.vy > 0 && lunar.vy < normal.vy,
    `normal=${normal.vy} lunar=${lunar.vy}`);
  check('zero-g gravity reverses the first-tick fall into upward drift', zero.vy < 0,
    `zero=${zero.vy}`);
}

section('protocol surface');
{
  const { match } = freshMatch();
  const snap = match.snapshot();
  check('snapshot has a tick and time', typeof snap.tick === 'number' && typeof snap.time === 'number');
  check('snapshot carries every player', snap.players.length === 2);
  const me = snap.players.find((p) => p.i === 'a');
  const fields = ['x', 'y', 'hp', 'fl', 'a', 'w', 'm', 'rr', 'j', 'g', 'k', 'd', 'sc'];
  check('snapshot fields are all present', fields.every((k) => k in me));
  check('snapshot includes pickup state', Array.isArray(snap.pickups) && snap.pickups.length > 0);
  check('alive flag is set for a living player', (me.fl & 1) !== 0, `fl=${me.fl}`);
  check('snapshot is JSON-serialisable', typeof JSON.stringify(snap) === 'string');
  check('roster mirrors the players', match.roster().players.length === 2);
  check('snapshot is compact enough for 20 Hz', JSON.stringify(snap).length < 4000, `${JSON.stringify(snap).length} bytes`);
}

section('input hardening');
{
  const { match, a } = freshMatch();
  match.setInput('a', input({ seq: 5000 }));
  const staleSeq = a.input.seq;
  match.setInput('a', input({ seq: 10 }));
  check('stale input frames are ignored', a.input.seq === staleSeq, `seq=${a.input.seq}`);

  match.setInput('a', input({ actions: ['explode', 'switch:9', 'reload'] }));
  match.step(DT);
  check('unknown actions are dropped by the server', a.slot === 0 || a.slot === 1);

  match.setInput('a', input({ x: 9999 }));
  match.step(DT);
  check('normalised input keeps movement in range', true);
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
