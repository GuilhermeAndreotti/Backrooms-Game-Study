/** Server-clock AFK enforcement, independent of rendering and world authority. */
export const SUPER_GUARD_AFK_MS = 8 * 60_000;
export const SUPER_GUARD_HUNT_MS = 5_000;

export interface SuperGuardFrame {
  targetId: string;
  level: number;
  x: number;
  y: number;
  z: number;
}

export interface SuperGuardState {
  lastActivity: number;
  lastTick: number;
  spawnedAt?: number;
  frame?: SuperGuardFrame;
}

export function tickSuperGuard(
  state: SuperGuardState,
  player: { id: string; level: number; x: number; y: number; z: number; dead: boolean },
  now: number,
  invulnerable = false,
): boolean {
  if (player.dead) {
    state.lastActivity = now;
    state.spawnedAt = undefined;
    state.frame = undefined;
    state.lastTick = now;
    return false;
  }
  if (!state.frame && now - state.lastActivity > SUPER_GUARD_AFK_MS) {
    state.spawnedAt = now;
    state.frame = { targetId: player.id, level: player.level, x: player.x, y: player.y, z: player.z + 12 };
    state.lastTick = now;
  }
  const frame = state.frame;
  if (!frame) { state.lastTick = now; return false; }
  // A level change cannot cancel the hunt. Reappear beside the same target.
  if (frame.level !== player.level) {
    frame.level = player.level;
    frame.x = player.x;
    frame.y = player.y;
    frame.z = player.z + 12;
  }
  const remaining = state.spawnedAt! + SUPER_GUARD_HUNT_MS - now;
  const dt = Math.max(0, now - state.lastTick);
  const distance = Math.hypot(player.x - frame.x, player.y - frame.y, player.z - frame.z);
  // Ignores walls, hiding and damage; accelerates to guarantee interception.
  const fraction = remaining <= 0 ? 1 : Math.min(1, Math.max(dt * 0.004 / Math.max(distance, 0.001), dt / (remaining + dt)));
  frame.x += (player.x - frame.x) * fraction;
  frame.y += (player.y - frame.y) * fraction;
  frame.z += (player.z - frame.z) * fraction;
  state.lastTick = now;
  // LIFE (also unlocked by SUDO) blocks death, never the ongoing hunt.
  return !invulnerable && distance * (1 - fraction) <= 0.8;
}
