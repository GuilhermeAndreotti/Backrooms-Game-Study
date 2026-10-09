import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import { t } from "../../i18n";
import { createHotelState, hotelBlocked, hotelPuzzle, HOTEL_SUITS, HOTEL_TILES, type HotelState } from "../../shared/hotel";
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_GUEST_ROOMS, HOTEL_RECEPTION, HOTEL_STAIRS, HOTEL_STEAM, HOTEL_TABLE, HOTEL_VALVES, hotelCenter, hotelFloorAt, hotelZone, type HotelZone } from "./hotelLayout";

interface HotelEnv {
  kit: DecorKit; seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number): DynamicLightSource;
  addObstacle(gx: number, gz: number, x: number, z: number, radius: number): void;
}
interface Door { mesh: THREE.Group; gx: number; gz: number; open: number; alcove: number }

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
  private lights: { source: DynamicLightSource; bulb: THREE.Mesh; zone: HotelZone }[] = [];
  private cells: { group: THREE.Group; zone: HotelZone }[] = [];
  private tiles: { mesh: THREE.Object3D; index: number; placed: boolean }[] = [];
  private wheels: THREE.Object3D[] = [];
  private needles: THREE.Object3D[] = [];
  private steam: THREE.Group[] = [];
  private oddDoors: THREE.Object3D[] = [];
  private returnWall: THREE.Object3D | null = null;
  private key: THREE.Group | null = null;
  private boxLid: THREE.Mesh | null = null;
  private wood: THREE.Material;
  private brass: THREE.Material;
  private wallpaper: THREE.Material;
  private carpet: THREE.Material;
  private metal: THREE.Material;
  private cream: THREE.Material;
  private red: THREE.Material;

  constructor(private env: HotelEnv) {
    this.seed = env.seed; this.puzzle = hotelPuzzle(env.seed); this.kit = env.kit;
    this.wood = this.mat("wood", 0x24100d, 0.45);
    this.brass = this.mat("brass", 0xa17b38, 0.3, 0.65);
    this.metal = this.mat("iron", 0x333c3b, 0.65, 0.65);
    this.cream = this.mat("plaster", 0xb8a68c, 0.8);
    this.red = this.mat("velvet", 0x621b22, 0.9);
    this.wallpaper = this.pattern("wall", "#542e2b", "#9b7248");
    this.carpet = this.pattern("carpet", "#6c1723", "#b9974d");
  }
  private mat(key: string, color: number, roughness = 0.8, metalness = 0) {
    return this.kit.mat(`hotel_${key}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  private pattern(key: string, bg: string, ink: string) {
    return this.kit.mat(`hotel_pattern_${key}`, () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d")!;
      g.fillStyle = bg; g.fillRect(0, 0, 256, 256); g.strokeStyle = ink;
      for (let x = 0; x < 256; x += 32) for (let y = 0; y < 256; y += 48) {
        g.lineWidth = key === "wall" ? 1 : 2; g.beginPath();
        g.moveTo(x + 16, y); g.bezierCurveTo(x + 42, y + 24, x - 10, y + 24, x + 16, y + 48);
        g.bezierCurveTo(x - 10, y + 24, x + 42, y + 24, x + 16, y); g.stroke();
      }
      if (key === "carpet") { g.lineWidth = 5; g.strokeRect(6, 6, 244, 244); g.lineWidth = 1; g.strokeRect(13, 13, 230, 230); }
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; this.kit.track(texture);
      return new THREE.MeshStandardMaterial({ map: texture, roughness: key === "wall" ? 0.72 : 1 });
    });
  }
  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(this.kit.geo(`hotel_box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z); mesh.receiveShadow = true; return mesh;
  }
  private cylinder(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(this.kit.geo(`hotel_cyl_${r}_${h}`, () => new THREE.CylinderGeometry(r, r, h, 12)), mat); m.position.set(x, y, z); return m;
  }
  private sign(text: string, w = 2, h = 0.8, paper = false) {
    const material = this.kit.mat(`hotel_text_${text}_${paper}`, () => {
      const c = document.createElement("canvas"); c.width = 768; c.height = Math.max(192, Math.round(768 * h / w));
      const g = c.getContext("2d")!; g.fillStyle = paper ? "#e5d5af" : "#20120c"; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = paper ? "#513824" : "#c9a65e"; g.lineWidth = 8; g.strokeRect(12, 12, c.width - 24, c.height - 24);
      const lines = text.split("\n"); g.fillStyle = g.strokeStyle; g.textAlign = "center"; g.textBaseline = "middle";
      const size = Math.min(72, (c.height - 35) / lines.length * 0.8); g.font = `${size}px Georgia, serif`;
      lines.forEach((line, i) => g.fillText(line, c.width / 2, 20 + (c.height - 40) * (i + 0.5) / lines.length, c.width - 48));
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this.kit.track(tex);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide });
    });
    return new THREE.Mesh(this.kit.geo(`hotel_sign_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)), material);
  }
  private door(label: string, industrial = false) {
    const g = new THREE.Group();
    g.add(this.box(2.7, 3.25, 0.16, industrial ? this.metal : this.wood, 0, 1.625));
    for (const x of [-1.4, 1.4]) g.add(this.box(0.12, 3.5, 0.24, this.brass, x, 1.75));
    g.add(this.box(2.9, 0.1, 0.24, this.brass, 0, 3.45));
    for (const y of [0.75, 2.15]) g.add(this.box(2.25, 0.92, 0.08, industrial ? this.metal : this.red, 0, y, 0.12));
    g.add(this.cylinder(0.065, 0.32, this.brass, 1.02, 1.3, 0.19));
    const sign = this.sign(label, 1.65, 0.5); sign.position.set(0, 2.8, 0.17); g.add(sign);
    return g;
  }
  private portrait(symbol: string, ordinal: number) {
    const g = new THREE.Group(); g.add(this.box(1.5, 1.9, 0.12, this.brass, 0, 0, 0));
    const p = this.sign(`${ordinal}\n${symbol}`, 1.32, 1.7); p.position.z = 0.08; g.add(p);
    // Unnaturally pale eyes above the suit, with pupils looking towards the aisle.
    for (const x of [-0.19, 0.19]) {
      g.add(this.box(0.2, 0.09, 0.02, this.cream, x, 0.25, 0.095));
      g.add(this.box(0.055, 0.085, 0.022, this.wood, x + 0.025, 0.25, 0.11));
    }
    return g;
  }
  private sofa() {
    const g = new THREE.Group();
    g.add(this.box(3, 0.35, 1, this.wood, 0, 0.3)); g.add(this.box(2.7, 0.2, 0.9, this.red, 0, 0.57));
    g.add(this.box(3, 0.9, 0.25, this.red, 0, 0.9, -0.5));
    for (const x of [-1.4, 1.4]) g.add(this.box(0.25, 0.6, 1.15, this.red, x, 0.7));
    return g;
  }
  private chandelier(g: THREE.Group, gx: number, gz: number, y: number, zone: HotelZone) {
    const industrial = zone === "boiler" || zone === "stairs";
    const root = new THREE.Group(); root.position.y = y;
    root.add(this.cylinder(0.045, 0.8, this.brass, 0, 0.4));
    const bulbMat = this.kit.mat("hotel_bulb", () => new THREE.MeshBasicMaterial({ color: 0xffd79b }));
    const bulb = this.box(industrial ? 0.8 : 0.28, 0.22, 0.28, bulbMat, 0, -0.05); root.add(bulb);
    if (!industrial) for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, x = Math.cos(a) * 0.75, z = Math.sin(a) * 0.75;
      const arm = this.box(1.5, 0.045, 0.045, this.brass, 0, -0.2); arm.rotation.y = a; root.add(arm);
      root.add(this.cylinder(0.09, 0.35, this.cream, x, 0, z));
      const b = bulb.clone(false); b.position.set(x, 0.22, z); bulb.add(b); b.position.sub(bulb.position);
    }
    g.add(root);
    const p = hotelCenter(gx, gz);
    const source = this.env.registerLight(gx, gz, p.x, hotelFloorAt(p.x, p.z) + y - 0.1, p.z, industrial ? 0xffb76b : 0xffd29a, zone === "beverly" ? 7.5 : 4.5, zone === "beverly" ? 24 : 15);
    this.lights.push({ source, bulb, zone });
  }
  createCell(gx: number, gz: number): THREE.Group {
    const g = new THREE.Group(), zone = hotelZone(gx, gz);
    if (!zone) return g;
    const p = hotelCenter(gx, gz), floor = hotelFloorAt(p.x, p.z), h = zone === "beverly" ? 7 : zone === "boiler" ? 5 : 4;
    g.position.set(p.x, floor, p.z);
    g.userData.aabb = new THREE.Box3(new THREE.Vector3(p.x - 2.2, floor - 1, p.z - 2.2), new THREE.Vector3(p.x + 2.2, floor + h + 1, p.z + 2.2));
    const industrial = zone === "boiler" || zone === "stairs";
    if (zone === "stairs") {
      for (let i = 0; i < 8; i++) {
        const z = -1.75 + i * 0.5, y = hotelFloorAt(p.x, p.z + z) - floor;
        g.add(this.box(4, 0.18, 0.5, this.metal, 0, y - 0.09, z));
      }
    } else g.add(this.box(4, 0.12, 4, industrial ? this.metal : zone === "exit" ? this.wood : this.carpet, 0, -0.06));
    g.add(this.box(4, 0.12, 4, industrial ? this.metal : this.cream, 0, h));
    for (const [dx, dz, yaw] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
      if (hotelZone(gx + dx, gz + dz)) continue;
      const wall = new THREE.Group(); wall.position.set(dx * 2, 0, dz * 2); wall.rotation.y = yaw;
      wall.add(this.box(4, h, 0.16, industrial ? this.metal : this.wallpaper, 0, h / 2));
      wall.add(this.box(4, 1, 0.2, this.wood, 0, 0.5, 0.05));
      for (const y of [0.1, 1, h - 0.2]) wall.add(this.box(4, 0.055, 0.24, this.brass, 0, y, 0.06));
      if (industrial) {
        for (const py of [h - 0.9, h - 0.45]) { const pipe = this.cylinder(0.12, 4, this.brass, 0, py, 0.25); pipe.rotation.z = Math.PI / 2; wall.add(pipe); }
      } else if (zone !== "exit" && (gx + gz) % 3 === 0) {
        const door = this.door(`ROOM ${600 + ((gx * 7 + gz * 13) % 83)}`); door.position.z = 0.2; wall.add(door);
      } else if (zone === "hall" && (gx + gz) % 3 === 1) {
        const portrait = this.portrait(HOTEL_SUITS[(gx + gz) % 4], 1930); portrait.position.set(0, 2.2, 0.14); wall.add(portrait);
      }
      g.add(wall);
    }
    if (zone !== "exit" && ((zone === "beverly" && gx % 3 === 1 && gz % 3 === 1) || (zone !== "beverly" && (gx + gz) % 3 === 0))) this.chandelier(g, gx, gz, h - 0.9, zone);
    if (zone === "exit" && gz % 3 === 0) this.chandelier(g, gx, gz, h - 0.9, zone);

    const putAt = (object: THREE.Object3D, pos: { x: number; z: number }, y = 0) => { object.position.set(pos.x - p.x, y, pos.z - p.z); g.add(object); };
    const inCell = (pos: { x: number; z: number }) => Math.floor(pos.x / 4) === gx && Math.floor(pos.z / 4) === gz;
    const obstacle = (x: number, z: number, radius: number) => this.env.addObstacle(gx, gz, p.x + x, p.z + z, radius);

    // Reception: a luggage wall, gramophone, polished desk, locked key box.
    if (inCell(HOTEL_RECEPTION)) {
      g.add(this.box(3.6, 1.1, 1, this.wood, 0, 0.55, -0.35)); obstacle(0, -0.35, 0.65);
      const label = this.sign("TERROR HOTEL\nRECEPTION · 1930", 2.7, 0.8); label.position.set(0, 0.65, 0.17); g.add(label);
      g.add(this.box(0.95, 0.38, 0.65, this.brass, 0, 1.3, 0));
      this.boxLid = this.box(0.98, 0.06, 0.68, this.wood, 0, 1.52); g.add(this.boxLid);
      const dial = this.sign("0 0 0 0", 0.7, 0.2); dial.position.set(0, 1.3, 0.34); g.add(dial);
      const note = this.sign(t("hotel.receptionClue"), 1.8, 0.75, true); note.position.set(0, 2.45, -0.8); g.add(note);
      this.key = new THREE.Group(); this.key.add(this.cylinder(0.06, 0.4, this.brass));
      this.key.add(this.box(0.22, 0.1, 0.08, this.brass, 0.06, -0.13)); this.key.rotation.z = Math.PI / 2; this.key.position.set(0, 1.6, 0); g.add(this.key);
    }
    if (gx === 3 && gz === 2) {
      g.add(this.box(1.6, 0.8, 1, this.wood, 0, 0.4));
      g.add(this.cylinder(0.48, 0.06, this.metal, 0, 0.86));
      const horn = new THREE.Mesh(this.kit.geo("hotel_horn", () => new THREE.ConeGeometry(0.48, 0.9, 16, 1, true)), this.brass); horn.rotation.z = -1.1; horn.position.set(0.3, 1.35, 0); g.add(horn);
    }
    if (gx === 7 && gz === 2) {
      g.add(this.box(3.5, 3.5, 0.8, this.wood, 0, 1.75, -1.5));
      for (let i = -5; i <= 5; i++) g.add(this.box(0.04, 3.1, 0.08, this.brass, i * 0.27, 1.6, -0.95));
      for (const y of [0.6, 1.5, 2.4]) g.add(this.box(3.1, 0.06, 0.08, this.brass, 0, y, -0.93));
      const s = this.sign("ELEVATOR · 1—382", 2.6, 0.4); s.position.set(0, 3.2, -0.9); g.add(s);
    }
    if ((gx === 3 || gx === 7) && gz === 7 || zone === "hall" && gz === 12 && gx % 5 === 1) { const sofa = this.sofa(); sofa.position.z = 1.25; g.add(sofa); obstacle(0, 1.25, 0.65); }

    const room = HOTEL_GUEST_ROOMS.find(r => r.doorX === gx && r.doorZ === gz);
    if (room) {
      const frame = this.door(`ROOM ${room.number}`); frame.rotation.y = Math.PI / 2; frame.position.x = -1.45; g.add(frame);
      const sign = this.sign(`ROOM ${room.number}`, 2.3, 0.42); sign.position.set(0, 3.55, 0); g.add(sign);
    }
    const bedroom = HOTEL_GUEST_ROOMS.find(r => r.gx === gx && r.gz === gz);
    if (bedroom) {
      g.add(this.box(1.7, 0.5, 2.6, this.wood, -0.85, 0.25, -0.1));
      g.add(this.box(1.65, 0.18, 2.4, this.cream, -0.85, 0.6, -0.1));
      g.add(this.box(1.6, 0.18, 0.6, this.red, -0.85, 0.8, -0.85)); obstacle(-0.85, -0.1, 0.85);
      g.add(this.box(0.7, 0.9, 0.7, this.wood, 1.25, 0.45));
      const card = this.puzzle.cards.find(c => c.number === bedroom.number);
      if (card) {
        const note = this.sign(`ROOM ${card.number}\n${card.suit}\n${t(`hotel.digit.${card.digit}`)} · ${card.digit}`, 0.72, 0.9, true);
        note.position.set(1.25, 1.25, 0.1); note.rotation.x = -0.35; g.add(note);
      }
    }
    const picture = [13, 17, 21, 25].indexOf(gx);
    if (gz === 12 && picture >= 0) {
      const portrait = this.portrait(this.puzzle.cards[this.puzzle.order[picture]].suit, picture + 1); portrait.position.set(0, 2.2, -1.8); g.add(portrait);
      const s = this.sign(t("hotel.gallery"), 2.7, 0.35); s.position.set(0, 3.45, -1.75); g.add(s);
    }

    const alcove = HOTEL_ALCOVES.findIndex(d => d.gx === gx && d.gz === gz);
    const beverlyGate = gx === HOTEL_BEVERLY_DOOR.gx && gz === HOTEL_BEVERLY_DOOR.gz;
    const stairGate = gx === HOTEL_STAIRS.gx && gz === HOTEL_STAIRS.gz;
    const exitGate = gx === 40 && gz === 40;
    if (alcove >= 0 || beverlyGate || stairGate || exitGate) {
      const label = beverlyGate ? "ROOM 512\nTHE BEVERLY ROOM" : stairGate ? "BOILER ROOM" : exitGate ? "EMERGENCY EXIT" : HOTEL_TILES[this.puzzle.alcoves.indexOf(alcove)];
      const d = this.door(label, stairGate || exitGate);
      const holder = new THREE.Group(); holder.rotation.y = beverlyGate || alcove >= 0 && HOTEL_ALCOVES[alcove].axis === "x" ? Math.PI / 2 : 0; holder.add(d); g.add(holder);
      this.doors.push({ mesh: d, gx, gz, open: 0, alcove });
      // Fill beside and above the actual door, matching the gate's collision cell.
      for (const x of [-1.75, 1.75]) holder.add(this.box(0.5, h, 0.2, this.wood, x, h / 2));
      holder.add(this.box(3, h - 3.5, 0.2, this.wood, 0, (h + 3.5) / 2));
    }
    for (let i = 0; i < 4; i++) if (inCell(HOTEL_ALCOVES[this.puzzle.alcoves[i]].tile)) {
      g.add(this.box(1.4, 0.8, 1.2, this.wood, 0, 0.4)); obstacle(0, 0, 0.5);
      const tile = this.sign(HOTEL_TILES[i], 0.55, 0.7, true); tile.position.set(0, 1.2, 0.3); g.add(tile); this.tiles.push({ mesh: tile, index: i, placed: false });
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
    }
    if (zone === "beverly" && (gx === 33 || gx === 42) && (gz === 6 || gz === 15)) {
      g.add(this.cylinder(1, 0.15, this.wood, 0, 0.85)); g.add(this.cylinder(0.12, 0.8, this.brass, 0, 0.4)); obstacle(0, 0, 0.85);
    }
    if (zone === "beverly" && gx === 36 && (gz === 6 || gz === 15)) {
      const d = this.door("PRIVATE"); d.rotation.x = Math.PI / 2; d.position.y = gz === 6 ? 6.7 : 0.03; g.add(d); this.oddDoors.push(d);
    }
    if (zone === "boiler" && gx % 3 === 0 && gz >= 29 && gz <= 34) {
      g.add(this.cylinder(1.25, 3.7, this.metal, 0, 1.85)); g.add(this.cylinder(1.32, 0.16, this.brass, 0, 0.35)); g.add(this.cylinder(1.32, 0.16, this.brass, 0, 3.25));
      g.add(this.cylinder(0.3, 1.1, this.metal, 0, 4.2)); obstacle(0, 0, 1.3);
      const gauge = this.sign("PSI\n120", 0.65, 0.65, true); gauge.position.set(0, 2.1, 1.28); g.add(gauge);
    }
    if (zone === "boiler" && gz >= 36) {
      for (const x of [-1.7, 1.7]) { g.add(this.box(0.06, 0.06, 4, this.brass, x, 1)); g.add(this.box(0.06, 1, 0.06, this.brass, x, 0.5)); }
      for (let i = 0; i < 12; i++) g.add(this.box(3.3, 0.02, 0.05, this.brass, 0, 0.02, -1.8 + i * 0.32));
    }
    HOTEL_VALVES.forEach((v, i) => {
      if (!inCell(v)) return;
      g.add(this.cylinder(0.16, 3.6, this.brass, 0, 1.8, -0.65));
      const wheel = new THREE.Mesh(this.kit.geo("hotel_wheel", () => new THREE.TorusGeometry(0.47, 0.055, 8, 20)), this.red); wheel.position.set(0, 1.35, 0); g.add(wheel); this.wheels[i] = wheel;
      for (let k = 0; k < 4; k++) { const spoke = this.box(0.92, 0.04, 0.04, this.red); spoke.rotation.z = k * Math.PI / 4; wheel.add(spoke); }
      const s = this.sign(`VALVE ${"ABC"[i]}\nLOW · MEDIUM · HIGH`, 2.7, 0.65); s.position.set(0, 2.65, -0.1); g.add(s);
      const dial = this.sign("LOW     MEDIUM     HIGH\n0          1          2", 2, 0.8, true); dial.position.set(0, 2.05, 0); g.add(dial);
      const needle = this.box(0.04, 0.35, 0.02, this.red, 0, 2.05, 0.03); g.add(needle); this.needles[i] = needle;
    });
    if (gx === 38 && gz === 25) {
      const s = this.sign(t("hotel.maintenanceClue"), 3.4, 2, true); s.position.set(0, 2.1, -1); g.add(s);
    }
    // Circuit service cards are separated from their wheels: explore / communicate.
    if (gz === 28 && [31, 44, 53].includes(gx)) {
      const i = [31, 44, 53].indexOf(gx); const s = this.sign(`PRESSURE\n${"ABC"[i]} = ${["LOW", "MEDIUM", "HIGH"][i]}`, 2.1, 1.3, true); s.position.set(0, 2, -1.85); g.add(s);
    }
    if (HOTEL_STEAM.some(s => s.gx === gx && s.gz === gz)) {
      const jet = new THREE.Group();
      const m = this.kit.mat("hotel_steam", () => new THREE.MeshBasicMaterial({ color: 0xc5c4b4, transparent: true, opacity: 0.14, depthWrite: false }));
      for (let i = 0; i < 7; i++) { const cloud = new THREE.Mesh(this.kit.geo("hotel_cloud", () => new THREE.IcosahedronGeometry(0.75, 1)), m); cloud.position.set((i % 3 - 1) * 1.1, 0.8 + i * 0.35, (i % 2) * 0.6); jet.add(cloud); }
      g.add(jet); this.steam.push(jet);
    }
    if (gx === 40 && gz === 54) { const d = this.door("6"); d.position.z = 1.5; g.add(d); }
    if (zone === "exit" && gx === 40 && gz === 44) {
      this.returnWall = this.box(4, h, 0.16, this.wallpaper, 0, h / 2, -2);
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
  isBlocked(gx: number, gz: number) { return !this.ready || this.departed && gx === 40 && gz === 43 || hotelBlocked(this.state, gx, gz, this.now); }
  update(now: number, delta: number, blackout: boolean, flicker: number, decor: number) {
    this.now = now;
    for (const d of this.doors) {
      const open = !hotelBlocked(this.state, d.gx, d.gz, now);
      d.open += ((open ? 1 : 0) - d.open) * Math.min(1, delta * 4);
      d.mesh.position.x = -d.open * 2.95;
      if (d.alcove >= 0) d.mesh.visible = !!(this.state.doors & (1 << d.alcove)) || this.puzzle.alcoves[this.state.collected] === d.alcove;
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
