/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O Vigia's mind, in the Poolrooms. One Vigia lives in each of the level's
 * three parts and never leaves it (see levels/poolLayout.ts). Authority-only
 * state, like O Alien's: a handoff restarts it on patrol, and what the other
 * clients need (moving, chasing, agitated, pose) is already replicated by
 * WanderingEntity.
 *
 * The rules a player can learn, and that it never breaks:
 *  - It sees in a cone in front of it, and only what nothing hides: walls,
 *    raised blocks and the roof over a drowned room all block its sight.
 *    Crouching makes you harder to see; a diver more than a body-length
 *    down is invisible to it, a swimmer near the surface is not.
 *  - It hears noise (see systems/noiseBus.ts): running through water,
 *    landing from a height, splashing, turning a valve. Walking is quiet;
 *    crouching is nearly silent. A sound only tells it *where to look*.
 *  - It never leaves the floor: no blocks, stairs or ladders, no water
 *    deeper than it wades. Its arms reach anyone whose feet are less than
 *    VIGIA_REACH_UP above it — not higher, and not a diver below the edge.
 *  - It forgets. Out of sight long enough, it searches where it lost you,
 *    then goes back to its rounds.
 *
 * States: patrol → (noise) investigate → (sight) alert → chase → (lost)
 * search → patrol. A target out of its reach turns a chase into a stalk at
 * the foot of the structure, which it abandons after a while to lurk out of
 * sight nearby. In Part 3 a diver it lost is shadowed by the disturbance
 * they leave on the surface, and whoever crosses the drowned room finds it
 * waiting at the pocket where they come up.
 */

import { CellType, ProceduralMap } from "../ProceduralMap";
import { NoiseBus, NoiseEvent } from "../systems/noiseBus";
import {
  POOL_AMBUSH, POOL_PATROL, PoolPart, VIGIA_REACH_DOWN, VIGIA_REACH_UP, inPoolFinale, poolCellAt, poolPartAt,
} from "../levels/poolLayout";

export type VigiaMode = "patrol" | "investigate" | "alert" | "chase" | "stalk" | "search" | "shadow" | "ambush";

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

/** Per-part temperament: Part 1 teaches it, Part 2 is its hunt, Part 3 its water. */
interface Temper {
  sight: number; hear: number; lose: number; search: number; alertHold: number; stalk: number;
  patrol: number; investigate: number; searchSpeed: number; chase: number;
  /** Chase pace at someone down in the water within its reach: a flat-out run straight at them. */
  rush: number;
}
const TEMPER: Record<PoolPart, Temper> = {
  1: { sight: 20, hear: 18, lose: 3.0, search: 14, alertHold: 1.1, stalk: 6, patrol: 1.0, investigate: 1.7, searchSpeed: 1.3, chase: 2.35, rush: 4.6 },
  2: { sight: 30, hear: 26, lose: 4.0, search: 18, alertHold: 0.7, stalk: 8, patrol: 1.25, investigate: 1.9, searchSpeed: 1.5, chase: 3.15, rush: 5.6 },
  3: { sight: 24, hear: 22, lose: 4.5, search: 20, alertHold: 0.8, stalk: 7, patrol: 1.1, investigate: 1.8, searchSpeed: 1.4, chase: 2.9, rush: 5.2 },
};
/** Cosine of the half-angle of its sight cone: calm, and once it's onto someone. */
const CONE_CALM = Math.cos((72 * Math.PI) / 180);
const CONE_ENGAGED = Math.cos((115 * Math.PI) / 180);
/** Anyone this close is noticed whatever way it faces. */
const FEEL = 3.5;
/** Height of its eyes above the floor it stands on. */
const EYE = 2.9;

/** Feet-to-floor gap the Vigia's arms cover — see VIGIA_REACH_UP/DOWN. */
export function vigiaReachesHeight(vigiaFloorY: number, targetEyeY: number, targetEyeHeight = 1.33): boolean {
  const gap = targetEyeY - targetEyeHeight - vigiaFloorY;
  return gap < VIGIA_REACH_UP && gap > -VIGIA_REACH_DOWN;
}

/** Where the Vigia stands, as the brain needs it. */
export interface VigiaSelf { gx: number; gz: number; x: number; z: number; floorY: number; moving: boolean }

export class VigiaBrain {
  mode: VigiaMode = "patrol";
  private modeTime = 0;
  /** Seconds it will stand where it is before the next decision. */
  hold = 0;
  goalX = -1;
  goalZ = -1;
  /** Logical facing (radians, atan2(x, z)) — its sight cone, not its mesh. */
  facing = 0;
  private scanFrom = 0;
  private scanTime = 0;
  speed = 0;
  private wantSpeed = 0;
  private lastSeenX = 0;
  private lastSeenZ = 0;
  private lostTime = 0;
  private sawTarget = false;
  /** Noises it has already reacted to (each is heard once). */
  private heard = new WeakSet<NoiseEvent>();
  private lastWaterNoise = -99;
  private stalkMax = 0;
  /** Where it last gave up a stalk, and how long it lurks around there. */
  private lurkX = -1;
  private lurkZ = -1;
  private lurkTime = 0;
  private patrolIndex = -1;
  private engagedSubmerged = false;
  /** The one it attends to is down in the water and within its reach: it runs at them. */
  private preyInWater = false;
  /** 0..1, Part 1 only: how much the valve puzzle has taught it (map.poolVigiaIntellect). */
  intellect = 0;

  constructor(readonly part: PoolPart, private readonly map: ProceduralMap, private readonly random: () => number) {
    this.wantSpeed = this.speed = TEMPER[part].patrol;
  }

  private get temper(): Temper { return TEMPER[this.part]; }

  get chasing(): boolean { return this.mode === "chase"; }
  get agitated(): boolean { return this.mode === "alert" || this.mode === "chase" || this.mode === "stalk" || this.mode === "ambush"; }
  /** Replicated pose: 0 calm, 1 listening, 2 hunting, 3 reaching up at someone out of reach; +4 once transformed (Part 1's puzzle). */
  get pose(): number {
    const base = this.mode === "investigate" || this.mode === "search" || this.mode === "shadow" ? 1
      : this.mode === "stalk" ? 3
      : this.mode === "alert" || this.mode === "chase" || this.mode === "ambush" ? 2 : 0;
    return base + (this.transformed ? 4 : 0);
  }
  get transformed(): boolean { return this.part === 1 && (this.intellect >= 0.64 || this.map.poolroomsSolved); }

  reset() {
    this.setMode("patrol");
    this.hold = 0;
    this.goalX = this.goalZ = -1;
    this.lostTime = 0;
    this.lurkTime = 0;
    this.patrolIndex = -1;
  }

  private setMode(mode: VigiaMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeTime = 0;
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
    let range = this.temper.sight + (this.part === 1 ? this.intellect * 16 : 0);
    if (t.crouched) range *= 0.65;
    if (t.flashlight && this.part !== 1) range *= 1.25;
    if (t.submerged) {
      // Under the surface: a dark shape at best, and only close by.
      const surface = this.map.waterSurfaceAt(t.x, t.z) ?? t.eyeY;
      const depth = surface - t.eyeY;
      range = depth > 0.9 ? (t.state !== "idle" ? 5 : 0) : Math.min(range, 9);
    }
    if (dist > range) return false;
    if (dist > FEEL && dist > 0.01) {
      const cone = this.mode === "patrol" || this.mode === "investigate" ? CONE_CALM : CONE_ENGAGED;
      const facing = (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / dist;
      if (facing < cone) return false;
    }
    return this.lineOfSight(self.x, self.floorY + EYE, self.z, t.x, t.eyeY, t.z);
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

    if (sees) {
      this.lastSeenX = t.x;
      this.lastSeenZ = t.z;
      this.lostTime = 0;
      this.sawTarget = true;
      this.engagedSubmerged = t.submerged;
    }

    switch (this.mode) {
      case "patrol":
      case "investigate":
      case "search":
      case "shadow":
        // Having given up on someone perched out of reach, it leaves them be — until they come down.
        if (sees && (reach || !this.lurkingNear(t.x, t.z))) {
          // It stops, rises and fixes on you before it moves: the moment to run.
          // Someone in the water within reach gets barely a heartbeat.
          this.hold = this.preyInWater ? 0.25 : T.alertHold * (this.mode === "patrol" ? 1 : 0.6);
          this.setMode("alert");
          this.goalX = this.goalZ = -1;
          break;
        }
        if (this.part === 3 && t.submerged && inPoolFinale(tgx, tgz)) {
          this.setMode("ambush");
          this.goTo(POOL_AMBUSH.x, POOL_AMBUSH.z);
          break;
        }
        if (heard) {
          // A diver it lost: follow the rings on the water along the edge.
          const mode: VigiaMode = this.mode === "shadow" || (heard.water && this.part === 3 && this.engagedSubmerged) ? "shadow" : "investigate";
          if (this.mode !== mode || this.modeTime > 1.5) {
            this.setMode(mode);
            this.goToNear(heard.x, heard.z);
            this.hold = Math.min(this.hold, 0.3);
          }
          break;
        }
        if (this.mode === "shadow" && now - this.lastWaterNoise > 7) this.startSearch(this.lastSeenX, this.lastSeenZ);
        else if (this.mode === "search" && this.modeTime > T.search) this.setMode("patrol");
        else if (this.mode === "investigate" && this.modeTime > 14) this.startSearch(this.goalCenterX(), this.goalCenterZ());
        break;

      case "alert":
        if (this.hold <= 0) {
          if (reach) this.setMode("chase");
          else this.startStalk();
        }
        break;

      case "chase":
        if (sees) {
          if (!reach) {
            this.startStalk();
          } else {
            const [gx, gz] = reach;
            this.goTo(gx, gz);
          }
        } else {
          this.lostTime += delta;
          if (this.lostTime > T.lose || (self.gx === this.goalX && self.gz === this.goalZ && this.lostTime > 0.6)) {
            if (this.part === 3 && this.engagedSubmerged) {
              this.setMode("shadow");
              this.lastWaterNoise = now;
            } else {
              this.startSearch(this.lastSeenX, this.lastSeenZ);
            }
          }
        }
        break;

      case "stalk":
        if (sees && reach) { this.setMode("chase"); break; }
        if (!sees) this.lostTime += delta;
        if (this.lostTime > T.lose + 1) { this.startSearch(this.lastSeenX, this.lastSeenZ); break; }
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
          this.lurkTime = 40 + this.random() * 20;
          this.leave(this.lastSeenX, this.lastSeenZ);
        }
        break;

      case "ambush":
        if (sees) {
          this.setMode("alert");
          this.hold = 0.5;
          break;
        }
        if (self.gx === POOL_AMBUSH.x && self.gz === POOL_AMBUSH.z) {
          // Waiting at the edge of the pocket, looking down into it.
          this.facing = Math.atan2(POOL_AMBUSH.watchX - POOL_AMBUSH.x, POOL_AMBUSH.watchZ - POOL_AMBUSH.z);
          this.hold = 0.5;
        }
        if (this.modeTime > 45 || (!inPoolFinale(tgx, tgz) && !t.submerged && this.modeTime > 6)) this.startSearch(t.x, t.z);
        break;
    }

    this.updateFacing(delta, self, t, sees);
    this.updateSpeed(delta, T);
  }

  /** The cell to chase toward (theirs, or the edge it can grab them from), or null if they're out of reach. */
  private reachFor(tgx: number, tgz: number, t: VigiaTarget): [number, number] | null {
    if (this.map.vigiaMayStand(tgx, tgz, this.part) && !t.submerged) return [tgx, tgz];
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
    const returning = this.lurkTime > 0 && Math.hypot(this.lurkX - this.lastSeenX, this.lurkZ - this.lastSeenZ) < 12;
    this.stalkMax = (this.temper.stalk + this.random() * 8) * (returning ? 0.5 : 1);
  }

  /** Back to patrol, heading for the waypoint of its rounds farthest from (x, z). */
  private leave(x: number, z: number) {
    this.setMode("patrol");
    this.lostTime = 0;
    this.hold = 0;
    const cs = this.map.cellSize;
    let best: [number, number] | null = null, bestDist = -1;
    for (const [wx, wz] of POOL_PATROL[this.part]) {
      const d = Math.hypot((wx + 0.5) * cs - x, (wz + 0.5) * cs - z);
      if (d > bestDist) { bestDist = d; best = [wx, wz]; }
    }
    const spot = best && (this.map.vigiaMayStand(best[0], best[1], this.part) ? best : this.standableNear((best[0] + 0.5) * cs, (best[1] + 0.5) * cs, 3, false));
    if (spot) this.goTo(spot[0], spot[1]);
    else this.goalX = this.goalZ = -1;
  }

  private startSearch(x: number, z: number, lurk = false) {
    this.setMode("search");
    this.lostTime = 0;
    this.goToNear(x, z, lurk ? 5 : 3);
    if (lurk) this.modeTime = -this.lurkTime * 0.5; // a longer search around the place it left you
  }

  // -------------------------------------------------------------------
  // Movement decisions (called by WanderingEntity when it reaches a cell)
  // -------------------------------------------------------------------

  /** The next cell to walk toward, or null to stand still for `hold` seconds. */
  nextGoal(self: VigiaSelf): [number, number] | null {
    if (this.hold > 0 || this.mode === "alert") return null;
    const arrived = this.goalX < 0 || (self.gx === this.goalX && self.gz === this.goalZ);
    if (!arrived) return [this.goalX, this.goalZ];
    switch (this.mode) {
      case "patrol": {
        if (this.goalX >= 0) {
          // Linger at a waypoint, looking round the hall.
          this.goalX = this.goalZ = -1;
          this.hold = 1.5 + this.random() * 2.5;
          this.startScan();
          return null;
        }
        const route = POOL_PATROL[this.part];
        let pick = Math.floor(this.random() * route.length);
        if (pick === this.patrolIndex) pick = (pick + 1) % route.length;
        this.patrolIndex = pick;
        const [x, z] = route[pick];
        const spot = this.map.vigiaMayStand(x, z, this.part) ? [x, z] as [number, number] : this.standableNear((x + 0.5) * this.map.cellSize, (z + 0.5) * this.map.cellSize, 3, false);
        if (spot) this.goTo(spot[0], spot[1]);
        else this.hold = 1;
        return spot;
      }
      case "investigate":
      case "shadow":
        // Got there: stand and listen.
        this.hold = this.mode === "shadow" ? 0.8 : 1.8 + this.random() * 2;
        this.startScan();
        if (this.mode === "investigate") this.startSearch((self.gx + 0.5) * this.map.cellSize, (self.gz + 0.5) * this.map.cellSize);
        else this.goalX = this.goalZ = -1;
        return null;
      case "search": {
        this.hold = 0.9 + this.random() * 1.6;
        this.startScan();
        const spot = this.standableNear(this.goalCenterX(), this.goalCenterZ(), 4, false, true);
        if (spot) { this.goalX = spot[0]; this.goalZ = spot[1]; }
        return null;
      }
      default:
        return null;
    }
  }

  private searchCenterX = 0;
  private searchCenterZ = 0;
  private goalCenterX() { return this.searchCenterX; }
  private goalCenterZ() { return this.searchCenterZ; }

  private goTo(gx: number, gz: number) { this.goalX = gx; this.goalZ = gz; }

  private goToNear(x: number, z: number, radius = 3) {
    this.searchCenterX = x;
    this.searchCenterZ = z;
    const spot = this.standableNear(x, z, radius, false);
    if (spot) this.goTo(spot[0], spot[1]);
  }

  /**
   * A cell it can stand on within `radius` cells of world (x, z): the nearest,
   * or a random one (searching). `pace` skips the one it already stands on.
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
    } else if (this.hold > 0 && this.mode !== "ambush") {
      // Standing: a slow look left, then right.
      this.scanTime += delta;
      want = this.scanFrom + Math.sin(this.scanTime * 0.9) * 1.3;
    }
    const diff = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
    this.facing += diff * Math.min(1, delta * (this.mode === "chase" ? 6 : 2.5));
  }

  private updateSpeed(delta: number, T: Temper) {
    this.wantSpeed =
      this.mode === "chase" ? (this.preyInWater ? T.rush : T.chase + (this.part === 1 ? this.intellect * 0.65 : 0))
      : this.mode === "ambush" ? 2.4
      : this.mode === "investigate" || this.mode === "shadow" ? T.investigate
      : this.mode === "search" ? T.searchSpeed
      : this.mode === "stalk" ? 1.0
      : T.patrol;
    // It builds up to a run and slows heavily: no instant bursts.
    const rate = this.wantSpeed > this.speed ? (this.mode === "chase" && this.preyInWater ? 4 : 1.6) : 3;
    this.speed += Math.max(-rate * delta, Math.min(rate * delta, this.wantSpeed - this.speed));
    this.speed = Math.max(0.6, this.speed);
  }
}
