/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { ProceduralMap, CellType } from "./ProceduralMap";

export enum EntityType {
  DULLER = "DULLER",
  HOUND = "HOUND",
  CLUMP = "CLUMP",
  SKIN_STEALER = "SKIN_STEALER",
  WRETCH = "WRETCH"
}

export class WanderingEntity {
  // Static registry of inactive entities by type to power zero-allocation object pooling
  private static entityPool: Map<EntityType, WanderingEntity[]> = new Map();

  public mesh: THREE.Mesh;
  public type: EntityType;
  private map: ProceduralMap;
  
  // Grid/logic position
  public gridX: number;
  public gridZ: number;
  public targetGridX: number;
  public targetGridZ: number;
  
  // Movement & timing
  private moveSpeed = 1.3; 
  private transitionProgress = 0.0;
  private isMoving = false;
  private pauseTimer = 0.0;
  
  // Animations and visual states
  private bobTime = 0.0;
  private canvasTexture: THREE.CanvasTexture | null = null;
  private glitchTimer = 0.0;

  // AI-Specific states
  private isAgitated = false; // Used for Skin-Stealer reveal, Wretch spotting, Clump alarm
  private speechBubbleTimer = 0.0;
  private currentSpeechText = "";
  private speechChangeTimer = 0.0;
  private intimidatedTimer = 0.0; // Hound frozen when gazed at
  private chaseTargetX = 0;
  private chaseTargetZ = 0;
  private isChasing = false;

  constructor(map: ProceduralMap, startX: number, startZ: number, type: EntityType) {
    this.map = map;
    this.gridX = startX;
    this.gridZ = startZ;
    this.targetGridX = startX;
    this.targetGridZ = startZ;
    this.type = type;

    // Allocate base speeds
    this.resetBaseSpeed();

    // Create custom aesthetic mesh
    this.mesh = this.createVisualMesh();
    this.syncWorldPosition();
  }

  /**
   * Assigns default speeds based on lore
   */
  private resetBaseSpeed() {
    switch (this.type) {
      case EntityType.DULLER:
        this.moveSpeed = 1.1;
        break;
      case EntityType.HOUND:
        this.moveSpeed = 1.25;
        break;
      case EntityType.CLUMP:
        this.moveSpeed = 1.4;
        break;
      case EntityType.SKIN_STEALER:
        this.moveSpeed = 1.1;
        break;
      case EntityType.WRETCH:
        this.moveSpeed = 1.45;
        break;
    }
  }

  /**
   * Generates custom high-contrast creepy canvas textures for each Backrooms Entity Type
   */
  /** Persistent drawing surface backing {@link canvasTexture}. */
  private canvas: HTMLCanvasElement | null = null;

  private createEntityTexture(): THREE.Texture {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
    }
    const canvas = this.canvas;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 256);

    // Alpha transparent bg
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, 256, 256);

    ctx.save();

    // 1. Draw entity physical figure based on type
    switch (this.type) {
      case EntityType.DULLER: {
        // Humanoid noclip shadow
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#3b82f6"; // Faint blue dimensional echo glow
        
        ctx.strokeStyle = "#080c14";
        ctx.fillStyle = "#0c1220";
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Main skeletal spine
        ctx.beginPath();
        ctx.moveTo(128, 48);
        ctx.lineTo(128, 180);
        ctx.stroke();

        // Limbs in clipping crawling positions
        ctx.lineWidth = 7;
        ctx.beginPath();
        // Arms
        ctx.moveTo(128, 70); ctx.lineTo(75, 100); ctx.lineTo(100, 140);
        ctx.moveTo(128, 70); ctx.lineTo(181, 100); ctx.lineTo(156, 140);
        // Legs
        ctx.moveTo(128, 180); ctx.lineTo(95, 220); ctx.lineTo(70, 250);
        ctx.moveTo(128, 180); ctx.lineTo(161, 220); ctx.lineTo(186, 250);
        ctx.stroke();

        // Featureless head
        ctx.fillStyle = "#05080e";
        ctx.beginPath();
        ctx.arc(128, 32, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#2563eb"; // Cyanish contour lines
        ctx.stroke();
        break;
      }

      case EntityType.HOUND: {
        // Humanoid dog crawling
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#ef4444"; // Aggressive red shadow eye reflection

        // Draw body crouched down low on all fours
        ctx.strokeStyle = "#111111";
        ctx.fillStyle = "#0e0e0e";
        ctx.lineWidth = 10;
        ctx.lineCap = "round";

        // Crawling torso spine
        ctx.beginPath();
        ctx.moveTo(70, 140);
        ctx.quadraticCurveTo(128, 180, 190, 140);
        ctx.stroke();

        // 4 bent dog-like skeletal claws
        ctx.lineWidth = 6;
        ctx.beginPath();
        // Front legs
        ctx.moveTo(70, 140); ctx.lineTo(50, 190); ctx.lineTo(35, 240);
        ctx.moveTo(100, 150); ctx.lineTo(90, 200); ctx.lineTo(75, 245);
        // Rear legs
        ctx.moveTo(160, 155); ctx.lineTo(170, 205); ctx.lineTo(185, 245);
        ctx.moveTo(190, 140); ctx.lineTo(210, 195); ctx.lineTo(225, 240);
        ctx.stroke();

        // Messy heap of dark hair block
        ctx.fillStyle = "#0a0a0a";
        ctx.beginPath();
        ctx.arc(60, 110, 26, 0, Math.PI * 2);
        ctx.fill();

        // Wild messy strands of hair scribbled around the face
        ctx.strokeStyle = "#080808";
        ctx.lineWidth = 2;
        for (let j = 0; j < 35; j++) {
          ctx.beginPath();
          const angle = Math.random() * Math.PI * 2;
          const len = 15 + Math.random() * 20;
          ctx.moveTo(60, 110);
          ctx.lineTo(60 + Math.cos(angle) * len, 110 + Math.sin(angle) * len);
          ctx.stroke();
        }

        // Two glowing yellow/white feral eyes leaking from hair
        ctx.fillStyle = "#fef08a";
        ctx.shadowColor = "#eab308";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(52, 108, 4, 0, Math.PI * 2);
        ctx.arc(68, 108, 4, 0, Math.PI * 2);
        ctx.fill();

        // Terrifying open red jaw below hair with sharp teeth
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#7f1d1d";
        ctx.beginPath();
        ctx.moveTo(48, 122);
        ctx.quadraticCurveTo(60, 142, 72, 122);
        ctx.quadraticCurveTo(60, 118, 48, 122);
        ctx.fill();

        // Dropping white fangs
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        // Upper teeth
        ctx.moveTo(51, 121); ctx.lineTo(54, 127); ctx.lineTo(57, 121);
        ctx.moveTo(63, 121); ctx.lineTo(66, 127); ctx.lineTo(69, 121);
        // Lower teeth
        ctx.moveTo(54, 134); ctx.lineTo(57, 128); ctx.lineTo(60, 134);
        ctx.fill();
        break;
      }

      case EntityType.CLUMP: {
        // Blob of multiple limbs
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#ec4899"; // Fleshy pinkish/purple aura

        const cx = 128;
        const cy = 140;
        
        // Draw fleshy dark central sphere
        ctx.fillStyle = "#1e0b12";
        ctx.strokeStyle = "#3b1220";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Chaos of multiple legs and arms extending out
        ctx.lineWidth = 5.5;
        ctx.strokeStyle = "#2e111a";
        for (let arm = 0; arm < 16; arm++) {
          const angle = (arm / 16) * Math.PI * 2 + Math.random() * 0.2;
          const length = 55 + Math.random() * 30;
          const endX = cx + Math.cos(angle) * length;
          const endY = cy + Math.sin(angle) * length;

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          // Curved segmented arm/leg joint
          const midX = cx + Math.cos(angle + 0.2) * (length * 0.5);
          const midY = cy + Math.sin(angle + 0.2) * (length * 0.5);
          ctx.quadraticCurveTo(midX, midY, endX, endY);
          ctx.stroke();

          // Hand/foot claws at ends
          ctx.fillStyle = "#4a1d2d";
          ctx.beginPath();
          ctx.arc(endX, endY, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Concentric veins inside the clump center
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#9d174d";
        for (let v = 0; v < 8; v++) {
          ctx.beginPath();
          ctx.arc(cx, cy, 10 + v * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }

      case EntityType.SKIN_STEALER: {
        // White humanoid mimicking suit
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#eab308"; // Creepy yellow suit hue

        // Draw jumpsuit torso
        ctx.fillStyle = this.isAgitated ? "#3f320b" : "#b39a3c"; // darker/decayed if angry
        ctx.strokeStyle = "#1a1608";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(128, 150, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Elongated yellow limbs with exposed pale tips
        ctx.lineWidth = 6.5;
        ctx.strokeStyle = this.isAgitated ? "#42350c" : "#b39a3c";
        ctx.beginPath();
        // Arms
        ctx.moveTo(96, 150); ctx.lineTo(40, 170); ctx.lineTo(30, 220); // Left arm extra long
        ctx.moveTo(160, 150); ctx.lineTo(210, 160); ctx.lineTo(225, 210); // Right arm
        // Legs
        ctx.moveTo(110, 178); ctx.lineTo(95, 250);
        ctx.moveTo(146, 178); ctx.lineTo(160, 250);
        ctx.stroke();

        // Exposed pale white hands/claws
        ctx.fillStyle = "#eae6e1";
        ctx.beginPath();
        ctx.arc(30, 220, 6, 0, Math.PI * 2);
        ctx.arc(225, 210, 6, 0, Math.PI * 2);
        ctx.fill();

        // Head with loose skin mask details
        ctx.fillStyle = "#e5e1da"; // Pale-white fleshy tone
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(128, 92, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw creepy sagging yellow hood falling off
        ctx.fillStyle = "#85722b";
        ctx.beginPath();
        ctx.arc(128, 86, 21, Math.PI, 0); // Hood contour
        ctx.fill();

        if (this.isAgitated) {
          // Relentless bloodshot angry face
          ctx.fillStyle = "#7f1d1d"; // Raw red mouth
          ctx.beginPath();
          ctx.arc(128, 97, 7, 0, Math.PI); // Unnatural wide open jaw
          ctx.fill();

          // Bloody claws/tears
          ctx.fillStyle = "#991b1b";
          ctx.beginPath();
          ctx.arc(128, 104, 2, 0, Math.PI * 2);
          ctx.arc(30, 220, 8, 0, Math.PI * 2);
          ctx.fill();

          // Black eye holes with glaring RED light pixels
          ctx.fillStyle = "#0c0a09";
          ctx.beginPath();
          ctx.arc(121, 88, 4.5, 0, Math.PI * 2);
          ctx.arc(135, 88, 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#ef4444";
          ctx.shadowColor = "#ff0000";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(121, 88, 2.2, 0, Math.PI * 2);
          ctx.arc(135, 88, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Normal blank human mask facade
          ctx.fillStyle = "#0c0a09"; // Empty black socket eyes
          ctx.beginPath();
          ctx.arc(121, 88, 3.5, 0, Math.PI * 2);
          ctx.arc(135, 88, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Horizontal blank line grin
          ctx.strokeStyle = "#0d0d0d";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(117, 101);
          ctx.lineTo(139, 101);
          ctx.stroke();
        }
        break;
      }

      case EntityType.WRETCH: {
        // Red, raw skin, decaying aggressive zombie
        ctx.shadowBlur = 9;
        ctx.shadowColor = "#b91c1c"; // Horror-bloody aura

        // Humped body skeletal base
        ctx.strokeStyle = "#450a0a";
        ctx.fillStyle = "#7f1d1d";
        ctx.lineWidth = 11;
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(128, 172);
        ctx.quadraticCurveTo(100, 110, 128, 80); // Humped back shape
        ctx.stroke();

        // Ribs lines exposed
        ctx.strokeStyle = "#fca5a5";
        ctx.lineWidth = 2;
        for (let r = 0; r < 5; r++) {
          ctx.beginPath();
          ctx.moveTo(115, 110 + r * 10);
          ctx.lineTo(135, 112 + r * 10);
          ctx.stroke();
        }

        // Spasm claws and legs
        ctx.lineWidth = 5.5;
        ctx.strokeStyle = "#5f0f0f";
        ctx.beginPath();
        // Right claw reaching out
        ctx.moveTo(120, 95); ctx.lineTo(75, 120); ctx.lineTo(45, 105);
        // Left claw dragging
        ctx.moveTo(125, 105); ctx.lineTo(165, 135); ctx.lineTo(185, 175);
        // Desperate sprinting legs
        ctx.moveTo(120, 170); ctx.lineTo(95, 245);
        ctx.moveTo(132, 170); ctx.lineTo(145, 245);
        ctx.stroke();

        // Screaming mouth skull head
        ctx.fillStyle = "#581c1c"; // decayed blood clot color
        ctx.strokeStyle = "#2d0606";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(128, 56, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Hollow screaming black oval jaw
        ctx.fillStyle = "#020101";
        ctx.beginPath();
        ctx.ellipse(128, 64, 5, 9, 0, 0, Math.PI * 2);
        ctx.fill();

        // Blinking amber eyes
        ctx.fillStyle = "#f59e0b";
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(122, 51, 3.5, 0, Math.PI * 2);
        ctx.arc(134, 51, 3.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }

    ctx.restore();

    // 2. Overlay Radio / Creepy subtitle box inside the texture if speaking! (Centered above the entity's head)
    if (this.currentSpeechText) {
      ctx.save();
      
      const text = this.currentSpeechText;
      ctx.font = "bold 9px Courier New, monospace";
      ctx.textAlign = "center";
      
      const xPos = 128;
      const yPos = 15; // Upper part of texture sits perfectly above its 3D head coordinates
      
      const metrics = ctx.measureText(text);
      const bgW = metrics.width + 12;
      const bgH = 14;

      // Draw high-contrast backing strip
      ctx.fillStyle = "rgba(10, 8, 3, 0.85)";
      ctx.strokeStyle = this.isAgitated ? "#ef4444" : "#a28e3b";
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      ctx.roundRect(xPos - bgW / 2, yPos - bgH / 2, bgW, bgH, 3);
      ctx.fill();
      ctx.stroke();

      // Glow font overlay
      ctx.shadowBlur = 5;
      ctx.shadowColor = this.isAgitated ? "#ef4444" : "#eab308";
      ctx.fillStyle = this.isAgitated ? "#fca5a5" : "#deb81d";
      ctx.fillText(text, xPos, yPos + 3);

      ctx.restore();
    }

    if (!this.canvasTexture) {
      this.canvasTexture = new THREE.CanvasTexture(canvas);
    } else {
      // Same texture object: just re-upload the pixels. Swapping the texture
      // instead would force the material (and its shader) to be revalidated.
      this.canvasTexture.needsUpdate = true;
    }
    return this.canvasTexture;
  }

  private createVisualMesh(): THREE.Mesh {
    const texture = this.createEntityTexture();
    
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      alphaTest: 0.3,
      roughness: 0.9,
      metalness: 0.1
    });

    // 1.6 meters wide, 2.65 meters tall 
    const geometry = new THREE.PlaneGeometry(1.6, 2.65);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Snaps physical world coordinate instantly to corresponding grid cell center
   */
  public syncWorldPosition() {
    const cSize = this.map.cellSize;
    const wx = this.gridX * cSize + cSize / 2;
    const wz = this.gridZ * cSize + cSize / 2;
    
    // Set elevation: Duller hovers slightly floating; Clump/Hound crouch low to ground
    let ey = 1.35;
    if (this.type === EntityType.DULLER) {
      ey = 1.48; // Floating ghostly phantom
    } else if (this.type === EntityType.HOUND) {
      ey = 1.05; // crawling dog
    } else if (this.type === EntityType.CLUMP) {
      ey = 1.12; // ball of tumbling limbs
    }

    this.mesh.position.set(wx, ey, wz);
    
    // If inside a solid wall (Duller clipping), set semi-transparent material state
    if (this.map.grid[this.gridX][this.gridZ] === CellType.SOLID) {
      this.mesh.scale.set(0.9, 0.9, 0.9);
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(m => { m.opacity = 0.20; m.needsUpdate = true; });
      } else if (this.mesh.material) {
        this.mesh.material.opacity = 0.20;
        this.mesh.material.needsUpdate = true;
      }
    } else {
      this.mesh.scale.set(1.0, 1.0, 1.0);
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(m => { m.opacity = 0.90; m.needsUpdate = true; });
      } else if (this.mesh.material) {
        this.mesh.material.opacity = 0.90;
        this.mesh.material.needsUpdate = true;
      }
    }
  }

  /**
   * Redraws canvas texture contents to capture agitation transitions and speech bubbles
   */
  private lastTextureRedraw = 0;

  /**
   * Repaints the entity billboard. Redrawing a 256x256 canvas and re-uploading
   * it is not free, so consecutive requests are coalesced.
   */
  private updateTexture(force = false) {
    const now = performance.now();
    if (!force && now - this.lastTextureRedraw < 200) return;
    this.lastTextureRedraw = now;

    this.createEntityTexture();
  }

  /**
   * Updates state of Wandering Entity.
   * Handles custom pathing, speed modulations, and billboard direction locks.
   */
  public update(
    delta: number, 
    playerX: number, 
    playerZ: number,
    playerState: "idle" | "walking" | "running" | "crouching" = "idle",
    cameraDir?: THREE.Vector3,
    isFlashlightOn?: boolean
  ) {
    this.bobTime += delta;
    this.glitchTimer += delta;

    // 1. Organic Bobbing / Hover Animation
    let bobFreq = 3.8;
    let bobAmp = 0.08;
    if (this.type === EntityType.HOUND) {
      bobFreq = 5.5; bobAmp = 0.04; // Fast canine shivering
    } else if (this.type === EntityType.CLUMP) {
      bobFreq = 2.4; bobAmp = 0.12; // Tumbling heavy rolling motion
    } else if (this.type === EntityType.DULLER) {
      bobFreq = 1.8; bobAmp = 0.15; // Silent floating hover
    }

    const bobOffset = Math.sin(this.bobTime * bobFreq) * bobAmp;
    
    let baseHeight = 1.35;
    if (this.type === EntityType.DULLER) baseHeight = 1.48;
    else if (this.type === EntityType.HOUND) baseHeight = 1.05;
    else if (this.type === EntityType.CLUMP) baseHeight = 1.12;

    this.mesh.position.y = baseHeight + bobOffset;

    // Glitch animation (subtle scaling artifacts)
    if (this.glitchTimer >= 0.11) {
      this.glitchTimer = 0.0;
      if (Math.random() < 0.18) {
        this.mesh.scale.set(
          1.0 + (Math.random() * 0.06 - 0.03),
          1.0 + (Math.random() * 0.06 - 0.03),
          1.0
        );
      } else {
        this.mesh.scale.set(1.0, 1.0, 1.0);
      }
    }

    // 2. Rotate mesh horizontally to keep facing the voyager directly (Billboard sprite)
    this.mesh.lookAt(playerX, this.mesh.position.y, playerZ);

    // 3. Distance vector math
    const cSize = this.map.cellSize;
    const pxGrid = Math.floor(playerX / cSize);
    const pzGrid = Math.floor(playerZ / cSize);

    const fx = this.mesh.position.x - playerX;
    const fz = this.mesh.position.z - playerZ;
    const distanceMeters = Math.sqrt(fx * fx + fz * fz);

    // 4. SPEECH BUBBLE & LORE REVEAL MACHINE
    this.speechChangeTimer += delta;
    if (this.speechChangeTimer >= 4.0) {
      this.speechChangeTimer = 0.0;
      const prevText = this.currentSpeechText;

      // Formulate custom Portuguese lore subtitles based on proximity & type
      if (this.type === EntityType.SKIN_STEALER) {
        if (distanceMeters > 5.5) {
          // Innocent explorer mimicking phrases
          this.isAgitated = false;
          const mimics = [
            "Olá? Tem alguém aí?",
            "Socorro... Acho que rompi ligamentos.",
            "Encontrei água de amêndoas por aqui!",
            "Me chamo Lucas. Você faz parte do M.E.G.?",
            "Ufa, passos de gente! Venha me ajudar!",
            "Estou perto da saída do Level 1!"
          ];
          this.currentSpeechText = mimics[Math.floor(Math.random() * mimics.length)];
          this.moveSpeed = 1.0; // Slow friendly pace
        } else {
          // Angry morph trigger close-up!
          if (!this.isAgitated) {
            this.isAgitated = true;
            console.warn("[Skin-Stealer] Mask slipped! Attacking voyager.");
          }
          const hostiles = [
            "SUA PELE... ME DÁ ELA!",
            "NÃO ADIANTA REZAR!",
            "VOCÊ CHEIRA TÃO BEM...",
            "ROSTO DE VERDADE... EU QUERO!",
            "SOU HUMANO SIM! VENHA AQUI!"
          ];
          this.currentSpeechText = hostiles[Math.floor(Math.random() * hostiles.length)];
          this.moveSpeed = 3.1; // Aggressive lunge speed!
        }
      } else if (this.type === EntityType.HOUND) {
        if (this.intimidatedTimer > 0.1) {
          this.currentSpeechText = "*ROSNADO AMEDRONTADO*";
        } else if (this.isChasing) {
          this.currentSpeechText = "*LATIDOS HISTÉRICOS*";
        } else {
          this.currentSpeechText = "*PASSOS RÁPIDOS NA ESCURIDÃO*";
        }
      } else if (this.type === EntityType.DULLER) {
        if (this.map.grid[this.gridX][this.gridZ] === CellType.SOLID) {
          this.currentSpeechText = "*RUÍDOS DE PAREDE RASPANDO*";
        } else {
          this.currentSpeechText = "...";
        }
      } else if (this.type === EntityType.CLUMP) {
        if (this.isChasing) {
          this.currentSpeechText = "*BATIDAS DE MEMBROS CORRENDO*";
        } else {
          this.currentSpeechText = "*ARRANHÕES EMBALADOS*";
        }
      } else if (this.type === EntityType.WRETCH) {
        if (this.isChasing) {
          this.currentSpeechText = "NÃO ESCAPE DA CRISE!";
        } else {
          this.currentSpeechText = "*MURMÚRIOS INSANOS*";
        }
      }

      // Re-render when label text rotates or morphs
      if (prevText !== this.currentSpeechText) {
        this.updateTexture();
      }
    }

    // 5. INTENSITY AI LOGICS (Special features of the official Entities)
    
    // Default chasing reset each frame, we calculate depending on sensors
    if (this.map.level === 2) {
      this.isChasing = true;
      // Boost movement speeds dramatically on Level 2 to make it a fast, heart-pounding sprint chase!
      if (this.type === EntityType.HOUND) {
        this.moveSpeed = 3.65;
      } else if (this.type === EntityType.CLUMP) {
        this.moveSpeed = 3.3;
      } else if (this.type === EntityType.DULLER) {
        this.moveSpeed = 3.1;
      } else if (this.type === EntityType.SKIN_STEALER) {
        this.moveSpeed = 3.8;
        this.isAgitated = true;
      } else if (this.type === EntityType.WRETCH) {
        this.moveSpeed = 3.4;
      } else {
        this.moveSpeed = 3.2;
      }
    } else {
      this.isChasing = false;
    }

    if (this.map.level !== 2) {
      if (this.type === EntityType.HOUND) {
        // Intimidation Gaze logic!
        // Compute player gaze orientation against the Hound's relative direction
        const pPos3 = new THREE.Vector3(playerX, 1.6, playerZ);
        const toHoundDir = new THREE.Vector3().subVectors(this.mesh.position, pPos3).normalize();
        
        const isGazedAt = cameraDir ? cameraDir.dot(toHoundDir) > 0.81 : false;

        if (isGazedAt && distanceMeters < 16.0) {
          // Player maintains high-tension eye contact! Hound freezes or retreats
          this.intimidatedTimer = 1.2; // freeze lingering
          this.moveSpeed = 0.25; // Backs away very slowly
          this.isChasing = false;
        } else {
          if (this.intimidatedTimer > 0.0) {
            this.intimidatedTimer -= delta;
          }

          // Search trigger
          if (distanceMeters < 15.0 && this.intimidatedTimer <= 0.0) {
            this.isChasing = true;
            this.moveSpeed = 3.25; // fast chase sprint!
          } else {
            this.moveSpeed = 1.25; // leisurely crawl pace
          }
        }
      } 
      
      else if (this.type === EntityType.CLUMP) {
        // Hearing mechanic! Has no eyes, scans by sounds
        let localAlertRadius = 10.0;
        if (playerState === "running") {
          localAlertRadius = 24.0; // Hears distant sprinting boots
          this.moveSpeed = 3.9;    // fast rush!
          this.isChasing = distanceMeters <= localAlertRadius;
        } else if (playerState === "crouching") {
          localAlertRadius = 2.2;   // Stealth allows creeping around it safely
          this.moveSpeed = 1.1;
          this.isChasing = distanceMeters <= localAlertRadius;
        } else {
          localAlertRadius = 10.0;  // Standard walking pace
          this.moveSpeed = 2.1;
          this.isChasing = distanceMeters <= localAlertRadius;
        }
      }

      else if (this.type === EntityType.DULLER) {
        // Normal pacing, but wanders into walls
        if (distanceMeters < 12.0) {
          this.isChasing = true;
          this.moveSpeed = 2.0;
        } else {
          this.moveSpeed = 1.1;
        }
      }

      else if (this.type === EntityType.SKIN_STEALER) {
        // Skin-Stealer locks onto player and rushes when agitated (< 5.5m)
        if (this.isAgitated) {
          this.isChasing = true;
          this.moveSpeed = 3.1;
        } else {
          this.isChasing = false;
          this.moveSpeed = 1.0;
        }
      }

      else if (this.type === EntityType.WRETCH) {
        // Relentless pursuer once spotted within 16 meters
        if (distanceMeters < 16.0) {
          this.isChasing = true;
          this.moveSpeed = 2.45;
        } else {
          this.moveSpeed = 1.45;
        }
      }
    }

    // Adjust target coordinates if chasing
    if (this.isChasing) {
      this.chaseTargetX = pxGrid;
      this.chaseTargetZ = pzGrid;
    }

    // 6. Grid Traversing state machine
    if (this.isMoving) {
      // Interpolate progress along the current edge
      this.transitionProgress += (this.moveSpeed / cSize) * delta;

      if (this.transitionProgress >= 1.0) {
        // Complete current cell transition, set grid logical center
        this.gridX = this.targetGridX;
        this.gridZ = this.targetGridZ;
        this.isMoving = false;
        this.pauseTimer = Math.random() * 0.4 + 0.2; // brief tension check
        this.syncWorldPosition();
      } else {
        // Linearly interpolate ThreeJS world coords
        const wFromX = this.gridX * cSize + cSize / 2;
        const wFromZ = this.gridZ * cSize + cSize / 2;
        const wToX = this.targetGridX * cSize + cSize / 2;
        const wToZ = this.targetGridZ * cSize + cSize / 2;

        const currentWX = THREE.MathUtils.lerp(wFromX, wToX, this.transitionProgress);
        const currentWZ = THREE.MathUtils.lerp(wFromZ, wToZ, this.transitionProgress);
        this.mesh.position.x = currentWX;
        this.mesh.position.z = currentWZ;
      }
    } else {
      // Stationed
      if (this.pauseTimer > 0.0) {
        this.pauseTimer -= delta;
      } else {
        this.chooseNextTarget(pxGrid, pzGrid);
      }
    }
  }

  /**
   * Evaluates next target tile candidate.
   * Leverages custom AI mechanics (noclip for Duller, chase lock, random walks)
   */
  private chooseNextTarget(pXg: number, pZg: number) {
    const directions = [
      [0, -1], // North
      [0, 1],  // South
      [-1, 0], // West
      [1, 0]   // East
    ];

    // If chasing, try and select a node which brings grid distance closer to player's grid tile
    if (this.isChasing) {
      let bestDir: [number, number] | null = null;
      let minDistance = 99999;

      directions.forEach(([dx, dz]) => {
        const nx = this.gridX + dx;
        const nz = this.gridZ + dz;

        // Verify borders
        if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
          const isSolid = this.map.grid[nx][nz] === CellType.SOLID;
          
          // Only Duller can bypass solid constraints! (Noclip capability with 50% probability)
          const canWalk = !isSolid || (this.type === EntityType.DULLER && Math.random() < 0.50);

          if (canWalk) {
            // Euclidean grid distance to player's grid position
            const gd = Math.pow(nx - pXg, 2) + Math.pow(nz - pZg, 2);
            if (gd < minDistance) {
              minDistance = gd;
              bestDir = [nx, nz];
            }
          }
        }
      });

      if (bestDir) {
        const [tx, tz] = bestDir;
        this.targetGridX = tx;
        this.targetGridZ = tz;
        this.isMoving = true;
        this.transitionProgress = 0.0;
        return;
      }
    }

    // Default or Fallback random pacing patrolling
    const walkableCandidates: [number, number][] = [];

    directions.forEach(([dx, dz]) => {
      const nx = this.gridX + dx;
      const nz = this.gridZ + dz;

      if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
        const isSolid = this.map.grid[nx][nz] === CellType.SOLID;
        
        // Duller wall-noclip choice probability when wandering
        const canWalk = !isSolid || (this.type === EntityType.DULLER && Math.random() < 0.35);

        if (canWalk) {
          walkableCandidates.push([nx, nz]);
        }
      }
    });

    if (walkableCandidates.length > 0) {
      const select = walkableCandidates[Math.floor(Math.random() * walkableCandidates.length)];
      this.targetGridX = select[0];
      this.targetGridZ = select[1];
      this.isMoving = true;
      this.transitionProgress = 0.0;
    } else {
      this.pauseTimer = 0.5;
    }
  }

  /**
   * Resets the entity's position to a distant grid cell
   */
  public relocateFarAway(playerGridX: number, playerGridZ: number) {
    const size = this.map.gridSize;
    let candidates: [number, number][] = [];

    // Search cells in quadrants opposite/far from player
    for (let x = 3; x < size - 3; x++) {
      for (let z = 3; z < size - 3; z++) {
        // Not solid
        if (this.map.grid[x][z] !== CellType.SOLID) {
          const dx = x - playerGridX;
          const dz = z - playerGridZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 18) {
            candidates.push([x, z]);
          }
        }
      }
    }

    if (candidates.length > 0) {
      const select = candidates[Math.floor(Math.random() * candidates.length)];
      this.gridX = select[0];
      this.gridZ = select[1];
      this.targetGridX = select[0];
      this.targetGridZ = select[1];
      this.isMoving = false;
      this.isAgitated = false;
      this.resetBaseSpeed();
      this.syncWorldPosition();
      this.updateTexture();
      console.log(`[Entity ${this.type}] Relocated safely to far cell (${this.gridX}, ${this.gridZ})`);
    } else {
      // Fallback
      this.gridX = size - 4;
      this.gridZ = size - 4;
      this.targetGridX = size - 4;
      this.targetGridZ = size - 4;
      this.isMoving = false;
      this.isAgitated = false;
      this.resetBaseSpeed();
      this.syncWorldPosition();
      this.updateTexture();
    }
  }

  /**
   * Safely disposes materials & textures
   */
  public destroy(scene: THREE.Scene) {
    this.returnToPool(scene);
  }

  /**
   * Retrieves an entity from the static pool or instantiates a new one if empty
   */
  public static getOrCreate(map: ProceduralMap, startX: number, startZ: number, type: EntityType, scene: THREE.Scene): WanderingEntity {
    if (!this.entityPool.has(type)) {
      this.entityPool.set(type, []);
    }
    const poolList = this.entityPool.get(type)!;
    if (poolList.length > 0) {
      const entity = poolList.pop()!;
      entity.resetForReuse(map, startX, startZ);
      scene.add(entity.mesh);
      return entity;
    } else {
      const entity = new WanderingEntity(map, startX, startZ, type);
      scene.add(entity.mesh);
      return entity;
    }
  }

  /**
   * Releases this instance back to the object pool instead of destroying it
   */
  public returnToPool(scene: THREE.Scene) {
    scene.remove(this.mesh);
    // Reset temporary runtime fields
    this.transitionProgress = 0.0;
    this.isMoving = false;
    this.pauseTimer = 0.0;
    this.bobTime = 0.0;
    this.glitchTimer = 0.0;
    this.isAgitated = false;
    this.speechBubbleTimer = 0.0;
    this.currentSpeechText = "";
    this.speechChangeTimer = 0.0;
    this.intimidatedTimer = 0.0;
    this.chaseTargetX = 0;
    this.chaseTargetZ = 0;
    this.isChasing = false;

    if (!WanderingEntity.entityPool.has(this.type)) {
      WanderingEntity.entityPool.set(this.type, []);
    }
    WanderingEntity.entityPool.get(this.type)!.push(this);
  }

  /**
   * Resets the entity logic with a new map reference and coordinates
   */
  public resetForReuse(map: ProceduralMap, startX: number, startZ: number) {
    this.map = map;
    this.gridX = startX;
    this.gridZ = startZ;
    this.targetGridX = startX;
    this.targetGridZ = startZ;
    this.transitionProgress = 0.0;
    this.isMoving = false;
    this.pauseTimer = 0.0;
    this.bobTime = 0.0;
    this.glitchTimer = 0.0;
    this.isAgitated = false;
    this.speechBubbleTimer = 0.0;
    this.currentSpeechText = "";
    this.speechChangeTimer = 0.0;
    this.intimidatedTimer = 0.0;
    this.chaseTargetX = 0;
    this.chaseTargetZ = 0;
    this.isChasing = false;

    this.resetBaseSpeed();
    this.syncWorldPosition();
    // Forced: a reused entity must repaint immediately, not wait out the
    // coalescing window with the previous occupant's label on screen.
    this.updateTexture(true);
  }

  /**
   * Clears the entire object pool to free GPU resources when the game engine is disposed.
   */
  public static clearPool() {
    this.entityPool.forEach((list) => {
      list.forEach((entity) => {
        // Run actual ThreeJS memory disposal
        if (entity.mesh.geometry) {
          entity.mesh.geometry.dispose();
        }
        if (entity.mesh.material) {
          if (Array.isArray(entity.mesh.material)) {
            entity.mesh.material.forEach((m) => m.dispose());
          } else {
            entity.mesh.material.dispose();
          }
        }
        if (entity.canvasTexture) {
          entity.canvasTexture.dispose();
        }
      });
    });
    this.entityPool.clear();
  }
}
