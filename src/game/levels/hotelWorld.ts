import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import { createOfficeWindowMaterial, setOfficeWindowOutlook, setOfficeWindowState, type OfficeSkyline } from "../officeWindow";
import { t } from "../../i18n";
import { createHotelState, hotelBlocked, hotelPuzzle, HOTEL_TILES, type HotelState } from "../../shared/hotel";
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_GUEST_ROOMS, HOTEL_RECEPTION, HOTEL_STAIRS, HOTEL_STEAM, HOTEL_TABLE, HOTEL_VALVES, hotelCardSpot, hotelCenter, hotelFloorAt, hotelRng, hotelRoomPoint, hotelRoomSide, hotelZone, type HotelGuestRoom, type HotelZone } from "./hotelLayout";

interface HotelEnv {
  kit: DecorKit; seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number): DynamicLightSource;
  addObstacle(gx: number, gz: number, x: number, z: number, radius: number): void;
}
interface Door { mesh: THREE.Group; blank: THREE.Object3D | null; leaves: THREE.Object3D[]; gx: number; gz: number; open: number; alcove: number }
/** A piece of furniture placed in world space; it is built by the cell that contains (x, z). */
interface Piece { x: number; z: number; yaw: number; y?: number; build(): THREE.Object3D; blocks?: [number, number, number][] }
type FixtureStyle = "chandelier" | "dome" | "cage";
/**
 * The four clue portraits, in order: two each on the reception's back wall
 * (north wall of cells 4,2 and 6,2), flanking the desk so players see them on spawn.
 */
const GALLERY = [{ gx: 4, x: -0.9 }, { gx: 4, x: 0.9 }, { gx: 6, x: -0.9 }, { gx: 6, x: 0.9 }];
const GALLERY_Z = 2;
/** How far a fully open leaf swings: flat against the wall beside its frame. */
const DOOR_OPEN_ANGLE = Math.PI * 0.97;
/** Beverly Room columns, on cell corners (world metres) so they never sit on a walking line. */
const BEVERLY_COLUMNS = [[140, 32], [164, 32], [140, 56], [164, 56]];
const BEVERLY_ROUND_TABLES = [[33, 6], [42, 6], [33, 15], [42, 15]];
const BEVERLY_BAR = [33, 34, 35];
const isReception = (gx: number, gz: number) => gx >= 2 && gx <= 8 && gz >= 2 && gz <= 7;
/** Guest room window glass (m) and its sill height. */
const GLASS_W = 2.2, GLASS_H = 2.0, GLASS_SILL = 0.8;

/** A cell-streamed hotel: all assets share the map's geometry/material lifetime. */
export class HotelWorld {
  readonly seed: number;
  readonly puzzle: ReturnType<typeof hotelPuzzle>;
  state = createHotelState();
  now = 0;
  ready = false;
  departed = false;
  departureZ = 0;
  bellmanMode = 0;
  private kit: DecorKit;
  private doors: Door[] = [];
  private lights: { source: DynamicLightSource; bulb: THREE.Object3D; zone: HotelZone }[] = [];
  private cells: { group: THREE.Group; zone: HotelZone }[] = [];
  private tiles: { mesh: THREE.Object3D; index: number; placed: boolean }[] = [];
  private wheels: THREE.Object3D[] = [];
  private needles: THREE.Object3D[] = [];
  private steam: THREE.Group[] = [];
  private oddDoors: THREE.Object3D[] = [];
  private returnWall: THREE.Object3D | null = null;
  private key: THREE.Group | null = null;
  private boxLid: THREE.Mesh | null = null;
  private roomPieces = new Map<number, Piece[]>();
  /** The Abandoned Office's storm glass (rain, drops, the far city), shared by every room window. */
  private glass: THREE.ShaderMaterial | null = null;
  private skyline: OfficeSkyline | null = null;
  private outlookApplied = false;
  // Surfaces.
  private wood: THREE.Material;
  private brass: THREE.Material;
  private metal: THREE.Material;
  private cream: THREE.Material;
  private red: THREE.Material;
  private linen: THREE.Material;
  private hallPaper: THREE.Material;
  private roomPaper: THREE.Material;
  private carpet: THREE.Material;
  private parquet: THREE.Material;
  private marble: THREE.Material;
  private ceiling: THREE.Material;
  private plate: THREE.Material;
  private grate: THREE.Material;

  constructor(private env: HotelEnv) {
    this.seed = env.seed; this.puzzle = hotelPuzzle(env.seed); this.kit = env.kit;
    this.brass = this.mat("brass", 0xb08a45, 0.32, 0.7);
    this.metal = this.mat("iron", 0x3a4341, 0.6, 0.6);
    this.cream = this.mat("plaster", 0xd2c4a4, 0.8);
    this.red = this.mat("velvet", 0x6e1d26, 0.95);
    this.linen = this.mat("linen", 0xe6dfcf, 0.9);
    this.wood = this.texture("wood", 256, 256, g => this.drawWood(g), 0.55);
    this.hallPaper = this.texture("hall_paper", 256, 512, g => this.drawDamask(g), 0.75);
    this.roomPaper = this.texture("room_paper", 256, 512, g => this.drawStripes(g), 0.8);
    this.carpet = this.texture("carpet", 512, 512, g => this.drawHexCarpet(g), 1);
    this.parquet = this.texture("parquet", 256, 256, g => this.drawParquet(g), 0.6);
    this.marble = this.texture("marble", 512, 512, g => this.drawMarble(g), 0.25, 0.05);
    this.ceiling = this.texture("ceiling", 256, 256, g => this.drawCoffer(g), 0.9);
    this.plate = this.texture("plate", 256, 256, g => this.drawPlate(g), 0.55, 0.55);
    this.grate = this.texture("grate", 256, 256, g => this.drawTreadPlate(g), 0.5, 0.6);
  }

  // --- Materials and procedural textures --------------------------------------
  private mat(key: string, color: number, roughness = 0.8, metalness = 0) {
    return this.kit.mat(`hotel_${key}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  private texture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, roughness = 0.8, metalness = 0) {
    return this.kit.mat(`hotel_tex_${key}`, () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      draw(c.getContext("2d")!);
      const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; this.kit.track(map);
      return new THREE.MeshStandardMaterial({ map, roughness, metalness });
    });
  }
  /** Burgundy damask between gold pinstripes: the corridors and halls. */
  private drawDamask(g: CanvasRenderingContext2D) {
    g.fillStyle = "#4e191d"; g.fillRect(0, 0, 256, 512);
    g.fillStyle = "#9d7b40"; g.fillRect(0, 0, 5, 512); g.fillRect(251, 0, 5, 512); g.fillRect(12, 0, 2, 512); g.fillRect(242, 0, 2, 512);
    for (let y = -64; y <= 576; y += 128) {
      g.strokeStyle = "#7b3a2e"; g.lineWidth = 4; g.beginPath();
      g.moveTo(128, y - 56); g.lineTo(196, y); g.lineTo(128, y + 56); g.lineTo(60, y); g.closePath(); g.stroke();
      g.fillStyle = "#8a6232";
      g.beginPath(); g.ellipse(128, y - 14, 9, 22, 0, 0, Math.PI * 2); g.fill();
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(128 + s * 18, y + 4, 7, 16, s * 0.7, 0, Math.PI * 2); g.fill(); }
      g.fillRect(118, y + 18, 20, 4);
    }
  }
  /** Muted green with cream double stripes: the guest rooms. */
  private drawStripes(g: CanvasRenderingContext2D) {
    g.fillStyle = "#33463a"; g.fillRect(0, 0, 256, 512);
    g.fillStyle = "#c9bb92";
    for (const x of [30, 38, 158, 166]) g.fillRect(x, 0, 3, 512);
    g.fillStyle = "#4b5f4c";
    for (let y = 16; y < 512; y += 32) for (const x of [98, 226]) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
  }
  /** Interlocking hexagons in rust, orange and brown, the old hotel-corridor pattern. */
  private drawHexCarpet(g: CanvasRenderingContext2D) {
    g.fillStyle = "#6a1f13"; g.fillRect(0, 0, 512, 512);
    const hex = (cx: number, cy: number, rx: number, ry: number) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
      g.closePath();
    };
    for (let col = -1; col <= 9; col++) for (let row = -1; row <= 9; row++) {
      const cx = col * 64, cy = row * 64 + (col % 2 ? 32 : 0);
      g.lineWidth = 7; g.strokeStyle = "#c86b2b"; hex(cx, cy, 40, 34); g.stroke();
      g.fillStyle = "#2c0f09"; hex(cx, cy, 24, 20); g.fill();
      g.fillStyle = "#c86b2b"; hex(cx, cy, 9, 8); g.fill();
    }
  }
  private drawWood(g: CanvasRenderingContext2D) {
    g.fillStyle = "#3b1c12"; g.fillRect(0, 0, 256, 256);
    const rng = hotelRng(0x600d);
    for (let i = 0; i < 70; i++) {
      const y = rng() * 256, amp = 2 + rng() * 5, phase = rng() * 6;
      g.strokeStyle = rng() < 0.5 ? "rgba(20,8,4,0.45)" : "rgba(120,62,36,0.35)"; g.lineWidth = 0.6 + rng() * 1.6;
      g.beginPath(); for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / 40 + phase) * amp); g.stroke();
    }
  }
  private drawParquet(g: CanvasRenderingContext2D) {
    g.fillStyle = "#4a2615"; g.fillRect(0, 0, 256, 256);
    const rng = hotelRng(0x9a7);
    for (let by = 0; by < 256; by += 64) for (let bx = 0; bx < 256; bx += 64) {
      const vertical = ((bx + by) / 64) % 2 === 0;
      for (let i = 0; i < 4; i++) {
        const shade = 60 + Math.floor(rng() * 30);
        g.fillStyle = `rgb(${shade + 20},${Math.floor(shade * 0.55)},${Math.floor(shade * 0.3)})`;
        if (vertical) g.fillRect(bx + i * 16 + 1, by + 1, 14, 62); else g.fillRect(bx + 1, by + i * 16 + 1, 62, 14);
      }
    }
  }
  private drawMarble(g: CanvasRenderingContext2D) {
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#1b1817" : "#d9d2c1"; g.fillRect(x * 128, y * 128, 128, 128); }
    const rng = hotelRng(0x3a8b1e);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(128,120,110,${0.15 + rng() * 0.25})`; g.lineWidth = 0.8 + rng() * 1.5;
      let x = rng() * 512, y = rng() * 512; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (rng() - 0.3) * 60; y += (rng() - 0.5) * 50; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = "#a88a4a"; g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  }
  private drawCoffer(g: CanvasRenderingContext2D) {
    g.fillStyle = "#cdbf9f"; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#a29070"; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246);
    g.lineWidth = 3; g.strokeRect(26, 26, 204, 204);
    g.strokeStyle = "#b5a37f"; for (const r of [34, 20]) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  }
  private drawPlate(g: CanvasRenderingContext2D) {
    g.fillStyle = "#3d4743"; g.fillRect(0, 0, 256, 256);
    const rng = hotelRng(0x91a7e);
    for (let i = 0; i < 18; i++) {
      const x = rng() * 256, top = rng() * 200, grad = g.createLinearGradient(0, top, 0, top + 90);
      grad.addColorStop(0, "rgba(120,62,28,0.45)"); grad.addColorStop(1, "rgba(120,62,28,0)");
      g.fillStyle = grad; g.fillRect(x, top, 3 + rng() * 6, 90);
    }
    g.strokeStyle = "#232927"; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
    g.fillStyle = "#6d7772";
    for (let i = 16; i < 256; i += 30) for (const [x, y] of [[i, 12], [i, 244], [12, i], [244, i], [118, i], [138, i]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  }
  private drawTreadPlate(g: CanvasRenderingContext2D) {
    g.fillStyle = "#2b302e"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#4b5450";
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
      const flip = (x + y) / 32 % 2;
      g.save(); g.translate(x + 16, y + 16); g.rotate(flip ? Math.PI / 4 : -Math.PI / 4); g.fillRect(-10, -2.5, 20, 5); g.restore();
    }
  }
  /** A canvas-textured plane: night-sky windows, paintings, gauges and rugs. */
  private picture(key: string, w: number, h: number, px: number, draw: (g: CanvasRenderingContext2D, cw: number, ch: number) => void, glow = false) {
    const material = this.kit.mat(`hotel_pic_${key}`, () => {
      const c = document.createElement("canvas"); c.width = px; c.height = Math.round(px * h / w);
      draw(c.getContext("2d")!, c.width, c.height);
      const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; this.kit.track(map);
      return glow ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
    });
    return new THREE.Mesh(this.kit.geo(`hotel_plane_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)), material);
  }

  // --- Primitives -----------------------------------------------------------
  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(this.kit.geo(`hotel_box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z); mesh.receiveShadow = true; return mesh;
  }
  private cylinder(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, top = r) {
    const m = new THREE.Mesh(this.kit.geo(`hotel_cyl_${top}_${r}_${h}`, () => new THREE.CylinderGeometry(top, r, h, 14)), mat); m.position.set(x, y, z); return m;
  }
  private sign(text: string, w = 2, h = 0.8, paper = false, maxFont = 72) {
    const material = this.kit.mat(`hotel_text_${text}_${paper}_${maxFont}`, () => {
      const c = document.createElement("canvas"); c.width = 768; c.height = Math.max(192, Math.round(768 * h / w));
      const g = c.getContext("2d")!; g.fillStyle = paper ? "#e5d5af" : "#20120c"; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = paper ? "#513824" : "#c9a65e"; g.lineWidth = 8; g.strokeRect(12, 12, c.width - 24, c.height - 24);
      const lines = text.split("\n"); g.fillStyle = g.strokeStyle; g.textAlign = "center"; g.textBaseline = "middle";
      const size = Math.min(maxFont, (c.height - 35) / lines.length * 0.8); g.font = `${size}px Georgia, serif`;
      lines.forEach((line, i) => g.fillText(line, c.width / 2, 20 + (c.height - 40) * (i + 0.5) / lines.length, c.width - 48));
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this.kit.track(tex);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide });
    });
    return new THREE.Mesh(this.kit.geo(`hotel_sign_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)), material);
  }
  /** Registers a collision circle in every cell it overlaps (world metres). */
  private block(x: number, z: number, r: number) {
    for (let gx = Math.floor((x - r) / 4); gx <= Math.floor((x + r) / 4); gx++) {
      for (let gz = Math.floor((z - r) / 4); gz <= Math.floor((z + r) / 4); gz++) this.env.addObstacle(gx, gz, x, z, r);
    }
  }

  // --- Doors ----------------------------------------------------------------
  /**
   * A real-sized door: brass frame, a number plate on both faces and one or two
   * leaves on hinge pivots. Leaves swing towards `swing` (+1 = the front, +z).
   */
  private door(label: string, { width = 1.1, height = 2.3, double = false, industrial = false, swing = 1 } = {}) {
    const g = new THREE.Group(), leaves: THREE.Object3D[] = [];
    for (const s of [-1, 1]) g.add(this.box(0.1, height + 0.1, 0.24, this.brass, s * (width / 2 + 0.05), (height + 0.1) / 2));
    g.add(this.box(width + 0.2, 0.1, 0.24, this.brass, 0, height + 0.05));
    const count = double ? 2 : 1, leafW = width / count - 0.02;
    for (let i = 0; i < count; i++) {
      const hinge = double && i === 1 ? 1 : -1;
      const pivot = new THREE.Group(); pivot.position.x = hinge * width / 2;
      pivot.userData.dir = -hinge * swing; pivot.userData.swing = swing;
      const leaf = new THREE.Group(); leaf.position.x = -hinge * (leafW / 2 + 0.01);
      leaf.add(this.box(leafW, height - 0.02, 0.06, industrial ? this.metal : this.wood, 0, height / 2));
      for (const z of [-0.035, 0.035]) {
        for (const y of [0.3, 0.72]) leaf.add(this.box(leafW * 0.7, height * 0.3, 0.02, industrial ? this.metal : this.red, 0, height * y, z));
        leaf.add(this.box(0.07, 0.07, 0.08, this.brass, -hinge * (leafW / 2 - 0.12), 1.05, z * 2));
      }
      pivot.add(leaf); g.add(pivot); leaves.push(pivot);
    }
    this.swingLeaves(leaves, 0);
    if (label) for (const side of [1, -1]) {
      const sign = this.sign(label, Math.min(1.5, width + 0.3), 0.36);
      sign.position.set(0, height + 0.32, side * 0.13); sign.rotation.y = side > 0 ? 0 : Math.PI; g.add(sign);
    }
    return { group: g, leaves };
  }
  /** 0 = shut in the frame, 1 = folded back against the wall. */
  private swingLeaves(leaves: THREE.Object3D[], open: number) {
    for (const pivot of leaves) {
      pivot.rotation.y = pivot.userData.dir * open * DOOR_OPEN_ANGLE;
      pivot.position.z = pivot.userData.swing * (0.04 + 0.09 * Math.min(1, open * 4)); // clear of the wall once open
    }
  }
  /**
   * A cell-wide wall with a doorway cut into it, plus collision posts along the
   * solid parts so only the doorway itself can be walked through. Each face can
   * carry its own wallpaper (corridor in front, bedroom behind).
   */
  private doorway(holder: THREE.Group, gx: number, gz: number, h: number, opening: number, doorH: number, front: THREE.Material, back = front, wainscot = true) {
    const half = opening / 2 + 0.1, side = 2 - half;
    const panel = (w: number, ph: number, x: number, y: number) => {
      holder.add(this.box(w, ph, 0.08, front, x, y, 0.04)); holder.add(this.box(w, ph, 0.08, back, x, y, -0.04));
    };
    for (const s of [-1, 1]) {
      const x = s * (half + side / 2);
      panel(side, h, x, h / 2);
      if (wainscot) {
        holder.add(this.box(side, 1, 0.22, this.wood, x, 0.5));
        for (const y of [0.1, 1, h - 0.2]) holder.add(this.box(side, 0.055, 0.26, this.brass, x, y));
      }
      const posts = Math.ceil(side / 0.4);
      for (let i = 0; i < posts; i++) {
        const along = s * (half + 0.25 + (side - 0.25) * i / Math.max(1, posts - 1));
        // Holder-local (along, 0) -> world, through the holder's yaw and offset.
        const p = hotelCenter(gx, gz), yaw = holder.rotation.y;
        this.env.addObstacle(gx, gz, p.x + holder.position.x + along * Math.cos(yaw), p.z + holder.position.z - along * Math.sin(yaw), 0.25);
      }
    }
    panel(half * 2, h - doorH - 0.1, 0, (h + doorH + 0.1) / 2);
  }

  // --- Decor ------------------------------------------------------------------
  private portrait(symbol: string, ordinal: number) {
    const g = new THREE.Group(); g.add(this.box(1.5, 1.9, 0.12, this.brass, 0, 0, 0));
    // A clue portrait shows its place in the order and its suit, large enough to read from the desk.
    const p = symbol ? this.sign(`${["I", "II", "III", "IV"][ordinal - 1] ?? ordinal}\n${symbol}`, 1.32, 1.7, false, 380)
      : this.sign(`${ordinal}`, 1.32, 1.7);
    p.position.z = 0.08; g.add(p);
    // Decorative portraits: unnaturally pale eyes, pupils looking towards the aisle.
    if (!symbol) for (const x of [-0.19, 0.19]) {
      g.add(this.box(0.2, 0.09, 0.02, this.cream, x, 0.25, 0.095));
      g.add(this.box(0.055, 0.085, 0.022, this.wood, x + 0.025, 0.25, 0.11));
    }
    return g;
  }
  private landscape() {
    const g = new THREE.Group(); g.add(this.box(1.5, 1.0, 0.07, this.brass));
    const art = this.picture("landscape", 1.36, 0.86, 256, (c, w, h) => {
      const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#3b2f4a"); sky.addColorStop(1, "#c77a45"); c.fillStyle = sky; c.fillRect(0, 0, w, h);
      c.fillStyle = "#2c2a22"; c.beginPath(); c.moveTo(0, h); c.lineTo(0, h * 0.62); c.quadraticCurveTo(w * 0.3, h * 0.45, w * 0.55, h * 0.66); c.quadraticCurveTo(w * 0.8, h * 0.5, w, h * 0.6); c.lineTo(w, h); c.fill();
      c.fillStyle = "#e7c27a"; c.beginPath(); c.arc(w * 0.7, h * 0.35, h * 0.08, 0, Math.PI * 2); c.fill();
    });
    art.position.z = 0.04; g.add(art); return g;
  }
  /** What the room windows look out on: the engine renders it once (see officeWindow.buildOfficeSkyline). */
  setSkyline(skyline: OfficeSkyline | null) { this.skyline = skyline; this.outlookApplied = false; }
  private windowGlass() {
    return this.glass ??= this.kit.mat("hotel_window_glass", () => {
      const m = createOfficeWindowMaterial(); m.uniforms.uSize.value.set(GLASS_W, GLASS_H); return m;
    }) as THREE.ShaderMaterial;
  }
  /**
   * A guest room window, set in the back wall (its local +z faces the room): the
   * Abandoned Office's storm glass, so the rain, the drops running down the pane
   * and the city far below all move with the viewer. Wooden sash, brass rail, velvet curtains.
   */
  private stormWindow() {
    const g = new THREE.Group(), cy = GLASS_SILL + GLASS_H / 2, top = GLASS_SILL + GLASS_H, fw = GLASS_W + 0.12;
    const pane = new THREE.Mesh(this.kit.geo(`hotel_plane_${GLASS_W}_${GLASS_H}`, () => new THREE.PlaneGeometry(GLASS_W, GLASS_H)), this.windowGlass());
    pane.position.set(0, cy, 0.02); g.add(pane);
    g.add(this.box(fw, 0.1, 0.14, this.wood, 0, top + 0.04, 0.06));
    g.add(this.box(fw + 0.2, 0.08, 0.3, this.wood, 0, GLASS_SILL - 0.04, 0.14)); // the sill
    g.add(this.box(fw + 0.1, 0.25, 0.06, this.wood, 0, GLASS_SILL - 0.2, 0.05));
    for (const x of [-fw / 2, fw / 2]) g.add(this.box(0.08, GLASS_H + 0.12, 0.14, this.wood, x, cy, 0.06));
    // Sash bars: a centre mullion and a transom near the top, as in a 1930 casement.
    g.add(this.box(0.06, GLASS_H, 0.1, this.wood, 0, cy, 0.06));
    g.add(this.box(GLASS_W, 0.06, 0.1, this.wood, 0, top - 0.55, 0.06));
    g.add(this.box(0.04, 0.12, 0.05, this.brass, 0.1, cy - 0.1, 0.13));
    // Heavy curtains, drawn to the sides, on a brass rail.
    for (const x of [-1, 1]) g.add(this.box(0.5, 3.05, 0.12, this.red, x * (fw / 2 + 0.22), 1.85, 0.2));
    g.add(this.box(fw + 1.2, 0.06, 0.06, this.brass, 0, 3.42, 0.24));
    return g;
  }
  private sconces(wall: THREE.Group, h: number) {
    for (const x of [-1.15, 1.15]) {
      wall.add(this.box(0.14, 0.3, 0.04, this.brass, x, h * 0.58, 0.1));
      wall.add(this.cylinder(0.11, 0.2, this.linen, x, h * 0.58 + 0.18, 0.22, 0.07));
    }
  }
  private plant(g: THREE.Group, x: number, z: number) {
    g.add(this.cylinder(0.3, 0.55, this.brass, x, 0.28, z, 0.36));
    const leaf = this.mat("palm", 0x2f4a26, 0.9);
    for (let i = 0; i < 6; i++) {
      const frond = this.box(0.12, 0.05, 0.9, leaf, x + Math.sin(i) * 0.25, 1.0 + (i % 2) * 0.2, z + Math.cos(i) * 0.25);
      frond.rotation.set(-0.6, i * Math.PI / 3, 0); g.add(frond);
    }
  }
  private chair(mat: THREE.Material = this.red) {
    const g = new THREE.Group();
    g.add(this.box(0.48, 0.08, 0.46, mat, 0, 0.46, 0));
    g.add(this.box(0.48, 0.55, 0.06, this.wood, 0, 0.78, -0.21));
    for (const x of [-0.2, 0.2]) for (const z of [-0.19, 0.19]) g.add(this.box(0.05, 0.44, 0.05, this.wood, x, 0.22, z));
    return g;
  }
  private sofa() {
    const g = new THREE.Group();
    g.add(this.box(3, 0.35, 1, this.wood, 0, 0.3)); g.add(this.box(2.7, 0.2, 0.9, this.red, 0, 0.57));
    g.add(this.box(3, 0.9, 0.25, this.red, 0, 0.9, -0.5));
    for (const x of [-1.4, 1.4]) g.add(this.box(0.25, 0.6, 1.15, this.red, x, 0.7));
    return g;
  }
  /** One ceiling light: the fixture mesh plus a pooled dynamic light at (x, y, z). */
  private fixture(g: THREE.Group, gx: number, gz: number, y: number, zone: HotelZone, style: FixtureStyle, offset = { x: 0, z: 0 }) {
    const root = new THREE.Group(); root.position.set(offset.x, y, offset.z);
    const glow = this.kit.mat("hotel_bulb", () => new THREE.MeshBasicMaterial({ color: 0xffd79b }));
    let bulb: THREE.Object3D;
    if (style === "chandelier") {
      root.add(this.cylinder(0.045, 0.8, this.brass, 0, 0.4));
      bulb = new THREE.Group(); root.add(bulb);
      bulb.add(this.box(0.28, 0.22, 0.28, glow, 0, -0.05));
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, x = Math.cos(a) * 0.75, z = Math.sin(a) * 0.75;
        const arm = this.box(1.5, 0.045, 0.045, this.brass, 0, -0.2); arm.rotation.y = a; root.add(arm);
        root.add(this.cylinder(0.09, 0.3, this.cream, x, 0, z));
        bulb.add(this.box(0.12, 0.16, 0.12, glow, x, 0.22, z));
      }
      for (let i = 0; i < 8; i++) root.add(this.box(0.03, 0.4, 0.03, this.brass, Math.cos(i) * 0.4, -0.45, Math.sin(i) * 0.4));
    } else if (style === "dome") {
      root.position.y = y + 0.82;
      root.add(this.cylinder(0.42, 0.06, this.brass, 0, -0.03));
      bulb = new THREE.Mesh(this.kit.geo("hotel_dome", () => new THREE.SphereGeometry(0.38, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), glow);
      root.add(bulb);
    } else {
      root.add(this.cylinder(0.03, 0.7, this.metal, 0, 0.35));
      bulb = this.box(0.22, 0.3, 0.22, glow, 0, -0.1); root.add(bulb);
      for (const a of [0, Math.PI / 2]) { const cage = this.box(0.32, 0.4, 0.02, this.metal, 0, -0.1); cage.rotation.y = a; root.add(cage); }
    }
    g.add(root);
    const p = hotelCenter(gx, gz);
    const industrial = style === "cage";
    const source = this.env.registerLight(gx, gz, p.x + offset.x, hotelFloorAt(p.x, p.z) + root.position.y - 0.15, p.z + offset.z,
      industrial ? 0xffb76b : 0xffd29a, zone === "beverly" ? 11 : industrial ? 7 : 6.5, zone === "beverly" ? 28 : 18);
    this.lights.push({ source, bulb, zone });
  }

  /**
   * Hall and Beverly walls, varied by position: portraits, sconces, console
   * tables, locked service doors, drapes and mirrors. Nothing that could be
   * mistaken for a puzzle clue.
   */
  private dressWall(wall: THREE.Group, gx: number, gz: number, dx: number, dz: number, zone: HotelZone, h: number) {
    const k = ((gx * 7 + gz * 13 + (dx + 1) * 3 + (dz + 1) * 5) % 7 + 7) % 7;
    if (zone === "beverly") {
      if (k % 2 === 0) {
        for (const x of [-1.1, 1.1]) wall.add(this.box(0.9, h - 0.6, 0.16, this.red, x, (h - 0.6) / 2, 0.14));
        wall.add(this.box(3.4, 0.35, 0.2, this.red, 0, h - 0.5, 0.18));
        for (const x of [-1.1, 1.1]) wall.add(this.box(0.95, 0.07, 0.2, this.brass, x, 1.4, 0.24));
      } else if (k % 3 === 1) {
        wall.add(this.box(1.5, 3.2, 0.08, this.brass, 0, 2.6, 0.1));
        wall.add(this.box(1.3, 3.0, 0.02, this.mat("mirror", 0x8a9496, 0.08, 1), 0, 2.6, 0.15));
      } else this.sconces(wall, h);
      return;
    }
    if (zone !== "hall") return;
    const reception = isReception(gx, gz);
    if (k === 0) { const portrait = this.portrait("", 1930); portrait.position.set(0, 2.1, 0.14); wall.add(portrait); }
    else if (k === 1 || k === 5) this.sconces(wall, h);
    else if (k === 2) {
      wall.add(this.box(1.4, 0.06, 0.42, this.wood, 0, 0.86, 0.3));
      for (const x of [-0.6, 0.6]) wall.add(this.box(0.06, 0.84, 0.06, this.wood, x, 0.42, 0.42));
      wall.add(this.cylinder(0.1, 0.35, this.cream, 0.35, 1.07, 0.3, 0.06));
      wall.add(this.box(1.0, 1.2, 0.06, this.brass, 0, 1.95, 0.1));
      wall.add(this.box(0.86, 1.06, 0.02, this.mat("mirror", 0x8a9496, 0.08, 1), 0, 1.95, 0.14));
      const yaw = wall.rotation.y, p = hotelCenter(gx, gz);
      this.block(p.x + dx * 2 + 0.3 * Math.sin(yaw), p.z + dz * 2 + 0.3 * Math.cos(yaw), 0.3);
    } else if (k === 3 && !reception) {
      const d = this.door(["STAFF ONLY", "LINEN", "SERVICE"][(gx + gz) % 3]).group; d.position.z = 0.14; wall.add(d);
    } else if (k === 4 && !reception) {
      wall.add(this.box(0.8, 1.1, 0.22, this.mat("fire", 0x8c1a17, 0.6), 0, 1.4, 0.18));
      const s = this.sign("FIRE HOSE", 0.7, 0.18); s.position.set(0, 1.75, 0.3); wall.add(s);
    }
  }

  // --- Guest rooms ------------------------------------------------------------
  /** Furniture for one guest room, in world space (see hotelRoomPoint). Mirrored by hotelRoomSide; details vary by room. */
  private piecesFor(room: HotelGuestRoom): Piece[] {
    const cached = this.roomPieces.get(room.number);
    if (cached) return cached;
    const s = hotelRoomSide(room), rng = hotelRng(this.seed ^ room.number * 2654435761);
    const facing = room.into < 0 ? 0 : Math.PI; // local +z towards the entry
    const at = (u: number, v: number) => hotelRoomPoint(room, u, v);
    const blanket = [this.red, this.mat("bed_green", 0x2e4a35, 0.95), this.mat("bed_navy", 0x1f2a48, 0.95), this.mat("bed_gold", 0x8a6a2e, 0.95)][Math.floor(rng() * 4)];
    const card = this.puzzle.cards.find(c => c.number === room.number);
    const pieces: Piece[] = [];
    const add = (pos: { x: number; z: number }, yaw: number, build: () => THREE.Object3D, blocks?: [number, number, number][]) => pieces.push({ ...pos, yaw, build, blocks });

    add(at(s * 2.7, 6.68), facing, () => {
      const g = new THREE.Group();
      g.add(this.box(1.9, 0.4, 2.3, this.wood, 0, 0.2));
      g.add(this.box(1.8, 0.22, 2.2, this.linen, 0, 0.51));
      g.add(this.box(1.86, 0.08, 1.5, blanket, 0, 0.64, 0.36));
      for (const x of [-0.45, 0.45]) g.add(this.box(0.7, 0.14, 0.4, this.linen, x, 0.69, -0.82));
      g.add(this.box(2.0, 1.3, 0.12, this.wood, 0, 0.65, -1.18));
      g.add(this.box(2.0, 0.6, 0.1, this.wood, 0, 0.3, 1.18));
      return g;
    }, [[0, -0.55, 0.95], [0, 0.55, 0.95]]);
    const nightstand = (withLamp: boolean) => () => {
      const g = new THREE.Group();
      g.add(this.box(0.6, 0.6, 0.48, this.wood, 0, 0.3));
      g.add(this.box(0.08, 0.04, 0.03, this.brass, 0, 0.42, 0.25));
      if (withLamp) {
        g.add(this.cylinder(0.08, 0.32, this.brass, 0, 0.76));
        g.add(this.cylinder(0.2, 0.24, this.linen, 0, 1.02, 0, 0.11));
      }
      return g;
    };
    add(at(s * 1.25, 7.5), facing, nightstand(true), [[0, 0, 0.35]]);
    add(hotelCardSpot(room), facing, () => {
      const g = nightstand(!card)();
      if (card) {
        // The guest card, stood up against the wall, facing the room.
        const note = this.sign(`ROOM ${card.number}\n${card.suit}\n${t(`hotel.digit.${card.digit}`)} · ${card.digit}`, 0.5, 0.64, true);
        note.position.set(0, 0.93, 0.02); note.rotation.x = -0.12; g.add(note);
      }
      return g;
    }, [[0, 0, 0.35]]);
    // Window and painting on the back wall.
    add(at(-s * 2.6, 7.92), facing, () => this.stormWindow());
    add(at(s * 2.7, 7.93), facing, () => this.landscape()); pieces[pieces.length - 1].y = 2.6;
    // Wardrobe and writing desk against the far side wall.
    add(at(-s * 5.62, 5.4), s * Math.PI / 2, () => {
      const g = new THREE.Group();
      g.add(this.box(2.0, 2.3, 0.6, this.wood, 0, 1.15));
      g.add(this.box(2.1, 0.12, 0.66, this.wood, 0, 2.36));
      g.add(this.box(0.02, 2.0, 0.02, this.brass, 0, 1.15, 0.31));
      for (const x of [-0.08, 0.08]) g.add(this.box(0.04, 0.14, 0.04, this.brass, x, 1.2, 0.33));
      return g;
    }, [[-0.55, 0, 0.42], [0.55, 0, 0.42]]);
    add(at(-s * 5.55, 2.2), s * Math.PI / 2, () => {
      const g = new THREE.Group();
      g.add(this.box(1.4, 0.08, 0.6, this.wood, 0, 0.76));
      for (const x of [-0.64, 0.64]) g.add(this.box(0.08, 0.72, 0.56, this.wood, x, 0.36));
      g.add(this.cylinder(0.07, 0.3, this.brass, -0.45, 0.95));
      g.add(this.box(0.36, 0.12, 0.2, this.mat("banker", 0x1f5a3a, 0.4), -0.45, 1.15, 0.02));
      g.add(this.box(0.42, 0.01, 0.3, this.linen, 0.2, 0.81, 0.05));
      const seat = this.chair(); seat.position.set(0, 0, 0.72); seat.rotation.y = Math.PI; g.add(seat);
      return g;
    }, [[0, 0, 0.45], [0, 0.72, 0.3]]);
    // Armchair in the near corner, turned towards the room.
    add(at(s * 4.9, 1.1), -s * Math.PI / 2 + (rng() - 0.5) * 0.5, () => {
      const g = new THREE.Group();
      g.add(this.box(0.85, 0.42, 0.8, this.red, 0, 0.21)); g.add(this.box(0.85, 0.75, 0.2, this.red, 0, 0.75, -0.32));
      for (const x of [-0.4, 0.4]) g.add(this.box(0.14, 0.32, 0.75, this.red, x, 0.55));
      return g;
    }, [[0, 0, 0.5]]);
    // Rug in the middle of the room.
    add(at(0, 4.3), facing, () => {
      const rug = this.picture("rug", 4.2, 3, 256, (c, w, h) => {
        c.fillStyle = "#5a1520"; c.fillRect(0, 0, w, h);
        c.strokeStyle = "#c19a52"; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
        c.strokeStyle = "#1e2848"; c.lineWidth = 6; c.strokeRect(24, 24, w - 48, h - 48);
        c.fillStyle = "#c19a52"; c.beginPath(); c.moveTo(w / 2, h * 0.25); c.lineTo(w * 0.68, h / 2); c.lineTo(w / 2, h * 0.75); c.lineTo(w * 0.32, h / 2); c.fill();
        c.fillStyle = "#5a1520"; c.beginPath(); c.arc(w / 2, h / 2, h * 0.09, 0, Math.PI * 2); c.fill();
      });
      rug.rotation.x = -Math.PI / 2; rug.position.y = 0.015; return rug;
    });
    // A guest who left in a hurry: luggage by the wardrobe, sometimes burst open.
    const open = rng() < 0.4;
    add(at(-s * 3.3, 0.6), rng() * Math.PI, () => {
      const g = new THREE.Group(), leather = this.mat("leather", 0x4a2a17, 0.7);
      g.add(this.box(0.78, 0.24, 0.5, leather, 0, 0.12));
      if (open) {
        const lid = this.box(0.78, 0.05, 0.5, leather, 0, 0.38, -0.36); lid.rotation.x = -1.2; g.add(lid);
        for (let i = 0; i < 3; i++) g.add(this.box(0.4, 0.02, 0.3, this.linen, (i - 1) * 0.5, 0.01, 0.55 + (i % 2) * 0.2));
      } else g.add(this.box(0.2, 0.06, 0.04, this.brass, 0, 0.27, 0));
      return g;
    }, [[0, 0, 0.35]]);
    this.roomPieces.set(room.number, pieces);
    return pieces;
  }

  // --- Cells ------------------------------------------------------------------
  createCell(gx: number, gz: number): THREE.Group {
    const g = new THREE.Group(), zone = hotelZone(gx, gz);
    if (!zone) return g;
    const p = hotelCenter(gx, gz), floor = hotelFloorAt(p.x, p.z), h = zone === "beverly" ? 7 : zone === "boiler" ? 5 : 4;
    g.position.set(p.x, floor, p.z);
    g.userData.aabb = new THREE.Box3(new THREE.Vector3(p.x - 2.2, floor - 1, p.z - 2.2), new THREE.Vector3(p.x + 2.2, floor + h + 1, p.z + 2.2));
    const industrial = zone === "boiler" || zone === "stairs";
    const bedroom = HOTEL_GUEST_ROOMS.find(r => gx >= r.x1 && gx <= r.x2 && gz >= r.z1 && gz <= r.z2);
    const entry = HOTEL_GUEST_ROOMS.find(r => r.doorX === gx && r.doorZ === gz);
    const guest = bedroom ?? entry;

    // Floor and ceiling.
    if (zone === "stairs") {
      for (let i = 0; i < 8; i++) {
        const z = -1.75 + i * 0.5, y = hotelFloorAt(p.x, p.z + z) - floor;
        g.add(this.box(4, 0.18, 0.5, this.grate, 0, y - 0.09, z));
      }
    } else {
      const floorMat = industrial ? this.grate : zone === "beverly" ? this.marble : guest || zone === "exit" ? this.parquet : this.carpet;
      g.add(this.box(4, 0.12, 4, floorMat, 0, -0.06));
    }
    g.add(this.box(4, 0.12, 4, industrial ? this.plate : this.ceiling, 0, h));

    // Walls wherever the neighbour is outside the hotel.
    const paper = industrial ? this.plate : guest ? this.roomPaper : this.hallPaper;
    for (const [dx, dz, yaw] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
      if (hotelZone(gx + dx, gz + dz)) continue;
      const wall = new THREE.Group(); wall.position.set(dx * 2, 0, dz * 2); wall.rotation.y = yaw;
      wall.add(this.box(4, h, 0.16, paper, 0, h / 2));
      if (industrial) {
        for (const py of [h - 0.9, h - 0.45]) { const pipe = this.cylinder(0.12, 4, this.brass, 0, py, 0.25); pipe.rotation.z = Math.PI / 2; wall.add(pipe); }
      } else {
        wall.add(this.box(4, 1, 0.2, this.wood, 0, 0.5, 0.05));
        for (const y of [0.1, 1, h - 0.2]) wall.add(this.box(4, 0.055, 0.24, this.brass, 0, y, 0.06));
        if (entry && dx === -1) {
          // The bathroom, off the room's entry.
          const d = this.door("").group; d.position.z = 0.14; wall.add(d);
        } else if (!guest && !(dz === -1 && gz === GALLERY_Z && GALLERY.some(s => s.gx === gx))) this.dressWall(wall, gx, gz, dx, dz, zone, h);
      }
      g.add(wall);
    }

    // Lights.
    if (bedroom && gx === bedroom.gx && gz === bedroom.gz) {
      const c = hotelRoomPoint(bedroom, 0, 4);
      this.fixture(g, gx, gz, h - 0.9, zone, "dome", { x: c.x - p.x, z: c.z - p.z });
    } else if (zone === "beverly") {
      if (gx % 3 === 1 && gz % 3 === 1) this.fixture(g, gx, gz, h - 1.2, zone, "chandelier");
    } else if (zone === "exit") {
      if (gz % 3 === 0) this.fixture(g, gx, gz, h - 0.9, zone, "dome");
    } else if (!guest && (gx + gz) % 3 === 0) {
      this.fixture(g, gx, gz, h - 0.9, zone, industrial ? "cage" : isReception(gx, gz) ? "chandelier" : "dome");
    }

    const inCell = (pos: { x: number; z: number }) => Math.floor(pos.x / 4) === gx && Math.floor(pos.z / 4) === gz;
    const obstacle = (x: number, z: number, radius: number) => this.block(p.x + x, p.z + z, radius);

    // Reception: polished desk, locked key box, gramophone, the elevator cage, palms.
    if (inCell(HOTEL_RECEPTION)) {
      g.add(this.box(3.6, 1.1, 1, this.wood, 0, 0.55, -0.35)); obstacle(0, -0.35, 0.65);
      g.add(this.box(3.8, 0.06, 1.15, this.marble, 0, 1.13, -0.35));
      const label = this.sign("TERROR HOTEL\nRECEPTION · 1930", 2.7, 0.8); label.position.set(0, 0.65, 0.17); g.add(label);
      g.add(this.box(0.95, 0.38, 0.65, this.brass, 0, 1.35, 0));
      this.boxLid = this.box(0.98, 0.06, 0.68, this.wood, 0, 1.57); g.add(this.boxLid);
      const dial = this.sign("0 0 0 0", 0.7, 0.2); dial.position.set(0, 1.35, 0.34); g.add(dial);
      g.add(this.cylinder(0.08, 0.05, this.brass, 1.3, 1.19)); g.add(this.cylinder(0.02, 0.06, this.brass, 1.3, 1.24));
      this.key = new THREE.Group(); this.key.add(this.cylinder(0.06, 0.4, this.brass));
      this.key.add(this.box(0.22, 0.1, 0.08, this.brass, 0.06, -0.13)); this.key.rotation.z = Math.PI / 2; this.key.position.set(0, 1.65, 0); g.add(this.key);
    }
    if (gx === 3 && gz === 2) {
      g.add(this.box(1.6, 0.8, 1, this.wood, 0, 0.4));
      g.add(this.cylinder(0.48, 0.06, this.metal, 0, 0.86));
      const horn = new THREE.Mesh(this.kit.geo("hotel_horn", () => new THREE.ConeGeometry(0.48, 0.9, 16, 1, true)), this.brass); horn.rotation.z = -1.1; horn.position.set(0.3, 1.35, 0); g.add(horn);
      obstacle(0, 0, 0.8);
    }
    if (gx === 7 && gz === 2) {
      g.add(this.box(3.5, 3.5, 0.8, this.wood, 0, 1.75, -1.5));
      for (let i = -5; i <= 5; i++) g.add(this.box(0.04, 3.1, 0.08, this.brass, i * 0.27, 1.6, -0.95));
      for (const y of [0.6, 1.5, 2.4]) g.add(this.box(3.1, 0.06, 0.08, this.brass, 0, y, -0.93));
      const s = this.sign("ELEVATOR · 1—382", 2.6, 0.4); s.position.set(0, 3.2, -0.9); g.add(s);
    }
    if ((gx === 2 || gx === 8) && gz === 2) { this.plant(g, gx === 2 ? -1.3 : 1.3, -1.3); obstacle(gx === 2 ? -1.3 : 1.3, -1.3, 0.45); }
    if ((gx === 3 || gx === 7) && gz === 7 || zone === "hall" && gz === 12 && gx % 5 === 1) { const sofa = this.sofa(); sofa.position.z = 1.25; g.add(sofa); obstacle(-0.8, 1.25, 0.6); obstacle(0.8, 1.25, 0.6); }
    if (gz === GALLERY_Z && GALLERY.some(s => s.gx === gx)) {
      GALLERY.forEach((spot, picture) => {
        if (spot.gx !== gx) return;
        const portrait = this.portrait(this.puzzle.cards[this.puzzle.order[picture]].suit, picture + 1);
        portrait.position.set(spot.x, 2.1, -1.8); g.add(portrait);
      });
      const s = this.sign(t("hotel.gallery"), 3.2, 0.4); s.position.set(0, 3.4, -1.75); g.add(s);
    }

    // Guest room entry: the room's wall faces the corridor; its door stands open against the bedroom side.
    if (entry) {
      const hallSide = -entry.into;
      const holder = new THREE.Group(); holder.rotation.y = hallSide > 0 ? 0 : Math.PI; holder.position.z = hallSide * 1.75; g.add(holder);
      this.doorway(holder, gx, gz, h, 1.2, 2.3, this.hallPaper, this.roomPaper);
      // Rooms holding a guest card show its suit on the door plate, so the search is short.
      const card = this.puzzle.cards.find(c => c.number === entry.number);
      const { group, leaves } = this.door(card ? `ROOM ${entry.number} ${card.suit}` : `ROOM ${entry.number}`, { width: 1.2, swing: -1 });
      this.swingLeaves(leaves, 1); holder.add(group);
      // Coat rack in the entry.
      g.add(this.cylinder(0.03, 1.8, this.brass, 1.55, 0.9, 0)); g.add(this.cylinder(0.22, 0.04, this.brass, 1.55, 0.02, 0));
      obstacle(1.55, 0, 0.25);
    }
    if (bedroom) {
      for (const piece of this.piecesFor(bedroom)) {
        if (!inCell(piece)) continue;
        const object = piece.build(); object.position.set(piece.x - p.x, piece.y ?? 0, piece.z - p.z); object.rotation.y += piece.yaw; g.add(object);
        const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw);
        for (const [lx, lz, r] of piece.blocks ?? []) this.block(piece.x + lx * c + lz * s, piece.z - lx * s + lz * c, r);
      }
    }

    // Gates: ROOM 512, the alcoves, the boiler stairs and the emergency exit.
    const alcove = HOTEL_ALCOVES.findIndex(d => d.gx === gx && d.gz === gz);
    const beverlyGate = gx === HOTEL_BEVERLY_DOOR.gx && gz === HOTEL_BEVERLY_DOOR.gz;
    const stairGate = gx === HOTEL_STAIRS.gx && gz === HOTEL_STAIRS.gz;
    const exitGate = gx === 40 && gz === 40;
    if (alcove >= 0 || beverlyGate || stairGate || exitGate) {
      const label = beverlyGate ? "512 · BEVERLY ROOM" : stairGate ? "BOILER ROOM" : exitGate ? "EMERGENCY EXIT" : HOTEL_TILES[this.puzzle.alcoves.indexOf(alcove)];
      const gateIndustrial = stairGate || exitGate;
      const holder = new THREE.Group(); holder.rotation.y = beverlyGate || alcove >= 0 && HOTEL_ALCOVES[alcove].axis === "x" ? Math.PI / 2 : 0; g.add(holder);
      this.doorway(holder, gx, gz, h, 1.8, 2.6, gateIndustrial ? this.plate : this.hallPaper, undefined, !gateIndustrial);
      // Leaves swing away from the side players arrive on (the alcoves open off the hall at +z).
      const d = this.door(label, { width: 1.8, height: 2.6, double: true, industrial: gateIndustrial, swing: alcove >= 0 && HOTEL_ALCOVES[alcove].axis === "z" ? -1 : 1 });
      holder.add(d.group);
      // A shut alcove that is not part of the puzzle yet reads as plain wall.
      const blank = alcove >= 0 ? this.box(1.8, 2.6, 0.16, this.hallPaper, 0, 1.3) : null;
      if (blank) holder.add(blank);
      this.doors.push({ mesh: d.group, blank, leaves: d.leaves, gx, gz, open: 0, alcove });
    }

    // The Beverly Room: alcove tiles, the Mahjong table, round tables, columns, a piano and a bar.
    for (let i = 0; i < 4; i++) if (inCell(HOTEL_ALCOVES[this.puzzle.alcoves[i]].tile)) {
      g.add(this.cylinder(0.45, 0.9, this.marble, 0, 0.45)); g.add(this.cylinder(0.55, 0.08, this.brass, 0, 0.94)); obstacle(0, 0, 0.55);
      const tile = this.sign(HOTEL_TILES[i], 0.55, 0.7, true); tile.position.set(0, 1.35, 0.3); g.add(tile); this.tiles.push({ mesh: tile, index: i, placed: false });
    }
    if (inCell(HOTEL_TABLE)) {
      g.add(this.box(3.5, 0.2, 2.7, this.wood, 0, 1)); g.add(this.box(3.2, 0.025, 2.4, this.mat("felt", 0x173c32), 0, 1.12)); obstacle(0, 0, 1.1);
      for (const x of [-1.4, 1.4]) for (const z of [-1, 1]) g.add(this.box(0.15, 1, 0.15, this.brass, x, 0.5, z));
      for (let i = 0; i < 4; i++) {
        const slot = this.sign(`${HOTEL_TILES[i]}\n${i + 1}`, 0.6, 0.85); slot.rotation.x = -Math.PI / 2; slot.position.set(-1.05 + i * 0.7, 1.14, 0); g.add(slot);
        const tile = this.sign(HOTEL_TILES[i], 0.5, 0.68, true); tile.rotation.x = -Math.PI / 2; tile.position.set(slot.position.x, 1.2, 0); g.add(tile); this.tiles.push({ mesh: tile, index: i, placed: true });
      }
      for (let i = 0; i < 12; i++) g.add(this.box(0.19, 0.28, 0.12, this.cream, -1.2 + i * 0.22, 1.3, -0.85));
      const s = this.sign(t("hotel.tableClue"), 3.2, 0.7); s.position.set(0, 1.8, -0.9); g.add(s);
      for (const [x, z, yaw] of [[0, 1.75, Math.PI], [0, -1.75, 0], [2.15, 0, -Math.PI / 2], [-2.15, 0, Math.PI / 2]]) {
        const c = this.chair(); c.position.set(x, 0, z); c.rotation.y = yaw; g.add(c);
      }
    }
    if (zone === "beverly" && BEVERLY_ROUND_TABLES.some(([x, z]) => x === gx && z === gz)) {
      g.add(this.cylinder(1, 0.08, this.wood, 0, 0.85)); g.add(this.cylinder(1.02, 0.02, this.linen, 0, 0.9)); g.add(this.cylinder(0.12, 0.8, this.brass, 0, 0.4));
      g.add(this.cylinder(0.06, 0.25, this.cream, 0, 1.03)); obstacle(0, 0, 0.85);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, c = this.chair(); c.position.set(Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4); c.rotation.y = a + Math.PI; g.add(c); }
    }
    for (const [cx, cz] of BEVERLY_COLUMNS) if (cx === gx * 4 && cz === gz * 4) {
      g.add(this.cylinder(0.5, h, this.marble, -2, h / 2, -2));
      g.add(this.cylinder(0.65, 0.3, this.brass, -2, h - 0.15, -2, 0.75)); g.add(this.cylinder(0.65, 0.25, this.brass, -2, 0.12, -2));
      this.block(cx, cz, 0.6);
    }
    if (gx === 39 && gz === 6) {
      // A black grand piano, lid up, on the north side.
      const piano = new THREE.Group(), black = this.mat("lacquer", 0x0c0b0b, 0.2, 0.2);
      piano.add(this.box(1.5, 0.35, 2.0, black, 0, 0.95)); piano.add(this.box(1.5, 0.06, 0.3, this.linen, 0, 0.95, 1.1));
      for (const [x, z] of [[-0.65, -0.85], [0.65, -0.85], [0, 0.85]]) piano.add(this.box(0.1, 0.78, 0.1, black, x, 0.39, z));
      const lid = this.box(1.45, 0.04, 1.9, black, 0.35, 1.55, 0); lid.rotation.z = 0.8; piano.add(lid);
      piano.add(this.box(0.9, 0.5, 0.36, black, 0, 0.25, 1.7));
      piano.position.z = -0.6; g.add(piano); obstacle(0, -0.6, 1.05); obstacle(0, 1.1, 0.35);
    }
    if (zone === "beverly" && gz === 16 && BEVERLY_BAR.includes(gx)) {
      g.add(this.box(4, 1.1, 0.6, this.wood, 0, 0.55, 1.2)); g.add(this.box(4, 0.06, 0.7, this.marble, 0, 1.13, 1.2));
      g.add(this.box(4, 2.2, 0.3, this.wood, 0, 1.6, 1.82));
      const glass = [this.mat("bottle_green", 0x24502c, 0.15, 0.1), this.mat("bottle_amber", 0x7a4314, 0.15, 0.1)];
      for (let i = 0; i < 9; i++) for (const y of [1.25, 1.95]) g.add(this.cylinder(0.05, 0.3, glass[(i + gx) % 2], -1.6 + i * 0.4, y, 1.75, 0.03));
      for (let i = 0; i < 6; i++) obstacle(-1.75 + i * 0.7, 1.2, 0.4);
      if (gx === 34) { const s = this.sign("BAR · 1930", 1.6, 0.4); s.position.set(0, 3.0, 1.66); s.rotation.y = Math.PI; g.add(s); }
    }
    if (zone === "beverly" && gx === 36 && (gz === 6 || gz === 15)) {
      const d = this.door("PRIVATE").group; d.rotation.x = Math.PI / 2; d.position.y = gz === 6 ? 6.7 : 0.03; g.add(d); this.oddDoors.push(d);
    }

    // The Boiler Room: boilers, the valve wheels with their gauges, the maintenance chart, steam.
    if (zone === "boiler" && gx % 3 === 0 && gz >= 29 && gz <= 34) {
      g.add(this.cylinder(1.25, 3.7, this.metal, 0, 1.85)); g.add(this.cylinder(1.32, 0.16, this.brass, 0, 0.35)); g.add(this.cylinder(1.32, 0.16, this.brass, 0, 3.25));
      g.add(this.cylinder(0.3, 1.1, this.metal, 0, 4.2)); obstacle(0, 0, 1.3);
      const plate = this.sign(`BOILER\nNº ${Math.floor(gx / 3)}`, 0.7, 0.5, true); plate.position.set(0, 2.1, 1.28); g.add(plate);
    }
    if (zone === "boiler" && gz >= 36) {
      for (const x of [-1.7, 1.7]) { g.add(this.box(0.06, 0.06, 4, this.brass, x, 1)); g.add(this.box(0.06, 1, 0.06, this.brass, x, 0.5)); }
    }
    HOTEL_VALVES.forEach((v, i) => {
      if (!inCell(v)) return;
      g.add(this.cylinder(0.16, 3.6, this.brass, 0, 1.8, -0.65));
      const wheel = new THREE.Mesh(this.kit.geo("hotel_wheel", () => new THREE.TorusGeometry(0.47, 0.055, 8, 20)), this.red); wheel.position.set(0, 1.35, 0); g.add(wheel); this.wheels[i] = wheel;
      for (let k = 0; k < 4; k++) { const spoke = this.box(0.92, 0.04, 0.04, this.red); spoke.rotation.z = k * Math.PI / 4; wheel.add(spoke); }
      const s = this.sign(`VALVE ${"ABC"[i]}\nLOW · MEDIUM · HIGH`, 2.7, 0.65); s.position.set(0, 2.65, -0.1); g.add(s);
      const dial = this.sign("LOW     MEDIUM     HIGH\n0          1          2", 2, 0.8, true); dial.position.set(0, 2.05, 0); g.add(dial);
      const needle = this.box(0.04, 0.35, 0.02, this.red, 0, 2.05, 0.03); g.add(needle); this.needles[i] = needle;
      // The boiler gauge this valve answers to: its reading, against the chart by the stairs, gives the setting.
      g.add(this.cylinder(0.04, 1.6, this.brass, 1.35, 0.8, -0.3));
      const gauge = this.gauge("ABC"[i], this.puzzle.psi[i]); gauge.position.set(1.35, 1.85, -0.22); g.add(gauge);
    });
    if (gx === 38 && gz === 25) {
      const s = this.sign(t("hotel.maintenanceClue"), 3.4, 2.1, true); s.position.set(0, 2.1, -1); g.add(s);
    }
    if (HOTEL_STEAM.some(s => s.gx === gx && s.gz === gz)) {
      const jet = new THREE.Group();
      const m = this.kit.mat("hotel_steam", () => new THREE.MeshBasicMaterial({ color: 0xc5c4b4, transparent: true, opacity: 0.14, depthWrite: false }));
      for (let i = 0; i < 7; i++) { const cloud = new THREE.Mesh(this.kit.geo("hotel_cloud", () => new THREE.IcosahedronGeometry(0.75, 1)), m); cloud.position.set((i % 3 - 1) * 1.1, 0.8 + i * 0.35, (i % 2) * 0.6); jet.add(cloud); }
      g.add(jet); this.steam.push(jet);
    }
    if (gx === 40 && gz === 54) { const d = this.door("6").group; d.rotation.y = Math.PI; d.position.z = 1.86; g.add(d); }
    if (zone === "exit" && gx === 40 && gz === 44) {
      this.returnWall = this.box(4, h, 0.16, this.hallPaper, 0, h / 2, -2);
      this.returnWall.visible = this.departed;
      g.add(this.returnWall);
    }
    // Map streaming controls the cell root's visibility. Keep a separate content
    // root so streaming and puzzle updates cannot reveal the departed hotel.
    const content = new THREE.Group();
    content.add(...g.children);
    content.visible = zone === "exit" || !this.departed;
    g.add(content);
    this.cells.push({ group: content, zone });
    return g;
  }
  /** A round pressure gauge, 0-200 PSI, its needle fixed at the boiler's reading. */
  private gauge(valve: string, psi: number) {
    const g = new THREE.Group();
    const rim = this.cylinder(0.42, 0.08, this.brass); rim.rotation.x = Math.PI / 2; g.add(rim);
    const face = this.picture(`gauge_${valve}_${psi}`, 0.76, 0.76, 256, (c, w) => {
      const r = w / 2;
      c.fillStyle = "#e8dfc6"; c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.fill();
      const angle = (v: number) => Math.PI * 0.75 + v / 200 * Math.PI * 1.5;
      c.strokeStyle = "#9b2a20"; c.lineWidth = 10; c.beginPath(); c.arc(r, r, r * 0.8, angle(160), angle(200)); c.stroke();
      c.strokeStyle = "#2a2018"; c.fillStyle = "#2a2018"; c.textAlign = "center"; c.textBaseline = "middle"; c.font = "bold 20px Georgia, serif";
      for (let v = 0; v <= 200; v += 10) {
        const a = angle(v), major = v % 50 === 0;
        c.lineWidth = major ? 4 : 2; c.beginPath();
        c.moveTo(r + Math.cos(a) * r * (major ? 0.68 : 0.74), r + Math.sin(a) * r * (major ? 0.68 : 0.74)); c.lineTo(r + Math.cos(a) * r * 0.86, r + Math.sin(a) * r * 0.86); c.stroke();
        if (major) c.fillText(String(v), r + Math.cos(a) * r * 0.54, r + Math.sin(a) * r * 0.54);
      }
      c.font = "bold 26px Georgia, serif"; c.fillText(`VALVE ${valve}`, r, r * 0.55);
      c.font = "bold 30px Georgia, serif"; c.fillText(`${psi} PSI`, r, r * 1.5);
      const a = angle(psi); c.strokeStyle = "#9b2a20"; c.lineWidth = 6; c.beginPath(); c.moveTo(r, r); c.lineTo(r + Math.cos(a) * r * 0.78, r + Math.sin(a) * r * 0.78); c.stroke();
      c.fillStyle = "#2a2018"; c.beginPath(); c.arc(r, r, 10, 0, Math.PI * 2); c.fill();
    });
    face.position.z = 0.045; g.add(face);
    return g;
  }
  isBlocked(gx: number, gz: number) { return !this.ready || this.departed && gx === 40 && gz === 43 || hotelBlocked(this.state, gx, gz, this.now); }
  update(now: number, delta: number, blackout: boolean, flicker: number, decor: number) {
    this.now = now;
    if (this.glass) {
      if (!this.outlookApplied) {
        setOfficeWindowOutlook(this.glass, { far: this.skyline, mass: null, gridSize: 1, cellSize: 4 });
        this.outlookApplied = true;
      }
      setOfficeWindowState(this.glass, now / 1000, 0, 0);
    }
    for (const d of this.doors) {
      const open = !hotelBlocked(this.state, d.gx, d.gz, now);
      d.open += ((open ? 1 : 0) - d.open) * Math.min(1, delta * 4);
      this.swingLeaves(d.leaves, d.open);
      if (d.alcove >= 0) d.mesh.visible = !!(this.state.doors & (1 << d.alcove)) || this.puzzle.alcoves[this.state.collected] === d.alcove;
      if (d.blank) d.blank.visible = !d.mesh.visible;
    }
    for (const tile of this.tiles) tile.mesh.visible = tile.placed ? tile.index < this.state.placed : tile.index >= this.state.collected;
    this.oddDoors.forEach((d, i) => { d.position.x = decor ? (i ? -2 : 2) : 0; });
    if (this.key) this.key.visible = this.state.boxOpen && !this.state.key;
    if (this.boxLid) this.boxLid.rotation.x = this.state.boxOpen ? -1.15 : 0;
    this.wheels.forEach((w, i) => { w.rotation.z = -(this.state.valves[i] ?? 0) * Math.PI / 3; });
    this.needles.forEach((w, i) => { w.rotation.z = (1 - (this.state.valves[i] ?? 0)) * Math.PI / 3; });
    const steaming = now >= this.state.steamAt && now < this.state.steamUntil;
    this.steam.forEach((s, index) => { s.visible = steaming; s.children.forEach((c, i) => { c.rotation.y = now * 0.001 + i; c.scale.setScalar(0.85 + Math.sin(now * 0.004 + i + index) * 0.2); }); });
    for (const l of this.lights) {
      const pulse = (flicker > 0 || steaming && l.zone === "boiler") && Math.sin(now * 0.047) > 0.25;
      const scale = blackout || this.departed && l.zone !== "exit" ? 0
        : l.zone === "exit" ? (this.departed && l.source.z < this.departureZ - 4 ? 0.25 : 0)
        : pulse ? 0.08 : 1;
      l.source.intensity = l.source.baseIntensity * scale; l.bulb.visible = scale > 0.1;
    }
    // Hide only the local view beyond the one-way threshold. Other explorers retain their hotel.
    if (this.returnWall) this.returnWall.visible = this.departed;
    for (const c of this.cells) if (c.zone !== "exit") c.group.visible = !this.departed;
  }
}
