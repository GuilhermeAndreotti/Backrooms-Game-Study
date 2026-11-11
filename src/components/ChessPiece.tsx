import { useId } from "react";
import type { Color, PieceType } from "../shared/chess";

const silhouettes: Record<PieceType, string> = {
  p: "M22 29 C13 22 17 9 26 9 C35 9 39 22 30 29 L33 34 L30 38 L34 48 H18 L22 38 L19 34 Z",
  r: "M15 11 H21 V17 H24 V11 H28 V17 H31 V11 H37 V25 L33 29 L34 47 H18 L19 29 L15 25 Z",
  n: "M17 47 L19 36 L31 27 L25 25 L19 30 L12 25 L18 14 L26 11 L26 6 L33 12 C43 24 38 37 37 47 Z M20 20 L23 19",
  b: "M26 7 C24 14 13 19 18 28 L23 33 L20 39 L17 47 H35 L32 39 L29 33 C40 24 33 14 26 7 Z M27 17 L22 26",
  q: "M14 18 L20 24 L26 12 L32 24 L38 18 L34 33 H18 Z M20 36 H32 L31 40 L35 48 H17 L21 40 Z",
  k: "M24 6 H28 V11 H33 V15 H28 V21 H24 V15 H19 V11 H24 Z M26 25 C10 12 10 31 19 34 H33 C42 31 42 12 26 25 Z M20 37 H32 L30 41 L35 48 H17 L22 41 Z",
};

/** Vector silhouettes stay crisp at every board size and never depend on OS chess fonts. */
export function ChessPiece({ color, type }: { color: Color; type: PieceType }) {
  const id = useId();
  const white = color === "w";
  return <svg viewBox="0 0 52 60" width="100%" height="100%" aria-hidden="true" style={{ filter: "drop-shadow(0 3px 2px #0007)" }}>
    <defs><linearGradient id={id} x1="0" x2="1" y2="0.7">
      <stop stopColor={white ? "#ffffff" : "#8991ad"} /><stop offset=".38" stopColor={white ? "#f4e9cf" : "#394157"} /><stop offset="1" stopColor={white ? "#b9a787" : "#121827"} />
    </linearGradient></defs>
    <g fill={`url(#${id})`} stroke={white ? "#685a48" : "#b3b9d0"} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
      <path d={silhouettes[type]} /><path d="M17 48 H35 L39 53 V56 H13 V53 Z" />
      {type === "q" && <><circle cx="13" cy="16" r="2.5" /><circle cx="26" cy="10" r="2.5" /><circle cx="39" cy="16" r="2.5" /></>}
    </g>
  </svg>;
}
