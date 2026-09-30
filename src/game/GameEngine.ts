/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lobby, LOBBY, LOBBY_LEVEL, BallNetState } from "./Lobby";
import { Voip } from "./Voip";
import { t, type MessageKey } from "../i18n";
import { OfficeWorker } from "./npc/OfficeWorker";
import { WaterRipples, waterUniforms } from "./Water";
import * as THREE from "three";
import { ProceduralMap, LEVEL_G_DOOR_OPEN_ANGLE, CellType } from "./ProceduralMap";
import { PlayerController, PLAYER_STANDING_HEIGHT, PLAYER_CROUCH_HEIGHT } from "./PlayerController";
import { FACE_SIZE, drawFace, hasFace } from "../utils/face";
import { AudioManager } from "./AudioManager";
import { WanderingEntity, EntityType, EntityNetState, type SkinBodyChoice } from "./WanderingEntity";
import { ALL_ENTITY_TYPES } from "../shared/entityTypes";
import { USABLE_ITEMS } from "../shared/items";
import { KingScratches } from "./KingScratches";
import { KING_POSE_STARE } from "./mobs/fingerKing";
import { GameSettings, RemotePlayer, RoomCheat } from "../types/game";
import { unlockAchievement } from "../utils/achievements";
import { LightPool } from "./LightPool";
import { NoiseBus, footstepLoudness } from "./systems/noiseBus";
import { VisitTracker } from "./systems/visitTracker";
import { LEVEL_DEFS } from "./levels/registry";
import {
  ABANDONED_OFFICE_LEVEL,
  ELECTRICAL_ROOM_LEVEL,
  FUN_LEVEL,
  LEVEL_G,
  LIGHTS_OUT_LEVEL,
  MOTION_LEVEL,
  POOLROOMS_LEVEL,
  SPACE_LEVEL,
} from "./levels/constants";
import { POOL_VALVE_COUNT } from "./poolroomsPuzzle";
import { FunDirector } from "./levels/funDirector";
import { SpaceDirector, type SpaceTerminalView } from "./levels/spaceDirector";
import type { SpaceConsoleId, SpaceTarget, SpaceTerminalId } from "./levels/spaceLayout";
import type { FunStage } from "./LevelFunModels";
import {
  AdaptiveResolution,
  QualityLevel,
  QualityProfile,
  detectQualityLevel,
  getQualityProfile,
} from "./Quality";

/**
 * Everything the engine reports back to React. Grouped into one object because
 * a positional argument list of a dozen callbacks is impossible to call safely.
 */
export interface GameEngineCallbacks {
  onStaminaChange: (val: number) => void;
  onStateChange: (state: string) => void;
  onFlashlightChange: (state: boolean) => void;
  onEscapeTrigger?: () => void;
  /** Fired once, when the player reaches the end of Level 1's secret dark corridor. */
  /** A secret entrance was reached: Lights Out, Level G, or Level FUN. */
  onSecretLevelFound?: (level: number) => void;
  /** Context hint for the crosshair area, e.g. t("act.pushBox"); null clears it. */
  onInteractPrompt?: (text: string | null) => void;
  /** Level FUN: the current goal, shown on the HUD; null when the level has none. */
  onObjectiveChange?: (text: string | null) => void;
  onMegDialogue?: (employee: { name: string; grade: string; dialogue: string }) => void;
  onMegDoorRequest?: () => void;
  /** A diary page was picked up — it goes into the journal, not the inventory. */
  onDiaryPageCollected?: () => void;
  /** The MEG dialogue / exit paper the player was reading closed itself (they walked away). */
  onReadingEnd?: () => void;
  /** Level G: digits found so far (null = missing) and whether the final alarm is on. */
  onLevelGProgress?: (progress: LevelGProgress) => void;
  onRedRoomExposureChange?: (val: number) => void;
  /** Level 7's toxic water exposure (see toxicWaterExposure) — same shape as onRedRoomExposureChange, kept separate rather than shared since the two hazards use different thresholds and are never active at the same time. */
  onToxicWaterExposureChange?: (val: number) => void;
  onHUDNotification?: (msg: string) => void;
  onSectorChange?: (sector: string) => void;
  onInventoryChange?: (items: string[]) => void;
  onSanityChange?: (val: number) => void;
  /** This explorer died (sanity at zero, ...); the app tells the room and shows the spectator UI. */
  onPlayerDeath?: (cause: "sanity" | "caught") => void;
  /** Back from the dead (level change / room reset): the app clears its spectator UI. */
  onPlayerRevive?: () => void;
  onScrapOfNoteCollected?: (seed: number, doorMarker: string) => void;
  /** Smoothed FPS and current render scale, emitted about twice a second. */
  onPerformanceSample?: (fps: number, renderScale: number) => void;
  /** CLIP cheat: true while the player is currently phasing through walls. */
  onNoclipChange?: (active: boolean) => void;
  /** Proximity VOIP: enable()/disable() actually took effect. */
  onVoipStateChange?: (enabled: boolean) => void;
  /** Proximity VOIP: local mic activity crossed the speaking threshold. */
  onVoipSpeakingChange?: (speaking: boolean) => void;
}

/** Multiplier on every sanity drain source: sanity falls slower than the raw tuning. */
const SANITY_DRAIN_SCALE = 0.6;
/** Strange Crystal: while carried, every sanity drain is cut by this factor. */
const CRYSTAL_DRAIN_FACTOR = 0.65;
/** Cassette Tape: radar range while the recording plays, and for how long. */
export const RADAR_BASE_RANGE = 26;
const RADAR_BOOST_RANGE = 70;
const RADAR_BOOST_SECONDS = 30;
const ADRENALINE_SECONDS = 10;
/** Minimum gap between two item uses, so a double-tapped hotbar key doesn't burn two. */
const ITEM_USE_COOLDOWN_MS = 800;
/** Sanity at or above this counts as full: restoring it would waste the item. */
const SANITY_FULL = 0.98;

/** Outcome of GameEngine.useInventoryItem, for the hotbar's feedback. */
export type ItemUseResult = "used" | "blocked" | "missing" | "passive";

/** A running item effect shown on the HUD (`total` 0 = passive, no timer). */
export interface ActiveBuff {
  id: string;
  remaining: number;
  total: number;
}

/** Consumables that go into the inventory on pickup (see useInventoryItem for what each does). */
const INVENTORY_PICKUPS: Partial<Record<string, { notification: MessageKey; achievement?: string }>> = {
  almond_water: { notification: "eng.almond" },
  old_photo: { notification: "eng.photo", achievement: "collector_extraordinary" },
  cassette_tape: { notification: "eng.tape", achievement: "collector_extraordinary" },
  strange_crystal: { notification: "eng.crystal", achievement: "collector_extraordinary" },
  liquid_pain: { notification: "eng.pain" },
};

/** Ambient light and fog per level, shared by level setup and the per-frame event code. */
function levelAtmosphere(level: number, funStage: FunStage = 0) {
  switch (level) {
    case FUN_LEVEL: // Level FUN: a cheerful, cheap party that sours as the puzzles are solved
      return [
        { ambientColor: 0xfff0c8, ambientIntensity: 1.55, fogColor: 0xe9d68a, dimmedFogColor: 0x6a5a2a },
        { ambientColor: 0xe6d29c, ambientIntensity: 1.2, fogColor: 0xb8a25a, dimmedFogColor: 0x463a1c },
        { ambientColor: 0xd0ae8a, ambientIntensity: 0.95, fogColor: 0x76603c, dimmedFogColor: 0x2a2010 },
      ][funStage];
    case SPACE_LEVEL: // Level 79: cold white panels, and the black of space behind the glass
      return { ambientColor: 0xdce6f5, ambientIntensity: 1.45, fogColor: 0x080b12, dimmedFogColor: 0x020304 };
    case LOBBY_LEVEL: // room lobby: open-air field under a clear blue sky
      return { ambientColor: 0xfff6e0, ambientIntensity: 2.6, fogColor: 0x8fc7f0, dimmedFogColor: 0x4a6a8a };
    case LEVEL_G: // Level G: dim, cold office under failing tubes
      return { ambientColor: 0x9aa4ad, ambientIntensity: 0.5, fogColor: 0x23272a, dimmedFogColor: 0x0b0c0d };
    case ABANDONED_OFFICE_LEVEL: // Abandoned Office: cold monitors and dust
      return { ambientColor: 0xd8e8ed, ambientIntensity: 1.35, fogColor: 0x687b82, dimmedFogColor: 0x243238 };
    case ELECTRICAL_ROOM_LEVEL: // Electrical Room: dim industrial halls
      return { ambientColor: 0xb4a092, ambientIntensity: 1.15, fogColor: 0x554039, dimmedFogColor: 0x241a17 };
    case LIGHTS_OUT_LEVEL: // Lights Out: the waypoints and flashlight are all that remain
      return { ambientColor: 0x05050a, ambientIntensity: 0.008, fogColor: 0x000000, dimmedFogColor: 0x000000 };
    case 2: // Pipe Dreams: tense dark reddish brown
      return { ambientColor: 0x8a4a2c, ambientIntensity: 1.4, fogColor: 0x3a1608, dimmedFogColor: 0x1a0902 };
    case 1: // warehouse: brighter industrial
      return { ambientColor: 0xaab5bd, ambientIntensity: 1.35, fogColor: 0x8a9299, dimmedFogColor: 0x24282c };
    case MOTION_LEVEL: // "Motion": bright open-air field by day
      return { ambientColor: 0xdff0ff, ambientIntensity: 2.2, fogColor: 0x9fd4f0, dimmedFogColor: 0x3a5a70 };
    case POOLROOMS_LEVEL: // Classic Poolrooms: bright cyan tiles and clear water
      return { ambientColor: 0xfff8e6, ambientIntensity: 3.2, fogColor: 0xd9e8d2, dimmedFogColor: 0x5e7f78 };
    default: // Level 0: classic yellow
      return { ambientColor: 0xeae2c2, ambientIntensity: 1.05, fogColor: 0xede4c0, dimmedFogColor: 0x5c5740 };
  }
}

export interface LevelGProgress {
  digits: (number | null)[];
  alarm: boolean;
}

/** What each Level G document says; `d` is the digit it gives away. */
const LEVEL_G_DOCUMENTS = [
  (d: number) => t("eng.doc1", { d }),
  (d: number) => t("eng.doc2", { d }),
  (d: number) => t("eng.doc3", { d }),
];

/** Eye height below which an explorer counts as crouched (floor at 0, as on Level G). */
const CROUCHED_EYE_HEIGHT = (PLAYER_STANDING_HEIGHT + PLAYER_CROUCH_HEIGHT) / 2;

/** Seconds on Level G until the Finger King reaches full aggression. */
const LEVEL_G_FULL_AGGRESSION_S = 240;

/** An explorer the monsters can hunt: the local player or a same-level teammate. */
interface AiTarget {
  /** "local" for this client's explorer, otherwise the teammate's id. */
  id: string;
  /** Level G: crouched in a closet, not yet found out. */
  hidden: boolean;
  /**
   * Crouched, judged from eye height: `state` only reads "crouching" while
   * moving — someone crouched and still reports "idle".
   */
  crouched: boolean;
  x: number;
  z: number;
  state: "idle" | "walking" | "running" | "crouching";
  dir: THREE.Vector3;
  flashlight: boolean;
}

function nearestTarget(targets: AiTarget[], x: number, z: number): { target: AiTarget; distSq: number } {
  let best = targets[0];
  let bestDistSq = Infinity;
  for (const t of targets) {
    const dx = t.x - x;
    const dz = t.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDistSq) {
      bestDistSq = d;
      best = t;
    }
  }
  return { target: best, distSq: bestDistSq };
}

/** Like nearestTarget, but anyone still visible beats anyone hidden. */
function nearestHuntable(targets: AiTarget[], x: number, z: number): { target: AiTarget; distSq: number } {
  const visible = targets.filter((t) => !t.hidden);
  return nearestTarget(visible.length > 0 ? visible : targets, x, z);
}

const ENTITY_TYPES = new Set<string>(Object.values(EntityType));

/** Bodies offered by the lobby's SKIN cheat: every monster type, plus the NPC looks (see SkinBodyChoice). */
const MONSTER_SKIN_TYPES: SkinBodyChoice[] = [...ALL_ENTITY_TYPES, "OFFICE_WORKER", "PARTYGOER"];

/** Validates a `monsterSkin` string (network field or cheat-picker choice) against the offered set. */
function monsterSkinType(value?: string | null): SkinBodyChoice | null {
  return value && (MONSTER_SKIN_TYPES as string[]).includes(value) ? (value as SkinBodyChoice) : null;
}

export class GameEngine {
  private containerID: string;
  private container: HTMLElement;
  public renderer!: any;
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  private ambientLight!: THREE.AmbientLight;

  // VHS Post-Processing Properties
  private vhsRenderTarget!: THREE.WebGLRenderTarget;
  private vhsScene!: THREE.Scene;
  private vhsCamera!: THREE.OrthographicCamera;
  private vhsMaterial!: THREE.ShaderMaterial;

  // Level & Player Modules
  public level = 0;
  public map!: ProceduralMap;
  public player!: PlayerController;
  public audio: AudioManager;

  // Local lights
  private flashlight!: THREE.SpotLight;
  private flashlightTarget!: THREE.Object3D;
  private globalDust!: THREE.Points;
  private flickerTimer = 0.0;
  private flickerRemaining = 0.0;

  // Remote Players state
  private remotePlayerGroups: Map<string, THREE.Group> = new Map();
  private remotePlayerLights: Map<string, THREE.SpotLight> = new Map();
  private remotePlayerLightTargets: Map<string, THREE.Object3D> = new Map();

  // Socket sync
  private socket: WebSocket | null = null;
  private networkSendTimer = 0;
  private networkSendInterval = 0.04; // 25 times per second (40ms) update rate

  // Gameplay Loop Control
  /** Frame timer (THREE.Clock is deprecated). Connected to the page so a hidden tab doesn't come back with a minutes-long delta. */
  private timer = new THREE.Timer();
  private totalPlayTime = 0;
  private animationFrameId: number | null = null;
  private isRunning = false;

  /** Sound-reactive mobs (O Eco) poll this; fed by footsteps/prop shoves. Authority-local, never replicated. */
  private noiseBus = new NoiseBus();
  /** O Ceifador's route-memory: which cells the group keeps re-visiting. Authority-local, never replicated. */
  private visitTracker = new VisitTracker();

  // Quality / adaptive resolution
  public qualityLevel: QualityLevel;
  public quality: QualityProfile;
  private adaptive: AdaptiveResolution;
  private adaptiveEnabled: boolean;
  private renderScale = 1;
  private perfReportTimer = 0;

  /** Fixed-size pool that backs every lamp, so the visible light count is constant. */
  private lightPool!: LightPool;

  // Scratch objects reused every frame instead of being reallocated.
  private scratchCamDir = new THREE.Vector3();
  private scratchColor = new THREE.Color();
  private frameCounter = 0;

  // Smilers system
  public smilers: { netId: number; mesh: THREE.Mesh; gridX: number; gridZ: number; spawnTime: number; gazeTimer: number }[] = [];
  private smilerSpawnCheckTimer = 0;
  /** Level 3 ("Lights Out"): seconds the flashlight has been held on continuously. */
  private lightsOutSummonTimer = 0;
  
  // Exposure timer in the mysterious Level 0 Red Rooms (60 seconds to collapse)
  public redRoomExposure = 0;
  /** Level 7: cumulative seconds standing in a toxic ("Hydrolitis Plague") water cell. Same shape as redRoomExposure, own field since the two are never simultaneous but use different thresholds/recovery. */
  public toxicWaterExposure = 0;

  // Wandering Stalker Entities (multiple types spawn on Level 1)
  public entities: WanderingEntity[] = [];

  public get wanderingEntity(): WanderingEntity | null {
    return this.entities[0] || null;
  }

  // --- Replicated world (see "World authority" in server.ts) ---------------
  // Per level, one client simulates the monsters, smilers and blackout rolls
  // and streams them; the rest render that stream instead of running their own.
  /** This client's id in the room, set by App once joined. */
  public localPlayerId: string | null = null;
  /** Level -> id of the client simulating that level. */
  private worldAuthority: Record<string, string> = {};
  /** Latest movement update of each teammate on this level (AI targets). */
  private remoteStates = new Map<string, RemotePlayer>();
  /** Ids handed out in spawn order, identical on every client for fixed spawns. */
  private nextEntityNetId = 0;
  private nextSmilerNetId = 0;
  private worldSendTimer = 0;
  private readonly worldSendInterval = 0.1; // 10 Hz
  private scratchRemoteDirs: THREE.Vector3[] = [];

  // --- Level G ("The Small Office") ----------------------------------------
  /** Seconds spent on Level G: drives the Finger King's aggression. */
  private levelGTime = 0;
  // --- Level 6 ("LEVEL 4" display): day/night cycle -------------------------
  private level6Time = 0;
  private level6IsNight = false;
  private readonly LEVEL6_DAY_S = 90;
  private readonly LEVEL6_NIGHT_S = 60;
  /** The night hunter — spawned/despawned with the day/night cycle, not pooled like the rest of this.entities since there's only ever at most one. */
  private ceifadorEntity: WanderingEntity | null = null;
  // --- Level 7 ("LEVEL 5" display): valve puzzle -----------------------------
  /** Indices into map.valvePositions that have been turned; each sector sequence drains its stage. */
  private valvesTurned = new Set<number>();
  /** Monotonic server revision; stale snapshots must never roll the puzzle back. */
  private poolValveRevision = -1;
  public levelGDigits: (number | null)[] = [null, null, null];
  /** Right code entered: alarm, flickering lights, open emergency door, final chase. */
  public levelGAlarm = false;
  /** Seconds each explorer has been crouched in a closet (authority's view). */
  private levelGHideSeconds = new Map<string, number>();
  /** This client's own closet timer, for its HUD warnings. */
  private localHideSeconds = 0;
  private localHideState: "out" | "hidden" | "found" = "out";
  private levelGAmbushTimer = 25;
  /** A wrong code sends the Finger King straight at you for a while. */
  private levelGAlertTimer = 0;
  private fingerTapTimer = 0;

  // --- Finger King presentation: all local (audio, lights, camera, decals);
  // nothing here feeds back into the replicated AI.
  private kingBreathTimer = 0;
  private kingBreathInhale = true;
  private kingWhisperTimer = 4;
  private kingFalseTapTimer = 25;
  private kingKnockCooldown = 0;
  /** When this explorer's recent footsteps landed (totalPlayTime), for the King's mimicry. */
  private localStepTimes: number[] = [];
  private kingMimicCooldown = 30;
  /** Keeps the hunt stinger/HUD line rare: chase flickers at the sense-radius edge must not re-fire it. */
  private kingStingerCooldown = 0;
  private kingLastPos = new THREE.Vector3();
  private kingHasLastPos = false;
  /** 0..1 how close/visible the King is: drives the dread post-process. */
  private kingDread = 0;
  /** The one-time scripted first sighting down a corridor (see updateKingSighting). */
  private kingSightingDone = false;
  private kingSightingSearch = 0;
  private kingPhantom: { entity: WanderingEntity; t: number; awayX: number; awayZ: number; whispered: boolean } | null = null;
  /** The catch: a ~1.3 s locked-camera lunge before the kill (see updateKingGrab). */
  private kingGrab: { entity: WanderingEntity; t: number; screamed: boolean; baseFov: number } | null = null;
  private kingFaceScratch = new THREE.Vector3();
  /** Post-process: red glitch during the grab, then a cut to black after it. */
  private kingFlash = 0;
  private deathBlack = 0;
  private kingScratches: KingScratches | null = null;
  private nearTerminal = false;
  private level4DoorOpen = false;
  /** Guards the hidden office cake against firing its transition more than once. */
  private funCakeEaten = false;
  private scratchRight = new THREE.Vector3();

  // UI callbacks
  private onStaminaChange: (val: number) => void;
  private onStateChange: (state: string) => void;
  private onFlashlightChange: (state: boolean) => void;
  private onEscapeTrigger?: () => void;
  private onSecretLevelFound?: (level: number) => void;
  private onInteractPrompt?: (text: string | null) => void;
  private onMegDialogue?: (employee: { name: string; grade: string; dialogue: string }) => void;
  private onMegDoorRequest?: () => void;
  private onReadingEnd?: () => void;
  /**
   * Where the dialogue / paper being read lives. Reading never releases the
   * pointer lock (that would drop the player into the pause menu), so the
   * overlay instead closes itself once the player walks out of range.
   */
  private readingAnchor: { x: number; z: number } | null = null;
  /** Cassette tape: seconds left of extended radar range. */
  private radarBoostTimer = 0;
  /** performance.now() of the last successful item use (see ITEM_USE_COOLDOWN_MS). */
  private lastItemUseAt = -Infinity;
  private onDiaryPageCollected?: () => void;
  private lastInteractPrompt: string | null = null;
  private interactPromptTimer = 0;
  private onLevelGProgress?: (progress: LevelGProgress) => void;
  private onRedRoomExposureChange?: (val: number) => void;
  private onToxicWaterExposureChange?: (val: number) => void;
  public onHUDNotification?: (msg: string) => void;
  private onObjectiveChange?: (text: string | null) => void;
  /** How this explorer looks to others (name, suit, face) — for the lobby mirror's copy of them. */
  private selfLook: { name: string; suitColor: string; face: string };
  /** The lobby mirror's copy of the local explorer; only the reflection pass ever renders it. */
  private selfAvatar: THREE.Group | null = null;
  private selfAvatarKey = "";
  /** Level FUN's puzzles and scares; null on every other level. */
  private funDirector: FunDirector | null = null;
  private lastFunObjective: string | null = null;
  /** Level 79's navigation puzzle, sky and finale; null on every other level. */
  private spaceDirector: SpaceDirector | null = null;
  private lastSpaceObjective: string | null = null;
  /** The Level 79 terminal E last opened, for the App's modal. */
  public spaceTerminal: SpaceTerminalId | null = null;
  private spaceShake = 0;
  private fadeOverlay: THREE.Mesh | null = null;
  public onSectorChange?: (sector: string) => void;
  public onInventoryChange?: (items: string[]) => void;
  private onSanityChange?: (val: number) => void;
  private onPlayerDeath?: (cause: "sanity" | "caught") => void;
  private onPlayerRevive?: () => void;
  public onScrapOfNoteCollected?: (seed: number, doorMarker: string) => void;
  private onPerformanceSample?: (fps: number, renderScale: number) => void;
  private onNoclipChange?: (active: boolean) => void;
  private lastReportedNoclip = false;

  // Proximity voice chat — see Voip.ts. Instantiated once; enable()/disable()
  // is what actually opens the mic, so it's cheap to keep around unused.
  private voip: Voip;

  // Sanity system
  public sanity = 1.0;
  private lastReportedSanity = 1.0;

  public currentSector = "";
  public inventory: string[] = [];
  private lastLockNotificationTime = 0;

  // --- Lobby cheat codes (terminal in the room lobby) -----------------------
  // Flags live here, not on `player`, because `player` (PlayerController) is
  // torn down and rebuilt on every level transition — these need to survive
  // that. applyCheatsToPlayer() re-stamps them onto each fresh PlayerController.
  private cheatSpeed = false;
  private cheatStamina = false;
  private cheatClip = false;
  private cheatLife = false;
  /** SETA: the radar points toward this level's secret entrance. */
  public cheatArrow = false;
  /** SKIN cheat: the monster/NPC body worn instead of the hazmat suit, replicated to teammates; "" for none. */
  public cheatSkin: SkinBodyChoice | null = null;

  private lastReportedStamina = 1.0;
  private lastReportedState = "idle";
  private lastReportedFlashlight = true;

  constructor(
    containerID: string,
    settings: GameSettings,
    seed: number,
    socket: WebSocket | null,
    callbacks: GameEngineCallbacks
  ) {
    this.containerID = containerID;
    const el = document.getElementById(containerID);
    if (!el) throw new Error(`Canvas container #${containerID} not found`);
    this.container = el;

    this.socket = socket;
    this.onStaminaChange = callbacks.onStaminaChange;
    this.onStateChange = callbacks.onStateChange;
    this.onFlashlightChange = callbacks.onFlashlightChange;
    this.onEscapeTrigger = callbacks.onEscapeTrigger;
    this.onSecretLevelFound = callbacks.onSecretLevelFound;
    this.onInteractPrompt = callbacks.onInteractPrompt;
    this.onMegDialogue = callbacks.onMegDialogue;
    this.onMegDoorRequest = callbacks.onMegDoorRequest;
    this.onReadingEnd = callbacks.onReadingEnd;
    this.onDiaryPageCollected = callbacks.onDiaryPageCollected;
    this.onLevelGProgress = callbacks.onLevelGProgress;
    this.onRedRoomExposureChange = callbacks.onRedRoomExposureChange;
    this.onToxicWaterExposureChange = callbacks.onToxicWaterExposureChange;
    this.onHUDNotification = callbacks.onHUDNotification;
    this.onObjectiveChange = callbacks.onObjectiveChange;
    this.selfLook = { name: settings.name, suitColor: settings.suitColor, face: settings.face };
    this.onSectorChange = callbacks.onSectorChange;
    this.onInventoryChange = callbacks.onInventoryChange;
    this.onSanityChange = callbacks.onSanityChange;
    this.onPlayerDeath = callbacks.onPlayerDeath;
    this.onPlayerRevive = callbacks.onPlayerRevive;
    this.onScrapOfNoteCollected = callbacks.onScrapOfNoteCollected;
    this.onPerformanceSample = callbacks.onPerformanceSample;
    this.onNoclipChange = callbacks.onNoclipChange;

    this.voip = new Voip((peerId, payload) => this.sendToServer({ type: "voip_signal", to: peerId, data: payload }));
    this.voip.onStateChange = callbacks.onVoipStateChange;
    this.voip.onSpeakingChange = callbacks.onVoipSpeakingChange;

    this.qualityLevel = settings.quality === "auto" ? detectQualityLevel() : settings.quality;
    this.quality = getQualityProfile(this.qualityLevel);
    this.adaptiveEnabled = settings.adaptiveResolution !== false;
    this.adaptive = new AdaptiveResolution(60, 0.5);
    console.log(`[Quality] Preset "${this.qualityLevel}" (adaptive: ${this.adaptiveEnabled})`);

    this.audio = new AudioManager(settings, this.level);
    this.initThree();
    this.initWorld(seed, settings);
    this.startLoop();
  }

  private initThree() {
    this.scene = new THREE.Scene();

    // Psychological Level 0 heavy foggy density (tinted yellow/dirty green)
    this.scene.background = new THREE.Color(0x1a180e);
    this.scene.fog = new THREE.FogExp2(0x1a180e, 0.095); // everything cuts out beyond 10-15 meters

    // Far plane is pulled in to the fog cutoff: nothing beyond it is ever
    // visible, so rendering it is pure waste and it costs depth precision.
    this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 45);

    // Camera Rig representing the physical head
    const cameraRig = new THREE.Group();
    cameraRig.add(this.camera);
    this.scene.add(cameraRig);

    // Always use synchronous high-performance WebGLRenderer to bypass async init race conditions.
    // Antialiasing is deliberately off: the scene is rendered into an offscreen
    // target and resolved through the VHS pass, so MSAA on the default
    // framebuffer would cost memory and bandwidth without affecting the image.
    console.log("[Renderer] Initializing high-performance WebGLRenderer...");
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: "high-performance",
    });

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));

    if (this.renderer.shadowMap) {
      this.renderer.shadowMap.enabled = this.quality.shadows;
      // PCF (not PCFSoft) — the soft variant takes many more texture samples
      // per fragment and the difference is invisible under the VHS filter.
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }

    // Empty previous renderer if any
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    // Re-adjust sizing on browser resizing
    window.addEventListener("resize", this.handleResize);

    // Initialize custom old VHS tape post-processing effects shader setup
    this.initVHSPostProcessing();
  }

  /**
   * Resolution the 3D scene is actually rendered at, before the VHS pass
   * upscales it to the canvas. Combines the quality preset with whatever the
   * adaptive controller has decided.
   */
  private getSceneBufferSize(): { width: number; height: number } {
    const cssW = this.container.clientWidth || 800;
    const cssH = this.container.clientHeight || 600;
    const scale = this.quality.renderScale * this.renderScale;

    // Absolute ceiling so a 4K or ultrawide window cannot blow up the fill cost
    // no matter what the preset asks for.
    const MAX_BUFFER_WIDTH = 1920;
    const clamp = Math.min(1, MAX_BUFFER_WIDTH / Math.max(1, cssW * scale));

    return {
      width: Math.max(160, Math.floor(cssW * scale * clamp)),
      height: Math.max(120, Math.floor(cssH * scale * clamp)),
    };
  }

  private initVHSPostProcessing() {
    const { width: targetW, height: targetH } = this.getSceneBufferSize();

    // 1. Create WebGLRenderTarget for capturing the main 3D scene output
    this.vhsRenderTarget = new THREE.WebGLRenderTarget(targetW, targetH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    // 2. Setup the post-processing orthographic scene and camera for full screen quad rendering
    this.vhsScene = new THREE.Scene();
    this.vhsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Simple pass-through vertex shader transferring coordinates and texture UVs perfectly
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    // High performance fragment shader simulating realistic old VHS playback features with supreme readability
    const fragmentShader = `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uSanity;
      uniform float uDread;
      uniform float uFlash;
      uniform float uBlack;
      varying vec2 vUv;

      float random(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 uv = vUv;
        float insanity = clamp(1.0 - uSanity, 0.0, 1.0);

        // A. CLEANED TRACKING ASPECT (Jitter & scroll lines removed for visual clarity and accessibility)
        float trackingBar = 0.0;
        float rollDistortion = 0.0;
        
        // Low Sanity visual distortions: Add wavy screen warp and quick horizontal tearing glitches
        if (insanity > 0.1) {
          float waveX = sin(uv.y * 25.0 + uTime * 12.0) * 0.004 * insanity;
          float waveX2 = cos(uv.y * 110.0 - uTime * 28.0) * 0.0015 * insanity;
          // Random scanline tearing glitch
          float glitch = step(0.97 - 0.05 * insanity, random(vec2(floor(uTime * 18.0), 12.3))) * 0.012 * insanity;
          uv.x += waveX + waveX2 + glitch;
        }

        // The Finger King is close: the picture shivers; during its grab it tears apart.
        if (uDread > 0.01 || uFlash > 0.01) {
          float tear = step(0.9 - 0.25 * uFlash, random(vec2(floor(uTime * 30.0), floor(uv.y * 40.0))));
          uv.x += (tear * 0.03 * uFlash) + sin(uv.y * 180.0 + uTime * 50.0) * 0.0015 * uDread;
          uv.y += (random(vec2(uTime, 3.1)) - 0.5) * 0.02 * uFlash;
        }
        
        uv.x += trackingBar + rollDistortion;

        // B. CHROMATIC ABERRATION (Scales dynamically with insanity!)
        float distFromCenter = length(uv - 0.5);
        float shiftAmt = 0.0012 + distFromCenter * 0.0018 + (0.016 * insanity) + 0.009 * uDread + 0.035 * uFlash;
        vec2 rgbShift = vec2(shiftAmt, 0.0);
        
        float r = texture2D(tDiffuse, uv - rgbShift).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv + rgbShift).b;
        vec3 color = vec3(r, g, b);

        // C. OVERLAID CRT SCANLINES (Drastically softened and static to ensure excellent display readability)
        float scanlineValue = sin(uv.y * 380.0) * (0.02 + 0.04 * insanity);
        color -= scanlineValue;

        // D. STATIC NOISE (Scales with low sanity)
        if (insanity > 0.05) {
          float noise = random(uv + uTime) * 0.16 * insanity;
          color += vec3(noise);
        }

        // E. VINTAGE TAPE COLOR PROFILE DEGRADATION (Slightly improved saturation for gorgeous modern contrast)
        color = color * 0.96 + vec3(0.006, 0.005, 0.003);
        
        // Squeeze vignette on low sanity (tunnel vision / panic)
        float baseVignetteSize = 0.38 + 0.72 * insanity;
        float vignette = 1.0 - (distFromCenter * distFromCenter * baseVignetteSize);
        color *= vignette;

        // Dread: the edges close in and the grain thickens as it nears.
        color *= 1.0 - uDread * 0.55 * smoothstep(0.15, 0.75, distFromCenter);
        color += vec3(random(uv * 1.7 + uTime) - 0.5) * 0.14 * uDread;
        // Grab: blood-red, blown-out
        color = mix(color, vec3(color.r * 1.6 + 0.12, color.g * 0.25, color.b * 0.2), 0.75 * uFlash);

        // Dark red pulsing vignette warning overlay on critical insanity
        if (insanity > 0.4) {
          float pulse = (sin(uTime * 3.8) * 0.5 + 0.5) * insanity;
          vec3 pulseRed = vec3(0.35, 0.02, 0.02) * pulse * distFromCenter;
          color = mix(color, pulseRed, 0.32 * insanity);
        }

        color *= 1.0 - uBlack;
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // 3. Instantiate custom shader material binding the uniforms
    this.vhsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(targetW, targetH) },
        uSanity: { value: 1.0 },
        uDread: { value: 0 },
        uFlash: { value: 0 },
        uBlack: { value: 0 }
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      depthWrite: false,
      depthTest: false
    });

    // 4. Create quad mesh representing the physical monitor surface and place in vhsScene
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const quadMesh = new THREE.Mesh(quadGeo, this.vhsMaterial);
    this.vhsScene.add(quadMesh);
  }

  /**
   * Fog is tightened in step with the streaming radius so a lower quality
   * preset hides its shorter view distance instead of showing cells pop in.
   */
  private fogDensityFor(level: number): number {
    const authored = level === LOBBY_LEVEL ? 0.008 : level === LEVEL_G ? 0.06 : level === ABANDONED_OFFICE_LEVEL ? 0.016 : level === ELECTRICAL_ROOM_LEVEL ? 0.035 : level === POOLROOMS_LEVEL ? 0.006 : level === FUN_LEVEL ? 0.018 : level === SPACE_LEVEL ? 0.013 : (level === 2 ? 0.032 : (level === 1 ? 0.020 : 0.024));
    const referenceViewDistance = 24;
    const ratio = referenceViewDistance / Math.max(1, this.quality.viewDistance);
    return authored * ratio;
  }

  private initWorld(seed: number, settings: GameSettings) {
    const atmosphere = levelAtmosphere(this.level, this.funDirector?.stage ?? 0);
    this.scene.background = new THREE.Color(atmosphere.fogColor);
    this.scene.fog = new THREE.FogExp2(atmosphere.fogColor, this.fogDensityFor(this.level));

    this.ambientLight = new THREE.AmbientLight(atmosphere.ambientColor, atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Pass level to both map and audio
    this.audio.level = this.level;
    this.audio.setBackgroundAmbienceEnabled(this.level !== LOBBY_LEVEL);

    // Instantiate Procedural Level 0 or 1 Map
    this.map = new ProceduralMap(seed, this.level, this.quality);
    this.map.noiseBus = this.noiseBus;
    this.map.visitTracker = this.visitTracker;

    // Fixed pool of real point lights shared by every lamp in the level.
    this.lightPool = new LightPool(this.scene, this.quality.lightBudget, this.quality.lightRange);

    // Pre-create/load the entire proximity map meshes before placing/spawning the player
    const spawnX = this.map.spawnGridX * this.map.cellSize + this.map.cellSize / 2;
    const spawnZ = this.map.spawnGridZ * this.map.cellSize + this.map.cellSize / 2;
    this.map.performProximityCulling(this.scene, spawnX, spawnZ, true);

    // Local Footstep triggers
    const triggerAudioFootstep = (speed: 'walk' | 'run' | 'crouch') => this.onLocalFootstep(speed);

    // Instantiate Player movement controller after map is pre-loaded
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, triggerAudioFootstep);
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();
    this.applyCheatsToPlayer();
    this.setupLobby();
    this.setupOfficeWorkers();
    this.setupFun();
    this.setupSpace();

    // Spotlight representing local F key Flashlight
    this.flashlight = new THREE.SpotLight(0xfffaec, 2.8, 16, Math.PI / 5, 0.45, 1.0);
    this.flashlight.position.set(0.2, -0.15, 0); // slightly offset representing shoulder mounting
    this.flashlight.castShadow = this.quality.shadows;
    this.flashlight.shadow.mapSize.width = this.quality.shadowMapSize;
    this.flashlight.shadow.mapSize.height = this.quality.shadowMapSize;
    this.flashlight.shadow.camera.near = 0.1;
    this.flashlight.shadow.camera.far = 18;
    this.flashlight.shadow.bias = -0.0015;
    
    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0, 0, -5);
    this.camera.add(this.flashlightTarget);
    
    this.flashlight.target = this.flashlightTarget;
    this.camera.add(this.flashlight);

    // Instantiate the Level 1 sector 1/2 monsters (no smilers here — they live
    // only in sector 3).
    this.entities = [];
    if (this.level === 1) {
      this.spawnLevel1Entities();
    }
    if (this.level === ELECTRICAL_ROOM_LEVEL) {
      const def3 = LEVEL_DEFS[ELECTRICAL_ROOM_LEVEL];
      if (def3.spawn.kind === "static") this.spawnStaticRoster(def3.spawn.roster, 8);
    }

    // Initial first-turn map culler tick
    this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z);

    // Dynamic global dust cloud centered on player
    this.initGlobalDust();
    this.ripples = new WaterRipples(this.scene);
  }

  public async precreateMap(onProgress?: (p: number) => void): Promise<void> {
    if (this.map) {
      await this.map.precreateAllCellsAsync(this.scene, onProgress);
    }
  }

  public handleResize = () => {
    if (!this.renderer || !this.camera || !this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.applySceneBufferSize();
  };

  /**
   * Resizes the offscreen scene buffer to the current quality/adaptive scale.
   *
   * The previous implementation resized this target to the full canvas size on
   * every resize, silently discarding the half-resolution optimisation and
   * quadrupling the shaded pixel count for the rest of the session.
   */
  private applySceneBufferSize() {
    if (!this.vhsRenderTarget) return;
    const { width, height } = this.getSceneBufferSize();
    if (this.vhsRenderTarget.width === width && this.vhsRenderTarget.height === height) return;

    this.vhsRenderTarget.setSize(width, height);
    if (this.vhsMaterial) {
      this.vhsMaterial.uniforms.uResolution.value.set(width, height);
    }
  }

  /** Switches graphics preset at runtime without recreating the level. */
  public setQuality(level: QualityLevel) {
    this.qualityLevel = level;
    this.quality = getQualityProfile(level);
    this.adaptive.reset();
    this.renderScale = 1;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    if (this.renderer.shadowMap) {
      this.renderer.shadowMap.enabled = this.quality.shadows;
    }
    if (this.flashlight) {
      this.flashlight.castShadow = this.quality.shadows;
    }
    this.applySceneBufferSize();

    // Streaming radius and fog follow the preset; force a re-cull so the change
    // takes effect without waiting for the player to walk another 2.5m.
    if (this.map && this.player) {
      this.map.quality = this.quality;
      this.map.maxVisibleDistance = this.quality.viewDistance * (this.level === 1 ? 1.15 : 1.0);
      this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z, true);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = this.fogDensityFor(this.level);
    }
    if (this.lightPool) {
      this.lightPool.invalidate();
    }

    // Note: the light pool keeps its original size. Resizing it would change the
    // scene's visible light count, which is exactly the shader recompilation the
    // pool exists to avoid, so a new budget only applies on the next session.
  }

  public updateConfig(settings: GameSettings) {
    this.audio.setSettings(settings);
    this.selfLook = { name: settings.name, suitColor: settings.suitColor, face: settings.face };
    if (this.player) {
      this.player.setMouseSensitivity(settings.mouseSensitivity);
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private startLoop() {
    this.isRunning = true;
    this.timer.connect(document);
    this.timer.reset(); // the first frame measures from here, not from construction
    const animate = () => {
      if (!this.isRunning) return;
      this.animationFrameId = requestAnimationFrame(animate);

      const delta = this.timer.update().getDelta();
      this.totalPlayTime += delta;
      this.noiseBus.prune(this.totalPlayTime);
      this.frameCounter++;

      // Trade pixels for frame rate before the game starts feeling sluggish.
      if (this.adaptiveEnabled) {
        const newScale = this.adaptive.update(delta);
        if (newScale !== null) {
          this.renderScale = newScale;
          this.applySceneBufferSize();
        }
      }

      // Report FPS / render scale to the HUD about twice a second.
      if (this.onPerformanceSample) {
        this.perfReportTimer += delta;
        if (this.perfReportTimer >= 0.5) {
          this.perfReportTimer = 0;
          this.onPerformanceSample(this.adaptive.fps, this.quality.renderScale * this.renderScale);
        }
      }

      // Ensure Audio remains active
      this.audio.init();

      // Tick player controllers
      if (this.isDead || this.isWaitingForTransition) this.updateSpectator(delta);
      else if (this.kingGrab) this.updateKingGrab(delta);
      else {
        this.player.update(delta);
        if (this.level === ELECTRICAL_ROOM_LEVEL && this.map) {
          const gx = Math.floor(this.player.position.x / this.map.cellSize);
          const gz = Math.floor(this.player.position.z / this.map.cellSize);
          if (this.map.level3LowCorridor.has(`${gx},${gz}`) && this.player.position.y > CROUCHED_EYE_HEIGHT + 0.18) {
            this.onHUDNotification?.(t("eng.level3Crouch"));
          }
        }
      }
      this.updateLobby(delta);
      this.updateOfficeWorkers(delta);
      this.updateFun(delta);
      this.updateSpace(delta);
      this.updateInteractPrompt(delta);
      this.updateReadingRange();
      if (this.radarBoostTimer > 0) this.radarBoostTimer = Math.max(0, this.radarBoostTimer - delta);


      // Detect if explorer has entered creeping crimson Red Rooms
      let inRedRoom = false;
      if (this.level === 0 && this.map && this.player) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const gx = Math.floor(px / this.map.cellSize);
        const gz = Math.floor(pz / this.map.cellSize);
        if (this.map.grid[gx] && this.map.grid[gx][gz] === 7) { // CellType.RED_ROOM is 7
          inRedRoom = true;
        }
      }

      if (inRedRoom) {
        this.redRoomExposure += delta;
        if (this.onRedRoomExposureChange) {
          this.onRedRoomExposureChange(this.redRoomExposure);
        }

        // Subtly rattle/flicker the ambient hum audio slightly to signal atmospheric instability
        if (Math.random() < delta * 0.12) {
          this.audio.triggerHumFlicker(50);
        }

        // If continuous/cumulative exposure reaches exactly 60 seconds (1 minute), the player succumbs
        if (this.redRoomExposure >= 60.0) {
          console.warn("[GameEngine] Succumbed to Red Room silent dimension collapse. Relocating safely...");
          this.redRoomExposure = 0;
          if (this.onRedRoomExposureChange) {
            this.onRedRoomExposureChange(0);
          }

          // Trigger collapse sound effect
          this.audio.playEntityCatchSound();

          // Reset parameters and teleport key coordinates safely to spawn
          this.player.spawnSafely();

          // Relocate hostile entities far away
          const playerGX = Math.floor(this.player.position.x / this.map.cellSize);
          const playerGZ = Math.floor(this.player.position.z / this.map.cellSize);
          this.relocateEntitiesAwayFrom(playerGX, playerGZ);

          // Core culling update
          this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z, true);
        }
      } else if (this.redRoomExposure > 0) {
        // Recover slowly when leaving the Red Room (at 0.5x rate)
        this.redRoomExposure = Math.max(0, this.redRoomExposure - delta * 0.5);
        if (this.onRedRoomExposureChange) {
          this.onRedRoomExposureChange(this.redRoomExposure);
        }
      }

      // Level 7: toxic ("Hydrolitis Plague") water — a much sharper, faster
      // hazard than the Red Room (per the wiki level it's based on, dying
      // "in seconds" if you linger), with a proportionally faster recovery
      // once you're clear of it.
      let inToxicWater = false;
      if (this.level === POOLROOMS_LEVEL && this.map && this.player) {
        const gx = Math.floor(this.player.position.x / this.map.cellSize);
        const gz = Math.floor(this.player.position.z / this.map.cellSize);
        if (this.map.toxicWaterCells.has(`${gx},${gz}`)) inToxicWater = true;
      }
      const TOXIC_WATER_THRESHOLD_S = 8.0;
      if (inToxicWater) {
        this.toxicWaterExposure += delta;
        this.onToxicWaterExposureChange?.(this.toxicWaterExposure);
        if (this.toxicWaterExposure >= TOXIC_WATER_THRESHOLD_S) {
          this.toxicWaterExposure = 0;
          this.onToxicWaterExposureChange?.(0);
          this.audio.playEntityCatchSound();
          this.player.spawnSafely();
          const playerGX = Math.floor(this.player.position.x / this.map.cellSize);
          const playerGZ = Math.floor(this.player.position.z / this.map.cellSize);
          this.relocateEntitiesAwayFrom(playerGX, playerGZ);
          this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z, true);
        }
      } else if (this.toxicWaterExposure > 0) {
        this.toxicWaterExposure = Math.max(0, this.toxicWaterExposure - delta * 1.2);
        this.onToxicWaterExposureChange?.(this.toxicWaterExposure);
      }

      // Track Level Sector transitions and collectible pickups
      if (this.map && this.player) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const gx = Math.floor(px / this.map.cellSize);
        const gz = Math.floor(pz / this.map.cellSize);

        // 1. Sector Identification and Notification (Level 1 and Level G)
        if (this.level === 1 || this.level === LEVEL_G) {
          let sec: string;
          if (this.level === LEVEL_G) {
            const s = this.map.levelGSectorOf(gx, gz);
            sec = s === 1 ? t("sector.g1")
              : s === 2 ? t("sector.g2")
              : s === 3 ? t("sector.g3")
              : this.currentSector; // corridors between sectors: keep the last one
          } else {
            const s = this.getCurrentSector(gx, gz);
            sec = s === 1
              ? t("sector.1")
              : s === 2
                ? t("sector.2")
                : t("sector.3");
          }

          if (sec && sec !== this.currentSector) {
            const oldSector = this.currentSector;
            this.currentSector = sec;
            if (this.onSectorChange) {
              this.onSectorChange(sec);
            }
            if (oldSector && this.onHUDNotification) {
              this.onHUDNotification(t("eng.entering", { name: sec.toUpperCase() }));
            }
          }
        }

        // 2. Proximity Collectible pickup checks! (Both Level 0 and Level 1)
        // Only nearby items are tested, and the compare stays squared so the
        // hot path never calls Math.sqrt.
        this.map.activeConsumables.forEach((item) => {
          if (!item.collected) {
            const dx = px - item.x;
            const dz = pz - item.z;
            // Pickup radius of 1.6 meters so items resting on shelves or boilers with collision can still be reached.
            if (dx * dx + dz * dz < 2.56) {
              item.collected = true;
              item.mesh.visible = false;
              // Play pickup sound (using exit glitch sound which is clear and beautiful!)
              this.audio.playGlitchNoclipSound();
              
              const pickup = INVENTORY_PICKUPS[item.type];
              if (pickup) {
                this.inventory.push(item.type);
                this.onHUDNotification?.(t(pickup.notification));
                if (pickup.achievement) unlockAchievement(pickup.achievement);
                this.onInventoryChange?.([...this.inventory]);
              } else if (item.type === "energy_bar") {
                this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 0.25);
                this.sanity = Math.min(1.0, this.sanity + 0.15);
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.energy"));
                }
              } else if (item.type === "diary_page") {
                // Not an inventory item: the page goes straight into the journal.
                this.onHUDNotification?.(t("eng.diary"));
                unlockAchievement("collector_extraordinary");
                this.onDiaryPageCollected?.();
              } else if (item.type === "g_document" && item.docIndex !== undefined) {
                const i = item.docIndex;
                const digit = Number(this.map.levelGCode[i]);
                this.levelGDigits[i] = digit;
                const found = this.levelGDigits.filter((d) => d !== null).length;
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.doc", { n: found, text: LEVEL_G_DOCUMENTS[i](digit) }));
                }
                this.emitLevelGProgress();
              } else if (item.type === "scrap_of_note") {
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.scrap"));
                }
                if (this.onScrapOfNoteCollected) {
                  const noteSeed = Math.floor(Math.abs(item.x * 313 + item.z * 719) % 100000) || Math.floor(Math.random() * 100000);
                  // The clue marker is a per-map (per-seed) fact, so it is the
                  // same on every note in this room; only the flavour text varies.
                  const marker = this.level === 0 ? this.map.correctDoorMarker : "";
                  this.onScrapOfNoteCollected(noteSeed, marker);
                }
              }
            }
          }
        });
      }

      // Update stamina-based procedural breath and heart-rate audio sweeps
      this.audio.updateBreathing(this.player.stamina, delta, this.sanity);

      // Update Wandering Stalker Entities (multi-entity ecosystem). The
      // level's authority runs their AI against every explorer on the level;
      // everyone else just follows the replicated stream.
      const worldAuthority = this.isWorldAuthority;
      const camDir = this.scratchCamDir;
      this.camera.getWorldDirection(camDir);
      const aiTargets = worldAuthority ? this.collectAiTargets(camDir) : null;
      if (aiTargets) {
        const cs = this.map.cellSize;
        for (const tgt of aiTargets) {
          this.visitTracker.visit(tgt.id, Math.floor(tgt.x / cs), Math.floor(tgt.z / cs));
        }
      }

      // Level G: closets, the Finger King's aggression/ambushes, its taps and
      // the final alarm. Runs before the AI so hidden explorers are marked.
      this.updateLevelG(delta, aiTargets);

      // Level 6: day/night cycle, O Ceifador's night hunt.
      this.updateLevel6(delta);

      if (this.entities.length > 0 && this.player) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        let caught = false;
        let caughtBy: WanderingEntity | null = null;
        const canBeCaught = !this.isDead && !this.kingGrab;

        this.entities.forEach(entity => {
          if (aiTargets) {
            // Hunt whichever explorer is closest (on Level G, visible ones first).
            const { target, distSq: entityDistSq } = this.level === LEVEL_G
              ? nearestHuntable(aiTargets, entity.mesh.position.x, entity.mesh.position.z)
              : nearestTarget(aiTargets, entity.mesh.position.x, entity.mesh.position.z);
            entity.targetHidden = target.hidden;

            // Entities far from everyone are simulated at a reduced rate: their
            // AI still runs, just not 60 times a second for something invisible.
            if (entityDistSq > 1600 && (this.frameCounter & 3) !== 0) { // beyond 40m
              return;
            }
            const entityDelta = entityDistSq > 1600 ? delta * 4 : delta;

            entity.update(entityDelta, target.x, target.z, target.state, target.dir, target.flashlight);
            // Billboard towards *our* camera, not the explorer it's hunting.
            entity.mesh.lookAt(px, entity.mesh.position.y, pz);
          } else {
            entity.updateReplica(delta, px, pz);
          }

          // Catches are judged locally: each client only checks its own explorer.
          // Trigger reset when distance is less than 1.45 meters (squared is ~2.1)
          const dx = entity.mesh.position.x - px;
          const dz = entity.mesh.position.z - pz;
          if (canBeCaught && !caught && !this.cheatLife && dx * dx + dz * dz < 2.1) {
            caught = true;
            caughtBy = entity;
            console.warn(`[GameEngine] Explorer CAUGHT by ${entity.type}! Reseting state...`);
          }
        });

        this.updateMonsterAudio(delta);

        // Being caught is fatal: the monster got you. You spectate until the
        // group advances a level (or, if everyone is dead, resets).
        // The Finger King doesn't just touch you: it takes its time (see updateKingGrab).
        if (caught && !this.cheatLife) {
          const by = caughtBy as WanderingEntity | null;
          if (by?.type === EntityType.FINGER_KING) this.startKingGrab(by);
          else this.die("caught");
        }
      }

      // Update psychological Smilers
      this.updateSmilers(delta, aiTargets);

      // Stream monsters/smilers to the rest of the level (authority only).
      this.sendWorldState(delta);

      // Sanity system depletion & recovery calculation (the dead don't lose any more)
      if (this.player && this.map && !this.isDead) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        let nearMonster = false;
        let monsterDepletionSum = 0;

        // 1. Distance check to active entities (hostile monsters)
        this.entities.forEach(ent => {
          const dx = ent.mesh.position.x - px;
          const dz = ent.mesh.position.z - pz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 8.0) {
            nearMonster = true;
            monsterDepletionSum += (8.0 - dist) * 0.008; // closer = faster (retuned ~3x slower)
          }
        });

        // 2. Distance check to active smilers (ambient dread from mere proximity,
        //    separate from and stacking with the sustained-gaze drain in updateSmilers)
        this.smilers.forEach(s => {
          const dx = s.mesh.position.x - px;
          const dz = s.mesh.position.z - pz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 6.0) {
            nearMonster = true;
            monsterDepletionSum += (6.0 - dist) * 0.010; // retuned ~3x slower
          }
        });

        // 3. Darkness check
        let darknessDepletion = 0;
        const isFlashlightOn = this.player.isFlashlightOn;
        if (!isFlashlightOn && this.level !== LOBBY_LEVEL && this.level !== SPACE_LEVEL) {
          if (this.map.globalEventState === "blackout") {
            darknessDepletion = 0.014; // completed blackout is terrifying (retuned ~3x slower)
          } else if (this.level === ELECTRICAL_ROOM_LEVEL) {
            darknessDepletion = 0.003; // Brick halls have working ceiling fixtures; the flashlight is still useful
          } else if (this.level === 1 || this.level === 2) {
            darknessDepletion = 0.008; // dark industrial environments (retuned ~3x slower)
          } else {
            darknessDepletion = 0.003; // normal level 0 with fluorescent lights on but flashlight off (retuned ~2x slower)
          }
        }

        // Apply depletion or recovery. LIFE keeps sanity full and prevents every
        // sanity-based death while the cheat is active.
        if (this.cheatLife) {
          this.sanity = 1.0;
        } else if (nearMonster) {
          this.sanity = Math.max(0.0, this.sanity - (monsterDepletionSum + darknessDepletion) * SANITY_DRAIN_SCALE * this.sanityDrainFactor() * delta);
        } else if (darknessDepletion > 0) {
          this.sanity = Math.max(0.0, this.sanity - darknessDepletion * SANITY_DRAIN_SCALE * this.sanityDrainFactor() * delta);
        } else {
          // Recover sanity in normal illuminated space (trimmed only slightly, so a
          // careful player still recovers at close to the old pace)
          this.sanity = Math.min(1.0, this.sanity + 0.014 * delta);
        }

        // A shaken mind tires the body: below 50% sanity, stamina recovers
        // slower (down to 35% of normal at zero).
        this.player.staminaRegenScale = this.sanity >= 0.5 ? 1.0 : 0.35 + 1.3 * this.sanity;

        // Zero sanity: this explorer is out. They spectate a living teammate
        // until the room advances a level (everyone revives) or, if everyone
        // is dead, the group picks a reset (see App.tsx).
        if (this.sanity <= 0) this.die("sanity");
      }

      // Level 1's secret entrance: walk to the dead end of the unlit side
      // corridor and the "Lights Out" transition fires — purely local (not a
      // room-wide level_transition_request), since it's an optional solo detour.
      if (this.level === 1 && this.map && this.map.secretGridX >= 0 && this.onSecretLevelFound) {
        const pgX = Math.floor(this.player.position.x / this.map.cellSize);
        const pgZ = Math.floor(this.player.position.z / this.map.cellSize);
        if (pgX === this.map.secretGridX && pgZ === this.map.secretGridZ) {
          this.onSecretLevelFound(LIGHTS_OUT_LEVEL);
        }
      }

      // The abandoned office contains a hidden route into Level G. The old
      // office-door marker is reused as a deterministic convergence point.
      // (Level FUN's own entrance is the hidden cake — see nearFunCake/tryInteract,
      // an E-press rather than a walk-in trigger.)
      if (this.level === ABANDONED_OFFICE_LEVEL && this.map && this.map.abandonedSecretX >= 0 && this.onSecretLevelFound) {
        const pgX = Math.floor(this.player.position.x / this.map.cellSize);
        const pgZ = Math.floor(this.player.position.z / this.map.cellSize);
        if (pgX === this.map.abandonedSecretX && pgZ === this.map.abandonedSecretZ) {
          this.onSecretLevelFound(LEVEL_G);
        }
      }

      // Level 0: the exit is a taped wall/floor with no physics — pass through it.
      if (this.level === 0 && this.map && this.map.noclipCellX >= 0) {
        if (this.map.isInNoclipExit(this.player.position.x, this.player.position.z)) {
          this.noclipDwell += delta;
          if (Math.random() < delta * 6) this.audio.triggerHumFlicker(60);
          // The floor swallows you a moment after stepping on it; the wall is instant.
          if (this.noclipDwell >= (this.map.noclipKind === "floor" ? 0.45 : 0.05)) {
            this.noclipDwell = 0;
            this.audio.playGlitchNoclipSound();
            this.onEscapeTrigger?.();
          }
        } else {
          this.noclipDwell = 0;
        }
      }

      // Other levels: stepping into the exit cell is enough (Level G's can't be
      // entered until the emergency door opens).
      if (this.level !== 0 && this.map && (this.map.exitGridX !== 0 || this.map.exitGridZ !== 0)) {
        const pgX = Math.floor(this.player.position.x / this.map.cellSize);
        const pgZ = Math.floor(this.player.position.z / this.map.cellSize);
        if (pgX === this.map.exitGridX && pgZ === this.map.exitGridZ && (this.level !== ELECTRICAL_ROOM_LEVEL || this.map.level3GateOpen) && (this.level !== ABANDONED_OFFICE_LEVEL || this.level4DoorOpen) && (this.level !== POOLROOMS_LEVEL || this.map.poolroomsSolved) && (this.level !== FUN_LEVEL || this.funDirector?.exitOpen)) {
          this.audio.playGlitchNoclipSound();
          this.onEscapeTrigger?.();
        }
      }

      // Dyn-Culling map optimization ticks (run less frequently to save core cycles)
      this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z);

      // Bind the fixed light pool to the lamps nearest the player. The scene's
      // visible light count never changes, so materials are never recompiled.
      this.lightPool.update(this.map.dynamicLights, this.player.position.x, this.player.position.z, delta);

      // Flickering fluorescent tubes ticks. Only the level's authority rolls
      // blackouts/flicker storms; it broadcasts each one as it starts.
      // Level FUN scripts its own blackouts; random ones would step on them.
      // Level 79's lighting belongs to its navigation sequences for the same reason.
      this.map.rollGlobalEvents = this.isWorldAuthority && this.level !== LOBBY_LEVEL && this.level !== FUN_LEVEL && this.level !== SPACE_LEVEL;
      const eventBefore = this.map.globalEventState;
      this.map.updateLights(
        delta,
        (dur) => this.audio.triggerHumFlicker(dur),
        (pan, vol) => this.audio.playWaterDrip(pan, vol),
        this.player.position.x,
        this.player.position.z
      );
      this.map.updatePoolroomsWater(delta, this.player?.position.x, this.player?.position.z);
      const eventNow = this.map.globalEventState;
      if (this.map.rollGlobalEvents && eventBefore === "normal" && eventNow !== "normal") {
        this.sendToServer({ type: "world_event", level: this.level, state: eventNow, duration: this.map.globalEventTimer });
      }

      // Ambient light, fog, and background blackout event state reaction
      if (this.ambientLight) {
        // Per-level values: this runs every frame, so hardcoding Level 0/1
        // here used to override Level 2/3's darker setup from transitionToLevel.
        const atmosphere = levelAtmosphere(this.level, this.funDirector?.stage ?? 0);
        // Level 6's day/night cycle overrides its own base (daylight) atmosphere
        // live, rather than going through levelAtmosphere (which only knows the
        // level id, not this runtime cycle state).
      const isLevel6Night = this.level === LIGHTS_OUT_LEVEL && this.level6IsNight;
        const baseInt = isLevel6Night ? 0.12 : atmosphere.ambientIntensity;
        const defaultFog = isLevel6Night ? 0x040608 : atmosphere.fogColor;

        // The background colour is mutated in place. Allocating a THREE.Color
        // every frame produced ~3600 short-lived objects per minute and forced
        // the renderer to re-upload the clear colour each time.
        if (!(this.scene.background instanceof THREE.Color)) {
          this.scene.background = this.scratchColor;
        }
        const background = this.scene.background as THREE.Color;
        const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;

        if (this.map.globalEventState === "blackout") {
          // Pure pitch dark blackout
          this.ambientLight.intensity = 0.0;
          if (fog) fog.color.setHex(0x020202);
          background.setHex(0x020202);
        } else if (this.map.globalEventState === "flicker_storm") {
          // Rapid flickering ambient with soft contrast bounds to reduce eyestrain
          const flashOn = Math.random() > 0.45;
          this.ambientLight.intensity = flashOn ? baseInt : baseInt * 0.45;

          const dimmedFog = atmosphere.dimmedFogColor;
          const currentFogColor = flashOn ? defaultFog : dimmedFog;
          if (fog) fog.color.setHex(currentFogColor);
          background.setHex(currentFogColor);
        } else {
          // Reset to normal intensity and color
          this.ambientLight.intensity = baseInt;
          if (fog) fog.color.setHex(defaultFog);
          background.setHex(defaultFog);
        }

        // Level G's final alarm: pulsing emergency red over the flickering tubes
        if (this.level === LEVEL_G && this.levelGAlarm) {
          const pulse = 0.5 + 0.5 * Math.sin(this.totalPlayTime * 6.5);
          this.ambientLight.color.setHex(0xff2a1a);
          this.ambientLight.intensity = 0.2 + 0.6 * pulse;
          const alarmFog = pulse > 0.5 ? 0x2a0504 : 0x0d0202;
          if (fog) fog.color.setHex(alarmFog);
          background.setHex(alarmFog);
        }

        // Level 79: the navigation sequences own the station's light (green, red, fading).
        if (this.spaceDirector) {
          const a = this.spaceDirector.atmosphere();
          this.ambientLight.color.setHex(a.color);
          this.ambientLight.intensity = a.intensity;
          if (fog) fog.color.setHex(a.fog);
          background.setHex(a.fog);
        }
      }

      // Local spotlight updating with probability-based flickering when sanity is below 40%
      if (!this.player.isSpectating && this.player.isFlashlightOn) {
        if (this.sanity < 0.40) {
          if (this.flickerRemaining > 0) {
            this.flickerRemaining -= delta;
            // Rapid stochastic strobe during the active flicker window
            const flickerRoll = Math.random();
            if (flickerRoll < 0.35) {
              this.flashlight.visible = false;
              this.flashlight.intensity = 0.0;
            } else if (flickerRoll < 0.65) {
              this.flashlight.visible = true;
              this.flashlight.intensity = 0.35; // dim battery buzz
            } else {
              this.flashlight.visible = true;
              this.flashlight.intensity = 3.3; // brief overpower spark surge!
            }
          } else {
            // Chance to trigger a new flicker sequence based on how low sanity is
            const triggerThreshold = (0.40 - this.sanity) * 0.12; // lower sanity = higher frequency
            if (Math.random() < triggerThreshold) {
              this.flickerRemaining = Math.random() * 0.6 + 0.15; // lasts between 150ms and 750ms
              if (this.audio) {
                this.audio.triggerHumFlicker(Math.floor(this.flickerRemaining * 1000));
              }
            }
            this.flashlight.visible = true;
            this.flashlight.intensity = 2.8;
          }
        } else {
          this.flashlight.visible = true;
          this.flashlight.intensity = 2.8;
          this.flickerRemaining = 0;
        }
      } else {
        this.flashlight.visible = false;
        this.flashlight.intensity = 0.0;
        this.flickerRemaining = 0;
      }

      // Report current player telemetry states up to React UI components (optimized throttling to avoid React 60fps churn)
      const diffStamina = Math.abs(this.player.stamina - this.lastReportedStamina);
      if (diffStamina > 0.015 || (this.player.stamina <= 0.01 && this.lastReportedStamina > 0.01) || (this.player.stamina >= 0.99 && this.lastReportedStamina < 0.99)) {
        this.onStaminaChange(this.player.stamina);
        this.lastReportedStamina = this.player.stamina;
      }
      if (this.player.state !== this.lastReportedState) {
        this.onStateChange(this.player.state);
        this.lastReportedState = this.player.state;
      }
      if (this.player.isFlashlightOn !== this.lastReportedFlashlight) {
        this.onFlashlightChange(this.player.isFlashlightOn);
        this.lastReportedFlashlight = this.player.isFlashlightOn;
      }
      if (this.player.isNoclipping !== this.lastReportedNoclip) {
        this.lastReportedNoclip = this.player.isNoclipping;
        this.onNoclipChange?.(this.player.isNoclipping);
      }

      const diffSanity = Math.abs(this.sanity - this.lastReportedSanity);
      if (diffSanity > 0.012 || (this.sanity <= 0.01 && this.lastReportedSanity > 0.01) || (this.sanity >= 0.99 && this.lastReportedSanity < 0.99)) {
        if (this.onSanityChange) {
          this.onSanityChange(this.sanity);
        }
        this.lastReportedSanity = this.sanity;
      }

      // Interpolate position/movement animations for Remote Hazmat Explorers
      this.animateRemotePlayers(delta);
      this.updateFootfalls(delta);

      // Proximity VOIP: fade teammates in/out of hearing range, and poll the
      // local mic for the speaking indicator. No-ops entirely while disabled.
      if (this.voip.isEnabled) {
        this.voip.updateVolumes(this.player.position.x, this.player.position.z, this.level, this.remoteStates);
        this.voip.updateSpeakingIndicator(delta);
      }

      // Update global drifting dust particles wrapped relative to client player
      this.updateGlobalDust(delta);

      // Networking Socket Sync tick rate throttling
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.networkSendTimer += delta;
        if (this.networkSendTimer >= this.networkSendInterval && !this.isDead) {
          this.socket.send(JSON.stringify({
            type: "update",
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
            yaw: this.player.rotation.y,
            pitch: this.player.rotation.x,
            flashlight: this.player.isFlashlightOn,
            state: this.player.state,
            level: this.level,
            monsterSkin: this.cheatSkin ?? ""
          }));
          this.networkSendTimer = 0;
        }
      }

      // Perform manual CPU-side Frustum Culling on active map cells to dramatically reduce render & animation load
      if (this.map) {
        this.map.performFrustumCulling(this.camera);
      }

      if (this.vhsRenderTarget && this.vhsMaterial) {
        // Feed time to the VHS shader
        this.vhsMaterial.uniforms.uTime.value = this.totalPlayTime;
        if (!this.kingGrab) this.kingFlash = Math.max(0, this.kingFlash - delta * 3);
        this.deathBlack = Math.max(0, this.deathBlack - delta * 0.7);
        this.vhsMaterial.uniforms.uDread.value = this.level === LEVEL_G ? this.kingDread : 0;
        this.vhsMaterial.uniforms.uFlash.value = this.kingFlash;
        this.vhsMaterial.uniforms.uBlack.value = Math.min(1, this.deathBlack * 1.6);
        this.vhsMaterial.uniforms.tDiffuse.value = this.vhsRenderTarget.texture;

        // Render standard scene to our custom render target
        this.renderer.setRenderTarget(this.vhsRenderTarget);
        this.renderer.render(this.scene, this.camera);

        // Render full screen quad to main display
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.vhsScene, this.vhsCamera);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };

    animate();
  }

  /**
   * Spawns a beautiful, stylized retro Hazmat Explorer (Yellow Anti-contamination Suit) made of THREE primitive blocks.
   * Super light weight, no assets loading slowdown!
   */
  private createHazmatExplorer(name: string, suitColor?: string, face?: string, monsterSkin?: string): THREE.Group {
    const group = new THREE.Group();

    // Lobby SKIN cheat: wear a monster's body instead of the hazmat suit.
    // Everything below this — suit, visor, drawn face — is skipped; only the
    // floating name tag (added at the end) is shared between the two.
    const skinType = monsterSkinType(monsterSkin);

    if (skinType) {
      const body = WanderingEntity.buildSkinMesh(skinType);
      body.position.y = WanderingEntity.skinAnchorY(skinType);
      group.add(body);
    } else {
      // Hazmat suit fabric — colour picked in the customization screen, defaults
      // to the classic Level 0 yellow (flat shading keeps the vintage polygon look)
      const suitMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(suitColor || "#deb81d"), roughness: 0.9, metalness: 0.1 });

      // Visor Glass: Shiny dark glass block
      const visorMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.1 });

      // Black boot soles / rubber belt
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.1 });

      // Rig: hips -> spine -> (head, arms), hips -> legs. Every pivot is named
      // so animateRemotePlayers can pose walk / run / crouch / idle; limbs hang
      // along -Y from their pivot, the visor faces +Z.
      const hips = new THREE.Group();
      hips.name = "hips";
      hips.position.set(0, 0.47, 0);
      group.add(hips);

      const spine = new THREE.Group();
      spine.name = "spine";
      hips.add(spine);

      // Torso (Main bodysuit body)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.9, 8), suitMat);
      body.position.set(0, 0.28, 0);
      spine.add(body);

      // Breathing Apparatus Back Oxygen Tank
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.65, 0.18), suitMat);
      tank.position.set(0, 0.31, -0.18);
      spine.add(tank);

      // Belt
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), darkMat);
      belt.position.set(0, -0.02, 0);
      spine.add(belt);

      // Everything on the head hangs off a pivot at the neck so the whole head
      // (helmet, visor, drawn face) tilts up/down with where the player looks.
      const headPivot = new THREE.Group();
      headPivot.name = "head";
      headPivot.position.set(0, 0.83, 0);
      spine.add(headPivot);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), suitMat);
      headPivot.add(head);

      // Distinctive Level 0 reflective Visor Mask — skipped when the player has
      // drawn a custom face, so the drawing shows through the hood opening
      // instead of sitting behind a dark glass plate.
      if (!hasFace(face)) {
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.12), visorMat);
        // Face the positive Z direction as default orientation
        visor.position.set(0, 0.03, 0.14);
        headPivot.add(visor);
      }

      // Arms: shoulder -> elbow -> glove; the right hand carries the flashlight.
      const upperArmGeo = new THREE.CylinderGeometry(0.07, 0.065, 0.3, 6);
      const forearmGeo = new THREE.CylinderGeometry(0.062, 0.055, 0.27, 6);
      const gloveGeo = new THREE.SphereGeometry(0.065, 6, 6);
      for (const side of [-1, 1]) {
        const prefix = side < 0 ? "l" : "r";
        const shoulder = new THREE.Group();
        shoulder.name = `${prefix}Arm`;
        shoulder.position.set(side * 0.31, 0.64, 0);
        spine.add(shoulder);
        const upper = new THREE.Mesh(upperArmGeo, suitMat);
        upper.position.y = -0.15;
        shoulder.add(upper);
        const elbow = new THREE.Group();
        elbow.name = `${prefix}Forearm`;
        elbow.position.y = -0.3;
        shoulder.add(elbow);
        const fore = new THREE.Mesh(forearmGeo, suitMat);
        fore.position.y = -0.135;
        elbow.add(fore);
        const glove = new THREE.Mesh(gloveGeo, darkMat);
        glove.position.y = -0.29;
        elbow.add(glove);
        if (side > 0) {
          const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), darkMat);
          torch.rotation.x = Math.PI / 2;
          torch.position.set(0, -0.3, 0.08);
          elbow.add(torch);
        }
      }

      // Legs: hip (lLeg/rLeg) -> knee (lShin/rShin) -> boot
      const thighGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.24, 6);
      const shinGeo = new THREE.CylinderGeometry(0.08, 0.075, 0.2, 6);
      const bootGeo = new THREE.BoxGeometry(0.11, 0.07, 0.18);
      for (const side of [-1, 1]) {
        const prefix = side < 0 ? "l" : "r";
        const hip = new THREE.Group();
        hip.name = `${prefix}Leg`;
        hip.position.set(side * 0.11, 0, 0);
        hips.add(hip);
        const thigh = new THREE.Mesh(thighGeo, suitMat);
        thigh.position.y = -0.11;
        hip.add(thigh);
        const knee = new THREE.Group();
        knee.name = `${prefix}Shin`;
        knee.position.y = -0.23;
        hip.add(knee);
        const shin = new THREE.Mesh(shinGeo, suitMat);
        shin.position.y = -0.1;
        knee.add(shin);
        const boot = new THREE.Mesh(bootGeo, darkMat);
        boot.position.set(0, -0.2, 0.03);
        knee.add(boot);
      }

      // Hand-drawn face from the customization screen, as a pixel-art decal just
      // in front of the helmet. Transparent pixels let the visor show through.
      if (hasFace(face)) {
        const faceCanvas = document.createElement("canvas");
        faceCanvas.width = FACE_SIZE;
        faceCanvas.height = FACE_SIZE;
        const faceCtx = faceCanvas.getContext("2d");
        if (faceCtx) {
          drawFace(faceCtx, face);
          const faceTexture = new THREE.CanvasTexture(faceCanvas);
          faceTexture.magFilter = THREE.NearestFilter;
          faceTexture.minFilter = THREE.NearestFilter;
          faceTexture.colorSpace = THREE.SRGBColorSpace;
          const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture, alphaTest: 0.5, roughness: 0.7 });
          const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), faceMat);
          facePlane.position.set(0, 0.01, 0.215);
          headPivot.add(facePlane);
        }
      }
    }

    // Floating UI player tag card setup in 3D Space! (both suit and skin get one)
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.font = "bold 24px Courier New, monospace";
      ctx.fillStyle = "#deb81d";
      ctx.textAlign = "center";
      ctx.fillText(name.toUpperCase(), 128, 40);
    }

    const tagTexture = new THREE.CanvasTexture(canvas);
    const tagMaterial = new THREE.SpriteMaterial({ map: tagTexture, depthTest: false, depthWrite: false });
    const tagSprite = new THREE.Sprite(tagMaterial);
    tagSprite.position.set(0, 1.75, 0);
    tagSprite.scale.set(1.1, 0.3, 1.0);
    group.add(tagSprite);

    return group;
  }

  /**
   * `PlayerController.position.y` is the camera's eye height (1.6 standing /
   * 0.95 crouched), not a floor height — that is what gets broadcast over the
   * network as `x/y/z`. The hazmat model, though, is built feet-down from
   * floor level (boots near y=0, head near y=1.3). Placing the group straight
   * at the received y therefore floats it roughly a body-height above the
   * floor, looking like it is stuck near the ceiling. Subtract the eye height
   * back out so the model's feet land on the floor.
   */
  private remoteFloorY(eyeY: number, state?: string): number {
    const eyeHeight = state === "crouching" ? PLAYER_CROUCH_HEIGHT : PLAYER_STANDING_HEIGHT;
    return eyeY - eyeHeight;
  }

  /** Distance from the local player and stereo pan for a world position. */
  private listenerPan(x: number, z: number): { dist: number; pan: number } {
    this.camera.getWorldDirection(this.scratchCamDir);
    const rx = -this.scratchCamDir.z, rz = this.scratchCamDir.x;
    const rl = Math.hypot(rx, rz) || 1;
    const dx = x - this.player.position.x, dz = z - this.player.position.z;
    const dist = Math.hypot(dx, dz);
    const pan = dist > 0.01 ? ((dx * rx + dz * rz) / (dist * rl)) * Math.min(1, dist / 3) : 0;
    return { dist, pan };
  }

  /** The local player's footstep: splashing in the pool, carpet/concrete anywhere else. */
  private onLocalFootstep(speed: 'walk' | 'run' | 'crouch') {
    const { x, z } = this.player.position;
    if (this.map?.isWaterAt(x, z)) {
      this.audio.playWaterStep(speed);
      this.ripples?.spawn(x, z, speed === 'run' ? 1.3 : speed === 'crouch' ? 0.6 : 1, speed === 'run');
    } else {
      const isWet = this.map ? this.map.isCellWet(x, z) : false;
      this.audio.playFootstep(speed, 0.0, isWet); // panning 0.0 for self
    }
    this.noiseBus.emit(x, z, footstepLoudness(speed), "footstep", this.totalPlayTime);
    this.localStepTimes.push(this.totalPlayTime);
    if (this.localStepTimes.length > 8) this.localStepTimes.shift();
  }

  /** A teammate's footstep (from their avatar's gait): heard nearby, rippling the water. */
  private onRemoteFootstep(x: number, z: number, state: string) {
    if (!this.map || !this.player) return;
    const speed: 'walk' | 'run' | 'crouch' = state === "running" ? "run" : state === "crouching" ? "crouch" : "walk";
    const inWater = this.map.isWaterAt(x, z);
    if (inWater) this.ripples?.spawn(x, z, speed === 'run' ? 1.3 : 0.9, speed === 'run');
    const { dist, pan } = this.listenerPan(x, z);
    const HEARING = 22;
    if (dist > HEARING) return;
    const vol = Math.pow(1 - dist / HEARING, 1.5);
    if (inWater) this.audio.playWaterStep(speed, pan, vol);
    else this.audio.playFootstep(speed, pan, this.map.isCellWet(x, z), vol);
  }

  /**
   * Monster footfalls (one per step of their walk cycle), the pool's water
   * clock and ripples, and how much the local player's surroundings echo.
   * Runs every frame on every client — the gait is animated locally.
   */
  private updateFootfalls(delta: number) {
    waterUniforms.uTime.value += delta;
    this.ripples?.update(delta);
    if (!this.map || !this.player) return;

    this.audio.setEcho(this.map.echoAt(this.player.position.x, this.player.position.z));

    // Every stepping mob ripples the water; only the nearest few are heard,
    // so a whole pack sprinting at you stays a clear, scary rhythm, not mush.
    const HEARING = 26;
    const MAX_AUDIBLE_STEPS = 3;
    const audible: { dist: number; pan: number; weight: number; inWater: boolean }[] = [];
    for (const e of this.entities) {
      if (!e.consumeStep()) continue;
      const weight = e.stepWeight;
      if (weight <= 0) continue;
      const { x, z } = e.mesh.position;
      const inWater = this.map.isWaterAt(x, z);
      if (inWater) this.ripples?.spawn(x, z, 0.8 + weight * 0.6, e.runningGait);
      const { dist, pan } = this.listenerPan(x, z);
      // The Finger King's knees pop on every step.
      if (e.type === EntityType.FINGER_KING && dist < 18) {
        this.audio.playKingJointCrack(Math.pow(1 - dist / 18, 1.5) * 0.85, pan);
      }
      if (dist <= HEARING) audible.push({ dist, pan, weight, inWater });
    }
    audible.sort((a, b) => a.dist - b.dist);
    for (const step of audible.slice(0, MAX_AUDIBLE_STEPS)) {
      this.audio.playMobFootstep(step.weight, Math.pow(1 - step.dist / HEARING, 1.4) * (0.5 + step.weight * 0.5), step.pan, step.inWater);
    }

    // Standing in the pool still stirs the water a little.
    const { x, z } = this.player.position;
    if (this.map.isWaterAt(x, z)) {
      this.wadeTimer -= delta;
      if (this.wadeTimer <= 0) {
        this.wadeTimer = 1.1 + Math.random() * 0.8;
        this.ripples?.spawn(x, z, 0.35);
      }
    }
  }

  /**
   * Positional monster voices: each monster within earshot speaks on its own
   * timer (faster and harsher while hunting), louder and more centred the
   * closer it is. Runs on every client, so replicas are heard too.
   */
  private updateMonsterAudio(delta: number) {
    const cam = this.camera;
    cam.getWorldDirection(this.scratchCamDir);
    const rx = -this.scratchCamDir.z, rz = this.scratchCamDir.x;
    const rl = Math.hypot(rx, rz) || 1;
    const px = this.player.position.x, pz = this.player.position.z;
    const EARSHOT = 22;

    for (const e of this.entities) {
      if (e.type === EntityType.FINGER_KING) continue;
      const dx = e.mesh.position.x - px, dz = e.mesh.position.z - pz;
      const dist = Math.hypot(dx, dz);
      const alertNow = e.alert;
      const edge = e.consumeAlertEdge();
      if (dist > EARSHOT) continue;

      e.voiceTimer -= delta;
      if (!edge && e.voiceTimer > 0) continue;

      const near = 1 - dist / EARSHOT;
      const vol = Math.pow(near, 1.5);
      const pan = dist > 0.01 ? ((dx * rx + dz * rz) / (dist * rl)) * Math.min(1, dist / 3) : 0;
       if (e.type === EntityType.ECO && alertNow) {
         // Eco's chase cue is deliberately not a voice: the source is offset
         // in the stereo field so it sounds like footsteps behind the player.
         this.audio.playFalseFootsteps(pan, this.map?.isCellWet(e.mesh.position.x, e.mesh.position.z) ?? false);
       } else {
         this.audio.playMonsterSound(e.type, alertNow, vol, pan);
       }
      e.voiceTimer = alertNow ? 1.6 + Math.random() * 2.2 : 4 + Math.random() * 6;
    }
  }

  // ---------------------------------------------------------------------------
  // Death and spectating
  // ---------------------------------------------------------------------------

  /** Dead explorers spectate a living teammate (first-person) until the room revives everyone. */
  public isDead = false;
  public isWaitingForTransition = false;
  private noclipDwell = 0;

  // ---------------------------------------------------------------------------
  // Room lobby (soccer field)
  // ---------------------------------------------------------------------------

  private lobby: Lobby | null = null;
  private lobbySendTimer = 0;
  /** Rings and splashes on the Poolrooms' water (see Water.ts); created with the scene. */
  private ripples: WaterRipples | null = null;
  /** Seconds until the next faint ripple around the local player's legs while standing in water. */
  private wadeTimer = 0;
  /** Abandoned Office: the animated MEG employees (see npc/OfficeWorker.ts). */
  private officeWorkers: OfficeWorker[] = [];
  /** Name of the MEG employee whose dialogue is open, so they gesture while talking. */
  private talkingEmployee: string | null = null;

  /** (Re)spawns the MEG employees on the Abandoned Office; clears them anywhere else. */
  private setupOfficeWorkers() {
    this.officeWorkers.forEach((w) => w.dispose(this.scene));
    this.officeWorkers = [];
    this.talkingEmployee = null;
    if (this.level !== ABANDONED_OFFICE_LEVEL || !this.map) return;
    const cs = this.map.cellSize;
    this.map.level4Employees.forEach((employee, i) => {
      const x = employee.gx * cs + cs / 2;
      const z = employee.gz * cs + cs / 2 + 0.7;
      const worker = new OfficeWorker({
        name: employee.name,
        grade: employee.grade,
        x,
        z,
        floorY: this.map.getFloorHeightAt(x, z),
        seed: (employee.gx * 73856093) ^ (employee.gz * 19349663) ^ (i * 83492791),
        seated: employee.seated,
      });
      this.scene.add(worker.group);
      this.officeWorkers.push(worker);
    });
  }

  private updateOfficeWorkers(delta: number) {
    if (this.officeWorkers.length === 0 || !this.player) return;
    const { x, z } = this.player.position;
    for (const worker of this.officeWorkers) worker.update(delta, x, z, worker.name === this.talkingEmployee);
  }

  /** (Re)builds the lobby props when the current level is the lobby; tears them down otherwise. */
  private setupLobby() {
    if (this.lobby) { this.lobby.dispose(this.scene); this.lobby = null; }
    if (this.selfAvatar) { this.disposeExplorerGroup(this.selfAvatar); this.selfAvatar = null; this.selfAvatarKey = ""; }
    if (this.level === LOBBY_LEVEL) {
      this.lobby = new Lobby(this.scene);
      this.setupMirror();
    }
  }

  /**
   * The lobby mirror (Lobby.buildMirror). Its reflection pass is the only
   * render that shows our own avatar, and — since the main pass frustum-culls
   * cells behind us — it briefly re-shows every lobby cell so what's behind
   * you is actually in the glass.
   */
  private setupMirror() {
    const mirror = this.lobby?.mirror;
    if (!mirror || !this.map) return;
    const { x, z, width } = LOBBY.mirror;
    const cs = this.map.cellSize;
    for (const dz of [-width / 2, 0, width / 2]) this.map.addObstacle(Math.floor(x / cs), Math.floor((z + dz) / cs), x, z + dz, 0.35);
    const reflect = mirror.onBeforeRender;
    mirror.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      const culled: THREE.Object3D[] = [];
      this.map?.cellGroups.forEach((g) => { if (!g.visible) { g.visible = true; culled.push(g); } });
      if (this.selfAvatar) this.selfAvatar.visible = !this.isDead;
      reflect.call(mirror, renderer, scene, camera, geometry, material, group);
      if (this.selfAvatar) this.selfAvatar.visible = false;
      for (const g of culled) g.visible = false;
    };
  }

  /** Keeps the mirror's copy of us on our feet, facing our way, walking our walk. */
  private updateMirrorSelf(delta: number) {
    if (!this.lobby?.mirror || !this.player) return;
    const look = this.selfLook;
    const key = `${look.name}|${look.suitColor}|${look.face}|${this.cheatSkin ?? ""}`;
    if (!this.selfAvatar || this.selfAvatarKey !== key) {
      if (this.selfAvatar) this.disposeExplorerGroup(this.selfAvatar);
      const avatar = this.createHazmatExplorer(look.name, look.suitColor, look.face, this.cheatSkin ?? undefined);
      avatar.userData.silentFeet = true;
      avatar.visible = false;
      this.scene.add(avatar);
      this.selfAvatar = avatar;
      this.selfAvatarKey = key;
    }
    const avatar = this.selfAvatar;
    const p = this.player.position;
    avatar.position.set(p.x, this.remoteFloorY(p.y, this.player.state), p.z);
    avatar.rotation.y = this.player.rotation.y + Math.PI;
    (avatar as unknown as { animState: string }).animState = this.player.state;
    this.poseRemotePlayer(avatar, this.player.rotation.x, delta, this.player.isFlashlightOn);
  }

  private updateLobby(delta: number) {
    if (!this.lobby || !this.player) return;
    this.updateMirrorSelf(delta);
    const authority = this.isWorldAuthority;
    this.lobby.update(delta, {
      authority,
      px: this.player.position.x, pz: this.player.position.z,
      pvx: this.player.velX, pvz: this.player.velZ,
      onKick: (vx, vz) => {
        if (!authority) this.sendToServer({ type: "ball_kick", level: this.level, vx, vz });
      },
      onGoal: () => {
        this.onHUDNotification?.(t("lobby.goal"));
        this.audio.playGlitchNoclipSound();
      },
    });

    // The ball's authority streams it to everyone else in the lobby.
    if (authority && this.remoteStates.size > 0) {
      this.lobbySendTimer += delta;
      if (this.lobbySendTimer >= 1 / 15) {
        this.lobbySendTimer = 0;
        this.sendToServer({ type: "ball", level: this.level, ...this.lobby.getState() });
      }
    }
  }

  /** Ball frame from the lobby's authority. */
  public applyBallState(msg: BallNetState & { level: number }) {
    if (!this.lobby || msg.level !== this.level || this.isWorldAuthority) return;
    if (this.lobby.applyState(msg) > 0) {
      this.onHUDNotification?.(t("lobby.goal"));
      this.audio.playGlitchNoclipSound();
    }
  }

  /** A teammate kicked the ball (forwarded to the authority, which owns the simulation). */
  public applyBallKick(msg: { level: number; vx: number; vz: number }) {
    if (!this.lobby || msg.level !== this.level || !this.isWorldAuthority) return;
    this.lobby.applyKick(msg.vx, msg.vz);
  }

  // ---------------------------------------------------------------------------
  // Proximity voice chat (see Voip.ts) — App.tsx drives this off the room
  // roster (player_joined/player_left) and relayed "voip_signal" messages.
  // ---------------------------------------------------------------------------

  public get voipEnabled(): boolean { return this.voip.isEnabled; }
  public get voipMuted(): boolean { return this.voip.isMuted; }

  /** Requests the mic and starts calling every known teammate. Resolves once it's actually on (or listen-only, if the mic was denied). */
  public enableVoip(): Promise<boolean> {
    return this.voip.enable().then((ok) => {
      if (ok) this.remoteStates.forEach((_r, id) => this.voip.ensurePeer(id, this.localPlayerId ?? ""));
      return ok;
    });
  }

  public disableVoip() {
    this.voip.disable();
  }

  public setVoipMuted(muted: boolean) {
    this.voip.setMuted(muted);
  }

  /** A teammate joined the room: open a call to them if VOIP is on. */
  public voipConnectPeer(id: string) {
    this.voip.ensurePeer(id, this.localPlayerId ?? "");
  }

  /** A teammate left the room: hang up on them. */
  public voipDisconnectPeer(id: string) {
    this.voip.closePeer(id);
  }

  /** An SDP offer/answer or ICE candidate relayed from a teammate. */
  public handleVoipSignal(fromId: string, data: unknown) {
    this.voip.handleSignal(fromId, this.localPlayerId ?? "", data);
  }

  private spectateId: string | null = null;
  private remoteDead = new Set<string>();

  private die(cause: "sanity" | "caught", silent = false) {
    if (this.isDead || this.cheatLife) return;
    if (this.kingGrab) this.endKingGrab(false);
    this.isDead = true;
    this.player.setSpectating(true);
    this.player.isFlashlightOn = false;
    this.player.state = "idle";
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    if (!silent) this.audio.playEntityCatchSound();
    this.spectateId = null;
    this.cycleSpectate(1);
    this.refreshRemoteVisibility();
    this.onPlayerDeath?.(cause);
  }

  /** Brings this explorer back (level change or room reset): fresh mind, fresh legs. */
  private revive() {
    // Teammates revive with us: forget stale "dead" flags until snapshots refresh them.
    this.remoteDead.clear();
    this.remoteStates.forEach((st) => { st.dead = false; });
    const wasDead = this.isDead;
    this.isDead = false;
    this.isWaitingForTransition = false;
    this.player.setSpectating(false);
    this.spectateId = null;
    if (wasDead) {
      this.sanity = Math.max(this.sanity, 0.5); // died of sanity: half a mind back; caught: unchanged
      this.lastReportedSanity = -1; // force the HUD to pick up the new value
    }
    this.refreshRemoteVisibility();
    this.onPlayerRevive?.();
  }

  /** Marks a teammate dead/alive (server broadcast); dead ones vanish from the scene. */
  public setRemoteDead(id: string, dead: boolean) {
    if (dead) this.remoteDead.add(id); else this.remoteDead.delete(id);
    const st = this.remoteStates.get(id);
    if (st) st.dead = dead;
    if (dead && this.spectateId === id) this.cycleSpectate(1);
    this.refreshRemoteVisibility();
  }

  /** Living teammates on our level, in a stable order. */
  private spectatable(): string[] {
    const ids: string[] = [];
    this.remotePlayerGroups.forEach((_g, id) => {
      if (!this.remoteDead.has(id) && !this.remoteStates.get(id)?.dead) ids.push(id);
    });
    return ids.sort();
  }

  /** Switches to the next (dir 1) / previous (dir -1) living teammate; null spectateId if none. */
  public cycleSpectate(dir: 1 | -1) {
    const ids = this.spectatable();
    if (ids.length === 0) {
      this.spectateId = null;
    } else {
      const cur = this.spectateId ? ids.indexOf(this.spectateId) : -1;
      this.spectateId = ids[cur === -1 ? 0 : (cur + dir + ids.length) % ids.length];
    }
    this.refreshRemoteVisibility();
    this.onSpectateChange?.(this.spectateName());
  }

  public onSpectateChange?: (name: string | null) => void;

  public spectateName(): string | null {
    if (!this.spectateId) return null;
    return this.remoteStates.get(this.spectateId)?.name ?? null;
  }

  public setWaitingForTransition(waiting: boolean) {
    this.isWaitingForTransition = waiting;
    this.player.setSpectating(waiting);
    if (waiting && !this.spectateId) this.cycleSpectate(1);
    this.refreshRemoteVisibility();
  }

  /** Hides dead teammates entirely, and the spectated one's body (we're inside its head; its flashlight stays). */
  private refreshRemoteVisibility() {
    this.remotePlayerGroups.forEach((group, id) => {
      const dead = this.remoteDead.has(id) || !!this.remoteStates.get(id)?.dead;
      group.visible = !dead;
      const bodyVisible = !(this.isDead && id === this.spectateId);
      group.children.forEach((c) => {
        if (c instanceof THREE.Light || c.type === "Object3D") return;
        c.visible = bodyVisible;
      });
    });
  }

  private updateSpectator(delta: number) {
    if (this.spectateId && !this.remotePlayerGroups.has(this.spectateId)) this.cycleSpectate(1);
    const st = this.spectateId ? this.remoteStates.get(this.spectateId) : null;
    const rig = this.camera.parent;
    if (!st || !rig) return;
    // The spectator receives only the observed explorer's pose, with no local
    // head bob, breathing sway, camera shake, or flashlight beam carried over.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.flashlight.visible = false;
    this.flashlight.intensity = 0;
    const k = Math.min(1, 12 * delta);
    this.player.position.x += (st.x - this.player.position.x) * k;
    this.player.position.y += (st.y - this.player.position.y) * k;
    this.player.position.z += (st.z - this.player.position.z) * k;
    let dy = st.yaw - this.player.rotation.y;
    while (dy < -Math.PI) dy += Math.PI * 2;
    while (dy > Math.PI) dy -= Math.PI * 2;
    this.player.rotation.y += dy * k;
    this.player.rotation.x += (st.pitch - this.player.rotation.x) * k;
    rig.position.copy(this.player.position);
    rig.rotation.copy(this.player.rotation);
  }

  /**
   * Spawns a remote explorer visual node and sets up their shoulder spotlight.
   */
  public spawnRemotePlayer(id: string, name: string, x: number, y: number, z: number, suitColor?: string, face?: string, monsterSkin?: string) {
    if (this.remotePlayerGroups.has(id)) return;

    // Create Hazmat Group Mesh
    const group = this.createHazmatExplorer(name, suitColor, face, monsterSkin);
    group.position.set(x, this.remoteFloorY(y), z);
    // Remembered so updateRemotePlayer can tell a SKIN cheat toggled mid-session
    // and rebuild the visual instead of silently ignoring the change.
    group.userData.monsterSkin = monsterSkinType(monsterSkin) ?? "";
    this.scene.add(group);
    this.remotePlayerGroups.set(id, group);

    // Create Shoulder dynamic Spotlight representing their flashlight (visible to us!)
    const rSpot = new THREE.SpotLight(0xfffaec, 2.2, 13, Math.PI / 4.8, 0.5, 1.0);
    rSpot.position.set(0.12, 1.25, 0.1); // slightly side-mounted from center visor
    
    const rTarget = new THREE.Object3D();
    rTarget.position.set(0, 1.25, 5); // pointing outward
    
    group.add(rTarget);
    rSpot.target = rTarget;
    group.add(rSpot);

    this.remotePlayerLights.set(id, rSpot);
    this.remotePlayerLightTargets.set(id, rTarget);

    console.log(`Spawned remote explorer player visual: "${name}" (${id})`);
  }

  /**
   * Despawns and deletes a player group visual node.
   */
  /** Removes an explorer avatar (see createHazmatExplorer) from the scene and frees what it owns. */
  private disposeExplorerGroup(group: THREE.Group) {
    this.scene.remove(group);

      // A SKIN-cheat body (see createHazmatExplorer) shares WanderingEntity's
      // class-wide geometry/material caches with every live AI monster of
      // that type — the traversal below must never reach it. Detach it first
      // and dispose only the couple of genuinely per-instance tint materials
      // it made for itself.
      const skinBody = group.getObjectByName("monsterSkinBody");
      if (skinBody) {
        (skinBody.userData.tintMaterials as THREE.Material[] | undefined)?.forEach((m) => m.dispose());
        group.remove(skinBody);
      }

      // Memory cleanup. Sprites are handled too: the floating name tag owns a
      // CanvasTexture that used to survive every disconnect.
      group.traverse((child) => {
        const withMaterial = child as THREE.Mesh | THREE.Sprite;
        if (child instanceof THREE.Mesh && child.geometry) {
          child.geometry.dispose();
        }
        const material = (withMaterial as { material?: THREE.Material | THREE.Material[] }).material;
        if (!material) return;

        const list = Array.isArray(material) ? material : [material];
        list.forEach((m) => {
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) map.dispose();
          m.dispose();
        });
      });
  }

  public removeRemotePlayer(id: string) {
    const group = this.remotePlayerGroups.get(id);
    if (group) {
      this.disposeExplorerGroup(group);

      this.remotePlayerGroups.delete(id);
      this.remoteStates.delete(id);
      this.remotePlayerLights.delete(id);
      this.remotePlayerLightTargets.delete(id);
      console.log(`Despawned remote player visual (${id})`);
    }
  }

  /**
   * Sync-tracks position reporting from the WebSocket server.
   */
  public updateRemotePlayer(id: string, update: RemotePlayer) {
    const playerLevel = update.level !== undefined ? update.level : 0;
    
    // If the remote player is on a different level, despawn them from this local player's scene if they exist
    if (playerLevel !== this.level) {
      if (this.remotePlayerGroups.has(id)) {
        this.removeRemotePlayer(id);
      }
      return;
    }

    this.remoteStates.set(id, update);

    const group = this.remotePlayerGroups.get(id);
    if (!group) {
      this.spawnRemotePlayer(id, update.name, update.x, update.y, update.z, update.suitColor, update.face, update.monsterSkin);
      this.refreshRemoteVisibility();
      return;
    }

    // The SKIN cheat can be typed mid-session — rebuild the visual (suit vs.
    // whichever monster body) when it no longer matches what's on screen.
    if ((monsterSkinType(update.monsterSkin) ?? "") !== group.userData.monsterSkin) {
      this.removeRemotePlayer(id); // clears remoteStates too — restore it below
      this.remoteStates.set(id, update);
      this.spawnRemotePlayer(id, update.name, update.x, update.y, update.z, update.suitColor, update.face, update.monsterSkin);
      this.refreshRemoteVisibility();
      return;
    }

    // Assign custom attributes into group container for asynchronous lerp integration in game loop
    const anyGroup = group as any;
    anyGroup.targetX = update.x;
    anyGroup.targetY = this.remoteFloorY(update.y, update.state);
    anyGroup.targetZ = update.z;
    // `yaw` is the camera's, which looks down -Z, but the hazmat model is
    // built facing +Z (visor front, tank back) — turn it half a revolution so
    // the visor faces where the player is looking/walking.
    anyGroup.targetYaw = update.yaw + Math.PI;
    anyGroup.targetPitch = update.pitch;
    
    // Toggle flashlight immediately
    const rSpot = this.remotePlayerLights.get(id);
    if (rSpot) {
      rSpot.visible = update.flashlight;
    }

    // Record remote state for animations
    anyGroup.animState = update.state;
  }

  /**
   * Smoothly interpolates (lerps) remote position updates and translates orientation angles.
   */
  private animateRemotePlayers(delta: number) {
    this.remotePlayerGroups.forEach((group, id) => {
      const anyG = group as any;
      if (anyG.targetX !== undefined) {
        // Smoothly slide positions (Lerping: 15% rate per tick)
        group.position.x += (anyG.targetX - group.position.x) * 15 * delta;
        group.position.y += (anyG.targetY - group.position.y) * 15 * delta;
        group.position.z += (anyG.targetZ - group.position.z) * 15 * delta;

        // Yaw angle (Rotate body horizontal mesh)
        // Guard against rot angle jump discontinuities (wrap around PI check)
        let diffYaw = anyG.targetYaw - group.rotation.y;
        while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        group.rotation.y += diffYaw * 15 * delta;

        // Pitch look direction (Rotate shoulder target looking up/down)
        const target = this.remotePlayerLightTargets.get(id);
        const pitch = anyG.targetPitch !== undefined ? anyG.targetPitch : 0;
        if (target) {
          // Adjust depth target position relatively based on look pitch angle!
          target.position.y = 1.25 + Math.sin(pitch) * 4;
          target.position.z = Math.cos(pitch) * 4;
        }

        this.poseRemotePlayer(group, pitch, delta, this.remotePlayerLights.get(id)?.visible ?? false);
      }
    });
  }

  /**
   * Walk / run / crouch / idle for a remote explorer's rig (see
   * createHazmatExplorer), driven by how fast the avatar is actually moving
   * on screen so the feet keep pace with the interpolated position. Skin-cheat
   * bodies get their monster's own rig animation instead.
   */
  private poseRemotePlayer(group: THREE.Group, pitch: number, delta: number, flashOn: boolean) {
    const anim = (group.userData.anim ??= {
      lastX: group.position.x, lastZ: group.position.z,
      speed: 0, phase: 0, time: Math.random() * 10, move: 0, run: 0, crouch: 0,
    }) as { lastX: number; lastZ: number; speed: number; phase: number; time: number; move: number; run: number; crouch: number; stepDist?: number };
    const dt = Math.max(delta, 1e-4);
    const vx = (group.position.x - anim.lastX) / dt;
    const vz = (group.position.z - anim.lastZ) / dt;
    anim.lastX = group.position.x;
    anim.lastZ = group.position.z;
    const damp = THREE.MathUtils.damp;
    const rawSpeed = Math.min(Math.hypot(vx, vz), 12);
    anim.speed = damp(anim.speed, rawSpeed, 10, delta);
    anim.time += delta;

    const state = (group as any).animState || "idle";
    const running = state === "running";

    // Footfalls: one every half stride of distance actually covered.
    anim.stepDist = (anim.stepDist ?? 0) + anim.speed * delta;
    const halfStride = running ? 1.1 : state === "crouching" ? 0.45 : 0.7;
    if (anim.speed > 0.35 && anim.stepDist >= halfStride) {
      anim.stepDist = 0;
      if (!group.userData.silentFeet) this.onRemoteFootstep(group.position.x, group.position.z, state);
    }

    const skinBody = group.getObjectByName("monsterSkinBody") as THREE.Group | undefined;
    if (skinBody) {
      WanderingEntity.animateSkinBody(skinBody, delta, anim.speed, running);
      return;
    }

    // Walking backwards: the gait runs in reverse instead of moonwalking.
    const fx = Math.sin(group.rotation.y), fz = Math.cos(group.rotation.y);
    const backwards = vx * fx + vz * fz < -0.1 * rawSpeed;
    anim.move = damp(anim.move, anim.speed > 0.35 ? 1 : 0, 8, delta);
    anim.run = damp(anim.run, running ? 1 : 0, 6, delta);
    anim.crouch = damp(anim.crouch, state === "crouching" ? 1 : 0, 8, delta);
    const strideLength = running ? 2.2 : anim.crouch > 0.5 ? 0.9 : 1.4;
    anim.phase += (backwards ? -1 : 1) * (anim.speed / strideLength) * Math.PI * 2 * delta;

    const { move, run, crouch, phase, time } = anim;
    const sin = Math.sin(phase), cos = Math.cos(phase);
    const gait = move * (1 + run * 0.6) * (1 - crouch * 0.4);
    const breath = Math.sin(time * 1.8) * 0.025 * (1 - move);

    // Looked up once per avatar (it's rebuilt, and this cache with it, on a skin change).
    const parts = (group.userData.rigParts ??= Object.fromEntries(
      ["hips", "spine", "head", "lLeg", "rLeg", "lShin", "rShin", "lArm", "rArm", "lForearm", "rForearm"]
        .map((n) => [n, group.getObjectByName(n)]),
    )) as Record<string, THREE.Object3D | undefined>;
    const { hips, spine, head, lLeg, rLeg, lShin, rShin, lArm, rArm } = parts;
    const lFore = parts.lForearm, rFore = parts.rForearm;

    // Legs: stride + knee lift; crouching folds hips forward and knees back.
    const stride = 0.55 * gait;
    const knee = 0.9 * gait;
    if (lLeg) lLeg.rotation.x = -sin * stride - crouch * 1.0;
    if (rLeg) rLeg.rotation.x = sin * stride - crouch * 1.0;
    if (lShin) lShin.rotation.x = Math.max(0, cos) * knee + crouch * 1.7;
    if (rShin) rShin.rotation.x = Math.max(0, -cos) * knee + crouch * 1.7;

    // Hips: two bounces per stride, lowered in a crouch.
    if (hips) hips.position.y = 0.47 - crouch * 0.2 + (Math.abs(sin) - 0.5) * 0.05 * gait;

    // Torso: running lean, crouch hunch, shoulder counter-twist, breathing.
    if (spine) spine.rotation.set(0.28 * run * move + crouch * 0.45 + breath, sin * 0.1 * gait, Math.sin(time * 0.7) * 0.02 * (1 - move));

    // Arms: counter-swing. The flashlight hand (right) is held forward and
    // steadier whenever the flashlight is on.
    const swing = 0.5 * gait;
    if (lArm) lArm.rotation.set(sin * swing - crouch * 0.4 + breath * 2, 0, -0.08);
    if (rArm) rArm.rotation.set(-sin * swing * (flashOn ? 0.3 : 1) - (flashOn ? 0.9 : 0) - crouch * 0.3 + breath * 2, 0, 0.08);
    if (lFore) lFore.rotation.x = -(0.2 + run * move * 1.0 + crouch * 0.4);
    if (rFore) rFore.rotation.x = -(0.2 + run * move * 1.0 + (flashOn ? 0.5 : 0));

    // Head: follows the look pitch (the model faces +Z, so looking up tilts
    // back: -x). No yaw targeting of nearby players — the body itself already
    // faces the real look direction (own yaw for remote players, the actual
    // camera yaw for the mirror's copy of us, see updateMirrorSelf), so any
    // extra head-yaw logic here would just be an independent, unrelated
    // rotation layered on top of it.
    if (head) {
      const targetTilt = -THREE.MathUtils.clamp(pitch, -1.2, 1.2);
      head.rotation.x += (targetTilt - head.rotation.x) * Math.min(1, 15 * delta);
      head.rotation.y += (0 - head.rotation.y) * Math.min(1, 15 * delta);
    }
  }

  private initGlobalDust() {
    const particleCount = this.quality.dustParticles;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    
    // Store original offset velocities/speeds for each particle to drift independently
    const driftData = [];

    // Distribute randomly in a box around the origin initially
    const boxSize = 14; // 14 meters width/depth
    const boxHeight = 3.5; // spanning ceiling to floor

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * boxSize;
      positions[i * 3 + 1] = Math.random() * boxHeight;
      positions[i * 3 + 2] = (Math.random() - 0.5) * boxSize;

      driftData.push({
        vx: (Math.random() - 0.5) * 0.03, // slow drift velocities
        vy: (Math.random() - 0.5) * 0.02,
        vz: (Math.random() - 0.5) * 0.03,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.5 + Math.random() * 1.5,
        baseSize: 0.02 + Math.random() * 0.035
      });
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // Custom Canvas Texture for beautiful soft round bokeh particles
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      grad.addColorStop(0.3, "rgba(235, 215, 160, 0.4)");
      grad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
    }
    const tex = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0xddd7b5, // Pale dusty gold
      size: 0.06,
      map: tex,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.globalDust = new THREE.Points(geometry, material);
    this.scene.add(this.globalDust);
    (this.globalDust as any).driftData = driftData;
  }

  private updateGlobalDust(delta: number) {
    if (!this.globalDust) return;

    const geom = this.globalDust.geometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    // Write straight into the backing Float32Array. getX/setXYZ go through
    // bounds-checked accessors, which is measurable at a few hundred particles
    // updated every single frame.
    const positions = posAttr.array as Float32Array;
    const driftData = (this.globalDust as any).driftData;
    
    const pPos = this.player.position;
    const boxSize = 14;
    const halfBox = boxSize / 2;
    const minHeight = 0;
    const maxHeight = 3.0;
    const time = this.totalPlayTime;

    // Determine if we should activate subtle guidance drift
    let guideX = 0;
    let guideZ = 0;
    let guideSpeedRatio = 0;

    // Trigger subtle guiding wind if they have been lost in level for 35+ seconds
    if (this.totalPlayTime > 35 && this.map && this.map.exitPath && this.map.exitPath.length > 0) {
      // Linearly scale up guidance strength over 25 seconds (maxes out at ratio = 1.0)
      guideSpeedRatio = Math.min(1.0, (this.totalPlayTime - 35) / 25);

      const pgX = Math.floor(pPos.x / this.map.cellSize);
      const pgZ = Math.floor(pPos.z / this.map.cellSize);
      const inGrid = pgX >= 0 && pgX < this.map.gridSize && pgZ >= 0 && pgZ < this.map.gridSize;
      const pathIdx = inGrid ? this.map.exitPathIndexGrid[pgX * this.map.gridSize + pgZ] : -1;

      let targetX = this.map.exitGridX * this.map.cellSize + this.map.cellSize / 2;
      let targetZ = this.map.exitGridZ * this.map.cellSize + this.map.cellSize / 2;

      if (pathIdx !== -1 && pathIdx < this.map.exitPath.length - 1) {
        // Guide 2 cells ahead on the exit route to smooth the corners
        const nextIdx = Math.min(pathIdx + 2, this.map.exitPath.length - 1);
        const [nx, nz] = this.map.exitPath[nextIdx];
        targetX = nx * this.map.cellSize + this.map.cellSize / 2;
        targetZ = nz * this.map.cellSize + this.map.cellSize / 2;
      }

      guideX = targetX - pPos.x;
      guideZ = targetZ - pPos.z;
      const len = Math.sqrt(guideX * guideX + guideZ * guideZ);
      if (len > 0.01) {
        guideX /= len;
        guideZ /= len;
      }
    }

    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const data = driftData[i];
      const base = i * 3;
      let x = positions[base];
      let y = positions[base + 1];
      let z = positions[base + 2];

      let targetVx = data.vx;
      let targetVz = data.vz;

      // Gently blend current ambient velocities with the subtle draft vector pointing to exit path
      if (guideSpeedRatio > 0) {
        const guideV = 0.28; // Subtle draft speed (m/s)
        targetVx = (1.0 - guideSpeedRatio) * data.vx + guideSpeedRatio * guideX * guideV;
        targetVz = (1.0 - guideSpeedRatio) * data.vz + guideSpeedRatio * guideZ * guideV;
      }

      // Micro drift along calculated velocities + sine bobbing
      x += targetVx * delta + Math.sin(time * data.phaseSpeed + data.phase) * 0.002 * delta;
      y += data.vy * delta + Math.cos(time * data.phaseSpeed + data.phase) * 0.001 * delta;
      z += targetVz * delta + Math.sin(time * data.phaseSpeed + data.phase * 0.7) * 0.002 * delta;

      // Wrap-around X axis relative to player
      if (x < pPos.x - halfBox) x += boxSize;
      if (x > pPos.x + halfBox) x -= boxSize;

      // Wrap-around Z axis relative to player
      if (z < pPos.z - halfBox) z += boxSize;
      if (z > pPos.z + halfBox) z -= boxSize;

      // Wrap-around Y axis (room height clamp and wrap)
      if (y < minHeight) y = maxHeight - 0.05;
      if (y > maxHeight) y = minHeight + 0.05;

      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;
    }

    posAttr.needsUpdate = true;

    // Gently adjust dust colors/illumination if the guide helper is active to suggest an atmospheric drift
    if (guideSpeedRatio > 0.05) {
      const mat = this.globalDust.material as THREE.PointsMaterial;
      if (mat) {
        // Shift tint closer to warm cozy amber (golden/orange)
        mat.color.setHSL(0.11 - 0.03 * guideSpeedRatio, 0.65, 0.45 + 0.06 * guideSpeedRatio);
        // Heighten visibility by making them slightly brighter as they align toward the escape rift
        mat.opacity = 0.35 + 0.15 * guideSpeedRatio;
      }
    }
  }

  public transitionToLevel(level: number, seed: number, settings: GameSettings) {
    console.log(`Transitioning to Level ${level} in backrooms...`);
    this.teardownFun();
    this.teardownSpace();
    this.teardownLevelG();
    this.level = level;
    this.level4DoorOpen = false;
    this.funCakeEaten = false;

    // 1. Terminate current map mesh references
    if (this.map) {
      this.map.disposeGateway(this.scene);
      this.map.clearAll(this.scene);
    }
    
    // 2. Remove player physical key registrations
    if (this.player) {
      this.player.removeEvents();
    }
    
    // 3. Re-set overhead lighting
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
    }
    
    const atmosphere = levelAtmosphere(level, 0);
    this.ambientLight = new THREE.AmbientLight(atmosphere.ambientColor, atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Adjust psychological fog
    if (this.scene.fog) {
      this.scene.background = new THREE.Color(atmosphere.fogColor);
      this.scene.fog = new THREE.FogExp2(atmosphere.fogColor, this.fogDensityFor(level));
    }

    // 4. Instantiate new level's ProceduralMap
    this.map = new ProceduralMap(seed, level, this.quality);
    this.map.noiseBus = this.noiseBus;
    this.map.visitTracker = this.visitTracker;
    this.lightPool.invalidate();
    
    // Pre-create/load the entire proximity map meshes before placing/spawning the player
    const spawnX = this.map.spawnGridX * this.map.cellSize + this.map.cellSize / 2;
    const spawnZ = this.map.spawnGridZ * this.map.cellSize + this.map.cellSize / 2;
    this.map.performProximityCulling(this.scene, spawnX, spawnZ, true);

    // 5. Enable ambience outside the lobby and select the new level's sound profile.
    this.audio.level = level;
    this.audio.setBackgroundAmbienceEnabled(level !== LOBBY_LEVEL);
    
    // 6. Spawn the player again safely at spawn coordinates (2,2) with preloaded map
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, (speed) => this.onLocalFootstep(speed));
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();
    this.applyCheatsToPlayer();
    this.player.mapFullyLoaded = false; // start with map loading animation!
    this.revive();
    this.setupLobby();
    this.setupOfficeWorkers();
    this.setupFun();
    this.setupSpace();

    // Reset total play time for the new layout
    this.totalPlayTime = 0;
    this.noiseBus.clear();
    this.visitTracker.clear();
    
    // Clear any active smilers on transition
    this.clearAllSmilers();

    // Return previous Wandering stalkers back to static pool instead of destroying
    this.entities.forEach(entity => entity.returnToPool(this.scene));
    this.entities = [];
    this.nextEntityNetId = 0;
    this.nextSmilerNetId = 0;

    // Spawn new Wandering Stalker Entities on Level 1 (sectors 1 & 2 only)
    if (level === 1) {
      this.spawnLevel1Entities();
    }

    // Level G: fresh office, one Finger King
    this.resetLevelG();
    if (level === LEVEL_G) {
      this.spawnLevelGEntities();
      this.onHUDNotification?.(t("eng.levelG"));
    }

    // Level 6: fresh day/night cycle, no leftover night hunter.
    this.level6Time = 0;
    this.level6IsNight = false;
    this.ceifadorEntity = null; // already pooled by the blanket entities.forEach(returnToPool) above

    // Poolrooms: fresh local view; the authoritative state arrives in a snapshot.
    // The new map's own toxicWaterCells already
    // starts populated from its own carve — see ProceduralMap.carveLevel7).
    this.valvesTurned.clear();
    this.poolValveRevision = -1;

    // Spawn multiple chasing entities on Level 2 (Pipe Dreams), placed at
    // the same S-shaped key joints/corridor points the level's always used.
    if (level === 2) {
      const def2 = LEVEL_DEFS[2];
      if (def2.spawn.kind === "static") {
        this.spawnStaticRoster(def2.spawn.roster, 8);
      }
    }

    if (level === ELECTRICAL_ROOM_LEVEL) {
      const def3 = LEVEL_DEFS[ELECTRICAL_ROOM_LEVEL];
      if (def3.spawn.kind === "static") this.spawnStaticRoster(def3.spawn.roster, 8);
    }

    // Level 7 (Dark Poolrooms): CLUMP + O Vigia.
    if (level === POOLROOMS_LEVEL) {
      const def7 = LEVEL_DEFS[POOLROOMS_LEVEL];
      if (def7.spawn.kind === "static") {
        this.spawnStaticRoster(def7.spawn.roster, 8);
      }
    }

    // Initial map cull
    this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z);
  }

  private smilerTexture: THREE.Texture | null = null;

  private getSmilerTexture(): THREE.Texture {
    if (!this.smilerTexture) {
      this.smilerTexture = this.createSmilerTexture();
    }
    return this.smilerTexture;
  }

  private createSmilerTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 256);

    // Glow effect
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#deb81d"; // eerie matching glow for backrooms

    // Glow Eyes
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(88, 100, 14, 0, Math.PI * 2);
    ctx.arc(168, 100, 14, 0, Math.PI * 2);
    ctx.fill();

    // Dark Pupils looking right at you
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(88, 100, 4, 0, Math.PI * 2);
    ctx.arc(168, 100, 4, 0, Math.PI * 2);
    ctx.fill();

    // Creepy wide smiling mouth
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#deb81d";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(128, 115, 60, 0.1 * Math.PI, 0.9 * Math.PI, false);
    ctx.stroke();

    // Corner lines curling up
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(0.1 * Math.PI) * 60, 115 + Math.sin(0.1 * Math.PI) * 60);
    ctx.lineTo(128 + Math.cos(0.1 * Math.PI) * 60 + 10, 115 + Math.sin(0.1 * Math.PI) * 60 - 15);
    ctx.moveTo(128 + Math.cos(0.9 * Math.PI) * 60, 115 + Math.sin(0.9 * Math.PI) * 60);
    ctx.lineTo(128 + Math.cos(0.9 * Math.PI) * 60 - 10, 115 + Math.sin(0.9 * Math.PI) * 60 - 15);
    ctx.stroke();

    // Jagged vertical stitch lines / teeth
    ctx.lineWidth = 3;
    for (let angle = 0.2 * Math.PI; angle <= 0.8 * Math.PI; angle += 0.1) {
      const sx = 128 + Math.cos(angle) * 60;
      const sy = 115 + Math.sin(angle) * 60;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - 12);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  // ---------------------------------------------------------------------------
  // Level G ("The Small Office")
  // ---------------------------------------------------------------------------

  private resetLevelG() {
    this.levelGTime = 0;
    this.levelGDigits = [null, null, null];
    this.levelGAlarm = false;
    this.levelGHideSeconds.clear();
    this.localHideSeconds = 0;
    this.localHideState = "out";
    this.levelGAmbushTimer = 25;
    this.levelGAlertTimer = 0;
    this.fingerTapTimer = 0;
    this.kingBreathTimer = 0;
    this.kingWhisperTimer = 4;
    this.kingFalseTapTimer = 25;
    this.kingKnockCooldown = 0;
    this.kingStingerCooldown = 0;
    this.kingMimicCooldown = 30;
    this.localStepTimes = [];
    this.kingHasLastPos = false;
    this.kingDread = 0;
    this.kingSightingDone = false;
    this.kingSightingSearch = 0;
    this.nearTerminal = false;
    this.audio.stopAlarm();
    this.emitLevelGProgress();
  }

  /** Releases Level G-only scene objects before the old map is discarded. */
  private teardownLevelG() {
    if (this.kingPhantom) {
      this.kingPhantom.entity.returnToPool(this.scene);
      this.kingPhantom = null;
    }
    if (this.kingGrab) this.endKingGrab(false);
    this.kingScratches?.dispose();
    this.kingScratches = null;
    this.kingDread = 0;
    this.kingFlash = 0;
    this.audio.stopAlarm();
  }

  private emitLevelGProgress() {
    this.onLevelGProgress?.({ digits: [...this.levelGDigits], alarm: this.levelGAlarm });
  }

  /** The Finger King starts in the east office, out of sight of the reception. */
  private spawnLevelGEntities() {
    if (!this.map) return;
    const entity = WanderingEntity.getOrCreate(this.map, 13, 14, EntityType.FINGER_KING, this.scene);
    entity.netId = this.nextEntityNetId++;
    this.entities.push(entity);
  }

  private get levelGAggression(): number {
    return Math.min(1, this.levelGTime / LEVEL_G_FULL_AGGRESSION_S);
  }

  /** How long crouching in a closet fools it; shrinks as it grows angrier. */
  private get levelGHideLimit(): number {
    return 15 - 8 * this.levelGAggression;
  }

  private inCloset(x: number, z: number): boolean {
    if (!this.map) return false;
    return this.map.hideCells.has(`${Math.floor(x / this.map.cellSize)},${Math.floor(z / this.map.cellSize)}`);
  }

  private updateLevelG(delta: number, targets: AiTarget[] | null) {
    if (this.level !== LEVEL_G || !this.map || !this.player) return;
    this.levelGTime += delta;

    // --- This client's closet (HUD warnings; everyone runs this)
    const localIn = this.inCloset(this.player.position.x, this.player.position.z) && this.player.position.y < CROUCHED_EYE_HEIGHT;
    this.localHideSeconds = localIn ? this.localHideSeconds + delta : 0;
    const nextState = !localIn ? "out" : this.localHideSeconds < this.levelGHideLimit ? "hidden" : "found";
    if (nextState !== this.localHideState) {
      if (nextState === "hidden") this.onHUDNotification?.(t("eng.hidden"));
      if (nextState === "found") this.onHUDNotification?.(t("eng.found"));
      this.localHideState = nextState;
    }

    // --- Authority: hidden flags, Finger King knobs, ambushes
    if (targets) {
      for (const t of targets) {
        const inside = this.inCloset(t.x, t.z) && t.crouched;
        const seconds = inside ? (this.levelGHideSeconds.get(t.id) ?? 0) + delta : 0;
        if (inside) this.levelGHideSeconds.set(t.id, seconds); else this.levelGHideSeconds.delete(t.id);
        t.hidden = inside && seconds < this.levelGHideLimit;
      }

      this.levelGAlertTimer = Math.max(0, this.levelGAlertTimer - delta);
      const hunting = this.levelGAlarm || this.levelGAlertTimer > 0;
      for (const e of this.entities) {
        if (e.type !== EntityType.FINGER_KING) continue;
        e.aggression = this.levelGAggression;
        e.hunting = hunting;
      }

      this.levelGAmbushTimer -= delta;
      if (this.levelGAmbushTimer <= 0) {
        this.levelGAmbushTimer = 28 - 14 * this.levelGAggression + Math.random() * 6;
        if (!hunting) this.tryLevelGAmbush(targets);
      }
    }

    // --- The Finger King's presence: taps, breathing, whispers, scares (everyone, local)
    const finger = this.entities.find((e) => e.type === EntityType.FINGER_KING);
    this.updateKingPresence(delta, finger ?? null);
    this.updateKingSighting(delta, finger ?? null);
    this.kingScratches ??= new KingScratches(this.scene);
    this.kingScratches.update(delta, this.map, finger ? finger.mesh.position.x : null, finger ? finger.mesh.position.z : null);

    // --- Prompt when walking up to the terminal
    const atTerminal = this.tryInteract() === "terminal";
    if (atTerminal && !this.nearTerminal && !this.levelGAlarm) {
      this.onHUDNotification?.(t("eng.computer"));
    }
    this.nearTerminal = atTerminal;

    // --- Emergency door swings open once the alarm is on
    const leaf = this.map.emergencyDoorLeaf;
    if (this.map.emergencyDoorOpen && leaf) {
      leaf.rotation.y += (LEVEL_G_DOOR_OPEN_ANGLE - leaf.rotation.y) * Math.min(1, 3 * delta);
    }
  }

  /**
   * Everything that makes the Finger King felt before it's seen. Runs on
   * every client from the replicated King, all local:
   * - taps that count up (1, 2, 3...) as it nears, on wood, locker metal or glass;
   * - slow wet breathing and near-words whispering when it's close;
   * - a stinger (and the hum cut dead) the moment it starts hunting;
   * - silence when it passes the closet you're in — then three knocks;
   * - a flicker and a thud where it just appeared (ambush teleports);
   * - later on, taps from where it ISN'T, so the sound is never 100% trustworthy;
   * - the dread post-process, stronger the closer it is.
   */
  private updateKingPresence(delta: number, finger: WanderingEntity | null) {
    if (!this.map || !this.player) return;
    this.kingKnockCooldown = Math.max(0, this.kingKnockCooldown - delta);
    this.kingStingerCooldown = Math.max(0, this.kingStingerCooldown - delta);
    if (!finger) { this.kingDread = 0; return; }

    const kp = finger.mesh.position;
    const { dist, pan } = this.listenerPan(kp.x, kp.z);
    const staring = finger.scriptedPose === KING_POSE_STARE;
    const chasing = this.levelGAlarm || finger.chasingNow;
    // Crouched in a closet with it right outside: every sound it makes stops.
    const hushed = this.localHideState === "hidden" && dist < 6;

    // Dread post-process
    const dreadTarget = (dist < 7 ? 1 - dist / 7 : 0) + (staring && dist < 12 ? 0.35 : 0);
    this.kingDread = THREE.MathUtils.damp(this.kingDread, Math.min(1, dreadTarget), 3, delta);

    // Ambush: it moved further than it can walk in a frame → it's somewhere new.
    if (this.kingHasLastPos && Math.hypot(kp.x - this.kingLastPos.x, kp.z - this.kingLastPos.z) > 6 && dist < 22) {
      this.kingDarken(0.45);
      this.audio.playKingThud(Math.pow(1 - dist / 22, 1.2), pan);
    }
    this.kingLastPos.copy(kp);
    this.kingHasLastPos = true;

    // Hunt stinger
    if (finger.consumeAlertEdge() && finger.chasingNow && dist < 26 && this.kingStingerCooldown <= 0) {
      this.kingStingerCooldown = 25;
      this.audio.playKingStinger();
      this.onHUDNotification?.(t("sp.king.hunt"));
    }

    // Taps: more of them, faster, the closer it gets
    const HEAR = 24;
    if (dist < HEAR && !hushed) {
      this.fingerTapTimer -= delta;
      if (this.fingerTapTimer <= 0) {
        const closeness = 1 - dist / HEAR;
        this.fingerTapTimer = (0.25 + 1.9 * (dist / HEAR)) * (chasing ? 0.6 : 1) * (0.8 + Math.random() * 0.4);
        const cs = this.map.cellSize;
        const gx = Math.floor(kp.x / cs), gz = Math.floor(kp.z / cs);
        const surface = this.map.hideCells.has(`${gx},${gz}`) ? "metal" : ((gx * 31 + gz * 17) % 5 === 0 ? "glass" : "wood");
        this.audio.playFingerTap(Math.pow(closeness, 1.6), pan, surface, Math.min(4, 1 + Math.floor(closeness * 3.6)));
      }
    } else if (dist >= HEAR) {
      this.fingerTapTimer = 0;
    }

    // Breathing, close by
    if (dist < 7 && !hushed) {
      this.kingBreathTimer -= delta;
      if (this.kingBreathTimer <= 0) {
        this.audio.playKingBreath(Math.pow(1 - dist / 7, 1.3) * 0.9, pan, this.kingBreathInhale);
        this.kingBreathTimer = (this.kingBreathInhale ? 1.4 : 2.0) * (chasing ? 0.55 : 1);
        this.kingBreathInhale = !this.kingBreathInhale;
      }
    }

    // Whispers: while it watches you, and deep and constant while it stares
    if ((staring && dist < 14) || (dist < 9 && !chasing && !hushed)) {
      this.kingWhisperTimer -= delta;
      if (this.kingWhisperTimer <= 0) {
        this.audio.playKingWhisper(Math.pow(1 - dist / 14, 1.1) * (staring ? 1.1 : 0.7), pan, staring);
        this.kingWhisperTimer = staring ? 1.1 + Math.random() * 0.5 : 3.5 + Math.random() * 4;
      }
    }

    // Mimicry: stop walking, and it taps your own footsteps back at you.
    this.kingMimicCooldown = Math.max(0, this.kingMimicCooldown - delta);
    if (this.kingMimicCooldown <= 0 && !chasing && !staring && !hushed && dist > 6 && dist < 22) {
      const pattern = this.recentStepRhythm();
      if (pattern) {
        this.kingMimicCooldown = 35 + Math.random() * 25;
        this.fingerTapTimer = Math.max(this.fingerTapTimer, pattern[pattern.length - 1] + 2.5); // let the echo stand alone
        this.audio.playFingerTapPattern(pattern.map((o) => o + 0.7), Math.max(0.35, Math.pow(1 - dist / 22, 1.2)), pan, "wood");
      }
    }

    // Closet: it stops outside your door and knocks.
    if (this.localHideState === "hidden" && dist < 3.5 && this.kingKnockCooldown <= 0) {
      this.audio.playClosetKnock();
      this.onHUDNotification?.(t("eng.kingKnock"));
      this.kingKnockCooldown = 14;
    }

    // False taps: once it's angry enough, not every tap is really it.
    if (this.levelGAggression > 0.5 && !this.levelGAlarm && dist > 10) {
      this.kingFalseTapTimer -= delta;
      if (this.kingFalseTapTimer <= 0) {
        this.kingFalseTapTimer = 18 + Math.random() * 22;
        this.audio.playFingerTap(0.2 + Math.random() * 0.25, Math.random() * 2 - 1, Math.random() < 0.3 ? "metal" : "wood");
      }
    }
  }

  /**
   * The rhythm of this explorer's last walk, as offsets from its first step,
   * once they've just stopped: 4-6 steps with no gap over 1 s, the last one
   * 1.2-4 s ago. Null when there's nothing worth echoing.
   */
  private recentStepRhythm(): number[] | null {
    const steps = this.localStepTimes;
    if (steps.length < 4) return null;
    const sinceLast = this.totalPlayTime - steps[steps.length - 1];
    if (sinceLast < 1.2 || sinceLast > 4) return null;
    const run: number[] = [steps[steps.length - 1]];
    for (let i = steps.length - 2; i >= 0 && run.length < 6; i--) {
      if (run[0] - steps[i] > 1) break;
      run.unshift(steps[i]);
    }
    if (run.length < 4) return null;
    return run.map((t) => t - run[0]);
  }

  /** A short local blackout of the office tubes (never over the alarm or a real event). */
  private kingDarken(seconds: number) {
    if (!this.map || this.levelGAlarm || this.map.globalEventState !== "normal") return;
    this.map.startGlobalEvent("blackout", seconds);
    this.audio.triggerHumFlicker(Math.floor(seconds * 1000));
  }

  /**
   * The first sighting, once per run and only for this explorer: a few
   * seconds in, when you look straight down a corridor, the lights stutter
   * and the Finger King is standing at the far end with its back to you. It
   * turns its head... and the next flicker takes it away. Nothing chases you;
   * it just lets you know. It is a local phantom, not the real (replicated) King.
   */
  private updateKingSighting(delta: number, finger: WanderingEntity | null) {
    if (!this.map || !this.player) return;
    const p = this.player.position;

    if (this.kingPhantom) {
      const ph = this.kingPhantom;
      ph.t += delta;
      const e = ph.entity;
      const ex = e.mesh.position.x, ez = e.mesh.position.z;
      // Back turned, then it notices you (faces the real viewer).
      const turned = ph.t > 2.0;
      e.updateReplica(delta, turned ? p.x : ex + ph.awayX * 60, turned ? p.z : ez + ph.awayZ * 60);
      if (turned) {
        // Slowly, the whole body comes round to face you.
        const yaw = e.mesh.rotation.y;
        const d = Math.atan2(p.x - ex, p.z - ez) - yaw;
        e.setHeading(yaw + Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, 2.5 * delta));
      }
      if (turned && !ph.whispered) {
        ph.whispered = true;
        const { dist, pan } = this.listenerPan(ex, ez);
        this.audio.playKingWhisper(Math.max(0.3, 1 - dist / 24), pan, true);
      }
      const close = Math.hypot(ex - p.x, ez - p.z) < 5;
      if (ph.t > 3.0 || close || this.levelGAlarm) {
        this.kingDarken(0.8);
        e.returnToPool(this.scene);
        this.kingPhantom = null;
        this.kingSightingDone = true;
      }
      return;
    }

    if (this.kingSightingDone || this.levelGTime < 7 || this.levelGAlarm || this.isDead || this.localHideState !== "out") return;
    this.kingSightingSearch -= delta;
    if (this.kingSightingSearch > 0) return;
    this.kingSightingSearch = 0.3;

    // Only when looking squarely down a grid axis
    const [lx, lz] = this.lookDirectionXZ();
    if (Math.max(Math.abs(lx), Math.abs(lz)) < 0.92) return;
    const sx = Math.abs(lx) > Math.abs(lz) ? Math.sign(lx) : 0;
    const sz = sx === 0 ? Math.sign(lz) : 0;
    const cs = this.map.cellSize;
    let gx = Math.floor(p.x / cs), gz = Math.floor(p.z / cs);
    let spot: [number, number] | null = null;
    for (let i = 1; i <= 5; i++) {
      gx += sx; gz += sz;
      const cell = this.map.grid[gx]?.[gz];
      if (cell === undefined || cell === CellType.SOLID || this.map.hideCells.has(`${gx},${gz}`)) break;
      if (i >= 3) spot = [gx, gz];
    }
    if (!spot) return;
    const wx = spot[0] * cs + cs / 2, wz = spot[1] * cs + cs / 2;
    // Not while the real one is anywhere near: that would be two Kings.
    if (finger && (Math.hypot(finger.mesh.position.x - wx, finger.mesh.position.z - wz) < 12 || Math.hypot(finger.mesh.position.x - p.x, finger.mesh.position.z - p.z) < 14)) return;

    const phantom = WanderingEntity.getOrCreate(this.map, spot[0], spot[1], EntityType.FINGER_KING, this.scene);
    phantom.setHeading(Math.atan2(sx, sz));
    this.kingPhantom = { entity: phantom, t: 0, awayX: sx, awayZ: sz, whispered: false };
    this.kingDarken(0.3);
    this.audio.playFingerTap(0.35, 0, "wood", 1);
  }

  /** It has you: camera locked onto its face, the lunge, the scream, then the cut. */
  private startKingGrab(entity: WanderingEntity) {
    if (this.kingGrab) return;
    this.kingGrab = { entity, t: 0, screamed: false, baseFov: this.camera.fov };
    this.player.state = "idle";
    this.player.isFlashlightOn = true; // you see its face
  }

  private updateKingGrab(delta: number) {
    const g = this.kingGrab;
    if (!g) return;
    g.t += delta;
    g.entity.grab = Math.min(1, g.t * 4);

    // Wrench the view onto its face
    const face = g.entity.faceWorldPosition(this.kingFaceScratch);
    const pos = this.player.position;
    const dx = face.x - pos.x, dy = face.y - pos.y, dz = face.z - pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const k = Math.min(1, 14 * delta);
    let dYaw = yaw - this.player.rotation.y;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.player.rotation.y += dYaw * k;
    this.player.rotation.x += (pitch - this.player.rotation.x) * k;
    const shake = 0.02 + 0.05 * Math.min(1, g.t);
    this.camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0);
    this.camera.rotation.set(0, 0, (Math.random() - 0.5) * shake * 2);
    this.camera.parent?.position.copy(pos);
    this.camera.parent?.rotation.copy(this.player.rotation);

    const punch = 1 - Math.pow(1 - Math.min(1, g.t / 0.45), 3);
    this.camera.fov = g.baseFov - 30 * punch;
    this.camera.updateProjectionMatrix();

    if (!g.screamed && g.t > 0.08) {
      g.screamed = true;
      this.audio.playFingerKingScream();
    }
    this.kingFlash = Math.min(1, g.t * 1.8);
    if (g.t > 1.3) this.endKingGrab(true);
  }

  private endKingGrab(kill: boolean) {
    const g = this.kingGrab;
    if (!g) return;
    this.kingGrab = null;
    g.entity.grab = 0;
    this.camera.fov = g.baseFov;
    this.camera.updateProjectionMatrix();
    this.kingFlash = 0;
    if (kill) {
      this.deathBlack = 1;
      this.die("caught", true);
    }
  }

  /**
   * Moves the Finger King to lie in wait just past a door or at a corridor
   * end ahead of someone — somewhere 10-20 m away that nobody is looking at,
   * and only while nobody is looking at *it* either.
   */
  private tryLevelGAmbush(targets: AiTarget[]) {
    if (!this.map) return;
    const finger = this.entities.find((e) => e.type === EntityType.FINGER_KING);
    if (!finger) return;
    const hunted = targets.filter((t) => !t.hidden);
    if (hunted.length === 0) return;

    const seenBy = (x: number, z: number, maxDist: number) => hunted.some((t) => {
      const dx = x - t.x, dz = z - t.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > maxDist) return false;
      const flat = Math.hypot(t.dir.x, t.dir.z) || 1;
      return d < 3 || (t.dir.x * dx + t.dir.z * dz) / (flat * d) > 0.25;
    });
    if (seenBy(finger.mesh.position.x, finger.mesh.position.z, 16)) return;
    const { distSq: fingerDistSq } = nearestTarget(hunted, finger.mesh.position.x, finger.mesh.position.z);
    if (fingerDistSq < 8 * 8) return; // already close: let it keep stalking

    const cs = this.map.cellSize;
    const spots = this.map.ambushCells.filter(([gx, gz]) => {
      const x = gx * cs + cs / 2, z = gz * cs + cs / 2;
      const { distSq } = nearestTarget(hunted, x, z);
      return distSq >= 10 * 10 && distSq <= 20 * 20 && !seenBy(x, z, 30);
    });
    if (spots.length === 0) return;
    const [gx, gz] = spots[Math.floor(Math.random() * spots.length)];
    finger.teleportTo(gx, gz);
  }

  /** Horizontal look direction (unit), from the camera. */
  private lookDirectionXZ(): [number, number] {
    const dir = this.camera.getWorldDirection(this.scratchCamDir);
    const len = Math.hypot(dir.x, dir.z);
    return len < 1e-3 ? [0, -1] : [dir.x / len, dir.z / len];
  }

  /**
   * E: shove the box/crate you're facing out of your way. It slides a metre or
   * two along the floor (around obstacles if the straight line is blocked) and
   * the move is replicated to teammates so everyone sees the same room.
   * Returns true if there was a box in reach (whether or not it could move).
   */
  public tryPushBox(): boolean {
    if (this.isDead || !this.map || !this.player || !this.player.mapFullyLoaded) return false;
    if (!this.player.isLocked && !this.player.isOverrideActive) return false;
    const [fx, fz] = this.lookDirectionXZ();
    const px = this.player.position.x, pz = this.player.position.z;
    const m = this.map.findPushable(px, pz, fx, fz);
    if (!m) return false;

    const dest = this.map.pushMovable(m, px, pz, this.scene);
    if (!dest) {
      this.onHUDNotification?.(t("eng.noRoom"));
      return true;
    }
    this.audio.playBoxPush();
    this.noiseBus.emit(dest.x, dest.z, 1.0, "prop", this.totalPlayTime);
    this.sendToServer({ type: "box_push", level: this.level, id: m.id, x: dest.x, z: dest.z });
    return true;
  }

  /** Index of the nearest untouched valve within arm's reach, or -1. */
  private nearestUntouchedValveIndex(): number {
    if (this.level !== POOLROOMS_LEVEL || !this.map || !this.player) return -1;
    const cs = this.map.cellSize;
    for (let i = 0; i < this.map.valvePositions.length; i++) {
      if (this.valvesTurned.has(i)) continue;
      const [vx, vz] = this.map.valvePositions[i];
      const dx = this.player.position.x - (vx * cs + cs / 2);
      const dz = this.player.position.z - (vz * cs + cs / 2);
      if (dx * dx + dz * dz < 2.4 * 2.4) return i;
    }
    return -1;
  }

  private nearUntouchedValve(): boolean {
    return this.nearestUntouchedValveIndex() >= 0;
  }

  /**
   * E, near a Poolrooms valve: turns it. Each sector has its own three-wheel
   * sequence; completing all sectors drains the level.
   * level's toxic ("Hydrolitis Plague") water cells drain — a re-reading of
   * the source level's "fill the tank" puzzle as "drain the contamination"
   * instead, which needed no wall-regeneration machinery to gate progress
   * (the hazard itself is the gate). Returns true if there was an untouched
   * valve in reach.
   */
  public tryTurnValve(): boolean {
    if (this.isDead) return false;
    const i = this.nearestUntouchedValveIndex();
    if (i < 0) return false;
    // Give the local player immediate feedback. The next server snapshot is
    // authoritative and replaces this prediction if another player wins the
    // race or the sequence rejects the attempt.
    this.predictValveTurn(i);
    this.sendToServer({ type: "valve_turn", level: this.level, index: i });
    return true;
  }

  private predictValveTurn(index: number) {
    if (!this.map || this.valvesTurned.has(index)) return;
    const per = this.map.poolValvesPerRoom;
    const rooms = this.map.poolRoomCount;
    const room = Math.floor(index / per);
    const roomBase = room * per;
    let doneInRoom = 0;
    for (let k = 0; k < per; k++) if (this.valvesTurned.has(roomBase + k)) doneInRoom++;

    if (index !== roomBase + this.map.poolValveOrder[room][doneInRoom]) {
      for (let k = 0; k < per; k++) this.valvesTurned.delete(roomBase + k);
      this.map.poolVigiaIntellect = Math.min(1, this.map.poolVigiaIntellect + 0.32);
      this.map.setPoolroomsValveState(this.valvesTurned, this.countSolvedPoolrooms());
      this.audio.playTerminalBeep(false);
      this.onHUDNotification?.(t("eng.denied"));
      return;
    }

    this.valvesTurned.add(index);
    this.map.poolVigiaIntellect = Math.min(1, this.map.poolVigiaIntellect + 0.08);
    const solved = this.countSolvedPoolrooms();
    this.map.setPoolroomsValveState(this.valvesTurned, solved);
    this.audio.playTerminalBeep(true);
    if (solved >= rooms) {
      this.onHUDNotification?.(t("eng.valveAllTurned"));
      unlockAchievement("valves_drained");
    } else {
      this.onHUDNotification?.(t("eng.valveTurn", { n: this.valvesTurned.size, total: this.map.valvePositions.length }));
    }
  }

  private countSolvedPoolrooms(): number {
    if (!this.map) return 0;
    let solved = 0;
    for (let room = 0; room < this.map.poolRoomCount; room++) {
      let complete = true;
      for (let valve = 0; valve < this.map.poolValvesPerRoom; valve++) {
        if (!this.valvesTurned.has(room * this.map.poolValvesPerRoom + valve)) complete = false;
      }
      if (complete) solved++;
    }
    return solved;
  }

  /** Applies the server's complete Poolrooms state, ignoring stale revisions. */
  public applyPoolroomsState(data: {
    level?: number;
    revision?: number;
    turned?: unknown;
    stage?: number;
    solved?: boolean;
    vigiaIntellect?: unknown;
  }) {
    if (!this.map || this.level !== POOLROOMS_LEVEL || data.level !== undefined && data.level !== this.level) return;
    if (typeof data.revision !== "number" || !Number.isInteger(data.revision) || data.revision < this.poolValveRevision) return;
    if (!Array.isArray(data.turned) || typeof data.stage !== "number" || !Number.isInteger(data.stage)) return;

    const turned = new Set<number>();
    for (const index of data.turned) {
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= POOL_VALVE_COUNT) return;
      turned.add(index);
    }
    const hadState = this.poolValveRevision >= 0;
    const previousCount = this.valvesTurned.size;
    const wasSolved = this.map.poolroomsSolved;
    this.poolValveRevision = data.revision;
    this.valvesTurned = turned;
    this.map.setPoolroomsValveState(turned, data.stage);
    if (typeof data.vigiaIntellect === "number" && Number.isFinite(data.vigiaIntellect)) {
      this.map.poolVigiaIntellect = Math.max(0, Math.min(1, data.vigiaIntellect));
    }
    if (!hadState) return;

    if (turned.size < previousCount) {
      this.audio.playTerminalBeep(false);
      this.onHUDNotification?.(t("eng.denied"));
    } else if (turned.size > previousCount) {
      this.audio.playTerminalBeep(true);
      if (!wasSolved && this.map.poolroomsSolved) {
        this.onHUDNotification?.(t("eng.valveAllTurned"));
        unlockAchievement("valves_drained");
      } else {
        this.onHUDNotification?.(t("eng.valveTurn", { n: turned.size, total: this.map.valvePositions.length }));
      }
    }
  }

  /** A teammate shoved a box on this level: replay the slide. */
  public applyBoxPush(msg: { level: number; id: string; x: number; z: number }) {
    if (!this.map || msg.level !== this.level) return;
    const m = this.map.movables.get(msg.id);
    if (!m || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
    this.map.slideMovableTo(m, msg.x, msg.z, this.scene);
  }

  /** Keeps the "[E] Empurrar caixa" hint in sync with what the player is facing (~10x/s). */
  private updateInteractPrompt(delta: number) {
    this.interactPromptTimer += delta;
    if (this.interactPromptTimer < 0.1) return;
    this.interactPromptTimer = 0;
    let text: string | null = null;
    if (this.map && this.player && this.player.mapFullyLoaded && (this.player.isLocked || this.player.isOverrideActive)) {
      const [fx, fz] = this.lookDirectionXZ();
      const funPrompt = this.funDirector ? this.funDirector.interactionPrompt() : null;
      const spacePrompt = this.spaceDirector ? this.spaceDirector.interactionPrompt() : null;
      if (funPrompt) {
        text = funPrompt;
      } else if (spacePrompt) {
        text = spacePrompt;
      } else if (this.nearExitDesk()) {
        text = t("act.readPaper");
      } else if (this.nearCheatTerminal()) {
        text = t("act.cheatTerminal");
      } else if (this.map.findPushable(this.player.position.x, this.player.position.z, fx, fz)) {
        text = t("act.pushBox");
      } else if (this.nearUntouchedValve()) {
        text = t("act.turnValve");
      } else if (this.nearUntouchedLevel3Switch() !== -1) {
        text = t("act.level3Switch");
      } else if (this.nearMegEmployee()) {
        text = t("act.megEmployee");
      } else if (this.nearMegDoor()) {
        text = t("act.megDoor");
      } else if (this.nearFunCake()) {
        text = t("fun.act.eatCake");
      }
    }
    if (text !== this.lastInteractPrompt) {
      this.lastInteractPrompt = text;
      this.onInteractPrompt?.(text);
    }
  }

  /** Closes the dialogue / paper overlay once the player walks away from it. */
  private updateReadingRange() {
    if (!this.readingAnchor || !this.player) return;
    const dx = this.player.position.x - this.readingAnchor.x;
    const dz = this.player.position.z - this.readingAnchor.z;
    if (dx * dx + dz * dz > 4.0 * 4.0) {
      this.readingAnchor = null;
      this.talkingEmployee = null;
      this.onReadingEnd?.();
    }
  }

  /** The UI closed the dialogue / paper itself (E, lost pointer lock). */
  public endReading() {
    this.readingAnchor = null;
    this.talkingEmployee = null;
  }

  /** Within arm's reach of the desk that holds the exit paper (Levels 0 and 1). */
  private nearExitDesk(): boolean {
    if (!this.map || !this.player || this.map.exitDeskX < 0) return false;
    const dx = this.player.position.x - this.map.exitDeskX;
    const dz = this.player.position.z - this.map.exitDeskZ;
    return dx * dx + dz * dz < 2.2 * 2.2;
  }

  private nearUntouchedLevel3Switch(): number {
    if (this.level !== ELECTRICAL_ROOM_LEVEL || !this.map || !this.player) return -1;
    for (let i = 0; i < this.map.level3Switches.length; i++) {
      if (this.map.level3SwitchesOn.has(i)) continue;
      const [gx, gz] = this.map.level3Switches[i];
      const dx = this.player.position.x - (gx * this.map.cellSize + this.map.cellSize / 2);
      const dz = this.player.position.z - (gz * this.map.cellSize + this.map.cellSize / 2);
      if (dx * dx + dz * dz < 2.5 * 2.5) return i;
    }
    return -1;
  }

  private nearMegEmployee(): { name: string; grade: string; dialogue: string; gx: number; gz: number } | null {
    if (this.level !== ABANDONED_OFFICE_LEVEL || !this.map || !this.player) return null;
    const cs = this.map.cellSize;
    return this.map.level4Employees.find((employee) => {
      const dx = this.player.position.x - (employee.gx * cs + cs / 2);
      const dz = this.player.position.z - (employee.gz * cs + cs / 2);
      return dx * dx + dz * dz < 3.0 * 3.0;
    }) ?? null;
  }

  private nearMegDoor(): boolean {
    if (this.level !== ABANDONED_OFFICE_LEVEL || !this.map || !this.player) return false;
    const cs = this.map.cellSize;
    const dx = this.player.position.x - (this.map.level4DoorX * cs + cs / 2);
    const dz = this.player.position.z - (this.map.level4DoorZ * cs + cs / 2);
    // The locked door's cell has collision, so allow interaction from the
    // neighbouring corridor cell (one 4m grid cell away).
    return dx * dx + dz * dz < 5.2 * 5.2;
  }

  /** The hidden office party's cake: eating it is Level FUN's secret entrance. */
  private nearFunCake(): boolean {
    if (this.level !== ABANDONED_OFFICE_LEVEL || !this.map || !this.player || this.map.funCakeX < 0 || this.funCakeEaten) return false;
    const cs = this.map.cellSize;
    const dx = this.player.position.x - (this.map.funCakeX * cs + cs / 2);
    const dz = this.player.position.z - (this.map.funCakeZ * cs + cs / 2);
    return dx * dx + dz * dz < 2.0 * 2.0;
  }

  // ---------------------------------------------------------------------
  // Level FUN
  // ---------------------------------------------------------------------

  /** Camera-attached slot for Level FUN's held-item model (see FunHost.setHeldItem). */
  private funHandGroup: THREE.Group | null = null;

  private ensureFunHandGroup(): THREE.Group {
    if (!this.funHandGroup) {
      this.funHandGroup = new THREE.Group();
      this.funHandGroup.position.set(0.32, -0.28, -0.55);
      this.funHandGroup.rotation.set(0.08, -0.5, 0.04);
      this.camera.add(this.funHandGroup);
    }
    return this.funHandGroup;
  }

  private teardownFun() {
    this.funDirector?.dispose();
    this.funDirector = null;
    if (this.funHandGroup) while (this.funHandGroup.children.length) this.funHandGroup.remove(this.funHandGroup.children[0]);
    if (this.lastFunObjective !== null) {
      this.lastFunObjective = null;
      this.onObjectiveChange?.(null);
    }
  }

  private setupFun() {
    this.teardownFun();
    const world = this.level === FUN_LEVEL ? this.map?.fun : null;
    if (!world) return;
    this.funDirector = new FunDirector(world, {
      audio: this.audio,
      notify: (text) => this.onHUDNotification?.(text),
      player: () => {
        const [lookX, lookZ] = this.lookDirectionXZ();
        return { x: this.player.position.x, z: this.player.position.z, lookX, lookZ };
      },
      globalEvent: (state, seconds) => this.map?.startGlobalEvent(state, seconds),
      send: (kind, index) => this.sendToServer({ type: "fun_event", level: FUN_LEVEL, kind, index }),
      stageChanged: () => { /* atmosphere is re-read from the stage every frame */ },
      setHeldItem: (obj) => {
        const group = this.ensureFunHandGroup();
        while (group.children.length) group.remove(group.children[0]);
        if (obj) group.add(obj);
      },
      kill: () => this.die("caught"),
    });
  }

  private updateFun(delta: number) {
    const director = this.funDirector;
    const world = this.map?.fun;
    if (!director || !world || !this.player) return;
    world.update(delta, this.totalPlayTime);
    director.update(delta);
    const objective = director.objective();
    if (objective !== this.lastFunObjective) {
      this.lastFunObjective = objective;
      this.onObjectiveChange?.(objective);
    }
  }

  // ---------------------------------------------------------------------
  // Level 79
  // ---------------------------------------------------------------------

  private teardownSpace() {
    this.spaceDirector?.dispose();
    this.spaceDirector = null;
    this.spaceTerminal = null;
    if (this.lastSpaceObjective !== null) {
      this.lastSpaceObjective = null;
      this.onObjectiveChange?.(null);
    }
  }

  private setupSpace() {
    this.teardownSpace();
    const world = this.level === SPACE_LEVEL ? this.map?.space : null;
    if (!world) return;
    this.spaceDirector = new SpaceDirector(world, {
      audio: this.audio,
      scene: this.scene,
      notify: (text) => this.onHUDNotification?.(text),
      player: () => {
        const [lookX, lookZ] = this.lookDirectionXZ();
        return { x: this.player.position.x, z: this.player.position.z, lookX, lookZ };
      },
      viewer: (out) => this.camera.getWorldPosition(out),
      send: (kind, index) => this.sendToServer({ type: "space_event", level: SPACE_LEVEL, kind, index }),
      setFade: (alpha) => this.setFade(alpha),
      shake: (amount) => { this.spaceShake = amount; },
      escape: () => this.onEscapeTrigger?.(),
      kill: () => { if (!this.isDead) this.die("caught"); },
    });
  }

  private updateSpace(delta: number) {
    const director = this.spaceDirector;
    if (!director || !this.player) return;
    director.update(delta);
    // Shake the head rig, not the camera: the rig is re-seated on the player every frame.
    const rig = this.camera.parent;
    if (this.spaceShake > 0 && rig) {
      rig.position.x += (Math.random() - 0.5) * this.spaceShake * 2;
      rig.position.y += (Math.random() - 0.5) * this.spaceShake * 2;
      rig.position.z += (Math.random() - 0.5) * this.spaceShake * 2;
    }
    const objective = director.objective();
    if (objective !== this.lastSpaceObjective) {
      this.lastSpaceObjective = objective;
      this.onObjectiveChange?.(objective);
    }
  }

  /** A black card in front of the camera, for fades (Level 79's finale). 0 hides it. */
  private setFade(alpha: number) {
    if (alpha <= 0) {
      if (this.fadeOverlay) this.fadeOverlay.visible = false;
      return;
    }
    if (!this.fadeOverlay) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, fog: false });
      this.fadeOverlay = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), mat);
      this.fadeOverlay.position.z = -0.15;
      this.fadeOverlay.renderOrder = 10000;
      this.fadeOverlay.frustumCulled = false;
      this.camera.add(this.fadeOverlay);
    }
    this.fadeOverlay.visible = true;
    (this.fadeOverlay.material as THREE.MeshBasicMaterial).opacity = Math.min(1, alpha);
  }

  /** What a Level 79 terminal's modal shows right now; null once the level is gone. */
  public spaceTerminalView(id: SpaceTerminalId): SpaceTerminalView | null {
    return this.spaceDirector?.terminalView(id) ?? null;
  }

  public spaceChoose(console: SpaceConsoleId, target: SpaceTarget) {
    this.spaceDirector?.choose(console, target);
  }

  public spaceExecute() {
    this.spaceDirector?.execute();
  }

  public spaceAbort() {
    this.spaceDirector?.abort();
  }

  /** The wiring panel: a cable went into a socket (right colour or not), for the sound and a spark. */
  public spaceWireFeedback(ok: boolean) {
    this.spaceDirector?.wireFeedback(ok);
  }

  /** The wiring panel is complete: the main bus closes for the whole level. */
  public spacePowerOn() {
    this.spaceDirector?.powerOn();
  }

  public spacePowered(): boolean {
    return this.spaceDirector?.isPowered ?? false;
  }

  /** A teammate set a console or executed a course (relayed by the server). */
  public applySpaceEvent(msg: { level?: unknown; kind?: unknown; index?: unknown }) {
    if (this.level !== SPACE_LEVEL || msg.level !== SPACE_LEVEL || !this.spaceDirector) return;
    if (typeof msg.kind !== "string" || typeof msg.index !== "number") return;
    this.spaceDirector.applyRemote(msg.kind, msg.index);
  }

  /** A teammate's puzzle progress (relayed by the server). */
  public applyFunEvent(msg: { level?: unknown; kind?: unknown; index?: unknown }) {
    if (this.level !== FUN_LEVEL || msg.level !== FUN_LEVEL || !this.funDirector) return;
    if (typeof msg.kind !== "string" || typeof msg.index !== "number") return;
    this.funDirector.applyRemote(msg.kind, msg.index);
  }

  /** The door panel's buttons, in the order the modal shows them. */
  public funPressButton(index: number): { result: "ok" | "wrong" | "solved"; progress: number } {
    return this.funDirector?.pressButton(index) ?? { result: "wrong", progress: 0 };
  }

  public funPanelProgress(): number {
    return this.funDirector?.panelProgressCount() ?? 0;
  }

  public handleLevel3Switch(index: number) {
    if (this.level !== ELECTRICAL_ROOM_LEVEL || !this.map || index < 0 || index >= this.map.level3Switches.length) return;
    this.map.level3SwitchesOn.add(index);
    this.map.updateLevel3SwitchVisual(index);
    if (this.map.level3SwitchesOn.size >= this.map.level3Switches.length) {
      this.map.openLevel3Gate();
      this.onHUDNotification?.(t("eng.level3GateOpen"));
      this.audio.playTerminalBeep(true);
    } else {
      this.onHUDNotification?.(t("eng.level3Switch", { n: this.map.level3SwitchesOn.size }));
    }
  }

  /** The exit desk's paper as a readable note, or null. */
  public exitPaperNote(): { title: string; content: string } | null {
    const note = this.map?.exitPaperNote();
    return note ? { title: note.title, content: note.lines.join("\n") } : null;
  }

  /** The interactables: the exit desk's paper (Levels 0/1), the lobby's cheat terminal, and Level G's main-room terminal. */
  public tryInteract(): "terminal" | "paper" | "cheat" | "meg_employee" | "meg_door" | "fun_panel" | "fun" | "fun_cake" | "space_terminal" | null {
    if (this.isDead) return null;
    if (this.funDirector) {
      const used = this.funDirector.interact();
      if (used === "panel") return "fun_panel";
      if (used === "done") return "fun";
    }
    if (this.spaceDirector) {
      const terminal = this.spaceDirector.interact();
      if (terminal) {
        this.spaceTerminal = terminal;
        return "space_terminal";
      }
    }
    const switchIndex = this.nearUntouchedLevel3Switch();
    if (switchIndex >= 0) {
      this.handleLevel3Switch(switchIndex);
      this.sendToServer({ type: "brick_office_switch", level: ELECTRICAL_ROOM_LEVEL, index: switchIndex });
      return null;
    }
    const employee = this.nearMegEmployee();
    if (employee) {
      const cs = this.map.cellSize;
      this.readingAnchor = { x: employee.gx * cs + cs / 2, z: employee.gz * cs + cs / 2 };
      this.talkingEmployee = employee.name;
      this.onMegDialogue?.(employee);
      return "meg_employee";
    }
    if (this.nearMegDoor()) {
      this.onMegDoorRequest?.();
      return "meg_door";
    }
    if (this.nearFunCake()) {
      // A completely unrelated secret from Level G's: eating the cake at
      // the hidden office party leaves for Level FUN, nowhere near the real
      // exit door (level4DoorX/Z) or the Level G door (abandonedSecretX/Z).
      this.funCakeEaten = true;
      this.audio.playFunSound("giggle", 0, 0.5);
      this.onSecretLevelFound?.(FUN_LEVEL);
      return "fun_cake";
    }
    if (this.nearExitDesk()) {
      this.readingAnchor = { x: this.map.exitDeskX, z: this.map.exitDeskZ };
      this.talkingEmployee = null;
      return "paper";
    }
    if (this.nearCheatTerminal()) return "cheat";
    if (this.level !== LEVEL_G || !this.map || !this.player || this.map.levelGTerminalX < 0) return null;
    const cs = this.map.cellSize;
    const dx = this.player.position.x - (this.map.levelGTerminalX * cs + cs / 2);
    const dz = this.player.position.z - (this.map.levelGTerminalZ * cs + cs / 2);
    return dx * dx + dz * dz < 2.4 * 2.4 ? "terminal" : null;
  }

  public submitMegDoorIds(raw: string): boolean {
    if (this.level !== ABANDONED_OFFICE_LEVEL || !this.map) return false;
    const ids = raw.replace(/\D/g, "");
    const expected = [...this.map.level4Employees]
      .filter((employee) => employee.role === "programmer")
      .sort((a, b) => ({ senior: 0, pleno: 1, junior: 2 }[a.grade] - { senior: 0, pleno: 1, junior: 2 }[b.grade]))
      .map((employee) => employee.accessId);
    const ok = ids === expected.join("");
    if (ok) {
      this.level4DoorOpen = true;
      this.map.openLevel4Door();
      this.onHUDNotification?.(t("eng.megDoorOpen"));
      this.audio.playTerminalBeep(true);
    } else {
      this.onHUDNotification?.(t("eng.megDoorDenied"));
      this.audio.playTerminalBeep(false);
    }
    return ok;
  }

  /**
   * Checks a code typed into the terminal. Right: the final alarm. Wrong: a
   * refusal buzz, and the Finger King comes straight for you for a while.
   */
  public submitLevelGCode(code: string): boolean {
    if (this.level !== LEVEL_G || !this.map) return false;
    const ok = code === this.map.levelGCode;
    this.audio.playTerminalBeep(ok);
    if (ok) {
      this.startLevelGAlarm(true);
    } else {
      this.onHUDNotification?.(t("eng.denied"));
      if (this.isWorldAuthority) this.levelGAlertTimer = 10;
      else this.sendToServer({ type: "levelg_code", ok: false });
    }
    return ok;
  }

  /** A teammate typed a code (authority only): alarm them all, or send it after them. */
  public handleLevelGCodeRequest(msg: { level: number; ok: boolean }) {
    if (msg.level !== LEVEL_G || this.level !== LEVEL_G || !this.isWorldAuthority) return;
    if (msg.ok) this.startLevelGAlarm(true);
    else this.levelGAlertTimer = 10;
  }

  // ---------------------------------------------------------------------------
  // Lobby cheat terminal (MVJM / UHUM / CLIP / LIFE / SKIN)
  // ---------------------------------------------------------------------------

  /** Within arm's reach of the lobby's cheat terminal. */
  private nearCheatTerminal(): boolean {
    if (this.level !== LOBBY_LEVEL || !this.player) return false;
    const dx = this.player.position.x - LOBBY.terminal.x;
    const dz = this.player.position.z - LOBBY.terminal.z;
    return dx * dx + dz * dz < 2.2 * 2.2;
  }

  /** Re-stamps the lobby's unlocked cheats onto a freshly (re)built PlayerController. */
  private applyCheatsToPlayer() {
    this.player.speedCheat = this.cheatSpeed;
    this.player.infiniteStaminaCheat = this.cheatStamina;
    this.player.clipCheat = this.cheatClip;
  }

  /**
   * Checks a code typed into the lobby's cheat terminal. MVJM, UHUM, CLIP and
   * LIFE (or SUDO, all four) only *identify* a room cheat here — the caller sends it to the server,
   * which unlocks it for everyone in the room and broadcasts it back, and
   * applyRoomCheats() is what actually turns it on (re-entering an unlocked
   * code just confirms it, never toggles it off). SKIN sets nothing by itself
   * — it tells the caller to open the monster picker (see applySkinCheat).
   */
  public submitCheatCode(code: string): RoomCheat | "sudo" | "skin" | "room" | null {
    const c = code.trim().toUpperCase();
    if (c === "MVJM") return "speed";
    if (c === "UHUM") return "stamina";
    if (c === "CLIP") return "clip";
    if (c === "LIFE") return "life";
    if (c === "SETA") return "arrow";
    if (c === "SUDO") return "sudo"; // every room cheat at once
    if (c === "SKIN") return "skin";
    if (c === "ROOM") return "room";
    return null;
  }

  /** The room's unlocked cheats (server-broadcast): applies every one of them to this player. */
  public applyRoomCheats(cheats: readonly RoomCheat[]) {
    const has = (c: RoomCheat) => cheats.includes(c);
    if (has("life") && !this.cheatLife) this.sanity = 1.0;
    this.cheatSpeed = has("speed");
    this.cheatStamina = has("stamina");
    this.cheatClip = has("clip");
    this.cheatLife = has("life");
    this.cheatArrow = has("arrow");
    if (this.player) this.applyCheatsToPlayer();
  }

  /**
   * World position of every secret entrance on this level (Level 1 → Lights
   * Out, Abandoned Office → Level G, Abandoned Office → the hidden cake ->
   * Level FUN). Abandoned Office has two at once, so this returns a list
   * rather than a single target.
   */
  public secretEntranceTargets(): { x: number; z: number; label: string }[] {
    const map = this.map;
    if (!map) return [];
    const cs = map.cellSize;
    const targets: { x: number; z: number; label: string }[] = [];
    if (this.level === 1 && map.secretGridX >= 0) targets.push({ x: (map.secretGridX + 0.5) * cs, z: (map.secretGridZ + 0.5) * cs, label: "6" });
    if (this.level === ABANDONED_OFFICE_LEVEL && map.abandonedSecretX >= 0) targets.push({ x: (map.abandonedSecretX + 0.5) * cs, z: (map.abandonedSecretZ + 0.5) * cs, label: "G" });
    if (this.level === ABANDONED_OFFICE_LEVEL && map.funCakeX >= 0 && !this.funCakeEaten) targets.push({ x: (map.funCakeX + 0.5) * cs, z: (map.funCakeZ + 0.5) * cs, label: "FUN" });
    return targets;
  }

  /** Sets (or, with null, clears) the SKIN cheat's monster body; replicated to teammates on the next network tick. */
  public applySkinCheat(type: SkinBodyChoice | null) {
    this.cheatSkin = type && MONSTER_SKIN_TYPES.includes(type) ? type : null;
  }

  /**
   * The final chase: tubes flicker, the ambience turns to a klaxon, the
   * emergency door unlocks and the Finger King is released behind you.
   * `broadcast`: whether this call originates the alarm (vs. replaying one).
   */
  private startLevelGAlarm(broadcast: boolean) {
    if (this.levelGAlarm || this.level !== LEVEL_G || !this.map) return;
    this.levelGAlarm = true;
    this.map.emergencyDoorOpen = true;
    this.map.startGlobalEvent("flicker_storm", 1e6);
    this.audio.startAlarm();
    this.onHUDNotification?.(t("eng.alarm"));
    this.emitLevelGProgress();

    if (this.isWorldAuthority) {
      this.releaseFingerKingBehind();
      if (broadcast) this.sendToServer({ type: "world_event", level: this.level, state: "levelg_alarm", duration: 0 });
    } else if (broadcast) {
      this.sendToServer({ type: "levelg_code", ok: true });
    }
  }

  /** Puts the Finger King at the ambush spot furthest from the exit that's still ≥10 m from everyone. */
  private releaseFingerKingBehind() {
    if (!this.map || !this.player) return;
    const finger = this.entities.find((e) => e.type === EntityType.FINGER_KING);
    if (!finger) return;
    const cs = this.map.cellSize;
    const camDir = this.scratchCamDir;
    this.camera.getWorldDirection(camDir);
    const targets = this.collectAiTargets(camDir);
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const [gx, gz] of this.map.ambushCells) {
      const x = gx * cs + cs / 2, z = gz * cs + cs / 2;
      if (nearestTarget(targets, x, z).distSq < 10 * 10) continue;
      const score = Math.abs(gx - this.map.exitGridX) + Math.abs(gz - this.map.exitGridZ);
      if (score > bestScore) { bestScore = score; best = [gx, gz]; }
    }
    if (best) finger.teleportTo(best[0], best[1]);
  }

  // ---------------------------------------------------------------------------
  // Replicated world: monsters, smilers, blackouts
  // ---------------------------------------------------------------------------

  public setWorldAuthority(byLevel: Record<string, string>) {
    this.worldAuthority = byLevel;
  }

  /**
   * Whether this client simulates the monsters, smilers and blackout rolls on
   * its level. Offline — or right after entering a level the server hasn't
   * assigned anyone to yet — it simulates on its own.
   */
  private get isWorldAuthority(): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.localPlayerId) return true;
    const id = this.worldAuthority[String(this.level)];
    return id === undefined || id === this.localPlayerId;
  }

  private sendToServer(payload: unknown) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Everyone the monsters on this level can hunt: us plus same-level teammates. */
  private collectAiTargets(camDir: THREE.Vector3): AiTarget[] {
    const targets: AiTarget[] = [];
    targets.push({
      id: "local",
      hidden: false,
      crouched: this.player.position.y < CROUCHED_EYE_HEIGHT,
      x: this.player.position.x,
      z: this.player.position.z,
      state: this.player.state,
      dir: camDir,
      flashlight: this.player.isFlashlightOn,
    });
    let i = 0;
    this.remoteStates.forEach((r, id) => {
      if (r.dead) return; // spectators aren't prey
      let dir = this.scratchRemoteDirs[i];
      if (!dir) dir = this.scratchRemoteDirs[i] = new THREE.Vector3();
      i++;
      // Camera forward for a YXZ yaw/pitch (the camera looks down -Z).
      const cosPitch = Math.cos(r.pitch);
      dir.set(-Math.sin(r.yaw) * cosPitch, Math.sin(r.pitch), -Math.cos(r.yaw) * cosPitch);
      targets.push({ id, hidden: false, crouched: r.y < CROUCHED_EYE_HEIGHT, x: r.x, z: r.z, state: r.state, dir, flashlight: r.flashlight });
    });
    // A dead explorer is only hunted when there is nobody else left to hunt.
    if (this.isDead && targets.length > 1) targets.shift();
    return targets;
  }

  /** Streams monsters and smilers to the rest of the level (authority only). */
  private sendWorldState(delta: number) {
    if (!this.isWorldAuthority || this.remoteStates.size === 0) return;
    this.worldSendTimer += delta;
    if (this.worldSendTimer < this.worldSendInterval) return;
    this.worldSendTimer = 0;

    this.sendToServer({
      type: "entities",
      level: this.level,
      list: this.entities.map((e) => e.toNetState()),
      smilers: this.smilers.map((s) => ({ id: s.netId, gx: s.gridX, gz: s.gridZ })),
    });
  }

  /** Adopts a monsters/smilers frame from the level's authority. */
  public applyWorldState(msg: { level: number; list: EntityNetState[]; smilers: { id: number; gx: number; gz: number }[] }) {
    if (!this.map || msg.level !== this.level || this.isWorldAuthority) return;

    const seenEntities = new Set<number>();
    for (const s of msg.list) {
      if (!ENTITY_TYPES.has(s.t)) continue;
      let entity = this.entities.find((e) => e.netId === s.id);
      if (!entity) {
        entity = WanderingEntity.getOrCreate(this.map, s.gx, s.gz, s.t, this.scene);
        entity.netId = s.id;
        this.entities.push(entity);
        if (this.level === LIGHTS_OUT_LEVEL && this.onHUDNotification) {
          this.onHUDNotification(t("eng.lightAttract"));
        }
      }
      entity.applyNetState(s);
      seenEntities.add(s.id);
      // Keeps ids unique if this client takes over as authority later.
      this.nextEntityNetId = Math.max(this.nextEntityNetId, s.id + 1);
    }
    this.entities = this.entities.filter((e) => {
      if (seenEntities.has(e.netId)) return true;
      e.returnToPool(this.scene);
      return false;
    });

    const seenSmilers = new Set<number>();
    for (const s of msg.smilers) {
      if (!this.smilers.some((sm) => sm.netId === s.id)) this.addSmiler(s.gx, s.gz, s.id);
      seenSmilers.add(s.id);
      this.nextSmilerNetId = Math.max(this.nextSmilerNetId, s.id + 1);
    }
    this.smilers = this.smilers.filter((sm) => {
      if (seenSmilers.has(sm.netId)) return true;
      this.disposeSmiler(sm);
      return false;
    });
  }

  /** Plays a blackout/flicker storm the level's authority rolled. */
  public applyWorldEvent(msg: { level: number; state: "flicker_storm" | "blackout" | "levelg_alarm"; duration: number }) {
    if (!this.map || msg.level !== this.level || this.isWorldAuthority) return;
    if (msg.state === "levelg_alarm") {
      this.startLevelGAlarm(false);
      return;
    }
    this.map.startGlobalEvent(msg.state, msg.duration);
    this.audio.triggerHumFlicker(msg.state === "blackout" ? 400 : 600);
  }

  /**
   * Pushes every monster on this level far from (gx, gz). Only the authority
   * moves them; anyone else asks it to (its next frame carries the result).
   */
  private relocateEntitiesAwayFrom(gx: number, gz: number) {
    if (this.isWorldAuthority) {
      this.entities.forEach((ent) => ent.relocateFarAway(gx, gz));
    } else {
      this.sendToServer({ type: "entities_relocate", gx, gz });
    }
  }

  /** A teammate got caught: relocate on their behalf (authority only). */
  public handleRelocateRequest(msg: { level: number; gx: number; gz: number }) {
    if (msg.level !== this.level || !this.isWorldAuthority) return;
    this.entities.forEach((ent) => ent.relocateFarAway(msg.gx, msg.gz));
  }

  /** Spawns a smiler 14-28 m from the explorer at (px, pz), if a spot exists. */
  private spawnSmiler(px: number, pz: number) {
    if (!this.map || !this.player) return;

    // Find all walkable coordinates 14 to 30 meters away from the explorer
    const hSize = this.map.cellSize;
    
    const candidates: [number, number][] = [];
    const minDistSq = 14 * 14;
    const maxDistSq = 28 * 28;
    const cellRadius = Math.ceil(28 / hSize) + 1;
    const pgx = Math.floor(px / hSize);
    const pgz = Math.floor(pz / hSize);
    const scanMinX = Math.max(2, pgx - cellRadius);
    const scanMaxX = Math.min(this.map.gridSize - 3, pgx + cellRadius);
    const scanMinZ = Math.max(2, pgz - cellRadius);
    const scanMaxZ = Math.min(this.map.gridSize - 3, pgz + cellRadius);

    for (let x = scanMinX; x <= scanMaxX; x++) {
      for (let z = scanMinZ; z <= scanMaxZ; z++) {
        const cellX = x * hSize + hSize / 2;
        const cellZ = z * hSize + hSize / 2;
        const dx = cellX - px;
        const dz = cellZ - pz;
        const distSq = dx * dx + dz * dz;

        if (distSq >= minDistSq && distSq <= maxDistSq) {
          // Verify cell is not SOLID
          if (this.map.grid[x][z] !== 0) { // CellType.SOLID is 0
            // Ensure no existing Smiler nearby
            const alreadyHasSmiler = this.smilers.some(s => s.gridX === x && s.gridZ === z);
            if (!alreadyHasSmiler) {
              candidates.push([x, z]);
            }
          }
        }
      }
    }

    if (candidates.length === 0) return;

    // Pick a candidate at random
    const idx = Math.floor(Math.random() * candidates.length);
    const [gx, gz] = candidates[idx];
    this.addSmiler(gx, gz, this.nextSmilerNetId++);
    console.log(`[Smiler] Spawned creepily at grid (${gx}, ${gz})`);
  }

  /** Builds a smiler billboard at a cell (spawned here or replicated from the authority). */
  private addSmiler(gx: number, gz: number, netId: number) {
    if (!this.map) return;
    const hSize = this.map.cellSize;

    // Create Smiler Plane mesh (texture is shared across every smiler)
    const texture = this.getSmilerTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    // A 1.8m wide, 1.8m high billboard
    const geo = new THREE.PlaneGeometry(1.8, 1.8);
    const mesh = new THREE.Mesh(geo, mat);

    // Place at 1.15m height (chest level) above this cell's floor — sector 3
    // (the only sector smilers spawn in) is a real elevated storey.
    const worldX = gx * hSize + hSize / 2;
    const worldZ = gz * hSize + hSize / 2;
    mesh.position.set(worldX, this.map.getFloorHeightAt(worldX, worldZ) + 1.15, worldZ);

    this.scene.add(mesh);
    this.smilers.push({
      netId,
      mesh,
      gridX: gx,
      gridZ: gz,
      spawnTime: this.totalPlayTime,
      gazeTimer: 0,
    });
  }

  private disposeSmiler(smiler: { mesh: THREE.Mesh }) {
    this.scene.remove(smiler.mesh);
    smiler.mesh.geometry.dispose();
    if (Array.isArray(smiler.mesh.material)) {
      smiler.mesh.material.forEach(m => m.dispose());
    } else if (smiler.mesh.material) {
      smiler.mesh.material.dispose();
    }
  }

  private clearAllSmilers() {
    this.smilers.forEach((smiler) => this.disposeSmiler(smiler));
    this.smilers = [];
    this.smilerSpawnCheckTimer = 0;
  }

  /**
   * Which of Level 1's three sequential sectors (real stacked storeys) a grid
   * cell is in. 1 = ground floor, 2 = the storey up Ramp A, 3 = the sealed
   * smiler hall two storeys up (holds the exit, reached via the "extensive
   * ramp"). Each pair of sectors is walled apart except at its one ramp mouth.
   */
  public getCurrentSector(gx: number, gz: number): 1 | 2 | 3 {
    const divX2 = this.map ? this.map.level1Sector2X : 17;
    const divX3 = this.map ? this.map.level1Sector3X : 33;
    if (gx >= divX3) return 3;
    if (gx < divX2) return 1;
    return 2;
  }

  /**
   * Spawns every entry of a static roster (LevelDefinition's "static" spawn
   * kind) at the nearest walkable cell to each entry's target cell. Shared
   * by level 1 and level 2's rosters — the only difference between the two
   * call sites used to be the search radius and whether a sector bound
   * (level 1 only spawns in sectors 1 & 2) applied.
   */
  private spawnStaticRoster(roster: { type: EntityType; targetCell: [number, number] }[], searchRadius: number, maxX?: number) {
    if (!this.map) return;
    for (const { type, targetCell } of roster) {
      const [qx, qz] = targetCell;
      let entGX = qx, entGZ = qz, found = false;
      for (let r = 0; r < searchRadius && !found; r++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          for (let dz = -r; dz <= r && !found; dz++) {
            const nx = qx + dx, nz = qz + dz;
            if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2 && (maxX === undefined || nx < maxX)) {
              if (this.map.grid[nx][nz] !== 0) { entGX = nx; entGZ = nz; found = true; }
            }
          }
        }
      }
      const entity = WanderingEntity.getOrCreate(this.map, entGX, entGZ, type, this.scene);
      entity.netId = this.nextEntityNetId++;
      this.entities.push(entity);
    }
  }

  /**
   * Spawns Level 1's roaming monsters. They live in sectors 1 & 2 only —
   * sector 3 is the smiler hall. Shared by the first level load and every
   * transitionToLevel(1) so the two spawn sites can't drift apart.
   */
  private spawnLevel1Entities() {
    if (!this.map) return;
    const def = LEVEL_DEFS[1];
    if (def.spawn.kind !== "static") return;
    // All targets sit inside sectors 1 & 2 (x < level1Sector3X).
    this.spawnStaticRoster(def.spawn.roster, 12, this.map.level1Sector3X);
  }

  /**
   * Level 3 ("Lights Out"): the maze is only navigable by its sparse glowing
   * waypoints — you don't need the flashlight to see them. Turning it on
   * anyway (to see the walls, out of habit or panic) is what the level
   * punishes: held on continuously, it summons a stalker every few seconds,
   * up to a small cap. Switching it back off lets the timer cool down before
   * the next one comes.
   */
  private updateLightsOutSummons(delta: number, targets: AiTarget[] | null) {
    const def = LEVEL_DEFS[LIGHTS_OUT_LEVEL];
    // Authority only (targets is null elsewhere): the summoned stalkers reach
    // everyone else on the level through the replicated stream.
    if (this.level !== LIGHTS_OUT_LEVEL || !this.player || !this.map || !targets || def.spawn.kind !== "timedSummon") {
      this.lightsOutSummonTimer = 0;
      return;
    }
    const { intervalS, maxConcurrent } = def.spawn;

    // Any explorer on the level holding a light counts, not just us.
    const lit = targets.find((t) => t.flashlight);
    if (lit) {
      this.lightsOutSummonTimer += delta;
      if (this.lightsOutSummonTimer >= intervalS) {
        this.lightsOutSummonTimer = 0;
        if (this.entities.length < maxConcurrent) {
          this.spawnLightsOutStalker(lit.x, lit.z);
        }
      }
    } else {
      this.lightsOutSummonTimer = Math.max(0, this.lightsOutSummonTimer - delta * 2);
    }
  }

  /** Summons a stalker from LEVEL_DEFS[3]'s pool, spawnRadiusCells away from the explorer whose light drew it, at (x, z). */
  private spawnLightsOutStalker(x: number, z: number) {
    const def = LEVEL_DEFS[LIGHTS_OUT_LEVEL];
    if (!this.player || !this.map || def.spawn.kind !== "timedSummon") return;
    const { pool, spawnRadiusCells: [minR, maxR] } = def.spawn;
    const pgX = Math.floor(x / this.map.cellSize);
    const pgZ = Math.floor(z / this.map.cellSize);
    const type = pool[Math.floor(Math.random() * pool.length)];

    // A walkable cell spawnRadiusCells out in a random direction — close
    // enough to feel like it answered the light, far enough to not spawn on
    // top of you.
    let entGX = -1, entGZ = -1;
    for (let attempt = 0; attempt < 24 && entGX < 0; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minR + Math.random() * (maxR - minR);
      const nx = Math.round(pgX + Math.cos(angle) * dist);
      const nz = Math.round(pgZ + Math.sin(angle) * dist);
      if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2 && this.map.grid[nx][nz] !== 0) {
        entGX = nx; entGZ = nz;
      }
    }
    if (entGX < 0) return; // couldn't find a spot this time — try again next interval

    const entity = WanderingEntity.getOrCreate(this.map, entGX, entGZ, type, this.scene);
    entity.netId = this.nextEntityNetId++;
    this.entities.push(entity);
    if (this.onHUDNotification) {
      this.onHUDNotification(t("eng.lightAttract"));
    }
  }

  private updateSmilers(delta: number, targets: AiTarget[] | null) {
    if (!this.player || !this.map) return;

    const hSize = this.map.cellSize;
    const inSector3 = (x: number, z: number) =>
      this.getCurrentSector(Math.floor(x / hSize), Math.floor(z / hSize)) === 3;

    // Spawning and despawning are the authority's call (targets is null
    // elsewhere), judged against every explorer on the level; the gaze drain
    // below runs on every client for its own explorer.
    if (targets) {
      // Smilers live in Level 1's sector 3 (the final hall) and, at night,
      // all over Level 6 (see updateLevel6's day/night cycle) — everywhere
      // else, clear them out.
      const level6Night = this.level === LIGHTS_OUT_LEVEL && this.level6IsNight;
      const hunted = this.level === 1 ? targets.filter((t) => inSector3(t.x, t.z))
        : level6Night ? targets
        : [];
      if (hunted.length === 0) {
        if (this.smilers.length > 0) this.clearAllSmilers();
        return;
      }

      // Check spawning conditions every 7 seconds
      this.smilerSpawnCheckTimer += delta;
      if (this.smilerSpawnCheckTimer >= 7) {
        this.smilerSpawnCheckTimer = 0;
        // Up to 4 active smilers, 75% chance per check, near a random explorer in the hall
        if (this.smilers.length < 4 && Math.random() < 0.75) {
          const t = hunted[Math.floor(Math.random() * hunted.length)];
          this.spawnSmiler(t.x, t.z);
        }
      }

      this.smilers = this.smilers.filter((smiler) => {
        const { distSq } = nearestTarget(targets, smiler.mesh.position.x, smiler.mesh.position.z);
        // Vanish silently when anyone walks up to it (< 4 m), avoiding direct
        // confrontation; clean up once it's far from everyone (> 42 m).
        if (distSq < 4.0 * 4.0 || distSq > 42.0 * 42.0) {
          this.disposeSmiler(smiler);
          return false;
        }
        return true;
      });
    }

    const px = this.player.position.x;
    const pz = this.player.position.z;

    // Camera forward vector used for glancing checks
    const camDir = this.scratchCamDir;
    this.camera.getWorldDirection(camDir);

    for (const smiler of this.smilers) {
      const mesh = smiler.mesh;

      // 1. Billboard: Turn horizontally to face player head-on (creepy staring!)
      mesh.lookAt(px, mesh.position.y, pz);

      const dx = mesh.position.x - px;
      const dz = mesh.position.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // 2. Sustained-gaze drain. Looking straight at a smiler no longer makes
      //    it vanish — instead your sanity bleeds for as long as you keep
      //    staring, and the drain rate ramps up the longer you hold the look.
      //    Glance away and gazeTimer decays fast, so a brief look is forgiving.
      const dirToSmiler = new THREE.Vector3().subVectors(mesh.position, this.camera.position).normalize();
      const dot = camDir.dot(dirToSmiler);
      const gazing = dot > 0.90 && dist < 20.0; // ~25 deg cone, 20 m range
      // Burned back by direct flashlight light — roughly the flashlight's own cone/range (see the SpotLight built in initWorld).
      const litByFlashlight = this.player.isFlashlightOn && dot > 0.85 && dist < 14.0;

      if (litByFlashlight) {
        smiler.gazeTimer = Math.max(0, smiler.gazeTimer - delta * 1.5);
      } else if (gazing) {
        smiler.gazeTimer += delta;
        const drainRate = 0.010 + Math.min(smiler.gazeTimer, 8) * 0.006; // ~0.01/s -> ~0.058/s after 8s
        if (!this.cheatLife) this.sanity = Math.max(0.0, this.sanity - drainRate * this.sanityDrainFactor() * delta);
        if (Math.random() < delta * 0.18) {
          this.audio.triggerHumFlicker(90);
        }
      } else {
        smiler.gazeTimer = Math.max(0, smiler.gazeTimer - delta * 0.6);
      }
    }
  }

  /**
   * Level 6's day/night cycle. By day it's a safe, calm field/town — no
   * mobs (LEVEL_DEFS has no static/timedSummon roster for it, see
   * registry.ts's "bespoke" entry). At night O Ceifador is summoned to
   * hunt, biased toward the group's most-visited cells if any exist yet
   * (VisitTracker) — its presence doubles as the level's "boss": the exit
   * sits inside the castle at the far end, so reaching it at night means
   * reaching it while Ceifador is actively hunting, rather than a
   * separately scripted boss encounter.
   */
  private updateLevel6(delta: number) {
    if (this.level !== MOTION_LEVEL || !this.map || !this.player) return;
    this.level6Time += delta;
    const cycleLength = this.LEVEL6_DAY_S + this.LEVEL6_NIGHT_S;
    const phase = this.level6Time % cycleLength;
    const wasNight = this.level6IsNight;
    this.level6IsNight = phase >= this.LEVEL6_DAY_S;

    if (this.level6IsNight && !wasNight) {
      this.onHUDNotification?.(t("eng.level6Night"));
      if (this.isWorldAuthority) this.spawnCeifadorNightHunt();
    } else if (!this.level6IsNight && wasNight) {
      this.onHUDNotification?.(t("eng.level6Day"));
      if (this.isWorldAuthority) this.despawnCeifadorNightHunt();
    }
  }

  private spawnCeifadorNightHunt() {
    if (!this.map || this.ceifadorEntity) return;
    const px = Math.floor(this.player.position.x / this.map.cellSize);
    const pz = Math.floor(this.player.position.z / this.map.cellSize);
    // Bias toward the group's most-visited cells (route-memory — the whole
    // point of this mob, see mobs/ceifador.ts), well clear of the player's
    // own cell; falls back to a far corner if there's no visit data yet.
    const visited = this.map.visitTracker?.mostVisited(1, px, pz, 6) ?? [];
    const [gx, gz] = visited[0] ? [visited[0].gx, visited[0].gz] : [this.map.gridSize - 6, this.map.gridSize - 6];
    const entity = WanderingEntity.getOrCreate(this.map, gx, gz, EntityType.CEIFADOR, this.scene);
    entity.netId = this.nextEntityNetId++;
    this.entities.push(entity);
    this.ceifadorEntity = entity;
  }

  private despawnCeifadorNightHunt() {
    if (!this.ceifadorEntity) return;
    const idx = this.entities.indexOf(this.ceifadorEntity);
    if (idx >= 0) this.entities.splice(idx, 1);
    this.ceifadorEntity.returnToPool(this.scene);
    this.ceifadorEntity = null;
  }

  /**
   * Consumes/uses an item from the inventory (hotbar key or the inventory's
   * USE button). Refuses — without spending the item — when using it now
   * would be wasted: sanity already full, the same buff still running, or
   * another item used a moment ago.
   */
  public useInventoryItem(itemId: string): ItemUseResult {
    const idx = this.inventory.indexOf(itemId);
    if (idx === -1) return "missing";
    if (!USABLE_ITEMS.has(itemId)) return "passive";
    if (this.isDead || this.isWaitingForTransition) return "blocked";

    const now = performance.now();
    if (now - this.lastItemUseAt < ITEM_USE_COOLDOWN_MS) return "blocked";

    const refuse = (key: MessageKey): ItemUseResult => {
      this.onHUDNotification?.(t(key));
      return "blocked";
    };

    switch (itemId) {
      case "almond_water":
        if (this.sanity >= SANITY_FULL && this.player.stamina >= this.player.maxStamina) return refuse("eng.itemBlocked.sanityFull");
        this.sanity = Math.min(1.0, this.sanity + 0.20);
        this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 0.15); // restores physical stamina too
        this.audio.playGlitchNoclipSound();
        this.onHUDNotification?.(t("eng.almondUsed"));
        unlockAchievement("restored_mind");
        break;
      case "old_photo":
        // Remembering who you are: the strongest sanity restore, no stamina.
        if (this.sanity >= SANITY_FULL) return refuse("eng.itemBlocked.sanityFull");
        this.sanity = Math.min(1.0, this.sanity + 0.35);
        this.audio.playGlitchNoclipSound();
        this.onHUDNotification?.(t("eng.photoUsed"));
        break;
      case "liquid_pain":
        // Adrenaline: a burst of undrained, slightly faster sprinting that burns the mind.
        if (this.player.adrenalineTimer > 0) return refuse("eng.itemBlocked.active");
        this.player.adrenalineTimer = ADRENALINE_SECONDS;
        this.player.stamina = this.player.maxStamina;
        if (!this.cheatLife) this.sanity = Math.max(0.0, this.sanity - 0.15);
        this.onHUDNotification?.(t("eng.painUsed"));
        unlockAchievement("pain_survivor");
        break;
      case "cassette_tape":
        // The recording's static sweeps the halls: the radar reaches much farther for a while.
        if (this.radarBoostTimer > 0) return refuse("eng.itemBlocked.active");
        this.radarBoostTimer = RADAR_BOOST_SECONDS;
        this.audio.triggerHumFlicker(400);
        this.onHUDNotification?.(t("eng.tapeUsed"));
        break;
      default:
        return "passive";
    }

    this.lastItemUseAt = now;
    // Remove one instance of the item
    this.inventory.splice(idx, 1);
    this.onInventoryChange?.([...this.inventory]);
    this.onSanityChange?.(this.sanity);
    return "used";
  }

  /** A teammate handed over an item (server-validated "item_received"). */
  public receiveItem(itemId: string, fromName: string) {
    this.inventory.push(itemId);
    this.audio.playGlitchNoclipSound();
    this.onHUDNotification?.(t("eng.itemReceived", { name: fromName, item: t(`item.${itemId}.name` as MessageKey) }));
    this.onInventoryChange?.([...this.inventory]);
  }

  /** The server confirmed a hand-off ("item_give_ok"): drop one of that item. */
  public removeGivenItem(itemId: string, toName: string) {
    const idx = this.inventory.indexOf(itemId);
    if (idx === -1) return;
    this.inventory.splice(idx, 1);
    this.onHUDNotification?.(t("eng.itemGiven", { name: toName, item: t(`item.${itemId}.name` as MessageKey) }));
    this.onInventoryChange?.([...this.inventory]);
  }

  /** Timed item effects still running, for the HUD's buff pills. */
  public activeBuffs(): ActiveBuff[] {
    const buffs: ActiveBuff[] = [];
    if (!this.player) return buffs;
    if (this.player.adrenalineTimer > 0) {
      buffs.push({ id: "liquid_pain", remaining: this.player.adrenalineTimer, total: ADRENALINE_SECONDS });
    }
    if (this.radarBoostTimer > 0) {
      buffs.push({ id: "cassette_tape", remaining: this.radarBoostTimer, total: RADAR_BOOST_SECONDS });
    }
    if (this.inventory.includes("strange_crystal")) buffs.push({ id: "strange_crystal", remaining: 0, total: 0 });
    return buffs;
  }

  /** Horizontal distance to a teammate on this level, or null if unknown / elsewhere. */
  public distanceToPlayer(id: string): number | null {
    const st = this.remoteStates.get(id);
    if (!st || !this.player || (st.level !== undefined && st.level !== this.level)) return null;
    return Math.hypot(st.x - this.player.position.x, st.z - this.player.position.z);
  }

  /** Closest living teammate on this level within `range` meters (for item hand-offs). */
  public nearestTeammateInRange(range: number): { id: string; name: string } | null {
    if (this.isDead) return null;
    let best: { id: string; name: string } | null = null;
    let bestDist = range;
    this.remoteStates.forEach((st, id) => {
      if (st.dead || st.exitReady || this.remoteDead.has(id)) return;
      const d = this.distanceToPlayer(id);
      if (d !== null && d <= bestDist) {
        bestDist = d;
        best = { id, name: st.name };
      }
    });
    return best;
  }

  /** Strange Crystal cuts every sanity drain while it's carried (one is enough; they don't stack). */
  private sanityDrainFactor(): number {
    return this.inventory.includes("strange_crystal") ? CRYSTAL_DRAIN_FACTOR : 1.0;
  }

  /** Radar display range in meters — extended while a cassette tape plays. */
  public get radarRange(): number {
    return this.radarBoostTimer > 0 ? RADAR_BOOST_RANGE : RADAR_BASE_RANGE;
  }

  /**
   * Halts loop, untethers document/canvas events, and purges WebGL memory stacks.
   */
  public destroy() {
    this.isRunning = false;
    this.timer.dispose();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.voip.dispose();
    this.teardownFun();
    this.teardownSpace();
    if (this.fadeOverlay) {
      this.fadeOverlay.geometry.dispose();
      (this.fadeOverlay.material as THREE.Material).dispose();
      this.fadeOverlay = null;
    }

    this.clearAllSmilers();
    if (this.smilerTexture) {
      this.smilerTexture.dispose();
      this.smilerTexture = null;
    }

    this.entities.forEach(entity => entity.returnToPool(this.scene));
    this.entities = [];
    if (this.lobby) { this.lobby.dispose(this.scene); this.lobby = null; }
    this.officeWorkers.forEach((w) => w.dispose(this.scene));
    this.officeWorkers = [];
    this.ripples?.dispose();
    this.ripples = null;
    this.teardownLevelG();

    window.removeEventListener("resize", this.handleResize);
    
    if (this.player) {
      this.player.removeEvents();
    }

    if (this.map) {
      this.map.disposeGateway(this.scene);
      this.map.clearAll(this.scene);
    }

    if (this.globalDust) {
      this.scene.remove(this.globalDust);
      if (this.globalDust.geometry) this.globalDust.geometry.dispose();
      if (Array.isArray(this.globalDust.material)) {
        this.globalDust.material.forEach((m) => m.dispose());
      } else if (this.globalDust.material) {
        this.globalDust.material.dispose();
      }
    }

    if (this.audio) {
      this.audio.destroy();
    }

    if (this.lightPool) {
      this.lightPool.dispose();
    }

    // Purge custom VHS postprocessing buffers and shaders
    if (this.vhsRenderTarget) {
      this.vhsRenderTarget.dispose();
    }
    if (this.vhsMaterial) {
      this.vhsMaterial.dispose();
    }

    // Purge static entities pool to free up GPU buffers and memory
    WanderingEntity.clearPool();

    // Purge scene contents completely
    Array.from(this.remotePlayerGroups.keys()).forEach((id) => this.removeRemotePlayer(id));
    this.remotePlayerGroups.clear();
    this.remotePlayerLights.clear();
    this.remotePlayerLightTargets.clear();

    if (this.renderer) {
      this.renderer.dispose();
      if (typeof this.renderer.forceContextLoss === "function") {
        this.renderer.forceContextLoss();
      }
    }

    this.container.innerHTML = "";
    console.log("Game Engine successfully destroyed");
  }
}
