import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChessPiece } from "./ChessPiece";
import type { CardId } from "../shared/powerChess";
import { row, square, squareName, type Color, type PieceType, type Position, type Promotion } from "../shared/chess";
import { t } from "../i18n";

/** Filled glyphs for both colours (tinted by CSS), with the text-style selector so none turns into an emoji. */
export const GLYPH: Record<PieceType, string> = { k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎" };
const PROMOTIONS: Promotion[] = ["q", "r", "b", "n"];

export const pieceStyle = (c: Color) => (c === "w"
  ? { color: "#fffaf0", textShadow: "0 0 2px #000, 0 0 2px #000, 0 0 3px #000, 1px 1px 0 #000" }
  : { color: "#17110d", textShadow: "0 0 1px rgba(255,255,255,0.35)" });

export interface ChessBoardGridProps {
  key?: number;
  animationKind?: CardId;
  pieceIds?: number[];
  onMove?: (from: number, to: number) => void;
  canDrag?: (sq: number) => boolean;
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
  pieceIds, onMove, canDrag, animationKind,
}: ChessBoardGridProps) {
  const reduced = useReducedMotion();
  const board = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ sq: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ sq: number; x: number; y: number } | null>(null);
  const previousSquares = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    previousSquares.current = new Map(pieceIds?.map((id, sq) => [id, sq]) ?? []);
  }, [pieceIds]);
  useEffect(() => { gesture.current = null; setDrag(null); }, [pos, flipped, clickable]);
  // Squares from the viewer's side: white at the bottom, unless they sit with black.
  const squares: number[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) squares.push(flipped ? square(7 - f, 7 - r) : square(f, r));
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(58vh,560px)] shrink-0 select-none">
      <div ref={board} className="relative isolate grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-md border-4 shadow-[0_12px_40px_#0008,0_0_0_1px_#ffffff30]" style={{ borderColor: frame }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) g.moved = true;
          if (g.moved) setDrag({ sq: g.sq, x: e.clientX - g.x, y: e.clientY - g.y });
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          gesture.current = null; setDrag(null);
          if (!g?.moved) return;
          suppressClick.current = true;
          const rect = board.current!.getBoundingClientRect();
          const x = Math.floor((e.clientX - rect.left - 4) / (rect.width - 8) * 8);
          const y = Math.floor((e.clientY - rect.top - 4) / (rect.height - 8) * 8);
          if (x >= 0 && x < 8 && y >= 0 && y < 8) onMove?.(g.sq, flipped ? square(7-x, 7-y) : square(x,y));
        }}
        onPointerCancel={() => { gesture.current = null; setDrag(null); }}>
        {squares.map((sq) => {
          const piece = pos.board[sq];
          const light = ((sq & 7) + row(sq)) % 2 === 0;
          const isTarget = targets.has(sq);
          return (
            <button
              key={sq}
              onPointerDown={(e) => {
                suppressClick.current = false;
                if (e.button !== 0 || !clickable || promoting || !onMove || !canDrag?.(sq)) return;
                gesture.current = { sq, x: e.clientX, y: e.clientY, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
                if (selected !== sq) { onSquare(sq); suppressClick.current = true; }
              }}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSquare(sq); }}
              aria-label={squareName(sq)}
              className={`relative flex items-center justify-center text-[clamp(1.6rem,6.2vmin,3.6rem)] leading-none ${clickable ? "cursor-pointer" : "cursor-default"}`}
              style={{ background: `linear-gradient(135deg, #ffffff12, #00000015), ${light ? colors[0] : colors[1]}`, touchAction: onMove ? "none" : undefined }}
            >
              {last?.includes(sq) && <span className="absolute inset-0 bg-[#ffd95a]/40" />}
              {sq === selected && <span className="absolute inset-0 bg-[#6cf]/45" />}
              {sq === checked && <span className="absolute inset-0 bg-red-600/60" />}
              {under?.(sq)}
              {!pieceIds?.length && piece && <span className="relative h-[90%] w-[90%]" style={pieceExtra?.(sq)}><ChessPiece color={piece.c} type={piece.t} /></span>}
              {squares.indexOf(sq) % 8 === 0 && <span className="absolute left-1 top-1 text-[10px] font-bold opacity-70" style={{ color: light ? colors[1] : colors[0] }}>{8-row(sq)}</span>}
              {squares.indexOf(sq) >= 56 && <span className="absolute bottom-1 right-1 text-[10px] font-bold opacity-70" style={{ color: light ? colors[1] : colors[0] }}>{squareName(sq)[0]}</span>}
              {isTarget && (piece
                ? <span className="absolute inset-1 rounded-full border-4 border-[#3a7a2a]/80" />
                : <span className="absolute h-[28%] w-[28%] rounded-full bg-[#3a7a2a]/70" />)}
              {over?.(sq)}
            </button>
          );
        })}
        <AnimatePresence>
          {!!pieceIds?.length && squares.map((sq, index) => {
            const p = pos.board[sq];
            if (!p) return null;
            const dragging = drag?.sq === sq && clickable;
            const moved = previousSquares.current.has(pieceIds[sq]) && previousSquares.current.get(pieceIds[sq]) !== sq;
            const teleport = moved && (animationKind === "door" || animationKind === "exit");
            const arc = moved && animationKind === "mirror";
            return <motion.div key={pieceIds[sq]} initial={{ opacity: 0, scale: .5 }}
              animate={{ left: `${index % 8 * 12.5}%`, top: `${Math.floor(index / 8) * 12.5}%`, x: dragging ? drag.x : arc && !reduced ? [0, index % 2 ? 24 : -24, 0] : 0, y: dragging ? drag.y : 0, scale: dragging ? 1.15 : teleport && !reduced ? [1, .05, 1] : 1, opacity: teleport && !reduced ? [1, 0, 1] : 1 }}
              exit={{ scale: .3, opacity: 0, rotate: 15 }} transition={{ duration: reduced || dragging ? 0 : teleport || arc ? .55 : .26, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-none absolute flex h-[12.5%] w-[12.5%] items-center justify-center" style={{ zIndex: dragging ? 30 : 10 }}>
              <span className="h-[90%] w-[90%]" style={pieceExtra?.(sq)}><ChessPiece color={p.c} type={p.t} /></span>
            </motion.div>;
          })}
        </AnimatePresence>
      </div>
      {promoting && (
        <div role="dialog" aria-label={t("chess.promote")} className="absolute inset-0 z-40 flex items-center justify-center rounded-lg bg-black/75 backdrop-blur-sm">
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
                  <ChessPiece color={promoting} type={p} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
