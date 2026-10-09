import { t } from "../../i18n";
import { EntityType } from "../../shared/entityTypes";
import { createHotelWorldState, HOTEL_TILES, type HotelAction, type HotelState, type HotelWorldState } from "../../shared/hotel";
import type { AudioManager } from "../AudioManager";
import type { WanderingEntity } from "../WanderingEntity";
import type { HotelWorld } from "./hotelWorld";
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_EXIT, HOTEL_RECEPTION, HOTEL_TABLE, HOTEL_VALVES, hotelCenter, hotelFloorAt, hotelRng, hotelSightClear, hotelZone } from "./hotelLayout";

export type HotelPanel = { kind: "code" } | { kind: "valve"; index: number };
export interface HotelObserver { id: string; x: number; z: number; lookX: number; lookZ: number; running: boolean }
interface HotelHost {
  audio: AudioManager;
  player(): HotelObserver & { alive: boolean };
  observers(): HotelObserver[];
  authority(): boolean;
  entities(): WanderingEntity[];
  walkable(gx: number, gz: number): boolean;
  send(action: HotelAction, epoch: number): void;
  sync(): void;
  checkpoint(world: HotelWorldState, epoch: number): void;
  notify(message: string): void;
  escape(): void;
}
type Interaction = { prompt: string; action?: HotelAction; panel?: HotelPanel; text?: string; x: number; z: number };

/** Only the world authority directs appearances; puzzles always await server snapshots. */
export class HotelDirector {
  private clockOffset = 0;
  private runtime: HotelWorldState = createHotelWorldState(Date.now());
  private nextCheckpoint = 0;
  private nextSync = 0;
  private eventPlayed = -1;
  private stairSound = false;
  private escaped = false;
  panel: HotelPanel | null = null;
  private flickerUntil = 0;

  constructor(readonly world: HotelWorld, private host: HotelHost) { host.sync(); }
  get now() { return Date.now() + this.clockOffset; }
  get blackout() { return this.world.state.stairAt > this.now; }
  get immune() { return this.blackout || this.world.state.exitOpen || !this.world.ready; }

  applyState(state: HotelState, now: number, runtime?: HotelWorldState) {
    if (state.epoch < this.world.state.epoch || this.world.ready && state.epoch === this.world.state.epoch && state.revision < this.world.state.revision) return;
    const previous = this.world.state;
    this.clockOffset = now - Date.now();
    this.world.state = state; this.world.ready = true; this.world.now = this.now;
    if (runtime) this.runtime = { ...runtime, dwell: { ...runtime.dwell } };
    if (state.collected > previous.collected) this.host.audio.playHotelSound("bell");
    if (state.doors !== previous.doors || state.beverlyOpen !== previous.beverlyOpen) this.host.audio.playHotelSound("door");
    if (state.key && !previous.key) this.host.notify(t("hotel.keyFound"));
    if (state.steamUntil > previous.steamUntil) this.host.audio.playHotelSound("knock");
  }
  applyWorld(world: HotelWorldState, now: number) {
    if (world.at < this.runtime.at && this.world.ready) return;
    this.clockOffset = now - Date.now();
    this.runtime = { ...world, dwell: { ...world.dwell } };
  }
  private near(p: HotelObserver, pos: { x: number; z: number }, range = 4.5) {
    const dx = pos.x - p.x, dz = pos.z - p.z, distance = Math.hypot(dx, dz);
    return distance <= range && (distance < 1 || (dx * p.lookX + dz * p.lookZ) / distance > 0.2)
      && Math.abs(hotelFloorAt(p.x, p.z) - hotelFloorAt(pos.x, pos.z)) < 1.5
      && hotelSightClear(p.x, p.z, pos.x, pos.z, (x, z) => this.world.isBlocked(x, z) && !(x === Math.floor(pos.x / 4) && z === Math.floor(pos.z / 4)));
  }
  private interaction(): Interaction | null {
    const p = this.host.player(), s = this.world.state;
    if (!p.alive || !this.world.ready || this.blackout || this.world.departed) return null;
    const options: Interaction[] = [];
    if (!s.key) options.push({ ...HOTEL_RECEPTION, prompt: t(s.boxOpen ? "hotel.takeKey" : "hotel.openBox"), ...(s.boxOpen ? { action: { kind: "key" } as HotelAction } : { panel: { kind: "code" } as HotelPanel }) });
    if (!s.beverlyOpen) options.push({ ...hotelCenter(HOTEL_BEVERLY_DOOR.gx, HOTEL_BEVERLY_DOOR.gz), prompt: t(s.key ? "hotel.unlock512" : "hotel.locked512"), ...(s.key ? { action: { kind: "beverly" } as HotelAction } : { text: t("hotel.locked512") }) });
    for (const card of this.world.puzzle.cards) options.push({ x: card.gx * 4 + 3.25, z: card.gz * 4 + 2, prompt: t("hotel.readCard"), text: `ROOM ${card.number} · ${card.suit} · ${t(`hotel.digit.${card.digit}`)} (${card.digit})` });
    if (s.beverlyOpen && s.collected < 4) {
      const slot = this.world.puzzle.alcoves[s.collected], door = HOTEL_ALCOVES[slot];
      if (!(s.doors & (1 << slot))) options.push({ ...hotelCenter(door.gx, door.gz), prompt: t("hotel.openTileDoor", { symbol: HOTEL_TILES[s.collected] }), action: { kind: "door", index: slot } });
      else options.push({ ...door.tile, prompt: t("hotel.takeTile", { symbol: HOTEL_TILES[s.collected] }), action: { kind: "tile", index: s.collected } });
    }
    if (s.beverlyOpen && s.placed < 4) options.push({ ...HOTEL_TABLE, prompt: t(s.collected > s.placed ? "hotel.place" : "hotel.inspectTable"), ...(s.collected > s.placed ? { action: { kind: "place" } as HotelAction } : { text: t("hotel.tableClue") }) });
    if (s.stairAt && this.now >= s.stairAt && !s.exitOpen) HOTEL_VALVES.forEach((v, index) => options.push({ ...v, prompt: t("hotel.valvePrompt", { valve: "ABC"[index] }), panel: { kind: "valve", index } }));
    return options.filter(o => this.near(p, o)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? null;
  }
  interactionPrompt() { return this.interaction()?.prompt ?? null; }
  interact(): "panel" | "done" | null {
    const target = this.interaction();
    if (!target) return null;
    if (target.panel) { this.panel = target.panel; return "panel"; }
    if (target.action) this.host.send(target.action, this.world.state.epoch);
    if (target.text) this.host.notify(target.text);
    return "done";
  }
  submit(action: HotelAction) { if (this.host.player().alive && this.world.ready) this.host.send(action, this.world.state.epoch); }

  /** Conservative horizontal frustum, plus logical occlusion. Includes both relocation endpoints. */
  private observed(pos: { x: number; z: number }, observers: HotelObserver[]) {
    return observers.some(p => {
      const dx = pos.x - p.x, dz = pos.z - p.z, distance = Math.hypot(dx, dz);
      return distance < 7 || distance < 45 && (dx * p.lookX + dz * p.lookZ) / distance > -0.2
        && hotelSightClear(p.x, p.z, pos.x, pos.z, (x, z) => this.world.isBlocked(x, z));
    });
  }
  private direct(now: number, observers: HotelObserver[], bellman: WanderingEntity | undefined) {
    const w = this.runtime;
    const alive = new Set(observers.map(p => p.id));
    for (const id of Object.keys(w.dwell)) if (!alive.has(id)) delete w.dwell[id];
    for (const p of observers) {
      const zone = hotelZone(Math.floor(p.x / 4), Math.floor(p.z / 4));
      if (zone && w.dwell[p.id]?.zone !== zone) w.dwell[p.id] = { zone, since: now };
    }
    if (this.immune) { w.mode = 0; w.nextAt = now + 65000; }
    else if (bellman && observers.length) {
      const target = observers.find(p => p.id === w.target) ?? observers.find(p => w.dwell[p.id]?.zone !== "stairs" && w.dwell[p.id]?.zone !== "exit");
      if (w.mode === 0 && now >= w.nextAt && target) {
        const random = hotelRng(this.world.seed + w.event * 971 + Math.floor(w.nextAt / 1000));
        for (let i = 0; i < 80; i++) {
          const angle = random() * Math.PI * 2, radius = 18 + random() * 14;
          const gx = Math.floor((target.x + Math.cos(angle) * radius) / 4), gz = Math.floor((target.z + Math.sin(angle) * radius) / 4);
          const pos = hotelCenter(gx, gz);
          if (hotelZone(gx, gz) !== w.dwell[target.id]?.zone || !this.host.walkable(gx, gz) || this.observed(pos, observers)) continue;
          bellman.teleportTo(gx, gz); w.mode = 1; w.until = now + 28000; w.lastSeen = now; w.target = target.id; break;
        }
        if (!w.mode) w.nextAt = now + 5000;
      } else if (w.mode && target) {
        const pos = bellman.mesh.position;
        const sees = Math.hypot(pos.x - target.x, pos.z - target.z) < 32 && hotelSightClear(pos.x, pos.z, target.x, target.z, (x, z) => this.world.isBlocked(x, z));
        if (sees) w.lastSeen = now;
        const noisy = observers.some(p => p.running && Math.hypot(p.x - pos.x, p.z - pos.z) < 24);
        const lingered = now - (w.dwell[target.id]?.since ?? now) > 80000;
        if (now > w.until - 21000 && (noisy || lingered || this.world.state.steamUntil > now)) w.mode = 2;
        if ((now > w.until || now - w.lastSeen > 8500) && !this.observed(pos, observers)) {
          w.mode = 0; w.nextAt = now + 65000; w.target = "";
        }
      } else if (w.mode) { w.mode = 0; w.nextAt = now + 65000; }
    }
    const event = Math.floor((now - this.world.state.startedAt) / 19000);
    if (event > w.event && !this.immune) {
      w.event = event;
      const endpoints = [{ x: 144, z: 26 }, { x: 148, z: 26 }, { x: 144, z: 62 }, { x: 148, z: 62 }];
      if (!endpoints.some(p => this.observed(p, observers))) w.decor = 1 - w.decor;
    }
    if (now >= this.nextCheckpoint) { this.nextCheckpoint = now + 500; w.at = now; this.host.checkpoint(w, this.world.state.epoch); }
  }
  update(delta: number) {
    const now = this.now, p = this.host.player(), s = this.world.state;
    if (!this.world.ready) { if (now > this.nextSync) { this.nextSync = now + 1500; this.host.sync(); } return; }
    const observers = this.host.observers();
    const bellman = this.host.entities().find(e => e.type === EntityType.BELLMAN);
    if (this.host.authority()) this.direct(now, observers, bellman);
    this.world.bellmanMode = this.immune ? 0 : this.runtime.mode;
    for (const e of this.host.entities()) {
      e.mesh.visible = !this.world.departed && (e.type !== EntityType.BELLMAN || this.world.bellmanMode > 0);
    }
    if (this.eventPlayed !== this.runtime.event) {
      if (this.eventPlayed >= 0 && !this.immune) {
        this.host.audio.playHotelSound((["whisper", "party", "knock", "bell"] as const)[this.runtime.event % 4], this.runtime.event % 2 ? -0.85 : 0.85, 0.6);
        this.flickerUntil = now + 900;
      }
      this.eventPlayed = this.runtime.event;
    }
    if (s.stairAt && now >= s.stairAt && !this.stairSound) { this.stairSound = true; this.host.audio.setHotelSilence(false); this.host.audio.playHotelSound("door"); }
    const zone = hotelZone(Math.floor(p.x / 4), Math.floor(p.z / 4)) ?? "hall";
    if (zone === "exit" && s.exitOpen && p.z > 184) this.world.departed = true;
    if (this.world.departed) this.world.departureZ = Math.max(this.world.departureZ, p.z);
    const quiet = this.blackout || s.exitOpen && zone !== "exit";
    this.host.audio.setHotelSilence(quiet);
    this.host.audio.updateHotelAudio(now - s.startedAt, zone, s.steamUntil > now, quiet);
    const nearby = bellman && this.world.bellmanMode && Math.hypot(p.x - bellman.mesh.position.x, p.z - bellman.mesh.position.z) < 14;
    this.world.update(now, delta, this.blackout, nearby || now < this.flickerUntil ? 1 : 0, this.runtime.decor);
    if (p.alive && s.exitOpen && Math.floor(p.x / 4) === HOTEL_EXIT.gx && p.z > HOTEL_EXIT.gz * 4 + 0.3 && !this.escaped) { this.escaped = true; this.host.escape(); }
  }
  atmosphere() {
    const p = this.host.player(), zone = hotelZone(Math.floor(p.x / 4), Math.floor(p.z / 4));
    return { color: 0xffd8aa, intensity: this.blackout || zone === "exit" ? 0 : zone === "boiler" ? 0.13 : 0.25, fog: zone === "exit" ? 0x000000 : zone === "boiler" ? 0x181510 : 0x160c0c, density: zone === "exit" ? 0.045 : 0.014 };
  }
  canCatch(e: WanderingEntity) {
    if (this.immune || e.type === EntityType.BELLMAN && this.world.bellmanMode !== 2) return false;
    const p = this.host.player();
    return Math.abs(hotelFloorAt(p.x, p.z) - hotelFloorAt(e.mesh.position.x, e.mesh.position.z)) < 1
      && hotelSightClear(p.x, p.z, e.mesh.position.x, e.mesh.position.z, (x, z) => this.world.isBlocked(x, z));
  }
  dispose() { this.host.audio.stopHotelAudio(); this.panel = null; }
}
