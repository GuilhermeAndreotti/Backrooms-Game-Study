/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The explorer's body: a realistic hazmat coverall, built the way the
 * monsters are (sculpted lathe profiles, fabric folds that actually catch the
 * light, painted canvas textures doubling as bump maps) instead of plain
 * primitive blocks.
 *
 *   - a baggy coverall with folds bunched at the elbows, knees and waist,
 *     a front zip, reflective tape and a name tape with the player's name;
 *   - a full hood with a curved face shield, a rubber gasket round it and a
 *     person inside, breathing through a half-mask (or the player's drawn
 *     face / image link, behind the glass);
 *   - an SCBA air cylinder on a backplate and harness, its corrugated hose
 *     running round to the hood's regulator;
 *   - rubber gloves and boots taped to the suit, a webbing belt with pouches,
 *     and a real flashlight in the right fist.
 *
 * Proportions keep the eyes on PLAYER_STANDING_HEIGHT (1.33 m), so the
 * first-person viewpoint and the body others see still line up.
 *
 * Everything (geometry, materials, canvas textures) is built per avatar and
 * owned by it: GameEngine.disposeExplorerGroup frees the whole avatar by
 * traversal, which must never reach anything shared. Every texture is used as
 * some material's `map` (bump maps reuse the colour map), so that traversal
 * frees it too. The tiny seeded RNG only keeps the painted look identical
 * from run to run — nothing here touches world state.
 */

import * as THREE from "three";
import { Parts } from "./mobs/anatomy";
import { sculptedHead } from "./mobs/sculpt";
import { FACE_SIZE, drawFace, faceImageUrl, hasFace } from "../utils/face";

/** Height of the hips pivot above the floor when standing. */
export const AVATAR_HIP_Y = 0.74;
/** How far the hips sink in a full crouch. */
export const AVATAR_CROUCH_DROP = 0.24;
/** Where something carried in the left glove sits, in lForearm space. */
export const AVATAR_HAND_Y = -0.29;

/** Rig pivots the avatar exposes (GameEngine.poseRemotePlayer / LobbyCutscene animate them). */
export interface SuitRig {
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  /** Origin at the hood's centre, scaled so wardrobe hats/face pieces sit on the hood. */
  headAnchor: THREE.Group;
  /** Torso frame the wardrobe neck pieces were authored in. */
  bodyAnchor: THREE.Group;
  /** Same frame pushed back past the air cylinder, for the back pieces (backpack, cape, wings...). */
  backAnchor: THREE.Group;
}

// ---------------------------------------------------------------------------
// Painted textures
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number, repeat = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

function blot(g: CanvasRenderingContext2D, x: number, y: number, radius: number, rgb: string, alpha: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(${rgb},${alpha})`);
  grad.addColorStop(0.6, `rgba(${rgb},${alpha * 0.5})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(x, y, radius, radius * 0.7, (x + y) * 0.02, 0, Math.PI * 2);
  g.fill();
}

/** Coated coverall fabric: twill, folds and creases, grime, a stitched seam (tinted by the suit colour). */
function suitTexture(): THREE.CanvasTexture {
  return paint(512, 512, (g, r) => {
    const S = 512;
    g.fillStyle = "#efebe2";
    g.fillRect(0, 0, S, S);
    // Twill weave.
    g.strokeStyle = "rgba(0,0,0,0.045)";
    g.lineWidth = 1;
    for (let i = -S; i < S; i += 3) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    }
    // Creases: mostly running round the limbs (horizontal in UV), a shadow line with a highlight under it.
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, len = 30 + r() * 120;
      const a = (r() - 0.5) * 0.7 + (r() < 0.2 ? Math.PI / 2 : 0);
      const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
      const bend = (r() - 0.5) * 30;
      const w = 1.2 + r() * 2.6;
      g.lineCap = "round";
      g.strokeStyle = `rgba(40,32,22,${0.12 + r() * 0.14})`;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + dx / 2, y + dy / 2 + bend, x + dx, y + dy); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = w * 0.6;
      g.beginPath(); g.moveTo(x, y + w); g.quadraticCurveTo(x + dx / 2, y + dy / 2 + bend + w, x + dx, y + dy + w); g.stroke();
    }
    // Grime and water marks.
    for (let i = 0; i < 22; i++) blot(g, r() * S, r() * S, 12 + r() * 50, "92,76,52", 0.12 + r() * 0.2);
    g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(110,92,62,${0.12 + r() * 0.1})`;
      g.beginPath(); g.ellipse(r() * S, r() * S, 10 + r() * 26, 7 + r() * 18, r() * 3, 0, Math.PI * 2); g.stroke();
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(48,38,26,${0.2 + r() * 0.35})`;
      g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    // The back seam (lathe UVs wrap there): a welted, stitched seam.
    for (const x of [3, S - 4]) {
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.fillRect(x - 1, 0, 3, S);
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let y = 0; y < S; y += 7) g.fillRect(x + (x < S / 2 ? 4 : -5), y, 1.5, 4);
    }
    grain(g, S, S, 14, r);
  }, 911);
}

/** Black rubber for the gloves and boots: scuffed, crinkled where it flexes. */
function rubberTexture(): THREE.CanvasTexture {
  return paint(256, 256, (g, r) => {
    g.fillStyle = "#2c2c2a";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      const x = r() * 256, y = r() * 256, len = 10 + r() * 40;
      g.strokeStyle = `rgba(0,0,0,${0.3 + r() * 0.3})`;
      g.lineWidth = 1 + r() * 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (r() - 0.5) * 8); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + len, y + 2 + (r() - 0.5) * 8); g.stroke();
    }
    for (let i = 0; i < 30; i++) blot(g, r() * 256, r() * 256, 4 + r() * 18, "150,140,120", 0.08 + r() * 0.1);
    grain(g, 256, 256, 18, r);
  }, 212);
}

/** Silver duct tape wound round the cuffs and boot tops. */
function tapeTexture(): THREE.CanvasTexture {
  return paint(128, 64, (g, r) => {
    g.fillStyle = "#9a9c9a";
    g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 24; i++) {
      const x = r() * 128;
      g.strokeStyle = r() < 0.5 ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
      g.lineWidth = 1 + r() * 2;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 20, 64); g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(0, 30, 128, 2);
    grain(g, 128, 64, 22, r);
  }, 37);
}

/** The air cylinder: dark composite wrap, a yellow shoulder band and the label facing out. */
function tankTexture(): THREE.CanvasTexture {
  return paint(256, 256, (g, r) => {
    g.fillStyle = "#34383b";
    g.fillRect(0, 0, 256, 256);
    // Filament winding.
    g.strokeStyle = "rgba(255,255,255,0.035)";
    for (let i = -256; i < 512; i += 4) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i - 120, 256); g.stroke();
    }
    g.fillStyle = "#d8a91c";
    g.fillRect(0, 34, 256, 18);
    // Label, centred on u = 0.5 (the side facing away from the back).
    g.fillStyle = "#e9e4d6";
    g.fillRect(108, 104, 40, 60);
    g.fillStyle = "#1b1b1b";
    g.font = "bold 12px monospace";
    g.textAlign = "center";
    g.fillText("AIR", 128, 122);
    g.font = "bold 7px monospace";
    g.fillText("M.E.G.", 128, 136);
    g.fillStyle = "#b02a1e";
    g.fillRect(112, 144, 32, 4);
    g.fillStyle = "#1b1b1b";
    g.font = "6px monospace";
    g.fillText("300 BAR", 128, 158);
    // Scratches through the paint.
    for (let i = 0; i < 50; i++) {
      const x = r() * 256, y = r() * 256;
      g.strokeStyle = `rgba(200,200,190,${0.08 + r() * 0.18})`;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 6); g.stroke();
    }
    for (let i = 0; i < 10; i++) blot(g, r() * 256, r() * 256, 8 + r() * 26, "70,58,40", 0.25);
    grain(g, 256, 256, 12, r);
  }, 5150);
}

/** Name tape over the heart: M.E.G. on the left, the explorer's name stencilled after it. */
function nameTapeTexture(name: string): THREE.CanvasTexture {
  return paint(256, 72, (g, r) => {
    g.fillStyle = "#1f2a33";
    g.fillRect(0, 0, 256, 72);
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.setLineDash([4, 3]);
    g.strokeRect(4, 4, 248, 64);
    g.setLineDash([]);
    g.fillStyle = "#deb81d";
    g.font = "bold 22px monospace";
    g.textAlign = "left";
    g.fillText("M.E.G.", 14, 45);
    g.fillStyle = "#e9e4d6";
    g.font = "bold 24px monospace";
    const label = name.toUpperCase().slice(0, 10);
    g.fillText(label, 108, 46, 140);
    grain(g, 256, 72, 16, r);
  }, 77, false);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A lathe from [radius, y] points, smoothed through a spline. phiStart = PI keeps the UV seam at the back. */
function lathe(points: [number, number][], radial = 20, divisions = 48, phiStart = Math.PI): THREE.LatheGeometry {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(divisions).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
  return new THREE.LatheGeometry(pts, radial, phiStart);
}

/**
 * A coverall sleeve / trouser leg hanging along -Y from its pivot: tapered,
 * round-capped, with the fabric bunched into folds around `foldAt` (0 = the
 * pivot end, 1 = the far end).
 */
function sleeve(len: number, r0: number, r1: number, foldAt: number, foldAmp: number, radial = 20): THREE.LatheGeometry {
  const pts: [number, number][] = [];
  const steps = 36;
  pts.push([0.0005, -len - r1 * 0.9]);
  pts.push([r1 * 0.7, -len - r1 * 0.6]);
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const base = THREE.MathUtils.lerp(r0, r1, t);
    const near = Math.exp(-(((t - foldAt) / 0.22) ** 2));
    const fold = foldAmp * near * (0.5 + 0.5 * Math.sin(t * 46));
    const sag = 0.06 * Math.sin(t * Math.PI); // baggy in the middle
    pts.push([base * (1 + fold + sag * 0.3), -t * len]);
  }
  pts.push([r0 * 0.7, r0 * 0.6]);
  pts.push([0.0005, r0 * 0.9]);
  // Straight polyline (already dense) — a spline here would smooth the folds away.
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), radial, Math.PI);
}

/** Pushes vertices out from the Y axis by `fn` (fraction of radius), then re-derives smooth normals. */
function ripple(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, phi: number) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + fn(x, y, z, Math.atan2(x, z));
    pos.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Scales a lathe's UVs so the fabric texture keeps roughly the same size on every part. */
function fabricUV(geo: THREE.BufferGeometry, around: number, along: number): THREE.BufferGeometry {
  const uv = geo.getAttribute("uv");
  if (!uv) return geo;
  const su = Math.max(1, Math.round(around / 0.45));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * along * 2.2);
  return geo;
}

/**
 * Vertex colours for the suit: dirt creeping up from the floor (mud, the
 * water of the Poolrooms, carpet grime) and faint scuffing, from each
 * vertex's height above the floor at rest. `baseY` is the geometry's origin
 * height; the material's vertexColors multiplies this over the suit colour.
 */
function grime(geo: THREE.BufferGeometry, baseY: number): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const wy = baseY + y;
    const mud = 1 - THREE.MathUtils.smoothstep(wy, 0.04, 0.62);
    const scuff = 0.5 + 0.5 * Math.sin(x * 37 + wy * 19) * Math.sin(z * 29 - wy * 13);
    const k = (1 - mud * 0.42) * (0.93 + 0.07 * scuff);
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * (1 - mud * 0.06);
    colors[i * 3 + 2] = k * (1 - mud * 0.14);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** A flat strap through `points` (body webbing), its flat side facing away from `centre`. */
function strap(p: Parts, points: THREE.Vector3[], width: number, thick: number, centre: THREE.Vector3): Parts {
  const up = new THREE.Vector3();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dir = up.subVectors(b, a);
    const len = dir.length() + thick;
    const y = dir.clone().normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const out = mid.clone().sub(centre);
    out.y = 0;
    const z = out.addScaledVector(y, -out.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y);
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(mid);
    p.list.push([new THREE.BoxGeometry(width, len, thick), m]);
  }
  return p;
}

/** Ring band (tape, belt) hugging a lathe of radius `r` at height y, `h` tall; same z squash as the body under it. */
function band(r: number, y: number, h: number, out: number, zScale = 1, radial = 24): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry([
    new THREE.Vector2(r - 0.002, y - h / 2 - 0.002),
    new THREE.Vector2(r + out, y - h / 2),
    new THREE.Vector2(r + out, y + h / 2),
    new THREE.Vector2(r - 0.002, y + h / 2 + 0.002),
  ], radial, Math.PI);
  geo.scale(1, 1, zScale);
  return geo;
}

// ---------------------------------------------------------------------------
// The suit
// ---------------------------------------------------------------------------

/** Torso silhouette [radius, y] in spine space (the spine sits at the hips). */
const TORSO: [number, number][] = [
  [0.001, -0.1], [0.09, -0.098], [0.145, -0.076], [0.17, -0.04], [0.178, 0.0], [0.176, 0.06],
  [0.166, 0.12], [0.161, 0.16], [0.168, 0.22], [0.182, 0.29], [0.192, 0.35], [0.196, 0.4],
  [0.186, 0.44], [0.152, 0.47], [0.1, 0.49], [0.06, 0.5], [0.001, 0.505],
];
const TORSO_Z = 0.72;

/** Torso radius at spine-space height y (linear between the silhouette's points). */
function torsoR(y: number): number {
  for (let i = 0; i < TORSO.length - 1; i++) {
    const [r0, y0] = TORSO[i], [r1, y1] = TORSO[i + 1];
    if (y >= y0 && y <= y1) return THREE.MathUtils.lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  return 0.001;
}

/** Hood sphere radius and its non-uniform stretch. */
const HOOD_R = 0.155;
const HOOD_SCALE = new THREE.Vector3(1, 1.07, 1.03);
/** Face-shield window on the hood sphere, on its segment grid (40 x 28) so the cut is clean. */
const WIN = { phi0: Math.PI / 2 - (4 * Math.PI * 2) / 40, phi1: Math.PI / 2 + (4 * Math.PI * 2) / 40, th0: (9 * Math.PI) / 28, th1: (19 * Math.PI) / 28 };

export function buildHazmatSuit(group: THREE.Group, opts: { name: string; suitColor?: string; face?: string }): SuitRig {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // --- Materials (all per avatar) -------------------------------------------
  const suitTex = suitTexture();
  const suitMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.suitColor || "#deb81d"), map: suitTex, bumpMap: suitTex, bumpScale: 1.4,
    roughness: 0.72, metalness: 0, vertexColors: true,
  });
  const hoodMat = suitMat.clone();
  hoodMat.side = THREE.DoubleSide;
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 1, side: THREE.BackSide });
  const rubberTex = rubberTexture();
  const rubberMat = new THREE.MeshStandardMaterial({ map: rubberTex, bumpMap: rubberTex, bumpScale: 1.2, roughness: 0.55, metalness: 0 });
  const tapeTex = tapeTexture();
  const tapeMat = new THREE.MeshStandardMaterial({ map: tapeTex, bumpMap: tapeTex, bumpScale: 1, roughness: 0.42, metalness: 0.35 });
  const webbingMat = new THREE.MeshStandardMaterial({ color: 0x2e2f2a, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.3, metalness: 0.9 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.38, metalness: 0.75 });
  const reflectMat = new THREE.MeshStandardMaterial({ color: 0xd9dad2, roughness: 0.22, metalness: 0.55, emissive: 0x23241f });
  const tankTex = tankTexture();
  const tankMat = new THREE.MeshStandardMaterial({ map: tankTex, roughness: 0.5, metalness: 0.2 });
  const tapeName = nameTapeTexture(opts.name);
  const nameMat = new THREE.MeshStandardMaterial({ map: tapeName, roughness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a3438, roughness: 0.04, metalness: 0.65, transparent: true, opacity: 0.38, depthWrite: false,
  });

  // --- Rig --------------------------------------------------------------------
  const hips = new THREE.Group();
  hips.name = "hips";
  hips.position.set(0, AVATAR_HIP_Y, 0);
  group.add(hips);
  const spine = new THREE.Group();
  spine.name = "spine";
  hips.add(spine);
  const H = AVATAR_HIP_Y;

  // --- Torso ------------------------------------------------------------------
  const torso = lathe(TORSO, 28, 56);
  // Loose vertical folds hanging from the chest, gathered under the belt.
  ripple(torso, (_x, y, _z, phi) => {
    const hang = THREE.MathUtils.smoothstep(y, 0.36, 0.0) * THREE.MathUtils.smoothstep(y, -0.12, -0.02);
    return 0.022 * hang * Math.sin(phi * 7 + y * 9) + 0.012 * Math.sin(phi * 13 - y * 23) * hang;
  });
  torso.scale(1, 1, TORSO_Z);
  mesh(spine, grime(fabricUV(torso, 1.1, 0.64), H), suitMat);

  // Shoulder yokes over the sleeve heads.
  const yokes = new Parts();
  for (const s of [-1, 1]) yokes.blob(V(s * 0.178, 0.418, -0.004), 0.072, [1, 0.88, 1.04], [0, 0, s * 0.3], [18, 12]);
  mesh(spine, grime(yokes.merge(), H), suitMat);

  // Front zip under a storm flap.
  const zip = new Parts();
  const zipPts: THREE.Vector3[] = [];
  for (let y = 0.46; y >= 0.0; y -= 0.04) zipPts.push(V(0.012, y, torsoR(y) * TORSO_Z + 0.004));
  strap(zip, zipPts, 0.03, 0.006, V(0, 0, 0));
  mesh(spine, grime(zip.merge(), H), suitMat);
  const zipPull = new Parts().box(V(0.012, 0.455, torsoR(0.455) * TORSO_Z + 0.012), [0.012, 0.03, 0.005]);
  mesh(spine, zipPull.merge(), metalMat);

  // Reflective tape round the chest.
  mesh(spine, band(torsoR(0.3), 0.3, 0.03, 0.005, TORSO_Z, 32), reflectMat);

  // Name tape over the heart, following the chest's curve.
  {
    const x = 0.085, y = 0.355, r = torsoR(y);
    const a = Math.asin(x / r);
    const tape = mesh(spine, new THREE.PlaneGeometry(0.105, 0.03), nameMat, x, y, Math.cos(a) * r * TORSO_Z + 0.006);
    tape.rotation.y = Math.atan2(Math.sin(a), Math.cos(a) / TORSO_Z);
    tape.rotation.x = -0.12;
    tape.castShadow = false;
  }

  // Webbing belt, buckle and pouches.
  const beltY = 0.15;
  mesh(spine, band(torsoR(beltY) + 0.006, beltY, 0.045, 0.01, TORSO_Z, 32), webbingMat);
  mesh(spine, new Parts().box(V(0, beltY, torsoR(beltY) * TORSO_Z + 0.02), [0.06, 0.05, 0.012]).merge(), metalMat);
  const pouches = new Parts();
  for (const a of [-1.25, 1.1, 2.4]) {
    const r = torsoR(beltY) + 0.035;
    pouches.box(V(Math.sin(a) * r, beltY - 0.025, Math.cos(a) * r * TORSO_Z), [0.075, 0.09, 0.045], [0, a, 0]);
    pouches.box(V(Math.sin(a) * (r + 0.004), beltY + 0.012, Math.cos(a) * (r + 0.004) * TORSO_Z), [0.08, 0.028, 0.048], [0, a, 0]);
  }
  mesh(spine, pouches.merge(), new THREE.MeshStandardMaterial({ color: 0x4a4a36, roughness: 0.92 }));

  // Hood skirt draped over the shoulders (fixed to the torso; the hood itself turns with the head).
  const skirt = lathe([[0.222, 0.36], [0.215, 0.39], [0.19, 0.43], [0.14, 0.47], [0.1, 0.5], [0.085, 0.54]], 28, 24);
  ripple(skirt, (_x, y, _z, phi) => 0.05 * THREE.MathUtils.smoothstep(y, 0.5, 0.37) * Math.sin(phi * 9 + 0.6));
  skirt.scale(1, 1, 0.82);
  const skirtMat = suitMat.clone();
  skirtMat.side = THREE.DoubleSide;
  mesh(spine, grime(fabricUV(skirt, 1.1, 0.2), H), skirtMat);

  // --- SCBA: backplate, harness, cylinder, hose ------------------------------
  const backZ = -torsoR(0.3) * TORSO_Z;
  const harness = new Parts();
  harness.box(V(0, 0.27, backZ - 0.016), [0.2, 0.42, 0.022]); // backplate
  const centre = V(0, 0.25, 0);
  for (const s of [-1, 1]) {
    strap(harness, [
      V(s * 0.075, 0.42, backZ - 0.01), V(s * 0.1, 0.475, -0.075), V(s * 0.105, 0.49, 0.03),
      V(s * 0.1, 0.43, torsoR(0.43) * TORSO_Z + 0.012), V(s * 0.095, 0.3, torsoR(0.3) * TORSO_Z + 0.014),
      V(s * 0.1, 0.17, torsoR(0.17) * TORSO_Z + 0.02),
    ], 0.042, 0.008, centre);
    // Waist strap round to the buckle.
    strap(harness, [V(s * 0.09, 0.1, backZ - 0.012), V(s * 0.17, 0.11, -0.04), V(s * 0.16, 0.12, 0.08)], 0.04, 0.008, centre);
  }
  strap(harness, [V(-0.1, 0.33, torsoR(0.33) * TORSO_Z + 0.016), V(0.1, 0.33, torsoR(0.33) * TORSO_Z + 0.016)], 0.022, 0.006, centre);
  mesh(spine, harness.merge(), webbingMat);
  const buckles = new Parts();
  buckles.box(V(0, 0.33, torsoR(0.33) * TORSO_Z + 0.022), [0.035, 0.03, 0.01]);
  for (const s of [-1, 1]) buckles.box(V(s * 0.095, 0.38, torsoR(0.38) * TORSO_Z + 0.02), [0.03, 0.02, 0.01]);
  mesh(spine, buckles.merge(), darkMetalMat);

  const tank = new THREE.Group();
  tank.position.set(0, 0.27, backZ - 0.105);
  tank.rotation.x = 0.04;
  spine.add(tank);
  const tankH = 0.21, tankR = 0.074;
  const cyl: [number, number][] = [[0.001, -tankH - 0.03], [0.04, -tankH - 0.02], [0.066, -tankH + 0.005], [tankR, -tankH + 0.04], [tankR, tankH - 0.04], [0.066, tankH - 0.005], [0.04, tankH + 0.02], [0.016, tankH + 0.035], [0.001, tankH + 0.036]];
  mesh(tank, lathe(cyl, 28, 40, 0), tankMat);
  mesh(tank, band(tankR, -0.07, 0.025, 0.004, 1, 28), darkMetalMat);
  mesh(tank, band(tankR, 0.11, 0.025, 0.004, 1, 28), darkMetalMat);
  const valve = new Parts();
  valve.limb(V(0, -tankH - 0.02, 0), V(0, -tankH - 0.07, 0), 0.016, 1, 10);
  valve.box(V(0, -tankH - 0.075, 0), [0.05, 0.03, 0.035]);
  valve.limb(V(0.025, -tankH - 0.075, 0), V(0.05, -tankH - 0.075, 0), 0.008, 1, 8);
  mesh(tank, valve.merge(), metalMat);
  const wheel = mesh(tank, new THREE.TorusGeometry(0.02, 0.006, 6, 16), darkMetalMat, 0.055, -tankH - 0.075, 0);
  wheel.rotation.y = Math.PI / 2;
  const gauge = mesh(tank, new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14), darkMetalMat, -0.04, -tankH - 0.07, 0.01);
  gauge.rotation.z = Math.PI / 2;

  // Corrugated hose from the valve, up beside the cylinder and over the right
  // shoulder under the hood skirt, to the regulator at the chin (clear of the arm).
  {
    const curve = new THREE.CatmullRomCurve3([
      V(0.05, 0.27 - tankH - 0.075, backZ - 0.105), V(0.1, 0.1, backZ - 0.07), V(0.11, 0.3, backZ - 0.07),
      V(0.1, 0.45, -0.16), V(0.085, 0.52, -0.06), V(0.075, 0.52, 0.06), V(0.045, 0.47, 0.15),
    ]);
    const hose = new Parts();
    const n = 44;
    let prev = curve.getPoint(0);
    for (let i = 1; i <= n; i++) {
      const p = curve.getPoint(i / n);
      hose.limb(prev, p, i % 2 ? 0.0135 : 0.016, i % 2 ? 1.18 : 0.85, 8);
      prev = p;
    }
    mesh(spine, hose.merge(), rubberMat);
  }

  // --- Head: hood, face shield and whoever is inside --------------------------
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.49, 0.005);
  spine.add(head);
  const helmet = new THREE.Group();
  helmet.position.set(0, 0.115, 0.012);
  helmet.scale.copy(HOOD_SCALE);
  head.add(helmet);

  const inWindow = (v: THREE.Vector3, margin = 0) => {
    const r = v.length();
    const th = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
    const phi = Math.atan2(v.z, -v.x);
    return phi > WIN.phi0 - margin && phi < WIN.phi1 + margin && th > WIN.th0 - margin && th < WIN.th1 + margin;
  };
  {
    const sphere = new THREE.SphereGeometry(HOOD_R, 40, 28);
    // Fabric wrinkles and a hood that gathers in towards the neck; the window edge stays true.
    const pos = sphere.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const awayFromWindow = 1 - THREE.MathUtils.smoothstep(n.z, 0.35, 0.75);
      let k = 1 + awayFromWindow * (0.025 * Math.sin(n.x * 11 + n.y * 7) * Math.sin(n.y * 13 - n.z * 5) + 0.015 * Math.sin(Math.atan2(n.x, n.z) * 8));
      if (n.y < -0.55) k *= 1 - (-n.y - 0.55) * 0.35; // gathers in at the neck
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    // Cut the window out.
    const index = sphere.getIndex()!;
    const keep: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i));
      b.fromBufferAttribute(pos, index.getX(i + 1));
      c.fromBufferAttribute(pos, index.getX(i + 2));
      if (!inWindow(a.add(b).add(c).divideScalar(3))) keep.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
    sphere.setIndex(keep);
    sphere.computeVertexNormals();
    fabricUV(sphere, 1, 0.5);
    grime(sphere, 1.35);
    mesh(helmet, sphere, hoodMat);
    mesh(helmet, sphere, linerMat).castShadow = false;
  }
  // Rubber gasket framing the window.
  {
    const m = 0.07, r = HOOD_R * 1.012;
    const pw = WIN.phi1 - WIN.phi0, tw = WIN.th1 - WIN.th0;
    const strips = [
      new THREE.SphereGeometry(r, 18, 2, WIN.phi0 - m, pw + 2 * m, WIN.th0 - m, m),
      new THREE.SphereGeometry(r, 18, 2, WIN.phi0 - m, pw + 2 * m, WIN.th1, m),
      new THREE.SphereGeometry(r, 2, 12, WIN.phi0 - m, m, WIN.th0, tw),
      new THREE.SphereGeometry(r, 2, 12, WIN.phi1, m, WIN.th0, tw),
    ];
    for (const g of strips) mesh(helmet, g, rubberMat);
    // A row of rivets along the gasket.
    const rivets = new Parts();
    for (let i = 0; i <= 8; i++) {
      const phi = WIN.phi0 + (pw * i) / 8;
      for (const th of [WIN.th0 - m / 2, WIN.th1 + m / 2]) {
        rivets.blob(V(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(r + 0.002), 0.0045, [1, 1, 1], [0, 0, 0], [6, 4]);
      }
    }
    mesh(helmet, rivets.merge(), metalMat).castShadow = false;
  }
  // The face shield: a slightly proud, curved pane of tinted glass.
  {
    const shield = new THREE.SphereGeometry(HOOD_R * 1.022, 24, 14, WIN.phi0 - 0.02, WIN.phi1 - WIN.phi0 + 0.04, WIN.th0 - 0.02, WIN.th1 - WIN.th0 + 0.04);
    const glass = mesh(helmet, shield, glassMat);
    glass.castShadow = false;
    glass.renderOrder = 2;
  }
  // Regulator under the chin, where the hose plugs in.
  {
    const reg = new Parts();
    reg.limb(V(0, -0.118, 0.105), V(0.03, -0.14, 0.13), 0.022, 0.8, 12);
    reg.box(V(0, -0.115, 0.1), [0.05, 0.035, 0.04], [0.5, 0, 0]);
    mesh(helmet, reg.merge(), darkMetalMat);
  }

  // Inside: the drawn face or the linked image, or else the explorer's own face behind a half-mask.
  const imageUrl = faceImageUrl(opts.face);
  if (imageUrl || hasFace(opts.face)) {
    const plane = new THREE.PlaneGeometry(0.165, 0.165);
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, emissive: 0xffffff, emissiveIntensity: 0.08 });
    const facePlane = mesh(helmet, plane, faceMat, 0, -0.004, HOOD_R * 0.84);
    facePlane.castShadow = false;
    if (imageUrl) {
      faceMat.visible = false; // until (unless) the picture arrives
      loadFaceImage(imageUrl, faceMat);
    } else if (opts.face) {
      const c = document.createElement("canvas");
      c.width = c.height = FACE_SIZE;
      const g = c.getContext("2d");
      if (g) drawFace(g, opts.face);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      faceMat.map = tex;
      faceMat.emissiveMap = tex;
      faceMat.alphaTest = 0.5;
    }
  } else {
    buildInnerFace(helmet, rubberMat);
  }

  // --- Arms -------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const pre = side < 0 ? "l" : "r";
    const shoulder = new THREE.Group();
    shoulder.name = `${pre}Arm`;
    shoulder.position.set(side * 0.185, 0.43, -0.004);
    spine.add(shoulder);
    const shoulderY = H + 0.43;
    const upper = sleeve(0.26, 0.064, 0.053, 0.95, 0.09, 20);
    mesh(shoulder, grime(fabricUV(upper, 0.4, 0.26), shoulderY), suitMat);

    const elbow = new THREE.Group();
    elbow.name = `${pre}Forearm`;
    elbow.position.y = -0.26;
    shoulder.add(elbow);
    const elbowY = shoulderY - 0.26;
    const fore = sleeve(0.15, 0.054, 0.049, 0.05, 0.11, 20);
    mesh(elbow, grime(fabricUV(fore, 0.34, 0.15), elbowY), suitMat);

    // Glove gauntlet pulled over the sleeve, taped at the seam.
    const gauntlet = lathe([[0.042, -0.225], [0.046, -0.2], [0.05, -0.16], [0.055, -0.125], [0.058, -0.115]], 18, 12);
    mesh(elbow, gauntlet, rubberMat);
    mesh(elbow, band(0.055, -0.128, 0.03, 0.004, 1, 18), tapeMat);

    const holdsTorch = side > 0;
    mesh(elbow, gloveHand(side, holdsTorch), rubberMat);
    if (holdsTorch) buildTorch(elbow, darkMetalMat, metalMat);
  }

  // --- Legs -------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const pre = side < 0 ? "l" : "r";
    const hip = new THREE.Group();
    hip.name = `${pre}Leg`;
    hip.position.set(side * 0.088, -0.01, 0);
    hips.add(hip);
    const hipY = H - 0.01;
    const thigh = sleeve(0.34, 0.09, 0.066, 0.97, 0.08, 22);
    mesh(hip, grime(fabricUV(thigh, 0.55, 0.34), hipY), suitMat);

    const knee = new THREE.Group();
    knee.name = `${pre}Shin`;
    knee.position.y = -0.33;
    hip.add(knee);
    const kneeY = hipY - 0.33;
    const shin = sleeve(0.2, 0.067, 0.058, 0.05, 0.1, 22);
    mesh(knee, grime(fabricUV(shin, 0.42, 0.2), kneeY), suitMat);
    mesh(knee, band(0.064, -0.085, 0.026, 0.005, 1, 22), reflectMat);

    // Rubber boot, taped to the trouser leg.
    const shaft = lathe([[0.056, -0.36], [0.058, -0.3], [0.06, -0.22], [0.064, -0.155], [0.068, -0.145]], 20, 14);
    mesh(knee, shaft, rubberMat);
    mesh(knee, band(0.066, -0.16, 0.032, 0.004, 1, 20), tapeMat);
    const foot = new Parts();
    foot.blob(V(0, -0.355, 0.035), 1, [0.052, 0.042, 0.11], [0, 0, 0], [16, 10]);
    foot.blob(V(0, -0.362, 0.115), 1, [0.05, 0.036, 0.055], [0, 0, 0], [14, 8]);
    foot.box(V(0, -0.388, 0.035), [0.104, 0.024, 0.255]); // sole
    foot.box(V(0, -0.379, -0.06), [0.09, 0.03, 0.07]); // heel
    for (let i = 0; i < 6; i++) foot.box(V(0, -0.4005, -0.07 + i * 0.04), [0.1, 0.004, 0.012]); // tread
    mesh(knee, foot.merge(), rubberMat);
  }

  // Wardrobe anchors: the accessories were authored for the old blocky suit
  // (head: a 0.2 m helmet sphere; body: a 0.9 m torso cylinder of ~0.245 m
  // radius from the hips). These frames map those coordinates onto this body.
  const headAnchor = new THREE.Group();
  headAnchor.position.copy(helmet.position);
  headAnchor.scale.setScalar((HOOD_R * 1.05) / 0.2);
  head.add(headAnchor);
  const bodyAnchor = new THREE.Group();
  bodyAnchor.position.set(0, 0.03, 0);
  bodyAnchor.scale.set(0.8, 0.65, 0.62);
  spine.add(bodyAnchor);
  const backAnchor = new THREE.Group();
  backAnchor.position.set(0, 0.03, -0.08);
  backAnchor.scale.set(0.8, 0.65, 0.9);
  spine.add(backAnchor);

  return { hips, spine, head, headAnchor, bodyAnchor, backAnchor };
}

/** The explorer's own face inside the hood: pale, tired, breathing through a half-mask. */
function buildInnerFace(helmet: THREE.Group, rubberMat: THREE.Material) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc69a83, roughness: 0.62 });
  const skull = mesh(helmet, sculptedHead(0.085), skinMat, 0, 0.0, 0.035);
  skull.scale.set(0.92, 1.12, 1);
  skull.castShadow = false;
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.25 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.15 });
  const brow = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.95 });
  const eyes = new Parts(), irises = new Parts(), brows = new Parts();
  for (const s of [-1, 1]) {
    eyes.blob(V(s * 0.03, 0.018, 0.106), 0.0115, [1.15, 0.8, 0.7], [0, 0, 0], [12, 8]);
    irises.blob(V(s * 0.029, 0.018, 0.114), 0.0055, [1, 1, 0.5], [0, 0, 0], [10, 6]);
    brows.limb(V(s * 0.016, 0.037, 0.112), V(s * 0.046, 0.034, 0.104), 0.0045, 0.7, 6);
  }
  mesh(helmet, eyes.merge(), eyeWhite).castShadow = false;
  mesh(helmet, irises.merge(), iris).castShadow = false;
  mesh(helmet, brows.merge(), brow).castShadow = false;
  // Half-mask respirator over nose and mouth, a filter cartridge each side.
  const mask = new Parts();
  mask.blob(V(0, -0.034, 0.108), 0.04, [1.05, 0.95, 0.75], [0.2, 0, 0], [16, 12]);
  mask.limb(V(-0.072, 0.0, 0.05), V(0.072, 0.0, 0.05), 0.004, 1, 6); // head strap
  mesh(helmet, mask.merge(), rubberMat).castShadow = false;
  const filters = new Parts();
  for (const s of [-1, 1]) filters.limb(V(s * 0.03, -0.045, 0.115), V(s * 0.052, -0.05, 0.132), 0.017, 1, 14);
  filters.limb(V(0, -0.055, 0.14), V(0, -0.058, 0.147), 0.012, 1, 12); // exhale valve
  mesh(helmet, filters.merge(), new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.55, metalness: 0.4 })).castShadow = false;
}

/** A thick rubber glove, fingers hanging loosely — or wrapped round the flashlight's barrel. */
function gloveHand(side: number, fist: boolean): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const m = -side; // towards the body: the palm's side
  const p = new Parts();
  p.blob(V(0, -0.258, 0.004), 1, [0.027, 0.05, 0.045], [0, 0, 0], [14, 10]);
  for (let f = 0; f < 4; f++) {
    const z = 0.03 - f * 0.02;
    const len = f === 0 || f === 3 ? 0.85 : 1;
    const k = V(0, -0.298, z);
    if (fist) {
      // Wrapped round the barrel (which runs along -Y, just on the palm side).
      p.chain([k, V(m * 0.018, -0.308, z * 1.05), V(m * 0.03, -0.3, z * 1.05), V(m * 0.026, -0.288, z)], 0.0115, 0.0095, 8);
    } else {
      const mid = V(m * 0.006, -0.298 - 0.04 * len, z * 1.08);
      const tip = V(m * 0.019, -0.298 - 0.072 * len, z * 1.12);
      p.chain([k, mid, tip], 0.0115, 0.0092, 8);
    }
  }
  // Thumb, across the front.
  if (fist) p.chain([V(m * 0.012, -0.242, 0.036), V(m * 0.028, -0.266, 0.045), V(m * 0.034, -0.286, 0.03)], 0.012, 0.0105, 8);
  else p.chain([V(m * 0.012, -0.242, 0.036), V(m * 0.022, -0.278, 0.055), V(m * 0.024, -0.305, 0.058)], 0.012, 0.0105, 8);
  return p.merge();
}

/** A metal flashlight held in the fist, barrel along the forearm, lens out past the little finger. */
function buildTorch(forearm: THREE.Group, bodyMat: THREE.Material, bezelMat: THREE.Material) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const x = -0.024; // right hand: on the palm side (-X)
  const body = new Parts();
  body.limb(V(x, -0.2, 0.0), V(x, -0.36, 0.0), 0.0145, 1, 14);
  for (let i = 0; i < 5; i++) body.limb(V(x, -0.215 - i * 0.012, 0), V(x, -0.22 - i * 0.012, 0), 0.0158, 1, 14); // knurling
  body.limb(V(x, -0.2, 0), V(x, -0.195, 0), 0.016, 1, 14); // tail cap
  mesh(forearm, body.merge(), bodyMat);
  const head = new THREE.LatheGeometry([
    new THREE.Vector2(0.0145, -0.36), new THREE.Vector2(0.021, -0.385), new THREE.Vector2(0.023, -0.41), new THREE.Vector2(0.019, -0.412),
  ], 16);
  mesh(forearm, head, bezelMat, x, 0, 0);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 16), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 0.9, roughness: 0.1 }));
  lens.position.set(x, -0.411, 0);
  lens.rotation.x = Math.PI / 2;
  forearm.add(lens);
}

/**
 * Loads a face picture from its link onto the face plane. Cross-origin: the
 * host has to allow it (CORS), as WebGL can't use an image it may not read —
 * if it doesn't, or the link is broken, the face simply stays hidden behind
 * the dark glass. A cover-fit crop keeps the picture square.
 */
function loadFaceImage(url: string, mat: THREE.MeshStandardMaterial) {
  let dead = false;
  mat.addEventListener("dispose", () => { dead = true; });
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(url, (tex) => {
    if (dead) { tex.dispose(); return; }
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = tex.image as { width?: number; height?: number } | undefined;
    const w = img?.width ?? 1, h = img?.height ?? 1;
    if (w > h) { tex.repeat.set(h / w, 1); tex.offset.set((1 - h / w) / 2, 0); }
    else if (h > w) { tex.repeat.set(1, w / h); tex.offset.set(0, (1 - w / h) / 2); }
    mat.map = tex;
    mat.emissiveMap = tex;
    mat.alphaTest = 0.1; // transparent PNGs show the dark hood lining through
    mat.visible = true;
    mat.needsUpdate = true;
  }, undefined, () => { /* blocked by CORS or broken link: keep the plain dark visor */ });
}
