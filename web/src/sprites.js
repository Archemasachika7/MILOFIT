/**
 * Procedural artwork for the web client.
 *
 * Every pixel here is generated at runtime from the palettes in characters.json
 * and the HUD colours in weapons.json. There are no image files, and therefore no
 * third-party art anywhere in the client.
 */

const TAU = Math.PI * 2;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

const GUN_STYLE = {
  basher: 'blade',
  sidearm: 'pistol',
  ripper: 'smg',
  bulldog: 'rifle',
  boomstick: 'shotgun',
  longshot: 'sniper',
  shredder: 'lmg',
  flamer: 'flamer',
  frag: 'grenade',
  rocket: 'launcher',
};

/**
 * The gun, drawn in local body space with the barrel pointing along `angle`.
 * `origin` is the hand position; lengths are chosen so the muzzle roughly sits
 * 18px from the body centre, matching the server's `muzzle()` helper.
 */
export function drawGun(ctx, weapon, angle, palette, { scale = 1 } = {}) {
  if (!weapon) return;
  const style = GUN_STYLE[weapon.id] ?? 'rifle';
  const color = weapon.hud?.color ?? '#cfd8e6';
  const dark = '#1b2231';

  ctx.save();
  ctx.translate(0, 0);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const outline = (fill) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = palette.outline;
    ctx.stroke();
  };

  switch (style) {
    case 'blade': {
      ctx.beginPath();
      ctx.moveTo(6, -2.5);
      ctx.lineTo(26, -1);
      ctx.lineTo(30, 1);
      ctx.lineTo(26, 3);
      ctx.lineTo(6, 2.5);
      ctx.closePath();
      outline('#dfe7f5');
      ctx.fillStyle = color;
      ctx.fillRect(4, -3.5, 7, 7);
      break;
    }
    case 'pistol': {
      roundRect(ctx, 2, -3.5, 16, 7, 2);
      outline(dark);
      ctx.fillStyle = color;
      ctx.fillRect(3, -2.4, 13, 2);
      roundRect(ctx, 4, 2, 6, 9, 2);
      outline(dark);
      break;
    }
    case 'smg': {
      roundRect(ctx, 0, -4, 24, 8, 2.5);
      outline(dark);
      roundRect(ctx, 8, 3, 6, 11, 2);
      outline(dark);
      ctx.fillStyle = color;
      ctx.fillRect(1, -2.6, 21, 2.2);
      break;
    }
    case 'rifle': {
      roundRect(ctx, -2, -3.6, 30, 7.2, 2.5);
      outline(dark);
      roundRect(ctx, 6, 3, 7, 12, 2);
      outline(dark);
      ctx.beginPath();
      ctx.moveTo(-2, -3.6); ctx.lineTo(-8, 0); ctx.lineTo(-2, 3.6); ctx.closePath();
      outline(dark);
      ctx.fillStyle = color;
      ctx.fillRect(0, -2.4, 26, 2);
      break;
    }
    case 'shotgun': {
      roundRect(ctx, -3, -4.4, 32, 4.4, 2);
      outline(dark);
      roundRect(ctx, -3, 0.4, 30, 4, 2);
      outline(dark);
      roundRect(ctx, 4, 4, 8, 10, 2);
      outline(dark);
      ctx.fillStyle = color;
      ctx.fillRect(0, -3.4, 28, 1.8);
      break;
    }
    case 'sniper': {
      roundRect(ctx, -6, -3.2, 42, 6.4, 2.5);
      outline(dark);
      roundRect(ctx, 8, -9, 12, 6, 2);        // scope
      outline(dark);
      roundRect(ctx, 6, 3, 7, 11, 2);
      outline(dark);
      ctx.fillStyle = color;
      ctx.fillRect(-2, -1.6, 34, 1.6);
      break;
    }
    case 'lmg': {
      roundRect(ctx, -3, -5.2, 30, 10.4, 3);
      outline(dark);
      roundRect(ctx, 4, 4, 10, 14, 3);
      outline(dark);
      ctx.beginPath();
      ctx.arc(12, 10, 9, 0, TAU);
      ctx.lineWidth = 2;
      ctx.strokeStyle = dark;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(0, -3.4, 26, 2.4);
      break;
    }
    case 'flamer': {
      roundRect(ctx, 0, -4, 22, 8, 3);
      outline(dark);
      ctx.beginPath();
      ctx.moveTo(22, -3);
      ctx.lineTo(30, -5.5);
      ctx.lineTo(30, 5.5);
      ctx.lineTo(22, 3);
      ctx.closePath();
      outline(color);
      break;
    }
    case 'launcher': {
      roundRect(ctx, -6, -5.6, 38, 11.2, 4);
      outline(dark);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(28, 0, 4.6, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = dark;
      ctx.stroke();
      break;
    }
    case 'grenade': {
      ctx.beginPath();
      ctx.arc(6, 0, 5, 0, TAU);
      outline('#4d6b3c');
      break;
    }
    default: {
      roundRect(ctx, 0, -3, 20, 6, 2);
      outline(dark);
    }
  }
  ctx.restore();
}

/**
 * The soldier. Origin is the centre of the AABB (30x46 by default), +y is down,
 * so the body spans y = -23 (head) .. +23 (feet).
 */
export function drawSoldier(ctx, opts) {
  const {
    x, y,
    facing = 1,
    aim = 0,
    palette,
    weapon = null,
    walk = 0,
    jetting = false,
    onGround = true,
    vy = 0,
    reloading = false,
    protectedNow = false,
    alpha = 1,
    scale = 1,
    dead = false,
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);
  if (dead) ctx.rotate(0);

  const outline = palette.outline;
  const lineW = 5.2;
  const localAim = Math.atan2(Math.sin(aim), facing * Math.cos(aim));

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ---- legs (walk cycle driven by a phase the renderer accumulates) ---------
  const swing = onGround && !jetting ? Math.sin(walk) * 7 : (jetting ? 2.5 : 4);
  const lift = onGround && !jetting ? Math.abs(Math.cos(walk)) * 3 : 5;
  const legColor = palette.limbs;

  const drawLeg = (hipX, footX, footY) => {
    ctx.beginPath();
    ctx.moveTo(hipX, 4);
    ctx.lineTo(footX, footY);
    ctx.lineWidth = lineW + 1.6;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.lineWidth = lineW;
    ctx.strokeStyle = legColor;
    ctx.stroke();
  };

  if (jetting || !onGround) {
    drawLeg(-2, -7 - swing * 0.2, 22);
    drawLeg(2, 7 + swing * 0.2, 22);
  } else {
    drawLeg(-2, -2 + swing, 22 - Math.max(0, swing) * 0.55);
    drawLeg(2, 2 - swing, 22 - Math.max(0, -swing) * 0.55);
  }

  // ---- jetpack (behind the torso) ------------------------------------------
  if (jetting) {
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 6);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fillStyle = '#2c3648';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = outline;
    ctx.stroke();

    const flame = 10 + Math.random() * 9 + Math.min(10, Math.abs(vy) / 60);
    const grad = ctx.createLinearGradient(-7, 8, -7, 8 + flame);
    grad.addColorStop(0, '#fff3b0');
    grad.addColorStop(0.45, '#ffb703');
    grad.addColorStop(1, 'rgba(255, 74, 0, 0)');
    ctx.beginPath();
    ctx.moveTo(-9, 8);
    ctx.quadraticCurveTo(-6.5, 8 + flame * 0.7, -6.5, 8 + flame);
    ctx.quadraticCurveTo(-5.5, 8 + flame * 0.7, -4, 8);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ---- torso ---------------------------------------------------------------
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -8);
  ctx.lineWidth = lineW + 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.lineWidth = lineW + 1;
  ctx.strokeStyle = palette.torso;
  ctx.stroke();

  // accent sash
  ctx.beginPath();
  ctx.moveTo(-3.4, -2);
  ctx.lineTo(3.4, 2.5);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();

  // ---- arms + weapon -------------------------------------------------------
  const shoulder = { x: 0, y: -7 };
  const armLen = 15;
  const hand = {
    x: shoulder.x + Math.cos(localAim) * armLen,
    y: shoulder.y + Math.sin(localAim) * armLen,
  };

  const drawArm = (fromX, fromY, toX, toY) => {
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineWidth = lineW - 0.6 + 1.6;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.lineWidth = lineW - 0.6;
    ctx.strokeStyle = palette.limbs;
    ctx.stroke();
  };

  drawArm(shoulder.x - 1, shoulder.y + 1, shoulder.x + Math.cos(localAim - 0.5) * 7, shoulder.y + 4);
  drawArm(shoulder.x, shoulder.y, hand.x, hand.y);

  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(localAim);
  if (reloading) {
    ctx.rotate(0.5);
    ctx.translate(0, 3);
  }
  ctx.translate(-hand.x, -hand.y);
  ctx.translate(hand.x, hand.y);
  drawGun(ctx, weapon, 0, palette, { scale: 1 });
  ctx.restore();

  // ---- head ----------------------------------------------------------------
  ctx.beginPath();
  ctx.arc(0, -14, 7.2, 0, TAU);
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = outline;
  ctx.stroke();

  // helmet / visor accent, mirrored with the body
  ctx.beginPath();
  ctx.arc(0, -15.4, 7.1, Math.PI * 1.06, Math.PI * 2.02);
  ctx.lineTo(6.6, -13.4);
  ctx.closePath();
  ctx.fillStyle = palette.torso;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2.4, -14.6);
  ctx.lineTo(7.0, -13.8);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();

  if (protectedNow) {
    ctx.beginPath();
    ctx.arc(0, -4, 26, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(126, 224, 255, 0.75)';
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -performance.now() / 90;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

export function drawPickup(ctx, pickup, t, pickupTypes) {
  const meta = pickupTypes?.[pickup.t] ?? { color: '#ffd166' };
  const bob = Math.sin(t * 2.6 + pickup.x * 0.01) * 3;
  const y = pickup.y + bob;
  ctx.save();
  ctx.translate(pickup.x, y);

  const pulse = 0.72 + Math.sin(t * 3.4) * 0.1;
  const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  halo.addColorStop(0, `${meta.color}66`);
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, TAU);
  ctx.fill();

  ctx.globalAlpha = pulse;
  ctx.rotate(t * 0.9);
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(13, 0);
  ctx.lineTo(0, 13);
  ctx.lineTo(-13, 0);
  ctx.closePath();
  ctx.fillStyle = meta.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10, 14, 24, .85)';
  ctx.stroke();
  ctx.rotate(-t * 0.9);

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#08111c';
  ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyph = pickup.t === 'health' ? '+' : pickup.t === 'shield' ? '◈' : pickup.t === 'ammo' ? '⁙' : '✦';
  ctx.fillText(glyph, 0, 0.5);
  ctx.restore();
}

/** The empty home pad, drawn while a team's flag is out in the field. */
export function drawFlagBase(ctx, x, y, color, t) {
  const pulse = 0.34 + Math.sin(t * 2.2) * 0.12;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.ellipse(0, 6, 26, 9, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = pulse * 0.5;
  ctx.beginPath();
  ctx.ellipse(0, 6, 14, 5, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Capture-the-flag banner. A carried flag is slung back over the runner's
 * shoulder; a planted one ripples where it stands.
 */
export function drawFlag(ctx, flag, t, color, carried) {
  ctx.save();
  ctx.translate(flag.x, flag.y);

  if (carried) {
    ctx.rotate(-0.38);
    ctx.translate(-4, -2);
  } else if (flag.atBase) {
    const halo = ctx.createRadialGradient(0, -22, 3, 0, -22, 46);
    halo.addColorStop(0, `${color}55`);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -22, 46, 0, TAU);
    ctx.fill();
  }

  const len = carried ? 30 : 50;

  ctx.strokeStyle = 'rgba(8, 12, 20, .9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.lineTo(0, -len);
  ctx.stroke();
  ctx.strokeStyle = '#c9d6ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, -len);
  ctx.stroke();

  const wave = Math.sin(t * 3.4 + flag.x * 0.02) * 3;
  ctx.beginPath();
  ctx.moveTo(0, -len);
  ctx.quadraticCurveTo(14, -len + 6 + wave, 27, -len + 10 + wave);
  ctx.lineTo(27, -len + 25 + wave);
  ctx.quadraticCurveTo(14, -len + 21 + wave, 0, -len + 26);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(8, 12, 20, .8)';
  ctx.stroke();

  ctx.restore();
}

/** Bullet / flame / rocket / grenade visuals. */
export function drawProjectile(ctx, b, t) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.a ?? Math.atan2(b.vy ?? 0, b.vx ?? 0));

  if (b.k === 'flame') {
    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, 12);
    grad.addColorStop(0, 'rgba(255, 245, 200, .95)');
    grad.addColorStop(0.45, 'rgba(255, 150, 40, .8)');
    grad.addColorStop(1, 'rgba(255, 60, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
  } else if (b.k === 'grenade') {
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.fillStyle = '#3f5230';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#151b26';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, TAU);
    ctx.fillStyle = '#f2e14c';
    ctx.fill();
  } else if (b.k === 'projectile') {
    const grad = ctx.createLinearGradient(-16, 0, 8, 0);
    grad.addColorStop(0, 'rgba(255, 140, 60, 0)');
    grad.addColorStop(1, 'rgba(255, 180, 80, .95)');
    ctx.fillStyle = grad;
    ctx.fillRect(-18, -2.4, 22, 4.8);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(0, -4.4);
    ctx.lineTo(0, 4.4);
    ctx.closePath();
    ctx.fillStyle = '#ff6b35';
    ctx.fill();
  } else {
    const len = Math.min(30, 12 + Math.hypot(b.vx ?? 0, b.vy ?? 0) / 90);
    const grad = ctx.createLinearGradient(-len, 0, 4, 0);
    grad.addColorStop(0, 'rgba(255, 236, 160, 0)');
    grad.addColorStop(1, 'rgba(255, 246, 200, .95)');
    ctx.fillStyle = grad;
    ctx.fillRect(-len, -1.5, len + 4, 3);
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, TAU);
    ctx.fillStyle = '#fff8dc';
    ctx.fill();
  }
  ctx.restore();
}

/** Small soldier preview for the character picker. */
export function renderCharacterPreview(canvas, character, weapon) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 62, h = 74;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawSoldier(ctx, {
    x: w / 2 - 2,
    y: h / 2 + 4,
    facing: 1,
    aim: -0.5,
    palette: character.palette,
    weapon: weapon ?? null,
    walk: 0.8,
    onGround: true,
    scale: 1,
  });
}
