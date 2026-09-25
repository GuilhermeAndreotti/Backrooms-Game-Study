/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level FUN's game logic, kept out of GameEngine: the three puzzles, the
 * "stage" the party has reached, and the scripted scares.
 *
 *   PUZZLE 1  set the table — five numbered places, filled in the order the
 *             crayon drawings give
 *   PUZZLE 2  four symbols, one per party room, told as counts; press them in
 *             order on the panel beside the central door
 *   PUZZLE 3  find a cake, a gift and a golden balloon (each behind a small
 *             interaction) and put them on the long table
 *
 * Puzzle progress is a handful of idempotent facts (a slot filled, the panel
 * solved, a final item placed). They are applied locally, announced through
 * `host.send`, and applied the same way when a teammate's arrive, so the whole
 * room converges on the same stage without the server knowing the rules.
 * Scares are cosmetic and local (Math.random is fine here, unlike anything
 * that shapes the map).
 */

import * as THREE from "three";
import type { AudioManager } from "../AudioManager";
import * as M from "../LevelFunModels";
import { t, type MessageKey } from "../../i18n";
import { FUN_THEMES, P1_DECOY, P1_ORDER, P3_ITEMS, funRegionAt, type FunFinalItem } from "./funLayout";
import type { FunWorld } from "./funWorld";

export type FunAudio = Pick<AudioManager, "startFunMusic" | "stopFunMusic" | "playFunSound" | "triggerHumFlicker" | "playTerminalBeep"> & { readonly funMusicPlaying: boolean };

export interface FunHost {
  audio: FunAudio;
  notify(text: string): void;
  /** Player position and horizontal look direction (unit vector). */
  player(): { x: number; z: number; lookX: number; lookZ: number };
  globalEvent(state: "blackout" | "flicker_storm", seconds: number): void;
  send(kind: "p1_slot" | "p2_solved" | "p3_placed", index: number): void;
  /** The stage changed: refresh anything the engine keeps per stage (fog, ambient). */
  stageChanged(stage: M.FunStage): void;
}

const TABLE_TOP = 0.737;
const CELL = 4;

type ContainerState = "sealed" | "revealed" | "taken" | "placed";

interface Carry { group: "p1" | "p3"; id: string }
interface Candidate { id: string; x: number; z: number; radius: number; prompt: string | null; run: (() => void) | null; panel?: boolean }
interface Glimpse { tag: string; shown: number; seen: number; maxSeconds: number; hideDist: number }

const key = (k: string) => k as MessageKey;

function placedModel(kit: Parameters<typeof M.funPlate>[0], item: M.PartyItem): M.FunPiece {
  switch (item) {
    case "tablecloth": return M.funTableclothFlat(kit, "red", 0.56);
    case "plates": {
      const g = new THREE.Group();
      for (const dz of [-0.09, 0.09]) { const p = M.funPlate(kit, dz < 0 ? "blue" : "white").object; p.position.z = dz; g.add(p); }
      return { object: g, footprint: [] };
    }
    case "cups": {
      const g = new THREE.Group();
      for (const [i, c] of (["red", "yellow"] as M.PartyColor[]).entries()) { const cup = M.funCup(kit, c).object; cup.position.set((i - 0.5) * 0.14, 0, 0); g.add(cup); }
      return { object: g, footprint: [] };
    }
    case "gift": return M.funGift(kit, "pink", "yellow", 0.24);
    case "candles": {
      const g = new THREE.Group();
      for (const [i, c] of (["blue", "pink", "yellow"] as M.PartyColor[]).entries()) { const cd = M.funCandle(kit, c, true, 0.16).object; cd.position.set((i - 1) * 0.11, 0, 0); g.add(cd); }
      return { object: g, footprint: [] };
    }
    default: return M.funPlate(kit, "white");
  }
}

export class FunDirector {
  stage: M.FunStage = 0;

  private readonly world: FunWorld;
  private readonly host: FunHost;
  private clock = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private anims: { obj: THREE.Object3D; axis: "x" | "y" | "z"; kind: "rotation" | "position"; from: number; to: number; t: number; dur: number; done?: () => void }[] = [];

  // Puzzle 1
  private readonly slots: (M.PartyItem | null)[] = P1_ORDER.map(() => null);
  private readonly p1Placed = new Set<M.PartyItem>();
  private p1Mistakes = 0;
  p1Done = false;
  private stageOnePending = false;

  // Puzzle 2
  p2Solved = false;
  private panelProgress = 0;
  private readonly slammed = new Set<string>();
  private musicCutDone = false;
  private musicStartedAt = -1;
  private lastRegion: string | null = null;

  // Puzzle 3
  private readonly containers: Record<FunFinalItem, ContainerState> = { cake: "sealed", gift: "sealed", balloon: "sealed" };
  p3Done = false;
  exitOpen = false;

  private carry: Carry | null = null;
  private nextAmbient = 20;
  private nextGlimpse = 26;
  private nextFlicker = 3;
  private glimpse: Glimpse | null = null;

  constructor(world: FunWorld, host: FunHost) {
    this.world = world;
    this.host = host;
    // Hide the second balloon cluster of each room; the first is what you see on arrival.
    for (const th of FUN_THEMES) {
      const b = world.tag(`balloonsB:${th}`);
      if (b) b.obj.visible = false;
    }
  }

  dispose() {
    this.host.audio.stopFunMusic(true);
  }

  // -------------------------------------------------------------------------
  // What the HUD says
  // -------------------------------------------------------------------------

  objective(): string {
    let base: string;
    if (!this.p1Done) base = t("fun.obj.p1", { n: this.slots.filter(Boolean).length });
    else if (this.stage === 0) base = t("fun.obj.p1Door");
    else if (!this.p2Solved) base = t("fun.obj.p2");
    else if (!this.p3Done) base = t("fun.obj.p3", { n: this.p3PlacedCount() });
    else base = t("fun.obj.p3Exit");
    return this.carry ? `${base} · ${this.itemName(this.carry)}` : base;
  }

  private itemName(c: Carry): string { return t(key(`fun.item.${c.id}`)); }
  private p3PlacedCount(): number { return P3_ITEMS.filter((i) => this.containers[i] === "placed").length; }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  /** Everything the player could act on right now, with what pressing E would do. */
  private candidates(): Candidate[] {
    const out: Candidate[] = [];
    const w = this.world;

    if (!this.p1Done) {
      for (const item of [...P1_ORDER, P1_DECOY]) {
        const p = w.tag(`pickup:${item}`);
        if (!p || !p.obj.visible || this.p1Placed.has(item)) continue;
        out.push({ id: `p1:${item}`, x: p.x, z: p.z, radius: 1.9, prompt: t("fun.act.take", { item: t(key(`fun.item.${item}`)) }), run: () => this.takeP1(item) });
      }
      this.slots.forEach((filled, i) => {
        const s = w.tag(`slot:${i}`);
        if (!s || filled) return;
        const carrying = this.carry?.group === "p1";
        out.push({
          id: `slot:${i}`, x: s.x, z: s.z, radius: 1.5,
          prompt: carrying ? t("fun.act.slot", { n: i + 1 }) : t("fun.act.slotEmpty", { n: i + 1 }),
          run: carrying ? () => this.tryPlaceP1(i) : null,
        });
      });
    }

    if (this.stage >= 0 && !this.p2Solved) {
      const panel = w.tag("panel");
      if (panel && this.p1Done) out.push({ id: "panel", x: panel.x + 1.0, z: panel.z, radius: 3.2, prompt: t("fun.act.panel"), run: null, panel: true });
    }

    if (this.p2Solved && !this.p3Done) {
      const openKey: Record<FunFinalItem, MessageKey> = { cake: "fun.act.cabinet", gift: "fun.act.chest", balloon: "fun.act.search" };
      for (const item of P3_ITEMS) {
        const state = this.containers[item];
        const box = w.tag(`container:${item}`);
        if (state === "sealed" && box) {
          out.push({ id: `open:${item}`, x: box.x, z: box.z, radius: 2.1, prompt: t(openKey[item]), run: () => this.openContainer(item) });
        } else if (state === "revealed") {
          const it = w.tag(`item:${item}`);
          if (it) out.push({ id: `take:${item}`, x: it.x, z: it.z, radius: 2.0, prompt: t("fun.act.take", { item: t(key(`fun.item.${item}`)) }), run: () => this.takeP3(item) });
        }
      }
      if (this.carry?.group === "p3") {
        const item = this.carry.id as FunFinalItem;
        const slot = w.tag(`p3slot:${item}`);
        if (slot) out.push({ id: `put:${item}`, x: slot.x, z: slot.z, radius: 2.9, prompt: t("fun.act.table", { item: this.itemName(this.carry) }), run: () => this.placeP3(item, true) });
      }
    }
    return out;
  }

  /** The best candidate: near enough, and in front of the player. */
  private pick(): Candidate | null {
    const p = this.host.player();
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const c of this.candidates()) {
      const dx = c.x - p.x, dz = c.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > c.radius) continue;
      const dot = dist > 0.001 ? (dx * p.lookX + dz * p.lookZ) / dist : 1;
      if (dot < 0.25 && dist > 0.9) continue;
      const score = dist + (1 - dot) * 1.6;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  interactionPrompt(): string | null { return this.pick()?.prompt ?? null; }

  /** E pressed. "panel" means the panel modal should open; "done" that the key was used. */
  interact(): "panel" | "done" | null {
    const c = this.pick();
    if (!c) return null;
    if (c.panel) return "panel";
    c.run?.();
    return "done";
  }

  // -------------------------------------------------------------------------
  // Puzzle 1
  // -------------------------------------------------------------------------

  private takeP1(item: M.PartyItem) {
    this.returnCarry();
    const p = this.world.tag(`pickup:${item}`);
    if (p) p.obj.visible = false;
    this.carry = { group: "p1", id: item };
    this.host.notify(t("fun.n.carry", { item: t(key(`fun.item.${item}`)) }));
    this.host.audio.playFunSound("pop", 0, 0.25);
  }

  /** Puts whatever is carried back where it came from. */
  private returnCarry(notify = false) {
    const c = this.carry;
    if (!c) return;
    const tag = c.group === "p1" ? `pickup:${c.id}` : `item:${c.id}`;
    const p = this.world.tag(tag);
    if (p) p.obj.visible = true;
    if (c.group === "p3") this.containers[c.id as FunFinalItem] = "revealed";
    this.carry = null;
    if (notify) this.host.notify(t("fun.n.returned", { item: t(key(`fun.item.${c.id}`)) }));
  }

  private tryPlaceP1(slot: number) {
    const c = this.carry;
    if (!c || c.group !== "p1") return;
    const item = c.id as M.PartyItem;
    if (item === P1_DECOY) {
      this.host.notify(t("fun.n.decoy"));
      this.returnCarry();
      return;
    }
    if (P1_ORDER[slot] === item) {
      this.carry = null;
      this.placeP1(slot, true);
      return;
    }
    this.host.notify(t("fun.n.slotWrong"));
    this.host.audio.playTerminalBeep(false);
    this.returnCarry();
    this.p1Mistakes++;
    if (this.p1Mistakes % 3 === 0) this.miniScare();
  }

  private placeP1(slot: number, local: boolean) {
    if (this.slots[slot]) return;
    const item = P1_ORDER[slot];
    this.slots[slot] = item;
    this.p1Placed.add(item);
    const pick = this.world.tag(`pickup:${item}`);
    if (pick) pick.obj.visible = false;
    if (this.carry?.group === "p1" && this.carry.id === item) this.carry = null;
    const s = this.world.tag(`slot:${slot}`);
    if (s) {
      const model = placedModel(this.world.makeEnv(slot).kit, item);
      this.world.place(model, s.x, TABLE_TOP + 0.004, s.z, 0.3 * (slot % 3 - 1));
    }
    if (local) this.host.send("p1_slot", slot);
    this.host.audio.playTerminalBeep(true);
    const n = this.slots.filter(Boolean).length;
    this.host.notify(t("fun.n.slotOk", { n }));
    if (n >= this.slots.length) this.completeP1();
  }

  private completeP1() {
    if (this.p1Done) return;
    this.p1Done = true;
    this.world.setGate("g1", false);
    for (const id of ["hallA", "roomA2", "roomA3"]) this.world.tintRegion(id, 0xff9be3);
    this.host.audio.startFunMusic("party", { volume: 0.7, distortion: 0.05 });
    this.musicStartedAt = this.clock;
    this.host.notify(t("fun.n.p1Done"));
    this.stageOnePending = true;
  }

  // -------------------------------------------------------------------------
  // Puzzle 2
  // -------------------------------------------------------------------------

  panelProgressCount(): number { return this.panelProgress; }

  /** A button on the panel was pressed (index into PANEL_BUTTONS). */
  pressButton(index: number): { result: "ok" | "wrong" | "solved"; progress: number } {
    if (this.p2Solved) return { result: "solved", progress: 4 };
    const expected = this.world.code.presses[this.panelProgress];
    if (index === expected) {
      this.panelProgress++;
      this.host.audio.playTerminalBeep(true);
      if (this.panelProgress >= this.world.code.presses.length) {
        this.solveP2(true);
        return { result: "solved", progress: this.panelProgress };
      }
      return { result: "ok", progress: this.panelProgress };
    }
    this.panelProgress = 0;
    this.host.audio.playTerminalBeep(false);
    this.host.notify(t("fun.n.panelWrong"));
    return { result: "wrong", progress: 0 };
  }

  private solveP2(local: boolean) {
    if (this.p2Solved) return;
    this.p2Solved = true;
    this.panelProgress = this.world.code.presses.length;
    if (local) this.host.send("p2_solved", 0);
    this.world.setGate("g2", false);
    this.host.audio.stopFunMusic(true);
    // The rooms go dark; the party comes back a little worse.
    this.host.globalEvent("blackout", 5.5);
    this.host.audio.playFunSound("slam", 0.3, 0.8);
    this.after(1.6, () => { this.setStage(2); this.host.audio.playFunSound("giggle", -0.6, 0.35); });
    this.after(6.5, () => this.host.audio.playFunSound("steps", 0.5, 0.35));
    this.host.notify(t("fun.n.p2Done"));
    this.nextGlimpse = this.clock + 12;
  }

  // -------------------------------------------------------------------------
  // Puzzle 3
  // -------------------------------------------------------------------------

  private openContainer(item: FunFinalItem) {
    if (this.containers[item] !== "sealed") return;
    this.containers[item] = "revealed";
    const box = this.world.tag(`container:${item}`);
    const it = this.world.tag(`item:${item}`);
    if (item === "cake") {
      const door = box?.obj.getObjectByName("door");
      if (door) this.animate(door, "rotation", "y", 0, -1.9, 0.7);
      this.host.audio.playFunSound("creak", 0.1, 0.5);
    } else if (item === "gift") {
      const lid = box?.obj.getObjectByName("lid");
      if (lid) this.animate(lid, "rotation", "x", 0, -1.75, 0.6);
      this.host.audio.playFunSound("creak", -0.1, 0.5);
    } else {
      for (let i = 0; i < 4; i++) this.after(i * 0.28, () => this.host.audio.playFunSound("pop", 0, 0.12));
    }
    if (it) {
      it.obj.visible = true;
      if (item === "balloon") {
        it.obj.position.y = 0.25;
        this.animate(it.obj, "position", "y", 0.25, 0.7, 1.1);
      }
    }
    this.host.notify(t("fun.n.found", { item: t(key(`fun.item.${item}`)) }));
  }

  private takeP3(item: FunFinalItem) {
    if (this.containers[item] !== "revealed") return;
    this.returnCarry();
    const it = this.world.tag(`item:${item}`);
    if (it) it.obj.visible = false;
    this.containers[item] = "taken";
    this.carry = { group: "p3", id: item };
    this.host.notify(t("fun.n.carry", { item: t(key(`fun.item.${item}`)) }));
  }

  private placeP3(item: FunFinalItem, local: boolean) {
    if (this.containers[item] === "placed") return;
    if (this.carry?.group === "p3" && this.carry.id === item) this.carry = null;
    this.containers[item] = "placed";
    const src = this.world.tag(`item:${item}`);
    if (src) src.obj.visible = false;
    const slot = this.world.tag(`p3slot:${item}`);
    if (slot) {
      const env = this.world.makeEnv(90 + P3_ITEMS.indexOf(item));
      const piece = item === "cake" ? M.funCake(env.kit, { candles: 6, lit: true })
        : item === "gift" ? M.funGift(env.kit, "purple", "yellow", 0.36)
        : M.funSpecialBalloon(env.kit, 0.85);
      this.world.place(piece, slot.x, TABLE_TOP + 0.004, slot.z, item === "gift" ? 0.3 : 0);
      slot.obj.visible = false;
    }
    if (local) this.host.send("p3_placed", P3_ITEMS.indexOf(item));
    this.host.audio.playTerminalBeep(true);
    const n = this.p3PlacedCount();
    this.host.notify(t("fun.n.p3Placed", { n }));
    if (n >= P3_ITEMS.length) this.completeP3();
  }

  /**
   * The last party: lights out, the birthday song, then a room full of
   * guests that isn't there when the lights come back. The door opens once
   * they're gone.
   */
  private completeP3() {
    if (this.p3Done) return;
    this.p3Done = true;
    this.host.notify(t("fun.n.p3Done"));
    this.host.globalEvent("blackout", 4.2);
    this.host.audio.startFunMusic("birthday", { volume: 0.9, distortion: 0.5, loop: false });
    this.host.audio.playFunSound("slam", 0, 0.5);
    this.after(4.2, () => {
      this.host.globalEvent("flicker_storm", 5.4);
      this.setCrowd(true);
      this.host.audio.playFunSound("sting", 0, 1);
      this.host.audio.playFunSound("giggle", 0.7, 0.5);
    });
    this.after(9.4, () => this.host.globalEvent("blackout", 1.3));
    this.after(9.6, () => this.setCrowd(false));
    this.after(11.0, () => {
      this.exitOpen = true;
      this.world.setGate("g3", false);
      this.host.audio.stopFunMusic(false);
      this.host.audio.playFunSound("creak", -0.7, 0.6);
    });
  }

  private setCrowd(on: boolean) {
    for (const p of this.world.tagAll("crowd")) p.obj.visible = on;
    for (const tag of ["pg:head", "pg:exit"]) { const p = this.world.tag(tag); if (p) p.obj.visible = on; }
  }

  // -------------------------------------------------------------------------
  // Remote facts
  // -------------------------------------------------------------------------

  applyRemote(kind: string, index: number) {
    if (kind === "p1_slot" && index >= 0 && index < this.slots.length) this.placeP1(index, false);
    else if (kind === "p2_solved") this.solveP2(false);
    else if (kind === "p3_placed" && index >= 0 && index < P3_ITEMS.length) {
      const item = P3_ITEMS[index];
      if (this.containers[item] === "sealed") this.containers[item] = "revealed";
      this.placeP3(item, false);
    }
  }

  // -------------------------------------------------------------------------
  // Stage
  // -------------------------------------------------------------------------

  private setStage(stage: M.FunStage) {
    if (stage <= this.stage) return;
    this.stage = stage;
    this.world.applyStage(stage);
    for (const id of ["hallA", "roomA2", "roomA3"]) this.world.tintRegion(id, null);
    this.host.stageChanged(stage);
  }

  // -------------------------------------------------------------------------
  // Per-frame: timers, animation, scares
  // -------------------------------------------------------------------------

  private after(seconds: number, fn: () => void) { this.timers.push({ at: this.clock + seconds, fn }); }

  private animate(obj: THREE.Object3D, kind: "rotation" | "position", axis: "x" | "y" | "z", from: number, to: number, dur: number) {
    this.anims.push({ obj, kind, axis, from, to, t: 0, dur });
  }

  update(delta: number) {
    this.clock += delta;
    if (this.timers.length) {
      const due = this.timers.filter((tm) => tm.at <= this.clock);
      if (due.length) {
        this.timers = this.timers.filter((tm) => tm.at > this.clock);
        due.forEach((tm) => tm.fn());
      }
    }
    for (const a of this.anims) {
      a.t = Math.min(1, a.t + delta / a.dur);
      const e = 1 - Math.pow(1 - a.t, 3);
      const v = a.from + (a.to - a.from) * e;
      if (a.kind === "rotation") a.obj.rotation[a.axis] = v; else a.obj.position[a.axis] = v;
    }
    this.anims = this.anims.filter((a) => a.t < 1);

    const p = this.host.player();
    const cell = [Math.floor(p.x / CELL), Math.floor(p.z / CELL)] as const;
    const region = funRegionAt(cell[0], cell[1])?.id ?? null;

    // After the party is set, the first steps away from it are when it changes.
    if (this.stageOnePending && this.p1Done) {
      const away = region !== null && !["hallA", "roomA2", "roomA3", "corrA2", "corrA3", "corrA23", "corrG1"].includes(region);
      if (away) { this.stageOnePending = false; this.setStage(1); }
    }

    this.updateScares(delta, p, region);
    this.lastRegion = region;

  }

  private miniScare() {
    this.host.globalEvent("flicker_storm", 2.4);
    this.host.audio.playFunSound("giggle", (Math.random() - 0.5) * 1.6, 0.4);
  }

  private updateScares(delta: number, p: { x: number; z: number; lookX: number; lookZ: number }, region: string | null) {
    // Lamps that stutter, near the player. Always on: the whole venue is falling apart.
    this.nextFlicker -= delta;
    if (this.nextFlicker <= 0) {
      this.nextFlicker = 2.2 + Math.random() * 3.5;
      const near = this.world.flickyFixtures.filter((f) => Math.abs(f.light.x - p.x) < 22 && Math.abs(f.light.z - p.z) < 22 && f.flickerTimer <= 0);
      if (near.length) {
        const f = near[Math.floor(Math.random() * near.length)];
        f.flickerTimer = 0.25 + Math.random() * 0.7;
        if (Math.hypot(f.light.x - p.x, f.light.z - p.z) < 14) this.host.audio.triggerHumFlicker(Math.floor(f.flickerTimer * 1000));
      }
    }

    // Everything below is for the stretch between the first and the last puzzle.
    const tense = this.p1Done && !this.p3Done;
    this.updateGlimpse(delta, p);
    if (!tense || this.stage === 0) return;

    // Noises from rooms that should be empty.
    if (this.clock >= this.nextAmbient) {
      this.nextAmbient = this.clock + 16 + Math.random() * 26;
      const kinds = ["slam", "giggle", "steps", "creak"] as const;
      this.host.audio.playFunSound(kinds[Math.floor(Math.random() * kinds.length)], (Math.random() - 0.5) * 1.8, 0.16 + Math.random() * 0.22);
    }

    // The music stops in the middle of a note.
    if (!this.musicCutDone && this.host.audio.funMusicPlaying && this.clock - this.musicStartedAt > 30) {
      const inRoom = region !== null && (FUN_THEMES as readonly string[]).includes(region);
      if (inRoom || this.clock - this.musicStartedAt > 55) {
        this.musicCutDone = true;
        this.host.audio.stopFunMusic(true);
        this.after(7 + Math.random() * 3, () => this.host.audio.playFunSound("giggle", (Math.random() - 0.5) * 1.5, 0.3));
      }
    }

    // Rooms that change while you're out of them, and doors that shut behind you.
    if (!this.p2Solved) {
      if (this.lastRegion !== region) {
        const left = this.lastRegion;
        if (left && (FUN_THEMES as readonly string[]).includes(left)) this.swapBalloons(left);
        if (region && (FUN_THEMES as readonly string[]).includes(region) && !this.slammed.has(region) && Math.random() < 0.6) {
          this.after(2.4 + Math.random() * 2.5, () => this.slamDoor(region));
        }
      }
    }

    // A figure at the edge of sight.
    if (this.clock >= this.nextGlimpse && !this.glimpse) {
      this.nextGlimpse = this.clock + (this.p2Solved ? 26 : 34) + Math.random() * 30;
      this.startGlimpse(p, region);
    }
  }

  private swapBalloons(theme: string) {
    const a = this.world.tag(`balloonsA:${theme}`), b = this.world.tag(`balloonsB:${theme}`);
    if (!a || !b) return;
    const showB = !b.obj.visible;
    b.obj.visible = showB;
    a.obj.visible = !showB;
  }

  private slamDoor(theme: string) {
    if (this.slammed.has(theme) || this.p2Solved) return;
    const id = `door${theme[0].toUpperCase()}${theme.slice(1)}`;
    const center = this.world.gateCenter(id);
    const p = this.host.player();
    if (!center) return;
    const inRoom = funRegionAt(Math.floor(p.x / CELL), Math.floor(p.z / CELL))?.id === theme;
    // Never shut it on top of somebody, or on nobody.
    if (!inRoom || Math.hypot(center[0] - p.x, center[1] - p.z) < 3.4) return;
    this.slammed.add(theme);
    this.world.setGate(id, true);
    this.host.audio.playFunSound("slam", (center[0] - p.x) > 0 ? 0.6 : -0.6, 0.7);
    this.after(3.6, () => { this.world.setGate(id, false); this.host.audio.playFunSound("creak", 0, 0.35); });
  }

  // --- glimpses -----------------------------------------------------------

  private startGlimpse(p: { x: number; z: number; lookX: number; lookZ: number }, region: string | null) {
    const pool: { tag: string; maxSeconds: number; hideDist: number }[] = [];
    const add = (tag: string, maxSeconds = 5, hideDist = 7) => { if (this.world.tag(tag)) pool.push({ tag, maxSeconds, hideDist }); };
    if (region === "hub") {
      add("pg:hubEnd", 6, 9); add("pg:hubMouth", 4, 5);
      [0, 1, 2].forEach((i) => add(`pg:window:${i}`, 2.6, 3));
    } else if (region === "corrLong") add("pg:corridorEnd", 5, 8);
    else if (region === "corrG2") add("pg:corrG2", 4, 6);
    else if (region === "playroom") add("pg:playroom", 3.5, 3.5);
    if (pool.length === 0) return;
    // Only figures in front of the player and at a distance where they read as "far away".
    const usable = pool.filter((c) => {
      const tp = this.world.tag(c.tag)!;
      const dx = tp.x - p.x, dz = tp.z - p.z, dist = Math.hypot(dx, dz);
      return dist > c.hideDist + 1 && dist < 32 && (dx * p.lookX + dz * p.lookZ) / Math.max(dist, 0.01) > -0.2;
    });
    if (usable.length === 0) return;
    const c = usable[Math.floor(Math.random() * usable.length)];
    const tp = this.world.tag(c.tag)!;
    tp.obj.visible = true;
    this.glimpse = { tag: c.tag, shown: 0, seen: 0, maxSeconds: c.maxSeconds, hideDist: c.hideDist };
  }

  private updateGlimpse(delta: number, p: { x: number; z: number; lookX: number; lookZ: number }) {
    const g = this.glimpse;
    if (!g) return;
    const tp = this.world.tag(g.tag);
    if (!tp) { this.glimpse = null; return; }
    g.shown += delta;
    const dx = tp.x - p.x, dz = tp.z - p.z, dist = Math.hypot(dx, dz);
    const facing = (dx * p.lookX + dz * p.lookZ) / Math.max(dist, 0.01);
    if (facing > 0.9) g.seen += delta;
    // Gone once it has been looked at, approached, or has stood there long enough.
    if (g.seen > 0.7 || dist < g.hideDist || g.shown > g.maxSeconds) {
      tp.obj.visible = false;
      this.glimpse = null;
      if (g.seen > 0.7) this.host.audio.playFunSound("steps", (dx > 0 ? 0.5 : -0.5), 0.3);
    }
  }
}
