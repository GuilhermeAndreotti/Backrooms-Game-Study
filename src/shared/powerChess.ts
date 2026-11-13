/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Xadrez Anômalo": the lobby's second chess table, chess plus power cards.
 * Pure data and functions (no three.js, no DOM), shared by the Node relay,
 * which is the authority on every move and card, and by the client, which
 * rebuilds a game from the server's frame (`PowerChessGame.fromNet`) only to
 * highlight legal moves and card targets.
 *
 * Rules in short (docs/levels/lobby.md has the full write-up):
 * - Energy: +1 at the start of each of your turns (max 6). Whoever *loses* a
 *   piece gains energy (+1 pawn/minor, +2 rook/queen): a comeback mechanic.
 * - Hand: 3 cards to start, draw 1 per turn from your second turn on, max 7.
 *   Both players get the same 24-card deck, shuffled by the server.
 * - A turn: cards while energy permits, then your move (some replace it).
 * - Every timed effect runs out in one place, `endHalfMove()`, at the end of a
 *   half-move; a move is only legal if the mover's king is safe *after* that.
 * - Cards never touch the enemy king and never leave the opponent in check:
 *   only moves give check.
 * - Mate = no legal move and no playable card that would leave a legal state.
 */

import {
  applyMove, file, fromFen, inCheck, initialPosition, insufficientMaterial, legalMoves,
  needsPromotion, row, squareName, toFen,
  type Color, type Move, type MoveRules, type PieceType, type Position, type Promotion,
} from "./chess";

export type CardId =
  | "almond" | "sanity" | "noclip" | "tape" | "wetfloor" | "flicker"
  | "mirror" | "door" | "gust" | "blackout" | "ascend"
  | "exit" | "smiler" | "adrenaline" | "memory";

export type Rarity = "common" | "uncommon" | "rare";

export interface CardDef {
  id: CardId;
  cost: number;
  rarity: Rarity;
  /** Copies in each player's deck. */
  copies: number;
  /** How many squares the player picks (0, 1 or 2). */
  steps: 0 | 1 | 2;
  /** The card is the whole turn (no move after it). */
  endsTurn?: boolean;
  /** A piece the player picks after the squares (Ascensão). */
  choices?: ("n" | "b")[];
}

/** The card table. Costs and copies are the balance knobs (24 cards per deck). */
export const CARDS: Record<CardId, CardDef> = {
  almond: { id: "almond", cost: 0, rarity: "common", copies: 2, steps: 0 },
  sanity: { id: "sanity", cost: 1, rarity: "common", copies: 2, steps: 0 },
  noclip: { id: "noclip", cost: 2, rarity: "common", copies: 2, steps: 1 },
  tape: { id: "tape", cost: 2, rarity: "common", copies: 2, steps: 1 },
  wetfloor: { id: "wetfloor", cost: 2, rarity: "common", copies: 2, steps: 1 },
  flicker: { id: "flicker", cost: 2, rarity: "common", copies: 2, steps: 1 },
  mirror: { id: "mirror", cost: 3, rarity: "uncommon", copies: 2, steps: 2 },
  door: { id: "door", cost: 3, rarity: "uncommon", copies: 2, steps: 2 },
  gust: { id: "gust", cost: 3, rarity: "uncommon", copies: 1, steps: 1 },
  blackout: { id: "blackout", cost: 4, rarity: "uncommon", copies: 2, steps: 1 },
  ascend: { id: "ascend", cost: 4, rarity: "uncommon", copies: 1, steps: 1, choices: ["n", "b"] },
  exit: { id: "exit", cost: 4, rarity: "rare", copies: 1, steps: 1, endsTurn: true },
  smiler: { id: "smiler", cost: 5, rarity: "rare", copies: 1, steps: 1 },
  adrenaline: { id: "adrenaline", cost: 5, rarity: "rare", copies: 1, steps: 0 },
  memory: { id: "memory", cost: 6, rarity: "rare", copies: 1, steps: 1, endsTurn: true },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export const isCardId = (v: unknown): v is CardId => typeof v === "string" && Object.prototype.hasOwnProperty.call(CARDS, v);

export const POWER = {
  /** Energy before each side's first turn bonus: white plays its first turn with 2, black with 3. */
  startEnergy: { w: 1, b: 2 } as Record<Color, number>,
  maxEnergy: 6,
  startHand: 3,
  maxHand: 7,
  /** Half-moves before the game is called a draw. */
  maxPlies: 200,
  /** Log entries kept in the network frame. */
  logSize: 600,
};

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** Energy for losing a piece. */
const LOSS_ENERGY: Record<PieceType, number> = { p: 1, n: 1, b: 1, r: 2, q: 2, k: 0 };

const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** Timed effects on one piece: the last half-move (ply) each one lasts through, or -1. */
interface Fx { frozen: number; shield: number; immune: number; ghost: boolean }
const noFx = (): Fx => ({ frozen: -1, shield: -1, immune: -1, ghost: false });

export interface CardPlay { targets: number[]; choice?: "n" | "b" }

export type PowerReason = "checkmate" | "stalemate" | "resign" | "abandon" | "insufficient" | "turns";
export interface PowerResult {
  winner: Color | null;
  reason: PowerReason;
  /** The card the winner played on their mating turn (an "anomalous mate"), if any. */
  card: CardId | null;
}

/** One line of the game's log: a move (`san`) or a card (`card` + the squares it hit). */
export interface PowerLogEntry { c: Color; san?: string; card?: CardId; sq?: number[]; choice?: "n" | "b"; ply: number; elapsedMs: number }

/** What the server tells one viewer about the power table (`pchess_state`). */
export interface PowerChessNetState {
  error?: "stale" | "illegal";
  pieceIds: number[];
  rev: number;
  /** Bumped for every new game (so a client can tell a rematch from the last one). */
  game: number;
  white: string; black: string;
  whiteName: string; blackName: string;
  fen: string;
  ply: number;
  last: [number, number] | null;
  status: "waiting" | "playing" | "over";
  result: PowerResult | null;
  energy: Record<Color, number>;
  handCount: Record<Color, number>;
  deckCount: Record<Color, number>;
  /** This viewer's own hand (empty for spectators: hands are private). */
  hand: CardId[];
  /** [square, frozen-until, shield-until, immune-until, ghost 0/1] per piece with an effect. */
  fx: [number, number, number, number, number][];
  /** [square, until] per wall. */
  walls: [number, number][];
  /** Pieces each side has lost. */
  lost: Record<Color, PieceType[]>;
  /** The side to move already played its card this turn. */
  cardUsed: boolean;
  /** Adrenaline: the card is played and the first move is still to come. */
  adrenaline: boolean;
  /** Adrenaline's second move pending: the square of the piece that already moved (it can't go again), else -1. */
  extra: number;
  log: PowerLogEntry[];
  lastCard: { c: Color; card: CardId; sq: number[]; seq: number; energyGained?: number; cardsDrawn?: number; piece?: PieceType } | null;
  cardsPlayed: Record<Color, number>;
  /** The worst material deficit each side has been in this game (for the comeback achievement). */
  deficit: Record<Color, number>;
}

export const EMPTY_POWER_CHESS: PowerChessNetState = {
  pieceIds: [],
  rev: -1, game: 0, white: "", black: "", whiteName: "", blackName: "",
  fen: toFen(initialPosition()), ply: 0, last: null, status: "waiting", result: null,
  energy: { w: 0, b: 0 }, handCount: { w: 0, b: 0 }, deckCount: { w: 0, b: 0 }, hand: [],
  fx: [], walls: [], lost: { w: [], b: [] }, cardUsed: false, adrenaline: false, extra: -1,
  log: [], lastCard: null, cardsPlayed: { w: 0, b: 0 }, deficit: { w: 0, b: 0 },
};

/** Square one step "back" for a piece of `c` (toward its own first rank). */
const backOf = (sq: number, c: Color) => sq + (c === "w" ? 8 : -8);
/** A pawn can never stand on the first or last rank. */
const pawnRowOk = (sq: number) => row(sq) !== 0 && row(sq) !== 7;
const inOwnHalf = (sq: number, c: Color) => (c === "w" ? row(sq) >= 4 : row(sq) <= 3);

export class PowerChessGame {
  pos: Position = initialPosition();
  /** A stable id per piece (0 = empty), so effects travel with the piece. */
  ids: number[] = [];
  private nextId = 1;
  fx = new Map<number, Fx>();
  /** Wall square -> the last ply it lasts through. */
  walls = new Map<number, number>();
  /** Half-moves completed. */
  ply = 0;
  energy: Record<Color, number> = { ...POWER.startEnergy };
  hands: Record<Color, CardId[]> = { w: [], b: [] };
  decks: Record<Color, CardId[]> = { w: [], b: [] };
  discard: Record<Color, CardId[]> = { w: [], b: [] };
  lost: Record<Color, PieceType[]> = { w: [], b: [] };
  turns: Record<Color, number> = { w: 0, b: 0 };
  cardsPlayed: Record<Color, number> = { w: 0, b: 0 };
  deficit: Record<Color, number> = { w: 0, b: 0 };
  /** The card each side played on its last finished turn. */
  lastTurnCard: Record<Color, CardId | null> = { w: null, b: null };
  cardUsed = false;
  cardThisTurn: CardId | null = null;
  adrenaline = false;
  /** Adrenaline's second move: the piece that already moved, and the en passant square its move left. */
  extra: { id: number; ep: number } | null = null;
  log: PowerLogEntry[] = [];
  last: [number, number] | null = null;
  lastCard: PowerChessNetState["lastCard"] = null;
  private cardSeq = 0;
  private actionStarted = Date.now();

  private record(entry: Omit<PowerLogEntry, "ply" | "elapsedMs">) {
    const now = Date.now();
    this.log.push({ ...entry, ply: this.ply, elapsedMs: Math.max(0, now - this.actionStarted) });
    this.actionStarted = now;
  }
  result: PowerResult | null = null;
  private rng: (() => number) | null;

  /** With `rng` (the server) the decks are shuffled and dealt and white's first turn starts. */
  constructor(rng?: () => number) {
    this.rng = rng ?? null;
    for (let sq = 0; sq < 64; sq++) this.ids.push(this.pos.board[sq] ? this.nextId++ : 0);
    if (!rng) return;
    for (const c of ["w", "b"] as Color[]) {
      const deck: CardId[] = [];
      for (const id of CARD_IDS) for (let i = 0; i < CARDS[id].copies; i++) deck.push(id);
      this.decks[c] = this.shuffle(deck);
      this.draw(c, POWER.startHand);
    }
    this.startTurn("w");
  }

  get over(): boolean { return this.result !== null; }
  get turn(): Color { return this.pos.turn; }

  private shuffle<T>(a: T[]): T[] {
    if (!this.rng) return a;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private draw(c: Color, n: number) {
    for (let i = 0; i < n; i++) {
      if (!this.decks[c].length) { this.decks[c] = this.shuffle(this.discard[c]); this.discard[c] = []; }
      const card = this.decks[c].pop();
      if (!card) return;
      // A full hand burns the card.
      if (this.hands[c].length >= POWER.maxHand) this.discard[c].push(card);
      else this.hands[c].push(card);
    }
  }

  private startTurn(c: Color) {
    this.turns[c]++;
    this.energy[c] = Math.min(POWER.maxEnergy, this.energy[c] + 1);
    if (this.turns[c] >= 2) this.draw(c, 1);
  }

  private fxOf(id: number): Fx {
    let f = this.fx.get(id);
    if (!f) { f = noFx(); this.fx.set(id, f); }
    return f;
  }

  /** The board's modifiers as they stand during half-move `at`. */
  rulesAt(at: number): MoveRules {
    const frozen = new Set<number>(), shielded = new Set<number>(), walls = new Set<number>();
    const ghosts = new Set<number>();
    for (let sq = 0; sq < 64; sq++) {
      const f = this.ids[sq] ? this.fx.get(this.ids[sq]) : undefined;
      if (!f) continue;
      if (f.frozen >= at) frozen.add(sq);
      if (f.shield >= at) shielded.add(sq);
      if (f.ghost && at === this.ply) ghosts.add(sq);
    }
    this.walls.forEach((until, sq) => { if (until >= at) walls.add(sq); });
    return { frozen, shielded, walls, ghosts };
  }

  frozenAt(sq: number, at = this.ply) { const f = this.ids[sq] ? this.fx.get(this.ids[sq]) : undefined; return !!f && f.frozen >= at; }
  shieldedAt(sq: number, at = this.ply) { const f = this.ids[sq] ? this.fx.get(this.ids[sq]) : undefined; return !!f && f.shield >= at; }
  immuneAt(sq: number, at = this.ply) { const f = this.ids[sq] ? this.fx.get(this.ids[sq]) : undefined; return !!f && f.immune >= at; }

  /** Whether `c`'s king is attacked during half-move `at`. */
  inCheck(c: Color, at = this.ply): boolean {
    return inCheck(this.pos, c, this.rulesAt(at));
  }

  /** Legal moves for the side to move (Adrenaline's second move: no captures, no checks, another piece). */
  moves(): Move[] {
    if (this.result) return [];
    let ms = legalMoves(this.pos, this.rulesAt(this.ply), this.rulesAt(this.ply + 1));
    if (this.extra) {
      const ex = this.extra.id;
      ms = ms.filter((m) => this.ids[m.from] !== ex && !this.captures(m) && !this.givesCheck(m));
    }
    return ms;
  }

  movesFrom(sq: number): Move[] { return this.moves().filter((m) => m.from === sq); }

  private captures(m: Move): boolean {
    const p = this.pos.board[m.from];
    return !!this.pos.board[m.to] || (p?.t === "p" && m.to === this.pos.ep);
  }

  private givesCheck(m: Move): boolean {
    const rules = this.rulesAt(this.ply + 1);
    // A captured frozen piece must not transfer its frozen square to the capturer.
    rules.frozen?.delete(m.to);
    return inCheck(applyMove(this.pos, m), other(this.pos.turn), rules);
  }

  /** The side to move plays from -> to (promo defaults to a queen); false if it isn't legal now. */
  play(c: Color, from: number, to: number, promo?: Promotion): boolean {
    if (this.result || this.pos.turn !== c) return false;
    const wanted = needsPromotion(this.pos, from, to) ? promo ?? "q" : undefined;
    const mv = this.moves().find((m) => m.from === from && m.to === to && m.promo === wanted);
    if (!mv) return false;
    this.doMove(mv);
    return true;
  }

  private san(mv: Move): string {
    const pos = this.pos;
    const p = pos.board[mv.from]!;
    let s: string;
    if (p.t === "k" && Math.abs(mv.to - mv.from) === 2) s = mv.to > mv.from ? "O-O" : "O-O-O";
    else {
      const capture = this.captures(mv);
      s = p.t === "p" ? "" : p.t.toUpperCase();
      if (p.t === "p") {
        if (capture) s += "abcdefgh"[file(mv.from)];
      } else {
        const rivals = this.moves().filter((m) => m.to === mv.to && m.from !== mv.from && pos.board[m.from]?.t === p.t);
        if (rivals.length) {
          const sameFile = rivals.some((m) => file(m.from) === file(mv.from));
          const sameRow = rivals.some((m) => row(m.from) === row(mv.from));
          s += !sameFile ? "abcdefgh"[file(mv.from)] : !sameRow ? String(8 - row(mv.from)) : squareName(mv.from);
        }
      }
      s += (capture ? "x" : "") + squareName(mv.to) + (mv.promo ? "=" + mv.promo.toUpperCase() : "");
    }
    return s + (this.givesCheck(mv) ? "+" : "");
  }

  private losePiece(c: Color, t: PieceType) {
    this.lost[c].push(t);
    this.energy[c] = Math.min(POWER.maxEnergy, this.energy[c] + LOSS_ENERGY[t]);
  }

  private removeAt(sq: number) {
    const p = this.pos.board[sq];
    if (!p) return;
    this.fx.delete(this.ids[sq]);
    this.ids[sq] = 0;
    this.pos.board[sq] = null;
    this.losePiece(p.c, p.t);
  }

  private doMove(mv: Move) {
    const pos = this.pos;
    const mover = pos.turn;
    const piece = pos.board[mv.from]!;
    const san = this.san(mv);
    const id = this.ids[mv.from];
    const capSq = pos.board[mv.to] ? mv.to : piece.t === "p" && mv.to === pos.ep ? mv.to + (mover === "w" ? 8 : -8) : -1;
    if (capSq >= 0) {
      const victim = pos.board[capSq]!;
      this.fx.delete(this.ids[capSq]);
      this.ids[capSq] = 0;
      this.losePiece(victim.c, victim.t);
    }
    this.ids[mv.to] = id;
    this.ids[mv.from] = 0;
    if (piece.t === "k" && Math.abs(mv.to - mv.from) === 2) {
      const [rf, rt] = mv.to > mv.from ? [mv.to + 1, mv.to - 1] : [mv.to - 2, mv.to + 1];
      this.ids[rt] = this.ids[rf];
      this.ids[rf] = 0;
    }
    this.pos = applyMove(pos, mv);
    const f = this.fx.get(id);
    if (f) f.ghost = false;
    this.last = [mv.from, mv.to];
    this.record({ c: mover, san });

    if (this.adrenaline) {
      // Adrenaline: the same side moves again, unless this move gave check or nothing qualifies.
      this.adrenaline = false;
      if (!this.inCheck(other(mover), this.ply + 1)) {
        this.extra = { id, ep: this.pos.ep };
        this.pos = { ...this.pos, turn: mover, ep: -1, full: this.pos.full - (mover === "b" ? 1 : 0) };
        if (this.moves().length) return;
        this.pos = { ...this.pos, turn: other(mover), ep: this.extra.ep, full: this.pos.full + (mover === "b" ? 1 : 0) };
        this.extra = null;
      }
    } else if (this.extra) {
      // The second move: keep the first move's en passant square unless this one made its own.
      if (this.pos.ep < 0) this.pos = { ...this.pos, ep: this.extra.ep };
      this.extra = null;
    }
    this.finishTurn(mover);
  }

  /** Every timed effect that lasts through this half-move runs out now. */
  private endHalfMove() {
    const p = this.ply;
    this.fx.forEach((f, id) => {
      if (f.frozen >= 0 && f.frozen <= p) f.frozen = -1;
      if (f.shield >= 0 && f.shield <= p) f.shield = -1;
      if (f.immune >= 0 && f.immune <= p) f.immune = -1;
      f.ghost = false;
      if (f.frozen < 0 && f.shield < 0 && f.immune < 0) this.fx.delete(id);
    });
    this.walls.forEach((until, sq) => { if (until <= p) this.walls.delete(sq); });
    this.ply++;
  }

  private finishTurn(mover: Color) {
    this.lastTurnCard[mover] = this.cardThisTurn;
    this.cardThisTurn = null;
    this.cardUsed = false;
    this.adrenaline = false;
    this.endHalfMove();
    const mat = material(this.pos.board);
    for (const c of ["w", "b"] as Color[]) this.deficit[c] = Math.max(this.deficit[c], mat[other(c)] - mat[c]);
    this.startTurn(this.pos.turn);
    this.checkEnd();
  }

  private checkEnd() {
    const c = this.pos.turn;
    if (!this.hasAnyAction(c)) {
      this.result = this.inCheck(c)
        ? { winner: other(c), reason: "checkmate", card: this.lastTurnCard[other(c)] }
        : { winner: null, reason: "stalemate", card: null };
    } else if (insufficientMaterial(this.pos.board) && !this.memoryPiece("w") && !this.memoryPiece("b")) this.result = { winner: null, reason: "insufficient", card: null };
    else if (this.ply >= POWER.maxPlies) this.result = { winner: null, reason: "turns", card: null };
  }

  /** The side to move can do something: a legal move, or a card that leads to a legal state. */
  hasAnyAction(c: Color): boolean {
    if (this.pos.turn !== c) return false;
    if (this.moves().length) return true;
    return this.hands[c].some((_, i) => this.cardPlays(c, i).length > 0);
  }

  /** `loser` gave up or left: the other side wins. */
  end(loser: Color, reason: "resign" | "abandon") {
    if (!this.result) this.result = { winner: other(loser), reason, card: null };
  }

  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  clone(): PowerChessGame {
    const g = Object.create(PowerChessGame.prototype) as PowerChessGame;
    Object.assign(g, this);
    g.pos = { ...this.pos, board: this.pos.board.slice(), castling: { ...this.pos.castling } };
    g.ids = this.ids.slice();
    g.fx = new Map([...this.fx].map(([k, v]) => [k, { ...v }]));
    g.walls = new Map(this.walls);
    g.energy = { ...this.energy };
    g.hands = { w: this.hands.w.slice(), b: this.hands.b.slice() };
    g.decks = { w: this.decks.w.slice(), b: this.decks.b.slice() };
    g.discard = { w: this.discard.w.slice(), b: this.discard.b.slice() };
    g.lost = { w: this.lost.w.slice(), b: this.lost.b.slice() };
    g.turns = { ...this.turns };
    g.cardsPlayed = { ...this.cardsPlayed };
    g.deficit = { ...this.deficit };
    g.lastTurnCard = { ...this.lastTurnCard };
    g.extra = this.extra ? { ...this.extra } : null;
    g.log = this.log.slice();
    return g;
  }

  /** Cards can be chained before moving, but not between Adrenaline's moves. */
  canPlayCards(c: Color): boolean {
    return !this.result && this.pos.turn === c && !this.extra;
  }

  /** Any move, removal or arrival on a rook corner or king's home costs the matching castling right. */
  private touchCastle(sq: number) {
    const c = this.pos.castling;
    if (sq === 63 || sq === 60) c.K = false;
    if (sq === 56 || sq === 60) c.Q = false;
    if (sq === 7 || sq === 4) c.k = false;
    if (sq === 0 || sq === 4) c.q = false;
  }

  private relocate(from: number, to: number) {
    this.pos.board[to] = this.pos.board[from];
    this.pos.board[from] = null;
    this.ids[to] = this.ids[from];
    this.ids[from] = 0;
    this.touchCastle(from);
    this.touchCastle(to);
  }

  /** The best piece Memória da Sala would bring back for `c` (rook, then bishop, then knight), or null. */
  memoryPiece(c: Color): PieceType | null {
    for (const t of ["r", "b", "n"] as PieceType[]) if (this.lost[c].includes(t)) return t;
    return null;
  }

  /** Applies a card's effect to this game (no bookkeeping, no legality); false if the targets don't fit it. */
  private effect(c: Color, card: CardId, play: CardPlay): boolean {
    const e = other(c);
    const b = this.pos.board;
    const t = play.targets;
    const at = t[0], to = t[1];
    const own = (sq: number) => !!b[sq] && b[sq]!.c === c && b[sq]!.t !== "k";
    const enemy = (sq: number) => !!b[sq] && b[sq]!.c === e && b[sq]!.t !== "k";
    const empty = (sq: number) => !b[sq] && !this.walls.has(sq);
    const freeze = (sq: number) => {
      if (this.frozenAt(sq) || this.immuneAt(sq)) return false;
      const f = this.fxOf(this.ids[sq]);
      f.frozen = this.ply + 1;
      f.immune = this.ply + 2;
      return true;
    };
    switch (card) {
      case "almond":
        this.energy[c] = Math.min(POWER.maxEnergy, this.energy[c] + 2);
        return true;
      case "sanity":
        this.draw(c, 2);
        return true;
      case "noclip":
        if (!own(at) || !"rbqp".includes(b[at]!.t) || this.frozenAt(at)) return false;
        this.fxOf(this.ids[at]).ghost = true;
        return true;
      case "tape":
        if (!own(at) || this.shieldedAt(at)) return false;
        this.fxOf(this.ids[at]).shield = this.ply + 1;
        return true;
      case "wetfloor":
        if (!empty(at)) return false;
        this.walls.set(at, this.ply + 3);
        return true;
      case "flicker":
        return enemy(at) && "pnb".includes(b[at]!.t) && freeze(at);
      case "blackout":
        return enemy(at) && freeze(at);
      case "mirror": {
        if (!own(at) || !own(to) || at === to || b[at]!.t === b[to]!.t) return false;
        if ((b[at]!.t === "p" && !pawnRowOk(to)) || (b[to]!.t === "p" && !pawnRowOk(at))) return false;
        [b[at], b[to]] = [b[to], b[at]];
        [this.ids[at], this.ids[to]] = [this.ids[to], this.ids[at]];
        this.touchCastle(at);
        this.touchCastle(to);
        return true;
      }
      case "door":
        if (!own(at) || !empty(to) || !inOwnHalf(to, c) || (b[at]!.t === "p" && !pawnRowOk(to))) return false;
        this.relocate(at, to);
        return true;
      case "gust": {
        if (!enemy(at)) return false;
        const dest = backOf(at, e);
        if (dest < 0 || dest > 63 || !empty(dest) || (b[at]!.t === "p" && !pawnRowOk(dest))) return false;
        this.relocate(at, dest);
        return true;
      }
      case "ascend":
        if (!own(at) || b[at]!.t !== "p" || (play.choice !== "n" && play.choice !== "b")) return false;
        b[at] = { c, t: play.choice };
        return true;
      case "exit": {
        const p = b[at];
        if (p?.c !== c || p.t !== "k" || !empty(to ?? -1)) return false;
        const d = Math.max(Math.abs(file(at) - file(to)), Math.abs(row(at) - row(to)));
        if (d < 1 || d > 2) return false;
        this.relocate(at, to);
        if (c === "w") { this.pos.castling.K = false; this.pos.castling.Q = false; } else { this.pos.castling.k = false; this.pos.castling.q = false; }
        return true;
      }
      case "smiler":
        if (!enemy(at) || b[at]!.t !== "p" || this.shieldedAt(at)) return false;
        this.removeAt(at);
        return true;
      case "adrenaline":
        if (this.adrenaline) return false;
        this.adrenaline = true;
        return true;
      case "memory": {
        const piece = this.memoryPiece(c);
        if (!piece || !empty(at) || row(at) !== (c === "w" ? 7 : 0)) return false;
        b[at] = { c, t: piece };
        this.ids[at] = this.nextId++;
        this.lost[c].splice(this.lost[c].indexOf(piece), 1);
        this.touchCastle(at);
        return true;
      }
    }
  }

  /**
   * Plays the card in hand slot `index` on a copy of the game and returns the
   * copy if the result is legal; null otherwise. Nothing changes on `this`.
   */
  private tryCard(c: Color, index: number, play: CardPlay): PowerChessGame | null {
    if (!this.canPlayCards(c)) return null;
    const card = this.hands[c][index];
    if (!card) return null;
    const def = CARDS[card];
    if (this.energy[c] < def.cost) return null;
    // Exit: the player picks only the landing square; the king is implied.
    const need = card === "exit" ? 1 : def.steps;
    if (play.targets.length !== need) return null;
    const targets = card === "exit" ? [this.pos.board.findIndex((p) => p?.c === c && p.t === "k"), play.targets[0]] : play.targets;
    if (targets.some((sq) => !Number.isInteger(sq) || sq < 0 || sq > 63)) return null;
    const g = this.clone();
    g.energy[c] -= def.cost;
    g.hands[c].splice(index, 1);
    if (!g.effect(c, card, { targets, choice: play.choice })) return null;
    g.pos.ep = -1;
    if (def.endsTurn) {
      // The card is the whole turn: the mover's king must be safe once this half-move's effects run out.
      if (g.inCheck(c, g.ply + 1) || g.inCheck(other(c), g.ply + 1)) return null;
    } else {
      if (g.inCheck(other(c))) return null;
      const ms = g.moves();
      if (!ms.length) return null;
      if (card === "noclip" && !ms.some((m) => m.from === targets[0])) return null;
    }
    return g;
  }

  /** Every legal way to play hand slot `index` (the client highlights targets from this). */
  cardPlays(c: Color, index: number): CardPlay[] {
    const card = this.hands[c][index];
    if (!card || !this.canPlayCards(c) || this.energy[c] < CARDS[card].cost) return [];
    const b = this.pos.board;
    const raw: CardPlay[] = [];
    const all = [...Array(64).keys()];
    switch (card) {
      case "almond": case "sanity": case "adrenaline":
        raw.push({ targets: [] });
        break;
      case "mirror": {
        const mine = all.filter((sq) => b[sq]?.c === c && b[sq]!.t !== "k");
        for (const a of mine) for (const z of mine) if (a !== z) raw.push({ targets: [a, z] });
        break;
      }
      case "door": {
        const mine = all.filter((sq) => b[sq]?.c === c && b[sq]!.t !== "k");
        const spots = all.filter((sq) => !b[sq] && inOwnHalf(sq, c));
        for (const a of mine) for (const z of spots) raw.push({ targets: [a, z] });
        break;
      }
      case "ascend":
        for (const sq of all) if (b[sq]?.c === c && b[sq]!.t === "p") { raw.push({ targets: [sq], choice: "n" }, { targets: [sq], choice: "b" }); }
        break;
      default:
        for (const sq of all) raw.push({ targets: [sq] });
    }
    return raw.filter((p) => this.tryCard(c, index, p) !== null);
  }

  /** Plays a card for real; false if it isn't legal now. */
  playCard(c: Color, index: number, play: CardPlay): boolean {
    const g = this.tryCard(c, index, play);
    if (!g) return false;
    const card = this.hands[c][index];
    // Exit names only the landing square; the log shows where the king came from too.
    const sq = card === "exit" ? [this.pos.board.findIndex((p) => p?.c === c && p.t === "k"), play.targets[0]] : play.targets.slice();
    if (card === "gust") sq.push(backOf(sq[0], other(c)));
    const energyGained = card === "almond" ? g.energy[c] - this.energy[c] : undefined;
    const cardsDrawn = card === "sanity" ? g.hands[c].length - this.hands[c].length + 1 : undefined;
    const piece = card === "ascend" || card === "memory" ? g.pos.board[sq[0]]?.t : undefined;
    Object.assign(this, g);
    this.discard[c].push(card);
    this.cardUsed = true;
    this.cardThisTurn = card;
    this.cardsPlayed[c]++;
    this.record({ c, card, sq, choice: play.choice });
    this.lastCard = { c, card, sq, seq: ++this.cardSeq, energyGained, cardsDrawn, piece };
    if (CARDS[card].endsTurn) {
      this.last = card === "exit" ? [sq[0], sq[1]] : null;
      this.pos = { ...this.pos, turn: other(c), full: this.pos.full + (c === "b" ? 1 : 0) };
      this.finishTurn(c);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------

  /** The game part of a `pchess_state` frame for one viewer (`viewer`: their seat, or null for a spectator). */
  netState(viewer: Color | null): Omit<PowerChessNetState, "rev" | "game" | "white" | "black" | "whiteName" | "blackName"> {
    const fx: PowerChessNetState["fx"] = [];
    for (let sq = 0; sq < 64; sq++) {
      const f = this.ids[sq] ? this.fx.get(this.ids[sq]) : undefined;
      if (f) fx.push([sq, f.frozen, f.shield, f.immune, f.ghost ? 1 : 0]);
    }
    const extraSq = this.extra ? this.ids.indexOf(this.extra.id) : -1;
    return {
      pieceIds: this.ids.slice(),
      fen: toFen(this.pos),
      ply: this.ply,
      last: this.last,
      status: this.result ? "over" : "playing",
      result: this.result,
      energy: { ...this.energy },
      handCount: { w: this.hands.w.length, b: this.hands.b.length },
      deckCount: { w: this.decks.w.length, b: this.decks.b.length },
      hand: viewer ? this.hands[viewer].slice() : [],
      fx,
      walls: [...this.walls],
      lost: { w: this.lost.w.slice(), b: this.lost.b.slice() },
      cardUsed: this.cardUsed,
      adrenaline: this.adrenaline,
      extra: extraSq,
      log: this.log.slice(-POWER.logSize),
      lastCard: this.lastCard,
      cardsPlayed: { ...this.cardsPlayed },
      deficit: { ...this.deficit },
    };
  }

  /**
   * Rebuilds a game from a server frame, as seen by `viewer` (whose hand is
   * the only one known). Good for move/card-target highlighting; it never
   * draws or shuffles (no deck), and it's never the authority.
   */
  static fromNet(s: PowerChessNetState, viewer: Color | null): PowerChessGame {
    const g = new PowerChessGame();
    g.pos = fromFen(s.fen);
    g.ids = g.pos.board.map((p, sq) => (p ? sq + 1 : 0));
    g.nextId = 65;
    g.ply = s.ply;
    g.fx = new Map();
    for (const [sq, frozen, shield, immune, ghost] of s.fx) if (g.ids[sq]) g.fx.set(g.ids[sq], { frozen, shield, immune, ghost: !!ghost });
    g.walls = new Map(s.walls);
    g.energy = { ...s.energy };
    g.hands = { w: [], b: [] };
    if (viewer) g.hands[viewer] = s.hand.slice();
    g.lost = { w: s.lost.w.slice(), b: s.lost.b.slice() };
    g.cardUsed = s.cardUsed;
    g.adrenaline = s.adrenaline;
    g.extra = s.extra >= 0 && g.ids[s.extra] ? { id: g.ids[s.extra], ep: -1 } : null;
    g.result = s.result;
    g.last = s.last;
    return g;
  }
}

/** Material each side has on the board. */
export function material(board: Position["board"]): Record<Color, number> {
  const m: Record<Color, number> = { w: 0, b: 0 };
  for (const p of board) if (p) m[p.c] += PIECE_VALUE[p.t];
  return m;
}
