/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *

 * The room lobby ("level 5"): a small open-air field, roofless and walled only
 * by the sky, where explorers wait for the host to start the expedition. It
 * has a soccer field everybody can kick a ball around on. Everything here is
 * plain props on top of the generic map (which only carves the empty plot and
 * skips the walls/ceiling, see ProceduralMap.carveLobby / createCell3D).
 */

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EMPTY_CHESS, fromFen, type ChessNetState, type PieceType } from "../shared/chess";
export { LOBBY_LEVEL } from "./levels/constants";

/** Layout in world metres (the hall itself is grid cells 2..21 x 2..15, 4 m each). */
export const LOBBY = {
  field: { cx: 20, cz: 20, length: 22, width: 14 },
  goalWidth: 5,
  goalDepth: 1.4,
  spawnCell: { x: 10, z: 6 },
  hall: { minCell: 2, maxCellX: 11, maxCellZ: 9 },
  /** The cheat terminal, off in the corner away from the pitch (world XZ). */
  terminal: { x: 44, z: 34 },
  /** A big standing mirror right beside the cheat terminal; its glass faces -X (toward the pitch). */
  mirror: { x: 44, z: 30, width: 2.2, height: 3.2 },
  /**
   * The chess table, in the hall's north-east corner. White sits on its south
   * side (+z), black on the north; the board spans CHESS.board metres.
   */
  chess: { x: 40, z: 13 },
};

/** The chess table's dimensions (metres). */
export const CHESS = { top: 0.78, size: 1.7, board: 1.36, seatDist: 1.35 };

const BALL_RADIUS = 0.35;
const FRICTION = 1.25; // 1/s exponential slow-down
const RESTITUTION = 0.6;

/** Replicated ball state (short keys: it goes out ~15 times a second). */
export interface BallNetState {
  x: number; z: number; vx: number; vz: number;
  /** Goals scored so far (so late joiners and lagging clients see each goal once). */
  g: number;
}

export interface LobbyUpdateContext {
  /** This client simulates the ball (otherwise it follows the authority's frames). */
  authority: boolean;
  px: number; pz: number;
  /** Player's horizontal velocity, m/s. */
  pvx: number; pvz: number;
  /** A local kick; non-authority clients forward it to the authority. */
  onKick: (vx: number, vz: number) => void;
  onGoal: () => void;
}

export class Lobby {
  public group = new THREE.Group();
  private ball: THREE.Mesh;
  /** The mirror's glass (a planar render-to-texture reflection, see buildMirror). */
  public mirror: Reflector | null = null;

  public x = LOBBY.field.cx;
  public z = LOBBY.field.cz;
  public vx = 0;
  public vz = 0;
  public goals = 0;

  // Non-authority: last frame from the authority, extrapolated between frames.
  private netX = this.x;
  private netZ = this.z;
  private netVX = 0;
  private netVZ = 0;

  private kickCooldown = 0;
  private resetTimer = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(scene: THREE.Scene) {
    this.buildField();
    this.buildGoals();
    this.buildBenches();
    this.buildCheatTerminal();
    this.buildMirror();
    this.buildChessTable();
    this.ball = this.buildBall();
    scene.add(this.group);
  }

  // --- construction --------------------------------------------------------

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private buildField() {
    const { cx, cz, length, width } = LOBBY.field;
    const W = 1024, H = Math.round(1024 * (width / length));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? "#2f7d32" : "#2a7130";
      ctx.fillRect((i * W) / stripes, 0, W / stripes + 1, H);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 6;
    const m = 14;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
    ctx.beginPath(); ctx.moveTo(W / 2, m); ctx.lineTo(W / 2, H - m); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.17, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 7, 0, Math.PI * 2); ctx.fill();
    const boxW = W * 0.14, boxH = H * 0.5;
    ctx.strokeRect(m, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - m - boxW, (H - boxH) / 2, boxW, boxH);
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = this.track(new THREE.PlaneGeometry(length, width));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    const field = new THREE.Mesh(geo, mat);
    field.rotation.x = -Math.PI / 2;
    field.position.set(cx, 0.02, cz);
    field.receiveShadow = true;
    this.group.add(field);
  }

  private buildGoals() {
    const { cx, cz, length } = LOBBY.field;
    const half = LOBBY.goalWidth / 2;
    const depth = LOBBY.goalDepth;
    const postMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 }));
    const netMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }));
    const postGeo = this.track(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8));
    const barGeo = this.track(new THREE.CylinderGeometry(0.07, 0.07, LOBBY.goalWidth, 8));
    const backGeo = this.track(new THREE.PlaneGeometry(LOBBY.goalWidth, 2.4, 14, 6));
    const sideGeo = this.track(new THREE.PlaneGeometry(depth, 2.4, 4, 6));
    const topGeo = this.track(new THREE.PlaneGeometry(depth, LOBBY.goalWidth, 4, 14));

    for (const dir of [-1, 1]) {
      const lineX = cx + dir * (length / 2);
      const backX = lineX + dir * depth;
      for (const oz of [-half, half]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(lineX, 1.2, cz + oz);
        this.group.add(post);
      }
      const bar = new THREE.Mesh(barGeo, postMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(lineX, 2.4, cz);
      this.group.add(bar);

      const back = new THREE.Mesh(backGeo, netMat);
      back.rotation.y = Math.PI / 2;
      back.position.set(backX, 1.2, cz);
      this.group.add(back);
      for (const oz of [-half, half]) {
        const side = new THREE.Mesh(sideGeo, netMat);
        side.position.set((lineX + backX) / 2, 1.2, cz + oz);
        this.group.add(side);
      }
      const top = new THREE.Mesh(topGeo, netMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set((lineX + backX) / 2, 2.4, cz);
      this.group.add(top);
    }
  }

  private buildBenches() {
    const woodMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 }));
    const seat = this.track(new THREE.BoxGeometry(4, 0.12, 0.6));
    const leg = this.track(new THREE.BoxGeometry(0.12, 0.45, 0.5));
    const { cx, cz, width } = LOBBY.field;
    for (const ox of [-8, 8]) {
      const s = new THREE.Mesh(seat, woodMat);
      s.position.set(cx + ox, 0.5, cz + width / 2 + 1.8);
      this.group.add(s);
      for (const lx of [-1.7, 1.7]) {
        const l = new THREE.Mesh(leg, woodMat);
        l.position.set(cx + ox + lx, 0.25, cz + width / 2 + 1.8);
        this.group.add(l);
      }
    }
  }

  /**
   * A cheap full-length mirror: three's Reflector re-renders the scene from
   * the mirrored camera into a texture each frame — no ray tracing, one extra
   * low-res pass, and only while the glass faces the camera. GameEngine hangs
   * a copy of the local explorer's avatar in front of it that only the
   * reflection pass ever sees (see GameEngine.updateMirrorSelf).
   */
  private buildMirror() {
    const { x, z, width, height } = LOBBY.mirror;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = -Math.PI / 2; // local +Z (the glass's front) -> world -X
    this.group.add(root);

    const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 }));
    const bottom = 0.15;
    const glass = new Reflector(this.track(new THREE.PlaneGeometry(width, height)), {
      textureWidth: 768,
      textureHeight: 1024,
      clipBias: 0.003,
      color: 0xb8bcbf,
    });
    glass.position.set(0, bottom + height / 2, 0.03);
    root.add(glass);
    this.mirror = glass;
    this.disposables.push({ dispose: () => glass.dispose() });

    // Frame, back panel and two feet.
    const t = 0.08;
    const frame = [
      [width + t * 2, t, 0, bottom + height + t / 2],
      [width + t * 2, t, 0, bottom - t / 2],
      [t, height, -width / 2 - t / 2, bottom + height / 2],
      [t, height, width / 2 + t / 2, bottom + height / 2],
    ];
    for (const [w, h, fx, fy] of frame) {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, 0.1)), wood);
      m.position.set(fx, fy, 0.02);
      root.add(m);
    }
    const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(width, height, 0.03)), wood);
    back.position.set(0, bottom + height / 2, -0.02);
    root.add(back);
    for (const fx of [-width / 2, width / 2]) {
      const foot = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.12, 0.08, 0.6)), wood);
      foot.position.set(fx, 0.04, 0);
      root.add(foot);
    }
  }

  /**
   * The cheat terminal: a standalone kiosk in the corner of the field, off
   * the pitch. A glowing amber screen with a blinking prompt marks it as
   * interactable; the actual code entry is the CheatTerminalModal in React
   * (see GameEngine.tryInteract / submitCheatCode).
   */
  private buildCheatTerminal() {
    const { x, z } = LOBBY.terminal;
    const metalMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.5 }));

    const post = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.09, 0.11, 1.05, 8)), metalMat);
    post.position.set(x, 0.525, z);
    this.group.add(post);

    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16)), metalMat);
    base.position.set(x, 0.03, z);
    this.group.add(base);

    // Angled console head, facing the field so it reads naturally on approach.
    const head = new THREE.Group();
    head.position.set(x, 1.05, z);
    head.rotation.y = Math.atan2(LOBBY.field.cx - x, LOBBY.field.cz - z);
    this.group.add(head);

    const bezel = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.62, 0.42, 0.06)), metalMat);
    bezel.rotation.x = -0.35;
    head.add(bezel);

    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 176;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0a0f06"; ctx.fillRect(0, 0, 256, 176);
    ctx.strokeStyle = "#ffb703"; ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 160);
    ctx.fillStyle = "#ffb703";
    ctx.font = "bold 20px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText("CHEATS", 128, 78);
    ctx.font = "bold 26px Courier New, monospace";
    ctx.fillText(">_", 128, 118);
    const screenTex = new THREE.CanvasTexture(canvas);
    this.track(screenTex);
    const screen = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(0.54, 0.36)),
      this.track(new THREE.MeshBasicMaterial({ map: screenTex }))
    );
    screen.rotation.x = -0.35;
    screen.position.z = 0.032;
    head.add(screen);

    const glow = new THREE.PointLight(0xffb703, 1.6, 4.5, 1.3);
    glow.position.set(x, 1.1, z);
    this.group.add(glow);
  }

  // --- chess table ---------------------------------------------------------

  private chessPieces = new THREE.Group();
  private chessLast: THREE.Mesh[] = [];
  private chessGeo = new Map<string, THREE.BufferGeometry>();
  private chessMat!: Record<"w" | "b", THREE.MeshStandardMaterial>;
  private chessLabels: Record<"w" | "b", { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string }> | null = null;
  private chessRev = -2;

  /** Centre of a square of the board, in world metres (white's side is +z; file a is on white's left). */
  public chessSquareCenter(sq: number): { x: number; z: number } {
    const s = CHESS.board / 8;
    return { x: LOBBY.chess.x + ((sq & 7) - 3.5) * s, z: LOBBY.chess.z + ((sq >> 3) - 3.5) * s };
  }

  /** A turned piece: a profile (radius, height pairs, in units of one square) spun round the Y axis. */
  private chessLathe(key: string, profile: [number, number][]): THREE.BufferGeometry {
    let g = this.chessGeo.get(key);
    if (!g) {
      const s = CHESS.board / 8;
      g = this.track(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r * s, h * s)), 20));
      this.chessGeo.set(key, g);
    }
    return g;
  }

  private chessPiece(type: PieceType, color: "w" | "b"): THREE.Group {
    const s = CHESS.board / 8;
    const mat = this.chessMat[color];
    const base: [number, number][] = [[0, 0], [0.36, 0], [0.37, 0.05], [0.3, 0.1], [0.24, 0.16]];
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const ball = (key: string, r: number) => this.chessGeo.get(key) ?? (this.chessGeo.set(key, this.track(new THREE.SphereGeometry(r * s, 14, 10))), this.chessGeo.get(key)!);
    const box = (key: string, w: number, h: number, d: number) => this.chessGeo.get(key) ?? (this.chessGeo.set(key, this.track(new THREE.BoxGeometry(w * s, h * s, d * s))), this.chessGeo.get(key)!);
    switch (type) {
      case "p":
        add(this.chessLathe("p", [...base, [0.17, 0.3], [0.22, 0.34], [0.14, 0.38], [0.1, 0.42], [0, 0.42]]));
        add(ball("p_head", 0.17), 0, 0.5 * s);
        break;
      case "r":
        add(this.chessLathe("r", [...base, [0.22, 0.4], [0.3, 0.46], [0.3, 0.62], [0.24, 0.62], [0.24, 0.56], [0, 0.56]]));
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          add(box("r_cren", 0.12, 0.1, 0.12), Math.sin(a) * 0.23 * s, 0.67 * s, Math.cos(a) * 0.23 * s);
        }
        break;
      case "n": {
        add(this.chessLathe("n", [...base, [0.2, 0.28], [0.26, 0.34], [0.2, 0.4], [0, 0.4]]));
        // The horse's head: a leaning block with a muzzle and ears, facing the opponent's side.
        const dir = color === "w" ? -1 : 1;
        const head = add(box("n_head", 0.26, 0.46, 0.5), 0, 0.64 * s, 0.02 * dir * s);
        head.rotation.x = 0.35 * dir;
        add(box("n_muzzle", 0.2, 0.2, 0.3), 0, 0.72 * s, 0.3 * dir * s).rotation.x = -0.3 * dir;
        add(box("n_ear", 0.07, 0.14, 0.07), -0.07 * s, 0.9 * s, -0.04 * dir * s);
        add(box("n_ear", 0.07, 0.14, 0.07), 0.07 * s, 0.9 * s, -0.04 * dir * s);
        break;
      }
      case "b":
        add(this.chessLathe("b", [...base, [0.17, 0.34], [0.26, 0.42], [0.2, 0.62], [0.12, 0.76], [0, 0.78]]));
        add(ball("b_top", 0.07), 0, 0.84 * s);
        break;
      case "q":
        add(this.chessLathe("q", [...base, [0.18, 0.4], [0.3, 0.52], [0.24, 0.72], [0.3, 0.84], [0.26, 0.88], [0, 0.88]]));
        add(ball("q_top", 0.11), 0, 0.97 * s);
        break;
      case "k":
        add(this.chessLathe("k", [...base, [0.18, 0.42], [0.3, 0.55], [0.24, 0.78], [0.28, 0.9], [0.22, 0.94], [0, 0.94]]));
        add(box("k_v", 0.09, 0.3, 0.09), 0, 1.1 * s);
        add(box("k_h", 0.26, 0.09, 0.09), 0, 1.12 * s);
        break;
    }
    return g;
  }

  private buildChessTable() {
    const { x, z } = LOBBY.chess;
    const { top, size, board, seatDist } = CHESS;
    const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7 }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.6 }));
    this.chessMat = {
      w: this.track(new THREE.MeshStandardMaterial({ color: 0xf2e8d0, roughness: 0.35 })),
      b: this.track(new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.3 })),
    };
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    this.group.add(root);
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(size, 0.07, size)), wood);
    slab.position.y = top - 0.035;
    root.add(slab);
    const leg = this.track(new THREE.BoxGeometry(0.1, top - 0.07, 0.1));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = new THREE.Mesh(leg, dark);
      l.position.set(sx * (size / 2 - 0.12), (top - 0.07) / 2, sz * (size / 2 - 0.12));
      root.add(l);
    }
    // The board: an inlaid 8x8 with a little rank/file lettering on its border.
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d")!;
    const border = 64, cell = (1024 - border * 2) / 8;
    g.fillStyle = "#3e2a18"; g.fillRect(0, 0, 1024, 1024);
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      g.fillStyle = (f + r) % 2 ? "#a8744a" : "#ecd9b0";
      g.fillRect(border + f * cell, border + r * cell, cell, cell);
    }
    g.fillStyle = "#d9b87a";
    g.font = "bold 40px Georgia, serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = 0; i < 8; i++) {
      const lbl = "abcdefgh"[i], num = String(8 - i);
      g.fillText(lbl, border + (i + 0.5) * cell, 1024 - border / 2);
      g.fillText(lbl, border + (i + 0.5) * cell, border / 2);
      g.fillText(num, border / 2, border + (i + 0.5) * cell);
      g.fillText(num, 1024 - border / 2, border + (i + 0.5) * cell);
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const boardMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(board * (1024 / (1024 - border * 2)), board * (1024 / (1024 - border * 2)))), this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })));
    boardMesh.rotation.x = -Math.PI / 2;
    boardMesh.position.y = top + 0.004;
    root.add(boardMesh);
    // Last move: two squares glowing under the pieces.
    const glow = this.track(new THREE.MeshBasicMaterial({ color: 0xffd95a, transparent: true, opacity: 0.55, depthWrite: false }));
    const glowGeo = this.track(new THREE.PlaneGeometry(board / 8, board / 8));
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(glowGeo, glow);
      m.rotation.x = -Math.PI / 2;
      m.position.y = top + 0.009;
      m.visible = false;
      root.add(m);
      this.chessLast.push(m);
    }
    // The pieces live in world coordinates inside the lobby group (not the table's root).
    this.group.add(this.chessPieces);
    // A chair on each side, and a name plate on the table's edge facing it.
    const seatMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.8 }));
    const cushion = this.track(new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.95 }));
    const chairBase = this.track(new THREE.BoxGeometry(0.5, 0.06, 0.5));
    const chairBack = this.track(new THREE.BoxGeometry(0.5, 0.55, 0.06));
    const chairLeg = this.track(new THREE.BoxGeometry(0.06, 0.45, 0.06));
    const cushionGeo = this.track(new THREE.BoxGeometry(0.42, 0.05, 0.42));
    const labels: Partial<NonNullable<typeof this.chessLabels>> = {};
    for (const color of ["w", "b"] as const) {
      const side = color === "w" ? 1 : -1;
      const chair = new THREE.Group();
      chair.position.set(0, 0, side * seatDist);
      // Chairs face the table; the back is on the far side.
      const seat = new THREE.Mesh(chairBase, seatMat); seat.position.y = 0.45; chair.add(seat);
      const pad = new THREE.Mesh(cushionGeo, cushion); pad.position.y = 0.5; chair.add(pad);
      const back = new THREE.Mesh(chairBack, seatMat); back.position.set(0, 0.75, side * 0.22); chair.add(back);
      for (const lx of [-0.21, 0.21]) for (const lz of [-0.21, 0.21]) {
        const l = new THREE.Mesh(chairLeg, seatMat); l.position.set(lx, 0.225, lz); chair.add(l);
      }
      root.add(chair);
      const lc = document.createElement("canvas");
      lc.width = 256; lc.height = 64;
      const lctx = lc.getContext("2d")!;
      const ltex = this.track(new THREE.CanvasTexture(lc));
      ltex.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.125)), this.track(new THREE.MeshBasicMaterial({ map: ltex })));
      plate.position.set(0, top + 0.006, side * (size / 2 - 0.085));
      plate.rotation.x = -Math.PI / 2;
      plate.rotation.z = color === "w" ? 0 : Math.PI;
      root.add(plate);
      labels[color] = { ctx: lctx, tex: ltex, key: "" };
    }
    this.chessLabels = labels as NonNullable<typeof this.chessLabels>;
    this.setChess(EMPTY_CHESS);
  }

  /** Name plates for the two seats: "WHITE · name" / "BLACK · free". */
  private drawChessLabel(color: "w" | "b", text: string, active: boolean) {
    const l = this.chessLabels?.[color];
    if (!l) return;
    const key = `${text}|${active}`;
    if (l.key === key) return;
    l.key = key;
    const { ctx } = l;
    ctx.fillStyle = color === "w" ? "#efe4c8" : "#1f1814";
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = active ? "#ffd95a" : color === "w" ? "#3e2a18" : "#8a6a3a";
    ctx.lineWidth = active ? 8 : 4;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.fillStyle = color === "w" ? "#2a1e12" : "#efe4c8";
    ctx.font = "bold 28px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 16), 128, 34);
    l.tex.needsUpdate = true;
  }

  /** Puts the pieces where the server says they are. */
  public setChess(state: ChessNetState) {
    if (state.rev === this.chessRev && state.rev >= 0) return;
    this.chessRev = state.rev;
    this.chessPieces.clear();
    const pos = fromFen(state.fen);
    pos.board.forEach((p, sq) => {
      if (!p) return;
      const piece = this.chessPiece(p.t, p.c);
      const c = this.chessSquareCenter(sq);
      piece.position.set(c.x, CHESS.top + 0.004, c.z);
      this.chessPieces.add(piece);
    });
    this.chessLast.forEach((m, i) => {
      const sq = state.last?.[i];
      m.visible = sq !== undefined;
      if (sq !== undefined) {
        const c = this.chessSquareCenter(sq);
        m.position.x = c.x - LOBBY.chess.x;
        m.position.z = c.z - LOBBY.chess.z;
      }
    });
    const turn = state.status === "playing" ? pos.turn : null;
    this.drawChessLabel("w", `♙ ${state.whiteName || "—"}`, turn === "w");
    this.drawChessLabel("b", `♟ ${state.blackName || "—"}`, turn === "b");
  }

  private buildBall(): THREE.Mesh {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f5f5f5"; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#151515";
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc(10 + i * 22 + (j % 2) * 11, 10 + j * 22, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(BALL_RADIUS, 20, 14)),
      this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }))
    );
    ball.castShadow = true;
    ball.position.set(this.x, BALL_RADIUS + 0.02, this.z);
    this.group.add(ball);
    return ball;
  }

  // --- simulation ---------------------------------------------------------

  /** Puts a kick on the ball (called locally, and by the authority for teammates' kicks). */
  public applyKick(vx: number, vz: number) {
    this.vx = vx;
    this.vz = vz;
    this.netVX = vx;
    this.netVZ = vz;
  }

  public getState(): BallNetState {
    const r = (n: number) => Math.round(n * 100) / 100;
    return { x: r(this.x), z: r(this.z), vx: r(this.vx), vz: r(this.vz), g: this.goals };
  }

  /** Adopts the authority's frame. Returns how many new goals it announces. */
  public applyState(s: BallNetState): number {
    this.netX = s.x; this.netZ = s.z;
    this.netVX = s.vx; this.netVZ = s.vz;
    const newGoals = Math.max(0, s.g - this.goals);
    this.goals = Math.max(this.goals, s.g);
    return newGoals;
  }

  public update(delta: number, ctx: LobbyUpdateContext) {
    const dt = Math.min(delta, 0.1);
    this.kickCooldown -= dt;

    // Kick: run into the ball.
    const dx = this.x - ctx.px, dz = this.z - ctx.pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.95 && this.kickCooldown <= 0 && this.resetTimer <= 0) {
      const pSpeed = Math.hypot(ctx.pvx, ctx.pvz);
      const away = dist > 0.001 ? [dx / dist, dz / dist] : [1, 0];
      let dirX = away[0], dirZ = away[1];
      if (pSpeed > 0.4) {
        dirX = away[0] * 0.35 + (ctx.pvx / pSpeed) * 0.65;
        dirZ = away[1] * 0.35 + (ctx.pvz / pSpeed) * 0.65;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l; dirZ /= l;
      }
      const speed = Math.min(13, Math.max(3.2, pSpeed * 1.9 + 2.2));
      const kvx = dirX * speed, kvz = dirZ * speed;
      // Push it clear of the player so one touch is one kick.
      this.x = ctx.px + dirX * 1.0;
      this.z = ctx.pz + dirZ * 1.0;
      this.applyKick(kvx, kvz);
      this.kickCooldown = 0.25;
      ctx.onKick(kvx, kvz);
    }

    if (ctx.authority) {
      this.simulate(dt, ctx);
    } else {
      // Follow the authority's frames: extrapolate them, and glide onto the result.
      this.netX += this.netVX * dt;
      this.netZ += this.netVZ * dt;
      const decay = Math.exp(-FRICTION * dt);
      this.netVX *= decay; this.netVZ *= decay;
      const k = Math.min(1, 10 * dt);
      const ex = this.netX - this.x, ez = this.netZ - this.z;
      if (ex * ex + ez * ez > 36) { this.x = this.netX; this.z = this.netZ; }
      else { this.x += ex * k; this.z += ez * k; }
      this.vx = this.netVX; this.vz = this.netVZ;
    }

    // Roll the ball and place it.
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.02) {
      const axis = new THREE.Vector3(this.vz, 0, -this.vx).normalize();
      this.ball.rotateOnWorldAxis(axis, (sp * dt) / BALL_RADIUS);
    }
    this.ball.position.set(this.x, BALL_RADIUS + 0.02, this.z);

  }

  private simulate(dt: number, ctx: LobbyUpdateContext) {
    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) {
        this.x = LOBBY.field.cx; this.z = LOBBY.field.cz;
        this.vx = 0; this.vz = 0;
      }
      return;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay; this.vz *= decay;
    if (Math.hypot(this.vx, this.vz) < 0.05) { this.vx = 0; this.vz = 0; }

    const { cx, cz, length, width } = LOBBY.field;
    const halfL = length / 2, halfW = width / 2;
    const inMouth = Math.abs(this.z - cz) < LOBBY.goalWidth / 2 - 0.1;

    // Side lines bounce.
    if (this.z < cz - halfW + BALL_RADIUS) { this.z = cz - halfW + BALL_RADIUS; this.vz = Math.abs(this.vz) * RESTITUTION; }
    if (this.z > cz + halfW - BALL_RADIUS) { this.z = cz + halfW - BALL_RADIUS; this.vz = -Math.abs(this.vz) * RESTITUTION; }

    // End lines: open in the goal mouth (a goal once the ball is inside), a wall elsewhere.
    for (const dir of [-1, 1]) {
      const lineX = cx + dir * halfL;
      const past = (this.x - lineX) * dir; // >0 beyond the end line
      if (past > 0 && !inMouth) {
        this.x = lineX - dir * BALL_RADIUS * 0.5;
        this.vx = -this.vx * RESTITUTION;
      } else if (past > BALL_RADIUS + 0.4) {
        this.goals++;
        this.resetTimer = 2.5;
        this.vx = 0; this.vz = 0;
        ctx.onGoal();
        return;
      }
      // Back net of the goal.
      if (past > LOBBY.goalDepth - BALL_RADIUS) {
        this.x = lineX + dir * (LOBBY.goalDepth - BALL_RADIUS);
        this.vx = -this.vx * 0.3;
      }
    }
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
