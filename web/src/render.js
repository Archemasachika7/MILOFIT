/**
 * World renderer. HUD lives in the DOM (see index.html + main.js); this module
 * draws the arena, actors, projectiles and transient effects.
 */
import { drawSoldier, drawPickup, drawProjectile, drawGun, drawFlag, drawFlagBase } from './sprites.js';

const TEAM_COLOR = { red: '#ff6b6b', blue: '#6bb8ff', ffa: '#cfe0f5' };

export class Renderer {
  constructor(canvas, content) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.content = content;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.weaponById = new Map(content.weapons.map((w) => [w.id, w]));
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
  }

  /** Recommended camera scale so the useful play area fills the viewport. */
  preferredZoom(worldHeight) {
    const byHeight = this.height / Math.max(560, worldHeight * 0.62);
    return Math.max(0.55, Math.min(1.9, byHeight));
  }

  applyCamera(camera, shake) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(shake?.roll ?? 0);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x + (shake?.x ?? 0), -camera.y + (shake?.y ?? 0));
  }

  screenToWorld(sx, sy, camera) {
    return {
      x: (sx - this.width / 2) / camera.zoom + camera.x,
      y: (sy - this.height / 2) / camera.zoom + camera.y,
    };
  }

  // ---------------------------------------------------------------- the world

  drawBackground(map, camera, time) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = map.ambient?.sky ?? ['#101a2e', '#1c2f4a'];
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, sky[0]);
    grad.addColorStop(1, sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Parallax grid — gives the sense of depth without any assets.
    const gridColor = map.ambient?.grid ?? '#22334f';
    const cell = 90;
    const ox = ((-camera.x * 0.45) % cell + cell) % cell;
    const oy = ((-camera.y * 0.45) % cell + cell) % cell;
    ctx.strokeStyle = gridColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox - cell; x < this.width + cell; x += cell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (let y = oy - cell; y < this.height + cell; y += cell) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Soft glow bloom for the map's accent colour.
    const glow = map.ambient?.glow;
    if (glow) {
      const g = ctx.createRadialGradient(
        this.width * 0.5, this.height * 0.35, 10,
        this.width * 0.5, this.height * 0.35, this.width * 0.8,
      );
      g.addColorStop(0, `${glow}22`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawMap(map, time) {
    const { ctx } = this;

    for (const d of map.decorations ?? []) this.drawDecoration(d, time);

    for (const s of map.solids ?? []) {
      if (s.oneWay) {
        const grad = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
        grad.addColorStop(0, '#5b6f92');
        grad.addColorStop(1, '#2c3a52');
        ctx.fillStyle = grad;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = map.ambient?.glow ? `${map.ambient.glow}aa` : 'rgba(140,180,255,.6)';
        ctx.fillRect(s.x, s.y, s.w, 2);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(s.x, s.y + s.h - 2, s.w, 2);
        // strap detail
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        for (let x = s.x + 14; x < s.x + s.w - 8; x += 46) ctx.fillRect(x, s.y + 4, 4, s.h - 8);
      } else if (s.type === 'ground') {
        const grad = ctx.createLinearGradient(0, s.y, 0, s.y + Math.min(s.h, 220));
        grad.addColorStop(0, '#3b4a66');
        grad.addColorStop(0.14, '#2a3650');
        grad.addColorStop(1, '#161e2e');
        ctx.fillStyle = grad;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#7f96bd';
        ctx.fillRect(s.x, s.y, s.w, 3);
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        for (let y = s.y + 16; y < s.y + s.h; y += 34) ctx.fillRect(s.x, y, s.w, 1);
      } else {
        ctx.fillStyle = '#212c42';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#3a4864';
        ctx.fillRect(s.x, s.y, s.w, 3);
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        for (let y = s.y + 24; y < s.y + s.h; y += 44) ctx.fillRect(s.x, y, s.w, 2);
      }
    }

    // Arena border so the playfield reads clearly.
    ctx.strokeStyle = 'rgba(120,160,220,.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, map.size.width, map.size.height);
  }

  drawDecoration(d, time) {
    const { ctx } = this;
    switch (d.type) {
      case 'pylon': {
        ctx.fillStyle = d.color ?? '#2b5aa0';
        ctx.fillRect(d.x - 12, d.y - (d.h ?? 160), 24, d.h ?? 160);
        ctx.fillStyle = 'rgba(255,255,255,.14)';
        ctx.fillRect(d.x - 12, d.y - (d.h ?? 160), 6, d.h ?? 160);
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.beginPath();
        ctx.arc(d.x, d.y - (d.h ?? 160) - 8, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'girder': {
        ctx.strokeStyle = d.color ?? '#5c4632';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + (d.w ?? 100), d.y);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let x = d.x; x < d.x + (d.w ?? 100); x += 26) {
          ctx.beginPath();
          ctx.moveTo(x, d.y - 7);
          ctx.lineTo(x + 13, d.y + 7);
          ctx.lineTo(x + 26, d.y - 7);
          ctx.stroke();
        }
        break;
      }
      case 'stalactite': {
        const h = d.h ?? 140;
        ctx.beginPath();
        ctx.moveTo(d.x - 22, d.y);
        ctx.lineTo(d.x + 22, d.y);
        ctx.lineTo(d.x, d.y + h);
        ctx.closePath();
        ctx.fillStyle = d.color ?? '#243352';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        ctx.beginPath();
        ctx.moveTo(d.x - 22, d.y);
        ctx.lineTo(d.x - 6, d.y);
        ctx.lineTo(d.x, d.y + h);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'glow': {
        const g = ctx.createRadialGradient(d.x, d.y, 4, d.x, d.y, d.radius ?? 240);
        g.addColorStop(0, `${d.color ?? '#4cc9f0'}${Math.round((d.alpha ?? 0.1) * 255).toString(16).padStart(2, '0')}`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius ?? 240, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sign': {
        ctx.save();
        ctx.globalAlpha = 0.5 + Math.sin(time * 1.8) * 0.14;
        ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#9fb6dd';
        ctx.letterSpacing = '8px';
        ctx.fillText(d.text ?? '', d.x, d.y);
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }

  drawPickups(pickups, time) {
    for (const pk of pickups) drawPickup(this.ctx, pk, time, this.content.pickupTypes);
  }

  /**
   * Capture-the-flag banners. `flags` comes from buildFlagViews(): each entry
   * already carries the position it should be drawn at, so a carried flag sits
   * on its runner and a loose one stays put.
   */
  drawFlags(flags, time) {
    for (const f of flags) {
      const color = f.team === 'red' ? '#ff5d5d' : '#4cc9f0';
      if (!f.atBase) drawFlagBase(this.ctx, f.bx, f.by, color, time);
      drawFlag(this.ctx, f, time, color, f.carried);
    }
  }

  drawBullets(bullets) {
    for (const b of bullets) drawProjectile(this.ctx, b, performance.now() / 1000);
  }

  drawPlayer(view, { isLocal, time }) {
    const { ctx } = this;
    const weapon = view.weaponId ? this.weaponById.get(view.weaponId) : null;

    if (view.protectedNow) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#7ee0ff';
      ctx.beginPath();
      ctx.arc(view.x, view.y, 34 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawSoldier(ctx, {
      x: view.x,
      y: view.y,
      facing: view.facing,
      aim: view.aim,
      palette: view.palette,
      weapon,
      walk: view.walk,
      jetting: view.jetting,
      onGround: view.onGround,
      vy: view.vy,
      reloading: view.reloading,
      protectedNow: view.protectedNow,
      alpha: view.alive ? 1 : 0.32,
      scale: 1,
    });

    if (!view.alive) return;

    // ---- nameplate ---------------------------------------------------------
    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = view.name ?? '';
    const teamColor = TEAM_COLOR[view.team] ?? TEAM_COLOR.ffa;
    const barW = 46;
    const y = view.y - 34;

    if (isLocal) ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'rgba(6,10,18,.72)';
    ctx.fillRect(view.x - barW / 2 - 1, y - 2, barW + 2, 5);
    ctx.fillStyle = view.hp > 45 ? '#a8e063' : view.hp > 22 ? '#ffd166' : '#e63946';
    ctx.fillRect(view.x - barW / 2, y - 1, (barW * Math.max(0, view.hp)) / 100, 3);
    if (view.shield > 0) {
      ctx.fillStyle = '#4cc9f0';
      ctx.fillRect(view.x - barW / 2, y + 2.5, (barW * Math.min(50, view.shield)) / 50, 1.6);
    }

    ctx.globalAlpha = isLocal ? 1 : 0.92;
    ctx.fillStyle = teamColor;
    ctx.fillText(label, view.x, y - 5);
    ctx.restore();
  }

  drawWeaponHeldPreview() { /* reserved for a future loadout screen */ }

  // --------------------------------------------------------------- effects

  drawEffects(effects) {
    const { ctx } = this;
    for (const fx of effects) {
      const k = fx.t / fx.life;
      const alpha = 1 - k;
      ctx.save();
      switch (fx.type) {
        case 'explosion': {
          ctx.globalAlpha = alpha * 0.85;
          const r = fx.radius * (0.35 + k * 0.75);
          const g = ctx.createRadialGradient(fx.x, fx.y, 2, fx.x, fx.y, r);
          g.addColorStop(0, 'rgba(255,248,210,.95)');
          g.addColorStop(0.35, 'rgba(255,160,60,.7)');
          g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = alpha * 0.6;
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 3 * (1 - k);
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r * 1.05, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'impact': {
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = fx.flesh ? '#ff8a5c' : '#ffeaa7';
          for (let i = 0; i < 4; i++) {
            const a = fx.seed + (i * Math.PI) / 2;
            const d = 6 + k * 16;
            ctx.beginPath();
            ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 1.8 * alpha, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'muzzle': {
          ctx.globalAlpha = alpha * 0.9;
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          const g = ctx.createLinearGradient(0, 0, 26, 0);
          g.addColorStop(0, 'rgba(255,246,190,.95)');
          g.addColorStop(1, 'rgba(255,150,40,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, -5 * (1 - k) - 1);
          ctx.lineTo(26 * (1 - k * 0.4), 0);
          ctx.lineTo(0, 5 * (1 - k) + 1);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'damage': {
          ctx.globalAlpha = alpha;
          ctx.translate(fx.x, fx.y - k * 34);
          ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(6,10,18,.85)';
          ctx.strokeText(fx.value, 0, 0);
          ctx.fillStyle = fx.shield ? '#7ee0ff' : '#ffe066';
          ctx.fillText(fx.value, 0, 0);
          break;
        }
        case 'ring': {
          ctx.globalAlpha = alpha * 0.7;
          ctx.strokeStyle = fx.color ?? '#4cc9f0';
          ctx.lineWidth = 3 * alpha;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.radius * k, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
      ctx.restore();
    }
  }

  drawCrosshair(x, y, hitMarker, ready) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = hitMarker > 0 ? '#ff6b6b' : ready ? 'rgba(240,248,255,.9)' : 'rgba(240,248,255,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-11, 0); ctx.lineTo(-4, 0);
    ctx.moveTo(4, 0); ctx.lineTo(11, 0);
    ctx.moveTo(0, -11); ctx.lineTo(0, -4);
    ctx.moveTo(0, 4); ctx.lineTo(0, 11);
    ctx.stroke();
    if (hitMarker > 0) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2.4;
      const s = 6 + hitMarker * 4;
      ctx.beginPath();
      ctx.moveTo(-s, -s); ctx.lineTo(-s + 5, -s + 5);
      ctx.moveTo(s, -s); ctx.lineTo(s - 5, -s + 5);
      ctx.moveTo(-s, s); ctx.lineTo(-s + 5, s - 5);
      ctx.moveTo(s, s); ctx.lineTo(s - 5, s - 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Off-screen arrows pointing at living opponents. */
  drawOffscreenMarkers(views, camera, local) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const margin = 34;
    for (const v of views) {
      if (!v.alive || v.id === local?.id) continue;
      const sx = (v.x - camera.x) * camera.zoom + this.width / 2;
      const sy = (v.y - camera.y) * camera.zoom + this.height / 2;
      if (sx > margin && sx < this.width - margin && sy > margin && sy < this.height - margin) continue;
      const cx = Math.max(margin, Math.min(this.width - margin, sx));
      const cy = Math.max(margin, Math.min(this.height - margin, sy));
      const angle = Math.atan2(sy - this.height / 2, sx - this.width / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = TEAM_COLOR[v.team] ?? TEAM_COLOR.ffa;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-5, -6);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  clear() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
