/**
 * Network-visible level ids. Keep these stable: they are part of the room
 * protocol and are also used by deterministic map generation.
 */
export const LEVEL_0 = 0;
export const LEVEL_1 = 1;
export const LEVEL_2 = 2;
export const ELECTRICAL_ROOM_LEVEL = 3;
export const ABANDONED_OFFICE_LEVEL = 4;
export const POOLROOMS_LEVEL = 5;
export const LIGHTS_OUT_LEVEL = 6;
export const LEVEL_G = 7;
export const MOTION_LEVEL = 8;
export const LOBBY_LEVEL = 10;

/** Main route after the lobby. */
export const MAIN_LEVELS = [
  LEVEL_0,
  LEVEL_1,
  LEVEL_2,
  ELECTRICAL_ROOM_LEVEL,
  ABANDONED_OFFICE_LEVEL,
  POOLROOMS_LEVEL,
] as const;

/** IDs used by the old procedural content while it is being re-themed. */
export function contentLevelFor(level: number): number {
  switch (level) {
    case ELECTRICAL_ROOM_LEVEL: return 8;
    case ABANDONED_OFFICE_LEVEL: return 9;
    case POOLROOMS_LEVEL: return 7;
    case LIGHTS_OUT_LEVEL: return 3;
    case LEVEL_G: return 4;
    case MOTION_LEVEL: return 6;
    default: return level;
  }
}

export function nextMainLevel(level: number): number | null {
  const index = MAIN_LEVELS.indexOf(level as typeof MAIN_LEVELS[number]);
  return index >= 0 && index < MAIN_LEVELS.length - 1 ? MAIN_LEVELS[index + 1] : null;
}
