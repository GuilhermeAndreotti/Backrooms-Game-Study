/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { ProceduralMap } from "./ProceduralMap";
import { PlayerController } from "./PlayerController";
import { AudioManager } from "./AudioManager";
import { WanderingEntity, EntityType } from "./WanderingEntity";
import { GameSettings, RemotePlayer } from "../types/game";
import { unlockAchievement } from "../utils/achievements";
import { LightPool } from "./LightPool";
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
  onRedRoomExposureChange?: (val: number) => void;
  onHUDNotification?: (msg: string) => void;
  onSectorChange?: (sector: string) => void;
  onInventoryChange?: (items: string[]) => void;
  onSanityChange?: (val: number) => void;
  onScrapOfNoteCollected?: (seed: number) => void;
  /** Smoothed FPS and current render scale, emitted about twice a second. */
  onPerformanceSample?: (fps: number, renderScale: number) => void;
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
  public smilers: { mesh: THREE.Mesh; gridX: number; gridZ: number; spawnTime: number }[] = [];
  private smilerSpawnCheckTimer = 0;
  
  // Exposure timer in the mysterious Level 0 Red Rooms (60 seconds to collapse)
  public redRoomExposure = 0;

  // Wandering Stalker Entities (multiple types spawn on Level 1)
  public entities: WanderingEntity[] = [];

  public get wanderingEntity(): WanderingEntity | null {
    return this.entities[0] || null;
  }

  // UI callbacks
  private onStaminaChange: (val: number) => void;
  private onStateChange: (state: string) => void;
  private onFlashlightChange: (state: boolean) => void;
  private onEscapeTrigger?: () => void;
  private onRedRoomExposureChange?: (val: number) => void;
  public onHUDNotification?: (msg: string) => void;
  public onSectorChange?: (sector: string) => void;
  public onInventoryChange?: (items: string[]) => void;
  private onSanityChange?: (val: number) => void;
  public onScrapOfNoteCollected?: (seed: number) => void;
  private onPerformanceSample?: (fps: number, renderScale: number) => void;

  // Sanity system
  public sanity = 1.0;
  private lastReportedSanity = 1.0;

  public currentSector = "";
  public inventory: string[] = [];
  private lastLockNotificationTime = 0;

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
    this.onRedRoomExposureChange = callbacks.onRedRoomExposureChange;
    this.onHUDNotification = callbacks.onHUDNotification;
    this.onSectorChange = callbacks.onSectorChange;
    this.onInventoryChange = callbacks.onInventoryChange;
    this.onSanityChange = callbacks.onSanityChange;
    this.onScrapOfNoteCollected = callbacks.onScrapOfNoteCollected;
    this.onPerformanceSample = callbacks.onPerformanceSample;

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
    const authored = level === 2 ? 0.045 : (level === 1 ? 0.020 : 0.024);
    const referenceViewDistance = 24;
    const ratio = referenceViewDistance / Math.max(1, this.quality.viewDistance);
    return authored * ratio;
  }

  private initWorld(seed: number, settings: GameSettings) {
    // Configure background fog based on level (brighter, clearer, lower density on Level 0 and Level 1)
    const fogColor = this.level === 1 ? 0x8a9299 : 0xede4c0;
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, this.fogDensityFor(this.level));

    // Soft overhead ambient glow (brighter light values for supreme clarity and navigation ease)
    const ambientColor = this.level === 1 ? 0xaab5bd : 0xeae2c2;
    const ambientInt = this.level === 1 ? 1.35 : 1.05;
    this.ambientLight = new THREE.AmbientLight(ambientColor, ambientInt);
    this.scene.add(this.ambientLight);

    // Pass level to both map and audio
    this.audio.level = this.level;
    this.audio.startFluorescentHum();

    // Instantiate Procedural Level 0 or 1 Map
    this.map = new ProceduralMap(seed, this.level, this.quality);

    // Fixed pool of real point lights shared by every lamp in the level.
    this.lightPool = new LightPool(this.scene, this.quality.lightBudget, this.quality.lightRange);

    // Pre-create/load the entire proximity map meshes before placing/spawning the player
    const spawnX = 2 * this.map.cellSize + this.map.cellSize / 2;
    const spawnZ = 2 * this.map.cellSize + this.map.cellSize / 2;
    this.map.performProximityCulling(this.scene, spawnX, spawnZ, true);

    // Local Footstep triggers
    const triggerAudioFootstep = (speed: 'walk' | 'run' | 'crouch') => {
      const isWet = this.map ? this.map.isCellWet(this.player.position.x, this.player.position.z) : false;
      this.audio.playFootstep(speed, 0.0, isWet); // panning 0.0 for self
    };

    // Instantiate Player movement controller after map is pre-loaded
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, triggerAudioFootstep);
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();

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

    // Instantiate multiple official Wandering Entities on Level 1
    if (this.level === 1) {
      this.entities = [];
      const types = [
        EntityType.HOUND,
        EntityType.DULLER,
        EntityType.CLUMP,
        EntityType.SKIN_STEALER,
        EntityType.WRETCH
      ];
      
      const targetQuads = [
        [41, 41],
        [15, 40],
        [40, 15],
        [24, 24],
        [32, 32]
      ];

      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const [qx, qz] = targetQuads[i];
        
        let entGX = qx;
        let entGZ = qz;
        let found = false;
        
        for (let r = 0; r < 12 && !found; r++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            for (let dz = -r; dz <= r && !found; dz++) {
              const nx = qx + dx;
              const nz = qz + dz;
              if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
                if (this.map.grid[nx][nz] !== 0) {
                  entGX = nx;
                  entGZ = nz;
                  found = true;
                }
              }
            }
          }
        }
        
        const entity = WanderingEntity.getOrCreate(this.map, entGX, entGZ, type, this.scene);
        this.entities.push(entity);
        console.log(`[GameEngine] ${type} spawned at grid (${entGX}, ${entGZ})`);
      }
    } else {
      this.entities = [];
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
      this.player.update(delta);

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
          this.entities.forEach(ent => {
            ent.relocateFarAway(playerGX, playerGZ);
          });

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

      // Track Level Sector transitions and collectible pickups
      if (this.map && this.player) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const gx = Math.floor(px / this.map.cellSize);
        const gz = Math.floor(pz / this.map.cellSize);

        // 1. Sector Identification and Notification (Level 1 only)
        if (this.level === 1) {
          let sec = "";
          if (gx >= 18 && gx <= 30 && gz >= 18 && gz <= 30) {
            sec = "Construction Sector";
          } else if (gx < 24 && gz < 24) {
            sec = "Aquila Sector";
          } else if (gx >= 24 && gz < 24) {
            sec = "Gild Sector";
          } else if (gx < 24 && gz >= 24) {
            sec = "Crate Warehouse";
          } else {
            sec = "Gothic Sector";
          }

          if (sec && sec !== this.currentSector) {
            const oldSector = this.currentSector;
            this.currentSector = sec;
            if (this.onSectorChange) {
              this.onSectorChange(sec);
            }
            if (oldSector && this.onHUDNotification) {
              this.onHUDNotification(`ENTERING ${sec.toUpperCase()}`);
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
                  this.onHUDNotification("ALMOND WATER COLLECTED: Added to Inventory");
                }
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "energy_bar") {
                this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 0.25);
                this.sanity = Math.min(1.0, this.sanity + 0.15);
                if (this.onHUDNotification) {
                  this.onHUDNotification("ENERGY BAR COLLECTED: +25% Stamina, +15% Sanity");
                }
              } else if (item.type === "old_photo") {
                this.inventory.push("old_photo");
                if (this.onHUDNotification) {
                  this.onHUDNotification("OLD PHOTO COLLECTED: Faded Memory added to Inventory");
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "rusty_key") {
                this.inventory.push("rusty_key");
                if (this.onHUDNotification) {
                  this.onHUDNotification("RUSTY KEY COLLECTED: Heavy Iron Key added to Inventory");
                }
                unlockAchievement("key_finder");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "cassette_tape") {
                this.inventory.push("cassette_tape");
                if (this.onHUDNotification) {
                  this.onHUDNotification("CASSETTE TAPE COLLECTED: Fita Gravada adicionada ao Inventário");
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "strange_crystal") {
                this.inventory.push("strange_crystal");
                if (this.onHUDNotification) {
                  this.onHUDNotification("STRANGE CRYSTAL COLLECTED: Cristal Luminescente no Inventário");
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "liquid_pain") {
                this.inventory.push("liquid_pain");
                this.player.stamina = Math.max(0.05, this.player.stamina - 0.15);
                this.sanity = Math.max(0.0, this.sanity - 0.12);
                if (this.onHUDNotification) {
                  this.onHUDNotification("DOR LÍQUIDA COLETADA: Queimação severa! Stamina -15%, Sanidade -12%");
                }
                unlockAchievement("pain_survivor");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "diary_page") {
                this.inventory.push("diary_page");
                if (this.onHUDNotification) {
                  this.onHUDNotification("DIARY PAGE COLLECTED: Notas de Explorador no Inventário");
                }
                unlockAchievement("collector_extraordinary");
                if (this.onInventoryChange) {
                  this.onInventoryChange([...this.inventory]);
                }
              } else if (item.type === "scrap_of_note") {
                if (this.onHUDNotification) {
                  this.onHUDNotification("SCRAP OF NOTE COLLECTED: Fragmento de Relatório Encontrado!");
                }
                if (this.onScrapOfNoteCollected) {
                  const noteSeed = Math.floor(Math.abs(item.x * 313 + item.z * 719) % 100000) || Math.floor(Math.random() * 100000);
                  this.onScrapOfNoteCollected(noteSeed);
                }
              }
            }
          }
        });
      }

      // Update stamina-based procedural breath and heart-rate audio sweeps
      this.audio.updateBreathing(this.player.stamina, delta, this.sanity);

      // Update Wandering Stalker Entities (multi-entity ecosystem)
      if (this.entities.length > 0 && this.player) {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const pState = this.player.state;
        const pFlashlight = this.player.isFlashlightOn;

        const camDir = this.scratchCamDir;
        this.camera.getWorldDirection(camDir);

        this.entities.forEach(entity => {
          // Entities far outside the fog are simulated at a reduced rate: their
          // AI still runs, just not 60 times a second for something invisible.
          const edx = entity.mesh.position.x - px;
          const edz = entity.mesh.position.z - pz;
          const entityDistSq = edx * edx + edz * edz;
          if (entityDistSq > 1600 && (this.frameCounter & 3) !== 0) { // beyond 40m
            return;
          }
          const entityDelta = entityDistSq > 1600 ? delta * 4 : delta;

          entity.update(entityDelta, px, pz, pState, camDir, pFlashlight);

          // Check if player gets too close to trigger reset state!
          const dx = entity.mesh.position.x - px;
          const dz = entity.mesh.position.z - pz;
          const distSq = dx * dx + dz * dz;

          // Trigger reset when distance is less than 1.45 meters (squared is ~2.1)
          if (distSq < 2.1) {
            console.warn(`[GameEngine] Explorer CAUGHT by ${entity.type}! Reseting state...`);
            
            // Sound effect!
            this.audio.playEntityCatchSound();

            // Reset player parameters cleanly
            this.player.spawnSafely();

            // Relocate ALL entities far away to give the player a fresh starting chance
            const playerGX = Math.floor(this.player.position.x / this.map.cellSize);
            const playerGZ = Math.floor(this.player.position.z / this.map.cellSize);
            
            this.entities.forEach(ent => {
              ent.relocateFarAway(playerGX, playerGZ);
            });

            // Force a full map culling update instantly
            this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z, true);
          }
        });
      }

      // Update psychological Smilers
      this.updateSmilers(delta);

      // Sanity system depletion & recovery calculation
      if (this.player && this.map) {
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
            monsterDepletionSum += (8.0 - dist) * 0.022; // closer = faster (slower depletion coefficient)
          }
        });

        // 2. Distance check to active smilers
        this.smilers.forEach(s => {
          const dx = s.mesh.position.x - px;
          const dz = s.mesh.position.z - pz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 6.0) {
            nearMonster = true;
            monsterDepletionSum += (6.0 - dist) * 0.03; // slower depletion coefficient
          }
        });

        // 3. Darkness check
        let darknessDepletion = 0;
        const isFlashlightOn = this.player.isFlashlightOn;
        if (!isFlashlightOn) {
          if (this.map.globalEventState === "blackout") {
            darknessDepletion = 0.038; // completed blackout is terrifying (slower depletion coefficient)
          } else if (this.level === 1 || this.level === 2) {
            darknessDepletion = 0.02; // dark industrial environments (slower depletion coefficient)
          } else {
            darknessDepletion = 0.006; // normal level 0 with fluorescent lights on but flashlight off (slower depletion coefficient)
          }
        }

        // Apply depletion or recovery
        if (nearMonster) {
          this.sanity = Math.max(0.0, this.sanity - (monsterDepletionSum + darknessDepletion) * delta);
        } else if (darknessDepletion > 0) {
          this.sanity = Math.max(0.0, this.sanity - darknessDepletion * delta);
        } else {
          // Recover sanity in normal illuminated space
          this.sanity = Math.min(1.0, this.sanity + 0.018 * delta);
        }
      }

      // Check if player is near the escape exit door and jumping against the glitching wall
      if (this.map && (this.map.exitGridX !== 0 || this.map.exitGridZ !== 0)) {
        const pgX = Math.floor(this.player.position.x / this.map.cellSize);
        const pgZ = Math.floor(this.player.position.z / this.map.cellSize);

        if (pgX === this.map.exitGridX && pgZ === this.map.exitGridZ) {
          // Player is in the instability cell!
          if (this.level === 1 || this.level === 2) {
            // Direct entry transition! No blocking wall!
            this.audio.playGlitchNoclipSound();
            if (this.onEscapeTrigger) {
              this.onEscapeTrigger();
            }
          } else {
            // Every time they press space (jumps increase), flicker the ambient buzz slightly
            if (this.player.spacePressCount > 0 && Math.random() < 0.28) {
              this.audio.triggerHumFlicker(80);
            }

            // Must register 6 space jumps inside the cell while pushing against boundary to trigger noclip
            if (this.player.spacePressCount >= 6) {
              this.player.spacePressCount = 0; // reset
              this.audio.playGlitchNoclipSound();
              if (this.onEscapeTrigger) {
                this.onEscapeTrigger();
              }
            }
          }
        } else {
          // If they leave the exit cell, reset jump streak
          this.player.spacePressCount = 0;
        }
      }

      // Dyn-Culling map optimization ticks (run less frequently to save core cycles)
      this.map.performProximityCulling(this.scene, this.player.position.x, this.player.position.z);

      // Bind the fixed light pool to the lamps nearest the player. The scene's
      // visible light count never changes, so materials are never recompiled.
      this.lightPool.update(this.map.dynamicLights, this.player.position.x, this.player.position.z, delta);

      // Flickering fluorescent tubes ticks
      this.map.updateLights(
        delta,
        (dur) => this.audio.triggerHumFlicker(dur),
        (pan, vol) => this.audio.playWaterDrip(pan, vol),
        this.player.position.x,
        this.player.position.z
      );

      // Ambient light, fog, and background blackout event state reaction
      if (this.ambientLight) {
        const baseInt = this.level === 1 ? 1.35 : 1.05;
        const defaultFog = this.level === 1 ? 0x8a9299 : 0xede4c0;
        
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

          const dimmedFog = this.level === 1 ? 0x24282c : 0x5c5740;
          const currentFogColor = flashOn ? defaultFog : dimmedFog;
          if (fog) fog.color.setHex(currentFogColor);
          background.setHex(currentFogColor);
        } else {
          // Reset to normal intensity and color
          this.ambientLight.intensity = baseInt;
          if (fog) fog.color.setHex(defaultFog);
          background.setHex(defaultFog);
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

      const diffSanity = Math.abs(this.sanity - this.lastReportedSanity);
      if (diffSanity > 0.012 || (this.sanity <= 0.01 && this.lastReportedSanity > 0.01) || (this.sanity >= 0.99 && this.lastReportedSanity < 0.99)) {
        if (this.onSanityChange) {
          this.onSanityChange(this.sanity);
        }
        this.lastReportedSanity = this.sanity;
      }

      // Interpolate position/movement animations for Remote Hazmat Explorers
      this.animateRemotePlayers(delta);

      // Update global drifting dust particles wrapped relative to client player
      this.updateGlobalDust(delta);

      // Networking Socket Sync tick rate throttling
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.networkSendTimer += delta;
        if (this.networkSendTimer >= this.networkSendInterval) {
          this.socket.send(JSON.stringify({
            type: "update",
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
            yaw: this.player.rotation.y,
            pitch: this.player.rotation.x,
            flashlight: this.player.isFlashlightOn,
            state: this.player.state,
            level: this.level
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
  private createHazmatExplorer(name: string): THREE.Group {
    const group = new THREE.Group();

    // Yellow Hazmat Fabric Material (flat shading to enhance vintage polygon rendering)
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xdeb81d, roughness: 0.9, metalness: 0.1 });
    
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
    const head = new THREE.Mesh(headGeo, suitMat);
    head.position.set(0, 1.3, 0);
    group.add(head);

    // Distinctive Level 0 reflective Visor Mask
    const visorGeo = new THREE.BoxGeometry(0.22, 0.1, 0.12);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    // Face the positive Z direction as default orientation
    visor.position.set(0, 1.33, 0.14);
    group.add(visor);

    // Visual shoulders
    const lLegGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.45, 6);
    
    // Left Leg
    const lLeg = new THREE.Mesh(lLegGeo, suitMat);
    lLeg.position.set(-0.11, 0.225, 0);
    group.add(lLeg);

    // Right Leg
    const rLeg = new THREE.Mesh(lLegGeo, suitMat);
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

    // Floating UI player tag card setup in 3D Space!
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
   * Spawns a remote explorer visual node and sets up their shoulder spotlight.
   */
  public spawnRemotePlayer(id: string, name: string, x: number, y: number, z: number) {
    if (this.remotePlayerGroups.has(id)) return;

    // Create Hazmat Group Mesh
    const group = this.createHazmatExplorer(name);
    group.position.set(x, y, z);
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

    const group = this.remotePlayerGroups.get(id);
    if (!group) {
      this.spawnRemotePlayer(id, update.name, update.x, update.y, update.z);
      return;
    }

    // Assign custom attributes into group container for asynchronous lerp integration in game loop
    const anyGroup = group as any;
    anyGroup.targetX = update.x;
    anyGroup.targetY = update.y;
    anyGroup.targetZ = update.z;
    anyGroup.targetYaw = update.yaw;
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

        // Bobbing legs representation for walking/running
        const state = anyG.animState || 'idle';
        if (state === 'walking' || state === 'running') {
          const pace = state === 'running' ? 18 : 10;
          const amplitude = state === 'running' ? 0.22 : 0.12;
          const swing = Math.sin(this.totalPlayTime * pace);

          // Get children (Legs are index 4 and 5 in createHazmatExplorer layout)
          const lLeg = group.children[4];
          const rLeg = group.children[5];
          if (lLeg && rLeg) {
            lLeg.rotation.x = swing * amplitude;
            rLeg.rotation.x = -swing * amplitude;
          }
        } else {
          const lLeg = group.children[4];
          const rLeg = group.children[5];
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
    
    // Level 2 Pipe Dreams: tense dark reddish brown. Level 1 warehouse: brighter industrial. Level 0: classic yellow.
    const ambientColor = level === 2 ? 0x522312 : (level === 1 ? 0xaab5bd : 0xeae2c2);
    const ambientInt = level === 2 ? 0.75 : (level === 1 ? 1.35 : 1.05);
    this.ambientLight = new THREE.AmbientLight(ambientColor, ambientInt);
    this.scene.add(this.ambientLight);
    
    // Adjust psychological fog
    if (this.scene.fog) {
      const fogColor = level === 2 ? 0x240902 : (level === 1 ? 0x8a9299 : 0xede4c0);
      this.scene.background = new THREE.Color(fogColor);
      this.scene.fog = new THREE.FogExp2(fogColor, this.fogDensityFor(level));
    }

    // 4. Instantiate new level's ProceduralMap
    this.map = new ProceduralMap(seed, level, this.quality);
    this.lightPool.invalidate();
    
    // Pre-create/load the entire proximity map meshes before placing/spawning the player
    const spawnX = 2 * this.map.cellSize + this.map.cellSize / 2;
    const spawnZ = 2 * this.map.cellSize + this.map.cellSize / 2;
    this.map.performProximityCulling(this.scene, spawnX, spawnZ, true);

    // 5. Update audio settings with new level selection to change background ambient hums/gains
    this.audio.level = level;
    this.audio.startFluorescentHum(); // start appropriate level hum / warehouse boiler hum
    
    // 6. Spawn the player again safely at spawn coordinates (2,2) with preloaded map
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.map, (speed) => {
      const isWet = this.map ? this.map.isCellWet(this.player.position.x, this.player.position.z) : false;
      this.audio.playFootstep(speed, 0.0, isWet);
    });
    this.player.setMouseSensitivity(settings.mouseSensitivity);
    this.player.spawnSafely();
    this.player.mapFullyLoaded = false; // start with map loading animation!

    // Reset total play time for the new layout
    this.totalPlayTime = 0;
    
    // Clear any active smilers on transition
    this.clearAllSmilers();

    // Return previous Wandering stalkers back to static pool instead of destroying
    this.entities.forEach(entity => entity.returnToPool(this.scene));
    this.entities = [];

    // Spawn new Wandering Stalker Entities on Level 1
    if (level === 1) {
      const types = [
        EntityType.HOUND,
        EntityType.DULLER,
        EntityType.CLUMP,
        EntityType.SKIN_STEALER,
        EntityType.WRETCH
      ];
      
      const targetQuads = [
        [41, 41],
        [15, 40],
        [40, 15],
        [24, 24],
        [32, 32]
      ];

      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const [qx, qz] = targetQuads[i];
        
        let entGX = qx;
        let entGZ = qz;
        let found = false;
        
        for (let r = 0; r < 12 && !found; r++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            for (let dz = -r; dz <= r && !found; dz++) {
              const nx = qx + dx;
              const nz = qz + dz;
              if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
                if (this.map.grid[nx][nz] !== 0) {
                  entGX = nx;
                  entGZ = nz;
                  found = true;
                }
              }
            }
          }
        }
        
        const entity = WanderingEntity.getOrCreate(this.map, entGX, entGZ, type, this.scene);
        this.entities.push(entity);
        console.log(`[GameEngine] ${type} spawned on transition at grid (${entGX}, ${entGZ})`);
      }
    }

    // Spawn multiple chasing entities on Level 2 (Pipe Dreams)
    if (level === 2) {
      const types2 = [
        EntityType.HOUND,
        EntityType.SKIN_STEALER,
        EntityType.WRETCH,
        EntityType.CLUMP,
        EntityType.DULLER,
        EntityType.HOUND,
        EntityType.WRETCH,
        EntityType.SKIN_STEALER,
        EntityType.CLUMP,
        EntityType.HOUND,
        EntityType.WRETCH
      ];

      // Placed at S-shaped key joints/corridor points:
      const targetQuads2 = [
        [2, 7],
        [2, 16],
        [8, 25],
        [18, 25],
        [23, 21],
        [23, 11],
        [29, 5],
        [38, 5],
        [44, 12],
        [44, 24],
        [44, 35]
      ];

      for (let i = 0; i < types2.length; i++) {
        const type = types2[i];
        const [qx, qz] = targetQuads2[i];
        
        let entGX = qx;
        let entGZ = qz;
        let found = false;
        
        // Find adjacent walkable cell
        for (let r = 0; r < 8 && !found; r++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            for (let dz = -r; dz <= r && !found; dz++) {
              const nx = qx + dx;
              const nz = qz + dz;
              if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
                if (this.map.grid[nx][nz] !== 0) { // CORRIDOR is non-zero
                  entGX = nx;
                  entGZ = nz;
                  found = true;
                }
              }
            }
          }
        }
        
        const entity = WanderingEntity.getOrCreate(this.map, entGX, entGZ, type, this.scene);
        this.entities.push(entity);
        console.log(`[GameEngine] Level 2 Escape Chaser ${type} spawned at grid (${entGX}, ${entGZ})`);
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

  private spawnSmiler() {
    if (!this.map || !this.player) return;

    // Find all walkable coordinates 14 to 30 meters away from the explorer
    const hSize = this.map.cellSize;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    
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

    // Place at 1.15m height (chest level)
    const worldX = gx * hSize + hSize / 2;
    const worldZ = gz * hSize + hSize / 2;
    mesh.position.set(worldX, 1.15, worldZ);

    this.scene.add(mesh);
    this.smilers.push({
      mesh,
      gridX: gx,
      gridZ: gz,
      spawnTime: this.totalPlayTime
    });

    console.log(`[Smiler] Spawned creepily at grid (${gx}, ${gz}) - Distance: ${Math.sqrt((worldX - px)**2 + (worldZ - pz)**2).toFixed(1)}m`);
  }

  private clearAllSmilers() {
    this.smilers.forEach((smiler) => {
      this.scene.remove(smiler.mesh);
      if (smiler.mesh.geometry) smiler.mesh.geometry.dispose();
      if (Array.isArray(smiler.mesh.material)) {
        smiler.mesh.material.forEach(m => m.dispose());
      } else if (smiler.mesh.material) {
        smiler.mesh.material.dispose();
      }
    });
    this.smilers = [];
    this.smilerSpawnCheckTimer = 0;
  }

  private updateSmilers(delta: number) {
    if (!this.player || !this.map) return;

    // Level 0 should NOT have entities (Smilers)
    if (this.level !== 1) {
      if (this.smilers.length > 0) {
        this.clearAllSmilers();
      }
      return;
    }

    // Check spawning conditions every 7 seconds on Level 1
    this.smilerSpawnCheckTimer += delta;
    if (this.smilerSpawnCheckTimer >= 7) {
      this.smilerSpawnCheckTimer = 0;
      
      // Support up to 4 active smilers on Level 1 to increase psychological pressure
      if (this.smilers.length < 4) {
        // High 75% chance of spawning check passing
        if (Math.random() < 0.75) {
          this.spawnSmiler();
        }
      }
    }

    const px = this.player.position.x;
    const pz = this.player.position.z;

    // Camera forward vector used for glancing checks
    const camDir = this.scratchCamDir;
    this.camera.getWorldDirection(camDir);

    const activeSmilers: typeof this.smilers = [];

    for (let i = 0; i < this.smilers.length; i++) {
      const smiler = this.smilers[i];
      const mesh = smiler.mesh;

      // 1. Billboard: Turn horizontally to face player head-on (creepy staring!)
      mesh.lookAt(px, mesh.position.y, pz);

      // 2. Vector distance
      const dx = mesh.position.x - px;
      const dz = mesh.position.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // De-spawn silently if player walks past and gets too close (< 4 meters)
      // They vanish or step back, avoiding direct confrontation
      if (dist < 4.0) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
        console.log(`[Smiler] Player got too close to smiler at (${smiler.gridX}, ${smiler.gridZ}). Silently vanished.`);
        continue;
      }

      // De-spawn or clean up if they are very far away (> 42.0m) due to performance / map transitions
      if (dist > 42.0) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
        continue;
      }

      // 3. Glancing check: Did the player look directly at the Smiler?
      const dirToSmiler = new THREE.Vector3().subVectors(mesh.position, this.camera.position).normalize();
      const dot = camDir.dot(dirToSmiler);

      // Look direction dot product > 0.94 represents roughly 20 degrees central field of view
      if (dot > 0.94) {
        // Player locked eyes! They vanish instantly!
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }

        // Psychic interference details: flicker the ambient master hum or flashlight momentarily
        // this triggers genuine paranoia!
        this.audio.triggerHumFlicker(180);
        console.log(`[Smiler] Explorer spotted smiler at (${smiler.gridX}, ${smiler.gridZ})! Vanished and triggered hum feedback.`);
        continue;
      }

      activeSmilers.push(smiler);
    }

    this.smilers = activeSmilers;
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
        this.onHUDNotification("ALMOND WATER CONSUMED: +20% Sanity, +15% Stamina");
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

    this.clearAllSmilers();
    if (this.smilerTexture) {
      this.smilerTexture.dispose();
      this.smilerTexture = null;
    }

    this.entities.forEach(entity => entity.returnToPool(this.scene));
    this.entities = [];

    window.removeEventListener("resize", this.handleResize);
    
    if (this.player) {
      this.player.removeEvents();
    }

    if (this.map) {
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
