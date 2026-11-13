import { motion, useReducedMotion } from "motion/react";
import type { CardId } from "../shared/powerChess";

/** A bounded, deterministic burst: no random simulation or input-blocking layer. */
export function PowerCardSurge({ card }: { key?: string; card: CardId }) {
  const reduced = useReducedMotion();
  const color = card === "almond" || card === "flicker" || card === "blackout" ? "#67e8f9" : card === "smiler" || card === "adrenaline" ? "#fb7185" : "#c4b5fd";
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
    <motion.div className="absolute inset-0 rounded-xl" style={{ boxShadow: `inset 0 0 80px ${color}80`, background: `radial-gradient(ellipse at center, transparent 35%, ${color}30)` }} initial={{ opacity: 0 }} animate={{ opacity: [0, .85, 0] }} transition={{ duration: reduced ? .2 : 1.6 }} />
    {!reduced && <>
      {[0, 1, 2].map(i => <motion.div key={i} className="absolute left-1/2 top-1/2 h-56 w-56 rounded-full border" style={{ borderColor: color, boxShadow: `0 0 24px ${color}80, inset 0 0 24px ${color}40`, x: "-50%", y: "-50%" }} initial={{ scale: .05, opacity: 0, rotateX: 65 }} animate={{ scale: [0.05, 1.2, 3.5], opacity: [0, .9, 0], rotateX: [65, 30, 0], rotate: i % 2 ? -180 : 180 }} transition={{ duration: 1.5, delay: i * .14, ease: "easeOut" }} />)}
      <motion.div className="absolute inset-x-0 h-1" style={{ background: color, boxShadow: `0 0 28px 8px ${color}90` }} initial={{ top: "100%", opacity: 0 }} animate={{ top: "0%", opacity: [0, .8, 0] }} transition={{ duration: 1.1 }} />
      {Array.from({ length: 24 }, (_, i) => {
        const angle = i * Math.PI / 12;
        return <motion.span key={i} className="absolute left-1/2 top-1/2 h-1 w-7 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}`, rotate: i * 15 }} initial={{ x: 0, y: 0, opacity: 0, scale: .2 }} animate={{ x: Math.cos(angle) * 290, y: Math.sin(angle) * 290, opacity: [0, 1, 0], scale: [0.2, 1.4, .1] }} transition={{ duration: 1.2, delay: (i % 4) * .045, ease: "easeOut" }} />;
      })}
    </>}
  </div>;
}

/** Short, non-blocking effects mounted once for each server-confirmed card target. */
export function PowerCardImpact({ card }: { key?: string; card: CardId }) {
  const reduced = useReducedMotion();
  const ice = card === "flicker" || card === "blackout";
  const portal = card === "door" || card === "exit" || card === "mirror";
  const gold = card === "tape" || card === "ascend" || card === "memory";
  const color = ice ? "#a5f3fc" : gold ? "#fde68a" : card === "smiler" ? "#fb7185" : "#d8b4fe";
  return <span className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden="true">
    {!reduced && [0, 1, 2].map(i => <motion.span key={`orbit-${i}`} className="absolute inset-0 rounded-full border-2 border-dashed" style={{ borderColor: color, boxShadow: `0 0 12px ${color}88` }} initial={{ scale: .15, opacity: 0, rotate: i * 60 }} animate={{ scale: [.15, 1 + i * .25, 1.8], opacity: [0, .85, 0], rotate: (portal ? 360 : 120) * (i % 2 ? -1 : 1), rotateX: portal ? 55 : 0 }} transition={{ duration: 1.3, delay: i * .12 }} />)}
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
