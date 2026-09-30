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
 * The station's computer speaks English on purpose (it is part of the world,
 * like the signage); everything addressed to the player goes through t().
 */

import * as THREE from "three";
import type { AudioManager } from "../AudioManager";
import { t } from "../../i18n";
import {
  ARRIVAL_SECONDS, OBSERVATION_REGIONS, SPACE_CONSOLES, SPACE_TARGETS, SPACE_TERMINALS, TARGET_LABEL,
  SpaceConfig, SpaceConsoleId, SpaceTarget, SpaceTerminalId, WireColor, decodeSetting, encodeSetting, evaluateSpaceConfig, spaceRegionAt, wiringForSeed,
} from "./spaceLayout";
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

const CONSOLE_TITLE: Record<SpaceConsoleId, string> = {
  orientation: "ORIENTATION SYSTEM",
  destination: "DESTINATION SYSTEM",
  trajectory: "TRAJECTORY SYSTEM",
};

const CONSOLE_BLURB: Record<SpaceConsoleId, string> = {
  orientation: "CONTROLS STATION ATTITUDE.",
  destination: "SELECTS THE ARRIVAL POINT.",
  trajectory: "PLOTS THE APPROACH VECTOR.",
};

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const clock = (seconds: number) => `00:00:${String(Math.max(0, Math.ceil(seconds))).padStart(2, "0")}`;
const ease = (from: number, to: number, rate: number, delta: number) => from + (to - from) * Math.min(1, rate * delta);

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
    return t("space.act.terminal", { name: SPACE_TERMINALS.find((term) => term.id === id)!.name });
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
    this.host.notify("MAIN POWER RESTORED.");
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
      const text = {
        incomplete: "INCOMPLETE CONFIGURATION. ALL THREE SYSTEMS REQUIRED.",
        conflict: "CONFLICT: SYSTEMS NOT ALIGNED ON ONE TARGET.",
        noCoordinates: "NO COORDINATES FOR TARGET 'UNKNOWN'.",
      }[result.reason];
      this.helmMessage = { text, tone: "warn" };
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
    this.host.notify("COURSE ABORTED. DESTINATION DATA INCONSISTENT.");
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
    return this.falseRuns > 0 ? "[RECOMMENDED] ERR" : "[RECOMMENDED]";
  }

  private tagFor(target: SpaceTarget): string {
    return target === "planet" ? this.planetTag() : target === "blackhole" ? "[HAZARD]" : "[NO DATA]";
  }

  private setting(console: SpaceConsoleId): string {
    const v = this.config[console];
    return v ? TARGET_LABEL[v] : "---";
  }

  private page(id: SpaceTerminalId | "navDisplay"): ScreenPage {
    const P = this.phaseTime;
    if (id === "power") {
      return this.powered
        ? { title: "POWER DISTRIBUTION", tone: "ok", lines: ["MAIN BUS: ONLINE", "", "ALL CIRCUITS CLOSED.", "LIGHTING: NOMINAL", "NAVIGATION: AVAILABLE"] }
        : { title: "POWER DISTRIBUTION", tone: "warn", lines: ["MAIN BUS: OFFLINE", "5 CIRCUITS OPEN", "", "RECONNECT EACH CABLE", "TO THE SOCKET OF ITS", "OWN COLOUR."] };
    }
    if (!this.powered) {
      if (id === "navDisplay") return { title: "STATION STATUS", tone: "warn", lines: ["MAIN POWER: OFFLINE", "EMERGENCY LIGHTING", "", "RESTORE POWER AT", "ENGINEERING BUS"] };
      return { title: SPACE_TERMINALS.find((term) => term.id === id)!.name, tone: "dim", lines: ["", "NO POWER.", "", "MAIN BUS OFFLINE.", "RESTORE AT ENGINEERING."] };
    }
    switch (id) {
      case "helm": {
        if (this.phase === "planetRun") {
          const bad = P > 6.5;
          return {
            title: "NAVIGATION CORE",
            tone: bad ? (P > 10 ? "alert" : "warn") : "ok",
            lines: bad
              ? ["COURSE: PLANET", "", "ERROR.", "DISTANCE CANNOT BE CALCULATED.", P > 10 ? "TRAJECTORY INVALID." : "", "", `ARRIVAL: ${clock(PLANET_ARRIVAL_SECONDS - P)}`, "ABORT AVAILABLE."]
              : ["COURSE: PLANET", "", "SAFE DESTINATION CONFIRMED.", "", `DISTANCE: ${(0.93 - P * 0.01).toFixed(3)} AU`, `ARRIVAL: ${clock(PLANET_ARRIVAL_SECONDS - P)}`],
          };
        }
        if (this.phase === "lockRun") {
          return { title: "NAVIGATION CORE", tone: "alert", lines: ["TRAJECTORY LOCKED", "", "DESTINATION:", "BLACK HOLE", "", "ESTIMATED ARRIVAL:", clock(ARRIVAL_SECONDS - P), "", "OBSERVATION REQUIRED AT ARRIVAL."] };
        }
        if (this.phase === "planetArrival") {
          return { title: "NAVIGATION CORE", tone: "alert", lines: ["ARRIVAL: OBJECT B", "", "NO SURFACE.", "NO ATMOSPHERE.", "NO PLANET."] };
        }
        if (this.phase === "collapse") {
          return { title: "NAVIGATION CORE", tone: "warn", lines: ["ARRIVAL NOT OBSERVED.", "TRAJECTORY COLLAPSED.", "", "RECALCULATING..."] };
        }
        if (this.phase === "final" || this.phase === "done") {
          return { title: "NAVIGATION CORE", tone: "dim", lines: ["", "", "      ARRIVAL."] };
        }
        const lines = [
          "CURRENT POSITION",
          "UNKNOWN SECTOR",
          "",
          "AVAILABLE DESTINATIONS:",
          ...SPACE_TARGETS.map((target) => `  ${pad(TARGET_LABEL[target], 12)}${target === "unknown" ? "" : this.tagFor(target)}`),
          "",
          ...SPACE_CONSOLES.map((c) => `${pad(c.toUpperCase(), 13)}: ${this.setting(c)}`),
        ];
        if (this.helmMessage) lines.push("", `> ${this.helmMessage.text}`);
        return { title: "NAVIGATION CORE", tone: this.helmMessage?.tone ?? "idle", lines };
      }
      case "orientation":
      case "destination":
      case "trajectory": {
        if (this.busy()) return { title: CONSOLE_TITLE[id], tone: this.phase === "lockRun" ? "alert" : "dim", lines: ["", "LOCKED.", "NAVIGATION IN PROGRESS."] };
        return {
          title: CONSOLE_TITLE[id],
          tone: "idle",
          lines: [CONSOLE_BLURB[id], "", `CURRENT TARGET: ${this.setting(id)}`, "", "RECOMMENDED: PLANET", this.falseRuns > 0 ? "(RECOMMENDATION UNVERIFIED)" : "(SAFE, HABITABLE)"],
        };
      }
      case "analysis":
        return {
          title: "OBJECT ANALYSIS",
          tone: "idle",
          lines: [
            "OBJECT A", "TYPE: UNKNOWN", "GRAVITATIONAL DISTORTION: EXTREME", "EVENT HORIZON: DETECTED", "",
            "OBJECT B", "TYPE: PLANET", "ATMOSPHERE: STABLE", "LIFE SIGNATURE: DETECTED", "DISTANCE: ERROR", "",
            "WARNING:", "OBJECT B DOES NOT OBEY", "EXPECTED ORBITAL PARAMETERS.",
          ],
        };
      case "comms":
        return {
          title: "SIGNAL LOG",
          tone: "idle",
          lines: [
            "SOURCE: OBJECT B", "FREQUENCY: 121.500 MHZ (THIS STATION)", "CONTENT: OUR OWN DISTRESS CALL", "DELAY: -00:04:12", "",
            "NOTE: THE REPLY ARRIVES BEFORE", "WE TRANSMIT. B ONLY REPEATS US.", "",
            "SOURCE: OBJECT A", "SIGNAL: NONE. NOTHING COMES BACK.",
          ],
        };
      case "crewLog":
        return {
          title: "CREW LOG",
          tone: "idle",
          lines: [
            "ENTRY 311", "Course set for the planet again.", "Day 3 of approach: it is SMALLER.", "Kessler says it was never behind",
            "the anomaly. Only its light, bent", "around it. The computer still", "calls it SAFE. The computer has", "never looked out a window.", "",
            "ENTRY 312", "Kessler aimed us at the dark and", "went to the deck to watch.",
          ],
        };
      case "destAnalysis":
        if (this.falseRuns === 0) {
          return { title: "DESTINATION ANALYSIS", tone: "dim", lines: ["STATUS: AWAITING DATA", "", "NO COURSE ON RECORD.", "EXECUTE A COURSE TO", "GENERATE ANALYSIS."] };
        }
        return {
          title: "DESTINATION ANALYSIS",
          tone: "warn",
          lines: [
            "PLANET", "STATUS: INVALID", "DISTANCE GROWS UNDER APPROACH", "",
            "BLACK HOLE", "STATUS: VALID", "TRAJECTORY: CALCULABLE", "",
            "UNKNOWN", "STATUS: NO COORDINATES",
          ],
        };
      case "navDisplay": {
        if (this.phase === "lockRun") return { title: "STATION STATUS", tone: "alert", lines: ["", "TRAJECTORY LOCKED", "DESTINATION: BLACK HOLE", "", `ARRIVAL IN ${clock(ARRIVAL_SECONDS - P)}`, "", "ALL CREW TO OBSERVATION DECK"] };
        if (this.phase === "planetRun") return { title: "STATION STATUS", tone: P > 6.5 ? "alert" : "ok", lines: ["", "COURSE: PLANET", P > 6.5 ? "TRAJECTORY INVALID" : "SAFE DESTINATION CONFIRMED", "", `OBJECT B RANGE: ${P > 6.5 ? "ERR" : "CLOSING"}`] };
        if (this.phase === "final" || this.phase === "done") return { title: "STATION STATUS", tone: "dim", lines: [] };
        return {
          title: "STATION STATUS",
          tone: "idle",
          lines: ["POWER: 31%", "LIFE SUPPORT: NOMINAL", "CREW ABOARD: 0", "POSITION: UNKNOWN SECTOR", "", "OBJECT A: BEARING 000, CLOSE", `OBJECT B: BEARING 007, ${this.falseRuns > 0 ? "RANGE ERR" : "SAFE"}`],
        };
      }
    }
  }

  /** The page a modal shows for a terminal, with the console choices where there are any. */
  terminalView(id: SpaceTerminalId): SpaceTerminalView {
    const page = this.page(id);
    const view: SpaceTerminalView = { id, title: page.title, lines: page.lines, tone: page.tone, locked: this.busy() || !this.powered };
    if (id === "orientation" || id === "destination" || id === "trajectory") {
      view.options = SPACE_TARGETS.map((target) => ({ target, label: TARGET_LABEL[target], tag: this.tagFor(target), selected: this.config[id] === target }));
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
      this.host.notify("SAFE DESTINATION CONFIRMED.");
      this.host.audio.playSpaceSound("confirm");
    } else {
      this.setPhase("lockRun");
      this.host.notify(`TRAJECTORY LOCKED · DESTINATION: BLACK HOLE · ESTIMATED ARRIVAL: ${clock(ARRIVAL_SECONDS)}`);
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
          this.host.notify("ERROR. DISTANCE CANNOT BE CALCULATED.");
          this.host.audio.playTerminalBeep(false);
          this.host.audio.playSpaceSound("error");
          this.world.flickerBurst(0.35);
          this.refreshScreens();
        });
        this.beat(10, "invalid", () => {
          this.host.notify("TRAJECTORY INVALID.");
          this.host.audio.playSpaceSound("error");
          this.world.flickerBurst(0.25);
          this.refreshScreens();
        });
        this.beat(16, "abortHint", () => this.host.notify("WARNING: OBJECT B NOT FOUND AT DESTINATION. ABORT RECOMMENDED."));
        if (P >= PLANET_ARRIVAL_SECONDS) {
          // Nobody aborted: the station arrives where the planet seemed to be.
          this.setPhase("planetArrival");
          this.countFalseRun();
          this.host.notify("ARRIVAL: OBJECT B. NO SURFACE. NO PLANET.");
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
        this.beat(3.2, "observe", () => this.host.notify("OBSERVATION REQUIRED AT ARRIVAL. PROCEED TO OBSERVATION DECK."));
        if (Math.floor(P) !== Math.floor(P - delta)) this.refreshScreens();
        if (P >= ARRIVAL_SECONDS) {
          this.host.audio.stopAlarm();
          if (this.inObservationArea()) {
            this.setPhase("final");
            this.host.audio.playSpaceSound("arrival");
          } else {
            this.setPhase("collapse");
            this.collapses++;
            this.host.notify("ARRIVAL NOT OBSERVED. TRAJECTORY COLLAPSED.");
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
        this.beat(2.0, "lost", () => this.host.notify("OBJECT B: SIGNAL LOST."));
        this.beat(4.2, "never", () => this.host.notify("OBJECT B: NO SOURCE. ONLY LIGHT, BENT AROUND OBJECT A."));
        this.beat(6.5, "horizon", () => this.host.notify("EVENT HORIZON."));
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
          this.host.notify("NAVIGATION RESET. AN OBSERVER MUST BE ON DECK AT ARRIVAL.");
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
