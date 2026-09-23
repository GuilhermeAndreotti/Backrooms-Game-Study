/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lobby, LOBBY, LOBBY_LEVEL, BallNetState } from "./Lobby";
import { Voip } from "./Voip";
import { t } from "../i18n";
import * as THREE from "three";
import { ProceduralMap, LEVEL_G_DOOR_OPEN_ANGLE } from "./ProceduralMap";
import { PlayerController, PLAYER_STANDING_HEIGHT, PLAYER_CROUCH_HEIGHT } from "./PlayerController";
import { FACE_SIZE, drawFace, hasFace } from "../utils/face";
import { AudioManager } from "./AudioManager";
import { WanderingEntity, EntityType, EntityNetState } from "./WanderingEntity";
import { GameSettings, RemotePlayer } from "../types/game";
import { unlockAchievement } from "../utils/achievements";
import { LightPool } from "./LightPool";
import { NoiseBus, footstepLoudness } from "./systems/noiseBus";
import { VisitTracker } from "./systems/visitTracker";
import { LEVEL_DEFS } from "./levels/registry";
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
  /** A secret entrance was reached: 3 = Lights Out, 4 = Level G. */
  onSecretLevelFound?: (level: number) => void;
  /** Context hint for the crosshair area, e.g. t("act.pushBox"); null clears it. */
  onInteractPrompt?: (text: string | null) => void;
  onMegDialogue?: (employee: { name: string; grade: string; dialogue: string }) => void;
  onMegDoorRequest?: () => void;
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

/** Ambient light and fog per level, shared by level setup and the per-frame event code. */
function levelAtmosphere(level: number) {
  switch (level) {
    case LOBBY_LEVEL: // room lobby: open-air field under a clear blue sky
      return { ambientColor: 0xfff6e0, ambientIntensity: 2.6, fogColor: 0x8fc7f0, dimmedFogColor: 0x4a6a8a };
    case 4: // Level G: dim, cold office under failing tubes
      return { ambientColor: 0x9aa4ad, ambientIntensity: 0.5, fogColor: 0x23272a, dimmedFogColor: 0x0b0c0d };
    case 8: // Brick Offices: dim industrial brick halls
      return { ambientColor: 0xb4a092, ambientIntensity: 1.15, fogColor: 0x554039, dimmedFogColor: 0x241a17 };
    case 3: // Lights Out: the waypoints and flashlight are all that remain
      return { ambientColor: 0x05050a, ambientIntensity: 0.008, fogColor: 0x000000, dimmedFogColor: 0x000000 };
    case 2: // Pipe Dreams: tense dark reddish brown
      return { ambientColor: 0x8a4a2c, ambientIntensity: 1.4, fogColor: 0x3a1608, dimmedFogColor: 0x1a0902 };
    case 1: // warehouse: brighter industrial
      return { ambientColor: 0xaab5bd, ambientIntensity: 1.35, fogColor: 0x8a9299, dimmedFogColor: 0x24282c };
    case 6: // "Motion": bright open-air field by day (night is a live override — see updateLevel6/the per-frame ambient block)
      return { ambientColor: 0xdff0ff, ambientIntensity: 2.2, fogColor: 0x9fd4f0, dimmedFogColor: 0x3a5a70 };
    case 7: // Dark Poolrooms: cool, dim, underwater-tinted
      return { ambientColor: 0x2a4a55, ambientIntensity: 0.6, fogColor: 0x0f2830, dimmedFogColor: 0x050f12 };
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

/** Monster bodies offered by the lobby's SKIN cheat — every type except the Level G exclusive. */
const MONSTER_SKIN_TYPES: EntityType[] = [
  EntityType.DULLER, EntityType.HOUND, EntityType.CLUMP, EntityType.SKIN_STEALER, EntityType.WRETCH,
];

/** Validates a `monsterSkin` string (network field or cheat-picker choice) against the offered set. */
function monsterSkinType(value?: string | null): EntityType | null {
  return value && (MONSTER_SKIN_TYPES as string[]).includes(value) ? (value as EntityType) : null;
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
  private clock = new THREE.Clock();
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
  /** Indices into map.valvePositions that have been turned; all 3 drains toxicWaterCells. */
  private valvesTurned = new Set<number>();
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
  private nearTerminal = false;
  private level4DoorOpen = false;
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
  private lastInteractPrompt: string | null = null;
  private interactPromptTimer = 0;
  private onLevelGProgress?: (progress: LevelGProgress) => void;
  private onRedRoomExposureChange?: (val: number) => void;
  private onToxicWaterExposureChange?: (val: number) => void;
  public onHUDNotification?: (msg: string) => void;
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
  /** SKIN cheat: the monster body worn instead of the hazmat suit, replicated to teammates; "" for none. */
  public cheatSkin: EntityType | null = null;

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
    this.onLevelGProgress = callbacks.onLevelGProgress;
    this.onRedRoomExposureChange = callbacks.onRedRoomExposureChange;
    this.onToxicWaterExposureChange = callbacks.onToxicWaterExposureChange;
    this.onHUDNotification = callbacks.onHUDNotification;
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
        
        uv.x += trackingBar + rollDistortion;

        // B. CHROMATIC ABERRATION (Scales dynamically with insanity!)
        float distFromCenter = length(uv - 0.5);
        float shiftAmt = 0.0012 + distFromCenter * 0.0018 + (0.016 * insanity);
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

        // Dark red pulsing vignette warning overlay on critical insanity
        if (insanity > 0.4) {
          float pulse = (sin(uTime * 3.8) * 0.5 + 0.5) * insanity;
          vec3 pulseRed = vec3(0.35, 0.02, 0.02) * pulse * distFromCenter;
          color = mix(color, pulseRed, 0.32 * insanity);
        }

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // 3. Instantiate custom shader material binding the uniforms
    this.vhsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(targetW, targetH) },
        uSanity: { value: 1.0 }
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
    const authored = level === LOBBY_LEVEL ? 0.008 : level === 4 ? 0.06 : level === 8 ? 0.035 : (level === 2 ? 0.032 : (level === 1 ? 0.020 : 0.024));
    const referenceViewDistance = 24;
    const ratio = referenceViewDistance / Math.max(1, this.quality.viewDistance);
    return authored * ratio;
  }

  private initWorld(seed: number, settings: GameSettings) {
    const atmosphere = levelAtmosphere(this.level);
    this.scene.background = new THREE.Color(atmosphere.fogColor);
    this.scene.fog = new THREE.FogExp2(atmosphere.fogColor, this.fogDensityFor(this.level));

    this.ambientLight = new THREE.AmbientLight(atmosphere.ambientColor, atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Pass level to both map and audio
    this.audio.level = this.level;
    this.audio.startFluorescentHum();

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
    const triggerAudioFootstep = (speed: 'walk' | 'run' | 'crouch') => {
      const isWet = this.map ? this.map.isCellWet(this.player.position.x, this.player.position.z) : false;
      this.audio.playFootstep(speed, 0.0, isWet); // panning 0.0 for self
      this.noiseBus.emit(this.player.position.x, this.player.position.z, footstepLoudness(speed), "footstep", this.totalPlayTime);
    };

    // Instantiate Player movement controller after map is pre-loaded
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, triggerAudioFootstep);
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();
    this.applyCheatsToPlayer();
    this.setupLobby();

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
    if (this.level === 8) {
      const def3 = LEVEL_DEFS[8];
      if (def3.spawn.kind === "static") this.spawnStaticRoster(def3.spawn.roster, 8);
    }

    // Initial first-turn map culler tick
    this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z);

    // Dynamic global dust cloud centered on player
    this.initGlobalDust();
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
    if (this.player) {
      this.player.setMouseSensitivity(settings.mouseSensitivity);
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private startLoop() {
    this.isRunning = true;
    this.clock.getDelta(); // reset clock differential delta timer
    const animate = () => {
      if (!this.isRunning) return;
      this.animationFrameId = requestAnimationFrame(animate);

      const delta = this.clock.getDelta();
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
      if (this.isDead) this.updateSpectator(delta);
      else {
        this.player.update(delta);
        if (this.level === 8 && this.map) {
          const gx = Math.floor(this.player.position.x / this.map.cellSize);
          const gz = Math.floor(this.player.position.z / this.map.cellSize);
          if (this.map.level3LowCorridor.has(`${gx},${gz}`) && this.player.position.y > CROUCHED_EYE_HEIGHT + 0.18) {
            this.onHUDNotification?.(t("eng.level3Crouch"));
          }
        }
      }
      this.updateLobby(delta);
      this.updateInteractPrompt(delta);


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
      if (this.level === 7 && this.map && this.player) {
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
        if (this.level === 1 || this.level === 4) {
          let sec: string;
          if (this.level === 4) {
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
              
              if (item.type === "almond_water") {
                this.inventory.push("almond_water");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.almond"));
                }
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "energy_bar") {
                this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 0.25);
                this.sanity = Math.min(1.0, this.sanity + 0.15);
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.energy"));
                }
              } else if (item.type === "old_photo") {
                this.inventory.push("old_photo");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.photo"));
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "rusty_key") {
                this.inventory.push("rusty_key");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.key"));
                }
                unlockAchievement("key_finder");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "cassette_tape") {
                this.inventory.push("cassette_tape");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.tape"));
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "strange_crystal") {
                this.inventory.push("strange_crystal");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.crystal"));
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "liquid_pain") {
                this.inventory.push("liquid_pain");
                this.player.stamina = Math.max(0.05, this.player.stamina - 0.15);
                if (!this.cheatLife) this.sanity = Math.max(0.0, this.sanity - 0.12);
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.pain"));
                }
                unlockAchievement("pain_survivor");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "diary_page") {
                this.inventory.push("diary_page");
                if (this.onHUDNotification) {
                  this.onHUDNotification(t("eng.diary"));
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
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
        const canBeCaught = !this.isDead;

        this.entities.forEach(entity => {
          if (aiTargets) {
            // Hunt whichever explorer is closest (on Level G, visible ones first).
            const { target, distSq: entityDistSq } = this.level === 4
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
            console.warn(`[GameEngine] Explorer CAUGHT by ${entity.type}! Reseting state...`);
          }
        });

        this.updateMonsterAudio(delta);

        // Being caught is fatal: the monster got you. You spectate until the
        // group advances a level (or, if everyone is dead, resets).
        if (caught && !this.cheatLife) this.die("caught");
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
        if (!isFlashlightOn && this.level !== LOBBY_LEVEL) {
          if (this.map.globalEventState === "blackout") {
            darknessDepletion = 0.014; // completed blackout is terrifying (retuned ~3x slower)
          } else if (this.level === 8) {
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
          this.sanity = Math.max(0.0, this.sanity - (monsterDepletionSum + darknessDepletion) * SANITY_DRAIN_SCALE * delta);
        } else if (darknessDepletion > 0) {
          this.sanity = Math.max(0.0, this.sanity - darknessDepletion * SANITY_DRAIN_SCALE * delta);
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
          this.onSecretLevelFound(3);
        }
      }

      // Level 0's secret office door: stepping into the dark nook behind it
      // takes you to Level G — a solo detour, like Lights Out.
      if (this.level === 0 && this.map && this.map.officeDoorX >= 0 && this.onSecretLevelFound) {
        const pgX = Math.floor(this.player.position.x / this.map.cellSize);
        const pgZ = Math.floor(this.player.position.z / this.map.cellSize);
        if (pgX === this.map.officeDoorX && pgZ === this.map.officeDoorZ) {
          this.onSecretLevelFound(4);
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
        if (pgX === this.map.exitGridX && pgZ === this.map.exitGridZ && (this.level !== 8 || this.map.level3GateOpen) && (this.level !== 9 || this.level4DoorOpen)) {
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
      this.map.rollGlobalEvents = this.isWorldAuthority && this.level !== LOBBY_LEVEL;
      const eventBefore = this.map.globalEventState;
      this.map.updateLights(
        delta,
        (dur) => this.audio.triggerHumFlicker(dur),
        (pan, vol) => this.audio.playWaterDrip(pan, vol),
        this.player.position.x,
        this.player.position.z
      );
      const eventNow = this.map.globalEventState;
      if (this.map.rollGlobalEvents && eventBefore === "normal" && eventNow !== "normal") {
        this.sendToServer({ type: "world_event", level: this.level, state: eventNow, duration: this.map.globalEventTimer });
      }

      // Ambient light, fog, and background blackout event state reaction
      if (this.ambientLight) {
        // Per-level values: this runs every frame, so hardcoding Level 0/1
        // here used to override Level 2/3's darker setup from transitionToLevel.
        const atmosphere = levelAtmosphere(this.level);
        // Level 6's day/night cycle overrides its own base (daylight) atmosphere
        // live, rather than going through levelAtmosphere (which only knows the
        // level id, not this runtime cycle state).
        const isLevel6Night = this.level === 6 && this.level6IsNight;
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
        if (this.level === 4 && this.levelGAlarm) {
          const pulse = 0.5 + 0.5 * Math.sin(this.totalPlayTime * 6.5);
          this.ambientLight.color.setHex(0xff2a1a);
          this.ambientLight.intensity = 0.2 + 0.6 * pulse;
          const alarmFog = pulse > 0.5 ? 0x2a0504 : 0x0d0202;
          if (fog) fog.color.setHex(alarmFog);
          background.setHex(alarmFog);
        }
      }

      // Local spotlight updating with probability-based flickering when sanity is below 40%
      if (this.player.isFlashlightOn) {
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

      // Torso (Main bodysuit body)
      const bodyGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.9, 8);
      const body = new THREE.Mesh(bodyGeo, suitMat);
      body.position.set(0, 0.75, 0);
      group.add(body);

      // Breathing Apparatus Back Oxygen Tank
      const tankGeo = new THREE.BoxGeometry(0.35, 0.65, 0.18);
      const tank = new THREE.Mesh(tankGeo, suitMat);
      tank.position.set(0, 0.78, -0.18);
      group.add(tank);

      // Belt
      const beltGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8);
      const belt = new THREE.Mesh(beltGeo, darkMat);
      belt.position.set(0, 0.45, 0);
      group.add(belt);

      // Head (Suit Hood helmet sphere)
      const headGeo = new THREE.SphereGeometry(0.2, 10, 10);
      // Everything on the head hangs off a pivot at the neck so the whole head
      // (helmet, visor, drawn face) tilts up/down with where the player looks.
      const headPivot = new THREE.Group();
      headPivot.name = "head";
      headPivot.position.set(0, 1.3, 0);
      group.add(headPivot);
      const head = new THREE.Mesh(headGeo, suitMat);
      headPivot.add(head);

      // Distinctive Level 0 reflective Visor Mask — skipped when the player has
      // drawn a custom face, so the drawing shows through the hood opening
      // instead of sitting behind a dark glass plate.
      if (!hasFace(face)) {
        const visorGeo = new THREE.BoxGeometry(0.22, 0.1, 0.12);
        const visor = new THREE.Mesh(visorGeo, visorMat);
        // Face the positive Z direction as default orientation
        visor.position.set(0, 0.03, 0.14);
        headPivot.add(visor);
      }

      // Visual shoulders
      const lLegGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.45, 6);

      // Left Leg
      const lLeg = new THREE.Mesh(lLegGeo, suitMat);
      lLeg.name = "lLeg";
      lLeg.position.set(-0.11, 0.225, 0);
      group.add(lLeg);

      // Right Leg
      const rLeg = new THREE.Mesh(lLegGeo, suitMat);
      rLeg.name = "rLeg";
      rLeg.position.set(0.11, 0.225, 0);
      group.add(rLeg);

      // Boot soles
      const bootGeo = new THREE.BoxGeometry(0.1, 0.06, 0.16);
      const lBoot = new THREE.Mesh(bootGeo, darkMat);
      lBoot.position.set(-0.11, 0.03, 0.03);
      group.add(lBoot);

      const rBoot = new THREE.Mesh(bootGeo, darkMat);
      rBoot.position.set(0.11, 0.03, 0.03);
      group.add(rBoot);

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
      this.audio.playMonsterSound(e.type, alertNow, vol, pan);
      e.voiceTimer = alertNow ? 1.6 + Math.random() * 2.2 : 4 + Math.random() * 6;
    }
  }

  // ---------------------------------------------------------------------------
  // Death and spectating
  // ---------------------------------------------------------------------------

  /** Dead explorers spectate a living teammate (first-person) until the room revives everyone. */
  public isDead = false;
  private noclipDwell = 0;

  // ---------------------------------------------------------------------------
  // Room lobby (soccer field)
  // ---------------------------------------------------------------------------

  private lobby: Lobby | null = null;
  private lobbySendTimer = 0;

  /** (Re)builds the lobby props when the current level is the lobby; tears them down otherwise. */
  private setupLobby() {
    if (this.lobby) { this.lobby.dispose(this.scene); this.lobby = null; }
    if (this.level === LOBBY_LEVEL) {
      this.lobby = new Lobby(this.scene);
    }
  }

  private updateLobby(delta: number) {
    if (!this.lobby || !this.player) return;
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

  private die(cause: "sanity" | "caught") {
    if (this.isDead || this.cheatLife) return;
    this.isDead = true;
    this.player.isFlashlightOn = false;
    this.player.state = "idle";
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.audio.playEntityCatchSound();
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
  public removeRemotePlayer(id: string) {
    const group = this.remotePlayerGroups.get(id);
    if (group) {
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

        // Head follows the look pitch (the model faces +Z, so looking up tilts back: -x)
        const headPivot = group.getObjectByName("head");
        if (headPivot) {
          const targetTilt = -THREE.MathUtils.clamp(pitch, -1.2, 1.2);
          headPivot.rotation.x += (targetTilt - headPivot.rotation.x) * Math.min(1, 15 * delta);
        }

        // Bobbing legs representation for walking/running
        const state = anyG.animState || 'idle';
        if (state === 'walking' || state === 'running') {
          const pace = state === 'running' ? 18 : 10;
          const amplitude = state === 'running' ? 0.22 : 0.12;
          const swing = Math.sin(this.totalPlayTime * pace);

          const lLeg = group.getObjectByName("lLeg");
          const rLeg = group.getObjectByName("rLeg");
          if (lLeg && rLeg) {
            lLeg.rotation.x = swing * amplitude;
            rLeg.rotation.x = -swing * amplitude;
          }
        } else {
          const lLeg = group.getObjectByName("lLeg");
          const rLeg = group.getObjectByName("rLeg");
          if (lLeg && rLeg) {
            lLeg.rotation.x *= 0.85; // return to idle
            rLeg.rotation.x *= 0.85;
          }
        }
      }
    });
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
    this.level = level;
    
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
    
    const atmosphere = levelAtmosphere(level);
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

    // 5. Update audio settings with new level selection to change background ambient hums/gains
    this.audio.level = level;
    this.audio.startFluorescentHum(); // start appropriate level hum / warehouse boiler hum
    
    // 6. Spawn the player again safely at spawn coordinates (2,2) with preloaded map
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, (speed) => {
      const isWet = this.map ? this.map.isCellWet(this.player.position.x, this.player.position.z) : false;
      this.audio.playFootstep(speed, 0.0, isWet);
      this.noiseBus.emit(this.player.position.x, this.player.position.z, footstepLoudness(speed), "footstep", this.totalPlayTime);
    });
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();
    this.applyCheatsToPlayer();
    this.player.mapFullyLoaded = false; // start with map loading animation!
    this.revive();
    this.setupLobby();

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
    if (level === 4) {
      this.spawnLevelGEntities();
      this.onHUDNotification?.(t("eng.levelG"));
    }

    // Level 6: fresh day/night cycle, no leftover night hunter.
    this.level6Time = 0;
    this.level6IsNight = false;
    this.ceifadorEntity = null; // already pooled by the blanket entities.forEach(returnToPool) above

    // Level 7: fresh valve state (the new map's own toxicWaterCells already
    // starts populated from its own carve — see ProceduralMap.carveLevel7).
    this.valvesTurned.clear();

    // Spawn multiple chasing entities on Level 2 (Pipe Dreams), placed at
    // the same S-shaped key joints/corridor points the level's always used.
    if (level === 2) {
      const def2 = LEVEL_DEFS[2];
      if (def2.spawn.kind === "static") {
        this.spawnStaticRoster(def2.spawn.roster, 8);
      }
    }

    if (level === 8) {
      const def3 = LEVEL_DEFS[8];
      if (def3.spawn.kind === "static") this.spawnStaticRoster(def3.spawn.roster, 8);
    }

    // Level 7 (Dark Poolrooms): CLUMP + O Vigia.
    if (level === 7) {
      const def7 = LEVEL_DEFS[7];
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
    this.nearTerminal = false;
    this.audio.stopAlarm();
    this.emitLevelGProgress();
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
    if (this.level !== 4 || !this.map || !this.player) return;
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

    // --- Taps: the Finger King announces itself as it gets closer (everyone)
    const finger = this.entities.find((e) => e.type === EntityType.FINGER_KING);
    if (finger) {
      const dx = finger.mesh.position.x - this.player.position.x;
      const dz = finger.mesh.position.z - this.player.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const HEAR = 24;
      if (dist < HEAR) {
        this.fingerTapTimer -= delta;
        if (this.fingerTapTimer <= 0) {
          const closeness = 1 - dist / HEAR;
          const chasing = this.levelGAlarm || finger.toNetState().c;
          this.fingerTapTimer = (0.25 + 1.9 * (dist / HEAR)) * (chasing ? 0.6 : 1) * (0.8 + Math.random() * 0.4);
          // Pan from where it is relative to where we're looking
          this.camera.getWorldDirection(this.scratchCamDir);
          this.scratchRight.set(-this.scratchCamDir.z, 0, this.scratchCamDir.x).normalize();
          const pan = dist > 0.01 ? (this.scratchRight.x * dx + this.scratchRight.z * dz) / dist : 0;
          this.audio.playFingerTap(Math.pow(closeness, 1.6), pan);
        }
      } else {
        this.fingerTapTimer = 0;
      }
    }

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
    if (this.level !== 7 || !this.map || !this.player) return -1;
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
   * E, near one of Level 7's 3 valves: turns it. Once all 3 are turned, the
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
    this.turnValve(i);
    this.sendToServer({ type: "valve_turn", level: this.level, index: i });
    return true;
  }

  private turnValve(index: number) {
    if (this.valvesTurned.has(index)) return;
    this.valvesTurned.add(index);
    this.audio.playTerminalBeep(true);
    const total = this.map?.valvePositions.length ?? 3;
    if (this.valvesTurned.size >= total) {
      this.map?.toxicWaterCells.clear();
      this.onHUDNotification?.(t("eng.valveAllTurned"));
      unlockAchievement("valves_drained");
    } else {
      this.onHUDNotification?.(t("eng.valveTurn", { n: this.valvesTurned.size, total }));
    }
  }

  /** A teammate turned a valve (relayed by the server — see server.ts's "valve_turn" handler). */
  public handleValveTurn(index: number) {
    if (this.level !== 7) return;
    this.turnValve(index);
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
      if (this.nearExitDesk()) {
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
      }
    }
    if (text !== this.lastInteractPrompt) {
      this.lastInteractPrompt = text;
      this.onInteractPrompt?.(text);
    }
  }

  /** Within arm's reach of the desk that holds the exit paper (Levels 0 and 1). */
  private nearExitDesk(): boolean {
    if (!this.map || !this.player || this.map.exitDeskX < 0) return false;
    const dx = this.player.position.x - this.map.exitDeskX;
    const dz = this.player.position.z - this.map.exitDeskZ;
    return dx * dx + dz * dz < 2.2 * 2.2;
  }

  private nearUntouchedLevel3Switch(): number {
    if (this.level !== 8 || !this.map || !this.player) return -1;
    for (let i = 0; i < this.map.level3Switches.length; i++) {
      if (this.map.level3SwitchesOn.has(i)) continue;
      const [gx, gz] = this.map.level3Switches[i];
      const dx = this.player.position.x - (gx * this.map.cellSize + this.map.cellSize / 2);
      const dz = this.player.position.z - (gz * this.map.cellSize + this.map.cellSize / 2);
      if (dx * dx + dz * dz < 2.5 * 2.5) return i;
    }
    return -1;
  }

  private nearMegEmployee(): { name: string; grade: string; dialogue: string } | null {
    if (this.level !== 9 || !this.map || !this.player) return null;
    const cs = this.map.cellSize;
    return this.map.level4Employees.find((employee) => {
      const dx = this.player.position.x - (employee.gx * cs + cs / 2);
      const dz = this.player.position.z - (employee.gz * cs + cs / 2);
      return dx * dx + dz * dz < 3.0 * 3.0;
    }) ?? null;
  }

  private nearMegDoor(): boolean {
    if (this.level !== 9 || !this.map || !this.player) return false;
    const cs = this.map.cellSize;
    const dx = this.player.position.x - (this.map.level4DoorX * cs + cs / 2);
    const dz = this.player.position.z - (this.map.level4DoorZ * cs + cs / 2);
    return dx * dx + dz * dz < 3.2 * 3.2;
  }

  public handleLevel3Switch(index: number) {
    if (this.level !== 8 || !this.map || index < 0 || index >= this.map.level3Switches.length) return;
    this.map.level3SwitchesOn.add(index);
    this.map.updateLevel3SwitchVisual(index);
    if (this.map.level3SwitchesOn.size >= 5) {
      this.map.level3GateOpen = true;
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
  public tryInteract(): "terminal" | "paper" | "cheat" | "meg_employee" | "meg_door" | null {
    if (this.isDead) return null;
    const switchIndex = this.nearUntouchedLevel3Switch();
    if (switchIndex >= 0) {
      this.handleLevel3Switch(switchIndex);
      this.sendToServer({ type: "brick_office_switch", level: 8, index: switchIndex });
      return null;
    }
    const employee = this.nearMegEmployee();
    if (employee) {
      this.onMegDialogue?.(employee);
      return "meg_employee";
    }
    if (this.nearMegDoor()) {
      this.onMegDoorRequest?.();
      return "meg_door";
    }
    if (this.nearExitDesk()) return "paper";
    if (this.nearCheatTerminal()) return "cheat";
    if (this.level !== 4 || !this.map || !this.player || this.map.levelGTerminalX < 0) return null;
    const cs = this.map.cellSize;
    const dx = this.player.position.x - (this.map.levelGTerminalX * cs + cs / 2);
    const dz = this.player.position.z - (this.map.levelGTerminalZ * cs + cs / 2);
    return dx * dx + dz * dz < 2.4 * 2.4 ? "terminal" : null;
  }

  public submitMegDoorNames(raw: string): boolean {
    if (this.level !== 9 || !this.map) return false;
    const names = raw.split(",").map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
    const expected = [...this.map.level4Employees]
      .sort((a, b) => ({ senior: 0, pleno: 1, junior: 2 }[a.grade] - { senior: 0, pleno: 1, junior: 2 }[b.grade]))
      .map((employee) => employee.name.toLocaleLowerCase());
    const ok = names.length === expected.length && names.every((name, index) => name === expected[index]);
    if (ok) {
      this.level4DoorOpen = true;
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
    if (this.level !== 4 || !this.map) return false;
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
    if (msg.level !== 4 || this.level !== 4 || !this.isWorldAuthority) return;
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
   * Checks a code typed into the lobby's cheat terminal. MVJM, UHUM, and LIFE unlock
   * their effect immediately (re-entering an already-unlocked code just
   * confirms it, never toggles it off); CLIP unlocks holding V to phase
   * through walls; SKIN sets nothing by itself — it tells the caller to open
   * the monster picker (see applySkinCheat).
   */
  public submitCheatCode(code: string): "speed" | "stamina" | "clip" | "life" | "skin" | "room" | null {
    const c = code.trim().toUpperCase();
    if (c === "MVJM") {
      this.cheatSpeed = true;
      this.player.speedCheat = true;
      return "speed";
    }
    if (c === "UHUM") {
      this.cheatStamina = true;
      this.player.infiniteStaminaCheat = true;
      return "stamina";
    }
    if (c === "CLIP") {
      this.cheatClip = true;
      this.player.clipCheat = true;
      return "clip";
    }
    if (c === "LIFE") {
      this.cheatLife = true;
      this.sanity = 1.0;
      return "life";
    }
    if (c === "SKIN") return "skin";
    if (c === "ROOM") return "room";
    return null;
  }

  /** Sets (or, with null, clears) the SKIN cheat's monster body; replicated to teammates on the next network tick. */
  public applySkinCheat(type: EntityType | null) {
    this.cheatSkin = type && MONSTER_SKIN_TYPES.includes(type) ? type : null;
  }

  /**
   * The final chase: tubes flicker, the ambience turns to a klaxon, the
   * emergency door unlocks and the Finger King is released behind you.
   * `broadcast`: whether this call originates the alarm (vs. replaying one).
   */
  private startLevelGAlarm(broadcast: boolean) {
    if (this.levelGAlarm || this.level !== 4 || !this.map) return;
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
        if (this.level === 3 && this.onHUDNotification) {
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
    const def = LEVEL_DEFS[3];
    // Authority only (targets is null elsewhere): the summoned stalkers reach
    // everyone else on the level through the replicated stream.
    if (this.level !== 3 || !this.player || !this.map || !targets || def.spawn.kind !== "timedSummon") {
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
    const def = LEVEL_DEFS[3];
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
      const level6Night = this.level === 6 && this.level6IsNight;
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
        if (!this.cheatLife) this.sanity = Math.max(0.0, this.sanity - drainRate * delta);
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
    if (this.level !== 6 || !this.map || !this.player) return;
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
   * Consumes/uses an item from the inventory.
   */
  public useInventoryItem(itemId: string) {
    const idx = this.inventory.indexOf(itemId);
    if (idx === -1) return;

    // Remove one instance of the item
    this.inventory.splice(idx, 1);

    if (itemId === "almond_water") {
      this.sanity = Math.min(1.0, this.sanity + 0.20);
      if (this.player) {
        this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 0.15); // restores physical stamina too
      }
      
      // Play healing sound effect via AudioManager
      if (this.audio) {
        this.audio.playGlitchNoclipSound();
      }
      
      if (this.onHUDNotification) {
        this.onHUDNotification(t("eng.almondUsed"));
      }

      unlockAchievement("restored_mind");
    }

    if (this.onInventoryChange) {
      this.onInventoryChange([...this.inventory]);
    }
    if (this.onSanityChange) {
      this.onSanityChange(this.sanity);
    }
  }

  /**
   * Halts loop, untethers document/canvas events, and purges WebGL memory stacks.
   */
  public destroy() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.voip.dispose();

    this.clearAllSmilers();
    if (this.smilerTexture) {
      this.smilerTexture.dispose();
      this.smilerTexture = null;
    }

    this.entities.forEach(entity => entity.returnToPool(this.scene));
    this.entities = [];
    if (this.lobby) { this.lobby.dispose(this.scene); this.lobby = null; }

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
