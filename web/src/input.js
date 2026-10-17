/**
 * Keyboard + mouse + touch + gamepad input, collapsed into one input frame per
 * tick. The frame shape is exactly what the server's normalizeInput() expects:
 *
 *   { x, jump, jet, fire, aim: {x, y}, actions: [...] }
 *
 * `aim` is a world-space point; main.js supplies `toWorld()` so the controller
 * never has to know about the camera.
 */

const ACTION_KEYS = {
  KeyQ: 'melee',
  KeyF: 'grenade',
  KeyR: 'reload',
  Digit1: 'switch:0',
  Digit2: 'switch:1',
};

export function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export class InputController {
  constructor({ canvas, toWorld, isTouch }) {
    this.canvas = canvas;
    this.toWorld = toWorld;
    this.isTouch = !!isTouch;

    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false };
    this.actions = [];
    this.enabled = true;
    this.keyboardEnabled = true;
    this.aimFromStick = null;

    this.moveStick = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.aimStick = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.touchButtons = new Map();

    this._bind();
  }

  // ------------------------------------------------------------------ plumbing

  _bind() {
    this.onKeyDown = (e) => {
      if (!this.keyboardEnabled) return;
      if (e.repeat) {
        if (this._isGameKey(e.code)) e.preventDefault();
        return;
      }
      if (this._isGameKey(e.code)) e.preventDefault();
      this.keys.add(e.code);
      const action = ACTION_KEYS[e.code];
      if (action) this.actions.push(action);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onBlur = () => {
      this.keys.clear();
      this.actions.length = 0;
      this.mouse.down = false;
      this.mouse.right = false;
      this.releaseTouch();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.onMouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    };
    this.onMouseDown = (e) => {
      if (e.target !== this.canvas) return;
      if (e.button === 0) this.mouse.down = true;
      else if (e.button === 2) this.actions.push('grenade');
      else if (e.button === 1) {
        this.actions.push('melee');
        e.preventDefault();
      }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouse.down = false;
    };
    this.onContextMenu = (e) => e.preventDefault();
    this.onWheel = (e) => {
      if (!this.keyboardEnabled) return;
      this.actions.push(e.deltaY > 0 ? 'switch:1' : 'switch:0');
      e.preventDefault();
    };

    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('wheel', this.onWheel, { passive: false });

    this._bindTouch();
    this._bindGamepad();
  }

  _isGameKey(code) {
    return (
      code === 'Space' ||
      code === 'Tab' ||
      code.startsWith('Arrow') ||
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
      Object.prototype.hasOwnProperty.call(ACTION_KEYS, code)
    );
  }

  releaseTouch() {
    for (const stick of [this.moveStick, this.aimStick]) {
      stick.active = false;
      stick.id = null;
      stick.x = 0;
      stick.y = 0;
      const el = stick === this.moveStick ? this.moveEl : this.aimEl;
      if (el) el.querySelector('.knob').style.transform = 'translate(0px, 0px)';
    }
    this.touchButtons.clear();
    this.aimFromStick = null;
  }

  _bindTouch() {
    this.moveEl = document.getElementById('stickLeft');
    this.aimEl = document.getElementById('stickRight');
    if (!this.moveEl || !this.aimEl) return;

    const bindStick = (el, stick) => {
      const rectOf = () => el.getBoundingClientRect();
      const update = (e) => {
        const rect = rectOf();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const maxR = rect.width / 2 - 14;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const len = Math.hypot(dx, dy);
        if (len > maxR) {
          dx = (dx / len) * maxR;
          dy = (dy / len) * maxR;
        }
        stick.x = dx / maxR;
        stick.y = dy / maxR;
        el.querySelector('.knob').style.transform = `translate(${dx}px, ${dy}px)`;
      };

      el.addEventListener('pointerdown', (e) => {
        stick.active = true;
        stick.id = e.pointerId;
        el.setPointerCapture(e.pointerId);
        update(e);
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!stick.active || e.pointerId !== stick.id) return;
        update(e);
        e.preventDefault();
      });
      const end = (e) => {
        if (e.pointerId !== stick.id) return;
        stick.active = false;
        stick.id = null;
        stick.x = 0;
        stick.y = 0;
        el.querySelector('.knob').style.transform = 'translate(0px, 0px)';
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    };

    bindStick(this.moveEl, this.moveStick);
    bindStick(this.aimEl, this.aimStick);

    const wrap = document.getElementById('touchButtons');
    if (wrap) {
      for (const button of wrap.querySelectorAll('button')) {
        const action = button.dataset.action;
        button.addEventListener('pointerdown', (e) => {
          this.touchButtons.set(action, true);
          if (action === 'melee' || action === 'grenade' || action === 'reload') {
            this.actions.push(action);
          } else if (action === 'switch') {
            this.actions.push('switch:1');
          }
          e.preventDefault();
        });
        const release = () => this.touchButtons.delete(action);
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
      }
    }
  }

  _bindGamepad() {
    this.gamepad = null;
  }

  pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  // ------------------------------------------------------------------- output

  /** Build the input frame for this tick. World-space aim via `toWorld`. */
  sample(localPlayer) {
    const frame = {
      x: 0,
      jump: false,
      jet: false,
      fire: false,
      aim: { x: 0, y: 0 },
      actions: this.actions,
    };
    this.actions = [];

    if (!this.enabled) return frame;

    const k = this.keys;
    let move = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) move -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) move += 1;

    if (this.moveStick.active) move = this.moveStick.x;
    if (Math.abs(move) < 0.14) move = 0;
    frame.x = Math.max(-1, Math.min(1, move));

    let jump = k.has('KeyW') || k.has('Space') || k.has('ArrowUp');
    if (this.moveStick.active && this.moveStick.y < -0.55) jump = true;
    if (this.touchButtons.has('jet')) jump = true;
    frame.jump = jump;
    frame.jet = jump;

    let aimWorld = null;
    if (this.aimStick.active) {
      const mag = Math.hypot(this.aimStick.x, this.aimStick.y);
      if (mag > 0.22) {
        aimWorld = {
          x: localPlayer.x + (this.aimStick.x / Math.max(mag, 1)) * 420,
          y: localPlayer.y + (this.aimStick.y / Math.max(mag, 1)) * 420,
        };
        frame.fire = true;
      }
    }
    if (!aimWorld && this.isTouch) {
      aimWorld = { x: localPlayer.x + localPlayer.facing * 300, y: localPlayer.y };
    }
    if (!aimWorld) aimWorld = this.toWorld(this.mouse.x, this.mouse.y);

    if (!this.isTouch) frame.fire = this.mouse.down || this.touchButtons.has('fire');

    // ---- gamepad -----------------------------------------------------------
    const pad = this.pollGamepad();
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const stickX = dz(pad.axes[0] ?? 0);
      if (Math.abs(stickX) > Math.abs(frame.x)) frame.x = stickX;
      const up = pad.buttons[0]?.pressed || pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -0.6;
      if (up) { frame.jump = true; frame.jet = true; }
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      if (Math.hypot(rx, ry) > 0.25) {
        aimWorld = { x: localPlayer.x + rx * 420, y: localPlayer.y + ry * 420 };
        frame.fire = true;
      }
      if (pad.buttons[7]?.pressed) frame.fire = true;
      if (pad.buttons[6]?.pressed && !this._padTrigger) this.actions.push('grenade');
      if (pad.buttons[4]?.pressed && !this._padBumper) this.actions.push('melee');
      if (pad.buttons[5]?.pressed && !this._padBumper2) this.actions.push('reload');
      this._padTrigger = pad.buttons[6]?.pressed;
      this._padBumper = pad.buttons[4]?.pressed;
      this._padBumper2 = pad.buttons[5]?.pressed;
    }

    if (Number.isFinite(aimWorld?.x) && Number.isFinite(aimWorld?.y)) {
      frame.aim = aimWorld;
      this.aimFromStick = aimWorld;
    } else if (localPlayer) {
      frame.aim = { x: localPlayer.x + localPlayer.facing * 200, y: localPlayer.y };
    }

    return frame;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('wheel', this.onWheel);
  }
}
