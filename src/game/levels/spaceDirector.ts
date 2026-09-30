/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 79's game logic, kept out of GameEngine: the navigation puzzle, its
 * two sequences, and the finale.
 *
 *   UNPOWERED   emergency lighting only; every terminal is dark except the
 *               power bus in engineering, where five cables are rewired
 *               colour to colour (SpaceWiringModal). Then the lights come on.
 *   IDLE        explore; the three consoles (ORIENTATION, DESTINATION,
 *               TRAJECTORY) are set one by one, the helm executes them
 *   PLANET RUN  the false solution. Accepted, green lights, "SAFE DESTINATION
 *               CONFIRMED"... then the numbers stop making sense and the
 *               planet shrinks while the station is supposedly closing in.
 *               ABORT at the helm resets everything (and the systems room
 *               starts talking); letting it arrive kills everyone aboard.
 *   LOCK RUN    the real one. Red lights, alarm, TRAJECTORY LOCKED, 17 s to
 *               reach the observation deck while the hole swells in the glass.
 *   FINAL       on the deck at arrival: the planet goes out like the image it
 *               always was, the hole takes the whole view, fade to black.
 *   COLLAPSE    nobody watching at arrival: the course falls apart and resets.
 *
 * Shared state is three idempotent facts (power restored, a console set, a course executed),
 * applied locally, announced through `host.send`, and applied the same way
 * when a teammate's arrive; every client then runs the same timeline. Whether
 * *you* were on the deck at arrival is decided per client. Flicker and shake
 * are cosmetic and local (Math.random is fine here).
 *
 * Every screen, sign and notification goes through t(), same as the rest of
 * the game: the station's computer follows whichever language the player
 * has selected, not a fixed one.
 */

import * as THREE from "three";
import type { AudioManager } from "../AudioManager";
import { t } from "../../i18n";
import {
  ARRIVAL_SECONDS, OBSERVATION_REGIONS, SPACE_CONSOLES, SPACE_TARGETS, SPACE_TERMINALS, TARGET_KEY,
  SpaceConfig, SpaceConsoleId, SpaceTarget, SpaceTerminalId, WireColor, decodeSetting, encodeSetting, evaluateSpaceConfig, spaceRegionAt, wiringForSeed,
} from "./spaceLayout";
import type { MessageKey } from "../../i18n";
import { SpaceSky } from "./spaceSky";
import type { ScreenPage, ScreenTone, SpaceWorld } from "./spaceWorld";

export type SpaceAudio = Pick<AudioManager, "playTerminalBeep" | "startAlarm" | "stopAlarm" | "startSpaceAmbience" | "stopSpaceAmbience" | "setSpaceRumble" | "playSpaceSound">;

export interface SpaceHost {
  audio: SpaceAudio;
  scene: THREE.Scene;
  notify(text: string): void;
  /** Player position and horizontal look direction (unit vector). */
  player(): { x: number; z: number; lookX: number; lookZ: number };
  /** The camera's world position (the sky is centred on it). */
  viewer(out: THREE.Vector3): THREE.Vector3;
  send(kind: "power" | "set" | "exec" | "abort", index: number): void;
  /** 0 = clear, 1 = black. */
  setFade(alpha: number): void;
  /** Camera shake amplitude in metres for this frame (0 = none). */
  shake(amount: number): void;
  /** The level is won: leave it like any other exit. */
  escape(): void;
  /** Kills the local explorer (the station reached the planet). */
  kill(): void;
}

export interface SpaceTerminalView {
  id: SpaceTerminalId;
  title: string;
  lines: string[];
  tone: ScreenTone;
  /** Consoles only: the three targets, which one is set, and what the station says about each. */
  options?: { target: SpaceTarget; label: string; tag: string | null; selected: boolean }[];
  /** Helm only: whether EXECUTE is on offer. */
  canExecute?: boolean;
  /** Helm only: the planet course can still be aborted. */
  canAbort?: boolean;
  /** A sequence is running, or there is no power: nothing can be changed. */
  locked: boolean;
  /** Power terminal only, while the bus is still open: the panel's cable ends and sockets. */
  wiring?: { left: WireColor[]; right: WireColor[] };
}

type Phase = "idle" | "planetRun" | "planetArrival" | "lockRun" | "final" | "collapse" | "done";

/** Seconds from SAFE DESTINATION CONFIRMED to reaching "the planet" (and dying there). */
const PLANET_ARRIVAL_SECONDS = 26;

const CONSOLE_TITLE_KEY: Record<SpaceConsoleId, MessageKey> = {
  orientation: "space.scr.consoleTitle.orientation",
  destination: "space.scr.consoleTitle.destination",
  trajectory: "space.scr.consoleTitle.trajectory",
};

const CONSOLE_BLURB_KEY: Record<SpaceConsoleId, MessageKey> = {
  orientation: "space.scr.blurb.orientation",
  destination: "space.scr.blurb.destination",
  trajectory: "space.scr.blurb.trajectory",
};

/** The console's own short name, reusing its terminal nameplate key (ORIENTATION, DESTINATION, TRAJECTORY). */
const SPACE_CONSOLE_NAME_KEY: Record<SpaceConsoleId, MessageKey> = {
  orientation: "space.name.orientation",
  destination: "space.name.destination",
  trajectory: "space.name.trajectory",
};

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const clock = (seconds: number) => `00:00:${String(Math.max(0, Math.ceil(seconds))).padStart(2, "0")}`;
const ease = (from: number, to: number, rate: number, delta: number) => from + (to - from) * Math.min(1, rate * delta);
/** A key whose translation is several screen lines joined by "|" (same convention as Level FUN's posters). */
const lines = (key: MessageKey) => t(key).split("|");

export class SpaceDirector {
  private readonly world: SpaceWorld;
  private readonly host: SpaceHost;
  private readonly sky: SpaceSky;
  private readonly config: SpaceConfig = { orientation: null, destination: null, trajectory: null };
  private phase: Phase = "idle";
  private phaseTime = 0;
  private time = 0;
  private falseRuns = 0;
  private collapses = 0;
  private beats = new Set<string>();
  private helmMessage: { text: string; tone: ScreenTone } | null = null;
  private ambienceOn = false;
  private powered = false;
  /** Seconds since the power came back (the lights stutter on over the first two). */
  private powerTime = 0;
  private readonly wiring: { left: WireColor[]; right: WireColor[] };
  private readonly scratch = new THREE.Vector3();

  // Where the sky settles between sequences (the planet never quite recovers).
  private planetScaleRest = 1;
  private planetDriftRest = 0;

  constructor(world: SpaceWorld, host: SpaceHost) {
    this.world = world;
    this.host = host;
    this.sky = new SpaceSky();
    this.wiring = wiringForSeed(world.seed);
    host.scene.add(this.sky.root);
    this.refreshScreens();
  }

  dispose() {
    this.host.audio.stopAlarm();
    this.host.audio.stopSpaceAmbience();
    this.host.setFade(0);
    this.host.shake(0);
    this.sky.dispose();
  }

  // -------------------------------------------------------------------------
  // What the HUD says
  // -------------------------------------------------------------------------

  objective(): string | null {
    switch (this.phase) {
      case "planetRun":
        return this.phaseTime > 6.5
          ? t("space.obj.planetAbort", { t: clock(PLANET_ARRIVAL_SECONDS - this.phaseTime) })
          : t("space.obj.planetRun", { t: clock(PLANET_ARRIVAL_SECONDS - this.phaseTime) });
      case "planetArrival": return null;
      case "lockRun": return t("space.obj.lockRun", { t: clock(ARRIVAL_SECONDS - this.phaseTime) });
      case "final":
      case "done": return null;
      case "collapse": return t("space.obj.collapse");
      default:
        if (!this.powered) return t("space.obj.power");
        if (this.collapses > 0) return t("space.obj.retry");
        if (this.falseRuns > 0) return t("space.obj.wrong");
        return t("space.obj.explore");
    }
  }

  /** Ambient light/fog for this frame; the engine applies it over the level's base. */
  atmosphere(): { color: number; intensity: number; fog: number } {
    switch (this.phase) {
      case "planetRun": {
        const glitch = this.phaseTime > 6.5 && Math.sin(this.time * 23) > 0.6;
        return glitch ? { color: 0xd8e4f0, intensity: 0.7, fog: 0x05070c } : { color: 0xa6f2c0, intensity: 1.05, fog: 0x04100a };
      }
      case "lockRun": {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.2);
        return { color: 0xff5a48, intensity: 0.35 + 0.45 * pulse, fog: pulse > 0.5 ? 0x1c0404 : 0x0a0202 };
      }
      case "final":
      case "done": {
        const k = Math.min(1, this.phaseTime / 5);
        return { color: 0xffc48a, intensity: 0.6 * (1 - k) + 0.12, fog: 0x050302 };
      }
      default: {
        if (!this.powered) return { color: 0xffb080, intensity: 0.5, fog: 0x05070c };
        const k = Math.min(1, this.powerTime / 2);
        return { color: 0xdce6f5, intensity: 0.5 + 0.95 * k, fog: 0x080b12 };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  /** The terminal the player is at and facing, if any. */
  private pick(): SpaceTerminalId | null {
    if (this.phase === "final" || this.phase === "done") return null;
    const p = this.host.player();
    let best: SpaceTerminalId | null = null;
    let bestScore = Infinity;
    for (const term of SPACE_TERMINALS) {
      // Every terminal faces +z (south): the operator stands just south of it.
      const dx = term.x - p.x, dz = term.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.6 || p.z < term.z - 0.2) continue;
      const dot = dist > 0.001 ? (dx * p.lookX + dz * p.lookZ) / dist : 1;
      if (dot < 0.3) continue;
      const score = dist + (1 - dot) * 1.5;
      if (score < bestScore) { bestScore = score; best = term.id; }
    }
    return best;
  }

  interactionPrompt(): string | null {
    const id = this.pick();
    if (!id) return null;
    return t("space.act.terminal", { name: t(SPACE_TERMINALS.find((term) => term.id === id)!.nameKey) });
  }

  /** E pressed: the terminal to open, or null. */
  interact(): SpaceTerminalId | null {
    const id = this.pick();
    if (id) this.host.audio.playTerminalBeep(true);
    return id;
  }

  private busy(): boolean { return this.phase !== "idle"; }

  get isPowered(): boolean { return this.powered; }

  /** The wiring panel: one cable plugged into a socket, right colour or not. */
  wireFeedback(ok: boolean) {
    if (ok) this.host.audio.playTerminalBeep(true);
    else {
      this.host.audio.playSpaceSound("error");
      this.world.flickerBurst(0.15);
    }
  }

  /** All five cables in the right sockets (here, or on a teammate's panel). */
  powerOn(announce = true) {
    if (this.powered) return;
    this.powered = true;
    this.powerTime = 0;
    this.host.notify(t("space.ntf.powerRestored"));
    this.host.audio.playSpaceSound("power");
    this.world.flickerBurst(0.7);
    if (announce) this.host.send("power", 0);
    this.refreshScreens();
  }

  /** A console's target was picked in its modal. */
  choose(console: SpaceConsoleId, target: SpaceTarget) {
    if (this.busy() || !this.powered) { this.host.audio.playTerminalBeep(false); return; }
    this.setConsole(console, target);
    this.host.send("set", encodeSetting(console, target));
    this.host.audio.playTerminalBeep(true);
  }

  /** EXECUTE on the helm. */
  execute() {
    if (this.busy() || !this.powered) { this.host.audio.playTerminalBeep(false); return; }
    const result = evaluateSpaceConfig(this.config);
    if (result.ok === false) {
      const keys: Record<typeof result.reason, MessageKey> = {
        incomplete: "space.err.incomplete",
        conflict: "space.err.conflict",
        noCoordinates: "space.err.noCoordinates",
      };
      this.helmMessage = { text: t(keys[result.reason]), tone: "warn" };
      this.host.audio.playTerminalBeep(false);
      this.refreshScreens();
      return;
    }
    this.startRun(result.target);
    this.host.send("exec", result.target === "blackhole" ? 1 : 0);
  }

  /** ABORT on the helm, during the planet course. */
  abort() {
    if (this.phase !== "planetRun") { this.host.audio.playTerminalBeep(false); return; }
    this.abortPlanet();
    this.host.send("abort", 0);
  }

  /** The planet course is called off: the systems reset and the planet never quite recovers. */
  private abortPlanet() {
    this.countFalseRun();
    this.host.notify(t("space.ntf.aborted"));
    this.host.audio.playSpaceSound("error");
    this.resetNavigation();
  }

  private countFalseRun() {
    this.falseRuns++;
    this.planetScaleRest = Math.max(0.3, this.planetScaleRest * 0.62);
    this.planetDriftRest = Math.min(0.6, this.planetDriftRest + 0.18);
  }

  /** A teammate's action, relayed by the server. */
  applyRemote(kind: string, index: number) {
    if (kind === "power") {
      this.powerOn(false);
    } else if (kind === "abort") {
      if (this.phase === "planetRun") this.abortPlanet();
    } else if (kind === "set") {
      const s = decodeSetting(index);
      if (s && !this.busy() && this.powered) this.setConsole(s.console, s.target);
    } else if (kind === "exec" && (index === 0 || index === 1) && !this.busy() && this.powered) {
      this.startRun(index === 1 ? "blackhole" : "planet");
    }
  }

  private setConsole(console: SpaceConsoleId, target: SpaceTarget) {
    this.config[console] = target;
    this.helmMessage = null;
    this.refreshScreens();
  }

  // -------------------------------------------------------------------------
  // Terminal pages
  // -------------------------------------------------------------------------

  private planetTag(): string {
    return t(this.falseRuns > 0 ? "space.tag.recommendedErr" : "space.tag.recommended");
  }

  private tagFor(target: SpaceTarget): string {
    return target === "planet" ? this.planetTag() : t(target === "blackhole" ? "space.tag.hazard" : "space.tag.noData");
  }

  private setting(console: SpaceConsoleId): string {
    const v = this.config[console];
    return v ? t(TARGET_KEY[v]) : "---";
  }

  private page(id: SpaceTerminalId | "navDisplay"): ScreenPage {
    const P = this.phaseTime;
    if (id === "power") {
      return this.powered
        ? { title: t("space.name.power"), tone: "ok", lines: lines("space.scr.power.on") }
        : { title: t("space.name.power"), tone: "warn", lines: lines("space.scr.power.off") };
    }
    if (!this.powered) {
      if (id === "navDisplay") return { title: t("space.scr.status.title"), tone: "warn", lines: lines("space.scr.nav.offline") };
      return { title: t(SPACE_TERMINALS.find((term) => term.id === id)!.nameKey), tone: "dim", lines: lines("space.scr.term.offline") };
    }
    switch (id) {
      case "helm": {
        if (this.phase === "planetRun") {
          const bad = P > 6.5;
          return {
            title: t("space.name.helm"),
            tone: bad ? (P > 10 ? "alert" : "warn") : "ok",
            lines: bad
              ? [...lines("space.scr.helm.planetBad"), P > 10 ? t("space.scr.helm.trajInvalid") : "", "", t("space.scr.helm.arrival", { t: clock(PLANET_ARRIVAL_SECONDS - P) }), t("space.scr.helm.abortAvailable")]
              : [...lines("space.scr.helm.planetGood"), "", t("space.scr.helm.distance", { d: (0.93 - P * 0.01).toFixed(3) }), t("space.scr.helm.arrival", { t: clock(PLANET_ARRIVAL_SECONDS - P) })],
          };
        }
        if (this.phase === "lockRun") {
          return { title: t("space.name.helm"), tone: "alert", lines: [...lines("space.scr.helm.locked"), clock(ARRIVAL_SECONDS - P), "", t("space.scr.helm.obsRequired")] };
        }
        if (this.phase === "planetArrival") {
          return { title: t("space.name.helm"), tone: "alert", lines: lines("space.scr.helm.arrivalObjB") };
        }
        if (this.phase === "collapse") {
          return { title: t("space.name.helm"), tone: "warn", lines: lines("space.scr.helm.collapse") };
        }
        if (this.phase === "final" || this.phase === "done") {
          return { title: t("space.name.helm"), tone: "dim", lines: lines("space.scr.helm.arrivalFinal") };
        }
        const lines_ = [
          ...lines("space.scr.helm.idleHead"),
          ...SPACE_TARGETS.map((target) => `  ${pad(t(TARGET_KEY[target]), 12)}${target === "unknown" ? "" : this.tagFor(target)}`),
          "",
          ...SPACE_CONSOLES.map((c) => `${pad(t(SPACE_CONSOLE_NAME_KEY[c]).toUpperCase(), 13)}: ${this.setting(c)}`),
        ];
        if (this.helmMessage) lines_.push("", `> ${this.helmMessage.text}`);
        return { title: t("space.name.helm"), tone: this.helmMessage?.tone ?? "idle", lines: lines_ };
      }
      case "orientation":
      case "destination":
      case "trajectory": {
        if (this.busy()) return { title: t(CONSOLE_TITLE_KEY[id]), tone: this.phase === "lockRun" ? "alert" : "dim", lines: lines("space.scr.console.locked") };
        return {
          title: t(CONSOLE_TITLE_KEY[id]),
          tone: "idle",
          lines: [t(CONSOLE_BLURB_KEY[id]), "", t("space.scr.console.currentTarget", { v: this.setting(id) }), "", t("space.scr.console.recommendedPlanet"), t(this.falseRuns > 0 ? "space.scr.console.unverified" : "space.scr.console.safe")],
        };
      }
      case "analysis":
        return { title: t("space.name.analysis"), tone: "idle", lines: lines("space.scr.analysis") };
      case "comms":
        return { title: t("space.name.comms"), tone: "idle", lines: lines("space.scr.comms") };
      case "crewLog":
        return { title: t("space.name.crewLog"), tone: "idle", lines: lines("space.scr.crewLog") };
      case "destAnalysis":
        if (this.falseRuns === 0) {
          return { title: t("space.name.destAnalysis"), tone: "dim", lines: lines("space.scr.destAnalysis.awaiting") };
        }
        return { title: t("space.name.destAnalysis"), tone: "warn", lines: lines("space.scr.destAnalysis.ready") };
      case "navDisplay": {
        if (this.phase === "lockRun") return { title: t("space.scr.status.title"), tone: "alert", lines: [...lines("space.scr.status.lockHead"), t("space.scr.status.arrivalIn", { t: clock(ARRIVAL_SECONDS - P) }), "", t("space.scr.status.allCrew")] };
        if (this.phase === "planetRun") return { title: t("space.scr.status.title"), tone: P > 6.5 ? "alert" : "ok", lines: [...lines("space.scr.status.planetHead"), t(P > 6.5 ? "space.scr.status.trajInvalid2" : "space.scr.status.confirmed2"), "", t(P > 6.5 ? "space.scr.status.rangeErr" : "space.scr.status.rangeClosing")] };
        if (this.phase === "final" || this.phase === "done") return { title: t("space.scr.status.title"), tone: "dim", lines: [] };
        return { title: t("space.scr.status.title"), tone: "idle", lines: [...lines("space.scr.status.idle"), t(this.falseRuns > 0 ? "space.scr.status.objBErr" : "space.scr.status.objBSafe")] };
      }
    }
  }

  /** The page a modal shows for a terminal, with the console choices where there are any. */
  terminalView(id: SpaceTerminalId): SpaceTerminalView {
    const page = this.page(id);
    const view: SpaceTerminalView = { id, title: page.title, lines: page.lines, tone: page.tone, locked: this.busy() || !this.powered };
    if (id === "orientation" || id === "destination" || id === "trajectory") {
      view.options = SPACE_TARGETS.map((target) => ({ target, label: t(TARGET_KEY[target]), tag: this.tagFor(target), selected: this.config[id] === target }));
    }
    if (id === "helm") {
      view.canExecute = !this.busy() && this.powered;
      if (this.phase === "planetRun") view.canAbort = true;
    }
    if (id === "power" && !this.powered) view.wiring = { left: [...this.wiring.left], right: [...this.wiring.right] };
    return view;
  }

  private refreshScreens() {
    for (const term of SPACE_TERMINALS) this.world.drawScreen(term.id, this.page(term.id));
    this.world.drawScreen("navDisplay", this.page("navDisplay"));
  }

  // -------------------------------------------------------------------------
  // Sequences
  // -------------------------------------------------------------------------

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.phaseTime = 0;
    this.beats.clear();
  }

  /** Runs `fn` once, the first frame the phase clock passes `at`. */
  private beat(at: number, name: string, fn: () => void) {
    if (this.phaseTime >= at && !this.beats.has(name)) {
      this.beats.add(name);
      fn();
    }
  }

  private startRun(target: "planet" | "blackhole") {
    this.helmMessage = null;
    if (target === "planet") {
      this.setPhase("planetRun");
      this.host.notify(t("space.ntf.planetConfirmed"));
      this.host.audio.playSpaceSound("confirm");
    } else {
      this.setPhase("lockRun");
      this.host.notify(t("space.ntf.lockLocked", { t: clock(ARRIVAL_SECONDS) }));
      this.host.audio.startAlarm();
      this.host.audio.playSpaceSound("lock");
    }
    this.refreshScreens();
  }

  private resetNavigation() {
    for (const c of SPACE_CONSOLES) this.config[c] = null;
    this.world.setMood(null, 1);
    this.setPhase("idle");
    this.refreshScreens();
  }

  private inObservationArea(): boolean {
    const p = this.host.player();
    const region = spaceRegionAt(Math.floor(p.x / 4), Math.floor(p.z / 4));
    return !!region && OBSERVATION_REGIONS.includes(region.id);
  }

  update(delta: number) {
    this.time += delta;
    this.phaseTime += delta;
    if (!this.ambienceOn) this.ambienceOn = this.host.audio.startSpaceAmbience();

    const sky = this.sky;
    const P = this.phaseTime;
    let rumble = 0.08;
    let shake = 0;
    let fade = 0;

    switch (this.phase) {
      case "idle":
        if (!this.powered) {
          this.world.setMood(0xff8a4a, 0.3);
        } else {
          // The lights stutter on over the first two seconds after the bus closes.
          this.powerTime += delta;
          const k = Math.min(1, this.powerTime / 2);
          this.world.setMood(null, k >= 1 ? 1 : Math.random() < 0.3 ? 0.2 : 0.3 + 0.7 * k);
        }
        sky.holeScale = ease(sky.holeScale, 1, 0.8, delta);
        sky.holeHeat = ease(sky.holeHeat, 0, 1, delta);
        sky.planetScale = ease(sky.planetScale, this.planetScaleRest, 0.6, delta);
        sky.planetDrift = ease(sky.planetDrift, this.planetDriftRest, 0.6, delta);
        sky.starDrift = ease(sky.starDrift, 0, 1, delta);
        break;

      case "planetRun": {
        const bad = P > 6.5;
        this.world.setMood(bad && Math.sin(this.time * 23) > 0.6 ? null : 0x7dffa0, bad ? 0.8 : 1);
        rumble = 0.25;
        shake = 0.004;
        if (P < 6.5) {
          // The first seconds look exactly like success: it grows in the glass.
          sky.planetScale = ease(sky.planetScale, this.planetScaleRest * 1.3, 0.35, delta);
          sky.starDrift = ease(sky.starDrift, 0.012, 1, delta);
        } else {
          // Then it recedes while the station "closes in", sliding into the hole's glare.
          const shrinkTo = Math.max(0.3, this.planetScaleRest * 0.62);
          const driftTo = Math.min(0.6, this.planetDriftRest + 0.18);
          if (P > 10) {
            sky.planetScale = ease(sky.planetScale, shrinkTo, 0.25, delta);
            sky.planetDrift = ease(sky.planetDrift, driftTo, 0.25, delta);
          }
          sky.starDrift = ease(sky.starDrift, -0.006, 0.5, delta);
        }
        this.beat(6.5, "error", () => {
          this.host.notify(t("space.ntf.error"));
          this.host.audio.playTerminalBeep(false);
          this.host.audio.playSpaceSound("error");
          this.world.flickerBurst(0.35);
          this.refreshScreens();
        });
        this.beat(10, "invalid", () => {
          this.host.notify(t("space.ntf.invalid"));
          this.host.audio.playSpaceSound("error");
          this.world.flickerBurst(0.25);
          this.refreshScreens();
        });
        this.beat(16, "abortHint", () => this.host.notify(t("space.ntf.abortHint")));
        if (P >= PLANET_ARRIVAL_SECONDS) {
          // Nobody aborted: the station arrives where the planet seemed to be.
          this.setPhase("planetArrival");
          this.countFalseRun();
          this.host.notify(t("space.ntf.planetArrival"));
          this.host.audio.playSpaceSound("arrival");
          this.refreshScreens();
        } else if (Math.floor(P * 2) !== Math.floor((P - delta) * 2)) this.refreshScreens();
        break;
      }

      case "planetArrival": {
        // The image is gone the moment you reach it; so is the hull.
        sky.planetOpacity = Math.max(0, 1 - P / 1.2);
        this.world.setMood(0xffffff, Math.max(0, 1 - P));
        rumble = P < 2 ? 1 : 0.1;
        shake = P < 1.8 ? 0.05 : 0;
        fade = P < 1.8 ? Math.min(0.9, P / 1.8) : Math.max(0, 0.9 - (P - 1.8) / 1.5);
        this.beat(1.8, "kill", () => this.host.kill());
        this.beat(8, "reset", () => {
          sky.planetOpacity = 1;
          this.resetNavigation();
        });
        break;
      }

      case "lockRun": {
        const k = Math.min(1, P / ARRIVAL_SECONDS);
        this.world.setMood(0xff4a3a, 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 6.2)));
        sky.holeScale = 1 + 2.4 * k * k;
        sky.holeHeat = k;
        sky.starDrift = 0.02 + 0.06 * k;
        sky.planetDrift = ease(sky.planetDrift, Math.min(0.85, this.planetDriftRest + 0.4 * k), 1, delta);
        rumble = 0.3 + 0.6 * k;
        shake = 0.006 + 0.03 * k;
        if (Math.random() < delta * (0.4 + k)) this.world.flickerBurst(0.08);
        this.beat(3.2, "observe", () => this.host.notify(t("space.ntf.observeRequired")));
        if (Math.floor(P) !== Math.floor(P - delta)) this.refreshScreens();
        if (P >= ARRIVAL_SECONDS) {
          this.host.audio.stopAlarm();
          if (this.inObservationArea()) {
            this.setPhase("final");
            this.host.audio.playSpaceSound("arrival");
          } else {
            this.setPhase("collapse");
            this.collapses++;
            this.host.notify(t("space.ntf.collapsed"));
            this.host.audio.playSpaceSound("error");
          }
          this.refreshScreens();
        }
        break;
      }

      case "final": {
        // The hole takes the whole view; the planet goes out like the image it was.
        const grow = Math.min(1, P / 7.5);
        sky.holeScale = 3.4 + 26 * grow * grow * grow;
        sky.holeHeat = 1 + grow;
        sky.starDrift = 0.08 * (1 - grow);
        sky.planetDrift = ease(sky.planetDrift, 1, 0.5, delta);
        sky.planetScale = ease(sky.planetScale, 0.2, 0.4, delta);
        sky.planetOpacity = Math.max(0, 1 - Math.max(0, P - 0.8) / 3);
        this.world.setMood(0xffc48a, Math.max(0.05, 0.5 * (1 - P / 5)));
        rumble = P < 6 ? 0.5 + 0.5 * grow : Math.max(0, 1 - (P - 6) / 2.5);
        shake = P < 6.5 ? 0.01 + 0.025 * grow : 0;
        fade = Math.min(1, Math.max(0, (P - 6.5) / 2.5));
        this.beat(2.0, "lost", () => this.host.notify(t("space.ntf.signalLost")));
        this.beat(4.2, "never", () => this.host.notify(t("space.ntf.noSource")));
        this.beat(6.5, "horizon", () => this.host.notify(t("space.ntf.horizon")));
        this.beat(9.8, "escape", () => {
          this.setPhase("done");
          this.host.escape();
        });
        break;
      }

      case "collapse": {
        this.world.setMood(Math.sin(this.time * 17) > 0.3 ? null : 0x6a7888, 0.6);
        sky.holeScale = ease(sky.holeScale, 1, 0.5, delta);
        sky.holeHeat = ease(sky.holeHeat, 0, 0.5, delta);
        sky.starDrift = ease(sky.starDrift, -0.01, 0.6, delta);
        rumble = Math.max(0.08, 0.7 - P * 0.12);
        shake = Math.max(0, 0.02 - P * 0.004);
        this.beat(6, "reset", () => {
          this.host.notify(t("space.ntf.resetCollapse"));
          this.resetNavigation();
        });
        break;
      }

      case "done":
        rumble = 0;
        fade = 1;
        break;
    }

    this.host.audio.setSpaceRumble(rumble);
    this.host.shake(shake);
    this.host.setFade(fade);
    sky.update(delta, this.time, this.host.viewer(this.scratch));

    const p = this.host.player();
    this.world.update(delta, p.x, p.z, (x, z, opening) => {
      const dx = x - p.x, dz = z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 9) return;
      // Pan from the listener's point of view: the right-hand side of the look direction is (-lookZ, lookX).
      const pan = dist > 0.01 ? (dx * -p.lookZ + dz * p.lookX) / dist : 0;
      this.host.audio.playSpaceSound(opening ? "doorOpen" : "doorClose", pan, 1 - dist / 9);
    });
  }
}
