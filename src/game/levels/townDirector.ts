/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's game logic, kept out of GameEngine:
 *
 *   DAY       the town is pleasant and wrong. Three clock parts (a key, a
 *             gear, a hand) lie in three of its houses; brought to the tower,
 *             they start the clock.
 *   DUSK      about twenty seconds, the same for everyone: the clock starts,
 *             the townsfolk stop dead, the music cuts, the sun drops, the
 *             lamps come on and then the lights go out, house by house.
 *   NIGHT     the townsfolk are gone; a few Animations walk the streets
 *             (spawned by the level's authority, see GameEngine). The road
 *             north is open. Houses are safe; cars and corners hide you.
 *   HILLS     past the town's last fence the night simply isn't there: a
 *             pale, silent overcast over green hills, and the castle ahead.
 *   CASTLE    the entrance; the Animation Room, whose model of the town is
 *             wrong in three places (fix it and the portcullis rises); the
 *             throne room, where the King wakes when someone comes near.
 *   THE DOOR  each explorer's own vision: the King stands in the doorway and
 *             grows until the room bends. Walking up to him makes him
 *             shrink away; the door opens; white. Standing still instead...
 *
 * Shared state is a handful of idempotent facts (a part found, the clock
 * started, a model piece moved, the model solved), applied locally,
 * announced through `host.send`, kept by the server for late arrivals and
 * applied the same way when a teammate's arrive. The dusk sequence is a
 * fixed timeline every client runs from the moment it learns the clock
 * started. The vision and both endings are per explorer; the sky, the light
 * and the music follow wherever the local explorer is standing. Flicker,
 * townsfolk and camera effects are cosmetic and local (Math.random is fine).
 */

import * as THREE from "three";
import type { AudioManager } from "../AudioManager";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { KING_LOOK } from "../mobs/townKing";
import { NO_SCRIPTED_POSE } from "../mobs/types";
import { animateToon, buildStandaloneToon, poseSeated, Townsfolk } from "./townFigures";
import {
  CASTLE_FLOOR, CLOCK_HATCH, CLOCK_PARTS, ClockPart, KING_CHECKPOINT, KING_THRONE, MODEL_PIECES, MODEL_SCALE, MODEL_TABLE, ModelPieceId, NOISY_HOUSES,
  THRONE_DOOR_X, THRONE_DOOR_Z, TOWNSFOLK, TOWN_AREA, TOWN_CELL, TOWN_EDGE_Z, TOWN_EXIT, TOWN_SPAWN, TOWN_TOWER, TownZone, cellCenter,
  stayChair, townCellAt, townIsIndoors, townRng,
} from "./townLayout";
import { SKY_DAY, SKY_HILLS, SKY_NIGHT, SKY_SUNSET, SkyLook, TownSky, cloneSky, mixSky } from "./townSky";
import type { TownWorld } from "./townWorld";
import { EntityType } from "../../shared/entityTypes";

export type TownAudio = Pick<AudioManager,
  "startFunMusic" | "stopFunMusic" | "funMusicPlaying" | "playFunSound" | "playKingBreath" | "playKingWhisper" | "playKingStinger" |
  "playKingThud" | "playTerminalBeep" | "startTownAmbience" | "setTownAmbience" | "stopTownAmbience" | "playTownSound">;

export type TownEventKind = "part" | "clock" | "model" | "solved" | "kingWake";

export interface TownHost {
  audio: TownAudio;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  notify(text: string): void;
  /** The local explorer: position, look direction, and whether they can act at all. */
  player(): { x: number; z: number; lookX: number; lookZ: number; alive: boolean };
  send(kind: TownEventKind, index: number): void;
  /** 0 = clear, 1 = black. */
  setFade(alpha: number): void;
  /** VHS distortion, 0..1. */
  setDread(amount: number): void;
  /** Camera roll (radians) and field-of-view offset (degrees) for this frame. */
  warp(roll: number, fov: number): void;
  /** Moves the local explorer (checkpoints, the secret ending's chair). */
  teleport(x: number, z: number, yaw: number): void;
  /** Every monster away from cell (gx, gz) (the authority moves them; anyone else asks it to). */
  relocateMonsters(gx: number, gz: number): void;
  /** Night fell: the authority spawns the Animations (called on every client; idempotent). */
  nightFell(): void;
  /** The King, as this client sees him (null until he exists). */
  king(): { x: number; z: number; awake: boolean } | null;
  /** The local explorer's suit colour (worn by the figure in the chair). */
  suitColor(): string;
  achievement(id: string): void;
  /** The level is over for this explorer: leave it like any other exit. */
  escape(): void;
  /** Opens (a view) or closes (null) the King's dialogue panel. */
  dialogue(view: TownDialogueView | null): void;
}

type Phase = "day" | "dusk" | "night";
type Vision = "none" | "dialogue" | "confront" | "shrinking" | "open" | "white" | "stay" | "chair" | "crown" | "throne" | "done";

/** What the King's dialogue panel shows: his words, and what you can answer. */
export interface TownDialogueView {
  lines: string[];
  options: { id: TownDialogueChoice; label: string; secret: boolean }[];
}
export type TownDialogueChoice = "how" | "who" | "accept" | "refuse" | "crown";

/** How close (metres) to the throne the King speaks to you, if he's still sitting. */
const DIALOGUE_RANGE = 15;
/** You, crowned, on the throne. */
const NEW_KING_SCALE = 1.35;

/** Seconds from the clock starting to full night. */
const DUSK_SECONDS = 19;
/** Standing still this long in front of the King is answering him. */
const STAY_SECONDS = 6;
/** The lamps that stay lit at night (indices into world.lamps). */
const NIGHT_LAMPS = new Set([0, 3, 6, 11]);

const PART_NAME: Record<ClockPart, MessageKey> = { key: "town.part.key", gear: "town.part.gear", hand: "town.part.hand" };
/** The model's missing buildings, as the assembly panel names them. */
export const PIECE_NAME: Record<ModelPieceId, MessageKey> = {
  tower: "town.piece.tower", houseC: "town.piece.houseC", bakery: "town.piece.bakery", chapel: "town.piece.chapel", houseD: "town.piece.houseD",
};

const smooth = (a: number, b: number, v: number) => {
  const k = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Big centred text over everything (the level's end cards, and "Stay."). */
class TitleCard {
  readonly mesh: THREE.Mesh;
  /** A full-screen sheet behind the text, for cards with a background (any aspect ratio). */
  private readonly backdrop: THREE.Mesh;
  private readonly backMat: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement("canvas");
  private readonly tex: THREE.CanvasTexture;
  private readonly mat: THREE.MeshBasicMaterial;
  private key = "";

  constructor(camera: THREE.Camera) {
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.18), this.mat);
    this.mesh.position.z = -0.12;
    this.mesh.renderOrder = 10001;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.backMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0 });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), this.backMat);
    this.backdrop.position.z = -0.125;
    this.backdrop.renderOrder = 10000.5;
    this.backdrop.frustumCulled = false;
    this.backdrop.visible = false;
    camera.add(this.backdrop);
  }

  /** `bg` null keeps the card transparent behind the text (a subtitle). */
  show(lines: string[], bg: string | null, fg: string, opacity: number, sizes: number[] = []) {
    const key = `${lines.join("|")}|${bg}|${fg}`;
    if (key !== this.key) {
      this.key = key;
      const g = this.canvas.getContext("2d")!;
      const w = this.canvas.width, h = this.canvas.height;
      g.clearRect(0, 0, w, h);
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const total = lines.reduce((sum, _l, i) => sum + (sizes[i] ?? 56) * 1.35, 0);
      let y = h / 2 - total / 2;
      lines.forEach((line, i) => {
        const size = sizes[i] ?? 56;
        g.font = `bold ${size}px Georgia, "Times New Roman", serif`;
        y += (size * 1.35) / 2;
        if (!bg) {
          g.strokeStyle = "rgba(0,0,0,0.85)";
          g.lineWidth = 8;
          g.strokeText(line, w / 2, y);
        }
        g.fillText(line, w / 2, y);
        y += (size * 1.35) / 2;
      });
      this.tex.needsUpdate = true;
    }
    this.mat.opacity = Math.max(0, Math.min(1, opacity));
    this.mesh.visible = this.mat.opacity > 0.001;
    if (bg) this.backMat.color.set(bg);
    this.backMat.opacity = bg ? this.mat.opacity : 0;
    this.backdrop.visible = !!bg && this.mesh.visible;
  }

  hide() {
    this.mat.opacity = 0;
    this.mesh.visible = false;
    this.backdrop.visible = false;
  }

  dispose() {
    for (const m of [this.mesh, this.backdrop]) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.mat.dispose();
    this.backMat.dispose();
    this.tex.dispose();
  }
}

export class TownDirector {
  private readonly world: TownWorld;
  private readonly host: TownHost;
  private readonly sky = new TownSky();
  private readonly look: SkyLook = cloneSky(SKY_DAY);
  private readonly scratchLook: SkyLook = cloneSky(SKY_DAY);
  private readonly folk: Townsfolk[] = [];
  private readonly card: TitleCard;
  private readonly scratch = new THREE.Vector3();
  private readonly ambColor = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();

  // Shared facts
  private readonly found = new Set<ClockPart>();
  private clockStarted = false;
  /** Which of the model's missing buildings are back on their plots. */
  private readonly placed: boolean[] = MODEL_PIECES.map(() => false);
  private solved = false;

  // The shared timeline
  private phase: Phase = "day";
  private duskTime = 0;
  private nightAnnounced = false;
  private beats = new Set<string>();
  /** House ids in the order their lights go out (the same on every client). */
  private readonly lightsOut: string[];

  // Local
  private time = 0;
  private zone: TownZone = "town";
  private hillsK = 0;
  private indoorK = 0;
  private seen = new Set<string>();
  private musicWanted = true;
  private ambienceOn = false;
  private noiseTimer = 6;
  private tickTimer = 0;
  private distantTune = 30;
  private caughtFade = 0;
  /** A building dropped on the wrong plot: seconds left of the castle's lights stuttering. */
  private wrongFlash = 0;

  // The vision and the endings
  private vision: Vision = "none";
  private visionTime = 0;
  private king: { group: THREE.Group; body: THREE.Group; joints: Record<string, THREE.Group> } | null = null;
  private kingScale = 1;
  private minDist = Infinity;
  private stillTime = 0;
  private lastX = 0;
  private lastZ = 0;
  private dread = 0;
  private chair: { group: THREE.Group; body: THREE.Group; joints: Record<string, THREE.Group> } | null = null;
  /** The secret ending puts the town back in its endless day. */
  private eternalDay = false;
  /** While set, GameEngine hands the camera to {@link driveCamera}. */
  cinematic = false;

  // The King's offer, and what unlocks the secret answer to it.
  /** Someone turned the King down: he's up, for everyone (a shared fact). */
  kingWoken = false;
  private dialogueDone = false;
  private dialogueNode: "intro" | "how" | "who" = "intro";
  private asked = new Set<TownDialogueChoice>();
  /** The paper crown in the hills (each explorer finds their own). */
  private crownFound = false;
  /** Times a monster caught this explorer on this level. */
  private timesCaught = 0;
  /** Buildings this explorer dropped on the wrong plot of the model. */
  private wrongPlacements = 0;
  private throneFigure: { group: THREE.Group; body: THREE.Group; joints: Record<string, THREE.Group> } | null = null;

  constructor(world: TownWorld, host: TownHost) {
    this.world = world;
    this.host = host;
    host.scene.add(world.root);
    host.scene.add(this.sky.root);
    this.card = new TitleCard(host.camera);
    // Long views outside: the hills and the castle are meant to be seen from afar.
    host.camera.far = 320;
    host.camera.updateProjectionMatrix();

    TOWNSFOLK.forEach((spot, i) => {
      const f = new Townsfolk(world.kitRef, spot, i);
      this.folk.push(f);
      world.root.add(f.group);
    });

    world.setGateBulbs(0);
    const rng = townRng((world.seed ^ 0x11947) >>> 0);
    this.lightsOut = [...world.houses.keys()];
    for (let i = this.lightsOut.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.lightsOut[i], this.lightsOut[j]] = [this.lightsOut[j], this.lightsOut[i]];
    }
    world.setClockTime(11 + 55 / 60, false);
    world.setDaylight(1);
    for (let i = 0; i < world.lamps.length; i++) world.setLamp(i, 0);
    for (const id of world.houses.keys()) world.setHouseLight(id, 0);
  }

  dispose() {
    this.host.audio.stopFunMusic(true);
    this.host.audio.stopTownAmbience();
    this.host.setFade(0);
    this.host.setDread(0);
    this.host.warp(0, 0);
    this.host.camera.far = 45;
    this.host.camera.updateProjectionMatrix();
    this.card.dispose();
    this.sky.dispose();
    this.world.dispose();
  }

  // -------------------------------------------------------------------------
  // Queries for the engine
  // -------------------------------------------------------------------------

  /** Whether monsters can't touch the local explorer right now (visions, endings, a catch already being undone). */
  get immune(): boolean {
    return this.vision !== "none" || this.caughtFade > 0;
  }

  /** The replicated King is hidden for whoever is having the vision (or sits on his throne now). */
  get kingVisible(): boolean {
    return this.vision === "none" || this.vision === "dialogue";
  }

  /** The secret answer: the crown from the hills, never caught, and the model put right without a single mistake. */
  private get crownWorthy(): boolean {
    return this.crownFound && this.timesCaught === 0 && this.wrongPlacements === 0;
  }

  /** Indoors: the Animations never follow anyone into a house. */
  isHidden(x: number, z: number): boolean {
    return townIsIndoors(x, z);
  }

  /** Darkness drains the mind only in the town at night. */
  get dark(): boolean {
    return this.phase === "night" && this.zone === "town" && !this.eternalDay;
  }

  objective(): string | null {
    if (this.vision === "confront" || this.vision === "shrinking") return t("town.obj.walk");
    if (this.vision !== "none") return null;
    if (this.zone === "castle") {
      const region = this.region();
      if (region === "throne") {
        const k = this.host.king();
        return t(k?.awake ? "town.obj.run" : "town.obj.throne");
      }
      if (region === "animRoom" || (region === "entrance" && !this.solved)) {
        return this.solved ? t("town.obj.gateOpen") : t("town.obj.model", { n: this.placedCount(), total: MODEL_PIECES.length });
      }
      return t("town.obj.castle");
    }
    if (this.zone === "hills" || this.zone === "road") return this.phase === "night" ? t("town.obj.hills") : t("town.obj.findParts", { n: this.found.size });
    switch (this.phase) {
      case "day":
        return this.found.size < 3 ? t("town.obj.findParts", { n: this.found.size }) : t("town.obj.tower");
      case "dusk":
        return null;
      default:
        return t("town.obj.night");
    }
  }

  /** Ambient light and fog for this frame (the engine applies them over the level's base). */
  atmosphere(): { color: number; intensity: number; fog: number; density: number } {
    const night = this.eternalDay ? 0 : this.phase === "night" ? 1 : this.phase === "dusk" ? smooth(8, DUSK_SECONDS, this.duskTime) : 0;
    const amb = this.ambColor.setHex(0xfff2dc).lerp(this.tmpColor.setHex(0x5a6a9a), night).lerp(this.tmpColor.setHex(0xe6ece2), this.hillsK);
    const townInt = 0.95 - 0.72 * night;
    let intensity = townInt + (0.9 - townInt) * this.hillsK;
    // Clear air over the hills, so the castle on its hill shows from far down the valley.
    let density = (0.011 + 0.02 * night) * (1 - this.hillsK) + 0.0055 * this.hillsK;
    const fog = this.fogColor.copy(this.look.horizon);
    if (this.indoorK > 0.01) {
      const room = this.region();
      const roomAmb: Record<string, [number, number]> = {
        entrance: [0xffd0e4, 0.75], animRoom: [0xd8ffe0, 0.6], corridor: [0xb090ff, 0.4], inner: [0xffd0e4, 0.6], gate: [0xffe0d0, 0.7],
        throne: [0x9a3040, 0.36], exit: [0xffffff, 1.4],
      };
      const [c, i] = roomAmb[room ?? "entrance"] ?? [0xffe0e0, 0.6];
      amb.lerp(this.tmpColor.setHex(c), this.indoorK);
      intensity += (i - intensity) * this.indoorK;
      density += (0.018 - density) * this.indoorK;
      fog.lerp(this.tmpColor.setHex(room === "throne" ? 0x14060a : 0x1a1018), this.indoorK);
    }
    if (this.vision === "confront" || this.vision === "shrinking") {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);
      amb.lerp(this.tmpColor.setHex(0xff2030), 0.5 * this.dread);
      intensity *= 1 - 0.35 * this.dread * pulse;
    }
    return { color: amb.getHex(), intensity, fog: fog.getHex(), density };
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private pick(): { kind: "part"; part: ClockPart } | { kind: "hatch" } | { kind: "model" } | { kind: "crown" } | null {
    if (this.vision !== "none") return null;
    const p = this.host.player();
    if (!p.alive) return null;
    const facing = (x: number, z: number, range: number, minDot: number) => {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return -1;
      const dot = d > 0.001 ? (dx * p.lookX + dz * p.lookZ) / d : 1;
      return dot < minDot ? -1 : d + (1 - dot) * 1.5;
    };
    let best: ReturnType<TownDirector["pick"]> = null;
    let bestScore = Infinity;
    if (this.phase === "day") {
      for (const part of CLOCK_PARTS) {
        if (this.found.has(part)) continue;
        const o = this.world.part(part).position;
        const s = facing(o.x, o.z, 2.3, 0.35);
        if (s >= 0 && s < bestScore) { bestScore = s; best = { kind: "part", part }; }
      }
      if (p.z > CLOCK_HATCH.z - 0.2) {
        const s = facing(CLOCK_HATCH.x, CLOCK_HATCH.z, 2.8, 0.3);
        if (s >= 0 && s < bestScore) { bestScore = s; best = { kind: "hatch" }; }
      }
    }
    if (!this.crownFound) {
      const c = this.world.crown.position;
      const s = facing(c.x, c.z, 2.2, 0.3);
      if (s >= 0 && s < bestScore) { bestScore = s; best = { kind: "crown" }; }
    }
    if (!this.solved && this.zone === "castle") {
      // Anywhere around the model's table, looking at it.
      const halfW = (TOWN_AREA.x2 - TOWN_AREA.x1 + 1) * TOWN_CELL * MODEL_SCALE / 2 + 0.3;
      const halfD = (TOWN_AREA.z2 - TOWN_AREA.z1 + 1) * TOWN_CELL * MODEL_SCALE / 2 + 0.3;
      const nx = Math.max(MODEL_TABLE.x - halfW, Math.min(p.x, MODEL_TABLE.x + halfW));
      const nz = Math.max(MODEL_TABLE.z - halfD, Math.min(p.z, MODEL_TABLE.z + halfD));
      if (Math.hypot(p.x - nx, p.z - nz) < 1.8) {
        const s = facing(MODEL_TABLE.x, MODEL_TABLE.z, 6, 0.2);
        if (s >= 0 && s < bestScore) { bestScore = s; best = { kind: "model" }; }
      }
    }
    return best;
  }

  interactionPrompt(): string | null {
    const target = this.pick();
    if (!target) return null;
    if (target.kind === "part") return t("town.act.take", { name: t(PART_NAME[target.part]) });
    if (target.kind === "hatch") return this.found.size >= 3 ? t("town.act.fitParts") : t("town.act.hatch", { n: this.found.size });
    if (target.kind === "crown") return t("town.act.crown");
    return t("town.act.model");
  }

  /** E pressed: what was used ("model" opens the assembly panel), or null. */
  interact(): "used" | "model" | null {
    const target = this.pick();
    if (!target) return null;
    if (target.kind === "model") {
      this.host.audio.playTownSound("slide");
      return "model";
    }
    if (target.kind === "crown") {
      this.crownFound = true;
      this.world.crown.visible = false;
      this.host.audio.playTownSound("pickup");
      this.host.notify(t("town.ntf.crown"));
      return "used";
    }
    if (target.kind === "part") {
      this.takePart(target.part, false);
      this.host.send("part", CLOCK_PARTS.indexOf(target.part));
    } else if (target.kind === "hatch") {
      if (this.found.size < 3) {
        this.host.audio.playTerminalBeep(false);
        this.host.notify(t("town.ntf.hatchMissing", { n: 3 - this.found.size }));
      } else if (!this.clockStarted) {
        this.startClock(false);
        this.host.send("clock", 0);
      }
    }
    return "used";
  }

  // -------------------------------------------------------------------------
  // The model's assembly panel
  // -------------------------------------------------------------------------

  /** Which buildings are already back on the model (the panel polls this: teammates assemble too). */
  modelPlaced(): boolean[] {
    return [...this.placed];
  }

  get isSolved(): boolean {
    return this.solved;
  }

  /** A building dropped on a plot in the panel: whether it belongs there. */
  placePiece(piece: number, plot: number): boolean {
    if (this.solved || this.placed[piece] === undefined || this.placed[piece]) return false;
    if (piece !== plot) {
      // Wrong plot: the castle's lights stutter, something giggles in the walls.
      this.host.audio.playTerminalBeep(false);
      this.host.audio.playFunSound("giggle", (Math.random() - 0.5) * 1.6, 0.5);
      this.world.setCastleMood(0.25);
      this.wrongFlash = 0.35;
      this.wrongPlacements++;
      return false;
    }
    this.setPlaced(piece, false);
    this.host.send("model", piece);
    return true;
  }

  // -------------------------------------------------------------------------
  // Shared facts
  // -------------------------------------------------------------------------

  /** A teammate's fact, relayed by the server (`quiet`: catching up on arrival). */
  applyRemote(kind: string, index: number, quiet = false) {
    if (kind === "part") {
      const part = CLOCK_PARTS[index];
      if (part) this.takePart(part, quiet, true);
    } else if (kind === "clock") {
      this.startClock(quiet);
    } else if (kind === "model") {
      if (index >= 0 && index < MODEL_PIECES.length) this.setPlaced(index, quiet, true);
    } else if (kind === "solved") {
      this.solve(quiet);
    } else if (kind === "kingWake") {
      this.kingWoken = true;
    }
  }

  private takePart(part: ClockPart, quiet: boolean, remote = false) {
    if (this.found.has(part)) return;
    this.found.add(part);
    this.world.setPartTaken(part, true);
    this.world.setHatchPart(part, false);
    if (quiet) return;
    this.host.audio.playTownSound("pickup");
    this.host.notify(t(remote ? "town.ntf.partTeammate" : "town.ntf.part", { name: t(PART_NAME[part]), n: this.found.size }));
    if (this.found.size === 3) this.host.notify(t("town.ntf.allParts"));
  }

  private startClock(late: boolean) {
    if (this.clockStarted) return;
    this.clockStarted = true;
    for (const part of CLOCK_PARTS) {
      this.found.add(part);
      this.world.setPartTaken(part, true);
      this.world.setHatchPart(part, true);
    }
    if (late) {
      // Arriving after dark: no sunset to watch, straight into the night.
      this.musicWanted = false;
      this.host.audio.stopFunMusic(true);
      for (const f of this.folk) f.group.visible = false;
      this.world.setClockGlow(1);
      this.goNight(true);
      return;
    }
    this.phase = "dusk";
    this.duskTime = 0;
    this.beats.clear();
    this.host.audio.playTownSound("place");
  }

  private placedCount(): number {
    return this.placed.filter(Boolean).length;
  }

  private setPlaced(piece: number, quiet: boolean, remote = false) {
    if (this.placed[piece]) return;
    this.placed[piece] = true;
    this.world.setModelPlaced(piece, true);
    this.world.setGateBulbs(this.placedCount());
    if (!quiet) this.host.audio.playTownSound("click");
    if (this.placedCount() === MODEL_PIECES.length && !remote) {
      this.solve(quiet);
      this.host.send("solved", 0);
    }
  }

  private solve(quiet: boolean) {
    if (this.solved) return;
    this.solved = true;
    MODEL_PIECES.forEach((_id, i) => { this.placed[i] = true; this.world.setModelPlaced(i, true); });
    this.world.setGateBulbs(MODEL_PIECES.length);
    this.world.setGate("puzzle", true);
    if (quiet) return;
    this.host.audio.playTownSound("gate");
    this.host.notify(t("town.ntf.solved"));
  }

  // -------------------------------------------------------------------------
  // Monsters
  // -------------------------------------------------------------------------

  /** A monster caught the local explorer. Level 94 never ends a run for it: back to a checkpoint. */
  caught(type: EntityType) {
    if (this.immune) return;
    this.timesCaught++;
    this.caughtFade = 1.4;
    this.host.setFade(1);
    this.host.audio.playKingThud(1, 0);
    if (type === EntityType.TOWN_KING) {
      this.host.teleport(cellCenter(KING_CHECKPOINT.gx), cellCenter(KING_CHECKPOINT.gz), Math.PI);
      this.host.relocateMonsters(KING_CHECKPOINT.gx, KING_CHECKPOINT.gz);
      this.host.notify(t("town.ntf.caughtKing"));
    } else {
      this.host.teleport(cellCenter(TOWN_SPAWN.gx), cellCenter(TOWN_SPAWN.gz), Math.PI);
      this.host.relocateMonsters(TOWN_SPAWN.gx, TOWN_SPAWN.gz);
      this.host.notify(t("town.ntf.caughtAnim"));
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private region(): string | null {
    const p = this.host.player();
    return townCellAt(Math.floor(p.x / TOWN_CELL), Math.floor(p.z / TOWN_CELL))?.region ?? null;
  }

  private beat(at: number, name: string, fn: () => void) {
    if (this.duskTime >= at && !this.beats.has(name)) {
      this.beats.add(name);
      fn();
    }
  }

  update(delta: number) {
    this.time += delta;
    const p = this.host.player();
    const cell = townCellAt(Math.floor(p.x / TOWN_CELL), Math.floor(p.z / TOWN_CELL));
    if (cell) this.zone = cell.zone;
    this.trackPlaces(cell?.region ?? null);

    // Outdoors in the hills (the town's last fence is the line) and under a roof.
    const hillsTarget = this.eternalDay ? 0 : smooth(TOWN_EDGE_Z, TOWN_EDGE_Z - 8, p.z);
    this.hillsK = hillsTarget;
    const indoorTarget = this.zone === "castle" && cell?.region !== "gate" ? 1 : 0;
    this.indoorK = THREE.MathUtils.damp(this.indoorK, indoorTarget, 3, delta);

    if (this.phase === "dusk") this.updateDusk(delta);
    this.updateSky(delta);
    this.updateSound(delta, p);
    for (const f of this.folk) {
      if (!f.group.visible) continue;
      const dx = f.group.position.x - p.x, dz = f.group.position.z - p.z;
      if (dx * dx + dz * dz < 70 * 70) f.update(delta, p.x, p.z);
    }
    if (this.phase === "night" && !this.eternalDay) this.flickerNightLamps();
    this.updateVision(delta, p);
    this.world.update(delta);

    if (this.wrongFlash > 0) {
      this.wrongFlash = Math.max(0, this.wrongFlash - delta);
      if (this.vision === "none") this.world.setCastleMood(this.wrongFlash > 0 ? 0.25 + Math.random() * 0.5 : 1);
    }
    if (this.caughtFade > 0) {
      this.caughtFade = Math.max(0, this.caughtFade - delta);
      if (this.vision === "none") this.host.setFade(Math.min(1, this.caughtFade));
    }
  }

  /** First-time arrivals in each part of the level. */
  private trackPlaces(region: string | null) {
    const once = (key: string, msg: MessageKey) => {
      if (this.seen.has(key)) return;
      this.seen.add(key);
      this.host.notify(t(msg));
    };
    if (this.zone === "hills") once("hills", "town.ntf.hills");
    if (region === "entrance") once("castle", "town.ntf.castle");
    if (region === "animRoom") once("animRoom", "town.ntf.animRoom");
    if (region === "throne") {
      once("throne", "town.ntf.throne");
      const k = this.host.king();
      if (k?.awake && !this.seen.has("kingAwake")) {
        this.seen.add("kingAwake");
        this.host.audio.playKingStinger();
        this.host.notify(t("town.ntf.kingAwake"));
      }
    }
  }

  /** The fixed dusk timeline. */
  private updateDusk(delta: number) {
    this.duskTime += delta;
    const T = this.duskTime;
    this.beat(0, "start", () => {
      this.host.notify(t("town.ntf.clock"));
      this.host.audio.playTownSound("bell");
    });
    this.beat(1.7, "bell2", () => this.host.audio.playTownSound("bell"));
    this.beat(3.4, "bell3", () => this.host.audio.playTownSound("bell"));
    this.beat(3.6, "freeze", () => {
      for (const f of this.folk) f.freeze(cellCenter(TOWN_TOWER.gx), cellCenter(TOWN_TOWER.gz));
    });
    this.beat(6, "music", () => {
      this.musicWanted = false;
      this.host.audio.stopFunMusic(true);
    });
    this.beat(9, "lamps", () => {
      for (let i = 0; i < this.world.lamps.length; i++) this.world.setLamp(i, 1);
      this.host.audio.playTownSound("click");
    });
    // Windows light up as the sun goes, then go out one by one.
    this.lightsOut.forEach((id, i) => {
      const off = 13.5 + (i / this.lightsOut.length) * 4;
      this.world.setHouseLight(id, T < off ? smooth(8, 11, T) : 0);
      this.beat(off, `out_${id}`, () => { if (Math.random() < 0.5) this.host.audio.playTownSound("click", (Math.random() - 0.5) * 1.6, 0.4); });
    });
    this.beat(16, "lampsOut", () => {
      for (let i = 0; i < this.world.lamps.length; i++) if (!NIGHT_LAMPS.has(i)) this.world.setLamp(i, 0);
    });
    this.beat(17.8, "vanish", () => { for (const f of this.folk) f.group.visible = false; });
    // The hands race round to nine at night, then keep real time.
    const hours = 11 + 55 / 60 + 9.1 * smooth(0, DUSK_SECONDS, T);
    this.world.setClockTime(hours, true);
    this.world.setClockGlow(smooth(10, 18, T));
    this.world.setDaylight(1 - smooth(6, 16, T));
    if (T >= DUSK_SECONDS) this.goNight(false);
  }

  /** Full night: the road opens, the Animations come out. */
  private goNight(quiet: boolean) {
    this.phase = "night";
    this.world.setGate("barricade", true);
    this.world.setDaylight(0);
    for (const id of this.world.houses.keys()) this.world.setHouseLight(id, 0);
    for (let i = 0; i < this.world.lamps.length; i++) this.world.setLamp(i, NIGHT_LAMPS.has(i) ? 1 : 0);
    this.host.nightFell();
    if (!this.nightAnnounced && !quiet) {
      this.nightAnnounced = true;
      this.host.notify(t("town.ntf.night"));
      this.host.audio.playKingStinger();
    }
  }

  private flickerNightLamps() {
    for (const i of NIGHT_LAMPS) {
      if (Math.random() < 0.02) this.world.setLamp(i, 0.2);
      else if (Math.random() < 0.15) this.world.setLamp(i, 1);
    }
    this.world.setClockTime(9 + 0.1 + this.time / 3600, true);
  }

  private updateSky(delta: number) {
    // The town's own sky for its time of day...
    let town: SkyLook = SKY_DAY;
    if (this.eternalDay) town = SKY_DAY;
    else if (this.phase === "night") town = SKY_NIGHT;
    else if (this.phase === "dusk") {
      const T = this.duskTime;
      town = T < 12 ? mixSky(this.scratchLook, SKY_DAY, SKY_SUNSET, smooth(6, 12, T)) : mixSky(this.scratchLook, SKY_SUNSET, SKY_NIGHT, smooth(12, DUSK_SECONDS, T));
    }
    // ...and the hills' overcast past the fence.
    mixSky(this.look, town, SKY_HILLS, this.hillsK);
    this.sky.update(delta, this.host.camera.getWorldPosition(this.scratch), this.look);
    this.sky.setIndoors(this.indoorK);
    if (this.phase !== "dusk") this.world.setDaylight(this.eternalDay || this.phase === "day" ? 1 : this.hillsK * 0.9);
  }

  private updateSound(delta: number, p: { x: number; z: number; lookX: number; lookZ: number }) {
    const audio = this.host.audio;
    if (this.vision === "stay") return;
    if (!this.ambienceOn) this.ambienceOn = audio.startTownAmbience();
    if (!this.ambienceOn) return;
    const townDay = (this.phase === "day" || this.eternalDay) && this.zone !== "castle";
    const night = this.phase === "night" && !this.eternalDay;
    const inTown = 1 - this.hillsK;
    const throne = this.region() === "throne";
    audio.setTownAmbience({
      birds: townDay ? inTown : 0,
      crickets: night ? inTown * (1 - this.indoorK) : 0,
      wind: 0.25 + 0.55 * this.hillsK * (1 - this.indoorK),
      drone: this.indoorK * (throne ? 0.9 : 0.35) + (this.vision === "confront" ? 0.6 : 0),
    });
    if (this.musicWanted && townDay && !audio.funMusicPlaying) audio.startFunMusic("town", { volume: 0.5 });

    const pan = (x: number, z: number) => {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      return d > 0.01 ? (dx * -p.lookZ + dz * p.lookX) / d : 0;
    };
    // Strange noises behind the doors, by day.
    this.noiseTimer -= delta;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 7 + Math.random() * 9;
      if (this.phase === "day" && this.zone === "town") {
        const h = NOISY_HOUSES[Math.floor(Math.random() * NOISY_HOUSES.length)];
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (d < 22) {
          const vol = (1 - d / 22) * 0.7;
          const r = Math.random();
          if (r < 0.35) audio.playTownSound("knock", pan(h.x, h.z), vol);
          else if (r < 0.6) audio.playFunSound("creak", pan(h.x, h.z), vol);
          else if (r < 0.8) audio.playFunSound("giggle", pan(h.x, h.z), vol * 0.6);
          else audio.playFunSound("steps", pan(h.x, h.z), vol);
        }
      }
    }
    // The clock ticks once it has its parts back.
    if (this.clockStarted && this.zone === "town") {
      this.tickTimer -= delta;
      if (this.tickTimer <= 0) {
        this.tickTimer = 1;
        const tx = cellCenter(TOWN_TOWER.gx), tz = cellCenter(TOWN_TOWER.gz);
        const d = Math.hypot(tx - p.x, tz - p.z);
        if (d < 30) audio.playTownSound("tick", pan(tx, tz), (1 - d / 30) * 0.6);
      }
    }
    // At night, now and then, the town's tune plays somewhere, wrong.
    if (night && this.zone === "town") {
      this.distantTune -= delta;
      if (this.distantTune <= 0 && !audio.funMusicPlaying) {
        this.distantTune = 40 + Math.random() * 30;
        audio.startFunMusic("town", { volume: 0.18, distortion: 0.85, loop: false });
      }
    }
  }

  // -------------------------------------------------------------------------
  // The vision at the door, and the two endings
  // -------------------------------------------------------------------------

  private setVision(v: Vision) {
    this.vision = v;
    this.visionTime = 0;
  }

  private ensureKing() {
    if (this.king) return this.king;
    const built = buildStandaloneToon(this.world.kitRef, KING_LOOK);
    this.world.root.add(built.group);
    this.king = built;
    return built;
  }

  private animateFigure(fig: { body: THREE.Group; joints: Record<string, THREE.Group> }, scale: number, delta: number, observe: number, lookYaw: number) {
    fig.body.position.set(0, 0, 0);
    fig.body.rotation.set(0, 0, 0);
    animateToon({
      joints: fig.joints, body: fig.body, time: this.time, delta, phase: 0, move: 0, run: 0, observe, look: 1, lookYaw, lookPitch: -0.3,
      agitated: true, chasing: false, ...NO_SCRIPTED_POSE,
    }, 8, 0.6);
    fig.body.position.y += 0.95 * scale;
  }

  private updateVision(delta: number, p: { x: number; z: number; alive: boolean }) {
    this.visionTime += delta;
    const T = this.visionTime;
    if (!p.alive && this.vision !== "none" && this.vision !== "done") {
      // Died of fright in the middle of it: the room goes back to normal.
      this.endVision();
      return;
    }
    switch (this.vision) {
      case "none": {
        if (this.region() !== "throne" || this.caughtFade > 0) break;
        // Still on his throne the first time you walk up: he has an offer.
        const king = this.host.king();
        if (!this.dialogueDone && !this.kingWoken && king && !king.awake
          && Math.hypot(p.x - cellCenter(KING_THRONE.gx), p.z - cellCenter(KING_THRONE.gz)) < DIALOGUE_RANGE) {
          this.beginDialogue();
          break;
        }
        if (Math.hypot(p.x - THRONE_DOOR_X, p.z - THRONE_DOOR_Z) < 9) this.beginConfront(p);
        break;
      }
      case "dialogue":
        break;
      case "crown": {
        // "...The crown knows you." Black. Then the throne.
        this.card.show([t("town.king.crown")], null, "#f6e2a0", smooth(0.2, 0.9, T) * (1 - smooth(2.2, 2.8, T)), [56]);
        this.host.setFade(smooth(1.6, 2.8, T));
        if (T > 3.4) this.beginThrone();
        break;
      }
      case "throne": {
        // You on the throne, crowned; the camera leaves you there, down the length of the hall.
        const fadeIn = 1 - smooth(0, 2.2, T);
        const fadeOut = smooth(13, 15.5, T);
        this.host.setFade(Math.max(fadeIn, fadeOut));
        if (this.throneFigure) {
          poseSeated(this.throneFigure.joints, this.throneFigure.body, NEW_KING_SCALE, this.time, 0.6);
          this.throneFigure.body.position.z = -0.12 * NEW_KING_SCALE;
        }
        if (T > 15.5) this.card.show(["LEVEL 94", "MOTION", "", t("town.end.king")], "#000000", "#f6e2a0", smooth(15.5, 16.5, T), [70, 60, 24, 44]);
        if (T > 21) {
          this.setVision("done");
          this.host.achievement("old_town_king");
          this.host.escape();
        }
        break;
      }
      case "confront":
      case "shrinking": {
        const k = this.ensureKing();
        const kx = k.group.position.x, kz = k.group.position.z;
        const d = Math.hypot(p.x - kx, p.z - kz);
        // Still: answering him.
        if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) > 0.08) { this.stillTime = 0; this.lastX = p.x; this.lastZ = p.z; }
        else this.stillTime += delta;
        if (this.vision === "confront") {
          // Walking up to him is what makes him smaller; backing away lets him grow again.
          this.minDist = Math.min(this.minDist, d);
          if (d > this.minDist + 3.5) this.minDist += delta * 1.6;
          const grow = smooth(0, 2.6, T);
          const target = 0.25 + 2.35 * smooth(2.0, 5.5, this.minDist);
          this.kingScale = THREE.MathUtils.damp(this.kingScale, 1 + (target - 1) * grow, 2.2, delta);
          this.dread = THREE.MathUtils.damp(this.dread, 0.35 + 0.55 * smooth(1, 2.6, this.kingScale), 2, delta);
          if (Math.random() < delta * 0.5) this.host.audio.playKingBreath(0.7 * this.dread, 0, Math.random() < 0.5);
          if (this.minDist < 2.3) {
            this.setVision("shrinking");
            this.host.audio.playTownSound("shrink");
          } else if (this.stillTime > STAY_SECONDS && T > 3) {
            this.beginStay();
            break;
          }
        } else {
          this.kingScale = Math.max(0, this.kingScale - delta * this.kingScale * 2.2 - delta * 0.15);
          this.dread = Math.max(0, this.dread - delta * 0.8);
          if (this.kingScale <= 0.02) {
            k.group.visible = false;
            this.world.setGate("exit", true);
            this.host.audio.playTownSound("door");
            this.host.notify(t("town.ntf.doorOpen"));
            this.setVision("open");
          }
        }
        k.group.scale.setScalar(Math.max(0.001, this.kingScale));
        k.group.rotation.y = Math.atan2(p.x - kx, p.z - kz);
        this.animateFigure(k, KING_LOOK.scale, delta, 1, 0);
        // The room bends.
        const wobble = this.dread * (0.5 + 0.5 * Math.sin(this.time * 2.3));
        this.host.setDread(this.dread);
        this.host.warp(Math.sin(this.time * 1.7) * 0.06 * wobble, Math.sin(this.time * 2.9) * 14 * wobble);
        this.world.setCastleMood(1 - 0.5 * this.dread + 0.3 * this.dread * Math.sin(this.time * 9));
        this.world.setKingLight(1 + this.dread * Math.sin(this.time * 17));
        break;
      }
      case "open": {
        this.dread = Math.max(0, this.dread - delta);
        this.host.setDread(this.dread);
        this.host.warp(0, 0);
        this.world.setCastleMood(1);
        this.world.setKingLight(1);
        const gx = Math.floor(p.x / TOWN_CELL), gz = Math.floor(p.z / TOWN_CELL);
        if (gx === TOWN_EXIT.gx && gz === TOWN_EXIT.gz) {
          this.setVision("white");
          this.host.audio.playTownSound("white");
        }
        break;
      }
      case "white": {
        const a = smooth(0, 1.2, T);
        this.card.show(["LEVEL 94", "MOTION", "", t("town.end.complete")], "#ffffff", "#141414", a, [76, 64, 30, 46]);
        if (T > 6.5) {
          this.setVision("done");
          this.host.achievement("old_town_complete");
          this.host.escape();
        }
        break;
      }
      case "stay": {
        // He leans down. "Stay." Then nothing.
        const k = this.king;
        if (k?.group.visible) {
          k.group.scale.setScalar(Math.max(0.001, this.kingScale));
          this.animateFigure(k, KING_LOOK.scale, delta, 1, 0);
        }
        this.card.show([t("town.end.stay")], null, "#f4efe2", smooth(0.3, 1.0, T) * (1 - smooth(2.6, 3.2, T)), [64]);
        this.host.setFade(smooth(2.2, 3.6, T));
        this.host.setDread(this.dread * (1 - smooth(2.5, 3.6, T)));
        this.host.warp(0, 0);
        if (T > 4.4) this.beginChair();
        break;
      }
      case "chair": {
        // Back in the Old Town, in the chair, in daylight. The camera leaves you there.
        const fadeIn = 1 - smooth(0, 2.2, T);
        const fadeOut = smooth(13, 15.5, T);
        this.host.setFade(Math.max(fadeIn, fadeOut));
        if (this.chair) poseSeated(this.chair.joints, this.chair.body, 1, this.time, 0.48);
        if (T > 15.5) this.card.show([t("town.end.fin")], "#000000", "#e8e2d0", smooth(15.5, 16.5, T), [72]);
        if (T > 19) {
          this.setVision("done");
          this.host.achievement("old_town_stay");
          this.host.escape();
        }
        break;
      }
      default:
        break;
    }
  }

  private beginConfront(p: { x: number; z: number }) {
    const k = this.ensureKing();
    // He's in the doorway, a few metres in front of it, facing you.
    k.group.position.set(THRONE_DOOR_X, CASTLE_FLOOR, THRONE_DOOR_Z + 3.2);
    k.group.visible = true;
    this.kingScale = 1;
    this.minDist = Math.hypot(p.x - THRONE_DOOR_X, p.z - (THRONE_DOOR_Z + 3.2));
    this.stillTime = 0;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.dread = 0.3;
    this.setVision("confront");
    this.host.audio.playKingStinger();
    this.host.audio.playKingWhisper(0.9, 0, true);
  }

  private beginStay() {
    this.setVision("stay");
    this.host.audio.playKingWhisper(1, 0, true);
    this.host.audio.playTownSound("stay");
    this.host.audio.stopTownAmbience();
    this.ambienceOn = false;
  }

  private beginChair() {
    this.setVision("chair");
    if (this.king) this.king.group.visible = false;
    this.host.setDread(0);
    this.world.setCastleMood(1);
    this.world.setKingLight(1);
    // The town goes back to its first morning, as if the clock had never moved.
    this.eternalDay = true;
    this.world.setClockTime(11 + 55 / 60, false);
    for (let i = 0; i < this.world.lamps.length; i++) this.world.setLamp(i, 0);
    for (const f of this.folk) { f.group.visible = true; f.unfreeze(); }
    this.musicWanted = true;
    this.host.audio.stopFunMusic(true);
    // You, in the chair: an Animation wearing your colours.
    const coat = new THREE.Color(this.host.suitColor()).getHex();
    const fig = buildStandaloneToon(this.world.kitRef, { key: "stayFigure", scale: 1, body: 0x0d0d0d, face: "animation", coat, hat: "none", hatColor: 0, limbs: 0.9 });
    const lot = stayChair();
    fig.group.position.set(lot.x, lot.y, lot.z);
    fig.group.rotation.y = -Math.PI / 2;
    this.world.root.add(fig.group);
    this.chair = fig;
    this.host.teleport(lot.x + 1.4, lot.z, -Math.PI / 2);
    this.cinematic = true;
  }

  // -------------------------------------------------------------------------
  // The King's offer
  // -------------------------------------------------------------------------

  private beginDialogue() {
    this.setVision("dialogue");
    this.dialogueNode = "intro";
    this.host.audio.playKingWhisper(0.7, 0, false);
    this.host.dialogue(this.dialogueView());
  }

  /** What the panel shows right now. */
  dialogueView(): TownDialogueView {
    const lines = t(`town.king.${this.dialogueNode}`).split("|");
    const options: TownDialogueView["options"] = [];
    for (const id of ["how", "who"] as const) if (!this.asked.has(id)) options.push({ id, label: t(`town.king.opt.${id}`), secret: false });
    options.push({ id: "accept", label: t("town.king.opt.accept"), secret: false });
    options.push({ id: "refuse", label: t("town.king.opt.refuse"), secret: false });
    if (this.crownWorthy) options.push({ id: "crown", label: t("town.king.opt.crown"), secret: true });
    return { lines, options };
  }

  /** An answer picked in the panel: the next thing he says, or null once the panel closes. */
  chooseDialogue(choice: TownDialogueChoice): TownDialogueView | null {
    if (this.vision !== "dialogue") return null;
    if (choice === "how" || choice === "who") {
      this.asked.add(choice);
      this.dialogueNode = choice;
      this.host.audio.playKingBreath(0.5, 0, true);
      return this.dialogueView();
    }
    this.dialogueDone = true;
    this.host.dialogue(null);
    if (choice === "accept") {
      // He keeps his word, in his own way: you stay.
      this.beginStay();
    } else if (choice === "crown" && this.crownWorthy) {
      this.setVision("crown");
      this.host.audio.playKingWhisper(1, 0, true);
      this.host.audio.playTownSound("bell");
    } else {
      // Turned down, he gets up. For everyone.
      this.setVision("none");
      this.kingWoken = true;
      this.host.send("kingWake", 0);
      this.host.audio.playKingStinger();
      this.host.notify(t("town.ntf.kingRefused"));
    }
    return null;
  }

  /** You on the throne: an Animation in your colours, with the King's crown and robe. */
  private beginThrone() {
    this.setVision("throne");
    this.card.hide();
    if (this.king) this.king.group.visible = false;
    this.host.audio.stopTownAmbience();
    this.ambienceOn = false;
    this.host.audio.startFunMusic("town", { volume: 0.45, distortion: 0.25 });
    const coat = new THREE.Color(this.host.suitColor()).getHex();
    const fig = buildStandaloneToon(this.world.kitRef, { ...KING_LOOK, key: "newKing", scale: NEW_KING_SCALE, face: "animation", coat });
    fig.group.position.set(cellCenter(KING_THRONE.gx), CASTLE_FLOOR, cellCenter(KING_THRONE.gz));
    this.world.root.add(fig.group);
    this.throneFigure = fig;
    this.host.teleport(cellCenter(KING_THRONE.gx), cellCenter(KING_THRONE.gz) + 2, 0);
    this.cinematic = true;
  }

  private endVision() {
    if (this.king) this.king.group.visible = false;
    this.dread = 0;
    this.host.setDread(0);
    this.host.warp(0, 0);
    this.world.setCastleMood(1);
    this.world.setKingLight(1);
    this.card.hide();
    if (this.vision === "dialogue") this.host.dialogue(null);
    this.setVision("none");
  }

  /** The secret ending's camera: from the figure's eyes, slowly back across the room. */
  driveCamera(rig: THREE.Object3D, camera: THREE.Camera) {
    if (this.vision === "throne") {
      // From right in front of your face on the throne, back down the carpet and up.
      const T = this.visionTime;
      const k = smooth(0.5, 14, T);
      const kx = cellCenter(KING_THRONE.gx), kz = cellCenter(KING_THRONE.gz), fy = CASTLE_FLOOR;
      rig.position.copy(new THREE.Vector3(kx, fy + 1.9, kz + 1.8)).lerp(new THREE.Vector3(kx, fy + 5.5, kz + 24), k);
      rig.lookAt(new THREE.Vector3(kx, fy + 1.7, kz));
      rig.rotateY(Math.PI);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      return;
    }
    if (!this.chair) return;
    const T = this.visionTime;
    const k = smooth(0.5, 14, T);
    const cx = this.chair.group.position.x, cz = this.chair.group.position.z;
    // Eye level in the chair, looking out of the open door (west), then back and up to the far corner.
    const fy = this.chair.group.position.y;
    const eye = new THREE.Vector3(cx - 0.1, fy + 1.2, cz);
    const end = new THREE.Vector3(cx + 2.6, fy + 2.75, cz + 2.4);
    rig.position.copy(eye).lerp(end, k);
    const lookAt = new THREE.Vector3(cx - 6, fy + 1.1, cz).lerp(new THREE.Vector3(cx - 0.2, fy + 0.9, cz - 0.1), smooth(1, 9, T));
    rig.lookAt(lookAt);
    rig.rotateY(Math.PI);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  }
}
