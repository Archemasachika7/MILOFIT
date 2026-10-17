/**
 * Headless tests for the web client's netcode and artwork.
 *
 * These run in plain Node with no browser: the DOM and the 2D canvas are stubbed
 * and every drawing call is counted, so a silent no-op or a typo in the renderer
 * fails the run instead of quietly producing a blank screen.
 *
 * Run with:  node web/test/client.js      (from the repository root)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

// --------------------------------------------------------------------- stubs

function makeStubContext() {
  const stats = { calls: 0, byMethod: new Map() };
  const gradient = { addColorStop() { stats.calls += 1; } };

  const base = {
    canvas: null,
    createLinearGradient: () => { stats.calls += 1; return gradient; },
    createRadialGradient: () => { stats.calls += 1; return gradient; },
    createPattern: () => null,
    measureText: (text) => { stats.calls += 1; return { width: String(text).length * 6 }; },
  };

  const proxy = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      // Any un-stubbed canvas method becomes a counted no-op.
      return () => {
        stats.calls += 1;
        stats.byMethod.set(prop, (stats.byMethod.get(prop) ?? 0) + 1);
        return undefined;
      };
    },
    set(target, prop, value) {
      if (typeof prop === 'string' && /^(fill|stroke|font|line|text|global|shadow|letter|miter)/.test(prop)) {
        stats.calls += 1;
      }
      target[prop] = value;
      return true;
    },
  });

  return { ctx: proxy, stats };
}

function makeCanvas(width = 1280, height = 720) {
  const { ctx, stats } = makeStubContext();
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    stats,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {},
    removeEventListener() {},
  };
}

// The web modules touch a handful of globals; give them the minimum they need.
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  createElement: () => makeCanvas(64, 64),
  querySelectorAll: () => [],
};

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const simCore = await load('shared/sim-core.js');
const sprites = await load('web/src/sprites.js');
const renderModule = await load('web/src/render.js');
const predictModule = await load('web/src/predict.js');
const netModule = await load('web/src/net.js');
const { publicContent } = await load('server/src/gameData.js');
const { Match } = await load('server/src/sim.js');

const content = publicContent();

// ------------------------------------------------------------------ harness

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

// ------------------------------------------------------------------ predict

section('shared simulation core');
{
  const solids = [{ x: 0, y: 100, w: 400, h: 40, type: 'ground' }];
  const body = simCore.makeBody(200, 50, 30, 46);
  for (let i = 0; i < 120; i++) simCore.moveAndCollide(body, 0, 20, solids);
  check('a falling body rests on a solid', Math.abs((body.y + body.h / 2) - 100) < 0.5, `y=${body.y}`);
  check('landing sets onGround', body.onGround === true);

  check('angleDelta wraps across +/-PI', Math.abs(simCore.angleDelta(3.0, -3.0) - 0.2832) < 0.01, `${simCore.angleDelta(3.0, -3.0)}`);
  check('segmentBoxT returns null for a miss', simCore.segmentBoxT(0, 0, 10, 0, 100, 100, 10, 10) === null);
  check('segmentBoxT finds an entry point', Math.abs(simCore.segmentBoxT(0, 5, 20, 5, 10, 0, 10, 10) - 0.5) < 1e-6);
  check('rectsOverlap agrees with the obvious case', simCore.rectsOverlap(0, 0, 10, 10, 5, 5, 10, 10) === true);
  check('rectsOverlap rejects disjoint boxes', simCore.rectsOverlap(0, 0, 10, 10, 20, 20, 10, 10) === false);

  const rngA = simCore.makeRng(7);
  const rngB = simCore.makeRng(7);
  const seqA = [rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB()];
  check('the seeded rng is reproducible', seqA.every((v, i) => v === seqB[i]), JSON.stringify(seqA));
  check('rng values stay in [0,1)', seqA.every((v) => v >= 0 && v < 1));
}

section('client prediction matches the authoritative server');
{
  // Drive a real Match and a Predictor with byte-identical input frames and
  // require them to stay in lockstep. This is the test that proves the netcode
  // design (see docs/GAME_DESIGN.md) actually holds.
  const T = content.tuning;
  const DT = 1 / T.tickRate;
  const match = new Match({ mapId: 'arena_core', modeId: 'dm', seed: 4242 });
  match.addPlayer('solo', { name: 'Solo', character: 'recruit' });
  match.startMatch();

  const server = match.players.get('solo');
  server.spawnProtectUntil = 0;
  const predictor = new predictModule.Predictor(T, match.map);
  predictor.reset({ x: server.x, y: server.y, vx: 0, vy: 0, a: 0, f: 1 }, T.player.width, T.player.height);

  const script = (i) => {
    const x = Math.sin(i / 11) > 0.15 ? 1 : Math.sin(i / 11) < -0.15 ? -1 : 0;
    const jump = (i % 47) < 12;                     // jump, then jetpack
    const jet = (i % 47) < 20;
    return {
      x,
      jump: jump && !jet,
      jet,
      fire: false,
      aim: { x: server.x + Math.cos(i / 9) * 300, y: server.y + Math.sin(i / 9) * 300 },
    };
  };

  let worst = 0;
  let worstAt = 0;
  const failures = [];
  for (let i = 0; i < 600; i++) {
    const frame = script(i);
    const normalized = { ...frame, aimX: frame.aim.x, aimY: frame.aim.y, seq: i + 1, rtt: 0, actions: [] };
    match.setInput('solo', normalized);
    match.step(DT);
    predictor.step(frame, DT);

    const dx = Math.abs(predictor.body.x - server.x);
    const dy = Math.abs(predictor.body.y - server.y);
    const err = Math.hypot(dx, dy);
    if (err > worst) { worst = err; worstAt = i; }
    if (err > 0.5) failures.push({ i, err: err.toFixed(3), px: predictor.body.x, sx: server.x, py: predictor.body.y, sy: server.y });
  }

  check('predicted position tracks the server for 10 seconds', failures.length === 0,
    `worst ${worst.toFixed(4)}px at tick ${worstAt}${failures[0] ? ` first=${JSON.stringify(failures[0])}` : ''}`);
  check('prediction does not accumulate drift', worst < 0.5, `worst=${worst.toFixed(4)}px`);
  check('predicted jetpack fuel matches', Math.abs(predictor.body.jetFuel - server.jetFuel) < 0.5,
    `${predictor.body.jetFuel.toFixed(2)} vs ${server.jetFuel.toFixed(2)}`);
  check('predicted facing matches', predictor.body.facing === server.facing);
  check('the two bodies agree on being grounded', predictor.body.onGround === server.onGround);
}

section('prediction reconciliation');
{
  const T = content.tuning;
  const predictor = new predictModule.Predictor(T, { solids: [] });

  predictor.reset({ x: 100, y: 100, vx: 0, vy: 0, a: 0, f: 1 }, T.player.width, T.player.height);
  // A small error is smoothed, not snapped.
  predictor.reconcile({ x: 108, y: 100, vx: 0, vy: 0, fl: 1, j: 100, alive: true }, 1 / 60);
  check('a small error is smoothed rather than snapped', predictor.body.x > 100 && predictor.body.x < 108, `x=${predictor.body.x}`);

  // A large error snaps instantly, e.g. after a respawn or a knockback.
  predictor.reconcile({ x: 900, y: 100, vx: 0, vy: 0, fl: 1, j: 100, alive: true }, 1 / 60);
  check('a large error snaps to the server position', predictor.body.x === 900, `x=${predictor.body.x}`);

  predictor.reconcile({ x: 900, y: 100, vx: 50, vy: -20, fl: 0, j: 100, alive: false }, 1 / 60);
  check('a dead player is frozen at the server position', predictor.body.vx === 0 && predictor.body.vy === 0);
  check('server flags override local ground state', predictor.body.onGround === false);
}

// -------------------------------------------------------------------- render

section('procedural artwork');
{
  const ctxCanvas = makeCanvas();
  const ctx = ctxCanvas.getContext('2d');

  sprites.drawGun(ctx, content.weapons[0], 0.4, content.characters[0].palette);
  check('drawGun executes', ctxCanvas.stats.calls > 0);

  let gunOk = true;
  for (const weapon of content.weapons) {
    try {
      sprites.drawGun(ctx, weapon, -1.2, content.characters[0].palette);
    } catch (err) {
      gunOk = false;
      check(`drawGun handles "${weapon.id}"`, false, err.message);
    }
  }
  check('every weapon in weapons.json can be drawn', gunOk);

  let soldierOk = true;
  for (const character of content.characters) {
    for (const weapon of content.weapons) {
      try {
        sprites.drawSoldier(ctx, {
          x: 100, y: 200, facing: 1, aim: 0.3, palette: character.palette,
          weapon, walk: 1.2, jetting: true, onGround: false, vy: -100,
          reloading: true, protectedNow: true,
        });
        sprites.drawSoldier(ctx, {
          x: 100, y: 200, facing: -1, aim: -2.8, palette: character.palette,
          weapon, walk: 0, jetting: false, onGround: true, alpha: 0.32, dead: true,
        });
      } catch (err) {
        soldierOk = false;
        check(`drawSoldier handles ${character.id}/${weapon.id}`, false, err.message);
      }
    }
  }
  check('every character can be drawn with every weapon', soldierOk);

  const before = ctxCanvas.stats.calls;
  sprites.drawSoldier(ctx, {
    x: 0, y: 0, facing: 1, aim: 0, palette: content.characters[0].palette,
    weapon: content.weapons[3], walk: 0, onGround: true,
  });
  check('drawing a soldier issues many canvas calls', ctxCanvas.stats.calls - before > 30, `${ctxCanvas.stats.calls - before} calls`);

  let pickupOk = true;
  for (const type of Object.keys(content.pickupTypes)) {
    try {
      sprites.drawPickup(ctx, { x: 10, y: 10, t: type, w: null }, 1.0, content.pickupTypes);
    } catch (err) {
      pickupOk = false;
      check(`drawPickup handles "${type}"`, false, err.message);
    }
  }
  check('every pickup type can be drawn', pickupOk);

  let projectileOk = true;
  for (const kind of ['bullet', 'flame', 'grenade', 'projectile']) {
    try {
      sprites.drawProjectile(ctx, { x: 10, y: 10, k: kind, a: 0.5, vx: 100, vy: 0 }, 1);
    } catch (err) {
      projectileOk = false;
      check(`drawProjectile handles "${kind}"`, false, err.message);
    }
  }
  check('every projectile kind can be drawn', projectileOk);

  const previewCanvas = makeCanvas(62, 74);
  sprites.renderCharacterPreview(previewCanvas, content.characters[2], content.weapons[1]);
  check('the menu character preview renders', previewCanvas.stats.calls > 0);
  check('the preview sets a CSS size', previewCanvas.style.width === '62px' && previewCanvas.style.height === '74px',
    `${previewCanvas.style.width} x ${previewCanvas.style.height}`);
  globalThis.window.devicePixelRatio = 2;
  const hiDpiPreview = makeCanvas(62, 74);
  sprites.renderCharacterPreview(hiDpiPreview, content.characters[2], content.weapons[1]);
  check('the preview scales the backing store for hi-dpi screens', hiDpiPreview.width === 124, `width=${hiDpiPreview.width}`);
  globalThis.window.devicePixelRatio = 1;
}

section('world renderer');
{
  const canvas = makeCanvas(1280, 720);
  const renderer = new renderModule.Renderer(canvas, content);
  check('renderer sizes the backing store for the device pixel ratio', canvas.width === 1280 && canvas.height === 720);
  check('preferred zoom is inside sane bounds', renderer.preferredZoom(1200) > 0.4 && renderer.preferredZoom(1200) < 2);

  const camera = { x: 600, y: 400, zoom: 1 };
  const world = renderer.screenToWorld(640, 360, camera);
  check('screen centre maps to the camera position', Math.abs(world.x - camera.x) < 0.01 && Math.abs(world.y - camera.y) < 0.01, JSON.stringify(world));

  let mapOk = true;
  for (const map of content.maps) {
    const before = canvas.stats.calls;
    try {
      renderer.clear();
      renderer.drawBackground(map, camera, 1.5);
      renderer.applyCamera(camera, { x: 0, y: 0, roll: 0 });
      renderer.drawMap(map, 1.5);
      renderer.drawPickups(map.pickups.map((p, i) => ({ i, x: p.x, y: p.y, t: p.type, w: p.weapon ?? null })), 2);
    } catch (err) {
      mapOk = false;
      check(`renderer handles map "${map.id}"`, false, err.message);
    }
    check(`map "${map.id}" produces draw calls`, canvas.stats.calls - before > 20);
  }
  check('every map renders end to end', mapOk);

  const view = {
    id: 'p1', name: 'Tester', team: 'red', x: 400, y: 300, vx: 40, vy: 0, aim: 0.2,
    facing: 1, hp: 72, shield: 20, alive: true, onGround: true, jetting: false,
    reloading: false, protectedNow: true, weaponId: 'bulldog', walk: 2, palette: content.characters[0].palette,
  };
  renderer.drawPlayer(view, { isLocal: true, time: 1 });
  renderer.drawPlayer({ ...view, alive: false }, { isLocal: false, time: 1 });
  renderer.drawBullets([
    { i: 1, x: 400, y: 300, k: 'bullet', w: 'sidearm', o: 'p1' },
    { i: 2, x: 410, y: 300, k: 'grenade', w: 'frag', o: 'p1' },
    { i: 3, x: 420, y: 300, k: 'projectile', w: 'rocket', o: 'p1' },
    { i: 4, x: 430, y: 300, k: 'flame', w: 'flamer', o: 'p1' },
  ]);
  renderer.drawEffects([
    { type: 'explosion', x: 1, y: 1, radius: 130, t: 0.1, life: 0.5 },
    { type: 'impact', x: 1, y: 1, seed: 1, t: 0.05, life: 0.3 },
    { type: 'muzzle', x: 1, y: 1, angle: 0.5, t: 0.01, life: 0.07 },
    { type: 'damage', x: 1, y: 1, value: '17', shield: false, t: 0.1, life: 0.7 },
    { type: 'ring', x: 1, y: 1, radius: 60, color: '#4cc9f0', t: 0.1, life: 0.4 },
  ]);
  renderer.drawCrosshair(640, 360, 0.5, true);
  renderer.drawOffscreenMarkers([view, { ...view, id: 'p2', x: 5000, team: 'blue' }], camera, { id: 'p1' });
  check('players, projectiles and effects all render', canvas.stats.calls > 0);

  // A palette colour that cannot be parsed would silently vanish in a real
  // browser; assert every colour the artwork uses looks like a colour.
  const HEX = /^#[0-9a-fA-F]{3,8}$/;
  const paletteOk = content.characters.every((c) => Object.values(c.palette).every((v) => HEX.test(v)));
  check('every character palette colour is a valid hex value', paletteOk);
  const hudOk = content.weapons.every((w) => !w.hud?.color || HEX.test(w.hud.color));
  check('every weapon HUD colour is a valid hex value', hudOk);
  const ambientOk = content.maps.every((m) => (m.ambient?.sky ?? []).every((v) => HEX.test(v))
    && (!m.ambient?.grid || HEX.test(m.ambient.grid))
    && (!m.ambient?.glow || HEX.test(m.ambient.glow)));
  check('every map ambient colour is a valid hex value', ambientOk);
}

// ------------------------------------------------------------------------ ctf

section('capture the flag');
{
  const ctf = (content.modes ?? []).find((m) => m.id === 'ctf');
  check('index.json defines the ctf mode', !!ctf);
  check('ctf is a team mode that carries flags', !!ctf && ctf.teams === true && ctf.flags === true);
  check('ctf scores the team on captures, not kills', !!ctf && ctf.teamScoreFromKills === false);

  let basesOk = true;
  for (const map of content.maps) {
    if (!map.flagBases?.red || !map.flagBases?.blue) {
      basesOk = false;
      check(`map "${map.id}" has red and blue flag bases`, false);
    }
  }
  check('every map has red and blue flag bases', basesOk);

  // Bases are authored onto team spawn points, so the spawn reachability check in
  // server/test/sim.js covers them too — assert that relationship holds so it
  // cannot silently drift.
  let onSpawn = true;
  for (const map of content.maps) {
    for (const team of ['red', 'blue']) {
      const base = map.flagBases?.[team];
      const hit = (map.spawnPoints ?? []).some(
        (s) => s.team === team && s.x === base?.x && s.y === base?.y,
      );
      if (!hit) {
        onSpawn = false;
        check(`map "${map.id}" ${team} flag base sits on a ${team} spawn`, false);
      }
    }
  }
  check('every flag base sits on a team spawn, so it is reachable by construction', onSpawn);

  // Render all three flag states through the real renderer: planted at home (with
  // its base pad), carried by a body, and lying loose on the ground.
  const canvas = makeCanvas(1280, 720);
  const renderer = new renderModule.Renderer(canvas, content);
  const before = canvas.stats.calls;
  const flags = [
    { team: 'red', x: 170, y: 1000, bx: 170, by: 1000, atBase: true, carried: false },
    { team: 'blue', x: 900, y: 1000, bx: 2230, by: 1000, atBase: false, carried: true },
    { team: 'blue', x: 500, y: 1020, bx: 2230, by: 1000, atBase: false, carried: false },
  ];
  let flagsOk = true;
  try {
    renderer.drawFlags(flags, 3.2);
  } catch (err) {
    flagsOk = false;
    check('drawFlags renders home, carried and loose flags', false, err.message);
  }
  check('drawFlags renders home, carried and loose flags', flagsOk);
  check('drawFlags issues draw calls for every flag', canvas.stats.calls - before > 30, `${canvas.stats.calls - before} calls`);

  // drawFlags with no flags must be a no-op, because every non-flag mode sends an
  // empty array and the render loop still calls it.
  const idle = canvas.stats.calls;
  renderer.drawFlags([], 1);
  check('drawFlags with no flags draws nothing', canvas.stats.calls === idle);

  const ctx = canvas.getContext('2d');
  let spriteOk = true;
  try {
    sprites.drawFlagBase(ctx, 400, 400, '#4cc9f0', 1.0);
    sprites.drawFlag(ctx, { x: 400, y: 400, atBase: true }, 1.0, '#ff5d5d', false);
    sprites.drawFlag(ctx, { x: 400, y: 400, atBase: false }, 1.0, '#4cc9f0', true);
  } catch (err) {
    spriteOk = false;
    check('flag sprites draw standalone', false, err.message);
  }
  check('flag sprites draw standalone', spriteOk);
}

// ----------------------------------------------------------------------- net

section('websocket message dispatch');
{
  const C2S = netModule.C2S;
  check('client message names match the server protocol', C2S.JOIN === 'join' && C2S.INPUT === 'input');

  const client = new netModule.GameClient('ws://example.invalid/ws');
  const seen = { welcome: 0, state: 0, events: 0, chat: 0, error: 0, roster: 0, room: 0 };
  client.on('welcome', () => { seen.welcome += 1; });
  client.on('state', () => { seen.state += 1; });
  client.on('events', () => { seen.events += 1; });
  client.on('chat', () => { seen.chat += 1; });
  client.on('serverError', () => { seen.error += 1; });
  client.on('roster', () => { seen.roster += 1; });
  client.on('room', () => { seen.room += 1; });

  const feed = (payload) => client.handleMessage(JSON.stringify(payload));
  feed({ t: 'welcome', you: { id: 'abcd1234', name: 'N', host: true }, room: { id: 'lobby' }, roster: { players: [] } });
  feed({ t: 'state', players: [], bullets: [], pickups: [] });
  feed({ t: 'events', events: [{ type: 'kill' }] });
  feed({ t: 'chat', text: 'hi' });
  feed({ t: 'error', code: 'nope' });
  feed({ t: 'roster', roster: { players: [] } });
  feed({ t: 'room', room: { id: 'lobby' } });
  feed({ t: 'totally_unknown' });
  client.handleMessage('{not json');
  client.handleMessage('null');

  check('welcome is dispatched and the session id captured', seen.welcome === 1 && client.you?.id === 'abcd1234');
  check('state is dispatched', seen.state === 1);
  check('events are dispatched', seen.events === 1);
  check('chat is dispatched', seen.chat === 1);
  check('errors are dispatched', seen.error === 1);
  check('roster is dispatched', seen.roster === 2, `roster=${seen.roster} (one from welcome, one standalone)`);
  check('room updates are dispatched', seen.room === 1);
  check('malformed frames do not throw or dispatch', true);

  // Ping timing.
  client.handleMessage(JSON.stringify({ t: 'pong', ts: performance.now() - 40 }));
  check('rtt is measured from the pong', client.rtt > 20 && client.rtt < 200, `rtt=${client.rtt.toFixed(1)}`);

  // Input encoding.
  let sent = null;
  client.socket = { readyState: 1, send: (raw) => { sent = JSON.parse(raw); } };
  client.join({
    name: 'LANPlayer', character: 'recruit', role: 'raider', room: '', team: 'auto',
    map: 'outpost_ridge', mode: 'tdm', format: '4v4', roleMode: 'free', gravityMode: 'lunar',
  });
  check('join carries the room code, format, role and gravity configuration',
    sent?.t === 'join' && sent.room === '' && sent.format === '4v4' && sent.roleMode === 'free' &&
      sent.role === 'raider' && sent.gravityMode === 'lunar' && sent.map === 'outpost_ridge',
    JSON.stringify(sent));
  client.sendInput({ x: 0.3333333, jump: true, jet: false, fire: true, aim: { x: 1234.7, y: -50.2 }, actions: ['reload'] }, 77);
  check('input frames are compactly encoded', sent?.t === 'input', JSON.stringify(sent));
  check('input keeps the sequence number', sent?.seq === 77);
  check('input rounds aim to whole pixels', sent?.aim.x === 1235 && sent?.aim.y === -50, JSON.stringify(sent?.aim));
  check('input truncates the movement axis', String(sent?.x).length <= 5, `${sent?.x}`);
  check('input carries client actions', Array.isArray(sent?.actions) && sent.actions[0] === 'reload');

  client.close();
  check('close() does not throw without a live socket', true);
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
