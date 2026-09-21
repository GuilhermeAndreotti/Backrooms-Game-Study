/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { t, useLanguage, LANGUAGES } from "../i18n";
import React, { useState, useEffect } from "react";
import { GameSettings, SUIT_COLORS } from "../types/game";
import { FaceEditor } from "./FaceEditor";
import { Settings, Play, Users, LogOut, Check, Sliders, Volume2, MonitorCog, Shirt } from "lucide-react";

interface MainMenuProps {
  settings: GameSettings;
  onUpdateSettings: (settings: GameSettings) => void;
  /** Creates a new room (and its invite code). */
  onCreate: () => void;
  /** Joins an existing room by its invite code. */
  onJoin: (code: string) => void;
  /** Code from an invite link (yoursite/AB4D3X), pre-filled. */
  initialCode?: string;
  onCloseApp?: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  settings,
  onUpdateSettings,
  onCreate,
  onJoin,
  initialCode = "",
  onCloseApp
}) => {
  const [localSettings, setLocalSettings] = useState<GameSettings>({ ...settings });
  const [showSettings, setShowSettings] = useState(false);
  const [joinCode, setJoinCode] = useState(initialCode);
  const cleanCode = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [showCharacter, setShowCharacter] = useState(false);
  const [language, setLanguage] = useLanguage();
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync state if parent settings shift
  useEffect(() => {
    setLocalSettings({ ...settings });
  }, [settings]);

  const handleChange = (key: keyof GameSettings, value: any) => {
    setLocalSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(localSettings);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      setShowSettings(false);
    }, 1200);
  };

  return (
    <div className="relative w-full h-screen flex flex-col justify-between p-8 md:p-12 lg:p-16 bg-[#D4C385] overflow-hidden select-none font-mono">
      {/* 1. BACKROOMS ENVIRONMENT SIMULATION BACKDROP */}
      <div className="absolute inset-0 z-0">
        {/* Sky / Walls */}
        <div 
          className="absolute inset-0" 
          style={{
            background: "linear-gradient(90deg, #E2D08E 0%, #D4C385 50%, #E2D08E 100%)",
            backgroundSize: "400px 100%",
            opacity: 0.8
          }}
        />
        {/* Wallpaper Pattern */}
        <div 
          className="absolute inset-0 opacity-10" 
          style={{
            backgroundImage: "radial-gradient(#000 1px, transparent 1px)",
            backgroundSize: "30px 30px"
          }}
        />
        {/* Floor */}
        <div 
          className="absolute bottom-0 w-full h-[200px] bg-[#A69255]"
          style={{ boxShadow: "inset 0 20px 40px rgba(0,0,0,0.3)" }}
        >
          <div 
            className="absolute inset-0 opacity-20" 
            style={{
              backgroundImage: "repeating-linear-gradient(45deg, #000, #000 2px, transparent 2px, transparent 10px)"
            }}
          />
        </div>
        {/* Flashlight Vignette */}
        <div 
          className="absolute inset-0 pointer-events-none z-10" 
          style={{
            background: "radial-gradient(circle at 50% 50%, transparent 10%, rgba(0,0,0,0.85) 80%)"
          }}
        />
        {/* VHS Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-[0.03] z-10" 
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, #000, #000 1px, transparent 1px, transparent 2px)"
          }}
        />
        {/* Grain Effect */}
        <div 
          className="absolute inset-0 z-20 pointer-events-none mix-blend-soft-light opacity-10" 
          style={{
            backgroundImage: `url('data:image/svg+xml,%3Csvg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noiseFilter"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noiseFilter)"/%3E%3C/svg%3E')`
          }}
        />
      </div>

      {/* 2. REAL-TIME MENU LAYER */}
      <div className="relative z-30 w-full h-full flex flex-col justify-between">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-[#F2E8CF] text-5xl md:text-6xl font-extrabold tracking-tighter uppercase italic mix-blend-overlay">
              LEVEL 0
            </h1>
            <p className="text-[#F2E8CF]/60 text-xs tracking-[0.3em] font-mono mt-2 uppercase">
              ASYNC FOUNDATION // SECTOR-A4
            </p>
          </div>
          <div className="bg-black/50 border border-white/10 backdrop-blur-sm px-4 py-2 flex gap-4 md:gap-6 items-center rounded">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[#F2E8CF]/80 font-mono text-[10px] uppercase tracking-wide">
                {t("menu.networkStatus")}
              </span>
            </div>
            <span className="text-white/30 font-mono text-[10px]">v1.0.4-BETA</span>
          </div>
        </div>

        {/* Central Card with options, beautiful translucent box */}
        <div className="my-auto py-8 flex flex-col md:flex-row justify-center items-center gap-8 w-full max-w-5xl mx-auto">
          
          <div className="w-full max-w-md bg-black/45 hover:bg-black/50 transition-colors border border-white/10 backdrop-blur-md rounded-lg p-6 md:p-8 shadow-[0_0_50px_rgba(0,0,0,0.85)] relative">
            {/* Subtle glow header */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-[#deb81d] opacity-40 rounded-t-lg" />
            
            {!showSettings ? (
              <div className="space-y-6 font-mono">
                {/* Header title inside box */}
                <div className="border-b border-white/10 pb-4">
                  <span className="text-[#F2E8CF]/40 text-xs uppercase tracking-widest font-bold">{t("menu.tagline")}</span>
                  <h2 className="text-xl font-bold text-[#F2E8CF] tracking-wide mt-1">THE BACKROOMS</h2>
                </div>

                {/* Explorer settings Form */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase text-[#F2E8CF]/70 tracking-wider mb-1.5">
                      {t("menu.explorerId")}
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={localSettings.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      placeholder={t("menu.namePlaceholder")}
                      className="w-full bg-black/50 border border-white/15 text-[#F2E8CF] outline-none px-3 py-2 text-sm rounded focus:border-[#deb81d] transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase text-[#F2E8CF]/70 tracking-wider mb-1.5">
                      {initialCode ? t("menu.invitedTo", { code: initialCode.toUpperCase() }) : t("menu.codeLabel")}
                    </label>
                    <input
                      type="text"
                      id="input-room-code"
                      maxLength={12}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder={t("menu.codePlaceholder")}
                      className="w-full bg-black/50 border border-white/15 text-[#F2E8CF] outline-none px-3 py-2 text-sm rounded focus:border-[#deb81d] transition-all font-mono tracking-[0.3em] uppercase"
                    />
                    <p className="text-[10px] text-[#F2E8CF]/40 mt-1.5 leading-relaxed">
                      {t("menu.roomHint2")}
                    </p>
                  </div>
                </div>

                {/* Elegant Button Stack */}
                <div className="space-y-4 pt-2">
                  <button
                    id="btn-create-room"
                    onClick={() => {
                      onUpdateSettings(localSettings);
                      onCreate();
                    }}
                    disabled={!localSettings.name.trim()}
                    className="group w-full text-left transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">01</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        {t("menu.createRoom")}
                      </span>
                    </div>
                    <div className="h-[1px] w-full bg-white/10 group-hover:bg-[#deb81d]/30 mt-2 transition-colors"></div>
                  </button>

                  <button
                    id="btn-join-room"
                    onClick={() => {
                      onUpdateSettings(localSettings);
                      onJoin(cleanCode);
                    }}
                    disabled={!localSettings.name.trim() || cleanCode.length < 4}
                    className="group w-full text-left transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">02</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        {t("menu.joinRoom")}
                      </span>
                    </div>
                    <div className="h-[1px] w-full bg-white/10 group-hover:bg-[#deb81d]/30 mt-2 transition-colors"></div>
                  </button>

                  <button
                    id="btn-settings"
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="group w-full text-left transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">03</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        {t("menu.settings")}
                      </span>
                    </div>
                    <div className="h-[1px] w-full bg-white/10 group-hover:bg-[#deb81d]/30 mt-2 transition-colors"></div>
                  </button>

                  <button
                    id="btn-character"
                    type="button"
                    onClick={() => setShowCharacter(true)}
                    className="group w-full text-left transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">04</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        {t("menu.character")}
                      </span>
                    </div>
                    <div className="h-[1px] w-full bg-white/10 group-hover:bg-[#deb81d]/30 mt-2 transition-colors"></div>
                  </button>

                  {onCloseApp && (
                    <button
                      id="btn-exit"
                      onClick={onCloseApp}
                      className="group w-full text-left transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-4 text-red-400/80 group-hover:text-red-400 transition-colors">
                        <span className="font-mono text-xs opacity-50 bg-red-400/5 px-2 py-0.5 rounded">05</span>
                        <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                          {t("menu.exit")}
                        </span>
                      </div>
                      <div className="h-[1px] w-full bg-red-400/10 group-hover:bg-red-400/30 mt-2 transition-colors"></div>
                    </button>
                  )}
                </div>

                <div className="text-center text-[10px] text-white/30 pt-2 cursor-default font-mono uppercase tracking-wider">
                  {t("menu.footer")}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                <h2 className="text-lg font-bold text-[#F2E8CF] flex items-center gap-2 border-b border-white/10 pb-3 uppercase tracking-wider">
                  <Sliders className="w-5 h-5 text-[#deb81d]" />
                  {t("menu.internalConfig")}
                </h2>

                <div className="space-y-4 text-sm text-[#F2E8CF]">
                  {/* Sensitivity */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/60 mb-1 uppercase tracking-wider">
                      <span>{t("menu.mouseSens")}</span>
                      <span className="text-[#deb81d]">{Math.round(localSettings.mouseSensitivity * 10)} / 10</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="0.5"
                      value={localSettings.mouseSensitivity}
                      onChange={(e) => handleChange("mouseSensitivity", parseFloat(e.target.value))}
                      className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
                    />
                  </div>

                  {/* FOV */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/60 mb-1 uppercase tracking-wider">
                      <span>{t("menu.fov")}</span>
                      <span className="text-[#deb81d]">{localSettings.fov}°</span>
                    </div>
                    <input
                      type="range"
                      min="60"
                      max="110"
                      step="5"
                      value={localSettings.fov}
                      onChange={(e) => handleChange("fov", parseInt(e.target.value))}
                      className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
                    />
                  </div>

                  <div className="h-[1px] bg-white/10 my-1" />

                  {/* Language */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] text-[#F2E8CF]/60 uppercase tracking-wider">
                      {t("menu.language")}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {LANGUAGES.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          id={`btn-lang-${opt.id}`}
                          onClick={() => setLanguage(opt.id)}
                          className={`py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                            language === opt.id
                              ? "bg-[#deb81d] text-black border-[#deb81d]"
                              : "bg-black/40 text-[#F2E8CF]/60 border-white/15 hover:border-[#deb81d]/40"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Graphics / performance */}
                  <div className="text-xs uppercase text-[#F2E8CF]/60 tracking-widest flex items-center gap-1.5 mb-1">
                    <MonitorCog className="w-3.5 h-3.5" />
                    {t("menu.graphics")}
                  </div>

                  <div>
                    <div className="text-xs text-[#F2E8CF]/50 mb-1.5">Preset de Qualidade</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        { id: "auto", label: t("menu.q.auto") },
                        { id: "low", label: t("menu.q.low") },
                        { id: "medium", label: t("menu.q.medium") },
                        { id: "high", label: t("menu.q.high") },
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleChange("quality", option.id)}
                          className={`py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                            localSettings.quality === option.id
                              ? "bg-[#deb81d] text-black border-[#deb81d]"
                              : "bg-black/40 text-[#F2E8CF]/60 border-white/15 hover:border-[#deb81d]/40"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#F2E8CF]/40 mt-1.5 leading-relaxed">
                      {t("menu.graphicsHint")} <span className="text-[#deb81d]/70">Auto</span> {t("menu.graphicsHintAuto")}
                    </p>
                  </div>

                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs text-[#F2E8CF]/50 leading-snug">
                      {t("menu.adaptive")}
                      <span className="block text-[10px] text-[#F2E8CF]/30">
                        {t("menu.adaptiveHint")}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={localSettings.adaptiveResolution}
                      onChange={(e) => handleChange("adaptiveResolution", e.target.checked)}
                      className="w-4 h-4 accent-[#deb81d] cursor-pointer shrink-0"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs text-[#F2E8CF]/50">{t("menu.showFps")}</span>
                    <input
                      type="checkbox"
                      checked={localSettings.showFps}
                      onChange={(e) => handleChange("showFps", e.target.checked)}
                      className="w-4 h-4 accent-[#deb81d] cursor-pointer shrink-0"
                    />
                  </label>

                  <div className="h-[1px] bg-white/10 my-1" />

                  {/* Audio Volume Controls */}
                  <div className="text-xs uppercase text-[#F2E8CF]/60 tracking-widest flex items-center gap-1.5 mb-1">
                    <Volume2 className="w-3.5 h-3.5" />
                    {t("menu.audio")}
                  </div>

                  {/* Master Volume */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/50 mb-1">
                      <span>{t("menu.volMaster")}</span>
                      <span>{Math.round(localSettings.volumeMaster * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={localSettings.volumeMaster}
                      onChange={(e) => handleChange("volumeMaster", parseFloat(e.target.value))}
                      className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
                    />
                  </div>

                  {/* Fluorescent Hum Volume */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/50 mb-1">
                      <span>{t("menu.volHum")}</span>
                      <span>{Math.round(localSettings.volumeHum * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={localSettings.volumeHum}
                      onChange={(e) => handleChange("volumeHum", parseFloat(e.target.value))}
                      className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
                    />
                  </div>

                  {/* SFX Volume */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/50 mb-1">
                      <span>{t("menu.volSfx")}</span>
                      <span>{Math.round(localSettings.volumeSfx * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={localSettings.volumeSfx}
                      onChange={(e) => handleChange("volumeSfx", parseFloat(e.target.value))}
                      className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
                    />
                  </div>
                </div>

                {/* Settings Actions Buttons */}
                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    id="btn-settings-cancel"
                    onClick={() => {
                      setLocalSettings({ ...settings });
                      setShowSettings(false);
                    }}
                    className="flex-1 bg-transparent border border-white/20 text-[#F2E8CF]/80 hover:text-white py-2 rounded hover:bg-white/5 uppercase tracking-wider text-xs font-semibold transition-all cursor-pointer"
                  >
                    {t("menu.cancel")}
                  </button>

                  <button
                    type="submit"
                    id="btn-settings-save"
                    className="flex-1 flex items-center justify-center gap-2 bg-[#deb81d] hover:bg-[#ebd255] text-black py-2 rounded uppercase tracking-wider text-xs font-bold transition-all cursor-pointer"
                  >
                    {saveSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-black" />
                        {t("menu.saved")}
                      </>
                    ) : (
                      t("menu.save")
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
          
        </div>

        {/* HUD Simulation (Bottom Panel) */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6">
          
          {/* Player Status Simulation */}
          <div className="flex gap-8 bg-black/30 border border-white/5 backdrop-blur-sm self-start px-5 py-3 rounded">
            <div className="flex flex-col gap-1.5">
              <span className="text-white/40 text-[9px] uppercase font-bold tracking-widest font-mono">{t("menu.stamina")}</span>
              <div className="w-48 h-1 bg-white/10 relative rounded-full">
                <div className="absolute top-0 left-0 h-full bg-[#E2D08E] w-[88%] rounded-full"></div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-[9px] uppercase font-bold tracking-widest font-mono">{t("menu.lightRadiation")}</span>
              <div className="flex gap-1">
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]/30"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]/30"></div>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Character customization overlay */}
      {showCharacter && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm font-mono px-4">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[#14130a] border border-[#a28e3b]/40 rounded-lg p-6 md:p-8 shadow-[0_0_60px_rgba(0,0,0,0.9)] relative">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-[#deb81d] opacity-40 rounded-t-lg" />

            <h2 className="text-lg font-bold text-[#F2E8CF] flex items-center gap-2 border-b border-white/10 pb-3 uppercase tracking-wider">
              <Shirt className="w-5 h-5 text-[#deb81d]" />
              {t("menu.suitTitle")}
            </h2>

            <p className="text-[11px] text-[#F2E8CF]/50 mt-3 leading-relaxed uppercase tracking-wider">
              {t("menu.suitHint")}
            </p>

            <div className="grid grid-cols-4 gap-3 mt-5">
              {SUIT_COLORS.map((color) => {
                const selected = localSettings.suitColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={t("menu.colorLabel", { color })}
                    onClick={() => handleChange("suitColor", color)}
                    className={`aspect-square rounded border-2 transition-all cursor-pointer ${
                      selected ? "border-[#deb81d] scale-105 shadow-[0_0_14px_rgba(222,184,29,0.4)]" : "border-white/10 hover:border-white/40"
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {selected && <Check className="w-4 h-4 text-black mx-auto drop-shadow" />}
                  </button>
                );
              })}
            </div>

            <FaceEditor
              face={localSettings.face}
              suitColor={localSettings.suitColor}
              onChange={(face) => handleChange("face", face)}
            />

            <div className="flex gap-3 pt-6">
              <button
                type="button"
                id="btn-character-cancel"
                onClick={() => {
                  setLocalSettings({ ...settings });
                  setShowCharacter(false);
                }}
                className="flex-1 bg-transparent border border-white/20 text-[#F2E8CF]/80 hover:text-white py-2 rounded hover:bg-white/5 uppercase tracking-wider text-xs font-semibold transition-all cursor-pointer"
              >
                {t("menu.cancel")}
              </button>
              <button
                type="button"
                id="btn-character-save"
                onClick={() => {
                  onUpdateSettings(localSettings);
                  setSaveSuccess(true);
                  setTimeout(() => {
                    setSaveSuccess(false);
                    setShowCharacter(false);
                  }, 900);
                }}
                className="flex-1 flex items-center justify-center gap-2 bg-[#deb81d] hover:bg-[#ebd255] text-black py-2 rounded uppercase tracking-wider text-xs font-bold transition-all cursor-pointer"
              >
                {saveSuccess ? (<><Check className="w-4 h-4 text-black" />{t("menu.saved")}</>) : t("menu.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
