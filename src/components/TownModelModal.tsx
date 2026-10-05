import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MODEL_PIECE_DATA, type ModelPiece } from "../game/levels/townLayout";
import { drawTownPlan, planRect } from "../game/levels/townPlan";
import { PIECE_NAME } from "../game/levels/townDirector";
import { t } from "../i18n";

interface TownModelModalProps {
  /** Which buildings are already on the model (teammates assemble it too). Polled. */
  getPlaced: () => boolean[];
  /** Whether the model is complete (here or on a teammate's panel). Polled. */
  isSolved: () => boolean;
  /** A building dropped on a plot: whether it belongs there. */
  onPlace: (piece: number, plot: number) => boolean;
  onClose: () => void;
}

const W = 640;
const MAP_H = 320;
const TRAY = 120;
const H = MAP_H + TRAY;
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** A building's little icon, centred on (x, y), `s` pixels across. */
function PieceIcon({ piece, x, y, s }: { piece: ModelPiece; x: number; y: number; s: number }) {
  if (piece.id === "tower") {
    return (
      <g>
        <rect x={x - s * 0.14} y={y - s * 0.45} width={s * 0.28} height={s * 0.8} fill={hex(piece.wall)} stroke="#1a1a1a" strokeWidth={2} />
        <polygon points={`${x - s * 0.24},${y - s * 0.45} ${x},${y - s * 0.75} ${x + s * 0.24},${y - s * 0.45}`} fill={hex(piece.roof)} stroke="#1a1a1a" strokeWidth={2} />
        <circle cx={x} cy={y - s * 0.28} r={s * 0.08} fill="#f6efd8" stroke="#1a1a1a" strokeWidth={1.5} />
      </g>
    );
  }
  const chapel = piece.id === "chapel";
  return (
    <g>
      <rect x={x - s * 0.36} y={y - s * 0.12} width={s * 0.72} height={s * 0.46} fill={hex(piece.wall)} stroke="#1a1a1a" strokeWidth={2} />
      <polygon points={`${x - s * 0.44},${y - s * 0.12} ${x},${y - s * (chapel ? 0.62 : 0.46)} ${x + s * 0.44},${y - s * 0.12}`} fill={hex(piece.roof)} stroke="#1a1a1a" strokeWidth={2} />
      {chapel && <rect x={x + s * 0.12} y={y - s * 0.7} width={s * 0.1} height={s * 0.3} fill={hex(piece.wall)} stroke="#1a1a1a" strokeWidth={1.5} />}
      <rect x={x - s * 0.06} y={y + s * 0.1} width={s * 0.12} height={s * 0.24} fill={hex(piece.roof)} />
      <rect x={x - s * 0.27} y={y - s * 0.02} width={s * 0.12} height={s * 0.1} fill="#3a5068" />
      <rect x={x + s * 0.15} y={y - s * 0.02} width={s * 0.12} height={s * 0.1} fill="#3a5068" />
    </g>
  );
}

/** Level 94's model of the town: put the five missing buildings back where they stand. */
export function TownModelModal({ getPlaced, isSolved, onPlace, onClose }: TownModelModalProps) {
  const [placed, setPlaced] = useState<boolean[]>(() => getPlaced());
  const [held, setHeld] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [wrong, setWrong] = useState<number | null>(null);
  const [done, setDone] = useState(() => isSolved());
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current?.getContext("2d");
    if (c) drawTownPlan(c, W, MAP_H, { missing: true, houses: true });
  }, []);

  // Teammates may be putting buildings back (or finish the model) while this is open.
  useEffect(() => {
    const id = setInterval(() => {
      setPlaced(getPlaced());
      if (!done && isSolved()) {
        setDone(true);
        setTimeout(onClose, 1400);
      }
    }, 250);
    return () => clearInterval(id);
  }, [done, getPlaced, isSolved, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key.toLowerCase() === "e") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toSvg = (event: ReactPointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  };

  const drop = (plot: number) => {
    if (held === null || done || placed[plot]) return;
    const ok = onPlace(held, plot);
    if (!ok) {
      setWrong(plot);
      setTimeout(() => setWrong(null), 500);
      setHeld(null);
      return;
    }
    const next = [...placed];
    next[held] = true;
    setPlaced(next);
    setHeld(null);
    if (next.every(Boolean)) {
      setDone(true);
      setTimeout(onClose, 1600);
    }
  };

  const tray = MODEL_PIECE_DATA.map((piece, i) => ({ piece, i })).filter(({ i }) => !placed[i]);
  const slotX = (k: number) => (W / (tray.length + 1)) * (k + 1);
  const count = placed.filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono">
      <div className={`w-full max-w-3xl border-2 ${done ? "border-green-600" : "border-[#c9962a]"} bg-[#140c08]/95 shadow-[0_0_40px_rgba(201,150,42,0.18)]`}>
        <div className={`px-4 py-2 text-sm font-bold tracking-[0.25em] ${done ? "bg-green-600 text-[#021407]" : "bg-[#c9962a] text-[#1a0f05]"}`}>
          {t("town.model.title")}
        </div>
        <p className="px-4 pt-3 text-xs leading-relaxed text-stone-300">{t("town.model.hint")}</p>
        <div className="relative mx-auto mt-2 w-full max-w-[640px] select-none">
          <canvas ref={canvasRef} width={W} height={MAP_H} className="absolute left-0 top-0 w-full" style={{ aspectRatio: `${W} / ${MAP_H}` }} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="relative block w-full touch-none"
            onPointerMove={(e) => setPointer(toSvg(e))}
            onPointerLeave={() => setPointer(null)}
          >
            {/* The plots: drop targets, then the buildings already back on them. */}
            {MODEL_PIECE_DATA.map((piece, i) => {
              const r = planRect(piece, W, MAP_H);
              const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
              return (
                <g key={`plot${i}`} className={!placed[i] && held !== null ? "cursor-pointer" : ""} onPointerUp={() => drop(i)}>
                  <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} fill="transparent" />
                  {placed[i] ? (
                    <PieceIcon piece={piece} x={cx} y={cy + 4} s={Math.max(30, Math.min(r.w, r.h) * 1.4)} />
                  ) : (
                    <rect
                      x={r.x} y={r.y} width={r.w} height={r.h}
                      fill={wrong === i ? "rgba(220,40,40,0.55)" : held !== null ? "rgba(244,239,226,0.18)" : "transparent"}
                      stroke={wrong === i ? "#ff4a3a" : "#f4efe2"} strokeWidth={held !== null ? 3 : 1.5} strokeDasharray="6 4"
                    />
                  )}
                </g>
              );
            })}
            {/* The tray. */}
            <rect x={0} y={MAP_H} width={W} height={TRAY} fill="#24160c" />
            <line x1={0} y1={MAP_H} x2={W} y2={MAP_H} stroke="#c9962a" strokeWidth={2} />
            {tray.map(({ piece, i }, k) => (
              <g key={`tray${i}`} className={!done ? "cursor-grab" : ""} opacity={held === i ? 0.35 : 1} onPointerDown={() => { if (!done) setHeld(i); }}>
                <rect x={slotX(k) - 46} y={MAP_H + 10} width={92} height={TRAY - 20} rx={6} fill={held === i ? "#3a2614" : "#1a100a"} stroke="#5a3a20" />
                <PieceIcon piece={piece} x={slotX(k)} y={MAP_H + 52} s={54} />
                <text x={slotX(k)} y={MAP_H + TRAY - 18} textAnchor="middle" fontSize={11} fill="#e9d8a8">{t(PIECE_NAME[piece.id])}</text>
              </g>
            ))}
            {/* The building in hand follows the pointer. */}
            {held !== null && pointer && (
              <g pointerEvents="none" opacity={0.9}>
                <PieceIcon piece={MODEL_PIECE_DATA[held]} x={pointer.x} y={pointer.y} s={44} />
              </g>
            )}
          </svg>
        </div>
        <div className="flex items-center justify-between px-4 pb-3 pt-2 text-xs">
          <span className={done ? "font-bold text-green-400" : wrong !== null ? "font-bold text-red-400" : "text-stone-400"}>
            {done ? t("town.model.done") : wrong !== null ? t("town.model.wrong") : `${count}/${MODEL_PIECE_DATA.length}`}
          </span>
          <button onClick={onClose} className="text-stone-400 hover:text-white">{t("town.model.close")}</button>
        </div>
      </div>
    </div>
  );
}
