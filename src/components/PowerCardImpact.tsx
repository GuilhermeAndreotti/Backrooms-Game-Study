import { motion, useReducedMotion } from "motion/react";
import type { CardId } from "../shared/powerChess";

/** Short, non-blocking effects mounted once for each server-confirmed card target. */
export function PowerCardImpact({ card }: { key?: string; card: CardId }) {
  const reduced = useReducedMotion();
  const ice = card === "flicker" || card === "blackout";
  const portal = card === "door" || card === "exit" || card === "mirror";
  const gold = card === "tape" || card === "ascend" || card === "memory";
  const color = ice ? "#a5f3fc" : gold ? "#fde68a" : card === "smiler" ? "#fb7185" : "#d8b4fe";
  return <span className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden="true">
    <motion.span className="absolute inset-[8%] rounded-full border-2"
      style={{ borderColor: color, boxShadow: `0 0 18px ${color}, inset 0 0 12px ${color}55` }}
      initial={{ scale: .2, opacity: 0 }}
      animate={{ scale: card === "smiler" ? [1.2, .1, 0] : [.2, 1.15, 1.4], opacity: [0, .9, 0], rotateX: portal ? 50 : 0, rotate: portal ? 180 : 0 }}
      transition={{ duration: reduced ? .1 : 1.1 }} />
    {!reduced && Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4;
      return <motion.span key={i} className="absolute left-1/2 top-1/2"
        style={{ width: card === "gust" ? 22 : ice ? 7 : 4, height: ice ? 14 : 3, background: color, borderRadius: ice ? 0 : 8, clipPath: ice ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" : undefined, boxShadow: `0 0 8px ${color}` }}
        initial={{ x: card === "gust" ? -35 : 0, y: card === "gust" ? (i - 4) * 6 : 0, opacity: 0, scale: .3 }}
        animate={{ x: card === "gust" ? 35 : Math.cos(angle) * 34, y: card === "gust" ? (i - 4) * 6 : Math.sin(angle) * 34, opacity: [0, 1, 0], scale: [0.3, 1, .2], rotate: ice ? i * 45 : 0 }}
        transition={{ duration: .8, delay: i * .035, ease: "easeOut" }} />;
    })}
  </span>;
}
