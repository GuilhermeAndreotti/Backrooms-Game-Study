/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chess rules for the lobby's table: move generation with full legality
 * (check, castling, en passant, promotion), SAN, FEN, and the game-over
 * conditions. Pure data and functions with no three.js or DOM, shared
 * verbatim by the client (the board panel, the 3D table) and the Node relay
 * server, which is the one that decides whether a move is legal.
 *
 * Squares are indices 0..63 in FEN order: 0 = a8, 7 = h8, 56 = a1, 63 = h1.
 */

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type Promotion = "q" | "r" | "b" | "n";

export interface Piece { c: Color; t: PieceType }

export interface Castling { K: boolean; Q: boolean; k: boolean; q: boolean }

export interface Position {
  board: (Piece | null)[];
  turn: Color;
  castling: Castling;
  /** En passant target square (the one a pawn just skipped), or -1. */
  ep: number;
  /** Half-moves since the last capture or pawn move (the fifty-move rule). */
  half: number;
  full: number;
}

export interface Move { from: number; to: number; promo?: Promotion }

export type GameStatus = "playing" | "checkmate" | "stalemate" | "fifty" | "insufficient";

export type ChessReason = "checkmate" | "stalemate" | "resign" | "abandon" | "fifty" | "insufficient" | "repetition";
export interface ChessResult { winner: Color | null; reason: ChessReason }

export const file = (sq: number) => sq & 7;
/** 0 = rank 8 .. 7 = rank 1. */
export const row = (sq: number) => sq >> 3;
export const square = (f: number, r: number) => r * 8 + f;
export const squareName = (sq: number) => "abcdefgh"[file(sq)] + (8 - row(sq));

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function fromFen(fen: string): Position {
  const [placement, turn, castle, ep, half, full] = fen.split(" ");
  const board: (Piece | null)[] = [];
  for (const ch of placement) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") { for (let i = 0; i < +ch; i++) board.push(null); continue; }
    board.push({ c: ch === ch.toUpperCase() ? "w" : "b", t: ch.toLowerCase() as PieceType });
  }
  while (board.length < 64) board.push(null);
  return {
    board: board.slice(0, 64),
    turn: turn === "b" ? "b" : "w",
    castling: { K: castle?.includes("K") ?? false, Q: castle?.includes("Q") ?? false, k: castle?.includes("k") ?? false, q: castle?.includes("q") ?? false },
    ep: ep && ep !== "-" ? square("abcdefgh".indexOf(ep[0]), 8 - +ep[1]) : -1,
    half: +half || 0,
    full: +full || 1,
  };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[square(f, r)];
      if (!p) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += p.c === "w" ? p.t.toUpperCase() : p.t;
    }
    rows.push(s + (empty || ""));
  }
  const c = pos.castling;
  const castle = (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "") || "-";
  return `${rows.join("/")} ${pos.turn} ${castle} ${pos.ep >= 0 ? squareName(pos.ep) : "-"} ${pos.half} ${pos.full}`;
}

export function initialPosition(): Position {
  return fromFen(START);
}

const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const other = (c: Color): Color => (c === "w" ? "b" : "w");
const inside = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Whether `sq` is attacked by any piece of `by`. */
export function isAttacked(board: (Piece | null)[], sq: number, by: Color): boolean {
  const f = file(sq), r = row(sq);
  // Pawns: a white pawn attacks up the board (towards row 0), so it sits one row below the target.
  const pr = by === "w" ? r + 1 : r - 1;
  for (const df of [-1, 1]) {
    if (!inside(f + df, pr)) continue;
    const p = board[square(f + df, pr)];
    if (p && p.c === by && p.t === "p") return true;
  }
  for (const [df, dr] of KNIGHT) {
    if (!inside(f + df, r + dr)) continue;
    const p = board[square(f + df, r + dr)];
    if (p && p.c === by && p.t === "n") return true;
  }
  for (const [df, dr] of KING) {
    if (!inside(f + df, r + dr)) continue;
    const p = board[square(f + df, r + dr)];
    if (p && p.c === by && p.t === "k") return true;
  }
  const ray = (dirs: [number, number][], types: PieceType[]) => {
    for (const [df, dr] of dirs) {
      for (let k = 1; ; k++) {
        const ff = f + df * k, rr = r + dr * k;
        if (!inside(ff, rr)) break;
        const p = board[square(ff, rr)];
        if (!p) continue;
        if (p.c === by && types.includes(p.t)) return true;
        break;
      }
    }
    return false;
  };
  return ray(ROOK_DIRS, ["r", "q"]) || ray(BISHOP_DIRS, ["b", "q"]);
}

function kingSquare(board: (Piece | null)[], c: Color): number {
  return board.findIndex((p) => p?.c === c && p.t === "k");
}

export function inCheck(pos: Position, c: Color = pos.turn): boolean {
  const k = kingSquare(pos.board, c);
  return k >= 0 && isAttacked(pos.board, k, other(c));
}

/** Pseudo-legal moves (own king may be left in check; filtered by legalMoves). */
function pseudoMoves(pos: Position): Move[] {
  const out: Move[] = [];
  const { board, turn } = pos;
  const push = (from: number, to: number, promoRow = false) => {
    if (promoRow) for (const promo of ["q", "r", "b", "n"] as Promotion[]) out.push({ from, to, promo });
    else out.push({ from, to });
  };
  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || p.c !== turn) continue;
    const f = file(from), r = row(from);
    if (p.t === "p") {
      const dir = turn === "w" ? -1 : 1;
      const start = turn === "w" ? 6 : 1;
      const last = turn === "w" ? 0 : 7;
      if (inside(f, r + dir) && !board[square(f, r + dir)]) {
        push(from, square(f, r + dir), r + dir === last);
        if (r === start && !board[square(f, r + 2 * dir)]) push(from, square(f, r + 2 * dir));
      }
      for (const df of [-1, 1]) {
        if (!inside(f + df, r + dir)) continue;
        const to = square(f + df, r + dir);
        const target = board[to];
        if ((target && target.c !== turn) || to === pos.ep) push(from, to, r + dir === last);
      }
    } else if (p.t === "n" || p.t === "k") {
      for (const [df, dr] of p.t === "n" ? KNIGHT : KING) {
        if (!inside(f + df, r + dr)) continue;
        const to = square(f + df, r + dr);
        const target = board[to];
        if (!target || target.c !== turn) push(from, to);
      }
      if (p.t === "k") {
        const home = turn === "w" ? 60 : 4;
        if (from === home && !isAttacked(board, home, other(turn))) {
          const rights = turn === "w" ? [pos.castling.K, pos.castling.Q] : [pos.castling.k, pos.castling.q];
          const rookAt = (sq: number) => board[sq]?.t === "r" && board[sq]?.c === turn;
          if (rights[0] && rookAt(home + 3) && !board[home + 1] && !board[home + 2]
            && !isAttacked(board, home + 1, other(turn)) && !isAttacked(board, home + 2, other(turn))) push(from, home + 2);
          if (rights[1] && rookAt(home - 4) && !board[home - 1] && !board[home - 2] && !board[home - 3]
            && !isAttacked(board, home - 1, other(turn)) && !isAttacked(board, home - 2, other(turn))) push(from, home - 2);
        }
      }
    } else {
      const dirs = p.t === "r" ? ROOK_DIRS : p.t === "b" ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [df, dr] of dirs) {
        for (let k = 1; ; k++) {
          const ff = f + df * k, rr = r + dr * k;
          if (!inside(ff, rr)) break;
          const to = square(ff, rr);
          const target = board[to];
          if (!target) { push(from, to); continue; }
          if (target.c !== turn) push(from, to);
          break;
        }
      }
    }
  }
  return out;
}

/** Plays a move that is known to be (pseudo-)legal; returns the new position. */
export function applyMove(pos: Position, mv: Move): Position {
  const board = pos.board.slice();
  const piece = board[mv.from]!;
  const captured = board[mv.to];
  const castling = { ...pos.castling };
  let ep = -1;
  board[mv.from] = null;
  board[mv.to] = mv.promo ? { c: piece.c, t: mv.promo } : piece;
  if (piece.t === "p") {
    if (mv.to === pos.ep && !captured) board[mv.to + (piece.c === "w" ? 8 : -8)] = null; // en passant
    if (Math.abs(mv.to - mv.from) === 16) ep = (mv.from + mv.to) / 2;
  }
  if (piece.t === "k") {
    if (mv.to - mv.from === 2) { board[mv.to - 1] = board[mv.to + 1]; board[mv.to + 1] = null; }
    if (mv.from - mv.to === 2) { board[mv.to + 1] = board[mv.to - 2]; board[mv.to - 2] = null; }
    if (piece.c === "w") { castling.K = false; castling.Q = false; } else { castling.k = false; castling.q = false; }
  }
  // Any move from or onto a rook's corner costs that side's right.
  for (const sq of [mv.from, mv.to]) {
    if (sq === 63) castling.K = false;
    if (sq === 56) castling.Q = false;
    if (sq === 7) castling.k = false;
    if (sq === 0) castling.q = false;
  }
  return {
    board,
    turn: other(pos.turn),
    castling,
    ep,
    half: piece.t === "p" || captured ? 0 : pos.half + 1,
    full: pos.full + (pos.turn === "b" ? 1 : 0),
  };
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((mv) => !inCheck(applyMove(pos, mv), pos.turn));
}

export function legalMovesFrom(pos: Position, from: number): Move[] {
  return legalMoves(pos).filter((mv) => mv.from === from);
}

/** Whether moving `from` -> `to` is a pawn reaching the last row (the player must choose a piece). */
export function needsPromotion(pos: Position, from: number, to: number): boolean {
  const p = pos.board[from];
  return !!p && p.t === "p" && (row(to) === 0 || row(to) === 7);
}

function insufficientMaterial(board: (Piece | null)[]): boolean {
  const rest = board.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.t !== "k") as { p: Piece; i: number }[];
  if (rest.length === 0) return true;
  if (rest.some((x) => x.p.t === "p" || x.p.t === "r" || x.p.t === "q")) return false;
  if (rest.length === 1) return true; // a lone knight or bishop
  // Only bishops, all on the same colour of square.
  if (rest.every((x) => x.p.t === "b")) return new Set(rest.map((x) => (file(x.i) + row(x.i)) & 1)).size === 1;
  return false;
}

export function gameStatus(pos: Position): GameStatus {
  if (legalMoves(pos).length === 0) return inCheck(pos) ? "checkmate" : "stalemate";
  if (insufficientMaterial(pos.board)) return "insufficient";
  if (pos.half >= 100) return "fifty";
  return "playing";
}

const LETTER: Record<PieceType, string> = { p: "", n: "N", b: "B", r: "R", q: "Q", k: "K" };

/** Standard algebraic notation for `mv` played from `pos` (with + / # suffix). */
export function toSan(pos: Position, mv: Move): string {
  const p = pos.board[mv.from]!;
  let s: string;
  if (p.t === "k" && Math.abs(mv.to - mv.from) === 2) s = mv.to > mv.from ? "O-O" : "O-O-O";
  else {
    const capture = !!pos.board[mv.to] || (p.t === "p" && mv.to === pos.ep);
    s = LETTER[p.t];
    if (p.t === "p") {
      if (capture) s += "abcdefgh"[file(mv.from)];
    } else {
      const rivals = legalMoves(pos).filter((m) => m.to === mv.to && m.from !== mv.from && pos.board[m.from]?.t === p.t);
      if (rivals.length) {
        const sameFile = rivals.some((m) => file(m.from) === file(mv.from));
        const sameRow = rivals.some((m) => row(m.from) === row(mv.from));
        if (!sameFile) s += "abcdefgh"[file(mv.from)];
        else if (!sameRow) s += 8 - row(mv.from);
        else s += squareName(mv.from);
      }
    }
    s += (capture ? "x" : "") + squareName(mv.to) + (mv.promo ? "=" + mv.promo.toUpperCase() : "");
  }
  const after = applyMove(pos, mv);
  const st = gameStatus(after);
  return s + (st === "checkmate" ? "#" : inCheck(after) ? "+" : "");
}

/** Repetition key: what makes two positions "the same" (placement, side to move, rights, en passant). */
function positionKey(pos: Position): string {
  return toFen(pos).split(" ").slice(0, 4).join(" ");
}

/** One game in progress: the position, its history, and how it ended (if it has). */
export class ChessGame {
  pos: Position = initialPosition();
  /** SAN of every move played. */
  moves: string[] = [];
  last: [number, number] | null = null;
  result: ChessResult | null = null;
  private seen = new Map<string, number>([[positionKey(this.pos), 1]]);

  /** Plays from -> to (promo defaults to a queen); false if the move isn't legal now. */
  play(from: number, to: number, promo?: Promotion): boolean {
    if (this.result) return false;
    const wanted = needsPromotion(this.pos, from, to) ? promo ?? "q" : undefined;
    const mv = legalMoves(this.pos).find((m) => m.from === from && m.to === to && m.promo === wanted);
    if (!mv) return false;
    this.moves.push(toSan(this.pos, mv));
    this.pos = applyMove(this.pos, mv);
    this.last = [mv.from, mv.to];
    const key = positionKey(this.pos);
    const times = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, times);
    const status = gameStatus(this.pos);
    if (status === "checkmate") this.result = { winner: other(this.pos.turn), reason: "checkmate" };
    else if (status === "stalemate") this.result = { winner: null, reason: "stalemate" };
    else if (status === "insufficient") this.result = { winner: null, reason: "insufficient" };
    else if (status === "fifty") this.result = { winner: null, reason: "fifty" };
    else if (times >= 3) this.result = { winner: null, reason: "repetition" };
    return true;
  }

  /** `loser` gave up or left: the other side wins. */
  end(loser: Color, reason: "resign" | "abandon") {
    if (!this.result) this.result = { winner: other(loser), reason };
  }

  get over(): boolean {
    return this.result !== null;
  }
}

/** What the server tells everyone in the lobby about the table (the `chess_state` message). */
export interface ChessNetState {
  rev: number;
  /** Player ids in each seat ("" = free) and their names. */
  white: string; black: string;
  whiteName: string; blackName: string;
  fen: string;
  moves: string[];
  last: [number, number] | null;
  status: "waiting" | "playing" | "over";
  result: ChessResult | null;
}

export const EMPTY_CHESS: ChessNetState = {
  rev: -1, white: "", black: "", whiteName: "", blackName: "",
  fen: START, moves: [], last: null, status: "waiting", result: null,
};
