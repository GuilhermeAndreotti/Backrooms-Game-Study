import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { WireColor } from "../game/levels/spaceLayout";
import { t } from "../i18n";

interface SpaceWiringModalProps {
  /** Cable ends (left) and sockets (right), top to bottom. */
  left: WireColor[];
  right: WireColor[];
  /** Whether the bus is already closed (a teammate may finish first). Polled. */
  isPowered: () => boolean;
  /** A cable went into a socket: right colour or not. */
  onPlug: (ok: boolean) => void;
  /** Every cable is in its socket. */
  onSolved: () => void;
  onClose: () => void;
}

const HEX: Record<WireColor, string> = {
  red: "#ff4a3a",
  blue: "#3d8bff",
  yellow: "#ffd23d",
  green: "#3ddc6a",
  white: "#e8eef5",
};

const W = 420;
const ROW = 58;
const TOP = 40;
const LX = 70;
const RX = W - 70;
const y = (i: number) => TOP + i * ROW;

/** Level 79's power bus: plug each loose cable into the socket of its own colour. */
export function SpaceWiringModal({ left, right, isPowered, onPlug, onSolved, onClose }: SpaceWiringModalProps) {
  const [links, setLinks] = useState<Record<number, number>>({});
  const [held, setHeld] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [spark, setSpark] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const H = TOP + (left.length - 1) * ROW + 40;

  // A teammate finished the panel while this one was open.
  useEffect(() => {
    const id = setInterval(() => {
      if (!done && isPowered()) {
        setDone(true);
        setTimeout(onClose, 900);
      }
    }, 250);
    return () => clearInterval(id);
  }, [done, isPowered, onClose]);

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

  const plug = (socket: number) => {
    if (held === null || done) return;
    const taken = Object.values(links).includes(socket);
    if (taken) return;
    const ok = left[held] === right[socket];
    onPlug(ok);
    if (!ok) {
      setSpark(socket);
      setTimeout(() => setSpark(null), 450);
      setHeld(null);
      return;
    }
    const next = { ...links, [held]: socket };
    setLinks(next);
    setHeld(null);
    if (Object.keys(next).length === left.length) {
      setDone(true);
      onSolved();
      setTimeout(onClose, 1400);
    }
  };

  const connected = Object.keys(links).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono">
      <div className={`w-full max-w-lg border-2 ${done ? "border-green-600" : "border-amber-600"} bg-[#0a0c0e]/95 shadow-[0_0_40px_rgba(245,158,11,0.15)]`}>
        <div className={`px-4 py-2 text-sm font-bold tracking-[0.25em] ${done ? "bg-green-600 text-[#021407]" : "bg-amber-600 text-[#171002]"}`}>
          POWER DISTRIBUTION · MAIN BUS
        </div>
        <p className="px-4 pt-3 text-xs leading-relaxed text-slate-300">{t("space.wire.hint")}</p>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto mt-2 block w-full max-w-md touch-none select-none"
          onPointerMove={(e) => setPointer(toSvg(e))}
          onPointerLeave={() => setPointer(null)}
          onPointerUp={() => { /* releasing over nothing keeps the cable in hand for a second click */ }}
        >
          <rect x={LX - 40} y={10} width={RX - LX + 80} height={H - 20} rx={6} fill="#14181c" stroke="#2c3238" />
          {/* Plugged cables */}
          {Object.entries(links).map(([l, r]) => (
            <path
              key={l}
              d={`M ${LX} ${y(+l)} C ${W / 2} ${y(+l)}, ${W / 2} ${y(r as number)}, ${RX} ${y(r as number)}`}
              stroke={HEX[left[+l]]}
              strokeWidth={7}
              fill="none"
              strokeLinecap="round"
            />
          ))}
          {/* The cable in hand follows the pointer */}
          {held !== null && pointer && (
            <path d={`M ${LX} ${y(held)} L ${pointer.x} ${pointer.y}`} stroke={HEX[left[held]]} strokeWidth={7} strokeLinecap="round" opacity={0.85} />
          )}
          {left.map((c, i) => (
            <g key={`l${i}`} className={links[i] === undefined && !done ? "cursor-pointer" : ""} onPointerDown={() => { if (links[i] === undefined && !done) setHeld(i); }}>
              <rect x={10} y={y(i) - 9} width={LX - 10} height={18} rx={3} fill={HEX[c]} />
              <circle cx={LX} cy={y(i)} r={held === i ? 13 : 10} fill={HEX[c]} stroke={held === i ? "#fff" : "#000"} strokeWidth={3} />
            </g>
          ))}
          {right.map((c, i) => {
            const used = Object.values(links).includes(i);
            return (
              <g key={`r${i}`} className={!used && !done ? "cursor-pointer" : ""} onPointerUp={() => plug(i)}>
                <rect x={RX} y={y(i) - 9} width={W - RX - 10} height={18} rx={3} fill={HEX[c]} />
                <circle cx={RX} cy={y(i)} r={14} fill="#050607" stroke={spark === i ? "#fff" : HEX[c]} strokeWidth={spark === i ? 6 : 4} />
                {spark === i && <text x={RX - 36} y={y(i) - 16} fill="#fff" fontSize={14} fontWeight="bold">✶</text>}
              </g>
            );
          })}
        </svg>
        <div className="flex items-center justify-between px-4 pb-3 pt-1 text-xs">
          <span className={done ? "font-bold text-green-400" : spark !== null ? "font-bold text-red-400" : "text-slate-400"}>
            {done ? t("space.wire.done") : spark !== null ? t("space.wire.short") : `${connected}/${left.length}`}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-white">{t("space.term.close")}</button>
        </div>
      </div>
    </div>
  );
}
