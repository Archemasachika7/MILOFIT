/**
 * MILOFIT Arena — shared simulation core.
 *
 * Pure geometry / movement / weapon math with **no imports and no side effects**.
 * This module is loaded by:
 *   - the Node server        (server/src/sim.js)      -> authoritative simulation
 *   - the web client         (web/src/predict.js)     -> local prediction of own player
 *
 * The Android client re-implements these rules in Kotlin (game/SimCore.kt) and the
 * two must stay in step. If you change a rule here, change it there too.
 *
 * Keeping one body of movement code is what makes client-side prediction land on
 * the same numbers the server produces; duplicating the rules is the usual source
 * of "rubber banding" netcode bugs.
 */

export const EPS = 0.001;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Small deterministic xorshift32 — keeps replays/rollbacks reproducible. */
export function makeRng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return function rng() {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** AABB helpers. Bodies store their CENTRE in x/y, which makes rendering easy. */
export function bodyLeft(b) { return b.x - b.w / 2; }
export function bodyRight(b) { return b.x + b.w / 2; }
export function bodyTop(b) { return b.y - b.h / 2; }
export function bodyBottom(b) { return b.y + b.h / 2; }

export function makeBody(x, y, w, h) {
  return { x, y, w, h, vx: 0, vy: 0, onGround: false };
}

/**
 * Move a body by (dx, dy) resolving against the map's solids, axis by axis.
 *
 * Solid flags:
 *   oneWay: true  -> jump-through platform. Ignored on the X axis, and on the Y
 *                    axis only blocks a body that is moving DOWN and whose feet
 *                    were already above the platform before the step.
 *
 * Mutates `body` and returns which surfaces were touched.
 */
export function moveAndCollide(body, dx, dy, solids) {
  const touched = { wall: false, ground: false, ceiling: false };
  const hw = body.w / 2, hh = body.h / 2;

  if (dx !== 0) {
    body.x += dx;
    let l = body.x - hw, r = body.x + hw, t = body.y - hh, b = body.y + hh;
    for (const s of solids) {
      if (s.oneWay) continue;
      if (r > s.x && l < s.x + s.w && b > s.y && t < s.y + s.h) {
        body.x = dx > 0 ? s.x - hw - EPS : s.x + s.w + hw + EPS;
        body.vx = 0;
        touched.wall = true;
        l = body.x - hw; r = body.x + hw;
      }
    }
  }

  const prevBottom = body.y + hh;
  if (dy !== 0) {
    body.y += dy;
    body.onGround = false;
    const l = body.x - hw, r = body.x + hw, t = body.y - hh, b = body.y + hh;
    for (const s of solids) {
      if (!(r > s.x && l < s.x + s.w && b > s.y && t < s.y + s.h)) continue;
      if (s.oneWay) {
        if (dy <= 0) continue;                 // moving up: pass through
        if (prevBottom > s.y + 1) continue;    // already inside: pass through
      }
      if (dy > 0) {
        body.y = s.y - hh - EPS;
        body.vy = 0;
        body.onGround = true;
        touched.ground = true;
      } else {
        body.y = s.y + s.h + hh + EPS;
        body.vy = 0;
        touched.ceiling = true;
      }
      break;
    }
  } else {
    // Zero vertical step still needs a ground probe (e.g. standing perfectly still).
    body.onGround = false;
    const l = body.x - hw, r = body.x + hw, b = body.y + hh;
    for (const s of solids) {
      if (s.oneWay) continue;
      const t = body.y - hh;
      if (r > s.x && l < s.x + s.w && b > s.y - 1 && t < s.y + s.h && b <= s.y + 1.5) {
        body.onGround = true;
        break;
      }
    }
  }

  return touched;
}

/**
 * One movement step for a player, identical on server and client.
 *
 * `input` shape (see docs/PROTOCOL.md):
 *   { x: -1..1, jump: bool, jet: bool, aimX: number, aimY: number }
 *
 * `jump`/`jet` are the same button in the UI: tap on the ground to jump, hold in
 * the air to burn jetpack fuel. We keep them separate here because the Android
 * client exposes a dedicated jetpack button that maps to `jet`.
 *
 * Mutates `p` and returns `{ jetting }`.
 */
export function stepPlayerMovement(p, input, dt, T, solids) {
  const P = T.player;
  const J = T.jetpack;
  const gravity = (P.gravity ?? 2000) * (Number.isFinite(p.gravityScale) ? p.gravityScale : 1);

  const wishX = clamp(input.x ?? 0, -1, 1);
  if (wishX !== 0) p.facing = wishX > 0 ? 1 : -1;

  const accel = p.onGround ? 3600 : 1900;
  const targetVx = wishX * (p.runSpeed ?? P.runSpeed);
  const dq = targetVx - p.vx;
  const maxDq = accel * dt;
  p.vx += clamp(dq, -maxDq, maxDq);

  if (wishX === 0 && p.onGround) {
    p.vx *= Math.pow(0.0009, dt); // ground friction
  } else if (wishX === 0) {
    p.vx *= Math.pow(0.55, dt);   // gentler air drag
  }

  const upHeld = !!(input.jump || input.jet);
  let jetting = false;

  if (upHeld && p.onGround && !p.jumpHeld) {
    p.vy = P.jumpVelocity;
    p.onGround = false;
    p.jumpHeld = true;
  } else if (upHeld && !p.onGround && p.jetFuel > 0) {
    p.vy += J.thrust * dt;
    if (wishX !== 0) p.vx += wishX * J.horizontalThrust * dt;
    p.jetFuel = Math.max(0, p.jetFuel - J.drainPerSecond * (p.jetDrainScale ?? 1) * dt);
    jetting = true;
  }
  if (!upHeld) p.jumpHeld = false;

  if (jetting) {
    p.jetIdle = 0;
  } else {
    p.jetIdle = (p.jetIdle ?? 0) + dt;
    // Recharge on the ground immediately, or in the air once the jet has cooled
    // down and the player has stopped asking for thrust. Without the `!upHeld`
    // guard, holding the button at zero fuel would let you hover forever.
    const canRecharge = p.onGround || (p.jetIdle > J.rechargeDelaySeconds && !upHeld);
    if (canRecharge) {
      p.jetFuel = Math.min(p.maxJetFuel ?? J.maxFuel, p.jetFuel + J.rechargePerSecond * dt);
    }
  }

  p.vy += gravity * dt;
  p.vy = clamp(p.vy, J.maxUpSpeed, P.maxFallSpeed);

  moveAndCollide(p, p.vx * dt, p.vy * dt, solids);

  // Aim: server trusts the reported aim point but derives the angle itself.
  if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
    p.aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);
  }

  return { jetting };
}

/** Where does a point travelling (dx,dy) first hit a solid? Marches in <=10px steps. */
export function sweepSolids(x, y, dx, dy, solids, radius = 0) {
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 10));
  const sx = dx / steps, sy = dy / steps;
  let px = x, py = y;
  for (let i = 1; i <= steps; i++) {
    px += sx; py += sy;
    for (const s of solids) {
      if (s.oneWay) continue; // bullets fly through catwalks
      if (px > s.x - radius && px < s.x + s.w + radius &&
          py > s.y - radius && py < s.y + s.h + radius) {
        return { x: px, y: py, hit: true, t: i / steps, solid: s };
      }
    }
  }
  return { x: px, y: py, hit: false, t: 1, solid: null };
}

/** Does a swept point segment pass through an AABB within this step? Slab test. */
export function segmentHitsBox(x0, y0, x1, y1, bx, by, bw, bh) {
  const dx = x1 - x0, dy = y1 - y0;
  let tmin = 0, tmax = 1;
  const axes = [[x0, dx, bx, bw], [y0, dy, by, bh]];
  for (const [o, d, b0, b1] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < b0 || o > b1) return false;
    } else {
      let t1 = (b0 - o) / d, t2 = (b1 - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/**
 * Entry parameter `t` in [0,1] where segment (x0,y0)->(x1,y1) first enters the
 * box, or null if it misses. Used by bullets so a fast round cannot tunnel
 * through a thin platform in one 60 Hz step.
 */
export function segmentBoxT(x0, y0, x1, y1, bx, by, bw, bh) {
  const dx = x1 - x0, dy = y1 - y0;
  let tmin = 0, tmax = 1;
  const axes = [[x0, dx, bx, bx + bw], [y0, dy, by, by + bh]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Is `target` inside the melee cone from `attacker`? */
export function inMeleeCone(attacker, target, range, halfAngleDeg) {
  const tx = target.x - attacker.x;
  const ty = target.y - attacker.y;
  const d = Math.hypot(tx, ty);
  if (d > range + Math.max(target.w, target.h) / 2) return false;
  const ang = Math.atan2(ty, tx);
  return Math.abs(angleDelta(attacker.aim, ang)) <= (halfAngleDeg * Math.PI) / 180;
}

/** Fire rate gate shared by server and prediction. */
export function canFire(p, weapon, now) {
  if (p.reloadEnd > 0) return false;
  if (p.fireCooldown > 0) return false;
  if ((p.ammo[weapon.id]?.mag ?? 0) <= 0) return false;
  return true;
}

export function shotsPerSecond(weapon) {
  return (weapon.rpm ?? 60) / 60;
}

export function shotInterval(weapon) {
  return 1 / shotsPerSecond(weapon);
}

/** Client-side interpolation helper used for remote players. */
export function interpolateSnapshot(prev, next, t) {
  if (!prev) return { ...next };
  const out = { ...next };
  for (const k of ['x', 'y', 'vx', 'vy', 'a']) {
    if (typeof prev[k] === 'number' && typeof next[k] === 'number') {
      out[k] = lerp(prev[k], next[k], t);
    }
  }
  return out;
}

/** Body AABB as [x, y, w, h] — handy for collision and Android parity tests. */
export function bodyAabb(b) {
  return [b.x - b.w / 2, b.y - b.h / 2, b.w, b.h];
}
