import type { CSSProperties, ReactNode } from "react";
import { row, square, squareName, type Color, type PieceType, type Position, type Promotion } from "../shared/chess";
import { t } from "../i18n";

/** Filled glyphs for both colours (tinted by CSS), with the text-style selector so none turns into an emoji. */
export const GLYPH: Record<PieceType, string> = { k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎" };
const PROMOTIONS: Promotion[] = ["q", "r", "b", "n"];

export const pieceStyle = (c: Color) => (c === "w"
  ? { color: "#fffaf0", textShadow: "0 0 2px #000, 0 0 2px #000, 0 0 3px #000, 1px 1px 0 #000" }
  : { color: "#17110d", textShadow: "0 0 1px rgba(255,255,255,0.35)" });

export interface ChessBoardGridProps {
  pos: Position;
  /** Black at the bottom. */
  flipped: boolean;
  /** Squares respond to clicks (and show a pointer). */
  clickable: boolean;
  onSquare: (sq: number) => void;
  selected: number | null;
  /** Where the selected piece may go. */
  targets: Set<number>;
  last: [number, number] | null;
  /** The checked king's square, or -1. */
  checked: number;
  /** Promotion picker over the board for this colour, or null. */
  promoting: Color | null;
  onPromote: (p: Promotion) => void;
  /** Light / dark square colours. */
  colors?: [string, string];
  frame?: string;
  /** Extra layers for a square, drawn under the piece (power-table effects). */
  under?: (sq: number) => ReactNode;
  /** Extra layers for a square, drawn over the piece. */
  over?: (sq: number) => ReactNode;
  /** Per-piece style tweaks (e.g. a ghost's transparency). */
  pieceExtra?: (sq: number) => CSSProperties | undefined;
}

/** An 8x8 board of buttons. Rules-free: what's clickable and highlighted comes from the caller. */
export function ChessBoardGrid({
  pos, flipped, clickable, onSquare, selected, targets, last, checked, promoting, onPromote,
  colors = ["#ecd9b0", "#a8744a"], frame = "#3e2a18", under, over, pieceExtra,
}: ChessBoardGridProps) {
  // Squares from the viewer's side: white at the bottom, unless they sit with black.
  const squares: number[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) squares.push(flipped ? square(7 - f, 7 - r) : square(f, r));
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(70vh,560px)] shrink-0 select-none">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8 border-4" style={{ borderColor: frame }}>
        {squares.map((sq) => {
          const piece = pos.board[sq];
          const light = ((sq & 7) + row(sq)) % 2 === 0;
          const isTarget = targets.has(sq);
          return (
            <button
              key={sq}
              onClick={() => onSquare(sq)}
              aria-label={squareName(sq)}
              className={`relative flex items-center justify-center text-[clamp(1.6rem,6.2vmin,3.6rem)] leading-none ${clickable ? "cursor-pointer" : "cursor-default"}`}
              style={{ background: light ? colors[0] : colors[1] }}
            >
              {last?.includes(sq) && <span className="absolute inset-0 bg-[#ffd95a]/40" />}
              {sq === selected && <span className="absolute inset-0 bg-[#6cf]/45" />}
              {sq === checked && <span className="absolute inset-0 bg-red-600/60" />}
              {under?.(sq)}
              {piece && <span className="relative" style={{ ...pieceStyle(piece.c), ...pieceExtra?.(sq) }}>{GLYPH[piece.t]}</span>}
              {isTarget && (piece
                ? <span className="absolute inset-1 rounded-full border-4 border-[#3a7a2a]/80" />
                : <span className="absolute h-[28%] w-[28%] rounded-full bg-[#3a7a2a]/70" />)}
              {over?.(sq)}
            </button>
          );
        })}
      </div>
      {promoting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/65">
          <div className="border-2 border-[#c9962a] bg-[#140c08] p-3">
            <div className="mb-2 text-center text-xs tracking-widest text-[#e9d8a8]">{t("chess.promote")}</div>
            <div className="flex gap-2">
              {PROMOTIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => onPromote(p)}
                  className="h-16 w-16 border border-stone-600 bg-[#ecd9b0] text-5xl hover:border-[#c9962a]"
                  style={promoting === "w" ? { color: "#fffaf0", textShadow: "0 0 2px #000, 0 0 2px #000, 1px 1px 0 #000" } : { color: "#17110d" }}
                >
                  {GLYPH[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
