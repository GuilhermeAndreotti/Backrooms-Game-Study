/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { t, useLanguage } from "../i18n";
import { ABANDONED_OFFICE_LEVEL, FUN_LEVEL, HOTEL_LEVEL, LEVEL_G, SPACE_LEVEL } from "../game/levels/constants";
import React, { useState, useEffect, useRef } from "react";
import { Flashlight, ShieldAlert, Backpack, Trophy, Mic, MicOff } from "lucide-react";
import { ChatMessage, RemotePlayer } from "../types/game";
import { RadarHUD } from "./RadarHUD";
import { GameEngine, LevelGProgress, MegProgress } from "../game/GameEngine";
import { ChatHUD } from "./ChatHUD";
import type { QuickChatId } from "../shared/items";

interface GameHUDProps {
  stamina: number; // 0 to 1
  sanity: number;  // 0 to 1
  isFlashlightOn: boolean;
  playerState: string;
  playerName: string;
  roomKey: string;
  connectedPlayers: RemotePlayer[];
  /** Live roster mutated at network rate; used by the radar, never rendered. */
  playersRef: React.MutableRefObject<RemotePlayer[]>;
  perf?: { fps: number; scale: number };
  showFps?: boolean;
  chatMessages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  onSendQuick: (id: QuickChatId) => void;
  localPlayerId: string | null;
  /** False while a panel (inventory, terminal...) owns the keyboard. */
  chatHotkeysEnabled: boolean;
  latency?: number; // Real round-trip ms to the relay (undefined until the first pong arrives)
  level?: number;
  engineRef: React.MutableRefObject<GameEngine | null>;
  currentSector?: string;
  hudNotification?: string;
  notificationKey?: number;
  onOpenInventory?: () => void;
  inventoryCount?: number;
  onOpenAchievements?: () => void;
  /** Level G: code digits found so far and whether the final alarm is on. */
  levelGProgress?: LevelGProgress;
  /** Abandoned Office: the blue door's password, filled in as the programmers are found. */
  megProgress?: MegProgress;
  /** Level FUN: the current goal. */
  objective?: string | null;
  /** Proximity VOIP: whether the mic/call is on, whether the local player is currently speaking, and the toggle. */
  voipEnabled?: boolean;
  voipSpeaking?: boolean;
  onToggleVoip?: () => void;
}

const GameHUDComponent: React.FC<GameHUDProps> = ({
  stamina,
  sanity,
  isFlashlightOn,
  playerState,
  playerName,
  roomKey,
  connectedPlayers,
  playersRef,
  perf,
  showFps = false,
  chatMessages,
  onSendMessage,
  onSendQuick,
  localPlayerId,
  chatHotkeysEnabled,
  latency,
  level = 0,
  engineRef,
  currentSector = "",
  hudNotification = "",
  notificationKey = 0,
  onOpenInventory,
  inventoryCount = 0,
  onOpenAchievements,
  levelGProgress,
  megProgress,
  objective,
  voipEnabled = false,
  voipSpeaking = false,
  onToggleVoip
}) => {
  useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // The inventory button glows for a moment when the item count goes up,
  // instead of pulsing forever.
  const prevInventoryCount = useRef(inventoryCount);
  const [inventoryGlow, setInventoryGlow] = useState(false);
  useEffect(() => {
    const gained = inventoryCount > prevInventoryCount.current;
    prevInventoryCount.current = inventoryCount;
    if (!gained) return;
    setInventoryGlow(true);
    const timer = setTimeout(() => setInventoryGlow(false), 2000);
    return () => clearTimeout(timer);
  }, [inventoryCount]);

  /**
   * Helper function to parse seconds to HH:MM:SS
   */
  const formatTime = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return [
      hrs.toString().padStart(2, "0"),
      mins.toString().padStart(2, "0"),
      secs.toString().padStart(2, "0")
    ].join(":");
  };

  // Stamina status indicators
  const [activeAlert, setActiveAlert] = useState("");
  const [alertVisible, setAlertVisible] = useState(false);

  useEffect(() => {
    if (hudNotification) {
      setActiveAlert(hudNotification);
      setAlertVisible(true);
      const timer = setTimeout(() => {
        setAlertVisible(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [hudNotification, notificationKey]);

  const isStaminaLow = stamina < 0.18;
  const staminaColor = isStaminaLow 
    ? "bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.7)] animate-pulse" 
    : stamina < 0.5 
      ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]" 
      : "bg-[#deb81d] shadow-[0_0_6px_rgba(222,184,29,0.3)]";

  const isSanityLow = sanity < 0.3;
  const sanityColor = isSanityLow 
    ? "bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.7)] animate-pulse" 
    : sanity < 0.6 
      ? "bg-purple-600 shadow-[0_0_6px_rgba(147,51,234,0.5)] animate-pulse" 
      : "bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.4)]";

  return (
    <div className="absolute inset-x-0 inset-y-0 pointer-events-none flex flex-col justify-between font-mono p-4 z-40 select-none text-[#deb81d]">
      
      {/* 0. FLOATING TEMPORARY HUD NOTIFICATION SYSTEM */}
      {alertVisible && activeAlert && (
        <div className="absolute top-[85px] left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center animate-bounce">
          <div className="bg-[#0b0a05]/92 border-2 border-[#deb81d] text-[#deb81d] px-6 py-3 rounded shadow-[0_0_15px_rgba(222,184,29,0.45)] flex items-center gap-3 max-w-md">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <div className="text-xs uppercase font-extrabold tracking-widest font-mono text-center">
              {activeAlert}
            </div>
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          </div>
        </div>
      )}

      {/* 1. TOP TELEMETRY BAR */}
      <div className="flex justify-between items-start">
        {/* Camcorder Status */}
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-2 bg-[#0b0a05]/75 border border-[#a28e3b]/20 px-3 py-1.5 rounded">
            <span className="w-2.5 h-2.5 bg-red-600 rounded-full animate-ping duration-1000 inline-block" />
            <span className="font-bold text-xs tracking-widest text-[#deb81d]">{t("hud.infiltrating")}</span>
            <span className="text-[#a28e3b] px-1 border-l border-[#a28e3b]/30">{formatTime(elapsedSeconds)}</span>
            {showFps && perf && (
              <span
                className={`px-1 border-l border-[#a28e3b]/30 tabular-nums ${
                  perf.fps >= 50 ? "text-green-400" : perf.fps >= 30 ? "text-amber-400" : "text-red-400"
                }`}
                title={t("hud.fpsTitle")}
              >
                {Math.round(perf.fps)} FPS · {Math.round(perf.scale * 100)}%
              </span>
            )}
          </div>
          <div className="text-[10px] text-[#a28e3b]/60 px-1 font-semibold uppercase tracking-wider flex items-center gap-2 flex-wrap max-w-lg">
            <span>{t("hud.explorer")} <span className="text-[#deb81d]">{playerName}</span></span>
            <span className="text-[#a28e3b]/30">•</span>
            <span>{t("hud.location")} <span className="text-[#deb81d]">{t(`hud.loc.${level}`)}</span></span>
            {(level === 1 || level === LEVEL_G) && currentSector && (
              <>
                <span className="text-[#a28e3b]/30">•</span>
                <span className="text-[#deb81d] font-bold bg-[#deb81d]/10 px-1 border border-[#deb81d]/20 rounded tracking-widest text-[9px] animate-pulse">
                   {t("hud.sector", { name: currentSector.toUpperCase() })}
                </span>
              </>
            )}
          </div>
          {level === FUN_LEVEL && objective && (
            <div className="mt-1 ml-1 max-w-md rounded border border-[#f2cc2e]/50 bg-black/65 px-2 py-1 text-[10px] font-bold uppercase leading-snug tracking-widest text-[#ffe08a]">
              <span className="text-[#f07ab8]">{t("fun.hud.objective")}:</span> {objective}
            </div>
          )}
          {level === SPACE_LEVEL && objective && (
            <div className="mt-1 ml-1 max-w-md rounded border border-cyan-500/40 bg-black/65 px-2 py-1 font-mono text-[10px] font-bold uppercase leading-snug tracking-widest text-cyan-100">
              <span className="text-cyan-400">{t("fun.hud.objective")}:</span> {objective}
            </div>
          )}
          {level === HOTEL_LEVEL && objective && (
            <div className="mt-1 ml-1 max-w-md rounded border border-[#c9a65e]/50 bg-black/65 px-2 py-1 font-serif leading-snug tracking-wider text-[#e5d5af]">
              {objective.split("\n").map((line, i) => i === 0
                ? <div key={i} className="text-[12px] font-bold">{line}</div>
                : <div key={i} className="mt-0.5 text-[11px] font-normal text-[#e5d5af]/85">{line}</div>)}
            </div>
          )}
          {level === ABANDONED_OFFICE_LEVEL && megProgress && (
            <div className="mt-1 ml-1 max-w-md rounded border border-sky-500/50 bg-black/65 px-2 py-1 text-[10px] font-bold uppercase leading-snug tracking-widest text-sky-100">
              {megProgress.open ? (
                <span className="text-sky-300">{t("hud.megOpen")}</span>
              ) : (
                <>
                  <div>
                    <span className="text-sky-400">{t("hud.megPassword")}</span>{" "}
                    {megProgress.ids.map((id, i) => (
                      <span key={i} className={`ml-1 inline-block min-w-[2.6em] rounded border px-1 text-center ${id ? "border-sky-400/70 text-white" : "border-slate-600 text-slate-500"}`}>
                        <span className="text-[8px] text-sky-400/80">{t(`hud.megSlot.${i}` as "hud.megSlot.0")}</span> {id ?? "__"}
                      </span>
                    ))}
                  </div>
                  <div className="mt-0.5 normal-case tracking-normal text-[#ff9a4a]">
                    {megProgress.ids.every((id) => id !== null)
                      ? t("hud.megReady")
                      : t("hud.megFind", { n: megProgress.ids.filter((id) => id !== null).length })}
                  </div>
                </>
              )}
            </div>
          )}
          {level === LEVEL_G && levelGProgress && (
            <div className={`mt-1 ml-1 inline-flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-widest ${
              levelGProgress.alarm
                ? "text-red-400 bg-red-950/60 border-red-600/50 animate-pulse"
                : "text-[#3cff7a] bg-black/60 border-[#1f7a3a]/60"
            }`}>
              {levelGProgress.alarm ? (
                <span>{t("hud.alarmOpen")}</span>
              ) : (
                <>
                  <span>{t("hud.code")} <span className="tracking-[0.35em]">{levelGProgress.digits.map((d) => (d === null ? "_" : d)).join("")}</span></span>
                  <span className="text-[#3cff7a]/50">•</span>
                  <span className="text-[#3cff7a]/70">
                    {levelGProgress.digits.every((d) => d !== null)
                      ? t("hud.useComputer")
                      : t("hud.documents", { n: levelGProgress.digits.filter((d) => d !== null).length })}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Room configuration and connection matrix */}
        <div className="flex flex-col items-end gap-1">
          <div className="bg-[#0b0a05]/75 border border-[#a28e3b]/20 px-3 py-1 rounded text-right text-xs">
            <div className="uppercase tracking-wider font-semibold text-xs text-[#a28e3b]">
              {t("hud.lobby")} <span className="text-[#deb81d]">{roomKey}</span>
            </div>
            <div className="text-[10px] text-[#a28e3b]/70 flex items-center justify-end gap-2 mt-0.5">
              <span>{t("hud.explorers", { n: connectedPlayers.length + 1 })}</span>
              {latency !== undefined && (
                <span
                  className={`px-1 rounded border tabular-nums ${
                    latency < 80
                      ? "bg-green-400/10 text-green-400 border-green-400/20"
                      : latency < 180
                        ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                        : "bg-red-400/10 text-red-400 border-red-400/20"
                  }`}
                  title={t("hud.pingTitle")}
                >
                  {t("hud.ping", { ms: latency })}
                </span>
              )}
            </div>
          </div>

          {/* Connected players roster list */}
          <div className="flex flex-col gap-1 items-end pt-1">
            <div className="text-[9px] text-[#a28e3b]/50 uppercase font-bold px-1 select-none">
              {t("hud.roster")}
            </div>
            <div className="text-[10px] bg-[#0b0a05]/50 px-2 py-1 border border-[#a28e3b]/10 rounded flex flex-col gap-0.5">
              <div className="text-[#deb81d] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                {playerName} {t("hud.you")} — <span className="uppercase text-[8px] opacity-75">{playerState}</span>
              </div>
              {connectedPlayers.map((p) => (
                <div key={p.id} className="text-[#a28e3b] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#deb81d] inline-block" />
                  {p.name} — <span className="uppercase text-[8px] opacity-75">{p.state}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. CHAT (history, fading feed, quick messages) + HUD BUTTONS */}
      <ChatHUD
        messages={chatMessages}
        playerName={playerName}
        localPlayerId={localPlayerId}
        connectedPlayers={connectedPlayers}
        onSendMessage={onSendMessage}
        onSendQuick={onSendQuick}
        hotkeysEnabled={chatHotkeysEnabled}
      >
        {/* Toggle inventory window */}
        {onOpenInventory && (
          <button
            onClick={onOpenInventory}
            id="btn-hud-inventory-toggle"
            className={`flex items-center gap-2 bg-[#0b0a05]/85 hover:bg-[#141208] text-[#a28e3b] hover:text-[#deb81d] border border-[#a28e3b]/20 hover:border-[#deb81d]/40 rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer ${inventoryGlow ? "animate-pulse border-[#deb81d]/70 text-[#deb81d]" : ""}`}
          >
            <Backpack className="w-4 h-4 text-[#deb81d]" />
            {t("hud.inventory")}
            {inventoryCount > 0 && (
              <span className="px-1.5 py-0.2 bg-[#deb81d] text-black font-extrabold rounded-full text-[9px]">
                {inventoryCount}
              </span>
            )}
          </button>
        )}

        {/* Toggle achievements window */}
        {onOpenAchievements && (
          <button
            onClick={onOpenAchievements}
            id="btn-hud-achievements-toggle"
            className="flex items-center gap-2 bg-[#0b0a05]/85 hover:bg-[#141208] text-[#a28e3b] hover:text-[#deb81d] border border-[#a28e3b]/20 hover:border-[#deb81d]/40 rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
          >
            <Trophy className="w-4 h-4 text-[#deb81d]" />
            {t("hud.achievements")}
          </button>
        )}

        {/* Proximity VOIP: mic on/off, glowing green while the local mic is picking up speech */}
        {onToggleVoip && (
          <button
            onClick={onToggleVoip}
            id="btn-hud-voip-toggle"
            className={`flex items-center gap-2 border rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer ${
              voipEnabled
                ? voipSpeaking
                  ? "bg-green-500/20 text-green-400 border-green-400/60"
                  : "bg-[#0b0a05]/85 text-[#deb81d] border-[#deb81d]/40"
                : "bg-[#0b0a05]/85 text-[#a28e3b] border-[#a28e3b]/20 hover:border-[#deb81d]/40 hover:text-[#deb81d]"
            }`}
          >
            {voipEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            {t("hud.voip")}
          </button>
        )}
      </ChatHUD>

      {/* RADIO RADAR WIDGET */}
      <div className="absolute right-4 bottom-22 pointer-events-auto w-64 flex flex-col justify-end">
        <RadarHUD
          engineRef={engineRef}
          playersRef={playersRef}
          level={level}
        />
      </div>

      {/* 3. BOTTOM PANEL HUD (STAMINA + DISCONNECT + FLASHLIGHT) */}
      <div className="flex justify-between items-end pointer-events-auto">
        {/* ("Abort infiltration" lives in the pause menu now.) Diagnostics sit
            bottom-left, under the chat buttons: the bottom center belongs to
            the item hotbar. */}
        <div className="flex gap-3 text-[10px] text-[#a28e3b]/40 select-none">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            {t("hud.vhfActive")}
          </div>
          <div>{t("hud.battery")}</div>
        </div>

        {/* Dynamic HUD components */}
        <div className="flex items-center gap-5 bg-[#0b0a05]/75 border border-[#a28e3b]/20 px-5 py-3 rounded w-[460px]">
          
          {/* Flashlight Indicator */}
          <div className="flex flex-col items-center gap-1 text-center select-none">
            <div className={`p-2 rounded-full border transition-all ${isFlashlightOn ? "bg-[#deb81d]/10 border-[#deb81d] text-[#deb81d]" : "bg-black/30 border-gray-800 text-gray-700"}`}>
              <Flashlight className={`w-4 h-4 ${isFlashlightOn ? "animate-pulse" : ""}`} />
            </div>
            <span className="text-[8px] uppercase tracking-wider font-extrabold">{t("hud.flashlight")}</span>
          </div>

          <div className="h-8 w-[1px] bg-[#a28e3b]/20" />

          {/* Stamina bar */}
          <div className="flex-1 flex flex-col gap-1.5 justify-center">
            <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase">
              <span className="text-[#a28e3b]">{t("hud.stamina")}</span>
              <span className={isStaminaLow ? "text-red-500 font-black animate-pulse" : "text-[#deb81d]"}>
                {Math.round(stamina * 100)}%
              </span>
            </div>
            
            {/* Outline bar */}
            <div className="w-full h-2 bg-black/50 border border-[#a28e3b]/20 rounded-sm overflow-hidden p-0.5">
              <div 
                className={`h-full rounded-sm transition-all duration-75 ${staminaColor}`}
                style={{ width: `${stamina * 100}%` }}
              />
            </div>

            {isStaminaLow && (
              <div className="text-[8px] text-red-500 font-extrabold flex items-center gap-1 mt-0.5">
                <ShieldAlert className="w-3 h-3 animate-ping" />
                {t("hud.exhaustion")}
              </div>
            )}
          </div>

          <div className="h-8 w-[1px] bg-[#a28e3b]/20" />

          {/* Sanity bar */}
          <div className="flex-1 flex flex-col gap-1.5 justify-center">
            <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase">
              <span className="text-[#a28e3b]">{t("hud.sanity")}</span>
              <span className={isSanityLow ? "text-red-500 font-black animate-pulse" : "text-[#deb81d]"}>
                {Math.round(sanity * 100)}%
              </span>
            </div>
            
            {/* Outline bar */}
            <div className="w-full h-2 bg-black/50 border border-[#a28e3b]/20 rounded-sm overflow-hidden p-0.5">
              <div 
                className={`h-full rounded-sm transition-all duration-75 ${sanityColor}`}
                style={{ width: `${sanity * 100}%` }}
              />
            </div>

            {isSanityLow && (
              <div className="text-[8px] text-red-500 font-extrabold flex items-center gap-1 mt-0.5">
                <ShieldAlert className="w-3 h-3 animate-bounce" />
                {t("hud.mentalDamage")}
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

export const GameHUD = React.memo(GameHUDComponent);
