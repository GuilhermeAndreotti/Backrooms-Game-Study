/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * Image-based ambient light for the interior levels.
 *
 * A flat AmbientLight lights every face the same, so corners, floors and
 * ceilings all read as one colour, and with no environment map anything
 * glossy or metallic (the warehouse's steel ceiling, Pipe Dreams' plates,
 * puddles, pool tiles) reflected nothing and rendered as dull plastic or near
 * black. This bakes a tiny procedural "room" — lit ceiling with fluorescent
 * strips, mid walls, dark floor, tinted by the level's ambient colour — into a
 * prefiltered (PMREM) environment once per level. Part of the ambient light
 * is then handed over to it every frame (see GameEngine), so overall
 * brightness stays where each level was tuned, but light now comes from
 * above, and glossy surfaces catch the tubes.
 *
 * Cost: one small cube-UV texture (~0.5 MB at size 64) and one extra texture
 * lookup per lit fragment. Built in a few milliseconds on level load.
 */

/** Radiance of each part of the fake room, relative to the ambient tint. */
const CEILING = 1.45;
const WALLS = 0.85;
const FLOOR = 0.3;
const STRIPS = 5.0;

export class RoomEnvironment {
  private pmrem: THREE.PMREMGenerator;
  private target: THREE.WebGLRenderTarget | null = null;
  private key = -1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /**
   * The environment texture for this ambient tint (an sRGB hex, as levels
   * author it). Rebuilt only when the tint changes.
   */
  public textureFor(tint: number): THREE.Texture {
    if (this.target && tint === this.key) return this.target.texture;
    this.target?.dispose();
    const room = buildRoom(tint);
    this.target = this.pmrem.fromScene(room, 0.02, 0.1, 50, { size: 64 });
    // Only the baked texture is kept: the room itself is thrown away.
    room.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    });
    this.key = tint;
    return this.target.texture;
  }

  public dispose() {
    this.target?.dispose();
    this.target = null;
    this.pmrem.dispose();
  }
}

function buildRoom(tint: number): THREE.Scene {
  const scene = new THREE.Scene();
  const base = new THREE.Color(tint);
  const shade = (k: number) => new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(k), side: THREE.BackSide });

  // A 12 x 3 x 12 room seen from eye height: wide enough that the ceiling
  // covers most of the upper hemisphere, like a Backrooms hall does.
  const W = 12, H = 3, EYE = 1.4;
  const box = new THREE.BoxGeometry(W, H, W);
  // BoxGeometry groups: +x, -x, +y, -y, +z, -z.
  const room = new THREE.Mesh(box, [shade(WALLS), shade(WALLS), shade(CEILING), shade(FLOOR), shade(WALLS), shade(WALLS)]);
  room.position.y = H / 2 - EYE;
  scene.add(room);

  // Fluorescent strips: what glossy floors and tiles end up reflecting.
  const stripMat = new THREE.MeshBasicMaterial({ color: base.clone().lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(STRIPS), side: THREE.DoubleSide });
  const strip = new THREE.PlaneGeometry(0.35, 1.4);
  strip.rotateX(Math.PI / 2);
  for (const x of [-3.5, 0, 3.5]) {
    for (const z of [-3.5, 0, 3.5]) {
      const m = new THREE.Mesh(strip, stripMat);
      m.position.set(x, H - EYE - 0.01, z);
      scene.add(m);
    }
  }
  return scene;
}
