/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O Vigia's mind, in the Poolrooms. It is the pools' drowned lifeguard: one
 * keeps Part 2's natatorium and one Part 3's drowned labyrinth, and neither
 * ever leaves its part (see levels/poolLayout.ts). Part 1 has none. State is
 * authority-only, like O Alien's: a handoff restarts it on its rounds, and
 * what the other clients need (moving, chasing, agitated, pose, and where it
 * faces) is replicated by WanderingEntity.
 *
 * The rules a player can learn, and that it never breaks:
 *  - It sees in a cone in front of it, and its body shows where that cone
 *    points: standing, it turns to look. Walls, raised blocks and the roof
 *    over a drowned corridor block its sight. Crouching makes you harder to
 *    see; a diver more than a body-length down is invisible to it.
 *  - It hears noise from very far (see systems/noiseBus.ts): running
 *    through water carries across the whole part, walking a good way, a
 *    landing, a splash or a lever further still. Crouching is nearly silent.
 *  - Once it has heard or seen you, it knows where you are for as long as
 *    you stay on its floor within its reach, however far away: it whistles
 *    and comes. Climb out of its reach (or dive, in Part 3) and it loses you.
 *  - It never leaves the floor: no blocks, stairs or ladders, no water
 *    deeper than it wades. Its arms reach anyone whose feet are less than
 *    VIGIA_REACH_UP above it — not higher, and not a diver below the edge.
 *  - It doesn't wait under a perch: a few seconds of reaching up and it gives
 *    up, walks off fast to the far end of its rounds and leaves you be until
 *    you come down. A diver it loses it searches for, then goes back to its rounds.
 *
 * How it keeps each part:
 *  - Part 2 (the hunt): rounds between the halls' lifeguard posts, where it
 *    stops and sweeps the water with its eyes. Anyone down in the water
 *    within reach is run at, flat out, after its whistle.
 *  - Part 3 (the deep): rounds from well to well across the hall over the
 *    labyrinth, bending over each rim to peer down. Peering, its arm hangs
 *    into the well: whoever surfaces near that side is pulled out
 *    (VIGIA_WELL_REACH). It follows the bubbles of a diver it lost from rim
 *    to rim, and whoever crosses the last rooms finds it waiting at the exit
 *    well.
 *
 * Modes: patrol ↔ watch (at a post or rim) → (noise) investigate → (sight)
 * alert → chase | stalk → retreat; chase → (lost) search | shadow → patrol;
 * ambush at the finale.
 */

import { CellType, ProceduralMap } from "../ProceduralMap";
import { NoiseBus, NoiseEvent } from "../systems/noiseBus";
import {
  POOL_AMBUSH, POOL_PATROL, POOL_WELLS, VIGIA_POSE, VIGIA_REACH_DOWN, VIGIA_REACH_UP, VIGIA_WELL_REACH, inPoolFinale, poolCellAt, poolPartAt,
} from "../levels/poolLayout";

/** The two parts a Vigia keeps. */
export type VigiaPart = 2 | 3;

export type VigiaMode = "patrol" | "watch" | "investigate" | "alert" | "chase" | "stalk" | "retreat" | "search" | "shadow" | "ambush";

export { VIGIA_POSE, VIGIA_WELL_REACH };

/** What it can know about the explorer it is attending to this frame. */
export interface VigiaTarget {
  x: number;
  z: number;
  /** World Y of their eyes. */
  eyeY: number;
  state: "idle" | "walking" | "running" | "crouching";
  crouched: boolean;
  submerged: boolean;
  flashlight: boolean;
}

/** Per-part temperament. */
interface Temper {
  sight: number; hear: number; lose: number; search: number; alertHold: number; stalk: number;
  patrol: number; investigate: number; searchSpeed: number; chase: number;
  /** Chase pace at someone down in the water within its reach: a flat-out run straight at them. */
  rush: number;
  /** Seconds it lingers at a post (Part 2) or over a well (Part 3): [min, extra random]. */
  watch: [number, number];
  /** Pace walking off after giving up on someone perched out of reach. */
  retreat: number;
}
const TEMPER: Record<VigiaPart, Temper> = {
  2: { sight: 30, hear: 260, lose: 4.0, search: 18, alertHold: 0.7, stalk: 1.5, patrol: 1.25, investigate: 1.9, searchSpeed: 1.5, chase: 3.15, rush: 5.6, watch: [2, 2.5], retreat: 4.6 },
  3: { sight: 24, hear: 180, lose: 4.5, search: 20, alertHold: 0.8, stalk: 1.5, patrol: 1.1, investigate: 1.8, searchSpeed: 1.4, chase: 2.9, rush: 5.2, watch: [3, 3], retreat: 4.2 },
};
/** Cosine of the half-angle of its sight cone: calm, and once it's onto someone. */
const CONE_CALM = Math.cos((72 * Math.PI) / 180);
const CONE_ENGAGED = Math.cos((115 * Math.PI) / 180);
/** Anyone this close is noticed whatever way it faces. */
const FEEL = 3.5;
/** Height of its eyes above the floor it stands on. */
const EYE = 2.9;
/** Its whistle: the beat between spotting someone in the water and running at them. */
const WHISTLE_HOLD = 0.6;
/** Wells it remembers having looked into, so its rounds sweep the labyrinth instead of pacing two holes. */
const WELL_MEMORY = 4;

/** Feet-to-floor gap the Vigia's arms cover — see VIGIA_REACH_UP/DOWN. */
export function vigiaReachesHeight(vigiaFloorY: number, targetEyeY: number, targetEyeHeight = 1.33): boolean {
  const gap = targetEyeY - targetEyeHeight - vigiaFloorY;
  return gap < VIGIA_REACH_UP && gap > -VIGIA_REACH_DOWN;
}

/** Where the Vigia stands, as the brain needs it. */
export interface VigiaSelf { gx: number; gz: number; x: number; z: number; floorY: number; moving: boolean }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const cellKey = (x: number, z: number) => `${x},${z}`;

export class VigiaBrain {
  mode: VigiaMode = "patrol";
  private modeTime = 0;
  /** Seconds it will stand where it is before the next decision. */
  hold = 0;
  goalX = -1;
  goalZ = -1;
  /** Logical facing (radians, atan2(x, z)): its sight cone, and what its body shows standing still. */
  facing = 0;
  private scanFrom = 0;
  private scanTime = 0;
  /** Where to look while standing at a rim or post (null: sweep left and right). */
  private lookAt: [number, number] | null = null;
  speed = 0;
  private wantSpeed = 0;
  private lastSeenX = 0;
  private lastSeenZ = 0;
  private lostTime = 0;
  /** Noises it has already reacted to (each is heard once). */
  private heard = new WeakSet<NoiseEvent>();
  private lastWaterNoise = -99;
  private stalkMax = 0;
  /** Where it last gave up a stalk, and how long it leaves that spot be. */
  private lurkX = -1;
  private lurkZ = -1;
  private lurkTime = 0;
  private patrolIndex = -1;
  private engagedSubmerged = false;
  /** The one it attends to is down in the water and within its reach: it runs at them. */
  private preyInWater = false;
  /** Standing at a well's rim, bent over it. */
  private peering = false;
  /** Part 3: rim cell -> the centre (world) of the well it overlooks. */
  private readonly rims = new Map<string, [number, number]>();
  /** Part 3: each well's centre (world) and the rim cells it can stand on. */
  private readonly wells: { x: number; z: number; rim: [number, number][] }[] = [];
  private recentWells: number[] = [];

  constructor(readonly part: VigiaPart, private readonly map: ProceduralMap, private readonly random: () => number) {
    this.wantSpeed = this.speed = TEMPER[part].patrol;
    if (part === 3) this.mapWells();
  }

  private get temper(): Temper { return TEMPER[this.part]; }

  get chasing(): boolean { return this.mode === "chase"; }
  get agitated(): boolean { return this.mode === "alert" || this.mode === "chase" || this.mode === "stalk" || this.mode === "ambush"; }
  get pose(): number {
    if (this.peering) return VIGIA_POSE.PEER;
    switch (this.mode) {
      case "investigate": case "search": case "shadow": return VIGIA_POSE.LISTEN;
      case "stalk": return VIGIA_POSE.REACH_UP;
      case "alert": case "chase": case "ambush": return VIGIA_POSE.HUNT;
      default: return VIGIA_POSE.CALM;
    }
  }

  reset() {
    this.setMode("patrol");
    this.hold = 0;
    this.goalX = this.goalZ = -1;
    this.lostTime = 0;
    this.lurkTime = 0;
    this.patrolIndex = -1;
    this.peering = false;
    this.lookAt = null;
  }

  private setMode(mode: VigiaMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeTime = 0;
  }

  /** Every well of the labyrinth, with the hall cells around its rim. */
  private mapWells() {
    const cs = this.map.cellSize;
    for (const [wx, wz] of POOL_WELLS) {
      const rim: [number, number][] = [];
      for (let x = wx - 1; x <= wx + 2; x++) {
        for (let z = wz - 1; z <= wz + 2; z++) {
          const corner = (x === wx - 1 || x === wx + 2) && (z === wz - 1 || z === wz + 2);
          const hole = x >= wx && x <= wx + 1 && z >= wz && z <= wz + 1;
          if (corner || hole || !this.map.vigiaMayStand(x, z, 3)) continue;
          rim.push([x, z]);
        }
      }
      if (rim.length === 0) continue;
      const well = { x: (wx + 1) * cs, z: (wz + 1) * cs, rim };
      this.wells.push(well);
      for (const [x, z] of rim) this.rims.set(cellKey(x, z), [well.x, well.z]);
    }
  }

  // -------------------------------------------------------------------
  // Senses
  // -------------------------------------------------------------------

  /** Whether it can see `t` from where it stands, facing where it faces. */
  sees(self: VigiaSelf, t: VigiaTarget): boolean {
    const cs = this.map.cellSize;
    if (poolPartAt(Math.floor(t.x / cs), Math.floor(t.z / cs)) !== this.part) return false;
    const dx = t.x - self.x, dz = t.z - self.z;
    const dist = Math.hypot(dx, dz);
    let range = this.temper.sight;
    if (t.crouched) range *= 0.65;
    if (t.flashlight) range *= 1.25;
    if (t.submerged) {
      // Under the surface: a dark shape at best, and only close by.
      const surface = this.map.waterSurfaceAt(t.x, t.z) ?? t.eyeY;
      const depth = surface - t.eyeY;
      range = depth > 0.9 ? (t.state !== "idle" ? 5 : 0) : Math.min(range, 9);
    }
    if (dist > range) return false;
    if (dist > FEEL && dist > 0.01) {
      const cone = this.mode === "patrol" || this.mode === "watch" || this.mode === "investigate" ? CONE_CALM : CONE_ENGAGED;
      const facing = (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / dist;
      if (facing < cone) return false;
    }
    return this.lineOfSight(self.x, self.floorY + (this.peering ? EYE * 0.6 : EYE), self.z, t.x, t.eyeY, t.z);
  }

  /** Nothing solid between two points: walls, raised blocks in the way, roofs. */
  private lineOfSight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const cs = this.map.cellSize;
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(dist / 0.5);
    const endX = Math.floor(x1 / cs), endZ = Math.floor(z1 / cs);
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, y = y0 + (y1 - y0) * f;
      const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
      if (gx === endX && gz === endZ) return true;
      if (this.map.grid[gx]?.[gz] === undefined || this.map.grid[gx][gz] === CellType.SOLID) return false;
      const cell = poolCellAt(gx, gz);
      // Solid: below the floor, and (over a drowned corridor) between its roof and the hall's floor.
      if (cell && (y < cell.floor || (y > cell.ceil && y < (cell.deck ?? Infinity)))) return false;
    }
    return true;
  }

  /** The loudest fresh noise it can hear from here, if any. */
  private hear(self: VigiaSelf, noise: NoiseBus | null): { x: number; z: number; water: boolean } | null {
    if (!noise) return null;
    const hear = this.temper.hear;
    let best: { x: number; z: number; water: boolean } | null = null;
    let bestScore = 0;
    for (const e of noise.near(self.x, self.z, hear * 1.5)) {
      if (this.heard.has(e)) continue;
      this.heard.add(e);
      if (poolPartAt(Math.floor(e.x / this.map.cellSize), Math.floor(e.z / this.map.cellSize)) !== this.part) continue;
      const d = Math.hypot(e.x - self.x, e.z - self.z);
      const reach = e.loudness * hear;
      if (d > reach) continue;
      const score = 1 - d / reach;
      if (score > bestScore) { bestScore = score; best = { x: e.x, z: e.z, water: e.source === "water" }; }
    }
    return best;
  }

  // -------------------------------------------------------------------
  // Thinking (per frame, authority only)
  // -------------------------------------------------------------------

  think(delta: number, self: VigiaSelf, t: VigiaTarget, noise: NoiseBus | null, now: number) {
    const T = this.temper;
    this.modeTime += delta;
    this.hold = Math.max(0, this.hold - delta);
    this.lurkTime = Math.max(0, this.lurkTime - delta);
    const cs = this.map.cellSize;
    const tgx = Math.floor(t.x / cs), tgz = Math.floor(t.z / cs);
    const sees = this.sees(self, t);
    const heard = this.hear(self, noise);
    if (heard?.water) this.lastWaterNoise = now;
    const reach = this.reachFor(tgx, tgz, t);
    this.preyInWater = reach !== null && this.map.waterSurfaceAt(t.x, t.z) !== null;
    // On its floor in its part, within reach and not under the water: once onto you, it always knows where.
    const tracked = reach !== null && !t.submerged && poolPartAt(tgx, tgz) === this.part;
    // Someone it gave up on up there makes no sound worth coming back for — until they come down.
    const ignored = !reach && this.lurkingNear(t.x, t.z);
    const heardIt = heard && !(ignored && this.lurkingNear(heard.x, heard.z)) ? heard : null;

    if (sees) {
      this.lastSeenX = t.x;
      this.lastSeenZ = t.z;
      this.lostTime = 0;
      this.engagedSubmerged = t.submerged;
    }

    switch (this.mode) {
      case "patrol":
      case "watch":
      case "investigate":
      case "search":
      case "shadow":
      case "retreat":
        // Having given up on someone perched out of reach, it leaves them be — until they come down.
        // Seen, or heard while on its floor and within reach: it fixes on you from wherever it is.
        if ((sees && !ignored) || (heardIt && tracked)) {
          this.lastSeenX = t.x;
          this.lastSeenZ = t.z;
          // It stops, straightens and fixes on you before it moves: the moment to
          // run. Someone in the water within reach hears the whistle, then it comes.
          this.hold = this.preyInWater ? WHISTLE_HOLD : T.alertHold * (this.mode === "patrol" || this.mode === "watch" ? 1 : 0.6);
          this.setMode("alert");
          this.goalX = this.goalZ = -1;
          this.lookAt = null;
          break;
        }
        if (this.part === 3 && t.submerged && inPoolFinale(tgx, tgz) && this.mode !== "retreat") {
          this.setMode("ambush");
          this.goTo(POOL_AMBUSH.x, POOL_AMBUSH.z);
          this.lookAt = [(POOL_AMBUSH.watchX + 0.5) * cs, (POOL_AMBUSH.watchZ + 0.5) * cs];
          break;
        }
        if (heardIt && this.mode !== "retreat") {
          // A diver it lost: follow the rings on the water from rim to rim.
          const follow = this.mode === "shadow" || (heardIt.water && this.part === 3 && this.engagedSubmerged);
          const mode: VigiaMode = follow ? "shadow" : "investigate";
          if (this.mode !== mode || this.modeTime > 1.5) {
            this.setMode(mode);
            this.lookAt = null;
            if (follow) this.goToWellNear(heardIt.x, heardIt.z);
            else this.goToNear(heardIt.x, heardIt.z);
            this.hold = Math.min(this.hold, 0.3);
          }
          break;
        }
        if (this.mode === "shadow" && now - this.lastWaterNoise > 7) this.startSearch(this.lastSeenX, this.lastSeenZ);
        else if (this.mode === "search" && this.modeTime > T.search) this.setMode("patrol");
        else if (this.mode === "investigate" && this.modeTime > 14) this.startSearch(this.searchX, this.searchZ);
        else if (this.mode === "watch" && this.hold <= 0) this.setMode("patrol");
        break;

      case "alert":
        if (this.hold <= 0) {
          if (reach) this.setMode("chase");
          else this.startStalk();
        }
        break;

      case "chase":
        if (tracked) {
          // However far, wherever it last saw or heard you: it knows.
          this.lostTime = 0;
          this.lastSeenX = t.x;
          this.lastSeenZ = t.z;
          this.goTo(reach[0], reach[1]);
        } else if (!reach && !t.submerged) {
          // Up out of its reach: a moment at the foot of it, then it gives up.
          this.lastSeenX = t.x;
          this.lastSeenZ = t.z;
          this.startStalk();
        } else {
          this.lostTime += delta;
          if (this.lostTime > T.lose || (self.gx === this.goalX && self.gz === this.goalZ && this.lostTime > 0.6)) {
            if (this.part === 3 && this.engagedSubmerged) {
              this.setMode("shadow");
              this.lastWaterNoise = now;
              this.goToWellNear(this.lastSeenX, this.lastSeenZ);
            } else {
              this.startSearch(this.lastSeenX, this.lastSeenZ);
            }
          }
        }
        break;

      case "stalk":
        if (tracked) { this.setMode("chase"); break; }
        // It knows where you went up.
        this.lastSeenX = t.x;
        this.lastSeenZ = t.z;
        // Pace at the foot of whatever you climbed, as close as it can stand.
        if (this.hold <= 0 && (this.goalX < 0 || (self.gx === this.goalX && self.gz === this.goalZ))) {
          const spot = this.standableNear(this.lastSeenX, this.lastSeenZ, 3, true);
          if (spot) this.goTo(spot[0], spot[1]);
          this.hold = 0.8 + this.random() * 1.6;
        }
        if (this.modeTime > this.stalkMax) {
          // You stayed up there long enough: it gives up and walks off to the far
          // end of its rounds, leaving you be while you stay up (lurkingNear) —
          // until you come back down into the water.
          this.lurkX = this.lastSeenX;
          this.lurkZ = this.lastSeenZ;
          this.lurkTime = 60 + this.random() * 30;
          this.retreat(this.lastSeenX, this.lastSeenZ);
        }
        break;

      case "ambush":
        if (sees) {
          this.setMode("alert");
          this.hold = 0.5;
          break;
        }
        if (self.gx === POOL_AMBUSH.x && self.gz === POOL_AMBUSH.z) this.hold = 0.5; // waiting, looking down into the exit well
        if (this.modeTime > 45 || (!inPoolFinale(tgx, tgz) && !t.submerged && this.modeTime > 6)) this.startSearch(t.x, t.z);
        break;
    }

    // Bent over the rim it stands at, whenever it stops there for something in the water.
    this.peering = this.part === 3 && !self.moving && this.goalArrived(self)
      && (this.mode === "watch" || this.mode === "ambush" || this.mode === "shadow" || ((this.mode === "chase" || this.mode === "alert") && this.preyInWater))
      && this.rims.has(cellKey(self.gx, self.gz));
    if (this.peering && this.mode !== "chase" && this.mode !== "alert") {
      const well = this.rims.get(cellKey(self.gx, self.gz))!;
      this.lookAt ??= well;
    }

    this.updateFacing(delta, self, t, sees);
    this.updateSpeed(delta, T);
  }

  /** The cell to chase toward (theirs, or the edge it can grab them from), or null if they're out of reach. */
  private reachFor(tgx: number, tgz: number, t: VigiaTarget): [number, number] | null {
    // Over its floor — unless the body there is really standing on a ledge it overhangs (feet too high to grab).
    if (this.map.vigiaMayStand(tgx, tgz, this.part) && !t.submerged) {
      const floor = this.map.standHeightAt((tgx + 0.5) * this.map.cellSize, (tgz + 0.5) * this.map.cellSize);
      return vigiaReachesHeight(floor, t.eyeY) ? [tgx, tgz] : null;
    }
    // Up on something, or in deep water: only reachable from an edge, if the arms make the height.
    const spot = this.standableNear(t.x, t.z, 1, false);
    if (!spot) return null;
    const floor = this.map.standHeightAt((spot[0] + 0.5) * this.map.cellSize, (spot[1] + 0.5) * this.map.cellSize);
    return vigiaReachesHeight(floor, t.eyeY) ? spot : null;
  }

  /** Lurking (after giving up a stalk) around where (x, z) is. */
  private lurkingNear(x: number, z: number): boolean {
    return this.lurkTime > 0 && Math.hypot(this.lurkX - x, this.lurkZ - z) < 12;
  }

  private startStalk() {
    this.setMode("stalk");
    this.goalX = this.goalZ = -1;
    this.hold = 0;
    // Shorter each time it comes back to the same spot.
    const returning = this.lurkingNear(this.lastSeenX, this.lastSeenZ);
    this.stalkMax = (this.temper.stalk + this.random() * 1.5) * (returning ? 0.5 : 1);
  }

  /** Walks off toward the waypoint of its rounds farthest from (x, z), and patrols from there. */
  private retreat(x: number, z: number) {
    this.setMode("retreat");
    this.lostTime = 0;
    this.hold = 0;
    this.lookAt = null;
    const cs = this.map.cellSize;
    let best: [number, number] | null = null, bestDist = -1;
    for (const [wx, wz] of POOL_PATROL[this.part]) {
      const d = Math.hypot((wx + 0.5) * cs - x, (wz + 0.5) * cs - z);
      if (d > bestDist) { bestDist = d; best = [wx, wz]; }
    }
    const spot = best && this.standableAt(best[0], best[1]);
    if (spot) this.goTo(spot[0], spot[1]);
    else this.setMode("patrol");
  }

  private startSearch(x: number, z: number) {
    this.setMode("search");
    this.lostTime = 0;
    this.lookAt = null;
    this.goToNear(x, z, 3);
  }

  // -------------------------------------------------------------------
  // Movement decisions (called by WanderingEntity when it reaches a cell)
  // -------------------------------------------------------------------

  /** The next cell to walk toward, or null to stand still for `hold` seconds. */
  nextGoal(self: VigiaSelf): [number, number] | null {
    if (this.hold > 0 || this.mode === "alert" || this.mode === "watch") return null;
    if (!this.goalArrived(self)) return [this.goalX, this.goalZ];
    const T = this.temper;
    switch (this.mode) {
      case "patrol":
      case "retreat": {
        if (this.goalX >= 0) {
          // At a post or a rim: linger, sweeping the water (Part 2) or peering down the well (Part 3).
          this.goalX = this.goalZ = -1;
          this.setMode("watch");
          this.hold = T.watch[0] + this.random() * T.watch[1];
          this.lookAt = this.rims.get(cellKey(self.gx, self.gz)) ?? null;
          this.startScan();
          return null;
        }
        const spot = this.part === 3 ? this.nextWellRim(self) : this.nextPost();
        if (spot) this.goTo(spot[0], spot[1]);
        else this.hold = 1;
        return spot;
      }
      case "investigate":
        // Got there: stand and listen, then look around.
        this.hold = 1.8 + this.random() * 2;
        this.startScan();
        this.startSearch((self.gx + 0.5) * this.map.cellSize, (self.gz + 0.5) * this.map.cellSize);
        return null;
      case "shadow":
        // At the rim nearest the rings: look down, wait for the next.
        this.hold = 1.2;
        this.goalX = this.goalZ = -1;
        return null;
      case "search": {
        this.hold = 0.9 + this.random() * 1.6;
        this.startScan();
        const spot = this.part === 3 && this.random() < 0.5
          ? this.wellRimNear(this.searchX, this.searchZ, 14)
          : this.standableNear(this.searchX, this.searchZ, 4, false, true);
        if (spot) this.goTo(spot[0], spot[1]);
        return null;
      }
      default:
        return null;
    }
  }

  private goalArrived(self: VigiaSelf): boolean {
    return this.goalX < 0 || (self.gx === this.goalX && self.gz === this.goalZ);
  }

  /** Part 2: one of the halls' lifeguard posts, never the one it just left. */
  private nextPost(): [number, number] | null {
    const route = POOL_PATROL[2];
    let pick = Math.floor(this.random() * route.length);
    if (pick === this.patrolIndex) pick = (pick + 1) % route.length;
    this.patrolIndex = pick;
    return this.standableAt(route[pick][0], route[pick][1]);
  }

  /**
   * Part 3: the rim of a well it hasn't looked into lately — usually one of
   * the nearest, now and then one across the hall, so its rounds sweep the
   * labyrinth without becoming a timetable.
   */
  private nextWellRim(self: VigiaSelf): [number, number] | null {
    if (this.wells.length === 0) return null;
    const fresh = this.wells.map((w, i) => ({ w, i, d: Math.hypot(w.x - self.x, w.z - self.z) }))
      .filter((o) => !this.recentWells.includes(o.i) && o.d > 1);
    const pool = fresh.length > 0 ? fresh : this.wells.map((w, i) => ({ w, i, d: 0 }));
    pool.sort((a, b) => a.d - b.d);
    const far = this.random() < 0.2;
    const choice = far ? pool[Math.floor(this.random() * pool.length)] : pool[Math.floor(this.random() * Math.min(3, pool.length))];
    this.recentWells.push(choice.i);
    if (this.recentWells.length > WELL_MEMORY) this.recentWells.shift();
    const rim = choice.w.rim;
    return rim[Math.floor(this.random() * rim.length)];
  }

  /** Part 3: the rim cell nearest (x, z) of the well nearest it, within `radius` metres; elsewhere just the nearest standable cell. */
  private wellRimNear(x: number, z: number, radius: number): [number, number] | null {
    if (this.part !== 3) return this.standableNear(x, z, 3, false);
    let best: { x: number; z: number; rim: [number, number][] } | null = null, bestD = radius;
    for (const w of this.wells) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (!best) return this.standableNear(x, z, 3, false);
    const cs = this.map.cellSize;
    let rim = best.rim[0], rimD = Infinity;
    for (const r of best.rim) {
      const d = Math.hypot((r[0] + 0.5) * cs - x, (r[1] + 0.5) * cs - z);
      if (d < rimD) { rimD = d; rim = r; }
    }
    return rim;
  }

  private searchX = 0;
  private searchZ = 0;

  private goTo(gx: number, gz: number) { this.goalX = gx; this.goalZ = gz; }

  private goToNear(x: number, z: number, radius = 3) {
    this.searchX = x;
    this.searchZ = z;
    const spot = this.standableNear(x, z, radius, false);
    if (spot) this.goTo(spot[0], spot[1]);
  }

  private goToWellNear(x: number, z: number) {
    this.searchX = x;
    this.searchZ = z;
    const spot = this.wellRimNear(x, z, 16);
    if (spot) this.goTo(spot[0], spot[1]);
  }

  /** (gx, gz) itself if it may stand there, else the nearest cell nearby it may. */
  private standableAt(gx: number, gz: number): [number, number] | null {
    if (this.map.vigiaMayStand(gx, gz, this.part)) return [gx, gz];
    const cs = this.map.cellSize;
    return this.standableNear((gx + 0.5) * cs, (gz + 0.5) * cs, 3, false);
  }

  /**
   * A cell it can stand on within `radius` cells of world (x, z): the nearest,
   * or a random one (searching). `pace` skips the one it already heads for.
   */
  private standableNear(x: number, z: number, radius: number, pace: boolean, randomPick = false): [number, number] | null {
    const cs = this.map.cellSize;
    const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
    const options: [number, number, number][] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const gx = cx + dx, gz = cz + dz;
        if (pace && gx === this.goalX && gz === this.goalZ) continue;
        if (!this.map.vigiaMayStand(gx, gz, this.part)) continue;
        options.push([gx, gz, Math.hypot((gx + 0.5) * cs - x, (gz + 0.5) * cs - z)]);
      }
    }
    if (options.length === 0) return null;
    if (randomPick) {
      const o = options[Math.floor(this.random() * options.length)];
      return [o[0], o[1]];
    }
    options.sort((a, b) => a[2] - b[2]);
    // Pacing: among the closest few, not always the same one.
    const o = pace ? options[Math.floor(this.random() * Math.min(3, options.length))] : options[0];
    return [o[0], o[1]];
  }

  // -------------------------------------------------------------------
  // Facing and pace
  // -------------------------------------------------------------------

  private startScan() {
    this.scanFrom = this.facing;
    this.scanTime = 0;
  }

  private updateFacing(delta: number, self: VigiaSelf, t: VigiaTarget, sees: boolean) {
    let want = this.facing;
    if ((this.mode === "alert" || this.mode === "chase" || this.mode === "stalk") && (sees || this.mode !== "chase")) {
      want = Math.atan2(t.x - self.x, t.z - self.z);
    } else if (self.moving && this.goalX >= 0) {
      want = Math.atan2((this.goalX + 0.5) * this.map.cellSize - self.x, (this.goalZ + 0.5) * this.map.cellSize - self.z);
    } else if (this.lookAt) {
      // Down into the well it stands over (a slow drift, as if following something in the water).
      this.scanTime += delta;
      want = Math.atan2(this.lookAt[0] - self.x, this.lookAt[1] - self.z) + Math.sin(this.scanTime * 0.5) * 0.25;
    } else if (this.hold > 0 || this.mode === "watch") {
      // Standing: a slow sweep left, then right, like a lifeguard over the water.
      this.scanTime += delta;
      want = this.scanFrom + Math.sin(this.scanTime * 0.9) * 1.3;
    }
    const diff = wrap(want - this.facing);
    this.facing = wrap(this.facing + diff * Math.min(1, delta * (this.mode === "chase" ? 6 : 2.5)));
  }

  private updateSpeed(delta: number, T: Temper) {
    this.wantSpeed =
      this.mode === "chase" ? (this.preyInWater ? T.rush : T.chase)
      : this.mode === "ambush" ? 2.4
      : this.mode === "investigate" || this.mode === "shadow" ? T.investigate
      : this.mode === "search" ? T.searchSpeed
      : this.mode === "stalk" ? 1.0
      : this.mode === "retreat" ? T.retreat
      : T.patrol;
    // It builds up to a run and slows heavily: no instant bursts.
    const rate = this.wantSpeed > this.speed ? ((this.mode === "chase" && this.preyInWater) || this.mode === "retreat" ? 4 : 1.6) : 3;
    this.speed += Math.max(-rate * delta, Math.min(rate * delta, this.wantSpeed - this.speed));
    this.speed = Math.max(0.6, this.speed);
  }
}
