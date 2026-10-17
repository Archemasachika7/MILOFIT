/**
 * Loads the single source of truth for game content from shared/game-data.
 * Every consumer (server, web, Android via a Gradle copy) reads the same files,
 * so a balance change lands everywhere at once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..', '..');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');
export const DATA_DIR = path.join(SHARED_DIR, 'game-data');
export const WEB_DIR = path.join(ROOT_DIR, 'web');

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`Could not load game data "${abs}": ${err.message}`);
  }
}

export const manifest = readJson(path.join(DATA_DIR, 'index.json'));
export const tuning = readJson(path.join(DATA_DIR, 'tuning.json'));
export const weaponData = readJson(path.join(DATA_DIR, 'weapons.json'));
export const characterData = readJson(path.join(DATA_DIR, 'characters.json'));

export const weapons = weaponData.weapons;
export const weaponById = new Map(weapons.map((w) => [w.id, w]));
export const characters = characterData.characters;
export const characterById = new Map(characters.map((c) => [c.id, c]));

export const spawnSlots = weaponData.spawnSlots;
export const spawnGrenades = weaponData.spawnGrenades ?? tuning.grenades.maxCarried;

export const modes = manifest.modes;
export const modeById = new Map(modes.map((m) => [m.id, m]));

export const maps = manifest.maps.map((rel) => readJson(path.join(DATA_DIR, rel)));
export const mapById = new Map(maps.map((m) => [m.id, m]));

export function getMap(id) {
  return mapById.get(id) ?? maps[0];
}

export function getMode(id) {
  return modeById.get(id) ?? modeById.get('dm');
}

/**
 * The map + mode summary a client needs before it has fetched /api/content.
 *
 * Kept in one place because both the pre-join greeting and the post-join welcome
 * carry it, and they must not drift. The mode entries deliberately include the
 * rules a lobby needs to explain itself — in particular that a flag mode scores
 * captures rather than kills.
 */
export function contentSummary() {
  return {
    game: manifest.game,
    maps: manifest.maps.map((rel) => path.basename(rel, '.json')),
    modes: modes.map((m) => ({
      id: m.id,
      name: m.name,
      teams: m.teams === true,
      flags: m.flags === true,
      teamScoreFromKills: m.teamScoreFromKills !== false,
    })),
  };
}

/** The slice of content an unauthenticated client is allowed to know up front. */
export function publicContent() {
  return {
    game: manifest.game,
    tuning,
    weapons,
    characters,
    modes,
    maps,
    pickupTypes: manifest.pickupTypes,
    spawnSlots,
  };
}
