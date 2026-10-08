/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The explorer avatar everyone else sees: the low-poly hazmat suit (colour,
 * hand-drawn face and wardrobe accessories), or a monster body for the SKIN
 * cheat. Used for teammates, the lobby mirror's copy of yourself and the
 * wardrobe's preview, so it depends on nothing but three and the look itself.
 *
 * Every accessory is a handful of primitives with its own geometry and
 * materials (no shared caches): GameEngine.disposeExplorerGroup frees the
 * whole avatar by traversal, which must not reach anything shared.
 */

import * as THREE from "three";
import { FACE_SIZE, drawFace, hasFace } from "../utils/face";
import { WanderingEntity, type SkinBodyChoice } from "./WanderingEntity";
import { ALL_ENTITY_TYPES } from "../shared/entityTypes";
import type { Outfit } from "../shared/outfit";

/** Bodies offered by the lobby's SKIN cheat: every monster type, plus the NPC looks (see SkinBodyChoice). */
export const MONSTER_SKIN_TYPES: SkinBodyChoice[] = [...ALL_ENTITY_TYPES, "OFFICE_WORKER", "PARTYGOER"];

/** Validates a `monsterSkin` string (network field or cheat-picker choice) against the offered set. */
export function monsterSkinType(value?: string | null): SkinBodyChoice | null {
  return value && (MONSTER_SKIN_TYPES as string[]).includes(value) ? (value as SkinBodyChoice) : null;
}

export interface ExplorerLook {
  name: string;
  suitColor?: string;
  face?: string;
  monsterSkin?: string;
  outfit?: Outfit;
}

/**
 * Builds a stylized retro hazmat explorer out of THREE primitive blocks —
 * no assets to load. Rig: hips -> spine -> (head, arms), hips -> legs; every
 * pivot is named so GameEngine.poseRemotePlayer can animate it.
 */
export function buildExplorerAvatar({ name, suitColor, face, monsterSkin, outfit }: ExplorerLook): THREE.Group {
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

    // Wardrobe accessories (the lobby's "Armário"): hat/face pieces ride the
    // head pivot so they nod with it, neck/back pieces ride the spine.
    addAccessories(group, spine, headPivot, outfit);
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

// ---------------------------------------------------------------------------
// Wardrobe accessories
// ---------------------------------------------------------------------------
// Coordinates: the head pivot's origin is the centre of the 0.2 m helmet
// sphere (front = +Z, face decal at z 0.215); the spine's origin is the hips,
// the torso's top edge is at y 0.73 with a ~0.245 m radius, and the oxygen
// tank's back face sits at z -0.27.

type Mat = THREE.Material;
const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, flatShading: true, ...extra });

function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** A small canvas texture drawn once per avatar (it's disposed with the avatar's material). */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Half a sphere (the dome of a cap or hard hat). */
const dome = (r: number) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);

/** A U-shaped cord hanging off the neck to the chest (lanyards, medal ribbons, chains). */
function neckCord(spine: THREE.Object3D, mat: Mat, tube: number): void {
  const arc = new THREE.TorusGeometry(0.15, tube, 4, 18, Math.PI);
  put(spine, arc, mat, 0, 0.7, 0.215, -0.35, 0, Math.PI);
}

const HEAD: Record<string, (h: THREE.Object3D, anim: THREE.Object3D[]) => void> = {
  tophat(h) {
    const black = std(0x15151a, { roughness: 0.45 });
    put(h, new THREE.CylinderGeometry(0.27, 0.27, 0.02, 16), black, 0, 0.15, 0);
    put(h, new THREE.CylinderGeometry(0.15, 0.155, 0.3, 14), black, 0, 0.31, 0);
    put(h, new THREE.CylinderGeometry(0.158, 0.158, 0.045, 14), std(0x8a1626), 0, 0.19, 0);
  },
  cap(h) {
    const blue = std(0x2f5f8f, { roughness: 0.85 });
    put(h, dome(0.208), blue, 0, 0.02, 0);
    put(h, new THREE.BoxGeometry(0.22, 0.018, 0.17), blue, 0, 0.06, 0.24, 0.12);
    put(h, new THREE.SphereGeometry(0.022, 6, 4), std(0xf2e8cf), 0, 0.23, 0);
  },
  party(h) {
    const stripes = canvasTex(64, 64, (g) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#ffd23f" : "#e8467c"; g.fillRect(0, i * 8, 64, 8); }
    });
    put(h, new THREE.ConeGeometry(0.11, 0.34, 14), std(0xffffff, { map: stripes, flatShading: false }), 0.02, 0.33, 0, 0, 0, -0.15);
    put(h, new THREE.SphereGeometry(0.04, 8, 6), std(0x3fb6e8), 0.045, 0.5, 0);
  },
  crown(h) {
    const gold = std(0xe2b02a, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
    put(h, new THREE.CylinderGeometry(0.15, 0.14, 0.09, 10, 1, true), gold, 0, 0.19, 0);
    const spike = new THREE.ConeGeometry(0.03, 0.08, 4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      put(h, spike, gold, Math.sin(a) * 0.145, 0.27, Math.cos(a) * 0.145);
    }
    put(h, new THREE.OctahedronGeometry(0.025), std(0xc4122e, { metalness: 0.3, roughness: 0.2 }), 0, 0.19, 0.15);
  },
  hardhat(h) {
    const yellow = std(0xf2c511, { roughness: 0.4 });
    put(h, dome(0.218), yellow, 0, 0.03, 0);
    put(h, new THREE.CylinderGeometry(0.255, 0.255, 0.016, 16), yellow, 0, 0.05, 0.02);
    put(h, new THREE.BoxGeometry(0.03, 0.03, 0.2), yellow, 0, 0.24, 0.02);
    put(h, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), std(0x222222), 0, 0.15, 0.2, Math.PI / 2);
    put(h, new THREE.CircleGeometry(0.028, 10), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), 0, 0.15, 0.226);
  },
  cowboy(h) {
    const leather = std(0x7a4a24, { roughness: 0.85 });
    const brim = put(h, new THREE.CylinderGeometry(0.34, 0.34, 0.02, 18), leather, 0, 0.14, 0);
    brim.scale.set(1, 1, 0.85);
    put(h, new THREE.CylinderGeometry(0.12, 0.155, 0.19, 12), leather, 0, 0.25, 0);
    put(h, new THREE.CylinderGeometry(0.157, 0.157, 0.035, 12), std(0x2a1a0e), 0, 0.17, 0);
  },
  halo(h, anim) {
    const ring = put(h, new THREE.TorusGeometry(0.14, 0.018, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe680 }), 0, 0.37, 0, Math.PI / 2);
    ring.userData.bob = 0.015;
    anim.push(ring);
  },
  catears(h) {
    const fur = std(0x2a2a2e);
    const pink = std(0xe89ab0);
    for (const s of [-1, 1]) {
      put(h, new THREE.ConeGeometry(0.065, 0.13, 4), fur, s * 0.11, 0.2, 0, 0, Math.PI / 4, -s * 0.35);
      put(h, new THREE.ConeGeometry(0.035, 0.08, 4), pink, s * 0.105, 0.195, 0.025, 0, Math.PI / 4, -s * 0.35);
    }
  },
  antennae(h, anim) {
    const stalk = std(0x1c1c22);
    const bulb = std(0x6ee87a, { emissive: 0x2a8a34, emissiveIntensity: 0.9 });
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.07, 0.17, 0);
      pivot.rotation.z = -s * 0.3;
      h.add(pivot);
      put(pivot, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 5), stalk, 0, 0.09, 0);
      put(pivot, new THREE.SphereGeometry(0.03, 8, 6), bulb, 0, 0.19, 0);
      pivot.userData.wobble = s;
      anim.push(pivot);
    }
  },
  propeller(h, anim) {
    const quarters = canvasTex(64, 32, (g) => {
      ["#d94f2b", "#ffd23f", "#2f6f8f", "#3f7d3a"].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 16, 0, 16, 32); });
    });
    put(h, dome(0.208), std(0xffffff, { map: quarters, flatShading: false }), 0, 0.02, 0);
    put(h, new THREE.CylinderGeometry(0.01, 0.01, 0.07, 5), std(0x888888, { metalness: 0.6 }), 0, 0.25, 0);
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.29, 0);
    h.add(rotor);
    const blade = std(0xd94f2b);
    put(rotor, new THREE.BoxGeometry(0.32, 0.008, 0.05), blade, 0, 0, 0, 0.25);
    put(rotor, new THREE.SphereGeometry(0.02, 6, 4), std(0xffd23f), 0, 0, 0);
    rotor.userData.spin = 9;
    anim.push(rotor);
  },
};

const FACE: Record<string, (h: THREE.Object3D) => void> = {
  sunglasses(h) {
    const black = std(0x0a0a0c, { metalness: 0.7, roughness: 0.15 });
    for (const s of [-1, 1]) {
      put(h, new THREE.BoxGeometry(0.085, 0.05, 0.02), black, s * 0.055, 0.04, 0.228);
      put(h, new THREE.BoxGeometry(0.01, 0.01, 0.15), black, s * 0.103, 0.05, 0.155);
    }
    put(h, new THREE.BoxGeometry(0.03, 0.012, 0.015), black, 0, 0.055, 0.228);
  },
  monocle(h) {
    const gold = std(0xe2b02a, { metalness: 0.9, roughness: 0.25 });
    put(h, new THREE.TorusGeometry(0.042, 0.007, 6, 18), gold, 0.06, 0.04, 0.226);
    put(h, new THREE.CircleGeometry(0.04, 16), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, metalness: 0.9, roughness: 0.05 }), 0.06, 0.04, 0.224);
    put(h, new THREE.CylinderGeometry(0.003, 0.003, 0.17, 4), gold, 0.11, -0.06, 0.2, 0.15, 0, 0.35);
  },
  mustache(h) {
    const hair = std(0x3a2414, { roughness: 0.95 });
    for (const s of [-1, 1]) {
      const m = put(h, new THREE.SphereGeometry(0.03, 8, 6), hair, s * 0.038, -0.055, 0.218, 0, 0, s * 0.35);
      m.scale.set(1.7, 0.65, 0.6);
      const tip = put(h, new THREE.SphereGeometry(0.015, 6, 4), hair, s * 0.085, -0.04, 0.21);
      tip.scale.set(1.4, 1, 1);
    }
  },
  glasses3d(h) {
    const frame = std(0xf4f1e8, { roughness: 0.7 });
    put(h, new THREE.BoxGeometry(0.21, 0.065, 0.014), frame, 0, 0.04, 0.226);
    const lens = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    put(h, new THREE.PlaneGeometry(0.075, 0.042), lens(0xe0262f), -0.052, 0.04, 0.2345);
    put(h, new THREE.PlaneGeometry(0.075, 0.042), lens(0x22c8e0), 0.052, 0.04, 0.2345);
    for (const s of [-1, 1]) put(h, new THREE.BoxGeometry(0.01, 0.012, 0.15), frame, s * 0.104, 0.05, 0.155);
  },
  clownnose(h) {
    put(h, new THREE.SphereGeometry(0.045, 12, 10), std(0xe0141e, { roughness: 0.25, flatShading: false }), 0, -0.005, 0.235);
  },
  gasmask(h) {
    const rubber = std(0x2a2c2a, { roughness: 0.9 });
    const metal = std(0x6f7470, { metalness: 0.7, roughness: 0.35 });
    const snout = put(h, new THREE.SphereGeometry(0.07, 10, 8), rubber, 0, -0.06, 0.19);
    snout.scale.set(1.2, 0.9, 0.8);
    put(h, new THREE.CylinderGeometry(0.045, 0.05, 0.07, 10), metal, 0, -0.08, 0.26, Math.PI / 2 + 0.3);
    for (const s of [-1, 1]) put(h, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), metal, s * 0.1, -0.07, 0.17, 0, 0, s * 1.1);
    for (const s of [-1, 1]) put(h, new THREE.TorusGeometry(0.038, 0.009, 6, 14), rubber, s * 0.06, 0.045, 0.218);
  },
};

const NECK: Record<string, (s: THREE.Object3D) => void> = {
  tie(s) {
    const red = std(0xa81c2e, { roughness: 0.55 });
    put(s, new THREE.BoxGeometry(0.06, 0.05, 0.03), red, 0, 0.67, 0.245);
    put(s, new THREE.BoxGeometry(0.07, 0.28, 0.014), red, 0, 0.5, 0.262, -0.06);
    put(s, new THREE.BoxGeometry(0.05, 0.05, 0.014), red, 0, 0.36, 0.272, -0.06, 0, Math.PI / 4);
    put(s, new THREE.BoxGeometry(0.072, 0.012, 0.016), std(0xe2b02a, { metalness: 0.8 }), 0, 0.5, 0.268, -0.06);
  },
  bowtie(s) {
    const black = std(0x15151a, { roughness: 0.4 });
    for (const side of [-1, 1]) put(s, new THREE.ConeGeometry(0.04, 0.08, 4), black, side * 0.042, 0.67, 0.25, 0, 0, side * Math.PI / 2);
    put(s, new THREE.SphereGeometry(0.02, 6, 4), black, 0, 0.67, 0.255);
  },
  scarf(s) {
    const wool = std(0xd94f2b, { roughness: 0.95 });
    const ring = put(s, new THREE.TorusGeometry(0.2, 0.055, 6, 14), wool, 0, 0.72, 0, Math.PI / 2);
    ring.scale.set(1, 1, 0.9);
    put(s, new THREE.BoxGeometry(0.08, 0.26, 0.035), wool, 0.1, 0.56, 0.245, -0.08, 0, 0.12);
    put(s, new THREE.BoxGeometry(0.082, 0.025, 0.037), std(0xf2e8cf, { roughness: 0.95 }), 0.115, 0.46, 0.255, -0.08, 0, 0.12);
  },
  badge(s) {
    neckCord(s, std(0x2f6f8f), 0.007);
    const card = canvasTex(64, 84, (g) => {
      g.fillStyle = "#f4f1e8"; g.fillRect(0, 0, 64, 84);
      g.fillStyle = "#2f6f8f"; g.fillRect(0, 0, 64, 18);
      g.fillStyle = "#f4f1e8"; g.font = "bold 13px monospace"; g.textAlign = "center"; g.fillText("M.E.G.", 32, 14);
      g.fillStyle = "#9a9384"; g.fillRect(18, 24, 28, 30);
      g.fillStyle = "#111"; g.fillRect(10, 60, 44, 4); g.fillRect(10, 68, 30, 4);
    });
    put(s, new THREE.BoxGeometry(0.09, 0.12, 0.008), std(0xffffff, { map: card, flatShading: false }), 0, 0.5, 0.27, -0.06);
  },
  medal(s) {
    neckCord(s, std(0x2f4fa8), 0.009);
    put(s, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), std(0xe2b02a, { metalness: 0.9, roughness: 0.25 }), 0, 0.53, 0.27, Math.PI / 2 - 0.06);
    put(s, new THREE.OctahedronGeometry(0.02), std(0xfff1a8, { metalness: 0.9, roughness: 0.2 }), 0, 0.53, 0.28);
  },
  chain(s) {
    const gold = std(0xe2b02a, { metalness: 0.95, roughness: 0.2 });
    neckCord(s, gold, 0.013);
    // A smiley pendant: the one face down here everyone's happy to see.
    const smile = canvasTex(32, 32, (g) => {
      g.fillStyle = "#e2b02a"; g.fillRect(0, 0, 32, 32);
      g.fillStyle = "#3a2a08"; g.fillRect(9, 9, 4, 6); g.fillRect(19, 9, 4, 6);
      g.fillRect(8, 20, 16, 3); g.fillRect(6, 17, 3, 4); g.fillRect(23, 17, 3, 4);
    });
    put(s, new THREE.CylinderGeometry(0.045, 0.045, 0.014, 14), [gold, new THREE.MeshStandardMaterial({ map: smile, metalness: 0.8, roughness: 0.3 }), gold] as unknown as Mat, 0, 0.53, 0.272, Math.PI / 2 - 0.06);
  },
};

const BACK: Record<string, (s: THREE.Object3D, anim: THREE.Object3D[]) => void> = {
  backpack(s) {
    const canvas = std(0x4f5a2c, { roughness: 0.95 });
    const strap = std(0x2a2a1e, { roughness: 0.9 });
    put(s, new THREE.BoxGeometry(0.4, 0.44, 0.17), canvas, 0, 0.36, -0.36);
    put(s, new THREE.BoxGeometry(0.41, 0.13, 0.18), std(0x3f4822, { roughness: 0.95 }), 0, 0.53, -0.36);
    put(s, new THREE.BoxGeometry(0.26, 0.14, 0.05), canvas, 0, 0.24, -0.46);
    put(s, new THREE.TorusGeometry(0.05, 0.012, 4, 10, Math.PI), std(0x6b3a1e), 0, 0.6, -0.36);
    for (const x of [-0.12, 0.12]) put(s, new THREE.BoxGeometry(0.045, 0.42, 0.012), strap, x, 0.45, 0.255, -0.05);
  },
  cape(s, anim) {
    const geo = new THREE.PlaneGeometry(0.62, 0.95, 1, 6);
    // Drape it: the lower it hangs, the further it flares away from the back.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (0.475 - pos.getY(i)) / 0.95;
      pos.setZ(i, -0.12 * t * t);
      pos.setX(i, pos.getX(i) * (0.85 + 0.25 * t));
    }
    geo.computeVertexNormals();
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.68, -0.29);
    s.add(pivot);
    put(pivot, geo, std(0x9a1428, { side: THREE.DoubleSide, roughness: 0.75, flatShading: false }), 0, -0.475, 0, 0.12);
    put(s, new THREE.CylinderGeometry(0.27, 0.27, 0.05, 10, 1, true, Math.PI * 0.5, Math.PI), std(0xe2b02a, { metalness: 0.7, side: THREE.DoubleSide }), 0, 0.7, 0);
    pivot.userData.flutter = 1;
    anim.push(pivot);
  },
  wings(s, anim) {
    const feather = std(0xf4f1e8, { roughness: 0.8, emissive: 0x332f26, emissiveIntensity: 0.4 });
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(side * 0.08, 0.5, -0.3);
      wing.rotation.y = side * 0.45;
      s.add(wing);
      [[0.2, 0.06, 0.13], [0.16, -0.06, 0.1], [0.11, -0.16, 0.075]].forEach(([dx, dy, r]) => {
        const f = put(wing, new THREE.SphereGeometry(r, 8, 6), feather, side * dx, dy, 0, 0, 0, side * -0.5);
        f.scale.set(1.9, 0.75, 0.18);
      });
      wing.userData.flap = side;
      anim.push(wing);
    }
  },
  almondjug(s) {
    const label = canvasTex(128, 32, (g) => {
      g.fillStyle = "#f2e8cf"; g.fillRect(0, 0, 128, 32);
      g.fillStyle = "#7a4a24"; g.font = "bold 14px monospace"; g.textAlign = "center";
      g.fillText("ALMOND", 64, 14); g.fillText("WATER", 64, 28);
    });
    const plastic = new THREE.MeshStandardMaterial({ color: 0xeadfc0, transparent: true, opacity: 0.8, roughness: 0.25 });
    const jug = put(s, new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12), [new THREE.MeshStandardMaterial({ map: label, roughness: 0.6 }), plastic, plastic] as unknown as Mat, 0, 0.32, -0.38);
    jug.rotation.y = Math.PI;
    put(s, new THREE.CylinderGeometry(0.035, 0.05, 0.06, 10), plastic, 0, 0.5, -0.38);
    put(s, new THREE.CylinderGeometry(0.038, 0.038, 0.03, 10), std(0x2f6f8f), 0, 0.545, -0.38);
    put(s, new THREE.TorusGeometry(0.13, 0.012, 4, 14), std(0x2a2a1e), 0, 0.36, -0.36, Math.PI / 2);
  },
  balloon(s, anim) {
    const pivot = new THREE.Group();
    pivot.position.set(0.2, 0.62, -0.26);
    s.add(pivot);
    put(pivot, new THREE.CylinderGeometry(0.004, 0.004, 1.0, 4), std(0xf2e8cf), 0, 0.5, 0);
    // A Level FUN balloon: yellow, smiling, and very interested in you.
    const face = canvasTex(64, 64, (g) => {
      g.fillStyle = "#f5cf1d"; g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#111";
      g.beginPath(); g.ellipse(24, 26, 3, 6, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(40, 26, 3, 6, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.strokeStyle = "#111";
      g.beginPath(); g.arc(32, 32, 14, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    });
    face.offset.x = 0.25; // put the smile on the side that faces forward
    const ball = put(pivot, new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshStandardMaterial({ map: face, roughness: 0.3 }), 0, 1.12, 0);
    ball.scale.set(1, 1.15, 1);
    put(pivot, new THREE.ConeGeometry(0.025, 0.04, 6), std(0xf5cf1d), 0, 0.95, 0, Math.PI);
    pivot.userData.sway = 1;
    anim.push(pivot);
  },
};

function addAccessories(group: THREE.Group, spine: THREE.Object3D, head: THREE.Object3D, outfit?: Outfit): void {
  if (!outfit) return;
  const anim: THREE.Object3D[] = [];
  HEAD[outfit.head]?.(head, anim);
  FACE[outfit.face]?.(head);
  NECK[outfit.neck]?.(spine);
  BACK[outfit.back]?.(spine, anim);
  for (const o of anim) o.userData.rest = o.rotation.clone();
  if (anim.length) group.userData.accessoryAnim = anim;
}

/**
 * Idle motion for the few accessories that have any (propeller, balloon,
 * cape, wings...). `speed` is how fast the wearer is moving (0..1), so the
 * cape and wings react to a run. Cheap: a couple of rotations per avatar.
 */
export function animateAccessories(group: THREE.Object3D, delta: number, speed = 0): void {
  const anim = group.userData.accessoryAnim as THREE.Object3D[] | undefined;
  if (!anim) return;
  const t = (group.userData.accessoryTime = ((group.userData.accessoryTime as number) ?? 0) + delta);
  for (const o of anim) {
    const d = o.userData;
    const rest = d.rest as THREE.Euler;
    if (d.spin) o.rotation.y += d.spin * (1 + speed * 2) * delta;
    if (d.bob) o.position.y = 0.37 + Math.sin(t * 2.2) * d.bob;
    if (d.wobble) o.rotation.z = rest.z + Math.sin(t * 5 + d.wobble) * (0.08 + speed * 0.2);
    if (d.sway) { o.rotation.z = Math.sin(t * 1.3) * 0.12 - speed * 0.1; o.rotation.x = Math.sin(t * 0.9) * 0.08 - speed * 0.35; }
    if (d.flutter) o.rotation.x = rest.x + 0.05 + Math.sin(t * 3) * 0.04 + speed * 0.55;
    if (d.flap) o.rotation.y = rest.y + d.flap * Math.sin(t * (2 + speed * 6)) * (0.12 + speed * 0.2);
  }
}
