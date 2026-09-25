/** Shared Poolrooms puzzle constants and deterministic valve ordering. */

export const POOL_VALVES_PER_ROOM = 3;
export const POOL_ROOM_COUNT = 4;
export const POOL_VALVE_COUNT = POOL_VALVES_PER_ROOM * POOL_ROOM_COUNT;
export const POOL_VALVE_ORDER_SALT = 0x7a11;

class PoolroomsRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min));
  }
}

/** Must stay in sync with the order used by the generated Poolrooms clues. */
export function poolValveOrderForSeed(seed: number): number[][] {
  const rng = new PoolroomsRandom(seed + POOL_VALVE_ORDER_SALT);
  return Array.from({ length: POOL_ROOM_COUNT }, () => {
    const order = [0, 1, 2];
    for (let i = POOL_VALVES_PER_ROOM - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  });
}
