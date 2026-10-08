/** Server-owned hotel progression. No DOM/Three dependencies. */
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_GUEST_ROOMS, HOTEL_RECEPTION, HOTEL_STAIRS, HOTEL_STEAM, HOTEL_TABLE, HOTEL_VALVES, hotelCenter, hotelFloorAt, hotelRng, hotelSightClear } from "../game/levels/hotelLayout";
export const HOTEL_BLACKOUT_MS = 5000;
export const HOTEL_SUITS = ["♣", "♦", "♠", "♥"] as const;
export const HOTEL_TILES = ["東", "南", "西", "北"] as const;
export type Pressure = 0 | 1 | 2;
export interface HotelState {
  epoch: number; revision: number; startedAt: number;
  boxOpen: boolean; key: boolean; beverlyOpen: boolean;
  collected: number; placed: number; doors: number;
  stairAt: number; valves: (Pressure | null)[];
  pressure: number; steamAt: number; steamUntil: number; exitOpen: boolean;
}
export type HotelAction =
  | { kind: "code"; code: string } | { kind: "key" } | { kind: "beverly" }
  | { kind: "door"; index: number } | { kind: "tile"; index: number } | { kind: "place" }
  | { kind: "valve"; index: number; setting: Pressure };
export function createHotelState(epoch = 1, now = Date.now()): HotelState {
  return { epoch, revision: 0, startedAt: now, boxOpen: false, key: false, beverlyOpen: false, collected: 0, placed: 0, doors: 0, stairAt: 0, valves: [null, null, null], pressure: 0, steamAt: 0, steamUntil: 0, exitOpen: false };
}
export function hotelPuzzle(seed: number) {
  const random = hotelRng(seed ^ 0x5121930);
  const shuffle = <T>(a: readonly T[]) => { const out = [...a]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const cards = shuffle(HOTEL_GUEST_ROOMS.filter(r => r.number < 510)).slice(0, 4).map((room, i) => ({ ...room, suit: HOTEL_SUITS[i], digit: room.number % 10 }));
  const order = shuffle([0, 1, 2, 3]);
  return { cards, order, code: order.map(i => cards[i].digit).join(""), alcoves: shuffle([0, 1, 2, 3]) };
}
export function hotelBlocked(s: HotelState, gx: number, gz: number, now: number): boolean {
  if (gx === HOTEL_BEVERLY_DOOR.gx && gz === HOTEL_BEVERLY_DOOR.gz) return !s.beverlyOpen;
  if (gx === HOTEL_STAIRS.gx && gz === HOTEL_STAIRS.gz) return !s.stairAt || now < s.stairAt;
  if (gx === 40 && gz === 40) return !s.exitOpen;
  const alcove = HOTEL_ALCOVES.findIndex(d => d.gx === gx && d.gz === gz);
  if (alcove >= 0) return !(s.doors & (1 << alcove));
  return now >= s.steamAt && now < s.steamUntil && HOTEL_STEAM.some(p => p.gx === gx && p.gz === gz);
}
export function parseHotelAction(raw: unknown): HotelAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === "code") return typeof a.code === "string" && /^\d{4}$/.test(a.code) ? { kind: "code", code: a.code } : null;
  if (a.kind === "key" || a.kind === "beverly" || a.kind === "place") return { kind: a.kind };
  if ((a.kind === "tile" || a.kind === "door") && Number.isInteger(a.index) && Number(a.index) >= 0 && Number(a.index) < 4) return { kind: a.kind, index: Number(a.index) };
  if (a.kind === "valve" && Number.isInteger(a.index) && Number(a.index) >= 0 && Number(a.index) < 3 && [0, 1, 2].includes(a.setting as number)) return { kind: "valve", index: Number(a.index), setting: a.setting as Pressure };
  return null;
}
/** Atomic, distance checked and idempotent. Returns null for an invalid/no-op action. */
export function applyHotelAction(s: HotelState, a: HotelAction, seed: number, p: { x: number; y: number; z: number }, now: number): HotelState | null {
  const puzzle = hotelPuzzle(seed);
  const near = (pos: { x: number; z: number }) => Math.hypot(p.x - pos.x, p.z - pos.z) <= 4.6 && Math.abs(p.y - hotelFloorAt(pos.x, pos.z) - 1.6) < 2
    && hotelSightClear(p.x, p.z, pos.x, pos.z, (x, z) => hotelBlocked(s, x, z, now) && !(x === Math.floor(pos.x / 4) && z === Math.floor(pos.z / 4)));
  const out = { ...s, valves: [...s.valves], revision: s.revision + 1 };
  switch (a.kind) {
    case "code": if (s.boxOpen || !near(HOTEL_RECEPTION) || a.code !== puzzle.code) return null; out.boxOpen = true; break;
    case "key": if (!s.boxOpen || s.key || !near(HOTEL_RECEPTION)) return null; out.key = true; break;
    case "beverly": if (!s.key || s.beverlyOpen || !near(hotelCenter(HOTEL_BEVERLY_DOOR.gx, HOTEL_BEVERLY_DOOR.gz))) return null; out.beverlyOpen = true; break;
    case "door": {
      const d = HOTEL_ALCOVES[a.index];
      if (!s.beverlyOpen || puzzle.alcoves[s.collected] !== a.index || s.doors & (1 << a.index) || !near(hotelCenter(d.gx, d.gz))) return null;
      out.doors |= 1 << a.index; break;
    }
    case "tile": {
      const slot = puzzle.alcoves[s.collected];
      if (a.index !== s.collected || slot === undefined || !(s.doors & (1 << slot)) || !near(HOTEL_ALCOVES[slot].tile)) return null;
      out.collected++; break;
    }
    case "place": if (s.placed >= s.collected || !near(HOTEL_TABLE)) return null; out.placed = s.collected; if (out.placed === 4) out.stairAt = now + HOTEL_BLACKOUT_MS; break;
    case "valve":
      if (!s.stairAt || now < s.stairAt || s.exitOpen || s.valves[a.index] === a.setting || !near(HOTEL_VALVES[a.index])) return null;
      out.valves[a.index] = a.setting;
      if (a.setting !== a.index) { out.pressure = Math.min(3, s.pressure + 1); out.steamAt = now + 1800; out.steamUntil = now + 10000; }
      else out.pressure = Math.max(0, s.pressure - 1);
      out.exitOpen = out.valves.every((v, i) => v === i);
      if (out.exitOpen) { out.steamUntil = 0; out.pressure = 0; }
      break;
  }
  return out;
}

/** Compact checkpoint owned by the elected world client; retained for authority handoff. */
export interface HotelWorldState {
  at: number; nextAt: number; until: number; lastSeen: number;
  mode: 0 | 1 | 2; target: string; dwell: Record<string, { zone: string; since: number }>;
  decor: number; event: number;
}
export function createHotelWorldState(now: number): HotelWorldState {
  return { at: now, nextAt: now + 65000, until: 0, lastSeen: now, mode: 0, target: "", dwell: {}, decor: 0, event: 0 };
}
