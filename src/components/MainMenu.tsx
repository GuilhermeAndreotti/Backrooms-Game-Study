/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GameSettings } from "../types/game";
import { Settings, Play, Users, LogOut, Check, Sliders, Volume2, MonitorCog } from "lucide-react";

interface MainMenuProps {
  settings: GameSettings;
  onUpdateSettings: (settings: GameSettings) => void;
  onHost: () => void;
  onJoin: () => void;
  onCloseApp?: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  settings,
  onUpdateSettings,
  onHost,
  onJoin,
  onCloseApp
}) => {
  const [localSettings, setLocalSettings] = useState<GameSettings>({ ...settings });
  const [showSettings, setShowSettings] = useState(false);
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
                Network Status: Stable
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
                  <span className="text-[#F2E8CF]/40 text-xs uppercase tracking-widest font-bold">Infiltração Cooperativa</span>
                  <h2 className="text-xl font-bold text-[#F2E8CF] tracking-wide mt-1">THE BACKROOMS</h2>
                </div>

                {/* Explorer settings Form */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase text-[#F2E8CF]/70 tracking-wider mb-1.5">
                      Identificação do Explorador
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={localSettings.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      placeholder="Nome do Jogador"
                      className="w-full bg-black/50 border border-white/15 text-[#F2E8CF] outline-none px-3 py-2 text-sm rounded focus:border-[#deb81d] transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase text-[#F2E8CF]/70 tracking-wider mb-1.5">
                      Código da Sala
                    </label>
                    <input
                      type="text"
                      maxLength={24}
                      value={localSettings.ipAddress}
                      onChange={(e) => handleChange("ipAddress", e.target.value)}
                      placeholder="sala-principal"
                      className="w-full bg-black/50 border border-white/15 text-[#F2E8CF] outline-none px-3 py-2 text-sm rounded focus:border-[#deb81d] transition-all font-mono"
                    />
                    <p className="text-[10px] text-[#F2E8CF]/40 mt-1.5 leading-relaxed">
                      Quem digitar o mesmo código entra no mesmo mapa (até 4 exploradores).
                      Não é preciso IP: o servidor é o próprio site.
                    </p>
                  </div>
                </div>

                {/* Elegant Button Stack */}
                <div className="space-y-4 pt-2">
                  <button
                    id="btn-host"
                    onClick={() => {
                      onUpdateSettings(localSettings);
                      onHost();
                    }}
                    disabled={!localSettings.name.trim()}
                    className="group w-full text-left transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">01</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        Host Game
                      </span>
                    </div>
                    <div className="h-[1px] w-full bg-white/10 group-hover:bg-[#deb81d]/30 mt-2 transition-colors"></div>
                  </button>

                  <button
                    id="btn-join"
                    onClick={() => {
                      onUpdateSettings(localSettings);
                      onJoin();
                    }}
                    disabled={!localSettings.name.trim() || !localSettings.ipAddress.trim()}
                    className="group w-full text-left transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <div className="flex items-center gap-4 text-[#F2E8CF]/80 group-hover:text-white transition-colors">
                      <span className="font-mono text-xs opacity-50 bg-white/5 px-2 py-0.5 rounded">02</span>
                      <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                        Join Game
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
                        Settings
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
                        <span className="font-mono text-xs opacity-50 bg-red-400/5 px-2 py-0.5 rounded">04</span>
                        <span className="text-xl font-light tracking-wide uppercase group-hover:translate-x-2 transition-transform">
                          Exit Terminal
                        </span>
                      </div>
                      <div className="h-[1px] w-full bg-red-400/10 group-hover:bg-red-400/30 mt-2 transition-colors"></div>
                    </button>
                  )}
                </div>

                <div className="text-center text-[10px] text-white/30 pt-2 cursor-default font-mono uppercase tracking-wider">
                  BACKROOMS EXPLORATION // LOCAL STORAGE SECURED
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                <h2 className="text-lg font-bold text-[#F2E8CF] flex items-center gap-2 border-b border-white/10 pb-3 uppercase tracking-wider">
                  <Sliders className="w-5 h-5 text-[#deb81d]" />
                  Internal Config
                </h2>

                <div className="space-y-4 text-sm text-[#F2E8CF]">
                  {/* Sensitivity */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/60 mb-1 uppercase tracking-wider">
                      <span>Mouse Sensitivity</span>
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
                      <span>Field of View (FOV)</span>
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

                  {/* Graphics / performance */}
                  <div className="text-xs uppercase text-[#F2E8CF]/60 tracking-widest flex items-center gap-1.5 mb-1">
                    <MonitorCog className="w-3.5 h-3.5" />
                    Desempenho Gráfico
                  </div>

                  <div>
                    <div className="text-xs text-[#F2E8CF]/50 mb-1.5">Preset de Qualidade</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        { id: "auto", label: "Auto" },
                        { id: "low", label: "Baixo" },
                        { id: "medium", label: "Médio" },
                        { id: "high", label: "Alto" },
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
                      Controla resolução interna, sombras, alcance de visão e o número de luzes
                      dinâmicas. <span className="text-[#deb81d]/70">Auto</span> escolhe pelo seu aparelho.
                    </p>
                  </div>

                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs text-[#F2E8CF]/50 leading-snug">
                      Resolução adaptativa
                      <span className="block text-[10px] text-[#F2E8CF]/30">
                        Reduz a resolução automaticamente quando o FPS cai.
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
                    <span className="text-xs text-[#F2E8CF]/50">Mostrar FPS no HUD</span>
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
                    Audio Channels
                  </div>

                  {/* Master Volume */}
                  <div>
                    <div className="flex justify-between text-xs text-[#F2E8CF]/50 mb-1">
                      <span>Master Volume</span>
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
                      <span>Fluorescent Hum</span>
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
                      <span>SFX Feedback</span>
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
                    Cancel
                  </button>

                  <button
                    type="submit"
                    id="btn-settings-save"
                    className="flex-1 flex items-center justify-center gap-2 bg-[#deb81d] hover:bg-[#ebd255] text-black py-2 rounded uppercase tracking-wider text-xs font-bold transition-all cursor-pointer"
                  >
                    {saveSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-black" />
                        Saved
                      </>
                    ) : (
                      "Save"
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
              <span className="text-white/40 text-[9px] uppercase font-bold tracking-widest font-mono">Stamina Status</span>
              <div className="w-48 h-1 bg-white/10 relative rounded-full">
                <div className="absolute top-0 left-0 h-full bg-[#E2D08E] w-[88%] rounded-full"></div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-white/40 text-[9px] uppercase font-bold tracking-widest font-mono">Light Radiation</span>
              <div className="flex gap-1">
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]/30"></div>
                <div className="w-1.5 h-3 bg-[#E2D08E]/30"></div>
              </div>
            </div>
          </div>

          {/* Join Overlay Code Quick-Connect Peek */}
          <div className="bg-black/45 border border-white/10 p-4 w-full md:w-64 backdrop-blur-md rounded-lg self-end shadow-lg">
            <span className="text-[10px] text-[#F2E8CF]/50 uppercase font-mono block mb-2 tracking-wider">Join Quick-Connect</span>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center bg-black/40 border border-white/5 p-2 text-[10px] font-mono text-white/80">
                <span>sala-principal</span>
                <span className="text-green-500 animate-pulse">Available</span>
              </div>
              <button 
                type="button"
                onClick={() => {
                  handleChange("ipAddress", "sala-principal");
                  handleChange("port", "0");
                }}
                className="w-full py-1.5 bg-white/10 hover:bg-white/20 text-[10px] text-white uppercase font-bold transition-all rounded cursor-pointer"
              >
                Use Preset
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
