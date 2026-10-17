/**
 * Wire protocol helpers: message names, defensive parsing and validation.
 *
 * The server never trusts a client field. Everything that arrives from a socket
 * goes through one of the `normalize*` functions below, which clamp ranges and
 * drop anything that is not on the whitelist. See docs/PROTOCOL.md.
 */
import { tuning } from './gameData.js';

export const C2S = Object.freeze({
  HELLO: 'hello',
  JOIN: 'join',
  INPUT: 'input',
  CHAT: 'chat',
  TEAM: 'team',
  SETTINGS: 'settings',
  START: 'start',
  PING: 'ping',
  LOADOUT: 'loadout',
});

export const S2C = Object.freeze({
  WELCOME: 'welcome',
  ROOM: 'room',
  ROSTER: 'roster',
  STATE: 'state',
  EVENTS: 'events',
  CHAT: 'chat',
  ERROR: 'error',
  PONG: 'pong',
  MATCH: 'match',
});

export function encode(msg) {
  return JSON.stringify(msg);
}

export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.t !== 'string') return null;
  return value;
}

export function clampNumber(value, lo, hi, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

const RESERVED = /[^\p{L}\p{N} _.\-[\]]/gu;

export function sanitizeName(raw, fallback = 'Recruit') {
  if (typeof raw !== 'string') return fallback;
  const max = tuning.limits.nameMaxLength;
  const cleaned = raw.replace(RESERVED, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned.length >= 1 ? cleaned : fallback;
}

export function sanitizeMessage(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, tuning.limits.chatMaxLength);
  return cleaned.length ? cleaned : null;
}

export function sanitizeCharacter(raw) {
  return typeof raw === 'string' && /^[a-z0-9_]{1,24}$/.test(raw) ? raw : null;
}

export function sanitizeTeam(raw) {
  return raw === 'red' || raw === 'blue' ? raw : 'auto';
}

export function sanitizeMapId(raw) {
  return typeof raw === 'string' && /^[a-z0-9_]{1,32}$/.test(raw) ? raw : null;
}

export function sanitizeModeId(raw) {
  return typeof raw === 'string' && /^[a-z0-9_]{1,16}$/.test(raw) ? raw : null;
}

export function sanitizeMatchFormat(raw) {
  return raw === '1v1' || raw === '2v2' || raw === '4v4' ? raw : null;
}

export function sanitizeRoleMode(raw) {
  return raw === 'roles' || raw === 'free' ? raw : null;
}

export function sanitizeGravityMode(raw) {
  return raw === 'normal' || raw === 'lunar' || raw === 'zero' ? raw : null;
}

export function sanitizeRoleId(raw) {
  return typeof raw === 'string' && Object.hasOwn(tuning.roles ?? {}, raw) ? raw : null;
}

const ACTION_RE = /^(reload|melee|grenade|switch:[01])$/;

/** Accepts an input frame and returns a canonical, clamped copy (never throws). */
export function normalizeInput(msg) {
  const aim = msg.aim && typeof msg.aim === 'object' ? msg.aim : {};
  const actions = [];
  if (Array.isArray(msg.actions)) {
    for (const a of msg.actions.slice(0, 6)) {
      if (typeof a === 'string' && ACTION_RE.test(a)) actions.push(a);
    }
  }
  return {
    x: clampNumber(msg.x, -1, 1, 0),
    jump: msg.jump === true,
    jet: msg.jet === true,
    fire: msg.fire === true,
    aimX: clampNumber(aim.x ?? msg.ax, -1e6, 1e6, 0),
    aimY: clampNumber(aim.y ?? msg.ay, -1e6, 1e6, 0),
    seq: clampNumber(msg.seq, 0, 2 ** 31, 0) | 0,
    rtt: clampNumber(msg.rtt, 0, 2000, 0) | 0,
    actions,
  };
}

export function emptyInput() {
  return { x: 0, jump: false, jet: false, fire: false, aimX: 0, aimY: 0, seq: 0, rtt: 0, actions: [] };
}
