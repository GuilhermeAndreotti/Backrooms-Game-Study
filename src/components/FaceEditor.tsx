/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { Eraser, Trash2 } from "lucide-react";
import { EMPTY_FACE, FACE_PALETTE, FACE_SIZE } from "../utils/face";

interface FaceEditorProps {
  face: string;
  /** Suit colour, used as the helmet backdrop so transparent pixels read right. */
  suitColor: string;
  onChange: (face: string) => void;
}

/** 16x16 pixel-art pad for the explorer's helmet face. Click or drag to paint. */
export const FaceEditor: React.FC<FaceEditorProps> = ({ face: rawFace, suitColor, onChange }) => {
  // A stale/corrupt saved value would render the wrong number of cells.
  const face = rawFace?.length === FACE_SIZE * FACE_SIZE ? rawFace : EMPTY_FACE;
  const [colorIndex, setColorIndex] = useState(1);
  const painting = useRef(false);
  // Latest face for drag strokes: several pointer events can land before the
  // parent re-renders with the previous one.
  const faceRef = useRef(face);
  faceRef.current = face;

  useEffect(() => {
    const stop = () => { painting.current = false; };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const paint = (i: number) => {
    const current = faceRef.current;
    const digit = String(colorIndex);
    if (current[i] === digit) return;
    const next = current.slice(0, i) + digit + current.slice(i + 1);
    faceRef.current = next;
    onChange(next);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#F2E8CF]/50 uppercase tracking-wider">Rosto no capacete</span>
        <button
          type="button"
          onClick={() => onChange(EMPTY_FACE)}
          className="flex items-center gap-1 text-[10px] text-[#F2E8CF]/60 hover:text-white uppercase tracking-wider cursor-pointer"
        >
          <Trash2 className="w-3 h-3" /> Limpar
        </button>
      </div>

      <div
        className="mt-2 mx-auto grid w-full max-w-[256px] aspect-square rounded overflow-hidden border-2 border-white/10 touch-none select-none"
        style={{ gridTemplateColumns: `repeat(${FACE_SIZE}, 1fr)`, backgroundColor: suitColor }}
        onPointerLeave={() => { painting.current = false; }}
      >
        {Array.from(face).map((digit, i) => (
          <div
            key={i}
            onPointerDown={(e) => {
              e.preventDefault();
              // Touch pointers are implicitly captured by the first cell, which
              // would stop pointerenter firing on the others mid-stroke.
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
              painting.current = true;
              paint(i);
            }}
            onPointerEnter={() => { if (painting.current) paint(i); }}
            className="border-[0.5px] border-black/10 cursor-crosshair"
            style={{ backgroundColor: FACE_PALETTE[Number(digit)] ?? "transparent" }}
          />
        ))}
      </div>

      <div className="flex justify-center gap-2 mt-3">
        {FACE_PALETTE.map((color, i) => {
          const selected = colorIndex === i;
          return (
            <button
              key={i}
              type="button"
              aria-label={color ? `Pincel ${color}` : "Borracha"}
              onClick={() => setColorIndex(i)}
              className={`w-7 h-7 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                selected ? "border-[#deb81d] scale-110" : "border-white/10 hover:border-white/40"
              }`}
              style={{ backgroundColor: color ?? "transparent" }}
            >
              {!color && <Eraser className="w-3.5 h-3.5 text-[#F2E8CF]/70" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
