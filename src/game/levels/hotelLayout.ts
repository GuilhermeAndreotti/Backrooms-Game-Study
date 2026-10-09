/** Terror Hotel's finite floor plan. Pure data: also used by server validation. */
export const HOTEL_GRID = 60;
export const HOTEL_CELL = 4;
export type HotelZone = "hall" | "beverly" | "stairs" | "boiler" | "exit";
export interface HotelRect { x1: number; z1: number; x2: number; z2: number; zone: HotelZone }
const rect = (x1: number, z1: number, x2: number, z2: number, zone: HotelZone = "hall"): HotelRect => ({ x1, z1, x2, z2, zone });
export const HOTEL_ROOMS = [501, 507, 503, 510, 502, 509, 506, 504, 508, 511, 505, 514] as const;
export const HOTEL_GUEST_ROOMS = HOTEL_ROOMS.map((number, i) => {
  const column = i % 4, row = Math.floor(i / 4), gx = 12 + column * 5;
  const gz = row === 0 ? 3 : row === 1 ? 9 : 16;
  // Bedroom bounds. The last middle-row room stops at x=27: x=28 would sit
  // flush against the east corridor (x=29) and open the room's whole side.
  const z1 = row === 0 ? 2 : row === 1 ? 7 : 14, z2 = row === 0 ? 3 : row === 1 ? 10 : 17;
  const x2 = row === 1 ? Math.min(gx + 1, 27) : gx + 1;
  return { number, gx, gz, x1: gx - 1, z1, x2, z2, doorX: gx, doorZ: row === 0 ? 4 : row === 1 ? 6 : 13 };
});
export const HOTEL_RECTS: readonly HotelRect[] = [
  rect(2, 2, 8, 7), rect(9, 5, 29, 5), rect(9, 6, 9, 12), rect(29, 6, 29, 12), rect(9, 12, 28, 12),
  ...HOTEL_GUEST_ROOMS.flatMap(r => [rect(r.x1, r.z1, r.x2, r.z2), rect(r.doorX, r.doorZ, r.doorX, r.doorZ)]),
  rect(30, 10, 31, 10), rect(32, 5, 43, 16, "beverly"),
  // Four playable alcoves. Floor/ceiling doors elsewhere are scenery.
  rect(34, 4, 34, 4, "beverly"), rect(33, 2, 35, 3, "beverly"),
  rect(41, 4, 41, 4, "beverly"), rect(40, 2, 42, 3, "beverly"),
  rect(44, 8, 44, 8, "beverly"), rect(45, 7, 47, 9, "beverly"),
  rect(44, 14, 44, 14, "beverly"), rect(45, 13, 47, 15, "beverly"),
  rect(39, 17, 39, 23, "stairs"), rect(36, 24, 42, 27, "boiler"), rect(29, 28, 55, 28, "boiler"),
  rect(29, 29, 35, 35, "boiler"), rect(40, 29, 46, 35, "boiler"), rect(49, 29, 55, 35, "boiler"),
  rect(29, 36, 29, 39, "boiler"), rect(40, 36, 40, 39, "boiler"), rect(55, 36, 55, 39, "boiler"),
  rect(30, 39, 54, 39, "boiler"), rect(31, 36, 38, 38, "boiler"), rect(46, 36, 52, 38, "boiler"),
  rect(40, 40, 40, 54, "exit"),
];
const regions = Array.from({ length: HOTEL_GRID }, () => Array<HotelZone | null>(HOTEL_GRID).fill(null));
for (const r of HOTEL_RECTS) for (let x = r.x1; x <= r.x2; x++) for (let z = r.z1; z <= r.z2; z++) regions[x][z] = r.zone;
export const hotelZone = (gx: number, gz: number): HotelZone | null => regions[gx]?.[gz] ?? null;
export const hotelCenter = (gx: number, gz: number) => ({ x: gx * HOTEL_CELL + 2, z: gz * HOTEL_CELL + 2 });
export const HOTEL_SPAWN = { gx: 4, gz: 5 };
export const HOTEL_RECEPTION = hotelCenter(5, 3);
export const HOTEL_BEVERLY_DOOR = { gx: 30, gz: 10 };
export const HOTEL_TABLE = hotelCenter(37, 10);
export const HOTEL_STAIRS = { gx: 39, gz: 17 };
export const HOTEL_EXIT = { gx: 40, gz: 54 };
export const HOTEL_VALVES = [hotelCenter(32, 33), hotelCenter(43, 33), hotelCenter(52, 33)];
export const HOTEL_ALCOVES = [
  { gx: 34, gz: 4, tile: hotelCenter(34, 2), axis: "z" },
  { gx: 41, gz: 4, tile: hotelCenter(41, 2), axis: "z" },
  { gx: 44, gz: 8, tile: hotelCenter(46, 8), axis: "x" },
  { gx: 44, gz: 14, tile: hotelCenter(46, 14), axis: "x" },
] as const;
export const HOTEL_STEAM = [{ gx: 29, gz: 36 }, { gx: 55, gz: 36 }];
export function hotelFloorAt(x: number, z: number): number {
  const zone = hotelZone(Math.floor(x / 4), Math.floor(z / 4));
  if (zone === "stairs") return -Math.min(6, Math.max(0, (z - 68) * 6 / 28));
  return zone === "boiler" || zone === "exit" ? -6 : 0;
}
export function hotelRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let v = Math.imul(s ^ s >>> 15, 1 | s); v ^= v + Math.imul(v ^ v >>> 7, 61 | v); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
}
/** Static walls plus the current physical gates, sampled conservatively. */
export function hotelSightClear(ax: number, az: number, bx: number, bz: number, blocked: (gx: number, gz: number) => boolean): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 4);
  for (let i = 1; i < steps; i++) {
    const gx = Math.floor((ax + (bx - ax) * i / steps) / 4), gz = Math.floor((az + (bz - az) * i / steps) / 4);
    if (!hotelZone(gx, gz) || blocked(gx, gz)) return false;
  }
  return true;
}
