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
/** Level 94 "Motion" (a door in the Poolrooms — the alternative to Level 79 —, Level 79's UNKNOWN course, or the lobby): a 1930s cartoon town, its hills and the King's castle. */
export const OLD_TOWN_LEVEL = 8;
/** Level Fun: the abandoned children's party venue (main route, after Lights Out). */
export const FUN_LEVEL = 9;
export const LOBBY_LEVEL = 10;
/**
 * Level 79 "Space Station" (picked from the lobby). 11 is skipped: it is
 * Level FUN's *content* id, and contentLevelFor() maps 12 to itself, so this
 * one number is both the network id and the id ProceduralMap sees.
 */
export const SPACE_LEVEL = 12;
/** Displayed as Level 5. The Poolrooms keep their original network id. */
export const HOTEL_LEVEL = 13;

/**
 * Main route after the lobby: Level 0 → 1 → 2 → 3 → 4 → 5 (Terror Hotel) →
 * 6 (Lights Out) → Level Fun → 37 (Poolrooms) → 79 (Space Station). The
 * Poolrooms also hide a door to Level 94, the route's alternative ending.
 */
export const MAIN_LEVELS = [
  LEVEL_0,
  LEVEL_1,
  LEVEL_2,
  ELECTRICAL_ROOM_LEVEL,
  ABANDONED_OFFICE_LEVEL,
  HOTEL_LEVEL,
  LIGHTS_OUT_LEVEL,
  FUN_LEVEL,
  POOLROOMS_LEVEL,
  // The Poolrooms' exit is a station door: the route ends in Level 79.
  SPACE_LEVEL,
] as const;

/** Levels whose way out ends the expedition (the timed run stops there). */
export const ENDING_LEVELS: readonly number[] = [SPACE_LEVEL, OLD_TOWN_LEVEL];

/** Content id ProceduralMap uses for Level FUN (9 is already the Abandoned Office's). */
export const FUN_CONTENT_LEVEL = 11;
/** Content id ProceduralMap uses for Level 94 (8 is already the Electrical Room's). */
export const OLD_TOWN_CONTENT_LEVEL = 94;

/** IDs used by the old procedural content while it is being re-themed. */
export function contentLevelFor(level: number): number {
  switch (level) {
    case ELECTRICAL_ROOM_LEVEL: return 8;
    case ABANDONED_OFFICE_LEVEL: return 9;
    case POOLROOMS_LEVEL: return 7;
    case LIGHTS_OUT_LEVEL: return 3;
    case LEVEL_G: return 4;
    case OLD_TOWN_LEVEL: return OLD_TOWN_CONTENT_LEVEL;
    case FUN_LEVEL: return FUN_CONTENT_LEVEL;
    default: return level;
  }
}

export function nextMainLevel(level: number): number | null {
  const index = MAIN_LEVELS.indexOf(level as typeof MAIN_LEVELS[number]);
  return index >= 0 && index < MAIN_LEVELS.length - 1 ? MAIN_LEVELS[index + 1] : null;
}
