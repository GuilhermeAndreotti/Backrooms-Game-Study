/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Flashlight, ShieldAlert, Send, MessageSquare, Terminal, Backpack, Trophy } from "lucide-react";
import { ChatMessage, RemotePlayer } from "../types/game";
import { RadarHUD } from "./RadarHUD";
import { GameEngine } from "../game/GameEngine";

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
  onDisconnect: () => void;
  latency?: number; // Optional ping latency in milliseconds
  level?: number;
  engineRef: React.MutableRefObject<GameEngine | null>;
  currentSector?: string;
  hudNotification?: string;
  notificationKey?: number;
  onOpenInventory?: () => void;
  inventoryCount?: number;
  onOpenAchievements?: () => void;
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
  onDisconnect,
  latency = 32,
  level = 0,
  engineRef,
  currentSector = "",
  hudNotification = "",
  notificationKey = 0,
  onOpenInventory,
  inventoryCount = 0,
  onOpenAchievements
}) => {
  const [inputText, setInputText] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Infiltration clock timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto scroll chat to newest messages
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

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
            <span className="font-bold text-xs tracking-widest text-[#deb81d]">● INFILTRANDO</span>
            <span className="text-[#a28e3b] px-1 border-l border-[#a28e3b]/30">{formatTime(elapsedSeconds)}</span>
            {showFps && perf && (
              <span
                className={`px-1 border-l border-[#a28e3b]/30 tabular-nums ${
                  perf.fps >= 50 ? "text-green-400" : perf.fps >= 30 ? "text-amber-400" : "text-red-400"
                }`}
                title="Quadros por segundo • resolução interna de renderização"
              >
                {Math.round(perf.fps)} FPS · {Math.round(perf.scale * 100)}%
              </span>
            )}
          </div>
          <div className="text-[10px] text-[#a28e3b]/60 px-1 font-semibold uppercase tracking-wider flex items-center gap-2 flex-wrap max-w-lg">
            <span>Explorador: <span className="text-[#deb81d]">{playerName}</span></span>
            <span className="text-[#a28e3b]/30">•</span>
            <span>Localização: <span className="text-[#deb81d]">{level === 2 ? "Level 2 (Pipe Dreams)" : (level === 1 ? "Level 1 (Habitable Zone)" : "Level 0 (The Lobby)")}</span></span>
            {level === 1 && currentSector && (
              <>
                <span className="text-[#a28e3b]/30">•</span>
                <span className="text-[#deb81d] font-bold bg-[#deb81d]/10 px-1 border border-[#deb81d]/20 rounded tracking-widest text-[9px] animate-pulse">
                   SETOR: {currentSector.toUpperCase()}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Room configuration and connection matrix */}
        <div className="flex flex-col items-end gap-1">
          <div className="bg-[#0b0a05]/75 border border-[#a28e3b]/20 px-3 py-1 rounded text-right text-xs">
            <div className="uppercase tracking-wider font-semibold text-xs text-[#a28e3b]">
              Lobby: <span className="text-[#deb81d]">{roomKey}</span>
            </div>
            <div className="text-[10px] text-[#a28e3b]/70 flex items-center justify-end gap-2 mt-0.5">
              <span>EXPLORADORES: {connectedPlayers.length + 1} / 4</span>
              {latency !== undefined && (
                <span className="px-1 bg-[#deb81d]/10 text-[#deb81d] rounded border border-[#deb81d]/20">
                  PING: {latency}ms
                </span>
              )}
            </div>
          </div>

          {/* Connected players roster list */}
          <div className="flex flex-col gap-1 items-end pt-1">
            <div className="text-[9px] text-[#a28e3b]/50 uppercase font-bold px-1 select-none">
              Infiltrados na fenda:
            </div>
            <div className="text-[10px] bg-[#0b0a05]/50 px-2 py-1 border border-[#a28e3b]/10 rounded flex flex-col gap-0.5">
              <div className="text-[#deb81d] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                {playerName} (VOCÊ) — <span className="uppercase text-[8px] opacity-75">{playerState}</span>
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

      {/* 2. CHAT DRAWER OR OVERLAY */}
      <div className="absolute left-4 bottom-22 pointer-events-auto h-52 w-[340px] flex flex-col justify-end gap-2">
        <div className="flex gap-2">
          {/* Toggle chat messaging window */}
          <button
            onClick={() => setShowChat((prev) => !prev)}
            id="btn-hud-chat-toggle"
            className="flex items-center gap-2 bg-[#0b0a05]/85 hover:bg-[#141208] text-[#a28e3b] hover:text-[#deb81d] border border-[#a28e3b]/20 hover:border-[#deb81d]/40 rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            Comunicador
            {chatMessages.length > 0 && (
              <span className="px-1.5 py-0.2 bg-[#deb81d] text-black font-extrabold rounded-full text-[9px]">
                {chatMessages.length}
              </span>
            )}
          </button>

          {/* Toggle inventory window */}
          {onOpenInventory && (
            <button
              onClick={onOpenInventory}
              id="btn-hud-inventory-toggle"
              className="flex items-center gap-2 bg-[#0b0a05]/85 hover:bg-[#141208] text-[#a28e3b] hover:text-[#deb81d] border border-[#a28e3b]/20 hover:border-[#deb81d]/40 rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer animate-pulse hover:animate-none"
            >
              <Backpack className="w-4 h-4 text-[#deb81d]" />
              Inventário [I]
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
              Conquistas [K]
            </button>
          )}
        </div>

        {showChat && (
          <div className="bg-[#0b0a05]/92 border border-[#a28e3b]/30 w-full rounded p-3 flex flex-col h-40 shadow-lg pointer-events-auto">
            {/* Scrollable messages area */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#a28e3b]/20 pr-1 space-y-1.5 text-xs select-text">
              {chatMessages.length === 0 ? (
                <div className="text-[#a28e3b]/40 text-center py-6 text-[10px] italic">
                  SINAL ESTÁVEL. NENHUMA MENSAGEM ENVIADA.
                </div>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className="break-all leading-tight">
                    <span className="text-[#a28e3b] font-bold">[{m.time}] </span>
                    <span className={m.sender === playerName ? "text-[#deb81d] font-bold" : "text-[#d1bd66]"}>
                      {m.sender}:
                    </span>{" "}
                    <span className="text-gray-300 font-sans tracking-wide">{m.text}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSend} className="mt-2 flex gap-1 border-t border-[#a28e3b]/10 pt-2">
              <input
                type="text"
                maxLength={45}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Enviar mensagem para o grupo..."
                className="flex-1 bg-[#12110a] border border-[#a28e3b]/30 text-xs px-2.5 py-1.5 rounded outline-none text-[#deb81d] focus:border-[#deb81d]"
              />
              <button
                type="submit"
                id="btn-hud-chat-send"
                className="bg-[#deb81d] hover:bg-[#ebd255] text-black px-2.5 py-1 rounded cursor-pointer transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>

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
        {/* Escape disconnect trigger */}
        <div>
          <button
            onClick={onDisconnect}
            id="btn-hud-leave"
            className="flex items-center gap-2 bg-[#1c0808]/75 pointer-events-auto hover:bg-red-950/90 text-red-400 hover:text-red-300 border border-red-950 px-4 py-2 text-xs uppercase tracking-widest rounded transition-all cursor-pointer shadow-md"
          >
            Abortar Infiltração
          </button>
        </div>

        {/* Diagnostic widgets */}
        <div className="flex flex-col gap-1 text-[10px] text-[#a28e3b]/40 select-none">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            VHF TRANSMISSÃO ATIVA
          </div>
          <div>BATERIA EQUIP: 86% // CAMERA AUTO</div>
        </div>

        {/* Dynamic HUD components */}
        <div className="flex items-center gap-5 bg-[#0b0a05]/75 border border-[#a28e3b]/20 px-5 py-3 rounded w-[460px]">
          
          {/* Flashlight Indicator */}
          <div className="flex flex-col items-center gap-1 text-center select-none">
            <div className={`p-2 rounded-full border transition-all ${isFlashlightOn ? "bg-[#deb81d]/10 border-[#deb81d] text-[#deb81d]" : "bg-black/30 border-gray-800 text-gray-700"}`}>
              <Flashlight className={`w-4 h-4 ${isFlashlightOn ? "animate-pulse" : ""}`} />
            </div>
            <span className="text-[8px] uppercase tracking-wider font-extrabold">LANTERNA [F]</span>
          </div>

          <div className="h-8 w-[1px] bg-[#a28e3b]/20" />

          {/* Stamina bar */}
          <div className="flex-1 flex flex-col gap-1.5 justify-center">
            <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase">
              <span className="text-[#a28e3b]">STAMINA:</span>
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
                EXAUSTÃO IMINENTE!
              </div>
            )}
          </div>

          <div className="h-8 w-[1px] bg-[#a28e3b]/20" />

          {/* Sanity bar */}
          <div className="flex-1 flex flex-col gap-1.5 justify-center">
            <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase">
              <span className="text-[#a28e3b]">SANIDADE:</span>
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
                DANO MENTAL SEVERO!
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

export const GameHUD = React.memo(GameHUDComponent);
