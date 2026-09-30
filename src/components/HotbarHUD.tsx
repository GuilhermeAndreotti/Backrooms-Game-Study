/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { t, useLanguage, type MessageKey } from "../i18n";
import { HOTBAR_ORDER, USABLE_ITEMS } from "../shared/items";
import type { ActiveBuff, GameEngine } from "../game/GameEngine";
import { ItemIcon } from "./itemVisuals";

/** One-shot slot animation requested by App ("used" pulse or "blocked" shake). */
export interface HotbarFx {
  item: string;
  kind: "used" | "blocked";
  /** Bumped per request so the same item/kind twice in a row still replays. */
  key: number;
}

interface HotbarHUDProps {
  inventory: string[];
  engineRef: React.MutableRefObject<GameEngine | null>;
  /** "Give" mode (G): the teammate the next number key hands an item to. */
  giveTarget: { name: string } | null;
  fx: HotbarFx | null;
}

/** How long a slot glows after its count goes up (pickup or hand-off). */
const PICKUP_FLASH_MS = 1200;
const FX_MS = 450;

/**
 * Always-visible quick-use bar: five fixed slots (keys 1–5), so the same key
 * always means the same item and the player never leaves the game to drink
 * almond water mid-chase. Timed effects (adrenaline, radar) count down above it.
 */
const HotbarHUDComponent: React.FC<HotbarHUDProps> = ({ inventory, engineRef, giveTarget, fx }) => {
  useLanguage();

  const counts: Record<string, number> = {};
  for (const id of inventory) counts[id] = (counts[id] ?? 0) + 1;

  // Flash a slot whenever its count goes up.
  const prevCounts = useRef<Record<string, number>>(counts);
  const [flashing, setFlashing] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = Date.now();
    const gained: Record<string, number> = {};
    for (const id of HOTBAR_ORDER) {
      if ((counts[id] ?? 0) > (prevCounts.current[id] ?? 0)) gained[id] = now;
    }
    prevCounts.current = counts;
    if (Object.keys(gained).length === 0) return;
    setFlashing((prev) => ({ ...prev, ...gained }));
    const timer = setTimeout(() => {
      setFlashing((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(gained)) if (next[id] === gained[id]) delete next[id];
        return next;
      });
    }, PICKUP_FLASH_MS);
    return () => clearTimeout(timer);
  }, [inventory]);

  // Replays the used/blocked animation for FX_MS.
  const [activeFx, setActiveFx] = useState<HotbarFx | null>(null);
  useEffect(() => {
    if (!fx) return;
    setActiveFx(fx);
    const timer = setTimeout(() => setActiveFx((cur) => (cur?.key === fx.key ? null : cur)), FX_MS);
    return () => clearTimeout(timer);
  }, [fx]);

  // Buff timers: polled from the engine at 10 Hz rather than pushed through
  // React state every frame.
  const [buffs, setBuffs] = useState<ActiveBuff[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const next = engineRef.current?.activeBuffs() ?? [];
      setBuffs((prev) => {
        if (prev.length === next.length && prev.every((b, i) => b.id === next[i].id && Math.abs(b.remaining - next[i].remaining) < 0.05)) {
          return prev;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [engineRef]);

  const giving = giveTarget !== null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none font-mono flex flex-col items-center gap-1.5">
      {/* Running effects */}
      {buffs.length > 0 && (
        <div className="flex gap-1.5">
          {buffs.map((b) => {
            const timed = b.total > 0;
            const frac = timed ? b.remaining / b.total : 1;
            const ending = timed && b.remaining < 3;
            return (
              <div
                key={b.id}
                className={`relative overflow-hidden flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-black/75 ${
                  b.id === "strange_crystal"
                    ? "border-cyan-500/50 text-cyan-200"
                    : b.id === "liquid_pain"
                      ? "border-red-500/60 text-red-200"
                      : "border-[#deb81d]/60 text-[#ffe08a]"
                } ${ending ? "animate-pulse" : ""}`}
              >
                {timed && (
                  <div
                    className={`absolute inset-y-0 left-0 ${b.id === "liquid_pain" ? "bg-red-600/30" : "bg-[#deb81d]/25"}`}
                    style={{ width: `${frac * 100}%` }}
                  />
                )}
                <ItemIcon id={b.id} className="w-3 h-3 relative" />
                <span className="relative">{t(`buff.${b.id}` as MessageKey)}</span>
                {timed && <span className="relative tabular-nums opacity-80">{Math.ceil(b.remaining)}s</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Give mode banner */}
      {giving && (
        <div className="rounded border border-sky-400/70 bg-sky-950/80 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-sky-100 shadow-[0_0_14px_rgba(56,189,248,0.35)] animate-pulse">
          {t("hotbar.giveTo", { name: giveTarget.name.toUpperCase() })}
          <span className="ml-2 text-sky-300/70">{t("hotbar.giveCancel")}</span>
        </div>
      )}

      {/* Slots */}
      <div
        className={`flex gap-1.5 rounded-md border px-1.5 py-1.5 bg-[#0b0a05]/75 transition-colors ${
          giving ? "border-sky-400/60" : "border-[#a28e3b]/25"
        }`}
      >
        {HOTBAR_ORDER.map((id, i) => {
          const count = counts[id] ?? 0;
          const has = count > 0;
          const passive = !USABLE_ITEMS.has(id);
          const fxHere = activeFx?.item === id ? activeFx.kind : null;
          const flash = flashing[id] !== undefined;
          return (
            <div
              key={id}
              title={t(`item.${id}.name` as MessageKey)}
              className={`relative w-14 h-14 rounded flex flex-col items-center justify-center border transition-all duration-150 ${
                !has
                  ? "border-dashed border-[#a28e3b]/20 bg-black/30 opacity-45"
                  : giving
                    ? "border-sky-400/70 bg-sky-500/10"
                    : passive
                      ? "border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                      : "border-[#deb81d]/50 bg-[#deb81d]/5"
              } ${flash ? "ring-2 ring-[#ffe08a] shadow-[0_0_18px_rgba(255,224,138,0.6)] scale-110" : ""} ${
                fxHere === "used" ? "scale-90 bg-[#deb81d]/30" : ""
              } ${fxHere === "blocked" ? "hotbar-shake border-red-500 bg-red-900/40" : ""}`}
            >
              <span className={`absolute top-0.5 left-1 text-[9px] font-black ${has ? "text-[#deb81d]" : "text-[#a28e3b]/60"}`}>{i + 1}</span>
              {count > 1 && (
                <span className="absolute top-0.5 right-1 text-[9px] font-black text-black bg-[#deb81d] rounded-full px-1 leading-tight">
                  x{count}
                </span>
              )}
              <ItemIcon id={id} className={`w-5 h-5 ${has ? "" : "grayscale opacity-60"}`} />
              <span className={`mt-0.5 text-[8px] font-bold uppercase tracking-wider ${has ? "text-[#d1bd66]" : "text-[#a28e3b]/50"}`}>
                {passive && has ? t("hotbar.passive") : t(`hotbar.short.${id}` as MessageKey)}
              </span>
            </div>
          );
        })}
      </div>
      {inventory.length > 0 && !giving && (
        <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#a28e3b]/60">{t("hotbar.hint")}</div>
      )}
    </div>
  );
};

export const HotbarHUD = React.memo(HotbarHUDComponent);
