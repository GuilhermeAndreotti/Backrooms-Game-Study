/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Poolrooms' game logic that isn't geometry or the Vigia's mind, kept out
 * of GameEngine:
 *
 *  - Which part the explorer is in, announced the first time they reach it.
 *  - Breath: it only drains while your head is under. The meter appears when
 *    it matters, the picture and the sound close in as it runs out, and an
 *    empty one is not instant death: a few seconds of drowning, then you come
 *    to on the last dry ground you stood on, shaken (sanity), not dead.
 *  - What the body's movements sound like and how far they carry (the noise
 *    the Vigia hears), and the water they disturb.
 *  - Being under water: the muffled mix, the green-blue murk in the picture.
 *  - The light and haze of each part, blended as you cross between them.
 *  - The building's ambience: rare, distant, panned sounds over long silences.
 *  - The finale: the drowned room's dread, and the swell when you surface
 *    and it is already there.
 *  - The exit landing's shutter (E at its wheel).
 *
 * Everything here is local and cosmetic except the noise it emits, which only
 * matters on whichever client runs the world authority's AI.
 */

import * as THREE from "three";
import type { AudioManager } from "../AudioManager";
import type { PlayerBodyEvent, PlayerController } from "../PlayerController";
import type { ProceduralMap } from "../ProceduralMap";
import type { WaterRipples } from "../Water";
import { waterUniforms } from "../Water";
import type { NoiseSource } from "../systems/noiseBus";
import { t } from "../../i18n";
import { POOL_LEVERS, PoolPart, inPoolFinale, onPoolLanding } from "./poolLayout";

/** Seconds of air with a full breath. Generous: the point is planning, not a stopwatch. */
const BREATH_SECONDS = 32;
/** Seconds to fill your lungs again at the surface. */
const BREATH_REFILL = 2.4;
/** Seconds of drowning (breath at zero) before you black out. */
const DROWN_SECONDS = 4.5;

interface Atmosphere { ambient: THREE.Color; intensity: number; fog: THREE.Color; fogScale: number; haze: THREE.Color }

const PART_LOOK: Record<PoolPart, { ambient: number; intensity: number; fog: number; fogScale: number; haze: number }> = {
  // Every part as bright and clinical as the Poolrooms everyone knows; what
  // changes between them is the water, the space and what's in it.
  1: { ambient: 0xfff8e6, intensity: 3.2, fog: 0xd9e8d2, fogScale: 1, haze: 0xd9e8d2 },
  2: { ambient: 0xfff6e6, intensity: 3.0, fog: 0xd4e4d4, fogScale: 1, haze: 0xd4e4d4 },
  // The labyrinth's hall: a touch colder, the light coming up out of the wells.
  3: { ambient: 0xe8f6f4, intensity: 2.7, fog: 0xc6dcd8, fogScale: 1.2, haze: 0xc6dcd8 },
};
const UNDER_LOOK: Record<PoolPart, { fog: number; fogScale: number }> = {
  1: { fog: 0x1d6b66, fogScale: 9 },
  2: { fog: 0x1d6b66, fogScale: 8 },
  // The labyrinth: clear enough to read a corridor ahead, not to see its end.
  3: { fog: 0x17625f, fogScale: 7 },
};

export interface PoolHost {
  audio: AudioManager;
  map(): ProceduralMap;
  player(): PlayerController;
  ripples(): WaterRipples | null;
  notify(text: string): void;
  /** Breath 0..1 for the HUD, or null to hide the meter. */
  breath(value: number | null): void;
  noise(x: number, z: number, loudness: number, source: NoiseSource): void;
  /** Where the Vigias are (for the finale's surfacing and the service gates). */
  vigias(): readonly THREE.Vector3[];
  /** Out of air: lose sanity and wake up at (x, z). */
  rescue(x: number, z: number): void;
  /** The local explorer can't act (dead / waiting at the exit). */
  inactive(): boolean;
  /** Pull Part 2's lever `index` (predicted locally, sent to the room). */
  pullLever(index: number): void;
}

export class PoolDirector {
  private part: PoolPart = 1;
  private readonly seen = new Set<PoolPart>();
  /** 0..1 air left. */
  breath = 1;
  private drowning = 0;
  private pulseTimer = 0;
  /** 0..1, smoothed: the camera is under water. */
  underwater = 0;
  /** 0..1: how close you are to drowning (drives the picture). */
  airDanger = 0;
  /** 0..1: the finale's dread. */
  dread = 0;
  private lastDry = new THREE.Vector3();
  private hasDry = false;
  private ambienceTimer = 6;
  private ambienceStarted = false;
  private look: Atmosphere;
  private breathShown = false;
  private stingerDone = false;
  private crank = 0;
  private wasHeld = false;
  private wakeNotice = 0;

  constructor(private readonly host: PoolHost) {
    const p = PART_LOOK[1];
    this.look = { ambient: new THREE.Color(p.ambient), intensity: p.intensity, fog: new THREE.Color(p.fog), fogScale: p.fogScale, haze: new THREE.Color(p.haze) };
  }

  dispose() {
    this.host.audio.stopPoolAmbience();
    this.host.breath(null);
    waterUniforms.uReflect.value.setHex(0xbfd6cf);
  }

  /** The part of the Poolrooms the explorer is in. */
  get currentPart(): PoolPart { return this.part; }

  // -------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------

  update(delta: number) {
    const map = this.host.map();
    const player = this.host.player();
    const audio = this.host.audio;
    const { x, z } = player.position;
    const part = map.poolPartAt(x, z);
    if (part) this.enterPart(part);

    if (!this.ambienceStarted) this.ambienceStarted = audio.startPoolAmbience();

    // --- Breath --------------------------------------------------------
    const under = player.submerged && !this.host.inactive();
    if (under) {
      const rate = player.state === "running" ? 1.5 : player.state === "idle" ? 0.8 : 1;
      this.breath = Math.max(0, this.breath - (delta * rate) / BREATH_SECONDS);
    } else {
      this.breath = Math.min(1, this.breath + delta / BREATH_REFILL);
      this.drowning = 0;
    }
    if (under !== this.wasHeld) {
      audio.holdBreath(under);
      this.wasHeld = under;
    }
    // The last dry ground underfoot: where you'd wake if the water took you.
    if (!player.swimming && !player.climbing && map.waterSurfaceAt(x, z) === null && !onPoolLanding(Math.floor(x / map.cellSize), Math.floor(z / map.cellSize))) {
      this.lastDry.set(x, 0, z);
      this.hasDry = true;
    }
    if (under && this.breath <= 0) {
      this.drowning += delta;
      if (this.drowning >= DROWN_SECONDS) this.blackOut();
    }
    const low = Math.max(0, 1 - this.breath / 0.35);
    this.airDanger += ((under ? Math.max(low, this.drowning / DROWN_SECONDS) : 0) - this.airDanger) * Math.min(1, delta * 3);
    if (under && low > 0) {
      this.pulseTimer -= delta;
      if (this.pulseTimer <= 0) {
        audio.playDrownPulse(low);
        this.pulseTimer = 1.25 - low * 0.65;
      }
    }
    const show = under || this.breath < 0.98;
    if (show || this.breathShown) {
      this.host.breath(show ? this.breath : null);
      this.breathShown = show;
    }

    // --- Under water -----------------------------------------------------
    this.underwater += ((player.submerged ? 1 : 0) - this.underwater) * Math.min(1, delta * 8);
    audio.setUnderwater(this.underwater);
    if (player.submerged && Math.random() < delta * 1.6) {
      // A little air escaping as you swim — and rings on the surface where it breaks.
      const surface = Math.min(player.waterSurface ?? player.position.y + 1, map.ceilingAt(x, z) - 0.05);
      this.host.ripples()?.bubble(x, player.position.y - 0.1, z, surface, 2);
      this.host.noise(x, z, 0.12, "water");
    }

    // --- The finale ------------------------------------------------------
    const gx = Math.floor(x / map.cellSize), gz = Math.floor(z / map.cellSize);
    const crossing = part === 3 && inPoolFinale(gx, gz);
    this.dread += ((crossing ? (player.submerged ? 0.8 : 0.45) : 0) - this.dread) * Math.min(1, delta * 0.6);
    audio.setPoolAmbience(this.part, this.dread);
    if (!this.stingerDone && crossing && !player.submerged && player.swimming) {
      // You come up for air, and it is standing at the edge, waiting.
      const waiting = this.host.vigias().some((v) => Math.hypot(v.x - x, v.z - z) < 9);
      if (waiting) {
        this.stingerDone = true;
        audio.playPoolStinger();
      }
    }

    // --- The shutter -----------------------------------------------------
    if (this.crank > 0) {
      this.crank -= delta;
      if (this.crank <= 0) {
        map.setPoolExitOpen(true);
        this.host.notify(t("pool.exitOpen"));
      }
    }

    if (this.wakeNotice > 0) {
      this.wakeNotice -= delta;
      if (this.wakeNotice <= 0) this.host.notify(t("pool.wake"));
    }

    this.updateLook(delta, map);
    this.updateAmbience(delta);
  }

  private enterPart(part: PoolPart) {
    this.part = part;
    if (this.seen.has(part)) return;
    this.seen.add(part);
    this.host.notify(t(part === 1 ? "pool.part1" : part === 2 ? "pool.part2" : "pool.part3"));
  }

  private blackOut() {
    this.drowning = 0;
    this.breath = 1;
    this.airDanger = 0;
    const p = this.host.player().position;
    const at = this.hasDry ? this.lastDry : p;
    this.host.rescue(at.x, at.z);
    this.wakeNotice = 0.8;
  }

  // -------------------------------------------------------------------
  // The body (PlayerController.onBodyEvent)
  // -------------------------------------------------------------------

  /** Sound, ripples and noise for what the explorer's body just did. */
  onBodyEvent(kind: PlayerBodyEvent, strength: number) {
    const player = this.host.player();
    const audio = this.host.audio;
    const { x, z } = player.position;
    const surface = player.waterSurface;
    const ripples = this.host.ripples();
    switch (kind) {
      case "stroke": {
        const under = player.submerged;
        audio.playSwimStroke(under, strength);
        if (under) {
          ripples?.bubble(x, player.position.y - 0.2, z, Math.min(surface ?? player.position.y + 1, this.host.map().ceilingAt(x, z) - 0.05), 3);
        } else if (surface !== null) {
          ripples?.spawn(x, z, 0.45 + strength * 0.3, strength > 0.8, surface);
          // Swimming at the surface carries; a sprint-swim carries far.
          this.host.noise(x, z, strength > 0.8 ? 0.55 : 0.22, "water");
        }
        break;
      }
      case "dive":
        audio.playDive(strength);
        if (surface !== null) ripples?.spawn(x, z, 0.8, false, surface);
        this.host.noise(x, z, 0.25, "water");
        break;
      case "surface": {
        // Coming up short of breath means a gasp — and a gasp can be heard.
        const gasp = Math.max(0, 1 - this.breath / 0.5);
        audio.playSurface(gasp);
        if (surface !== null) ripples?.spawn(x, z, 0.6, false, surface);
        this.host.noise(x, z, gasp > 0.3 ? 0.45 + gasp * 0.3 : 0.12, "water");
        break;
      }
      case "splash":
        audio.playSplash(strength);
        if (surface !== null) ripples?.spawn(x, z, Math.min(1.5, strength + 0.3), true, surface);
        this.host.noise(x, z, Math.min(1, 0.5 + strength * 0.35), "water");
        break;
      case "land": {
        const wet = surface !== null;
        audio.playLand(strength, wet);
        if (wet) ripples?.spawn(x, z, 1.1, true, surface!);
        // A drop off a catwalk is heard across the hall.
        this.host.noise(x, z, Math.min(1, 0.35 + strength * 0.18), "fall");
        break;
      }
      case "climb":
        audio.playLadderRung();
        this.host.noise(x, z, 0.1, "prop");
        break;
      case "hoist":
        audio.playHoist();
        if (surface !== null) ripples?.spawn(x, z, 0.7, true, surface);
        this.host.noise(x, z, 0.25, "water");
        break;
    }
  }

  /** How loud wading is for the Vigia: running splashes carry, walking barely does. */
  static wadeLoudness(speed: "walk" | "run" | "crouch", depth: number): number {
    const deep = Math.min(1, depth / 0.6);
    return speed === "run" ? 0.75 + deep * 0.25 : speed === "walk" ? 0.22 + deep * 0.1 : 0.05;
  }

  // -------------------------------------------------------------------
  // Light, haze and the underwater picture
  // -------------------------------------------------------------------

  private updateLook(delta: number, map: ProceduralMap) {
    const p = PART_LOOK[this.part];
    const u = UNDER_LOOK[this.part];
    const k = Math.min(1, delta * 1.2);
    const target = new THREE.Color(p.fog).lerp(new THREE.Color(u.fog), this.underwater);
    this.look.fog.lerp(target, Math.max(k, this.underwater > 0.5 ? Math.min(1, delta * 8) : 0));
    this.look.ambient.lerp(new THREE.Color(p.ambient), k);
    this.look.intensity += (p.intensity * (1 - this.underwater * 0.35) * (1 - this.dread * 0.4) - this.look.intensity) * k;
    const scale = p.fogScale + (u.fogScale - p.fogScale) * this.underwater;
    this.look.fogScale += (scale - this.look.fogScale) * Math.min(1, delta * (this.underwater > 0.05 ? 8 : 1.2));
    this.look.haze.lerp(new THREE.Color(p.haze), k);
    map.setPoolHaze(this.look.haze.getHex());
    waterUniforms.uReflect.value.copy(this.look.haze);
  }

  /** Ambient light, fog colour and fog density multiplier for GameEngine's atmosphere pass. */
  atmosphere(): Readonly<Atmosphere> { return this.look; }

  // -------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------

  private updateAmbience(delta: number) {
    this.ambienceTimer -= delta;
    if (this.ambienceTimer > 0) return;
    // Long, uneven silences between sounds: they're what makes the next one land.
    this.ambienceTimer = 9 + Math.random() * 18;
    const kinds: Record<PoolPart, ("drip" | "knock" | "creak" | "splash" | "gurgle" | "boom")[]> = {
      1: ["drip", "drip", "knock", "splash", "gurgle"],
      2: ["drip", "creak", "splash", "knock", "creak", "boom"],
      3: ["drip", "gurgle", "creak", "boom", "splash", "gurgle"],
    };
    const list = kinds[this.part];
    const kind = list[Math.floor(Math.random() * list.length)];
    const pan = (Math.random() * 2 - 1) * 0.9;
    const volume = kind === "boom" ? 0.5 : 0.35 + Math.random() * 0.4;
    this.host.audio.playPoolEvent(kind, pan, volume * (this.underwater > 0.5 ? 0.6 : 1));
  }

  // -------------------------------------------------------------------
  // The exit landing's shutter
  // -------------------------------------------------------------------

  private onLanding(): boolean {
    const map = this.host.map();
    const { x, z } = this.host.player().position;
    return onPoolLanding(Math.floor(x / map.cellSize), Math.floor(z / map.cellSize)) && !this.host.inactive();
  }

  /** Index of an unpulled lever within arm's reach, or -1. */
  private leverInReach(): number {
    if (this.host.inactive()) return -1;
    const map = this.host.map();
    const p = this.host.player();
    const cs = map.cellSize;
    return POOL_LEVERS.findIndex(([gx, gz], i) => {
      if (map.poolLevers.has(i)) return false;
      const lx = (gx + 0.5) * cs, lz = (gz + 0.5) * cs;
      return Math.hypot(p.position.x - lx, p.position.z - lz) < 2.2 && Math.abs(p.footY - map.getFloorHeightAt(lx, lz)) < 0.8;
    });
  }

  interactionPrompt(): string | null {
    if (this.leverInReach() >= 0) return t("act.poolLever");
    if (!this.onLanding() || this.host.map().poolExitOpen) return null;
    return this.crank > 0 ? t("act.poolShutterTurning") : t("act.poolShutter");
  }

  /**
   * E: pull a lever in reach (the whole room's state, through the server), or
   * crank the landing's shutter up. Both are loud — whatever is down there hears them.
   */
  interact(): boolean {
    const lever = this.leverInReach();
    if (lever >= 0) {
      const [gx, gz] = POOL_LEVERS[lever];
      const cs = this.host.map().cellSize;
      this.host.audio.playGrind("bars", 0, 0.8);
      this.host.noise((gx + 0.5) * cs, (gz + 0.5) * cs, 0.9, "prop");
      this.host.pullLever(lever);
      return true;
    }
    if (!this.onLanding() || this.host.map().poolExitOpen || this.crank > 0) return false;
    this.crank = 2.6;
    this.host.audio.playGrind("shutter");
    const { x, z } = this.host.player().position;
    this.host.noise(x, z, 1, "prop");
    return true;
  }
}
