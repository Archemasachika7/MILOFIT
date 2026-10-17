// MILOFIT - original 2D platform shooter. All graphics are drawn in code; no third-party assets.
(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  const GRAVITY = 0.6, MAX_FALL = 14, MOVE_SPEED = 4.2, JUMP_V = -11;
  const JET_ACCEL = 0.9, JET_MAX = 100, JET_USE = 1.4, JET_REGEN = 0.6;
  const MAX_HP = 100, RESPAWN_MS = 2000;

  const keys = {};
  const mouse = { x: W / 2, y: H / 2, down: false };
  let map, weaponKey, players, bullets, particles, lastTime = 0, score = { you: 0, bots: 0 };

  // ---- UI setup ----
  const mapSel = document.getElementById("map");
  const wepSel = document.getElementById("weapon");
  Object.keys(MAPS).forEach(k => mapSel.add(new Option(k, k)));
  Object.keys(WEAPONS).forEach(k => wepSel.add(new Option(WEAPONS[k].name, k)));
  mapSel.onchange = () => reset();
  wepSel.onchange = () => { weaponKey = wepSel.value; reset(); };
  document.getElementById("restart").onclick = () => reset();

  function makePlayer(id, isBot, spawn, weapon) {
    return {
      id, isBot, x: spawn.x, y: spawn.y, w: 22, h: 34, vx: 0, vy: 0,
      onGround: false, facing: 1, hp: MAX_HP, jet: JET_MAX,
      weapon: weapon, ammo: weapon.magSize, reloading: 0, lastShot: 0,
      dead: false, respawnAt: 0, aimX: 0, aimY: 0, color: isBot ? "#ff7b72" : "#56d364",
      botTimer: 0
    };
  }

  function reset() {
    map = MAPS[mapSel.value];
    weaponKey = wepSel.value;
    bullets = []; particles = [];
    const w = WEAPONS[weaponKey];
    const sp = map.spawns;
    players = [makePlayer("you", false, sp[0], w)];
    for (let i = 1; i < sp.length; i++) {
      players.push(makePlayer("bot" + i, true, sp[i], WEAPONS.Pistol));
    }
  }

  // ---- Physics ----
  function collides(x, y, w, h) {
    for (const p of map.platforms) {
      if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) return true;
    }
    return false;
  }

  function moveEntity(e) {
    // horizontal
    e.x += e.vx;
    if (collides(e.x, e.y, e.w, e.h)) {
      e.x -= e.vx;
      e.vx = 0;
    }
    // vertical
    e.onGround = false;
    e.y += e.vy;
    if (collides(e.x, e.y, e.w, e.h)) {
      if (e.vy > 0) e.onGround = true;
      e.y -= e.vy;
      e.vy = 0;
    }
    e.x = Math.max(0, Math.min(W - e.w, e.x));
    if (e.y > H) { e.hp = 0; }
  }

  function physicsPlayer(p, dt) {
    if (p.dead) return;
    p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
    if (p.onGround) p.jet = Math.min(JET_MAX, p.jet + JET_REGEN * 2);
    else p.jet = Math.min(JET_MAX, p.jet + JET_REGEN * 0.3);
    moveEntity(p);
    if (p.hp <= 0) killPlayer(p);
  }

  // ---- Actions ----
  function shoot(p, now) {
    const w = p.weapon;
    if (p.reloading > 0 || p.ammo <= 0) { if (p.ammo <= 0) startReload(p, now); return; }
    if (now - p.lastShot < w.cooldown) return;
    p.lastShot = now;
    p.ammo--;
    const ax = p.aimX - (p.x + p.w / 2), ay = p.aimY - (p.y + p.h / 3);
    const base = Math.atan2(ay, ax);
    for (let i = 0; i < w.pellets; i++) {
      const a = base + (Math.random() - 0.5) * 2 * w.spread;
      bullets.push({
        x: p.x + p.w / 2, y: p.y + p.h / 3,
        vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        dmg: w.damage, owner: p, life: 90, color: w.color
      });
    }
    if (p.ammo === 0) startReload(p, now);
  }

  function startReload(p, now) {
    if (p.reloading > 0) return;
    p.reloading = now + p.weapon.reloadMs;
  }

  function killPlayer(p) {
    if (p.dead) return;
    p.dead = true;
    p.respawnAt = performance.now() + RESPAWN_MS;
    for (let i = 0; i < 20; i++) {
      particles.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 1) * 8, life: 40, color: p.color });
    }
    if (p.isBot) score.you++; else score.bots++;
  }

  function respawn(p) {
    const sp = map.spawns[Math.floor(Math.random() * map.spawns.length)];
    p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
    p.hp = MAX_HP; p.jet = JET_MAX; p.dead = false; p.ammo = p.weapon.magSize; p.reloading = 0;
  }

  function botAI(b, now, target) {
    if (!target || target.dead) return;
    const dx = target.x - b.x;
    b.facing = dx >= 0 ? 1 : -1;
    b.vx = Math.abs(dx) > 160 ? Math.sign(dx) * 2 : 0;
    if (target.y < b.y - 60 && b.onGround) b.vy = JUMP_V;
    b.aimX = target.x + target.w / 2; b.aimY = target.y + target.h / 3;
    if (Math.abs(dx) < 500) shoot(b, now);
  }

  // ---- Update ----
  function update(dt, now) {
    const you = players[0];
    if (!you.dead) {
      let ax = 0;
      if (keys["a"] || keys["ArrowLeft"]) ax -= 1;
      if (keys["d"] || keys["ArrowRight"]) ax += 1;
      you.vx = ax * MOVE_SPEED;
      if (ax) you.facing = ax;
      if ((keys["w"] || keys["ArrowUp"] || keys[" "]) && you.onGround) you.vy = JUMP_V;
      if ((keys["w"] || keys["ArrowUp"] || keys[" "]) && !you.onGround && you.jet > 0) {
        you.vy -= JET_ACCEL; you.jet -= JET_USE;
      }
      you.aimX = mouse.x; you.aimY = mouse.y;
      if (mouse.down || keys["f"]) {
        if (WEAPONS[weaponKey].auto || !you._fired) {
          shoot(you, now);
          you._fired = true;
        }
      } else you._fired = false;
      if (keys["r"]) startReload(you, now);
    }

    for (const p of players) {
      if (p.isBot && !p.dead) botAI(p, now, you);
      if (p.reloading && now >= p.reloading) {
        p.ammo = p.weapon.magSize; p.reloading = 0;
      }
      physicsPlayer(p, dt);
      if (p.dead && performance.now() >= p.respawnAt) respawn(p);
    }

    for (const b of bullets) {
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || collides(b.x, b.y, 2, 2)) { b.life = 0; continue; }
      for (const p of players) {
        if (p === b.owner || p.dead) continue;
        if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
          p.hp -= b.dmg; b.life = 0;
          if (p.hp <= 0) killPlayer(p);
          break;
        }
      }
    }
    bullets = bullets.filter(b => b.life > 0);

    for (const q of particles) { q.x += q.vx; q.y += q.vy; q.vy += 0.3; q.life--; }
    particles = particles.filter(q => q.life > 0);
  }

  // ---- Render ----
  function draw() {
    ctx.fillStyle = "#1b2433"; ctx.fillRect(0, 0, W, H);
    // background decoration: simple gradient bands
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#22304a"); g.addColorStop(1, "#11182a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#3b4a63";
    for (const p of map.platforms) ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = "#56627a";
    for (const p of map.platforms) ctx.fillRect(p.x, p.y, p.w, 4);

    for (const p of players) {
      if (p.dead) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(p.x + (p.facing > 0 ? 12 : 2), p.y + 7, 8, 6); // visor
      // gun
      const cx = p.x + p.w / 2, cy = p.y + p.h / 3;
      const a = Math.atan2(p.aimY - cy, p.aimX - cx);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.fillStyle = p.weapon.color; ctx.fillRect(0, -3, 18, 6);
      ctx.restore();
      // hp bar
      ctx.fillStyle = "#30363d"; ctx.fillRect(p.x - 4, p.y - 10, p.w + 8, 4);
      ctx.fillStyle = "#56d364"; ctx.fillRect(p.x - 4, p.y - 10, (p.w + 8) * Math.max(0, p.hp) / MAX_HP, 4);
    }

    for (const b of bullets) { ctx.fillStyle = b.color; ctx.fillRect(b.x - 2, b.y - 2, 4, 4); }
    for (const q of particles) { ctx.globalAlpha = q.life / 40; ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, 4, 4); }
    ctx.globalAlpha = 1;

    // HUD
    const you = players[0];
    ctx.fillStyle = "#e6edf3"; ctx.font = "14px system-ui";
    ctx.fillText(`HP ${Math.max(0, you.hp)}  Jet ${Math.round(you.jet)}  Ammo ${you.ammo}/${you.weapon.magSize}${you.reloading ? " (reloading)" : ""}`, 12, 20);
    ctx.fillText(`${you.weapon.name}  Score ${score.you} - ${score.bots}`, 12, 38);
    ctx.fillStyle = "#30363d"; ctx.fillRect(12, 46, 120, 6);
    ctx.fillStyle = "#79c0ff"; ctx.fillRect(12, 46, 120 * you.jet / JET_MAX, 6);
    if (you.dead) {
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e6edf3"; ctx.font = "28px system-ui";
      ctx.fillText("Respawning...", W / 2 - 90, H / 2);
    }
  }

  // ---- Input ----
  window.addEventListener("keydown", e => {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
    if (["1", "2", "3"].includes(e.key)) {
      const name = Object.keys(WEAPONS)[Number(e.key) - 1];
      wepSel.value = name; weaponKey = name; reset();
    }
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
  });
  canvas.addEventListener("mousedown", () => mouse.down = true);
  window.addEventListener("mouseup", () => mouse.down = false);

  // ---- Loop ----
  function frame(t) {
    const dt = Math.min(50, t - lastTime || 16);
    lastTime = t;
    update(dt, t);
    draw();
    requestAnimationFrame(frame);
  }

  for (const k of Object.keys(MAPS)) { /* maps loaded in dropdown */ }
  weaponKey = "Pistol";
  wepSel.value = weaponKey;
  reset();
  requestAnimationFrame(frame);
})();
