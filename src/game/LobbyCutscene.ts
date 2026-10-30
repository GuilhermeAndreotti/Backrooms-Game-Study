/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The expedition's two bookends, played in the room lobby with the local
 * explorer's own avatar (suit, face, outfit or SKIN) while GameEngine hands
 * this the camera:
 *
 *  - "intro": the host starts the game. The camera pulls out of your eyes,
 *    you walk a few steps across the lobby, the world starts to glitch and
 *    you noclip down through the ground — into Level 0 (the app runs the
 *    level transition once this ends).
 *  - "ending": back from one of the two endings (Level 79 / Level 94). You
 *    glitch back into the lobby, land, cheer, then walk to the chess table's
 *    chair and sit down to rest before the extraction report.
 *
 * Purely local and visual: every explorer plays their own. Nothing here is
 * replicated, and it never touches the player's simulated position except to
 * leave them standing by the chair at the end of the ending.
 */

import * as THREE from "three";
import { CHESS, LOBBY } from "./Lobby";

export type CutsceneKind = "intro" | "ending";

export interface CutsceneHost {
  scene: THREE.Scene;
  /** A fresh avatar of the local explorer, feet at y = 0 of its group. */
  makeAvatar(): THREE.Group;
  disposeAvatar(avatar: THREE.Group): void;
  /** Walk/idle gait from the avatar's own motion (GameEngine.poseRemotePlayer). */
  pose(avatar: THREE.Group, delta: number, state: "idle" | "walking"): void;
  sound(kind: "noclip" | "home" | "sigh"): void;
}

/** Where the explorer is when the intro starts (eye position and look yaw, PlayerController's). */
export interface CutsceneStart { x: number; z: number; eyeY: number; yaw: number }

const INTRO_LENGTH = 5.6;
const ENDING_LENGTH = 15.5;
const WALK_SPEED = 1.45;
/** Where it walks inside the lobby's fence (world XZ), with a margin. */
const WALK_BOUNDS = { minX: 10, maxX: 46.5, minZ: 10, maxZ: 38.5 };

/** White's chair at the chess table: you sit facing the board (-Z). */
const CHAIR = { x: LOBBY.chess.x, z: LOBBY.chess.z + CHESS.seatDist, seat: 0.5 };
/** Beside the chair (east), where you step in from. */
const CHAIR_SIDE = { x: CHAIR.x + 0.72, z: CHAIR.z };
/** Where you land, coming back: the open plaza south-west of the table. */
const ARRIVAL = { x: 38.6, z: 18.8 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 before a, 1 after b, smooth in between. */
const ramp = (a: number, b: number, t: number) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };
const lerp = THREE.MathUtils.lerp;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Rig = Record<"hips" | "spine" | "head" | "lLeg" | "rLeg" | "lShin" | "rShin" | "lArm" | "rArm" | "lForearm" | "rForearm", THREE.Object3D | undefined>;

export class LobbyCutscene {
  /** 0..1 VHS distortion this frame (GameEngine feeds it to the post pass). */
  glitch = 0;
  /** 0..1 fade to black this frame. */
  black = 0;
  private time = 0;
  private readonly avatar: THREE.Group;
  private readonly rig: Rig;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly yaw: number;
  private readonly cues = new Set<string>();
  private finished = false;

  constructor(readonly kind: CutsceneKind, private readonly host: CutsceneHost, start: CutsceneStart) {
    this.avatar = host.makeAvatar();
    // No floating name over your own head in a shot of yourself.
    this.avatar.traverse((o) => { if (o instanceof THREE.Sprite) o.visible = false; });
    host.scene.add(this.avatar);
    this.rig = Object.fromEntries(
      ["hips", "spine", "head", "lLeg", "rLeg", "lShin", "rShin", "lArm", "rArm", "lForearm", "rForearm"].map((n) => [n, this.avatar.getObjectByName(n)]),
    ) as Rig;
    this.yaw = start.yaw;
    this.eye.set(start.x, start.eyeY, start.z);

    if (kind === "intro") {
      // A few steps the way you were looking — or toward the middle of the lobby if a fence is in the way.
      this.from.set(start.x, 0, start.z);
      let dir = new THREE.Vector3(-Math.sin(start.yaw), 0, -Math.cos(start.yaw));
      const clampTo = (v: THREE.Vector3) => v.set(
        THREE.MathUtils.clamp(v.x, WALK_BOUNDS.minX, WALK_BOUNDS.maxX), 0, THREE.MathUtils.clamp(v.z, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ));
      this.to.copy(this.from).addScaledVector(dir, 4.6);
      clampTo(this.to);
      if (this.to.distanceTo(this.from) < 3) {
        dir = new THREE.Vector3(28 - start.x, 0, 24 - start.z).normalize();
        this.to.copy(this.from).addScaledVector(dir, 4.6);
        clampTo(this.to);
      }
    } else {
      this.from.set(ARRIVAL.x, 0, ARRIVAL.z);
      this.to.set(CHAIR_SIDE.x, 0, CHAIR_SIDE.z);
    }
    this.avatar.position.copy(this.from);
    this.avatar.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
  }

  get done(): boolean { return this.finished; }

  /** Jump to the end (a key press). The intro still cuts to black so the level change reads the same. */
  skip() {
    this.time = Math.max(this.time, this.kind === "intro" ? INTRO_LENGTH - 0.5 : ENDING_LENGTH - 0.3);
  }

  /** Where the player should stand once the ending hands control back (eye position, look yaw). */
  static readonly endingStand = { x: CHAIR_SIDE.x + 0.4, z: CHAIR_SIDE.z + 0.6, yaw: Math.PI * 0.75 };

  update(delta: number, cameraRig: THREE.Object3D, camera: THREE.Camera) {
    if (this.finished) return;
    this.time += delta;
    if (this.kind === "intro") this.updateIntro(delta);
    else this.updateEnding(delta);
    // The camera: rig placed and aimed, the camera itself at the rig's origin (like Level 94's cinematic).
    cameraRig.position.copy(this.eye);
    cameraRig.lookAt(this.look);
    cameraRig.rotateY(Math.PI);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    if (this.time >= (this.kind === "intro" ? INTRO_LENGTH : ENDING_LENGTH)) this.finished = true;
  }

  dispose() {
    this.host.scene.remove(this.avatar);
    this.host.disposeAvatar(this.avatar);
  }

  private cue(key: string, at: number, play: () => void) {
    if (this.time >= at && !this.cues.has(key)) { this.cues.add(key); play(); }
  }

  // -------------------------------------------------------------------
  // Intro: a walk, then the floor gives way
  // -------------------------------------------------------------------

  private updateIntro(delta: number) {
    const T = this.time;
    const a = this.avatar;
    const walkTime = this.from.distanceTo(this.to) / WALK_SPEED;
    const walkK = clamp01((T - 0.35) / walkTime);
    const walking = T > 0.35 && walkK < 1 && T < 3.4;
    if (walking) a.position.lerpVectors(this.from, this.to, walkK);
    // The noclip: it stops, looks down, and the ground lets it through.
    const sink = ramp(3.5, 4.9, T);
    a.position.y = -sink * sink * 2.4;
    this.host.pose(a, delta, walking ? "walking" : "idle");
    this.glitch = ramp(2.6, 3.6, T) * (1 - ramp(4.9, 5.4, T) * 0.4);
    // It flickers in and out as the room loses its grip on it.
    // (Hidden for the first instant: the camera starts inside its head.)
    a.visible = T > 0.25 && (T < 3.3 || Math.sin(T * 61) + Math.sin(T * 23.7) > -1.3 + sink * 1.4);
    const { head, lArm, rArm, lForearm, rForearm, spine } = this.rig;
    const stumble = ramp(3.0, 3.6, T);
    if (head) head.rotation.x = lerp(head.rotation.x, 0.75, stumble);
    if (spine) spine.rotation.z = Math.sin(T * 17) * 0.08 * stumble;
    // Arms flung out as it drops.
    if (lArm) lArm.rotation.set(lerp(lArm.rotation.x, -0.6, sink), 0, lerp(lArm.rotation.z, -1.2, sink));
    if (rArm) rArm.rotation.set(lerp(rArm.rotation.x, -0.6, sink), 0, lerp(rArm.rotation.z, 1.2, sink));
    if (lForearm) lForearm.rotation.x = lerp(lForearm.rotation.x, -0.2, sink);
    if (rForearm) rForearm.rotation.x = lerp(rForearm.rotation.x, -0.2, sink);
    // Jitter: the body snaps a few centimetres around, like a bad frame.
    if (stumble > 0 && Math.sin(T * 41) > 0.7) a.position.x += (Math.sin(T * 97) * 0.06) * stumble;
    this.cue("noclip", 3.35, () => this.host.sound("noclip"));
    this.black = ramp(4.5, 5.4, T);

    // Camera: out of your own eyes, back over the shoulder, then round to the side as you fall.
    const p = a.position;
    const fx = Math.sin(a.rotation.y), fz = Math.cos(a.rotation.y);
    const side = new THREE.Vector3(fz, 0, -fx);
    const behind = new THREE.Vector3(p.x - fx * 3.4 + side.x * 1.2, 2.1, p.z - fz * 3.4 + side.z * 1.2);
    const flank = new THREE.Vector3(p.x + side.x * 3.6 + fx * 1.4, 1.45, p.z + side.z * 3.6 + fz * 1.4);
    const pull = ramp(0, 1.1, T);
    const swing = ramp(2.2, 4.0, T);
    this.eye.copy(this.eyeStart()).lerp(behind, pull).lerp(flank, swing);
    this.look.set(p.x + fx * 1.5 * (1 - pull), lerp(1.2, 0.7, swing) + Math.min(0, p.y) * 0.6, p.z + fz * 1.5 * (1 - pull));
  }

  /** The first frame's camera: the explorer's own eyes. */
  private eyeStart(): THREE.Vector3 {
    return new THREE.Vector3(this.from.x, 1.6, this.from.z);
  }

  // -------------------------------------------------------------------
  // Ending: back home, a little dance, a seat
  // -------------------------------------------------------------------

  private updateEnding(delta: number) {
    const T = this.time;
    const a = this.avatar;
    const r = this.rig;

    // 0 - 1.3: out of the static, a short drop onto the plaza.
    this.black = 1 - ramp(0, 0.9, T);
    this.glitch = 1 - ramp(0.6, 1.8, T);
    const drop = 1 - ramp(0.3, 1.05, T);
    a.position.set(ARRIVAL.x, drop * drop * 2.2, ARRIVAL.z);
    a.visible = T > 0.9 || Math.sin(T * 53) + Math.sin(T * 19) > 0.2 - T;
    this.cue("noclip", 0, () => this.host.sound("noclip"));
    const landing = ramp(1.0, 1.15, T) * (1 - ramp(1.15, 1.7, T));

    // 2.0 - 4.4: home. Two hops, arms up.
    const cheer = ramp(1.9, 2.2, T) * (1 - ramp(4.2, 4.6, T));
    const hop = T > 2.1 && T < 4.3 ? Math.abs(Math.sin((T - 2.1) * Math.PI * 1.35)) : 0;
    a.position.y += hop * 0.32 * cheer;
    this.cue("home", 2.05, () => this.host.sound("home"));

    // 4.6 - 8.9: the walk to the chair.
    const walkStart = 4.6;
    const walkTime = this.from.distanceTo(this.to) / WALK_SPEED;
    const walkK = clamp01((T - walkStart) / walkTime);
    const walking = T > walkStart && walkK < 1;
    if (T > walkStart) a.position.lerpVectors(this.from, this.to, walkK);
    const walkYaw = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
    // Before the walk it turns to look at the camera; after it, it turns to face the board.
    const arriveT = walkStart + walkTime;
    const sitStart = arriveT + 0.35;
    const sit = ramp(sitStart, sitStart + 0.9, T);
    const faceBoard = Math.PI;
    const toCamera = Math.atan2(-1.2, 3.6); // the "front" shot below
    let yaw = toCamera + wrap(walkYaw - toCamera) * ramp(walkStart - 0.5, walkStart, T);
    if (T > arriveT) yaw = walkYaw + wrap(faceBoard - walkYaw) * ramp(arriveT, sitStart + 0.5, T);
    a.rotation.y = yaw;
    // Sliding sideways onto the seat while it lowers itself.
    if (sit > 0) {
      a.position.x = lerp(CHAIR_SIDE.x, CHAIR.x, sit);
      a.position.z = lerp(CHAIR_SIDE.z, CHAIR.z + 0.05, sit);
    }
    this.host.pose(a, delta, walking ? "walking" : "idle");

    // --- Overrides on the gait --------------------------------------------
    const { hips, spine, head, lLeg, rLeg, lShin, rShin, lArm, rArm, lForearm, rForearm } = r;
    // Landing: knees give, then it straightens.
    if (hips) hips.position.y -= landing * 0.14;
    if (lShin) lShin.rotation.x += landing * 0.7;
    if (rShin) rShin.rotation.x += landing * 0.7;
    if (lLeg) lLeg.rotation.x -= landing * 0.45;
    if (rLeg) rLeg.rotation.x -= landing * 0.45;
    // Looking round: "is this really it?"
    const lookRound = ramp(1.3, 1.6, T) * (1 - ramp(1.9, 2.1, T));
    if (head) head.rotation.y = Math.sin((T - 1.3) * 5) * 0.6 * lookRound;
    // Cheering: both arms up, waving.
    if (cheer > 0) {
      const wave = Math.sin(T * 9) * 0.25;
      if (lArm) lArm.rotation.set(lerp(lArm.rotation.x, -2.9 + wave, cheer), 0, lerp(lArm.rotation.z, -0.35, cheer));
      if (rArm) rArm.rotation.set(lerp(rArm.rotation.x, -2.9 - wave, cheer), 0, lerp(rArm.rotation.z, 0.35, cheer));
      if (lForearm) lForearm.rotation.x = lerp(lForearm.rotation.x, -0.35, cheer);
      if (rForearm) rForearm.rotation.x = lerp(rForearm.rotation.x, -0.35, cheer);
      if (head) head.rotation.x = lerp(head.rotation.x, -0.35, cheer);
      if (spine) spine.rotation.x -= 0.12 * cheer;
      // Knees tuck on each hop.
      if (lShin) lShin.rotation.x += hop * 0.6 * cheer;
      if (rShin) rShin.rotation.x += hop * 0.6 * cheer;
    }
    // Sitting: thighs forward, shins down, hips onto the seat; then it slumps back and breathes out.
    if (sit > 0) {
      const rest = ramp(sitStart + 1.1, sitStart + 2.2, T);
      const breath = Math.sin(T * 1.3) * 0.03;
      if (hips) hips.position.y = lerp(hips.position.y, CHAIR.seat + 0.03, sit);
      if (lLeg) lLeg.rotation.x = lerp(lLeg.rotation.x, -1.5, sit);
      if (rLeg) rLeg.rotation.x = lerp(rLeg.rotation.x, -1.45, sit);
      if (lShin) lShin.rotation.x = lerp(lShin.rotation.x, 1.45, sit);
      if (rShin) rShin.rotation.x = lerp(rShin.rotation.x, 1.35, sit);
      if (spine) spine.rotation.x = lerp(spine.rotation.x, -0.22 * rest + breath, sit);
      if (head) {
        head.rotation.x = lerp(head.rotation.x, -0.42 * rest + 0.12 * (1 - rest), sit);
        head.rotation.y = lerp(head.rotation.y, 0.15 * rest, sit);
      }
      // Hands come to rest on the thighs.
      if (lArm) lArm.rotation.set(lerp(lArm.rotation.x, -0.3, sit), 0, lerp(lArm.rotation.z, -0.18, sit));
      if (rArm) rArm.rotation.set(lerp(rArm.rotation.x, -0.3, sit), 0, lerp(rArm.rotation.z, 0.18, sit));
      if (lForearm) lForearm.rotation.x = lerp(lForearm.rotation.x, -1.0, sit);
      if (rForearm) rForearm.rotation.x = lerp(rForearm.rotation.x, -1.0, sit);
      this.cue("sigh", sitStart + 1.2, () => this.host.sound("sigh"));
    }
    // The last moment fades out under the report.
    this.black = Math.max(this.black, ramp(ENDING_LENGTH - 0.9, ENDING_LENGTH, T) * 0.65);

    // --- Camera ----------------------------------------------------------
    const p = a.position;
    const chest = new THREE.Vector3(p.x, Math.max(0.9, p.y + 1.0), p.z);
    const wide = new THREE.Vector3(ARRIVAL.x - 4.5, 2.6, ARRIVAL.z + 5.5);
    const front = new THREE.Vector3(ARRIVAL.x - 1.2, 1.3, ARRIVAL.z + 3.6);
    const follow = new THREE.Vector3(p.x - 2.6, 1.9, p.z + 3.0);
    // Seated: from the east, a little behind the chair, the board in front of it; then slowly closer.
    const seatA = new THREE.Vector3(CHAIR.x + 2.7, 1.5, CHAIR.z + 1.1);
    const seatB = new THREE.Vector3(CHAIR.x + 1.8, 1.2, CHAIR.z + 0.6);
    const toFront = ramp(1.4, 2.4, T);
    const toFollow = ramp(4.4, 5.6, T);
    const toSeat = ramp(arriveT - 1.0, arriveT + 0.6, T);
    const pushIn = ramp(sitStart + 1.0, ENDING_LENGTH, T);
    this.eye.copy(wide).lerp(front, toFront).lerp(follow, toFollow).lerp(seatA, toSeat).lerp(seatB, pushIn);
    this.look.copy(chest);
    if (T < 1.1) this.look.y = 0.9;
  }
}
