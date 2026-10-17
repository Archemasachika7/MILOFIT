/**
 * Local prediction for the player's own body.
 *
 * The movement rules come from /shared/sim-core.js — the *same module the server
 * runs* — so predicting forward and comparing against the authoritative snapshot
 * is a meaningful check rather than a guess. Small errors are smoothed away;
 * large ones (teleport, respawn, getting knocked back by an explosion) snap.
 */
// Two levels up resolves to the site root in the browser (URL paths cannot go
// above "/") and to the repository root under Node, so this single specifier
// works for the served client *and* for headless tests.
import { stepPlayerMovement, clamp } from '../../shared/sim-core.js';

export class Predictor {
  constructor(tuning, map) {
    this.tuning = tuning;
    this.map = map;
    this.reset(null, tuning.player.width, tuning.player.height);
  }

  setMap(map) {
    this.map = map;
  }

  setRole(roleId) {
    const role = this.tuning.roles?.[roleId] ?? this.tuning.roles?.raider;
    if (!role) return;
    this.roleId = roleId;
    this.body.runSpeed = role.runSpeed ?? this.tuning.player.runSpeed;
    this.body.maxHealth = role.maxHealth ?? this.tuning.player.maxHealth;
    this.body.maxJetFuel = role.jetpackMax ?? this.tuning.jetpack.maxFuel;
    this.body.jetDrainScale = role.jetDrainScale ?? 1;
    this.body.jetFuel = Math.min(this.body.jetFuel, this.body.maxJetFuel);
  }

  setGravityScale(scale) {
    this.gravityScale = Number.isFinite(scale) ? scale : 1;
    this.body.gravityScale = this.gravityScale;
  }

  reset(serverPlayer, w, h) {
    this.body = {
      x: serverPlayer?.x ?? 0,
      y: serverPlayer?.y ?? 0,
      vx: serverPlayer?.vx ?? 0,
      vy: serverPlayer?.vy ?? 0,
      aiming: 0,
      aim: serverPlayer?.a ?? 0,
      facing: serverPlayer?.f ?? 1,
      onGround: false,
      jumpHeld: false,
      jetFuel: this.tuning.jetpack.maxFuel,
      jetIdle: 1,
      jetting: false,
      w: w ?? this.tuning.player.width,
      h: h ?? this.tuning.player.height,
    };
    this.setRole(serverPlayer?.r ?? this.roleId ?? 'raider');
    this.setGravityScale(this.gravityScale ?? 1);
    this.error = { x: 0, y: 0 };
    this.lastServer = serverPlayer ?? null;
  }

  /** Advance the predicted body one fixed step with this tick's input. */
  step(input, dt) {
    const body = this.body;
    const { jetting } = stepPlayerMovement(body, {
      x: input.x,
      jump: input.jump,
      jet: input.jet,
      aimX: input.aim.x,
      aimY: input.aim.y,
    }, dt, this.tuning, this.map.solids);
    body.jetting = jetting;
    return body;
  }

  /**
   * Reconcile against an authoritative snapshot. Rewinding and replaying would be
   * ideal but needs input acks; for a scaffold we correct smoothly instead.
   */
  reconcile(server, dt) {
    const body = this.body;
    this.lastServer = server;
    const dx = server.x - body.x;
    const dy = server.y - body.y;
    const err = Math.hypot(dx, dy);
    const limit = this.tuning.net.reconcilePx;

    if (err > limit * 4) {
      body.x = server.x;
      body.y = server.y;
      body.vx = server.vx;
      body.vy = server.vy;
    } else if (err > 1) {
      const rate = clamp(err / limit, 0, 1) * 6 * dt;
      body.x += dx * rate;
      body.y += dy * rate;
    }

    // Server-owned fields always win.
    body.onGround = (server.fl & 2) !== 0;
    body.jetFuel = server.j ?? body.jetFuel;
    if (body.jetFuel > (body.maxJetFuel ?? this.tuning.jetpack.maxFuel)) body.jetFuel = body.maxJetFuel;
    if (!server.alive) {
      body.vx = 0;
      body.vy = 0;
      body.x = server.x;
      body.y = server.y;
    }
    this.error = { x: dx, y: dy };
    return err;
  }
}
