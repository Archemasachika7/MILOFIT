/**
 * MILOFIT Arena — authoritative match simulation.
 *
 * The server owns the truth: clients send inputs, the server advances the world
 * at a fixed 60 Hz and broadcasts snapshots. Nothing here trusts a client's
 * notion of position, health or ammo.
 *
 * Movement/geometry comes from ../../shared/sim-core.js, which is the *same file*
 * the web client uses for prediction. See docs/GAME_DESIGN.md for the rules.
 */
import {
  clamp,
  makeRng,
  stepPlayerMovement,
  segmentBoxT,
  inMeleeCone,
  shotInterval,
  bodyAabb,
} from '../../shared/sim-core.js';

import {
  tuning as T,
  weapons,
  weaponById,
  characters,
  characterById,
  getMap,
  getMode,
  mapById,
  modeById,
  spawnSlots,
  spawnGrenades,
} from './gameData.js';
import { emptyInput } from './protocol.js';

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

let entitySeq = 1;
const nextId = () => entitySeq++;

const FLAG = { ALIVE: 1, GROUND: 2, JET: 4, RELOAD: 8, PROTECTED: 16, SPECTATOR: 32 };

export class Match {
  constructor({
    mapId = 'arena_core',
    modeId = 'tdm',
    format = null,
    roleMode = 'roles',
    gravityMode = 'normal',
    allowSolo = false,
    seed = Date.now(),
  } = {}) {
    this.players = new Map();
    this.rng = makeRng(seed);
    this.mapId = mapId;
    this.modeId = modeId;
    this.format = T.matchFormats?.[format] ? format : null;
    this.roleMode = roleMode === 'free' ? 'free' : 'roles';
    this.gravityMode = T.gravityModes?.[gravityMode] !== undefined ? gravityMode : 'normal';
    this.gravityScale = T.gravityModes?.[this.gravityMode] ?? 1;
    this.allowSolo = !!allowSolo;
    this.resetWorld();
    this.toLobby();
  }

  // ---------------------------------------------------------------- lifecycle

  resetWorld() {
    this.map = getMap(this.mapId);
    this.mode = getMode(this.modeId);
    this.tick = 0;
    this.time = 0;
    this.timeLeft = this.timeLimitSeconds();
    this.autoStartAt = null;
    this.countdown = 0;
    this.endAt = null;
    this.endReason = null;
    this.winner = null;
    this.scores = { red: 0, blue: 0 };
    this.bullets = [];
    this.events = [];
    this.pickups = (this.map.pickups ?? []).map((p, i) => ({
      id: i + 1,
      x: p.x,
      y: p.y,
      type: p.type,
      weaponId: p.weapon ?? null,
      active: true,
      respawnAt: 0,
    }));
    this.flags = [];
    this.buildFlags();
    for (const p of this.players.values()) {
      this.resetStats(p);
      this.preparePlayer(p, true);
    }
  }

  toLobby() {
    this.state = 'lobby';
    this.autoStartAt = null;
    this.countdown = 0;
    this.timeLeft = this.timeLimitSeconds();
    this.bullets.length = 0;
    this.resetFlagsToBase();
    for (const p of this.players.values()) {
      p.alive = false;
      p.spectator = true;
      p.respawnAt = 0;
    }
    this.events.push({ type: 'lobby' });
  }

  setMap(mapId) {
    // Strict validation: getMap() falls back to the first map, so an unknown id
    // would otherwise be "accepted" while leaving mapId pointing at nothing.
    if (typeof mapId !== 'string' || !mapById.has(mapId)) return false;
    if (mapId === this.mapId) return false;
    this.mapId = mapId;
    this.resetWorld();
    this.toLobby();
    return true;
  }

  setMode(modeId) {
    if (typeof modeId !== 'string' || !modeById.has(modeId)) return false;
    const mode = modeById.get(modeId);
    if (mode.id === this.modeId) return false;
    this.modeId = mode.id;
    // `this.mode` is a cached field that resetWorld() refreshes, and both
    // syncTeams() and assignTeam() read it — so teams must be re-seated *after*
    // resetWorld(), never before it, or they are seated for the previous mode.
    this.resetWorld();
    this.syncTeams();
    this.toLobby();
    return true;
  }

  setFormat(format) {
    if (!T.matchFormats?.[format] || format === this.format) return false;
    this.format = format;
    this.timeLeft = this.timeLimitSeconds();
    return true;
  }

  setRoleMode(roleMode) {
    if (roleMode !== 'roles' && roleMode !== 'free') return false;
    if (roleMode === this.roleMode) return false;
    this.roleMode = roleMode;
    for (const p of this.players.values()) {
      p.roleId = this.roleMode === 'free' ? 'attacker' : p.selectedRoleId;
      this.applyRoleStats(p, true);
    }
    return true;
  }

  applyRoleStats(p, preserveHealth = false) {
    const role = T.roles?.[p.roleId] ?? T.roles?.raider ?? {};
    const previousMax = p.maxHealth ?? T.player.maxHealth;
    p.maxHealth = role.maxHealth ?? T.player.maxHealth;
    p.runSpeed = role.runSpeed ?? T.player.runSpeed;
    p.maxJetFuel = role.jetpackMax ?? T.jetpack.maxFuel;
    p.jetDrainScale = role.jetDrainScale ?? 1;
    if (preserveHealth && Number.isFinite(p.hp)) {
      p.hp = Math.min(p.hp + Math.max(0, p.maxHealth - previousMax), p.maxHealth);
    } else {
      p.hp = p.maxHealth;
    }
    p.jetFuel = Math.min(p.jetFuel ?? p.maxJetFuel, p.maxJetFuel);
  }

  setGravityMode(gravityMode) {
    if (T.gravityModes?.[gravityMode] === undefined || gravityMode === this.gravityMode) return false;
    this.gravityMode = gravityMode;
    this.gravityScale = T.gravityModes[gravityMode];
    return true;
  }

  formatConfig() {
    return this.format ? T.matchFormats?.[this.format] ?? null : null;
  }

  timeLimitSeconds() {
    return this.formatConfig()?.timeLimitSeconds ?? T.match.timeLimitSeconds;
  }

  respawnSeconds() {
    return this.formatConfig()?.respawnSeconds ?? T.player.respawnSeconds;
  }

  // -------------------------------------------------------------- ctf flags

  /**
   * Build the flag list for the current mode. Only capture-the-flag gets flags.
   *
   * Base positions come from the map's authored `flagBases`. A map that omits
   * them falls back to the centroid of that team's spawn points, so a custom map
   * can never silently produce an unwinnable match.
   */
  buildFlags() {
    this.flags.length = 0;
    if (!this.mode.flags) return;
    const bases = this.map.flagBases ?? {};
    for (const team of ['red', 'blue']) {
      const base = bases[team] ?? this.teamSpawnCentroid(team);
      if (!base) continue;
      this.flags.push({
        team,
        x: base.x,
        y: base.y,
        baseX: base.x,
        baseY: base.y,
        carrier: null,
        atBase: true,
        droppedAt: 0,
        returnAt: 0,
      });
    }
  }

  teamSpawnCentroid(team) {
    const pts = (this.map.spawnPoints ?? []).filter((s) => s.team === team);
    if (!pts.length) return null;
    let x = 0;
    let y = 0;
    for (const s of pts) {
      x += s.x;
      y += s.y;
    }
    return { x: x / pts.length, y: y / pts.length };
  }

  resetFlagsToBase() {
    for (const f of this.flags ?? []) this.putFlagHome(f);
  }

  /** Silent reset — no event. Callers that should be heard use returnFlag(). */
  putFlagHome(f) {
    f.carrier = null;
    f.atBase = true;
    f.x = f.baseX;
    f.y = f.baseY;
    f.droppedAt = 0;
    f.returnAt = 0;
  }

  flagOf(team) {
    return this.flags.find((f) => f.team === team) ?? null;
  }

  addPlayer(id, info = {}) {
    const character = characterById.get(info.character) ?? characters[0];
    const requestedRole = T.roles?.[info.role] ? info.role : 'raider';
    const p = {
      id,
      name: info.name,
      character: character.id,
      palette: character.palette,
      selectedRoleId: requestedRole,
      roleId: this.roleMode === 'free' ? 'attacker' : requestedRole,
      team: 'ffa',
      w: T.player.width,
      h: T.player.height,
      ping: 0,
      kills: 0,
      deaths: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      input: emptyInput(),
      pendingActions: [],
      lastHurtAt: -99,
    };
    this.applyRoleStats(p);
    this.players.set(id, p);
    this.assignTeam(p, info.team);
    this.resetStats(p);
    this.preparePlayer(p, this.state !== 'playing');
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.dropFlagCarriedBy(p);
    this.players.delete(id);
    if (p) this.bullets = this.bullets.filter((b) => b.owner !== id);
    return p;
  }

  assignTeam(p, preference = 'auto') {
    if (!this.mode.teams) {
      p.team = 'ffa';
      return p.team;
    }
    if (preference === 'red' || preference === 'blue') {
      p.team = preference;
      return p.team;
    }
    let red = 0, blue = 0;
    for (const other of this.players.values()) {
      if (other === p) continue;
      if (other.team === 'red') red++;
      else if (other.team === 'blue') blue++;
    }
    p.team = red <= blue ? 'red' : 'blue';
    return p.team;
  }

  setTeam(id, preference) {
    const p = this.players.get(id);
    if (!p || !this.mode.teams) return false;
    if (preference !== 'red' && preference !== 'blue') return false;
    // Switching sides mid-run must not let you carry a flag across teams.
    this.dropFlagCarriedBy(p);
    p.team = preference;
    if (this.state === 'playing' && p.alive) this.spawn(p);
    return true;
  }

  /**
   * Re-seat every player after the mode switched between team and free-for-all.
   *
   * Teams are decided when a player joins, so without this a room that starts on
   * deathmatch and is switched to a team mode leaves everyone on the sentinel team
   * "ffa". That is not cosmetic: friendly fire is decided by `a.team === b.team`,
   * kills are credited to `scores[a.team]`, spawn points are filtered by team, and
   * in capture the flag `p.team === flag.team` is what makes a capture legal. Left
   * alone, a mode switch would silently produce an unplayable match — nothing
   * could be captured and every kill would score into `scores.ffa`.
   */
  syncTeams() {
    for (const p of this.players.values()) {
      if (this.mode.teams) {
        if (p.team !== 'red' && p.team !== 'blue') this.assignTeam(p, 'auto');
      } else if (p.team !== 'ffa') {
        p.team = 'ffa';
      }
    }
  }

  requestStart(id) {
    if (this.state === 'playing') return false;
    if (this.players.size < this.minPlayers()) return false;
    this.startMatch();
    return true;
  }

  resetStats(p) {
    p.kills = 0;
    p.deaths = 0;
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.stats = { shots: 0, hits: 0, damage: 0 };
  }

  /** Gameplay state for a fresh life (or lobby idle). */
  preparePlayer(p, waiting) {
    this.applyRoleStats(p);
    p.alive = false;
    p.spectator = !!waiting;
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.onGround = false;
    p.facing = 1;
    p.aim = 0;
    p.jetFuel = p.maxJetFuel;
    p.jetIdle = 1;
    p.jumpHeld = false;
    p.jetting = false;
    p.hp = p.maxHealth;
    p.shield = 0;
    p.respawnAt = 0;
    p.spawnProtectUntil = 0;
    p.fireCooldown = 0;
    p.reloadEnd = 0;
    p.reloadWeapon = null;
    p.meleeCooldown = 0;
    p.grenades = spawnGrenades;
    p.grenadeTimer = 0;
    p.slots = [...spawnSlots];
    p.slot = 0;
    p.ammo = {};
    for (const wid of p.slots) this.grantAmmo(p, wid);
    p.damagers = new Map();
    p.input = emptyInput();
    p.pendingActions.length = 0;
  }

  grantAmmo(p, weaponId) {
    const w = weaponById.get(weaponId);
    if (!w || w.ammo === 'none') return;
    p.ammo[weaponId] = { mag: w.magSize, reserve: w.reserve };
  }

  giveWeapon(p, weaponId) {
    const w = weaponById.get(weaponId);
    if (!w) return false;
    if (w.slot === 'melee' || w.slot === 'grenade') {
      if (w.slot === 'grenade') p.grenades = spawnGrenades;
      return true;
    }
    // Primary slot is index 0; melee stays in index 1.
    p.slots[0] = weaponId;
    p.slot = 0;
    p.ammo[weaponId] = { mag: w.magSize, reserve: w.reserve };
    p.reloadEnd = 0;
    p.reloadWeapon = null;
    return true;
  }

  // ------------------------------------------------------------------- input

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    const prevSeq = p.input.seq ?? 0;
    if (input.seq && input.seq < prevSeq) return; // stale / reordered frame
    p.ping = input.rtt ?? p.ping;
    const queued = p.pendingActions;
    const next = { ...input, actions: [] };
    p.input = next;
    for (const a of input.actions) {
      if (queued.length < 8) queued.push(a);
    }
  }

  // -------------------------------------------------------------- match flow

  minPlayers() {
    return this.allowSolo || !this.format ? 1 : 2;
  }

  startMatch() {
    this.state = 'playing';
    this.autoStartAt = null;
    this.countdown = 0;
    this.endAt = null;
    this.endReason = null;
    this.winner = null;
    this.timeLeft = this.timeLimitSeconds();
    this.scores = { red: 0, blue: 0 };
    this.bullets.length = 0;
    for (const pk of this.pickups) {
      pk.active = true;
      pk.respawnAt = 0;
    }
    this.resetFlagsToBase();
    for (const p of this.players.values()) {
      this.resetStats(p);
      this.spawn(p);
    }
    this.events.push({ type: 'matchStart', mapId: this.mapId, mode: this.mode.id });
  }

  spawn(p) {
    const teamOk = (s) => !this.mode.teams || s.team === p.team || s.team === 'any' || !s.team;
    let candidates = (this.map.spawnPoints ?? []).filter(teamOk);
    if (!candidates.length) candidates = [{ x: this.map.size.width / 2, y: 200 }];

    let best = candidates[0];
    let bestScore = -Infinity;
    for (const s of candidates) {
      let nearestEnemy = Infinity;
      for (const other of this.players.values()) {
        if (other === p || !other.alive) continue;
        if (this.mode.teams && other.team === p.team) continue;
        nearestEnemy = Math.min(nearestEnemy, Math.hypot(other.x - s.x, other.y - s.y));
      }
      const score = (nearestEnemy === Infinity ? 4000 : nearestEnemy) * 1 + this.rng() * 80;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }

    p.x = best.x;
    p.y = best.y;
    p.vx = 0;
    p.vy = 0;
    p.hp = p.maxHealth;
    p.shield = 0;
    p.alive = true;
    p.spectator = false;
    p.respawnAt = 0;
    p.spawnProtectUntil = this.time + T.player.spawnProtectionSeconds;
    p.jetFuel = p.maxJetFuel;
    p.jetIdle = 1;
    p.jumpHeld = false;
    p.slots = [...spawnSlots];
    p.slot = 0;
    p.ammo = {};
    for (const wid of p.slots) this.grantAmmo(p, wid);
    p.reloadEnd = 0;
    p.reloadWeapon = null;
    p.fireCooldown = 0;
    p.meleeCooldown = 0;
    p.grenades = spawnGrenades;
    p.grenadeTimer = 0;
    p.damagers.clear();
    this.events.push({ type: 'spawn', id: p.id, x: r1(p.x), y: r1(p.y), team: p.team });
  }

  leaderScore() {
    if (this.mode.teams) return Math.max(this.scores.red, this.scores.blue);
    let top = 0;
    for (const p of this.players.values()) top = Math.max(top, p.score);
    return top;
  }

  scoreboard() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        character: p.character,
        kills: p.kills,
        deaths: p.deaths,
        score: r2(p.score),
        streak: p.streak,
        bestStreak: p.bestStreak,
        ping: p.ping,
        alive: p.alive,
      }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  }

  endMatch(reason) {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.endReason = reason;
    this.endAt = this.time + T.match.postMatchSeconds;
    const board = this.scoreboard();
    if (this.mode.teams) {
      this.winner = this.scores.red === this.scores.blue
        ? null
        : (this.scores.red > this.scores.blue ? 'red' : 'blue');
    } else {
      this.winner = board[0]?.id ?? null;
    }
    for (const p of this.players.values()) {
      p.alive = false;
      p.spectator = true;
      p.respawnAt = 0;
    }
    this.events.push({
      type: 'matchEnd',
      reason,
      winner: this.winner,
      teams: this.mode.teams ? { ...this.scores } : null,
      scoreboard: board,
    });
  }

  // ------------------------------------------------------------------- ticks

  /** Advance by exactly one fixed step. Caller owns the accumulator. */
  step(dt) {
    this.tick += 1;
    this.time += dt;
    if (this.state === 'lobby') return this.stepLobby(dt);
    if (this.state === 'ended') return this.stepEnded(dt);
    return this.stepPlaying(dt);
  }

  stepLobby(dt) {
    const need = this.minPlayers();
    if (this.players.size < need) {
      this.autoStartAt = null;
      this.countdown = 0;
      return;
    }
    if (this.autoStartAt === null) {
      this.autoStartAt = this.time + T.match.warmupCountdownSeconds;
      this.events.push({ type: 'countdown', seconds: T.match.warmupCountdownSeconds });
    }
    this.countdown = Math.max(0, this.autoStartAt - this.time);
    if (this.time >= this.autoStartAt) this.startMatch();
  }

  stepEnded(dt) {
    if (this.endAt !== null && this.time >= this.endAt) this.toLobby();
  }

  stepPlaying(dt) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const p of this.players.values()) this.stepPlayer(p, dt);
    this.stepBullets(dt);
    this.stepPickups(dt);
    if (this.mode.flags) this.stepFlags(dt);
    this.checkMatchEnd();
  }

  /**
   * The score that ends the match. In capture-the-flag the team score counts
   * captures rather than kill points (see mode.teamScoreFromKills), so it needs
   * its own goal instead of the shared kill limit.
   */
  scoreGoal() {
    if (this.mode.flags) return T.ctf?.captureLimit ?? 3;
    return this.formatConfig()?.scoreLimit ?? T.match.scoreLimit;
  }

  checkMatchEnd() {
    if (this.state !== 'playing') return;
    if (this.leaderScore() >= this.scoreGoal()) {
      this.endMatch('score');
      return;
    }
    if (this.timeLeft <= 0) {
      this.endMatch('time');
    }
  }

  stepPlayer(p, dt) {
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.meleeCooldown = Math.max(0, p.meleeCooldown - dt);

    if (p.grenades < spawnGrenades) {
      p.grenadeTimer += dt;
      if (p.grenadeTimer >= T.grenades.rechargeSeconds) {
        p.grenadeTimer = 0;
        p.grenades += 1;
      }
    }

    if (!p.alive) {
      p.pendingActions.length = 0;
      if (!p.spectator && p.respawnAt && this.time >= p.respawnAt) this.spawn(p);
      return;
    }

    if (p.reloadEnd > 0) {
      p.reloadEnd -= dt;
      if (p.reloadEnd <= 0) {
        p.reloadEnd = 0;
        this.finishReload(p);
      }
    }

    p.gravityScale = this.gravityScale;
    const { jetting } = stepPlayerMovement(p, p.input, dt, T, this.map.solids);
    p.jetting = jetting;

    if (p.pendingActions.length) {
      for (const action of p.pendingActions) this.applyAction(p, action);
      p.pendingActions.length = 0;
    }

    if (p.input.fire && p.alive) this.tryFire(p);
  }

  applyAction(p, action) {
    if (action === 'reload') return this.startReload(p);
    if (action === 'melee') return this.switchAndMelee(p);
    if (action === 'grenade') return this.throwGrenade(p);
    if (action.startsWith('switch:')) {
      const slot = Number(action.slice(7));
      if (slot === 0 || slot === 1) {
        if (p.slot !== slot) {
          p.slot = slot;
          p.reloadEnd = 0;
          p.reloadWeapon = null;
          p.fireCooldown = Math.max(p.fireCooldown, 0.18);
        }
      }
    }
    return undefined;
  }

  currentWeapon(p) {
    return weaponById.get(p.slots[p.slot]) ?? null;
  }

  isReloading(p) {
    return p.reloadEnd > 0;
  }

  ammoOf(p, weapon) {
    if (!weapon || weapon.ammo === 'none') return null;
    return p.ammo[weapon.id] ?? null;
  }

  startReload(p) {
    if (!p.alive || this.isReloading(p)) return;
    const w = this.currentWeapon(p);
    const ammo = this.ammoOf(p, w);
    if (!w || !ammo) return;
    if (ammo.mag >= w.magSize || ammo.reserve <= 0) return;
    p.reloadEnd = w.reloadSeconds ?? 1;
    p.reloadWeapon = w.id;
    this.events.push({ type: 'reload', id: p.id, weapon: w.id, duration: r2(p.reloadEnd) });
  }

  finishReload(p) {
    const w = weaponById.get(p.reloadWeapon ?? p.slots[p.slot]);
    p.reloadWeapon = null;
    if (!w) return;
    const ammo = this.ammoOf(p, w);
    if (!ammo) return;
    const take = Math.min(w.magSize - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    this.events.push({ type: 'reloaded', id: p.id, weapon: w.id, mag: ammo.mag, reserve: ammo.reserve });
  }

  tryFire(p) {
    const w = this.currentWeapon(p);
    if (!w) return;
    if (p.meleeCooldown > 0 && w.kind === 'melee') return;
    if (p.fireCooldown > 0 || this.isReloading(p)) return;
    const ammo = this.ammoOf(p, w);
    if (ammo && ammo.mag <= 0) return this.startReload(p);
    if (w.kind === 'melee') return this.doMelee(p, w);
    return this.doShoot(p, w);
  }

  muzzle(p, angle) {
    return {
      x: p.x + Math.cos(angle) * 18,
      y: p.y - 5 + Math.sin(angle) * 18,
    };
  }

  doShoot(p, w) {
    p.fireCooldown = shotInterval(w);
    p.spawnProtectUntil = 0; // shooting gives up spawn protection
    const ammo = this.ammoOf(p, w);
    if (ammo) ammo.mag -= 1;

    const pellets = w.pellets ?? 1;
    const spreadRad = ((w.spreadDeg ?? 0) * Math.PI) / 180;
    const speed = w.bulletSpeed ?? 1000;
    const isProjectile = w.kind === 'projectile';
    const muzzle = this.muzzle(p, p.aim);

    for (let i = 0; i < pellets; i++) {
      const angle = p.aim + (this.rng() - 0.5) * spreadRad;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      this.bullets.push({
        id: nextId(),
        owner: p.id,
        team: p.team,
        weaponId: w.id,
        kind: w.kind ?? 'bullet',
        x: muzzle.x,
        y: muzzle.y,
        vx,
        vy,
        life: w.bulletLifeSeconds ?? 0.6,
        damage: w.damage ?? 0,
        knockback: w.knockback ?? 0,
        radius: isProjectile ? 7 : (w.kind === 'flame' ? 10 : 3),
        gravityScale: w.gravityScale ?? 0,
        bounciness: w.bounciness ?? 0,
        explode: w.explode ?? null,
        angle,
        fromPlayer: true,
      });
    }

    p.stats.shots += pellets;
    const kick = (w.recoilKick ?? 0) * 26;
    p.vx -= Math.cos(p.aim) * kick;
    if (!p.onGround) p.vy -= Math.sin(p.aim) * kick * 0.5;

    this.events.push({
      type: 'fire',
      id: p.id,
      weapon: w.id,
      x: r1(muzzle.x),
      y: r1(muzzle.y),
      angle: r2(p.aim),
      mag: ammo ? ammo.mag : -1,
    });
  }

  switchAndMelee(p) {
    const meleeSlot = p.slots.findIndex((id) => weaponById.get(id)?.kind === 'melee');
    if (meleeSlot >= 0 && p.slot !== meleeSlot) {
      p.slot = meleeSlot;
      p.reloadEnd = 0;
      p.reloadWeapon = null;
    }
    const w = this.currentWeapon(p);
    if (w && w.kind === 'melee') this.doMelee(p, w);
  }

  doMelee(p, w) {
    p.meleeCooldown = w.cooldownSeconds ?? T.melee.cooldownSeconds;
    p.spawnProtectUntil = 0;
    const range = w.range ?? T.melee.range;
    const halfAngle = w.halfAngleDeg ?? T.melee.halfAngleDeg;
    let hitAny = false;
    for (const other of this.players.values()) {
      if (other === p || !other.alive) continue;
      if (!T.player.friendlyFire && this.mode.teams && other.team === p.team) continue;
      if (!inMeleeCone(p, other, range, halfAngle)) continue;
      hitAny = true;
      p.stats.hits += 1;
      this.damage(other, w.damage ?? 40, p.id, w.id, { knockback: w.knockback ?? 180, fromX: p.x, fromY: p.y });
    }
    this.events.push({ type: 'melee', id: p.id, x: r1(p.x), y: r1(p.y), angle: r2(p.aim), hit: hitAny });
  }

  throwGrenade(p) {
    if (p.grenades <= 0) return;
    p.grenades -= 1;
    if (p.grenadeTimer <= 0) p.grenadeTimer = 0.0001;
    p.spawnProtectUntil = 0;
    const G = T.grenades;
    const muzzle = this.muzzle(p, p.aim);
    this.bullets.push({
      id: nextId(),
      owner: p.id,
      team: p.team,
      weaponId: 'frag',
      kind: 'grenade',
      x: muzzle.x,
      y: muzzle.y,
      vx: Math.cos(p.aim) * G.throwSpeed,
      vy: Math.sin(p.aim) * G.throwSpeed + G.throwUpBias,
      life: G.fuseSeconds,
      damage: 0,
      knockback: 0,
      radius: 7,
      gravityScale: 1,
      bounciness: 0.42,
      explode: { radius: G.radius, damage: G.damage, knockback: 260 },
      angle: p.aim,
      fromPlayer: true,
    });
    this.events.push({ type: 'throw', id: p.id, x: r1(muzzle.x), y: r1(muzzle.y), grenades: p.grenades });
  }

  // ----------------------------------------------------------------- combat

  stepBullets(dt) {
    const solids = this.map.solids;
    const survivors = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.life <= 0) {
        if (b.explode) this.explode(b);
        continue;
      }
      if (b.gravityScale) b.vy += T.player.gravity * b.gravityScale * dt;
      if (this.advanceBullet(b, dt, solids)) survivors.push(b);
    }
    this.bullets = survivors;
  }

  /** Returns true if the projectile survives the step. */
  advanceBullet(b, dt, solids) {
    const speed = Math.hypot(b.vx, b.vy);
    const travel = speed * dt + Math.abs(b.vy) * dt * 0.5;
    const steps = Math.max(1, Math.min(40, Math.ceil(travel / 6)));
    const sx = (b.vx * dt) / steps;
    const sy = (b.vy * dt) / steps;

    for (let i = 0; i < steps; i++) {
      const nx = b.x + sx;
      const ny = b.y + sy;

      let victim = null;
      let victimT = Infinity;
      if (b.kind !== 'grenade') {
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner) continue;
          if (!T.player.friendlyFire && this.mode.teams && p.team === b.team) continue;
          const [bx, by, bw, bh] = bodyAabb(p);
          const t = segmentBoxT(b.x, b.y, nx, ny, bx, by, bw, bh);
          if (t !== null && t < victimT) {
            victimT = t;
            victim = p;
          }
        }
      }

      let worldT = Infinity;
      for (const s of solids) {
        if (s.oneWay) continue;
        const t = segmentBoxT(
          b.x, b.y, nx, ny,
          s.x - b.radius, s.y - b.radius,
          s.w + b.radius * 2, s.h + b.radius * 2,
        );
        if (t !== null && t < worldT) worldT = t;
      }

      if (victim && victimT <= worldT) {
        if (b.explode) {
          b.x += sx * victimT;
          b.y += sy * victimT;
          this.explode(b);
          return false;
        }
        this.hitPlayer(b, victim, victimT, nx, ny, sx, sy);
        return false;
      }

      if (worldT <= 1) {
        if (b.bounciness > 0) {
          this.bounce(b, sx, sy, solids);
          continue;
        }
        b.x += sx * worldT;
        b.y += sy * worldT;
        if (b.explode) this.explode(b);
        else this.events.push({ type: 'impact', x: r1(b.x), y: r1(b.y), weapon: b.weaponId });
        return false;
      }

      b.x = nx;
      b.y = ny;
    }
    return true;
  }

  bounce(b, sx, sy, solids) {
    const inside = (x, y) => solids.some((s) => !s.oneWay &&
      x > s.x - b.radius && x < s.x + s.w + b.radius &&
      y > s.y - b.radius && y < s.y + s.h + b.radius);
    let moved = false;
    if (!inside(b.x + sx, b.y)) {
      b.x += sx;
      moved = true;
    } else {
      b.vx = -b.vx * b.bounciness;
    }
    if (!inside(b.x, b.y + sy)) {
      b.y += sy;
      moved = true;
    } else {
      b.vy = -b.vy * b.bounciness;
      if (Math.abs(b.vy) < 40) b.vy = 0;
      b.vx *= 0.86;
    }
    if (!moved) {
      b.vx *= 0.5;
      b.vy *= 0.5;
    }
  }

  hitPlayer(b, victim, t, nx, ny, sx, sy) {
    const hx = b.x + sx * t;
    const hy = b.y + sy * t;
    b.x = hx;
    b.y = hy;
    const shooter = this.players.get(b.owner);
    if (shooter) shooter.stats.hits += 1;
    this.damage(victim, b.damage, b.owner, b.weaponId, {
      knockback: b.knockback,
      fromX: hx,
      fromY: hy,
    });
    this.events.push({ type: 'impact', x: r1(hx), y: r1(hy), weapon: b.weaponId, flesh: true });
  }

  explode(b) {
    const e = b.explode;
    if (!e) return;
    this.events.push({ type: 'explosion', x: r1(b.x), y: r1(b.y), radius: e.radius, weapon: b.weaponId });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id !== b.owner && !T.player.friendlyFire && this.mode.teams && p.team === b.team) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d > e.radius) continue;
      let factor = clamp(1 - d / e.radius, 0.15, 1);
      if (p.id === b.owner) factor *= T.player.selfDamageFactor;
      this.damage(p, e.damage * factor, b.owner, b.weaponId, {
        knockback: e.knockback,
        fromX: b.x,
        fromY: b.y,
      });
    }
  }

  damage(p, amount, attackerId, weaponId, opts = {}) {
    if (!p.alive || amount <= 0) return false;
    if (this.time < p.spawnProtectUntil) return false;

    const shooter = attackerId ? this.players.get(attackerId) : null;
    if (shooter && shooter !== p) shooter.stats.damage += amount;

    const absorbed = Math.min(p.shield, amount);
    p.shield -= absorbed;
    p.hp -= amount - absorbed;
    p.lastHurtAt = this.time;

    if (attackerId && attackerId !== p.id) p.damagers.set(attackerId, this.time);

    if (opts.knockback) {
      let ox = opts.fromX;
      let oy = opts.fromY;
      if (ox === undefined || oy === undefined) {
        ox = p.x;
        oy = p.y - 1;
      }
      const angle = Math.atan2(p.y - oy, p.x - ox);
      const scale = opts.knockback / Math.max(p.w, 1);
      p.vx += Math.cos(angle) * scale * 12;
      p.vy += Math.sin(angle) * scale * 6 - 30;
    }

    if (attackerId && attackerId !== p.id) {
      this.events.push({
        type: 'hitMark',
        to: attackerId,
        x: r1(p.x),
        y: r1(p.y),
        amount: Math.round(amount),
        shield: absorbed > 0,
        lethal: p.hp <= 0,
      });
    }
    this.events.push({ type: 'hurt', to: p.id, x: r1(p.x), y: r1(p.y), amount: Math.round(amount), from: attackerId ?? null });

    if (p.hp <= 0) this.kill(p, attackerId, weaponId);
    return true;
  }

  kill(p, killerId, weaponId) {
    // Drop a carried flag where the body fell, before the body is hidden.
    this.dropFlagCarriedBy(p);
    p.alive = false;
    p.hp = 0;
    p.shield = 0;
    p.deaths += 1;
    p.streak = 0;
    p.respawnAt = this.time + (p.spectator ? 0 : this.respawnSeconds());

    const killer = killerId ? this.players.get(killerId) : null;
    let assistId = null;
    for (const [id, when] of p.damagers) {
      if (id === killerId || id === p.id) continue;
      if (this.time - when <= 5) assistId = id;
    }

    if (killer && killer !== p) {
      killer.kills += 1;
      killer.streak += 1;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      const points = this.mode.scorePerKill ?? 1;
      killer.score += points;
      // CTF scores the team on captures, not kills, so a kill must not also move
      // the team score — otherwise the capture goal would be reached by fragging.
      const teamFromKills = this.mode.teams && this.mode.teamScoreFromKills !== false;
      if (teamFromKills) this.scores[killer.team] += points;
      const assist = assistId ? this.players.get(assistId) : null;
      if (assist && assist !== killer) {
        const ap = this.mode.scorePerAssist ?? 0;
        assist.score += ap;
        if (teamFromKills) this.scores[assist.team] += ap;
      }
    }

    this.events.push({
      type: 'kill',
      killer: killer && killer !== p ? killer.id : null,
      killerName: killer && killer !== p ? killer.name : null,
      killerTeam: killer && killer !== p ? killer.team : null,
      victim: p.id,
      victimName: p.name,
      victimTeam: p.team,
      weapon: weaponId ?? null,
      assist: assistId,
      streak: killer && killer !== p ? killer.streak : 0,
    });
    p.damagers.clear();
  }

  // -------------------------------------------------------------------- ctf

  /**
   * Flag logic, run once per fixed step while the match is playing.
   *
   * The classic rule is kept intact: **you may only capture while your own flag
   * is at home.** That gives the defender a job, and because a dropped flag also
   * self-returns after `tuning.ctf.returnSeconds`, a mutual-steal stand-off
   * always resolves instead of deadlocking.
   */
  stepFlags(dt) {
    const pickupR = T.ctf?.pickupRadius ?? 34;
    const captureR = T.ctf?.captureRadius ?? 46;

    for (const f of this.flags) {
      // ---- carried
      if (f.carrier) {
        const c = this.players.get(f.carrier);
        if (!c || !c.alive) {
          this.dropFlag(f, c ? c.x : f.x, c ? c.y : f.y);
          continue;
        }
        f.x = c.x;
        f.y = c.y;
        const home = this.flagOf(c.team);
        if (
          home &&
          home !== f &&
          home.atBase &&
          Math.abs(c.x - home.baseX) <= captureR &&
          Math.abs(c.y - home.baseY) <= captureR
        ) {
          this.captureFlag(f, c, home);
        }
        continue;
      }

      // ---- loose: auto-return on the clock
      if (!f.atBase && f.returnAt && this.time >= f.returnAt) {
        this.returnFlag(f, 'timeout');
        continue;
      }

      // ---- loose: touch
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (
          Math.abs(p.x - f.x) > p.w / 2 + pickupR ||
          Math.abs(p.y - f.y) > p.h / 2 + pickupR
        ) {
          continue;
        }
        if (p.team === f.team) {
          // Walking into your own loose flag sends it straight home.
          if (!f.atBase) this.returnFlag(f, 'touch');
          continue;
        }
        this.takeFlag(f, p);
        break;
      }
    }
  }

  takeFlag(f, p) {
    f.carrier = p.id;
    f.atBase = false;
    f.droppedAt = 0;
    f.returnAt = 0;
    this.events.push({
      type: 'flag',
      action: 'taken',
      team: f.team,
      id: p.id,
      name: p.name,
      x: r1(f.x),
      y: r1(f.y),
    });
  }

  dropFlag(f, x, y) {
    f.carrier = null;
    f.atBase = false;
    f.x = x;
    f.y = y;
    f.droppedAt = this.time;
    f.returnAt = this.time + (T.ctf?.returnSeconds ?? 20);
    this.events.push({ type: 'flag', action: 'dropped', team: f.team, x: r1(x), y: r1(y) });
  }

  returnFlag(f, how) {
    this.putFlagHome(f);
    this.events.push({
      type: 'flag',
      action: 'returned',
      team: f.team,
      how,
      x: r1(f.x),
      y: r1(f.y),
    });
  }

  captureFlag(f, carrier, home) {
    this.putFlagHome(f);
    this.scores[carrier.team] += 1;
    this.events.push({
      type: 'capture',
      team: carrier.team,
      id: carrier.id,
      name: carrier.name,
      score: this.scores[carrier.team],
      x: r1(home.baseX),
      y: r1(home.baseY),
    });
  }

  /** A flag is not attached to a body, so it has to be dropped explicitly. */
  dropFlagCarriedBy(p) {
    const f = this.flags.find((x) => x.carrier === p.id);
    if (f) this.dropFlag(f, p.x, p.y);
  }

  // ---------------------------------------------------------------- pickups

  stepPickups(dt) {
    for (const pk of this.pickups) {
      if (!pk.active) {
        if (this.time >= pk.respawnAt) pk.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dx = Math.abs(p.x - pk.x);
        const dy = Math.abs(p.y - pk.y);
        if (dx > p.w / 2 + 20 || dy > p.h / 2 + 20) continue;
        if (!this.applyPickup(p, pk)) continue;
        pk.active = false;
        pk.respawnAt = this.time + T.pickups.respawnSeconds;
        break;
      }
    }
  }

  applyPickup(p, pk) {
    if (pk.type === 'health') {
      if (p.hp >= p.maxHealth) return false;
      p.hp = Math.min(p.maxHealth, p.hp + (T.pickups.healthAmount ?? 40));
    } else if (pk.type === 'shield') {
      if (p.shield >= T.player.maxShield) return false;
      p.shield = Math.min(T.player.maxShield, p.shield + (T.pickups.shieldAmount ?? 35));
    } else if (pk.type === 'ammo') {
      const w = this.currentWeapon(p);
      const ammo = this.ammoOf(p, w);
      if (!ammo || ammo.reserve >= w.reserve) return false;
      ammo.reserve = Math.min(w.reserve, ammo.reserve + Math.ceil(w.reserve * (T.pickups.ammoRefillFactor ?? 0.6)));
      if (p.grenades < spawnGrenades) p.grenades += 1;
    } else if (pk.type === 'weapon') {
      this.giveWeapon(p, pk.weaponId);
    } else {
      return false;
    }
    this.events.push({
      type: 'pickup',
      id: p.id,
      pickup: pk.id,
      pickupType: pk.type,
      weapon: pk.weaponId,
      x: r1(pk.x),
      y: r1(pk.y),
    });
    return true;
  }

  // --------------------------------------------------------------- snapshot

  flagsFor(p) {
    let f = 0;
    if (p.alive) f |= FLAG.ALIVE;
    if (p.onGround) f |= FLAG.GROUND;
    if (p.jetting) f |= FLAG.JET;
    if (p.reloadEnd > 0) f |= FLAG.RELOAD;
    if (this.time < p.spawnProtectUntil) f |= FLAG.PROTECTED;
    if (p.spectator) f |= FLAG.SPECTATOR;
    return f;
  }

  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      const w = this.currentWeapon(p);
      const ammo = this.ammoOf(p, w);
      players.push({
        i: p.id,
        n: p.name,
        tm: p.team,
        c: p.character,
        r: p.roleId,
        mh: p.maxHealth,
        mj: p.maxJetFuel,
        x: r1(p.x),
        y: r1(p.y),
        vx: r1(p.vx),
        vy: r1(p.vy),
        hp: Math.max(0, Math.round(p.hp)),
        sh: Math.round(p.shield),
        f: p.facing,
        a: r2(p.aim),
        fl: this.flagsFor(p),
        s: p.slot,
        w: w ? w.id : null,
        m: ammo ? ammo.mag : -1,
        rr: ammo ? ammo.reserve : -1,
        rl: r2(p.reloadEnd),
        j: Math.round(p.jetFuel),
        g: p.grenades,
        k: p.kills,
        d: p.deaths,
        sc: r2(p.score),
        rd: p.alive ? 0 : Math.max(0, r1(p.respawnAt - this.time)),
        pg: p.ping,
      });
    }
    players.sort((a, b) => a.i - b.i);

    return {
      tick: this.tick,
      time: r2(this.time),
      state: this.state,
      mapId: this.mapId,
      mode: this.mode.id,
      teams: this.mode.teams,
      format: this.format,
      roleMode: this.roleMode,
      gravityMode: this.gravityMode,
      gravityScale: this.gravityScale,
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
      timeLimitSeconds: this.timeLimitSeconds(),
      countdown: r1(this.countdown),
      scoreLimit: this.scoreGoal(),
      scores: this.mode.teams
        ? { red: r2(this.scores.red), blue: r2(this.scores.blue) }
        : { ffa: r2(this.leaderScore()) },
      players,
      bullets: this.bullets.map((b) => ({
        i: b.id,
        x: r1(b.x),
        y: r1(b.y),
        k: b.kind,
        w: b.weaponId,
        o: b.owner,
        a: r2(b.angle ?? Math.atan2(b.vy, b.vx)),
      })),
      pickups: this.pickups
        .filter((pk) => pk.active)
        .map((pk) => ({ i: pk.id, x: pk.x, y: pk.y, t: pk.type, w: pk.weaponId })),
      // Empty unless the mode has flags. `a` is 1 only at the team's own base,
      // `c` is the carrying player's id, `bx`/`by` let a client draw the empty
      // base pole without needing the map's flagBases.
      flags: this.flags.map((f) => ({
        tm: f.team,
        x: r1(f.x),
        y: r1(f.y),
        bx: r1(f.baseX),
        by: r1(f.baseY),
        c: f.carrier,
        a: f.atBase ? 1 : 0,
      })),
    };
  }

  roster() {
    return {
      id: this.id ?? null,
      mapId: this.mapId,
      modeId: this.mode.id,
      state: this.state,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        character: p.character,
        role: p.roleId,
        alive: p.alive,
        spectator: p.spectator,
        kills: p.kills,
        deaths: p.deaths,
        score: r2(p.score),
        ping: p.ping,
      })),
    };
  }

  drainEvents() {
    if (!this.events.length) return null;
    const out = this.events;
    this.events = [];
    return out;
  }
}

export { FLAG, weapons };
